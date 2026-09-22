package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/service"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// Isolated SQL + HTTP regression. No runtime client, billing service or queue is
// installed: planning/model switching must work without creating paid tasks.
func TestAgentLightweightDatabaseFlow(t *testing.T) {
	dsn := os.Getenv("AGENT_DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set AGENT_DRAFT_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("agent_light_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `CREATE TABLE conversations(id bigserial PRIMARY KEY,public_id text,user_id bigint,agent_state jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now());
 CREATE TABLE conversation_messages(id bigserial PRIMARY KEY,conversation_id bigint,role text,content text);
 CREATE TABLE tasks(task_no text,user_id bigint,input jsonb,status text);
 CREATE TABLE model_routes(model_id bigint,is_enabled bool);
 CREATE TABLE workflow_projects(public_id text,user_id bigint,inputs jsonb,outputs jsonb,status text);
 CREATE TABLE workflow_definitions(id bigserial PRIMARY KEY,code text UNIQUE,name text,description text,icon text,category text,nodes jsonb DEFAULT '[]',input_schema jsonb DEFAULT '{}',price_rule jsonb DEFAULT '{}',display_config jsonb DEFAULT '{}',runtime_config jsonb DEFAULT '{}',is_enabled boolean DEFAULT true,sort_order int DEFAULT 0,updated_at timestamptz DEFAULT now());
 CREATE TABLE models(id bigserial PRIMARY KEY,code text,display_name text DEFAULT '',new_api_model text DEFAULT '',new_api_endpoint text DEFAULT '',request_mode text DEFAULT 'video',category text DEFAULT 'video',icon_url text,description text,tags jsonb DEFAULT '[]',input_schema jsonb,default_params jsonb DEFAULT '{}',new_api_extra_params jsonb DEFAULT '{}',price_rule jsonb DEFAULT '{}',runtime_rule jsonb DEFAULT '{}',retention_days int DEFAULT 7,is_enabled boolean DEFAULT true,sort_order int DEFAULT 0);
 INSERT INTO workflow_definitions(code,name,category,runtime_config) VALUES ('general_creative_agent','Agent','workflow','{"video_model_code":"eight","image_model_code":"image","speech_model_code":"speech","analysis_model_code":"chat"}');
 INSERT INTO models(code,input_schema) VALUES ('eight','{"properties":{"duration":{"enum":[8]},"ratio":{"enum":["16:9","9:16"]}}}'),('twelve','{"properties":{"duration":{"enum":[12]},"ratio":{"enum":["16:9","9:16"]}}}');
 INSERT INTO conversations(public_id,user_id) VALUES ('conv',1);`)
	if err != nil {
		t.Fatal(err)
	}
	chat := service.NewChatService(pool, nil, nil, nil, nil)
	agents := service.NewAgentService(pool, nil, nil, nil)
	h := &Handler{chat: chat, agents: agents, models: service.NewModelService(pool)}
	d, err := chat.BeginAgentDraftTurn(ctx, 1, "conv", 0)
	if err != nil {
		t.Fatal(err)
	}
	d.Slots = map[string]interface{}{"media_type": "video", "script": "原始文案保持不变", "character": "小满", "target_duration_sec": 22, "aspect_ratio": "9:16"}
	plan, err := h.finalizeCreativeAgentDraft(ctx, 1, "conv", creativeAgentPlanRequest{Draft: d}, map[string]interface{}{"intent": "video"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if creativeAgentPositiveInt(plan["params"].(map[string]interface{})["storyboard_grid"]) != 3 {
		t.Fatal(plan)
	}
	if plan["params"].(map[string]interface{})["creative_guidance"] != service.DefaultAgentPolicy().CreationGuidance {
		t.Fatal("published creative guidance did not reach workflow snapshot")
	}
	_, err = pool.Exec(ctx, `UPDATE workflow_definitions SET runtime_config=runtime_config || '{"video_model_code":"twelve"}'`)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user_id", int64(1)) })
	router.POST("/replan", h.CreativeAgentReplan)
	router.PUT("/agents/:code/policy", h.AdminAgentPolicy)
	request := func(path, method, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	replan := func(version int64) map[string]interface{} {
		t.Helper()
		w := request("/replan", "POST", fmt.Sprintf(`{"conversation_id":"conv","base_version":%d,"check_only":true}`, version))
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var r map[string]interface{}
		if err = json.Unmarshal(w.Body.Bytes(), &r); err != nil {
			t.Fatal(err)
		}
		return r["data"].(map[string]interface{})
	}
	result := replan(1)
	if result["changed"] != true {
		t.Fatal("model change not detected")
	}
	fresh, err := chat.GetAgentDraft(ctx, 1, "conv")
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Version != 2 || fresh.Status != "awaiting_confirmation" || fresh.Slots["script"] != "原始文案保持不变" || fresh.Slots["character"] != "小满" || fresh.Plan["model_code"] != "twelve" || creativeAgentPositiveInt(fresh.Plan["params"].(map[string]interface{})["storyboard_grid"]) != 2 {
		t.Fatalf("lost draft: %#v", fresh)
	}
	if err = chat.ClaimAgentDraft(ctx, 1, "conv", 1); err == nil {
		t.Fatal("old confirmation accepted")
	}
	if replan(2)["changed"] != false {
		t.Fatal("unchanged check re-created the plan")
	}
	if w := request("/replan", "POST", `{"conversation_id":"conv","base_version":1}`); w.Code == 200 {
		t.Fatal("stale tab overwrote plan")
	}
	p := service.DefaultAgentPolicy()
	p.MaxDuration = 20
	state, err := agents.SaveAgentPolicy(ctx, 0, p, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = agents.SaveAgentPolicy(ctx, 0, p, nil); err == nil {
		t.Fatal("stale policy save accepted")
	}
	if replan(2)["changed"] != true {
		t.Fatal("policy change ignored")
	}
	fresh, _ = chat.GetAgentDraft(ctx, 1, "conv")
	if fresh.Status != "draft" || len(fresh.Missing) == 0 {
		t.Fatal("duration policy not enforced")
	}
	if err = chat.ClaimAgentDraft(ctx, 1, "conv", 3); err == nil {
		t.Fatal("invalid draft executed")
	}
	zero := int64(0)
	state, err = agents.SaveAgentPolicy(ctx, state.Current.Version, p, &zero)
	if err != nil {
		t.Fatal(err)
	}
	if state.Current.Version != 2 || state.Current.MaxDuration != 600 || len(state.History) != 2 {
		t.Fatal("rollback did not create a new version")
	}
	if err = agents.Upsert(ctx, service.AgentUpsertInput{Code: "general_creative_agent", Name: "Agent", RuntimeConfig: map[string]interface{}{"video_model_code": "twelve", "agent_policy": map[string]interface{}{"version": 999}}, PriceRule: map[string]interface{}{"billing_type": "model_actual"}, IsEnabled: true}); err != nil {
		t.Fatal(err)
	}
	state, err = agents.GetAgentPolicy(ctx)
	if err != nil || state.Current.Version != 2 {
		t.Fatalf("ordinary save overwrote policy: %v %#v", err, state)
	}
	if w := request("/agents/general_creative_agent/policy", "PUT", `{"base_version":2,"policy":{"confirmed":false}}`); w.Code == 200 {
		t.Fatal("hard guard exposed as policy")
	}
	if err = chat.AppendConversationMessage(ctx, 1, "conv", "user", "请保留主人公小满"); err != nil {
		t.Fatal(err)
	}
	if err = chat.AppendConversationMessage(ctx, 1, "conv", "assistant", `{"intent":"chat","reply":"故事正文"}`); err != nil {
		t.Fatal(err)
	}
	messages, _, err := chat.AgentContext(ctx, 1, "conv", "改成16秒", service.DefaultAgentPolicy())
	if err != nil {
		t.Fatal(err)
	}
	joined := ""
	for _, m := range messages {
		joined += m.Content
	}
	if !strings.Contains(joined, "小满") || !strings.Contains(joined, "故事正文") || messages[len(messages)-1].Content != "改成16秒" {
		t.Fatal("database memory not restored")
	}
	if _, _, err = chat.AgentContext(ctx, 2, "conv", "test", p); err == nil {
		t.Fatal("cross-user memory read")
	}
	// Reproduce the latest user's prompt-only correction through the real draft
	// persistence/finalization path, not just the text classifier.
	_, err = pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id) VALUES ('prompt-edit',1); INSERT INTO models(code,category,request_mode,input_schema) VALUES ('chat','chat','chat_completions','{}')`)
	if err != nil {
		t.Fatal(err)
	}
	editDraft, err := chat.BeginAgentDraftTurn(ctx, 1, "prompt-edit", 0)
	if err != nil {
		t.Fatal(err)
	}
	editDraft.Slots = map[string]interface{}{"script": "既有故事", "character": "学生", "target_duration_sec": 14}
	editPlan, err := h.finalizeCreativeAgentDraft(ctx, 1, "prompt-edit", creativeAgentPlanRequest{Draft: editDraft, ModelCode: "chat"}, map[string]interface{}{
		"intent": "workflow", "action": "update", "reply": "真人短片提示词：开场发现失窃，结尾交代结果。",
	}, "帮我改成时长8秒 你现在只有文案，我需要完整的生成视频的提示词。不是文案")
	if err != nil {
		t.Fatal(err)
	}
	savedEdit, err := chat.GetAgentDraft(ctx, 1, "prompt-edit")
	if err != nil || savedEdit.Status != "draft" || editPlan["intent"] != "chat" || editPlan["needs_confirm"] != false || creativeAgentPositiveInt(savedEdit.Slots["target_duration_sec"]) != 8 {
		t.Fatalf("prompt editing did not stay in chat: %#v %v", savedEdit, err)
	}
	if err = chat.ClaimAgentDraft(ctx, 1, "prompt-edit", 0); err == nil {
		t.Fatal("old text confirmation was accepted")
	}
	if editPlan["artifact"] == nil {
		t.Fatal("completed prompt was not available for later media generation")
	}
	savedEdit.SlotIssues = map[string]string{"quality": "请选择支持的画质"}
	chatPlan, err := h.finalizeCreativeAgentDraft(ctx, 1, "prompt-edit", creativeAgentPlanRequest{Draft: savedEdit, Preview: true}, map[string]interface{}{"intent": "chat", "reply": "工作效率是投入时间与完成工作的关系。"}, "解释一下工作效率")
	if err != nil || chatPlan["intent"] != "chat" || chatPlan["needs_confirm"] != false {
		t.Fatalf("ordinary chat was blocked by old media parameters: %#v %v", chatPlan, err)
	}
	badDraft, err := chat.BeginAgentDraftTurn(ctx, 1, "prompt-edit", savedEdit.Version)
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.finalizeCreativeAgentDraft(ctx, 1, "prompt-edit", creativeAgentPlanRequest{Draft: badDraft}, map[string]interface{}{"intent": "video", "slot_updates": map[string]interface{}{"generation_prompt": "[场景描述]：[具体场景，如：办公室]"}}, "根据提示词生成8秒视频")
	if err != nil {
		t.Fatal(err)
	}
	badSaved, err := chat.GetAgentDraft(ctx, 1, "prompt-edit")
	if err != nil || badSaved.Slots["artifact_issue"] == nil || len(badSaved.Missing) == 0 {
		t.Fatalf("bad content not marked unready: %#v %v", badSaved, err)
	}
	preview, err := h.finalizeCreativeAgentDraft(ctx, 1, "prompt-edit", creativeAgentPlanRequest{Draft: badSaved, Preview: true}, map[string]interface{}{"intent": "video"}, "")
	if err != nil || preview["needs_confirm"] == true {
		t.Fatalf("model switching bypassed content gate: %#v %v", preview, err)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM tasks)+(SELECT count(*) FROM workflow_projects)`).Scan(&count); err != nil || count != 0 {
		t.Fatal("replanning created a paid task")
	}
}
