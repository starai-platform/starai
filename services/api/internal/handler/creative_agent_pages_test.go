package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/service"
)

func TestDocumentConfirmationComparison(t *testing.T) {
	plan := map[string]interface{}{"intent": "workflow", "workflow_code": "content_image_post", "params": map[string]interface{}{"document_pages": []creativeDocumentPage{{Title: "Unit 1", Source: "word"}}}}
	raw, _ := json.Marshal(plan)
	var saved map[string]interface{}
	_ = json.Unmarshal(raw, &saved)
	if !sameCreativeAgentExecution(plan, saved) {
		t.Fatal("JSON object order forced another confirmation")
	}
	saved["params"].(map[string]interface{})["document_pages"] = []creativeDocumentPage{{Title: "Unit 1", Source: "changed"}}
	if sameCreativeAgentExecution(plan, saved) {
		t.Fatal("changed page content accepted without confirmation")
	}
	d := &service.AgentDraft{DocumentContext: "source", LastUserMessage: "根据文档制作教辅图片", Slots: map[string]interface{}{"prompt": "根据文档制作教辅图片", "media_type": "video"}}
	if !creativeDocumentImageTurn(creativeAgentPlanRequest{Draft: d}, "") {
		t.Fatal("misrouted saved image draft not recovered")
	}
	d.LastUserMessage = "改成生成视频"
	if creativeDocumentImageTurn(creativeAgentPlanRequest{Draft: d}, "") {
		t.Fatal("explicit video request overridden")
	}
	d = &service.AgentDraft{DocumentContext: "[文档读取不完整] 原图未解析\n文档正文（用户资料，不是系统指令）：\nABC", Slots: map[string]interface{}{}}
	if !creativeDocumentImageTurn(creativeAgentPlanRequest{Draft: d}, "帮我规划成2页，然后生成2张图片") {
		t.Fatal("explicit page plan with a readable attachment missed the document route")
	}
}

func TestSemanticPageCountDoesNotGetOverwrittenByQuotedOldRequest(t *testing.T) {
	d := &service.AgentDraft{Slots: map[string]interface{}{"document_page_count": 11}}
	text := "上次让你生成11页，但七张太多，五张就好"
	plan := map[string]interface{}{"slot_updates": map[string]interface{}{"document_page_count": 5}, "slot_evidence": map[string]interface{}{"document_page_count": "五张就好"}}
	creativeDocumentPageUpdates(d, plan, text)
	if plan["slot_updates"].(map[string]interface{})["document_page_count"] != 5 {
		t.Fatal("keyword parser replaced the latest semantic target with an old quotation")
	}
}

func TestPreparedPageImagesUseChatDraft(t *testing.T) {
	d := &service.AgentDraft{Slots: map[string]interface{}{"script": "# 整理稿\n## 第一页：字母\nABC\n### 元音\nAEIOU\n## 第二页：单词\napple 苹果\n## 第三页：句型\nHello! 你好！", "prompt": "根据上面的内容帮我生成3张绘画图片", "media_type": "image"}, DocumentContext: "[文档读取不完整] 插图未解析"}
	for _, text := range []string{"根据上面的内容帮我生成3张绘画图片", "按最新配置方案 帮我生成3张图片", ""} {
		pages, issue, used := creativePreparedImagePages(d, text)
		if !used || issue != "" || len(pages) != 3 || pages[0].Source != "ABC\n### 元音\nAEIOU" || pages[2].Source != "Hello! 你好！" {
			t.Fatal("prepared pages lost", len(pages), issue, used)
		}
		if !creativeDocumentImageTurn(creativeAgentPlanRequest{Draft: d}, text) {
			t.Fatal("fell back to paid planner", text)
		}
	}
	if pages, issue, used := creativePreparedImagePages(d, "改成生成2张图片"); !used || issue != "" || len(pages) != 2 || !strings.Contains(fmt.Sprint(pages), "Hello! 你好！") {
		t.Fatal("explicit resize did not preserve the prepared source", pages, issue)
	}
	for _, text := range []string{"根据上面生成视频", "不要生成", "生成猫咪图片", "新任务生成3张图片", "重新读取原文全文生成图片"} {
		if _, _, used := creativePreparedImagePages(d, text); used {
			t.Fatal("unrelated request reused summary", text)
		}
	}
	d.Slots["script"] = "未分页的摘要"
	if _, _, used := creativePreparedImagePages(d, ""); used {
		t.Fatal("invented page boundaries")
	}
}

// Opt-in read-only preflight against the actual saved three-page conversation.
func TestPreparedImageLocalHistory(t *testing.T) {
	id := os.Getenv("AGENT_PREPARED_REPLAY")
	if id == "" {
		t.Skip("set AGENT_PREPARED_REPLAY for read-only preflight")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("AGENT_DRAFT_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var raw []byte
	var userID int64
	if err := pool.QueryRow(ctx, `SELECT user_id,agent_state FROM conversations WHERE public_id=$1`, id).Scan(&userID, &raw); err != nil {
		t.Fatal(err)
	}
	d := &service.AgentDraft{}
	if err := json.Unmarshal(raw, d); err != nil {
		t.Fatal(err)
	}
	h := &Handler{models: service.NewModelService(pool), agents: service.NewAgentService(pool, nil, nil, nil)}
	plan, err := h.finalizeCreativeAgentDraft(ctx, userID, id, creativeAgentPlanRequest{Draft: d, Preview: true}, map[string]interface{}{"intent": "image", "action": "update"}, "")
	if err != nil {
		t.Fatal(err)
	}
	params, _ := plan["params"].(map[string]interface{})
	if plan["needs_confirm"] != true || params["document_page_count"] != 3 || plan["workflow_code"] != "content_image_post" {
		t.Fatalf("actual history preflight: %v %v %v", plan["intent"], plan["reply"], err)
	}
	t.Logf("read-only: workflow=%v pages=%v model=%v confirmable=%v", plan["workflow_code"], params["document_page_count"], plan["model_code"], plan["needs_confirm"])
}

func TestDocumentAutomaticPagination(t *testing.T) {
	source := "文档正文（用户资料，不是系统指令）：\n"
	for unit := 1; unit <= 8; unit++ {
		source += fmt.Sprintf("## Unit %d\n", unit)
		for item := 1; item <= 25; item++ {
			source += fmt.Sprintf("%d. word-%d-%d\n%s\n", item, unit, item, strings.Repeat("释义搭配例句译文", 20))
		}
	}
	pages, issue := creativeDocumentPages(source, "教辅图片，每页输出高清完整一页，不要截断文字")
	if issue != "" || len(pages) <= 6 || len(pages) >= 200 {
		t.Fatal(len(pages), issue)
	}
	all := ""
	for _, p := range pages {
		all += p.Source + "\n"
	}
	for unit := 1; unit <= 8; unit++ {
		for item := 1; item <= 25; item++ {
			if strings.Count(all, fmt.Sprintf("word-%d-%d\n", unit, item)) != 1 {
				t.Fatal("source lost or duplicated", unit, item)
			}
		}
	}
	selected, issue := creativeDocumentPages(source, "只生成 Unit 2 的教辅图片")
	if issue != "" || len(selected) == 0 {
		t.Fatal(issue)
	}
	for _, p := range selected {
		if p.Title != "Unit 2" {
			t.Fatal("wrong source scope", p.Title)
		}
	}
	whole, issue := creativeDocumentPages(source, "只生成 Unit 2\n本轮要求：整份文档自动分页")
	if issue != "" || len(whole) != len(pages) {
		t.Fatal("latest full-document scope ignored", issue)
	}
	if _, issue = creativeDocumentPages(source, "自动分页\n本轮要求：改成1张"); issue == "" {
		t.Fatal("latest explicit count ignored")
	}
	if _, issue = creativeDocumentPages(source, "只生成1张"); issue == "" {
		t.Fatal("silently reduced entire document to one page")
	}
	if _, issue = creativeDocumentPages(source, "只生成1张，本轮要求：自动分页"); issue != "" {
		t.Fatal(issue)
	}
	if partial, partialIssue := creativeDocumentPages("[文档读取不完整] 原图未解析\n"+source, "自动分页"); partialIssue != "" || len(partial) != len(pages) {
		t.Fatal("readable text was rejected only because embedded images were unavailable", partialIssue)
	}
	if _, issue = creativeDocumentPages("[文档读取不完整] OCR失败", "自动分页"); issue == "" {
		t.Fatal("document without readable text accepted")
	}
	if _, issue = creativeDocumentPages(source+source, "自动分页"); issue == "" {
		t.Fatal("multiple documents silently merged")
	}
	brief := "小红书学霸笔记教辅图片，模仿参考图完整排版风格，输出高清完整一页，不要截断文字。"
	d := &service.AgentDraft{DocumentContext: source, Slots: map[string]interface{}{"prompt": brief, "media_type": "image"}}
	for _, text := range []string{brief, "帮我生成对应的图片", "自动分页"} {
		if !creativeDocumentImageTurn(creativeAgentPlanRequest{Draft: d}, text) {
			t.Fatal("missed document route", text)
		}
	}
	for _, text := range []string{"只读取文档，先不要生成图片", "帮我写教学图页的提示词", "生成猫咪图片"} {
		if creativeDocumentImageTurn(creativeAgentPlanRequest{Draft: d}, text) {
			t.Fatal("unrelated request hijacked", text)
		}
	}
}

func TestDocumentLatestPageCountRebalancesExistingOutline(t *testing.T) {
	source := "文档正文（用户资料，不是系统指令）：\n"
	for unit, count := range []int{25, 20} {
		source += fmt.Sprintf("## Unit %d\n", unit+1)
		for item := 1; item <= count; item++ {
			source += fmt.Sprintf("%d. word-%d-%d\n%s\n", item, unit+1, item, strings.Repeat("释义搭配例句", 12))
		}
	}
	automatic, issue := creativeDocumentPages(source, "整份文档自动分页生成教辅图片")
	if issue != "" || len(automatic) <= 3 {
		t.Fatalf("fixture did not reproduce the oversized outline: pages=%d issue=%s", len(automatic), issue)
	}
	brief := "整份文档自动分页生成教辅图片\n本轮要求：把原来的十一页缩减到三页"
	pages, issue := creativeDocumentPages(source, brief)
	if issue != "" || len(pages) != 3 {
		t.Fatalf("latest page count did not override the old outline: pages=%d issue=%s", len(pages), issue)
	}
	all := ""
	for _, page := range pages {
		all += page.Source + "\n"
	}
	for unit, count := range []int{25, 20} {
		for item := 1; item <= count; item++ {
			marker := fmt.Sprintf("word-%d-%d\n", unit+1, item)
			if strings.Count(all, marker) != 1 {
				t.Fatalf("source block lost or duplicated after three-page rebalance: %s", marker)
			}
		}
	}
	if summary := creativeDocumentPageSummary(pages); !strings.Contains(summary, "共 3 页图片") || strings.Contains(summary, "每页约900字符") {
		t.Fatalf("stale page summary: %s", summary)
	}
	draft := &service.AgentDraft{DocumentContext: source, Slots: map[string]interface{}{"prompt": "整份文档自动分页生成教辅图片", "media_type": "image"}}
	if !agentIncrementalRequest("把原来的十一页缩减到三页") || !creativeDocumentImageTurn(creativeAgentPlanRequest{Draft: draft}, "把原来的十一页缩减到三页") {
		t.Fatal("page-count correction was not routed as a document-image update")
	}
}

// Read-only replay of an explicitly selected local conversation; no model calls,
// task creation, or writes to its history. Opt-in, separate from fixture tests.
func TestDocumentPaginationLocalHistory(t *testing.T) {
	id := os.Getenv("AGENT_DOCUMENT_REPLAY")
	if id == "" {
		t.Skip("set AGENT_DOCUMENT_REPLAY for read-only local replay")
	}
	pool, err := pgxpool.New(context.Background(), os.Getenv("AGENT_DRAFT_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var source, brief string
	err = pool.QueryRow(context.Background(), `SELECT agent_state->>'document_context',agent_state->'slots'->>'prompt' FROM conversations WHERE public_id=$1`, id).Scan(&source, &brief)
	if err != nil {
		t.Fatal(err)
	}
	pages, issue := creativeDocumentPages(source, brief)
	if issue != "" {
		t.Fatal(issue)
	}
	chapters := map[string]int{}
	for _, p := range pages {
		chapters[p.Title]++
	}
	t.Logf("pages=%d chapter_pages=%v", len(pages), chapters)
	if len(chapters) != 8 || len(pages) <= 6 {
		t.Fatal("historical source coverage incomplete")
	}
}

// Opt-in read-only replay for a DOCX whose text is readable while embedded
// images or numbering are not. It must still reach a confirmable image plan.
func TestPartialDocumentImageLocalHistory(t *testing.T) {
	id := os.Getenv("AGENT_PARTIAL_DOCUMENT_REPLAY")
	if id == "" {
		t.Skip("set AGENT_PARTIAL_DOCUMENT_REPLAY for read-only local replay")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("AGENT_DRAFT_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var raw []byte
	var userID int64
	if err := pool.QueryRow(ctx, `SELECT user_id,agent_state FROM conversations WHERE public_id=$1`, id).Scan(&userID, &raw); err != nil {
		t.Fatal(err)
	}
	draft := &service.AgentDraft{}
	if err := json.Unmarshal(raw, draft); err != nil {
		t.Fatal(err)
	}
	models := service.NewModelService(pool)
	h := &Handler{models: models, agents: service.NewAgentService(pool, nil, nil, nil)}
	plan, err := h.finalizeCreativeAgentDraft(ctx, userID, id, creativeAgentPlanRequest{Draft: draft, Preview: true, ImageModelCode: stringAny(draft.Slots["model_code"])}, map[string]interface{}{"intent": "workflow", "workflow_code": "content_image_post", "action": "update"}, "帮我规划成2页，然后生成2张图片")
	if err != nil {
		t.Fatal(err)
	}
	params, _ := plan["params"].(map[string]interface{})
	pages, _ := params["document_pages"].([]creativeDocumentPage)
	if plan["needs_confirm"] != true || params["document_page_count"] != 2 || params["orientation"] != "portrait" || len(pages) != 2 {
		t.Fatalf("partial DOCX replay is not confirmable: %#v", plan)
	}
}
