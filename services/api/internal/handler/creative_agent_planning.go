package handler

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
)

const creativeAgentCompactPlanPrompt = `
媒体 PLAN 只负责确认短方案，不负责撰写成品。整份 JSON 控制在 2000 字以内，reply 不超过 200 字，prompt 只保留用户目标、内容范围、页数、视觉风格与约束。原文由服务端单独保存和传递，严禁在 reply、prompt、slot_updates 或 slot_evidence 中抄写附件全文、逐页正文或反复复述相同内容。教学图片确认后才逐页编排正文与绘图。仅填写本轮变更的槽位，每条 evidence 只引用支持该字段的最短用户原话。不得以缩短输出为由省略用户约束、改变数量或声称覆盖整本；范围冲突时明确询问。此限制仅针对 PLAN，不限制 CHAT 的文档正文交付。`

const creativeAgentPlanMaxBytes = 24000

func creativeAgentPlanOutputTooLong(content string) bool {
	if len(content) <= creativeAgentPlanMaxBytes {
		return false
	}
	mode, _ := creativeAgentStreamStart(content)
	if mode == "chat" {
		return false
	}
	if plan := parseCreativeAgentPlan(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(content), "PLAN"))); plan != nil {
		return stringAny(plan["intent"]) != "chat"
	}
	return mode == "plan"
}

func creativeAgentCompactRetry(input service.CompletionInput, err error, content string, used bool) (service.CompletionInput, bool) {
	var pe *runtime.PlatformError
	mode, _ := creativeAgentStreamStart(content)
	if used || !errors.As(err, &pe) || pe.Code != "MODEL_OUTPUT_LIMIT" || mode == "chat" {
		return input, false
	}
	// An incomplete ordinary writing answer must not be replaced by a media plan.
	if mode != "plan" && input.Params["_agent_plan_output_limit"] == nil {
		return input, false
	}
	input.Messages = append(append([]runtime.ChatMessage(nil), input.Messages...), runtime.ChatMessage{Role: "system", Content: creativeAgentCompactPlanPrompt + "\n上一轮 PLAN 超长未完成，现在仅精简重规划一次：输出完整合法 JSON，控制在 1000 字以内；不要续写残缺 JSON，不输出附件正文。继续遵守原有 CHAT/PLAN 协议及用户授权边界。"})
	input.Params = copyStringMap(input.Params)
	input.Params["_agent_plan_output_limit"] = 8192
	return input, true
}

func creativeAgentPartialReply(content string) string {
	chars := []rune(strings.TrimSpace(content))
	if len(chars) > 8000 {
		return string(chars[:8000]) + "\n[未完成草稿已截断，不可执行]"
	}
	return string(chars)
}

// A malformed planner response is a recoverable step failure, not a reason to
// make the user restate the task. Retry once with the exact validation error;
// the normal draft finalizer still owns permissions, slot evidence and models.
func (h *Handler) repairCreativeAgentPlanContract(ctx context.Context, userID int64, input service.CompletionInput, content, userText string) (map[string]interface{}, bool) {
	policy := service.AgentPolicyFromConfig(h.creativeAgentRuntimeConfig(ctx))
	return repairCreativeAgentPlanContractOnce(input, content, userText, policy.PlanRepairAttempts, func(next service.CompletionInput) (*service.CompletionResult, error) {
		if !creativeAgentTakeRecovery(ctx) {
			return nil, errCreativeAgentRecoveryUsed
		}
		return h.chat.Completion(ctx, userID, next)
	})
}

func repairCreativeAgentPlanContractOnce(input service.CompletionInput, content, userText string, attempts int, complete func(service.CompletionInput) (*service.CompletionResult, error)) (map[string]interface{}, bool) {
	if fallback, ok := creativeAgentDocumentPlanFallback(userText); ok {
		return fallback, true
	}
	fallback := creativeAgentPlanContractFallback()
	if attempts <= 0 || complete == nil {
		return fallback, false
	}
	repair := input
	repair.Stream = false
	repair.Ephemeral = true
	repair.BillingLabel = "Agent 规划格式修复"
	repair.Params = copyStringMap(input.Params)
	repair.Params["temperature"] = 0.1
	repair.Params["_agent_plan_output_limit"] = 4096
	repair.Messages = append(append([]runtime.ChatMessage(nil), input.Messages...),
		runtime.ChatMessage{Role: "assistant", Content: creativeAgentPartialReply(content)},
		runtime.ChatMessage{Role: "user", Content: fmt.Sprintf("系统校验发现上一条规划不符合 CHAT/PLAN 输出协议。请只修复格式一次，不改变用户需求、已确认槽位、素材、数量或授权边界。原用户本轮要求：%s。文字回答输出 CHAT 后跟完整正文；媒体方案输出 PLAN 后跟一个完整 JSON，禁止解释、Markdown 围栏、多个候选或残缺 JSON。", userText)},
	)
	result, err := complete(repair)
	if err != nil || result == nil {
		return fallback, false
	}
	plan, ok := creativeAgentPlanFromStreamResult(result.Content, userText)
	if !ok || stringAny(plan["intent"]) == "clarify" {
		return fallback, false
	}
	plan["plan_contract_repaired"] = true
	return plan, true
}

// A malformed model envelope must not make a user restate an explicit
// document-to-images request. The normal draft finalizer still validates the
// attachment, page contents, model and confirmation boundary.
func creativeAgentDocumentPlanFallback(text string) (map[string]interface{}, bool) {
	lower := strings.ToLower(text)
	document := false
	for _, cue := range []string{"文档", "附件", "word", "docx", "pdf"} {
		if strings.Contains(lower, cue) {
			document = true
			break
		}
	}
	if !document || !creativeAgentDocumentImageRequest(text) {
		return nil, false
	}
	updates := map[string]interface{}{"media_type": "image", "prompt": text}
	evidence := map[string]interface{}{"media_type": text, "prompt": text}
	if count, explicit := creativeDocumentRequestedPageCount(text); explicit {
		updates["document_page_count"] = count
		evidence["document_page_count"] = text
	}
	return map[string]interface{}{
		"intent": "workflow", "workflow_code": "content_image_post", "action": "update",
		"slot_updates": updates, "slot_evidence": evidence, "reply": "已恢复文档转图片方案。", "needs_confirm": true,
		"plan_contract_recovered": true,
	}, true
}
