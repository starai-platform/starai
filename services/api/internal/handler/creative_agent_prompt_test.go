package handler

import (
	"context"
	"strings"
	"testing"

	"github.com/starai/api/internal/service"
)

func TestCreativeAgentGuidanceFollowsCurrentTurn(t *testing.T) {
	policy := service.DefaultAgentPolicy()
	policy.Instructions = "自定义通用指导"
	policy.CreationGuidance = "仅用于媒体的创作指导"
	policy.ResearchGuidance = "仅用于检索的指导"
	policy.DocumentGuidance = "仅用于文档的完整正文规则"
	plain := creativeAgentTurnPrompt(nil, policy, creativeAgentPlanRequest{}, "给我解释一下什么是光合作用")
	if !strings.Contains(plain, policy.Instructions) || strings.Contains(plain, policy.CreationGuidance) || strings.Contains(plain, policy.ResearchGuidance) || strings.Contains(plain, policy.DocumentGuidance) {
		t.Fatal("ordinary chat loaded unrelated guidance")
	}
	if len([]rune(plain)) > 2000 {
		t.Fatal("ordinary chat prompt grew beyond its compact budget")
	}
	if !strings.Contains(plain, "禁止展示 media_type") {
		t.Fatal("capability answers may leak internal routing fields")
	}
	writing := creativeAgentTurnPrompt(nil, policy, creativeAgentPlanRequest{}, "写一段产品介绍文案")
	if strings.Contains(writing, policy.DocumentGuidance) {
		t.Fatal("ordinary writing loaded document guidance")
	}
	media := creativeAgentTurnPrompt(nil, policy, creativeAgentPlanRequest{}, "生成一段海边视频")
	if !strings.Contains(media, policy.CreationGuidance) {
		t.Fatal("media constraints missing")
	}
	document := creativeAgentTurnPrompt(nil, policy, creativeAgentPlanRequest{}, "修改合同第三条，其他不变")
	if !strings.Contains(document, policy.DocumentGuidance) || !strings.Contains(document, creativeAgentDocumentSafetyPrompt) || strings.Contains(document, policy.CreationGuidance) {
		t.Fatal("document editing lost completeness or loaded video guidance")
	}
	policy.DocumentGuidance = ""
	document = creativeAgentTurnPrompt(nil, policy, creativeAgentPlanRequest{}, "修改合同第三条，其他不变")
	if !strings.Contains(document, creativeAgentDocumentSafetyPrompt) || strings.Contains(document, `<skill name="documents">`) {
		t.Fatal("disabled document skill removed its fixed safety boundary")
	}
}

func TestCreativeAgentDiscussionPreservesPendingPlan(t *testing.T) {
	for _, text := range []string{"继续解释一下为什么这样分", "七页和三页有什么不同？", "为什么这样？"} {
		d := &service.AgentDraft{Version: 4, Status: "planning", Slots: map[string]interface{}{"media_type": "image", "style": "米白纸", "document_page_count": 7},
			Plan: map[string]interface{}{"intent": "workflow", "workflow_code": "content_image_post", "needs_confirm": true, "draft_status": "awaiting_confirmation", "plan_version": 3}}
		plan, ok := creativeAgentPlanFromStreamResult("CHAT\n这是排版密度的区别。", text)
		if !ok {
			t.Fatal("valid chat required format repair")
		}
		plan["slot_updates"] = map[string]interface{}{"document_page_count": 3}
		result, err := (&Handler{}).finalizeCreativeAgentDraft(context.Background(), 1, "conversation", creativeAgentPlanRequest{Draft: d, Preview: true}, plan, text)
		if err != nil || result["needs_confirm"] != false || d.Slots["document_page_count"] != 7 || d.Plan["workflow_code"] != "content_image_post" || d.Status != "awaiting_confirmation" || d.Plan["plan_version"] != int64(4) {
			t.Fatal("discussion changed the pending task", text, result, d, err)
		}
	}
}

func TestCreativeAgentRecoveryBudgetIsSharedAndCancellationStopsIt(t *testing.T) {
	ctx := creativeAgentRecoveryContext(context.Background())
	if !creativeAgentTakeRecovery(ctx) || creativeAgentTakeRecovery(ctx) {
		t.Fatal("fallback and repair did not share a single recovery budget")
	}
	ctx, cancel := context.WithCancel(creativeAgentRecoveryContext(context.Background()))
	cancel()
	if creativeAgentTakeRecovery(ctx) {
		t.Fatal("cancelled request started another model call")
	}
}
