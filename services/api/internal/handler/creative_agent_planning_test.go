package handler

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
)

func TestCreativeAgentCompactPlanningBudget(t *testing.T) {
	input := service.CompletionInput{Messages: []runtime.ChatMessage{{Role: "user", Content: "生成1页教辅图"}}, Params: map[string]interface{}{"_agent_plan_output_limit": 8192}}
	limit := &runtime.PlatformError{Code: "MODEL_OUTPUT_LIMIT"}
	next, ok := creativeAgentCompactRetry(input, limit, "PLAN\n{", false)
	if !ok || len(next.Messages) != 2 || len(input.Messages) != 1 || !strings.Contains(next.Messages[1].Content, "不输出附件正文") {
		t.Fatal("compact retry must retain source and add only short planning instructions")
	}
	for _, tc := range []struct {
		err     error
		content string
		used    bool
	}{
		{limit, "PLAN\n{", true}, {limit, "CHAT\n长文", false}, {errors.New("offline"), "PLAN\n{", false}, {&runtime.PlatformError{Code: "CONTENT_REJECTED"}, "PLAN\n{", false},
	} {
		if _, ok := creativeAgentCompactRetry(input, tc.err, tc.content, tc.used); ok {
			t.Fatal("unexpected retry", tc)
		}
	}
	if _, ok := creativeAgentCompactRetry(service.CompletionInput{}, limit, "", false); ok {
		t.Fatal("ordinary writing must not become a media plan")
	}
	long := strings.Repeat("文", 9000)
	if !creativeAgentPlanOutputTooLong("PLAN\n"+long) || !creativeAgentPlanOutputTooLong(`{"intent":"workflow","prompt":"`+long+`"}`) {
		t.Fatal("missing plan budget")
	}
	if creativeAgentPlanOutputTooLong("CHAT\n"+long) || creativeAgentPlanOutputTooLong(`{"intent":"chat","reply":"`+long+`"}`) {
		t.Fatal("long writing changed")
	}
	partial := creativeAgentPartialReply(long)
	if !utf8.ValidString(partial) || len([]rune(partial)) > 8040 {
		t.Fatal("unbounded or invalid recovery snapshot")
	}
}

func TestCreativeAgentRepairsMalformedPlanOnce(t *testing.T) {
	input := service.CompletionInput{Messages: []runtime.ChatMessage{{Role: "system", Content: "rules"}, {Role: "user", Content: "生成三张教学图片"}}, Params: map[string]interface{}{"temperature": 0.2}}
	calls := 0
	plan, ok := repairCreativeAgentPlanContractOnce(input, "PLAN\n{broken", "生成三张教学图片", 1, func(next service.CompletionInput) (*service.CompletionResult, error) {
		calls++
		if next.Stream || next.BillingLabel != "Agent 规划格式修复" || len(next.Messages) != 4 || next.Params["_agent_plan_output_limit"] != 4096 {
			t.Fatalf("invalid repair input: %#v", next)
		}
		return &service.CompletionResult{Content: `PLAN
{"intent":"image","reply":"已整理为3张教学图片方案","prompt":"教学图片","params":{"count":3},"needs_confirm":true}`}, nil
	})
	if !ok || calls != 1 || stringAny(plan["intent"]) != "image" || plan["plan_contract_repaired"] != true {
		t.Fatalf("plan was not repaired: %#v ok=%v calls=%d", plan, ok, calls)
	}
	if _, ok = repairCreativeAgentPlanContractOnce(input, "PLAN\n{broken", "生成三张教学图片", 0, func(service.CompletionInput) (*service.CompletionResult, error) {
		calls++
		return nil, nil
	}); ok || calls != 1 {
		t.Fatal("disabled repair must not call the model")
	}
}

func TestMalformedDocumentImagePlanUsesServerFallback(t *testing.T) {
	calls := 0
	plan, ok := repairCreativeAgentPlanContractOnce(service.CompletionInput{}, "PLAN\n{broken", "分析我提交的文档，帮我规划成2页并生成2张图片", 1, func(service.CompletionInput) (*service.CompletionResult, error) {
		calls++
		return nil, errors.New("must not call repair model")
	})
	updates, _ := plan["slot_updates"].(map[string]interface{})
	if !ok || calls != 0 || plan["workflow_code"] != "content_image_post" || updates["document_page_count"] != 2 || plan["plan_contract_recovered"] != true {
		t.Fatalf("document fallback failed: %#v calls=%d", plan, calls)
	}
}
