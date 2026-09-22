package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
)

func creativeAgentArtifactText(text string) (string, string) {
	text = strings.TrimSpace(text)
	blocks := regexp.MustCompile("(?s)```[^\\n]*\\n(.*?)```").FindAllStringSubmatch(text, -1)
	if len(blocks) > 1 {
		return "", "包含多个候选或模板，请先确定一个方案，不能替用户选择"
	}
	if len(blocks) == 1 {
		text = strings.TrimSpace(blocks[0][1])
	}
	if text == "" {
		return "", "缺少完整提示词正文"
	}
	if regexp.MustCompile(`(?i)[\[【（(]\s*(?:具体|待填|待补|请填|填写|your |insert |1.?2句|科技感场景|科技互动动作|简洁的动作描述|互动引导|引发互动|简洁的动作|核心内容)[^\]】）)\n]{0,120}[\]】）)]|\{\{[^}]+\}\}`).MatchString(text) {
		return "", "提示词仍有待填写占位符，尚不能执行"
	}
	if regexp.MustCompile(`示例应用|提示词模板|文案提示词模板|您可以根据具体|需要我针对某个`).MatchString(text) {
		return "", "说明或模板混入了提示词，请交付一个已经填好的完整正文"
	}
	return text, ""
}

func creativeAgentArtifactCandidate(plan map[string]interface{}) string {
	updates, _ := plan["slot_updates"].(map[string]interface{})
	if value := strings.TrimSpace(stringAny(updates["generation_prompt"])); value != "" {
		return value
	}
	return stringAny(plan["reply"])
}

func creativeAgentArtifactForRequest(text, userText string) (string, string) {
	content, issue := creativeAgentArtifactText(text)
	if issue != "" {
		return content, issue
	}
	noClaims := regexp.MustCompile(`(?:不|不要|禁止|避免|无需).{0,12}(?:效率|功效|业绩|收益).{0,6}(?:数字|数值|百分比|倍数)`).MatchString(userText)
	if noClaims && regexp.MustCompile(`(?:效率|准确率|业绩|收益|耗时|时间|成本).{0,8}\d+(?:\.\d+)?\s*(?:%|％|倍)`).MatchString(content) {
		return "", "正文违反了用户不宣称具体功效数字的要求，请移除未经依据的效率、百分比或倍数承诺"
	}
	if limitMatch := regexp.MustCompile(`(?:旁白|配音|台词|对白)[^。；;\n]{0,16}?(\d{1,4})\s*(?:个)?(?:汉字|字)(?:以内|内|以下)`).FindStringSubmatch(userText); len(limitMatch) > 1 {
		limit := 0
		_, _ = fmt.Sscanf(limitMatch[1], "%d", &limit)
		spoken := regexp.MustCompile(`(?m)^\s*(?:[-*]\s*)?(?:\*\*)?(?:旁白|配音|对白|台词)(?:\*\*)?\s*[：:]([^\n]+)`).FindAllStringSubmatch(content, -1)
		count := 0
		for _, line := range spoken {
			count += len(regexp.MustCompile(`[\p{Han}]`).FindAllString(line[1], -1))
		}
		if limit > 0 && count > limit {
			return "", fmt.Sprintf("旁白实际%d个汉字，超过用户要求的%d字上限；请精简全部分镜的旁白总和，不是每段分别限制", count, limit)
		}
	}
	return content, ""
}

func creativeAgentWantsTemplate(text string) bool {
	// Mentioning a template to reject or fill it is a request for a finished
	// artifact, not permission to deliver another blank template.
	if regexp.MustCompile(`(?:不要|不用|别给|拒绝|不是|而非|不需要|无需).{0,8}(?:模板|格式示例|空白格式)|(?:模板|占位符).{0,12}(?:填好|填完|填充|补全|完善|改成|变成)|(?:填好|填完|填充|补全|完善).{0,8}模板`).MatchString(text) {
		return false
	}
	return regexp.MustCompile(`模板|格式示例|空白格式`).MatchString(text)
}

// A single bounded repair uses the same conversation/model and never creates
// media. Only invalid prompt-writing replies take this extra completion path.
func (h *Handler) repairCreativeAgentArtifact(ctx context.Context, userID int64, input service.CompletionInput, plan map[string]interface{}, userText string) map[string]interface{} {
	policy := service.AgentPolicyFromConfig(h.creativeAgentRuntimeConfig(ctx))
	complete := func(in service.CompletionInput) (*service.CompletionResult, error) {
		if !creativeAgentTakeRecovery(ctx) {
			return nil, errCreativeAgentRecoveryUsed
		}
		return h.chat.Completion(ctx, userID, in)
	}
	plan = repairCreativeAgentDocumentOnce(input, plan, userText, policy.ContentRepairAttempts, complete)
	return repairCreativeAgentArtifactOnce(input, plan, userText, policy.ContentRepairAttempts, complete)
}

func repairCreativeAgentArtifactOnce(input service.CompletionInput, plan map[string]interface{}, userText string, attempts int, complete func(service.CompletionInput) (*service.CompletionResult, error)) map[string]interface{} {
	if !creativeAgentPromptDraftRequest(userText) || creativeAgentWantsTemplate(userText) || stringAny(plan["intent"]) == "clarify" {
		return plan
	}
	_, issue := creativeAgentArtifactForRequest(creativeAgentArtifactCandidate(plan), userText)
	if issue == "" {
		return plan
	}
	if attempts <= 0 {
		return plan
	}
	bad, _ := json.Marshal(plan)
	repair := input
	repair.Stream = false
	repair.Ephemeral = true
	repair.BillingLabel = "Agent 提示词质量修复"
	repair.Params = copyStringMap(input.Params)
	repair.Params["temperature"] = 0.2
	repair.Messages = append(append([]runtime.ChatMessage(nil), input.Messages...), runtime.ChatMessage{Role: "assistant", Content: string(bad)}, runtime.ChatMessage{Role: "user", Content: fmt.Sprintf("系统交付验收发现：%s。只修复上一条回答一次，完成原用户要求：%s。返回严格JSON，intent=chat；reply给出一个完整可用提示词，slot_updates.generation_prompt仅存正文，slot_evidence引用原用户原话。禁止占位模板、多个备选、未经依据的效率数字或编造今日热点。未获取今日热点证据必须说明，并把创作明确标为原创演示；不要改变已有角色、时长、风格，不要提出或启动媒体任务。", issue, userText)})
	result, err := complete(repair)
	if err != nil || result == nil {
		return plan
	}
	fixed := parseCreativeAgentPlan(result.Content)
	if fixed == nil {
		return plan
	}
	if _, issue := creativeAgentArtifactForRequest(creativeAgentArtifactCandidate(fixed), userText); issue != "" {
		return plan
	}
	// Repair has authority over the artifact only, never over other task slots.
	content, _ := creativeAgentArtifactText(creativeAgentArtifactCandidate(fixed))
	next := copyStringMap(plan)
	updates, _ := plan["slot_updates"].(map[string]interface{})
	updates = copyStringMap(updates)
	evidence, _ := plan["slot_evidence"].(map[string]interface{})
	evidence = copyStringMap(evidence)
	updates["generation_prompt"], evidence["generation_prompt"] = content, userText
	next["intent"], next["needs_confirm"], next["prompt"] = "chat", false, ""
	next["reply"], next["slot_updates"], next["slot_evidence"] = stringAny(fixed["reply"]), updates, evidence
	next["content_repaired"] = true
	return next
}
