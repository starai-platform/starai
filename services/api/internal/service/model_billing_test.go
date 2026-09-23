package service

import (
	"math"
	"testing"
)

func TestEstimateCostSupportsCountForPerImage(t *testing.T) {
	service := &ModelService{}
	model := &ModelFull{ModelDTO: ModelDTO{PriceRule: map[string]interface{}{"billing_type": "per_image", "unit_price": float64(0.2)}}}
	if got := service.EstimateCost(model, map[string]interface{}{"count": float64(3)}, 0, 0); math.Abs(got-0.6) > 0.000000001 {
		t.Fatalf("cost = %v, want 0.6", got)
	}
}

func TestEstimateCostUsesImageSizeTierPrice(t *testing.T) {
	service := &ModelService{}
	model := &ModelFull{ModelDTO: ModelDTO{PriceRule: map[string]interface{}{
		"billing_type": "per_image",
		"unit_price":   float64(0.1),
		"unit_price_by_size": map[string]interface{}{
			"1K": float64(0.1), "2K": float64(0.25), "4K": float64(0.6),
		},
	}}}
	if got := service.EstimateCost(model, map[string]interface{}{"image_size": "2k", "count": float64(3)}, 0, 0); math.Abs(got-0.75) > 0.000000001 {
		t.Fatalf("cost = %v, want 0.75", got)
	}
	if got := service.EstimateCost(model, map[string]interface{}{"quality": "standard"}, 0, 0); math.Abs(got-0.1) > 0.000000001 {
		t.Fatalf("standard cost = %v, want 0.1", got)
	}
}

func TestEstimateCostSupportsDurationAliases(t *testing.T) {
	service := &ModelService{}
	model := &ModelFull{ModelDTO: ModelDTO{PriceRule: map[string]interface{}{"billing_type": "per_second", "unit_price": float64(0.5)}}}
	if got := service.EstimateCost(model, map[string]interface{}{"duration_sec": float64(8), "count": float64(2)}, 0, 0); got != 8 {
		t.Fatalf("cost = %v, want 8", got)
	}
}

func TestTokenReservationUsesRequestedOutputLimit(t *testing.T) {
	service := &ModelService{}
	model := &ModelFull{ModelDTO: ModelDTO{PriceRule: map[string]interface{}{
		"billing_type": "per_token", "input_price_per_m": float64(2), "output_price_per_m": float64(8),
	}}}
	got := service.EstimateCost(model, map[string]interface{}{"_estimated_input_tokens": float64(1000), "max_completion_tokens": float64(4000)}, 0, 0)
	want := float64(1000)*2/1_000_000 + float64(4000)*8/1_000_000
	if math.Abs(got-want) > 0.000000001 {
		t.Fatalf("cost = %.9f, want %.9f", got, want)
	}
}

func TestTokenCostUsesCacheReadAndWriteRates(t *testing.T) {
	rule := map[string]interface{}{
		"input_price_per_m":       float64(10),
		"output_price_per_m":      float64(20),
		"cache_read_price_per_m":  float64(1),
		"cache_write_price_per_m": float64(12),
	}
	got := tokenCostFromRule(rule, 1000, 500, 400, 100)
	want := float64(500)*10/1_000_000 + float64(400)*1/1_000_000 + float64(100)*12/1_000_000 + float64(500)*20/1_000_000
	if math.Abs(got-want) > 0.000000001 {
		t.Fatalf("cost = %.9f, want %.9f", got, want)
	}
}

func TestPerTokenCostMultipliesGeneratedCount(t *testing.T) {
	service := &ModelService{}
	model := &ModelFull{ModelDTO: ModelDTO{Category: "audio", PriceRule: map[string]interface{}{
		"billing_type": "per_token", "input_price_per_m": float64(2), "output_price_per_m": float64(4),
	}}}
	one := service.EstimateCost(model, map[string]interface{}{"prompt": "hello"}, 100, 200)
	three := service.EstimateCost(model, map[string]interface{}{"prompt": "hello", "count": float64(3)}, 100, 200)
	if math.Abs(three-one*3) > 0.000000001 {
		t.Fatalf("three outputs cost %.9f, want %.9f", three, one*3)
	}
}

func TestChatTokenCostIgnoresUnforwardedCountParam(t *testing.T) {
	service := &ModelService{}
	model := &ModelFull{ModelDTO: ModelDTO{Category: "chat", PriceRule: map[string]interface{}{
		"billing_type": "per_token", "input_price_per_m": float64(2), "output_price_per_m": float64(4),
	}}}
	one := service.EstimateCost(model, map[string]interface{}{}, 100, 200)
	withCount := service.EstimateCost(model, map[string]interface{}{"count": float64(3)}, 100, 200)
	if math.Abs(withCount-one) > 0.000000001 {
		t.Fatalf("chat count changed token cost: %.9f vs %.9f", withCount, one)
	}
}

func TestEstimateAgentProjectCostUsesFlatWorkflowPrice(t *testing.T) {
	got := estimateAgentProjectCost(map[string]interface{}{"billing_type": "per_request", "unit_price": float64(0.15)}, nil, 0.15, 0.27)
	if got != 0.15 {
		t.Fatalf("cost = %v, want flat workflow price 0.15", got)
	}
}

func TestEstimateAgentProjectCostUsesRuntimeForModelActual(t *testing.T) {
	got := estimateAgentProjectCost(map[string]interface{}{"billing_type": "model_actual", "unit_price": float64(0)}, nil, 0.15, 0.27)
	if got != 0.27 {
		t.Fatalf("cost = %v, want runtime cost 0.27", got)
	}
}

func TestEstimateAgentProjectCostAddsWorkflowFeeForModelActual(t *testing.T) {
	got := estimateAgentProjectCost(map[string]interface{}{"billing_type": "model_actual", "unit_price": float64(0.1)}, nil, 0.15, 0.27)
	// 冻结 = 工作流费 0.1 + 用量估算 0.27
	if math.Abs(got-0.37) > 0.000000001 {
		t.Fatalf("cost = %v, want workflow fee + usage 0.37", got)
	}
}

func TestEstimateAgentProjectCostForPerChapter(t *testing.T) {
	rule := map[string]interface{}{
		"billing_type": "per_chapter", "unit_price": float64(0.2),
		"planning_price": float64(0.5), "free_trial_chapters": float64(3),
	}
	got := estimateAgentProjectCost(rule, map[string]interface{}{"length_code": "mid"}, 0, 0)
	// 中篇估算 20 章：0.5 + 0.2 × (20-3) = 3.9
	if math.Abs(got-3.9) > 0.000000001 {
		t.Fatalf("cost = %v, want per-chapter estimate 3.9", got)
	}
}

func TestChapterBasedCostHonorsFreeTrial(t *testing.T) {
	rule := map[string]interface{}{
		"billing_type": "per_chapter", "unit_price": float64(0.2),
		"planning_price": float64(0.5), "free_trial_chapters": float64(3),
	}
	if got := chapterBasedCost(rule, 2); got != 0.5 {
		t.Fatalf("2 chapters = %v, want planning-only 0.5", got)
	}
	if got := chapterBasedCost(rule, 5); math.Abs(got-0.9) > 0.000000001 {
		t.Fatalf("5 chapters = %v, want 0.5 + 0.2×2 = 0.9", got)
	}
}

func TestValidateModelPriceRuleRejectsUnknownAndNegativePricing(t *testing.T) {
	if err := validateModelPriceRule(map[string]interface{}{"billing_type": "mystery", "unit_price": float64(1)}); err == nil {
		t.Fatal("unknown billing type was accepted")
	}
	if err := validateModelPriceRule(map[string]interface{}{"billing_type": "per_second", "unit_price": float64(-1)}); err == nil {
		t.Fatal("negative unit price was accepted")
	}
}

func TestValidateAgentCostLimitRequiresConfirmation(t *testing.T) {
	if err := validateAgentCostLimit(map[string]interface{}{"_agent_confirmation": "signed", "_agent_max_cost": 1.0}, 1.1); err == nil {
		t.Fatal("confirmed cost overrun was accepted")
	}
	if err := validateAgentCostLimit(map[string]interface{}{"_agent_max_cost": 1.0}, 1.1); err != nil {
		t.Fatalf("untrusted cost limit affected ordinary task: %v", err)
	}
	if err := validateAgentCostLimit(map[string]interface{}{"_agent_confirmation": "signed", "_agent_max_cost": 1.0}, 1.0); err != nil {
		t.Fatalf("estimate at confirmed limit was rejected: %v", err)
	}
}

func TestAgentConfirmationConversation(t *testing.T) {
	if got := agentConfirmationConversation("conversation_123:7"); got != "conversation_123" {
		t.Fatalf("conversation = %q", got)
	}
	for _, invalid := range []string{"", "conversation_123", ":7"} {
		if got := agentConfirmationConversation(invalid); got != "" {
			t.Fatalf("invalid confirmation %q produced %q", invalid, got)
		}
	}
}
