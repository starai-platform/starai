package handler

import (
	"strings"
	"testing"

	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
)

func TestDocumentRevisionSurvivesClippedHistoryAndPartialEdits(t *testing.T) {
	d := &service.AgentDraft{Version: 2, Slots: map[string]interface{}{"asset_ids": []string{"original"}}}
	body := "# 合同\n第一条 保留\n第二条 " + strings.Repeat("完整正文", 7000) + "\n第三条 三年\n签署栏"
	creativeAgentSaveDocumentRevision(d, map[string]interface{}{"reply": body}, "修改合同第三条，其他不变")
	if d.Document == nil || d.Document.Text != body || d.Document.Version != 2 {
		t.Fatal("complete revision not retained")
	}
	input := service.CompletionInput{Messages: []runtime.ChatMessage{{Role: "assistant", Content: "[历史正文中段已压缩]"}, {Role: "user", Content: "改为五年"}}}
	creativeAgentAttachDocumentRevision(&input, d, "改为五年")
	if !strings.Contains(input.Messages[len(input.Messages)-1].Content, body) {
		t.Fatal("follow-up only received clipped history")
	}
	creativeAgentSaveDocumentRevision(d, map[string]interface{}{"reply": "第三条 五年"}, "只展示修改部分")
	if d.Document.Text != body {
		t.Fatal("partial edit replaced the complete document")
	}
	input.Messages = nil
	creativeAgentAttachDocumentRevision(&input, d, "导出Word")
	if !strings.Contains(input.Messages[0].Content, "第三条 五年") || !strings.Contains(input.Messages[0].Content, "不能直接导出旧版本") {
		t.Fatal("export silently lost pending partial changes")
	}
	creativeAgentSelectDocumentAssets(d, []string{"original"}, false)
	if d.Document == nil {
		t.Fatal("same attachment discarded revision")
	}
	creativeAgentSelectDocumentAssets(d, []string{"replacement"}, true)
	if d.Document != nil {
		t.Fatal("new attachment reused an unrelated revision")
	}
}

func TestDocumentRevisionDoesNotSaveUnreadAttachmentAsComplete(t *testing.T) {
	d := &service.AgentDraft{DocumentContext: "[文档读取不完整]", Slots: map[string]interface{}{}}
	creativeAgentSaveDocumentRevision(d, map[string]interface{}{"reply": "局部修改建议"}, "修改合同第三条")
	if d.Document != nil {
		t.Fatal("unread attachment produced a complete revision")
	}
}
