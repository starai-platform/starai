package handler

import (
	"github.com/starai/api/internal/service"
	"testing"
)

func TestDocumentImageRoutingAndCountRecovery(t *testing.T) {
	readDraft := &service.AgentDraft{}
	if err := mergeCreativeAgentDraft(readDraft, map[string]interface{}{"intent": "chat"}, "读取这份20页PDF文档"); err != nil || len(readDraft.SlotIssues) != 0 {
		t.Fatalf("source page count treated as image quantity: %#v %v", readDraft, err)
	}
	for _, text := range []string{"分析文档然后按要求做出对应图片，小红书学习笔记教辅图片，整页一页", "把PDF整理成3页教学图文绘画册", "根据Word生成一张知识卡"} {
		plan := normalizeCreativeAgentWorkflowPlan(map[string]interface{}{"intent": "chat", "reply": "我将生成"}, text)
		if plan["intent"] != "workflow" || plan["workflow_code"] != "content_image_post" || creativeAgentTextOnly(text) {
			t.Fatalf("image request reduced to chat: %s %#v", text, plan)
		}
	}
	for _, text := range []string{"读取PDF，先不要生成图片", "帮我写教学图页的提示词", "生成Word文档"} {
		if creativeAgentDocumentImageRequest(text) {
			t.Fatalf("non-executable request routed to images: %s", text)
		}
	}
	for text, count := range map[string]int{"一页": 1, "十一页": 11, "生成1张": 1, "生成两张": 2, "制作16张": 16, "这份20页PDF生成1张": 1, "做一张含4个卡片的教辅图": 1, "把原来的十一页缩减到三页": 3, "从二十五页压缩到十页": 10, "改成5页": 5, "改成五页": 5, "改成7页": 7, "改成七页": 7, "改成柒页": 7, "调整为拾贰页": 12} {
		if got := creativeAgentRequestedImageCount(text); got != count {
			t.Fatalf("%s: %d", text, got)
		}
	}
	d := &service.AgentDraft{Version: 2, Slots: map[string]interface{}{"prompt": "根据文档生成一张教辅图", "media_type": "image"}, SlotIssues: map[string]string{"image_count": "图文配图数量可选 2–6 张"}}
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "workflow", "workflow_code": "content_image_post"}, "确认"); err != nil {
		t.Fatal(err)
	}
	if len(d.SlotIssues) != 0 || d.Slots["image_count"] != 1 {
		t.Fatalf("legacy confirmation loop not repaired: %#v", d)
	}
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "workflow", "workflow_code": "content_image_post"}, "改成16张"); err != nil {
		t.Fatal(err)
	}
	if d.SlotIssues["image_count"] == "" {
		t.Fatal("out-of-range count silently changed")
	}
	if err := mergeCreativeAgentDraft(d, map[string]interface{}{"intent": "workflow", "workflow_code": "content_image_post"}, "改成一张"); err != nil {
		t.Fatal(err)
	}
	if len(d.SlotIssues) != 0 || d.Slots["image_count"] != 1 {
		t.Fatal("explicit correction did not clear issue")
	}
}
