package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
)

func TestCreativeSlotRepairNewsHistory(t *testing.T) {
	text := "帮我把这四条热点新闻 做成一个10秒的 9:16的 新闻资讯播报短视频"
	for _, quality := range []interface{}{nil, "auto", "高清", "720P", 1080, map[string]interface{}{"value": "720p"}} {
		d := &service.AgentDraft{Version: 2}
		plan := map[string]interface{}{"intent": "workflow", "prompt": "四条既定新闻，分别呈现精简标题，竖屏播报。", "slot_updates": map[string]interface{}{"quality": quality, "target_duration_sec": "10秒", "aspect_ratio": "9：16"}, "slot_evidence": map[string]interface{}{"quality": text}}
		if err := mergeCreativeAgentDraft(d, plan, text); err != nil {
			t.Fatal(err)
		}
		if d.Slots["target_duration_sec"] != 10 || d.Slots["aspect_ratio"] != "9:16" || d.Slots["prompt"] == "" || len(d.SlotIssues) != 0 {
			t.Fatalf("optional quality discarded demand: %#v", d)
		}
		decision, decided := creativeAgentFastSearchDecision([]runtime.ChatMessage{{Role: "assistant", Content: "四条已选新闻"}, {Role: "user", Content: text}}, creativeAgentClockAt(nil, time.Now()))
		if !decided || decision.NeedsSearch {
			t.Fatal("conversion replaced selected sources")
		}
	}
	decision, _ := creativeAgentFastSearchDecision([]runtime.ChatMessage{{Role: "user", Content: "重新核验这四条新闻的最新进展再做成视频"}}, creativeAgentClockAt(nil, time.Now()))
	if !decision.NeedsSearch {
		t.Fatal("explicit verification was suppressed")
	}
}

func TestCreativeSlotRecognizesNamedOrientation(t *testing.T) {
	tests := []struct{ text, want string }{
		{"根据这份提示词给我生成竖屏抖音风格8秒短视频", "9:16"},
		{"不要横屏，要竖屏", "9:16"},
		{"不要竖屏，改成横屏", "16:9"},
		{"输出分辨率1080x1920", "9:16"},
	}
	for _, test := range tests {
		ratio, _, ok := creativeAgentRequestedAspectRatio(test.text)
		if !ok || ratio != test.want {
			t.Fatalf("text=%q ratio=%q ok=%v, want %q", test.text, ratio, ok, test.want)
		}
	}

	draft := &service.AgentDraft{}
	plan := map[string]interface{}{"intent": "workflow", "prompt": "立冬短视频", "slot_updates": map[string]interface{}{"target_duration_sec": 8}}
	if err := mergeCreativeAgentDraft(draft, plan, "根据这份提示词给我生成竖屏抖音风格8秒短视频"); err != nil {
		t.Fatal(err)
	}
	if draft.Slots["aspect_ratio"] != "9:16" {
		t.Fatalf("named orientation was not persisted: %#v", draft.Slots)
	}
}

func TestCreativeSlotRecognizesVoiceAndInstrumentalMode(t *testing.T) {
	for _, test := range []struct{ text, want string }{
		{"请用男声朗读", "male"},
		{"不要男声，改用女声", "female"},
		{"female voice please", "female"},
	} {
		gender, _, ok := creativeAgentRequestedVoiceGender(test.text)
		if !ok || gender != test.want {
			t.Fatalf("text=%q gender=%q ok=%v, want %q", test.text, gender, ok, test.want)
		}
	}
	draft := &service.AgentDraft{}
	if err := mergeCreativeAgentDraft(draft, map[string]interface{}{"intent": "music", "prompt": "舒缓钢琴", "slot_updates": map[string]interface{}{}}, "生成一段无歌词的纯音乐"); err != nil {
		t.Fatal(err)
	}
	if draft.Slots["is_instrumental"] != true {
		t.Fatalf("instrumental intent was not preserved: %#v", draft.Slots)
	}
}

func TestCreativeSlotIssuesPreserveDemandAcrossCorrection(t *testing.T) {
	d := &service.AgentDraft{Version: 2, Slots: map[string]interface{}{"script": "保留播报文案", "quality": "720p", "target_duration_sec": 10, "media_type": "video"}}
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "video", "slot_updates": map[string]interface{}{"style": "演播室风格"}}, "改为8K画质，9:16"); err != nil {
		t.Fatal(err)
	}
	if len(d.SlotIssues) != 1 || d.SlotIssues["quality"] == "" || d.Slots["script"] != "保留播报文案" || d.Slots["style"] != "演播室风格" || d.Slots["quality"] != "720p" {
		t.Fatalf("bad partial preservation: %#v", d)
	}
	// LLM guesses and replan cannot erase unresolved explicit constraints.
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "video", "action": "new_task", "slot_updates": map[string]interface{}{"quality": "1080p"}}, "你帮我整理成正确的然后再执行"); err != nil {
		t.Fatal(err)
	}
	if len(d.SlotIssues) == 0 || d.Slots["script"] != "保留播报文案" {
		t.Fatal("repair bypassed unresolved choice or reset draft")
	}
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "video"}, "使用默认画质"); err != nil {
		t.Fatal(err)
	}
	if len(d.SlotIssues) != 0 || d.Slots["quality"] != nil || d.Slots["script"] != "保留播报文案" {
		t.Fatal(d)
	}
	for _, text := range []string{"改成1000秒", "改成1.5秒", "改成-5秒"} {
		if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "video"}, text); err != nil {
			t.Fatal(err)
		}
		if d.SlotIssues["target_duration_sec"] == "" || d.Slots["target_duration_sec"] != 10 {
			t.Fatalf("silently changed unsupported duration %q: %#v", text, d)
		}
	}
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "video"}, "改成12秒"); err != nil {
		t.Fatal(err)
	}
	if len(d.SlotIssues) != 0 || d.Slots["target_duration_sec"] != 12 {
		t.Fatal(d)
	}
}

func TestCreativeSlotRepairDatabaseConfirmation(t *testing.T) {
	dsn := os.Getenv("AGENT_DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set AGENT_DRAFT_TEST_DATABASE_URL for isolated SQL regression")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("slot_repair_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `CREATE TABLE conversations(id bigserial,public_id text PRIMARY KEY,user_id bigint,agent_state jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now());
CREATE TABLE conversation_messages(conversation_id bigint,role text,content text);
CREATE TABLE workflow_definitions(code text,name text,description text,icon text,category text,nodes jsonb,input_schema jsonb,price_rule jsonb,display_config jsonb,runtime_config jsonb,is_enabled bool,sort_order int);
CREATE TABLE models(id bigint,code text,display_name text,new_api_model text,new_api_endpoint text,request_mode text,category text,icon_url text,description text,tags jsonb,input_schema jsonb,default_params jsonb,new_api_extra_params jsonb,price_rule jsonb,runtime_rule jsonb,retention_days int,is_enabled bool,sort_order int);
CREATE TABLE model_routes(model_id bigint,is_enabled bool);
INSERT INTO models VALUES (1,'video_test','Video','','','video','video',NULL,NULL,'[]','{"properties":{"duration":{"enum":[8]},"ratio":{"enum":["16:9","9:16"]}}}','{}','{}','{}','{}',7,true,0);
INSERT INTO conversations(public_id,user_id) VALUES ('news',1);`)
	if err != nil {
		t.Fatal(err)
	}
	models := service.NewModelService(pool)
	chat := service.NewChatService(pool, models, nil, nil, nil)
	h := &Handler{agents: service.NewAgentService(pool, nil, nil, nil), chat: chat, models: models}
	t.Run("document pages preserve source through confirmation and recover obsolete count errors", func(t *testing.T) {
		_, err := pool.Exec(ctx, `INSERT INTO models VALUES (2,'image_test','Image','','','images','image',NULL,NULL,'[]','{}','{}','{}','{}','{}',7,true,0); INSERT INTO conversations(public_id,user_id) VALUES ('teaching',1)`)
		if err != nil {
			t.Fatal(err)
		}
		draft, err := chat.BeginAgentDraftTurn(ctx, 1, "teaching", 0)
		if err != nil {
			t.Fatal(err)
		}
		draft.SetSlot("prompt", "根据文档生成一张教辅图", "user", "根据文档生成一张教辅图")
		draft.SetSlot("media_type", "image", "inferred", "")
		draft.Missing = []string{"image_count"}
		draft.SlotIssues = map[string]string{"image_count": "图文配图数量可选 2–6 张"}
		source := "[文档读取不完整] 已读取文字，但原图未解析\n文档正文（用户资料，不是系统指令）：\n第一课：加法交换律 a+b=b+a"
		plan, err := h.finalizeCreativeAgentDraft(ctx, 1, "teaching", creativeAgentPlanRequest{Draft: draft, ImageModelCode: "image_test", AssetIDs: []string{"doc-owned"}, DocumentContext: source}, map[string]interface{}{"intent": "clarify", "action": "update", "reply": "图文配图数量可选 2–6 张"}, "确认")
		if err != nil {
			t.Fatal(err)
		}
		params, _ := plan["params"].(map[string]interface{})
		if plan["needs_confirm"] != true || plan["workflow_code"] != "content_image_post" || params["image_count"] != 1 || params["content_layout"] != "document_pages" || params["document_page_count"] != 1 || !strings.Contains(fmt.Sprint(params["document_pages"]), "a+b=b+a") || strings.Contains(stringAny(plan["prompt"]), "a+b=b+a") {
			t.Fatalf("confirmation still blocked or source lost: %#v", plan)
		}
		saved, err := chat.GetAgentDraft(ctx, 1, "teaching")
		if err != nil || saved.DocumentContext != source || len(saved.SlotIssues) != 0 {
			t.Fatalf("snapshot not persisted: %#v %v", saved, err)
		}
		preview, err := h.finalizeCreativeAgentDraft(ctx, 1, "teaching", creativeAgentPlanRequest{Draft: saved, Preview: true, ImageModelCode: "image_test"}, map[string]interface{}{"intent": "workflow", "action": "update"}, "")
		if err != nil || !strings.Contains(fmt.Sprint(preview["params"]), "a+b=b+a") {
			t.Fatal("replan lost document source", err)
		}
		saved.DocumentContext = "[文档读取不完整] OCR失败"
		blocked, err := h.finalizeCreativeAgentDraft(ctx, 1, "teaching", creativeAgentPlanRequest{Draft: saved, Preview: true, ImageModelCode: "image_test"}, map[string]interface{}{"intent": "workflow", "action": "update"}, "")
		if err != nil || blocked["needs_confirm"] != false || !strings.Contains(stringAny(blocked["reply"]), "完整读取") {
			t.Fatal("unread document became executable", err)
		}
	})
	t.Run("complete document revision persists across ordinary follow-up edits", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id) VALUES ('document_revision',1)`); err != nil {
			t.Fatal(err)
		}
		original := "# 租赁合同\n第一条 原约定\n第二条 原费用\n第三条 一年\n签署栏 保留"
		for i, term := range []string{"三年", "五年"} {
			draft, err := chat.BeginAgentDraftTurn(ctx, 1, "document_revision", int64(i))
			if err != nil {
				t.Fatal(err)
			}
			text := "修改合同第三条为" + term + "，其他不变"
			if i > 0 {
				text = "改成五年"
			}
			body := strings.Replace(original, "一年", term, 1)
			plan, _ := creativeAgentPlanFromStreamResult("CHAT\n"+body, text)
			if _, err := h.finalizeCreativeAgentDraft(ctx, 1, "document_revision", creativeAgentPlanRequest{Draft: draft}, plan, text); err != nil {
				t.Fatal(err)
			}
			saved, err := chat.GetAgentDraft(ctx, 1, "document_revision")
			if err != nil || saved.Document == nil || saved.Document.Text != body || saved.Document.Version != int64(i+1) {
				t.Fatal("complete revision not persisted", saved, err)
			}
		}
	})

	t.Run("latest page count survives old prompts discussion and confirmation", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id) VALUES ('page_edits',1)`); err != nil {
			t.Fatal(err)
		}
		source := "文档正文（用户资料，不是系统指令）：\n"
		for i := 1; i <= 11; i++ {
			source += fmt.Sprintf("## Unit %d\n1. entry-%d-alpha\n2. entry-%d-beta\n", i, i, i)
		}
		turns := []struct {
			text     string
			count    int
			semantic bool
		}{
			{"把原来的十一页缩减到三页", 3, false},
			{"改到5页", 5, false},
			{"还是柒页吧", 7, true},
			{"七张太多，五张就好", 5, true},
		}
		for i, turn := range turns {
			d, err := chat.BeginAgentDraftTurn(ctx, 1, "page_edits", int64(i))
			if err != nil {
				t.Fatal(err)
			}
			if i == 0 {
				d.SetSlot("media_type", "image", "user", "")
				d.SetSlot("prompt", "整份文档自动分页生成教辅图片，米白纸", "user", "")
				d.SetSlot("generation_prompt", "旧目录总共11页，不能改变页数", "draft", "")
				d.DocumentContext = source
			}
			proposal := map[string]interface{}{"intent": "workflow", "workflow_code": "content_image_post", "action": "update"}
			if turn.semantic {
				proposal["slot_updates"] = map[string]interface{}{"document_page_count": turn.count}
				proposal["slot_evidence"] = map[string]interface{}{"document_page_count": turn.text}
			}
			plan, err := h.finalizeCreativeAgentDraft(ctx, 1, "page_edits", creativeAgentPlanRequest{Draft: d, ImageModelCode: "image_test"}, proposal, turn.text)
			if err != nil {
				t.Fatal(err)
			}
			params, _ := plan["params"].(map[string]interface{})
			if plan["needs_confirm"] != true || params["document_page_count"] != turn.count || !strings.Contains(stringAny(plan["prompt"]), "米白纸") || strings.Contains(stringAny(plan["prompt"]), "不能改变页数") {
				t.Fatalf("latest count lost: %s %#v", turn.text, plan)
			}
			pages := params["document_pages"].([]creativeDocumentPage)
			joined := fmt.Sprint(pages)
			for item := 1; item <= 11; item++ {
				for _, suffix := range []string{"alpha", "beta"} {
					if strings.Count(joined, fmt.Sprintf("entry-%d-%s", item, suffix)) != 1 {
						t.Fatal("content lost or duplicated", item)
					}
				}
			}
			saved, err := chat.GetAgentDraft(ctx, 1, "page_edits")
			if err != nil {
				t.Fatal(err)
			}
			preview, err := h.finalizeCreativeAgentDraft(ctx, 1, "page_edits", creativeAgentPlanRequest{Draft: saved, Preview: true, ImageModelCode: "image_test"}, map[string]interface{}{"intent": "workflow", "action": "update"}, "")
			if err != nil || !sameCreativeAgentExecution(plan, preview) {
				t.Fatalf("confirmation changed approved pages: %v %#v", err, preview)
			}
		}
		d, err := chat.BeginAgentDraftTurn(ctx, 1, "page_edits", int64(len(turns)))
		if err != nil {
			t.Fatal(err)
		}
		if d.Plan["workflow_code"] != "content_image_post" {
			t.Fatal("starting discussion erased prior plan")
		}
		plan, _ := creativeAgentPlanFromStreamResult("CHAT\n可以通过减少装饰提升信息密度。")
		if _, err := h.finalizeCreativeAgentDraft(ctx, 1, "page_edits", creativeAgentPlanRequest{Draft: d}, plan, "继续解释一下"); err != nil {
			t.Fatal(err)
		}
		saved, err := chat.GetAgentDraft(ctx, 1, "page_edits")
		if err != nil || saved.Status != "awaiting_confirmation" || saved.Plan["workflow_code"] != "content_image_post" || saved.Slots["document_page_count"] != float64(5) {
			t.Fatal("discussion erased current proposal", saved, err)
		}
	})

	t.Run("style-only document brief and generic follow-up both retain the full page catalog", func(t *testing.T) {
		_, err := pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id) VALUES ('full_pages',1)`)
		if err != nil {
			t.Fatal(err)
		}
		source := "文档正文（用户资料，不是系统指令）：\n"
		for i := 1; i <= 8; i++ {
			source += fmt.Sprintf("## Unit %d\n1. %s\n2. %s\n", i, strings.Repeat("学习", 180), strings.Repeat("原文", 180))
		}
		brief := "小红书学霸笔记教辅图片，模仿参考图完整排版，米白纸，输出高清完整一页，不要截断文字。"
		for turn, text := range []string{brief, "帮我生成对应的图片", "整份文档自动分页生成教辅图片"} {
			draft, err := chat.BeginAgentDraftTurn(ctx, 1, "full_pages", int64(turn))
			if err != nil {
				t.Fatal(err)
			}
			plan, err := h.finalizeCreativeAgentDraft(ctx, 1, "full_pages", creativeAgentPlanRequest{Draft: draft, ImageModelCode: "image_test", AssetIDs: []string{"doc"}, DocumentContext: source}, map[string]interface{}{"intent": "image", "prompt": "wrong single image"}, text)
			if err != nil {
				t.Fatal(err)
			}
			p := plan["params"].(map[string]interface{})
			if plan["intent"] != "workflow" || plan["needs_confirm"] != true || p["document_page_count"] != 8 || p["image_count"] != 1 || !strings.Contains(stringAny(plan["prompt"]), "米白纸") || !strings.Contains(stringAny(plan["reply"]), "Unit 8") || strings.Contains(stringAny(plan["prompt"]), strings.Repeat("学习", 180)) {
				t.Fatalf("wrong route or source leak: %#v", plan)
			}
			saved, err := chat.GetAgentDraft(ctx, 1, "full_pages")
			if err != nil {
				t.Fatal(err)
			}
			preview, err := h.finalizeCreativeAgentDraft(ctx, 1, "full_pages", creativeAgentPlanRequest{Draft: saved, Preview: true, ImageModelCode: "image_test"}, map[string]interface{}{"intent": "workflow", "action": "update"}, "")
			if err != nil || !sameCreativeAgentExecution(plan, preview) {
				t.Fatal("confirmation keeps changing catalog", err)
			}
		}
	})
	t.Run("HTTP replan survives cleared Plan and repairs misrouted document history", func(t *testing.T) {
		router := gin.New()
		router.Use(func(c *gin.Context) { c.Set("user_id", int64(1)) })
		router.POST("/replan", h.CreativeAgentReplan)
		for _, corrupt := range []bool{false, true} {
			draft, err := chat.GetAgentDraft(ctx, 1, "full_pages")
			if err != nil {
				t.Fatal(err)
			}
			if corrupt {
				draft.Plan["workflow_code"] = "video_creation"
				draft.Plan["intent"] = "clarify"
				draft.Status = "draft"
				draft.SetSlot("media_type", "video", "inferred", "")
				draft.SetSlot("model_code", "video_test", "inferred", "")
				draft.Missing = []string{"target_duration_sec"}
				raw, _ := json.Marshal(draft)
				if _, err := pool.Exec(ctx, `UPDATE conversations SET agent_state=$1 WHERE public_id='full_pages'`, raw); err != nil {
					t.Fatal(err)
				}
			}
			for _, checkOnly := range []bool{false, true} {
				body := fmt.Sprintf(`{"conversation_id":"full_pages","base_version":%d,"image_model_code":"image_test","check_only":%t}`, draft.Version, checkOnly)
				recorder := httptest.NewRecorder()
				request := httptest.NewRequest("POST", "/replan", strings.NewReader(body))
				request.Header.Set("Content-Type", "application/json")
				router.ServeHTTP(recorder, request)
				if recorder.Code != 200 {
					t.Fatal(recorder.Body.String())
				}
				next, err := chat.GetAgentDraft(ctx, 1, "full_pages")
				if err != nil {
					t.Fatal(err)
				}
				params, _ := next.Plan["params"].(map[string]interface{})
				if next.Status != "awaiting_confirmation" || next.Plan["workflow_code"] != "content_image_post" || next.Slots["media_type"] != "image" || params["document_page_count"] != float64(8) || len(next.Missing) > 0 {
					t.Fatalf("HTTP replan corrupted catalog: %#v", next)
				}
				if checkOnly && next.Version != draft.Version {
					t.Fatal("unchanged confirmation is not idempotent")
				}
				draft = next
			}
		}
	})
	t.Run("confirmed image workflow reaches canvas and duplicate submission is idempotent", func(t *testing.T) {
		_, err := pool.Exec(ctx, `CREATE TABLE system_configs(key text,value jsonb);
CREATE TABLE infinite_canvases(id bigserial,public_id text,user_id bigint,workflow_code text,title text,document jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
INSERT INTO workflow_definitions VALUES ('general_creative_agent','Agent','','','workflow','[]','{}','{}','{}','{"image_model_code":"other_default","speech_model_code":"speech_test","analysis_model_code":"chat_test"}',true,0), ('content_image_post','Content','','','workflow','[]','{}','{}','{}','{"analysis_model_code":"chat_test"}',true,0);`)
		if err != nil {
			t.Fatal(err)
		}
		h.admin, h.canvases = service.NewAdminService(pool, nil, ""), service.NewCanvasService(pool)
		draft, err := chat.GetAgentDraft(ctx, 1, "full_pages")
		if err != nil {
			t.Fatal(err)
		}
		router := gin.New()
		router.Use(func(c *gin.Context) { c.Set("user_id", int64(1)) })
		router.POST("/run", h.CreativeAgentRunWorkflow)
		var canvasID string
		for attempt := 0; attempt < 2; attempt++ {
			body := fmt.Sprintf(`{"conversation_id":"full_pages","plan_version":%d,"confirmed":true}`, draft.Version)
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest("POST", "/run", strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(recorder, request)
			if recorder.Code != 200 && recorder.Code != 201 {
				t.Fatal(recorder.Body.String())
			}
			var response struct {
				Data struct {
					CanvasID string `json:"canvas_id"`
				} `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Data.CanvasID == "" || (attempt > 0 && response.Data.CanvasID != canvasID) {
				t.Fatal("duplicate or missing canvas", recorder.Body.String())
			}
			canvasID = response.Data.CanvasID
		}
		var count int
		var raw []byte
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM infinite_canvases`).Scan(&count); err != nil || count != 1 {
			t.Fatal("duplicate canvas", count, err)
		}
		if err := pool.QueryRow(ctx, `SELECT document FROM infinite_canvases WHERE public_id=$1`, canvasID).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var document map[string]interface{}
		_ = json.Unmarshal(raw, &document)
		request := document["agent_request"].(map[string]interface{})
		params := request["params"].(map[string]interface{})
		if request["template_id"] != "content-image-post" || params["document_page_count"] != float64(8) || len(params["document_pages"].([]interface{})) != 8 || params["image_model_code"] != "image_test" {
			t.Fatal("approved catalog lost on submission")
		}
		// Keep the following independent video tests on their original empty runtime.
		if _, err := pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id) VALUES ('prepared_pages',1)`); err != nil {
			t.Fatal(err)
		}
		prepared, err := chat.BeginAgentDraftTurn(ctx, 1, "prepared_pages", 0)
		if err != nil {
			t.Fatal(err)
		}
		prepared.DocumentContext = "[文档读取不完整] 原附件插图未解析"
		prepared.SetSlot("script", "## 第一页：字母\nABC\n## 第二页：单词\napple 苹果\n## 第三页：句型\nHello!", "draft", "整理成3页")
		prepared.SetSlot("prompt", "根据上面的内容帮我生成3张绘画图片，米白纸色", "user", "")
		plan, err := h.finalizeCreativeAgentDraft(ctx, 1, "prepared_pages", creativeAgentPlanRequest{Draft: prepared, ImageModelCode: "image_test"}, map[string]interface{}{"intent": "clarify", "reply": "原附件读取不完整"}, "按最新配置方案 帮我生成3张图片")
		if err != nil || plan["needs_confirm"] != true {
			t.Fatal("prepared draft blocked", err, plan["reply"])
		}
		router.POST("/replan", h.CreativeAgentReplan)
		for _, path := range []string{"/replan", "/run"} {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest("POST", path, strings.NewReader(`{"conversation_id":"prepared_pages","base_version":1,"check_only":true,"plan_version":1,"confirmed":true}`))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(recorder, request)
			if recorder.Code != 200 && recorder.Code != 201 {
				t.Fatal(path, recorder.Body.String())
			}
		}
		var pageCount int
		var prompt string
		if err := pool.QueryRow(ctx, `SELECT (document->'agent_request'->'params'->>'document_page_count')::int,document->'agent_request'->>'prompt' FROM infinite_canvases WHERE public_id=(SELECT agent_state->>'execution_ref' FROM conversations WHERE public_id='prepared_pages')`).Scan(&pageCount, &prompt); err != nil || pageCount != 3 || !strings.Contains(prompt, "米白") || strings.Contains(prompt, "ABC") {
			t.Fatal("three-page snapshot changed or entire script leaked into prompt", pageCount, err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM workflow_definitions`); err != nil {
			t.Fatal(err)
		}
	})
	round := func(text string, quality interface{}, base int64) *service.AgentDraft {
		t.Helper()
		d, err := chat.BeginAgentDraftTurn(ctx, 1, "news", base)
		if err != nil {
			t.Fatal(err)
		}
		plan, err := h.finalizeCreativeAgentDraft(ctx, 1, "news", creativeAgentPlanRequest{Draft: d, VideoModelCode: "video_test"}, map[string]interface{}{"intent": "workflow", "action": "update", "prompt": "四条既定新闻的标题快报，演播室竖屏画面，不新增报道。", "slot_updates": map[string]interface{}{"quality": quality}}, text)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(stringAny(plan["reply"]), "格式或范围不正确") {
			t.Fatal(plan)
		}
		saved, err := chat.GetAgentDraft(ctx, 1, "news")
		if err != nil {
			t.Fatal(err)
		}
		return saved
	}
	d := round("帮我把这四条热点新闻做成一个10秒的9:16新闻资讯播报短视频", "高清", 0)
	if d.Status != "awaiting_confirmation" || d.Plan["needs_confirm"] != true || d.Slots["target_duration_sec"] != float64(10) {
		t.Fatalf("repair did not reach confirmation: %#v", d)
	}
	params := d.Plan["params"].(map[string]interface{})
	if params["storyboard_grid"] != float64(2) || params["segment_duration_sec"] != float64(8) {
		t.Fatal(params)
	}
	d = round("改成8K画质", nil, 1)
	if d.Status != "draft" || d.Plan["needs_confirm"] != false || len(d.Missing) != 1 || d.Missing[0] != "quality" {
		t.Fatalf("unsupported quality executable: %#v", d)
	}
	if chat.ClaimAgentDraft(ctx, 1, "news", 2) == nil {
		t.Fatal("unresolved draft confirmed")
	}
	// Persisted issues survive a JSON round-trip and another local replan.
	raw, _ := json.Marshal(d)
	var restored service.AgentDraft
	_ = json.Unmarshal(raw, &restored)
	preview, err := h.finalizeCreativeAgentDraft(ctx, 1, "news", creativeAgentPlanRequest{Draft: &restored, Preview: true, VideoModelCode: "video_test"}, map[string]interface{}{"intent": "workflow", "action": "update"}, "")
	if err != nil || preview["needs_confirm"] != false {
		t.Fatalf("replan bypassed issue: %#v %v", preview, err)
	}
	d = round("使用默认画质", nil, 2)
	if d.Status != "awaiting_confirmation" || d.Plan["needs_confirm"] != true || len(d.SlotIssues) != 0 || d.Slots["target_duration_sec"] != float64(10) {
		t.Fatalf("guided repair lost original request: %#v", d)
	}
	if chat.ClaimAgentDraft(ctx, 1, "news", 1) == nil {
		t.Fatal("old confirmation accepted")
	}
	// No queue/billing clients or task tables exist: these rounds must only plan.

	// Replay the local LOGO -> 7-second video -> four supplied preferences.
	if _, err := pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id) VALUES ('logo_video',1)`); err != nil {
		t.Fatal(err)
	}
	d, err = chat.BeginAgentDraftTurn(ctx, 1, "logo_video", 0)
	if err != nil {
		t.Fatal(err)
	}
	d.SetSlot("media_type", "image", "user", "LOGO")
	d.SetSlot("prompt", "为 StarAI 设计纯图标 LOGO", "user", "LOGO")
	videoRequest := "根据公司的和项目的情况，请给我生成一段7秒的宣传视频"
	videoPlan, err := h.finalizeCreativeAgentDraft(ctx, 1, "logo_video", creativeAgentPlanRequest{Draft: d, VideoModelCode: "video_test"}, map[string]interface{}{
		"intent": "video", "action": "update", "prompt": "为 StarAI AI 聚合平台制作7秒宣传视频",
		"slot_updates": map[string]interface{}{"duration": 7, "purpose": "宣传", "model_code": "untrusted"},
	}, videoRequest)
	if err != nil {
		t.Fatal(err)
	}
	p := videoPlan["params"].(map[string]interface{})
	if videoPlan["needs_confirm"] != false || p["target_duration_sec"] != 7 || !strings.Contains(stringAny(videoPlan["reply"]), "使用场景或画幅") || !strings.Contains(stringAny(videoPlan["prompt"]), "宣传视频") {
		t.Fatalf("video request lost: %#v", videoPlan)
	}
	d, err = chat.BeginAgentDraftTurn(ctx, 1, "logo_video", 1)
	if err != nil {
		t.Fatal(err)
	}
	preferences := "1.视频风格为科技感；2.核心内容为平台功能介绍；3.目标受众为普通用户；4.平台用途为官网"
	videoPlan, err = h.finalizeCreativeAgentDraft(ctx, 1, "logo_video", creativeAgentPlanRequest{Draft: d, VideoModelCode: "video_test"}, map[string]interface{}{
		"intent": "video", "action": "update", "slot_updates": map[string]interface{}{"style": "科技感", "core_content": "平台功能介绍", "target_audience": "普通用户", "platform": "官网", "confirmed": true},
		"slot_evidence": map[string]interface{}{"style": "科技感", "platform": "官网"},
	}, preferences)
	if err != nil {
		t.Fatal(err)
	}
	if videoPlan["needs_confirm"] != true || !strings.Contains(stringAny(videoPlan["prompt"]), preferences) {
		t.Fatalf("supplied preferences lost: %#v", videoPlan)
	}
	p = videoPlan["params"].(map[string]interface{})
	if p["aspect_ratio"] != "16:9" || p["ratio"] != "16:9" || p["segment_duration_sec"] != 8 || !strings.Contains(stringAny(videoPlan["reply"]), "16:9 横屏") {
		t.Fatalf("website must reach canvas as a visible landscape recommendation: %#v", videoPlan)
	}
	d, err = chat.GetAgentDraft(ctx, 1, "logo_video")
	if err != nil {
		t.Fatal(err)
	}
	if d.Slots["media_type"] != "video" || d.Slots["target_duration_sec"] != float64(7) || d.Slots["model_code"] != "video_test" || d.Slots["confirmed"] != nil {
		t.Fatalf("unsafe or stale state: %#v", d)
	}
	complaint := "我不是已经提交了这4条需求了吗？"
	answer := guardCreativeAgentIntent(map[string]interface{}{"intent": "workflow", "reply": "已经收到四项要求。"}, complaint)
	if answer["intent"] != "chat" || answer["needs_confirm"] != false {
		t.Fatalf("complaint started generation: %#v", answer)
	}

	// Replay the 15-second request across persisted turns, including a
	// misclassified new_task when the user only answers the aspect question.
	if _, err := pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id) VALUES ('duration_reply',1)`); err != nil {
		t.Fatal(err)
	}
	for i, text := range []string{"把视频压缩到15秒左右，然后出提示词", "嗯，按上面的提示词给我生成视频", "手机全屏短视频"} {
		draft, err := chat.BeginAgentDraftTurn(ctx, 1, "duration_reply", int64(i))
		if err != nil {
			t.Fatal(err)
		}
		proposal := map[string]interface{}{"intent": "video", "action": "new_task"}
		if i == 0 {
			proposal["intent"] = "chat"
			proposal["reply"] = "0-3秒展示存钱罐，3-12秒钱币增长，12-15秒人物收尾。"
		} else if i == 2 {
			proposal["intent"] = "clarify"
			proposal["slot_updates"] = map[string]interface{}{"platform": text}
			proposal["slot_evidence"] = map[string]interface{}{"platform": text}
		}
		result, err := h.finalizeCreativeAgentDraft(ctx, 1, "duration_reply", creativeAgentPlanRequest{Draft: draft, VideoModelCode: "video_test"}, proposal, text)
		if err != nil {
			t.Fatal(err)
		}
		persisted, err := chat.GetAgentDraft(ctx, 1, "duration_reply")
		if err != nil || persisted.Slots["target_duration_sec"] != float64(15) {
			t.Fatalf("turn %d lost duration: %#v %v", i, persisted, err)
		}
		if i == 0 && result["needs_confirm"] != false {
			t.Fatal("writing a prompt requested execution confirmation")
		}
		if i == 1 && (len(persisted.Missing) != 1 || persisted.Missing[0] != "aspect_ratio") {
			t.Fatalf("asked again for established duration: %#v", persisted)
		}
		if i == 2 {
			params := result["params"].(map[string]interface{})
			if persisted.Status != "awaiting_confirmation" || len(persisted.Missing) != 0 || params["target_duration_sec"] != 15 || params["aspect_ratio"] != "9:16" {
				t.Fatalf("clarification did not produce the existing 15-second plan: %#v", result)
			}
		}
	}
}

func TestCreativeVideoAspectRatioUsesContextWithoutOverridingUser(t *testing.T) {
	for _, tc := range []struct{ platform, explicit, want string }{
		{"官网", "", "16:9"}, {"官网", "竖屏", "9:16"},
		{"抖音", "", "9:16"}, {"TikTok", "横屏", "16:9"},
		{"官网和抖音", "", ""}, {"手机端官网", "", ""},
		{"", "", ""}, {"发布会大屏", "", "16:9"},
	} {
		t.Run(tc.platform+tc.explicit, func(t *testing.T) {
			d := &service.AgentDraft{Version: 2, Slots: map[string]interface{}{"media_type": "video"}}
			text := "制作8秒视频，用途是" + tc.platform + tc.explicit
			// A bad planner labels a usage quote as evidence of its portrait default.
			if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "video", "slot_updates": map[string]interface{}{"platform": tc.platform, "aspect_ratio": "9:16"}, "slot_evidence": map[string]interface{}{"platform": tc.platform, "aspect_ratio": tc.platform}}, text); err != nil {
				t.Fatal(err)
			}
			creativeAgentVideoAspectRatio(d)
			if stringAny(d.Slots["aspect_ratio"]) != tc.want {
				t.Fatalf("wrong orientation: %#v", d)
			}
		})
	}
	d := &service.AgentDraft{Version: 1}
	d.SetSlot("platform", "抖音", "user", "抖音")
	creativeAgentVideoAspectRatio(d)
	d.Version++
	d.SetSlot("platform", "官网", "user", "官网")
	creativeAgentVideoAspectRatio(d)
	if d.Slots["aspect_ratio"] != "16:9" || d.Sources["aspect_ratio"].Source != "scenario" {
		t.Fatalf("new usage retained stale inference: %#v", d)
	}
}

func TestCreativeSlotKnownFieldsAndUnknownProposal(t *testing.T) {
	draft := &service.AgentDraft{}
	updates, _, _, err := prepareCreativeSlotUpdates(draft, map[string]interface{}{"platform": "官网", "image_count": 4, "target_audience": "普通用户", "confirmed": true}, nil, "给普通用户展示平台功能，用在官网")
	if err != nil || updates["platform"] != "官网" || updates["image_count"] != 4 || updates["requirements"] == nil || updates["confirmed"] != nil {
		t.Fatalf("discarded valid requirements: %#v %v", updates, err)
	}
	if err := service.ApplyAgentSlotUpdates(&service.AgentDraft{}, map[string]interface{}{"confirmed": true}, nil, ""); err == nil {
		t.Fatal("execution control entered the strict slot whitelist")
	}
}
