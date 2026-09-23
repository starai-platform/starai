package main

import (
	"strings"
	"testing"
)

func TestWorkerStatusCanFailover(t *testing.T) {
	for _, status := range []int{0, 401, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524} {
		if !workerStatusCanFailover(status) {
			t.Fatalf("status %d should fail over", status)
		}
	}
	for _, status := range []int{400, 422} {
		if workerStatusCanFailover(status) {
			t.Fatalf("status %d must not fail over", status)
		}
	}
}

func TestWorkerSameRouteRetryClassification(t *testing.T) {
	if workerShouldRetrySameRoute(nil, 429, true) {
		t.Fatal("429 should switch routes without retrying the same one")
	}
	if !workerShouldRetrySameRoute(nil, 503, false) {
		t.Fatal("503 should allow configured same-route retry")
	}
	if workerShouldRetrySameRoute(nil, 502, true) {
		t.Fatal("502 should switch to an independent route before same-route retry")
	}
	if !workerShouldRetrySameRoute(assertionError("network"), 0, false) {
		t.Fatal("network errors should allow configured retry")
	}
	if workerShouldRetrySameRoute(assertionError("network"), 0, true) {
		t.Fatal("network errors should switch routes when a fallback exists")
	}
}

func TestWorkerRouteFailoversSpreadGatewayHosts(t *testing.T) {
	routes := []workerModelRoute{
		{ID: 1, Connection: connectionConfig{BaseURL: "https://new-api.example.com/v1"}},
		{ID: 2, Connection: connectionConfig{BaseURL: "https://new-api.example.com/v1"}},
		{ID: 3, Connection: connectionConfig{BaseURL: "https://official.example.net/v1"}},
		{ID: 4, Connection: connectionConfig{BaseURL: "https://new-api.example.com/v1"}},
	}
	spreadWorkerRouteFailureDomains(routes)
	if routes[0].ID != 1 || routes[1].ID != 3 {
		t.Fatalf("same gateway routes remained adjacent before an independent fallback: %#v", routes)
	}
}

func TestWorkerRouteSelectionWeightUsesObservedReliability(t *testing.T) {
	if got := workerRouteSelectionWeight(workerModelRoute{Weight: 100}); got != 90 {
		t.Fatalf("new route weight = %d, want 90", got)
	}
	if got := workerRouteSelectionWeight(workerModelRoute{Weight: 100, FailureCount: 20}); got != 30 {
		t.Fatalf("unreliable route weight = %d, want 30", got)
	}
	if got := workerRouteSelectionWeight(workerModelRoute{Weight: 50, SuccessCount: 90, FailureCount: 10}); got != 45 {
		t.Fatalf("configured weight was not retained: %d", got)
	}
}

func TestAgentConfirmedCostCapsUserChargeOnlyForConfirmedRun(t *testing.T) {
	confirmed := map[string]interface{}{"_agent_confirmation": "signed", "_agent_max_cost": 1.25}
	if got := agentConfirmedCost(confirmed, 2); got != 1.25 {
		t.Fatalf("confirmed cost = %v, want 1.25", got)
	}
	if got := agentConfirmedCost(map[string]interface{}{"_agent_max_cost": 1.25}, 2); got != 2 {
		t.Fatalf("untrusted cost limit changed charge: %v", got)
	}
}

type assertionError string

func (e assertionError) Error() string { return string(e) }

func TestWorkerRouteProviderCost(t *testing.T) {
	route := workerModelRoute{CostRule: map[string]interface{}{"billing_type": "per_second", "unit_cost": 0.04}}
	if got := workerRouteProviderCost(route, map[string]interface{}{"duration": 10}, 0, 0, 0, 0); got != 0.4 {
		t.Fatalf("provider cost = %v, want 0.4", got)
	}
}

func TestWorkerRouteProviderCostPerTokenWithCache(t *testing.T) {
	route := workerModelRoute{CostRule: map[string]interface{}{
		"billing_type":           "per_token",
		"input_cost_per_m":       float64(10),
		"output_cost_per_m":      float64(40),
		"cache_read_cost_per_m":  float64(1),
		"cache_write_cost_per_m": float64(12),
	}}
	// 输入 1000（缓存读 400 + 缓存写 100），输出 500
	got := workerRouteProviderCost(route, map[string]interface{}{}, 1000, 500, 400, 100)
	want := (float64(500)*10 + float64(400)*1 + float64(100)*12 + float64(500)*40) / 1_000_000
	if diff := got - want; diff > 0.000000001 || diff < -0.000000001 {
		t.Fatalf("provider cost = %.9f, want %.9f", got, want)
	}
}

func TestChatUsageTokenDetailsParsesCacheTokens(t *testing.T) {
	openai := []byte(`{"usage":{"prompt_tokens":1000,"completion_tokens":500,"prompt_tokens_details":{"cached_tokens":400}}}`)
	prompt, output, cacheRead, cacheWrite := chatUsageTokenDetails(openai)
	if prompt != 1000 || output != 500 || cacheRead != 400 || cacheWrite != 0 {
		t.Fatalf("openai usage = %d/%d/%d/%d", prompt, output, cacheRead, cacheWrite)
	}
	claude := []byte(`{"usage":{"input_tokens":800,"output_tokens":300,"cache_read_input_tokens":600,"cache_creation_input_tokens":150}}`)
	prompt, output, cacheRead, cacheWrite = chatUsageTokenDetails(claude)
	if prompt != 800 || output != 300 || cacheRead != 600 || cacheWrite != 150 {
		t.Fatalf("claude usage = %d/%d/%d/%d", prompt, output, cacheRead, cacheWrite)
	}
	gemini := []byte(`{"usageMetadata":{"promptTokenCount":900,"candidatesTokenCount":200,"cachedContentTokenCount":700}}`)
	prompt, output, cacheRead, cacheWrite = chatUsageTokenDetails(gemini)
	if prompt != 900 || output != 200 || cacheRead != 700 || cacheWrite != 0 {
		t.Fatalf("gemini usage = %d/%d/%d/%d", prompt, output, cacheRead, cacheWrite)
	}
}

func TestBuildWorkerLLMRequestNativeProtocols(t *testing.T) {
	claudeBody, claudeEndpoint := buildWorkerLLMRequest(workerModelRoute{Protocol: "claude", UpstreamModel: "claude-test"}, "", "fallback", "system", "hello", 0.2)
	if claudeEndpoint != "/v1/messages" || claudeBody["system"] != "system" || claudeBody["max_tokens"] == nil {
		t.Fatalf("unexpected Claude request: endpoint=%s body=%#v", claudeEndpoint, claudeBody)
	}
	geminiBody, geminiEndpoint := buildWorkerLLMRequest(workerModelRoute{Protocol: "gemini", UpstreamModel: "gemini-test"}, "", "fallback", "system", "hello", 0.2)
	if !strings.Contains(geminiEndpoint, "{model}:generateContent") || geminiBody["contents"] == nil || geminiBody["systemInstruction"] == nil {
		t.Fatalf("unexpected Gemini request: endpoint=%s body=%#v", geminiEndpoint, geminiBody)
	}
}

func TestExtractNativeLLMResponsesAndUsage(t *testing.T) {
	claude := []byte(`{"content":[{"type":"text","text":"Claude answer"}],"usage":{"input_tokens":10,"output_tokens":3}}`)
	if got := extractLLMText(claude); got != "Claude answer" {
		t.Fatalf("Claude text = %q", got)
	}
	if prompt, output := chatUsageTokens(claude); prompt != 10 || output != 3 {
		t.Fatalf("Claude usage = %d/%d", prompt, output)
	}
	gemini := []byte(`{"candidates":[{"content":{"parts":[{"text":"Gemini answer"}]}}],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":4}}`)
	if got := extractLLMText(gemini); got != "Gemini answer" {
		t.Fatalf("Gemini text = %q", got)
	}
	if prompt, output := chatUsageTokens(gemini); prompt != 11 || output != 4 {
		t.Fatalf("Gemini usage = %d/%d", prompt, output)
	}
}
