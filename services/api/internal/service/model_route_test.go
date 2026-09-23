package service

import (
	"testing"

	"github.com/starai/api/internal/runtime"
)

func TestEstimateRouteProviderCostIsIndependentFromModelPrice(t *testing.T) {
	route := &ModelRoute{CostRule: map[string]interface{}{
		"billing_type": "per_token", "input_cost_per_m": 0.25, "output_cost_per_m": 1.25,
	}}
	got := EstimateRouteProviderCost(route, nil, 2_000_000, 1_000_000)
	if got != 1.75 {
		t.Fatalf("provider cost = %v, want 1.75", got)
	}
}

func TestEstimateRouteProviderCostForMedia(t *testing.T) {
	route := &ModelRoute{CostRule: map[string]interface{}{"billing_type": "per_image", "unit_cost": 0.02}}
	got := EstimateRouteProviderCost(route, map[string]interface{}{"n": float64(3)}, 0, 0)
	if got != 0.06 {
		t.Fatalf("provider cost = %v, want 0.06", got)
	}
}

func TestNormalizeModelRouteDefaults(t *testing.T) {
	input := ModelRouteInput{RouteName: " Primary ", UpstreamModel: " model-a ", BaseURL: "https://example.com/", IsEnabled: true}
	if err := normalizeModelRouteInput(&input); err != nil {
		t.Fatal(err)
	}
	if input.Protocol != "openai" || input.AuthType != "bearer" || input.Weight != 100 || input.TimeoutSeconds != 120 {
		t.Fatalf("defaults not applied: %#v", input)
	}
	if input.BaseURL != "https://example.com" {
		t.Fatalf("base URL = %q", input.BaseURL)
	}
	if input.Endpoint != "" {
		t.Fatalf("blank route endpoint was replaced with %q", input.Endpoint)
	}
}

func TestDefaultModelRouteTimeoutAllowsMediaCompletion(t *testing.T) {
	if got := defaultModelRouteTimeout("images"); got != 600 {
		t.Fatalf("image timeout = %d, want 600", got)
	}
	if got := defaultModelRouteTimeout("chat_completions"); got != 120 {
		t.Fatalf("chat timeout = %d, want 120", got)
	}
}

func TestNormalizeModelRoutePreservesCustomMediaEndpoint(t *testing.T) {
	input := ModelRouteInput{
		RouteName: "Primary", UpstreamModel: "wan-v1", BaseURL: "https://example.com",
		Endpoint: "api/v1/services/aigc/video-generation/video-synthesis",
	}
	if err := normalizeModelRouteInput(&input); err != nil {
		t.Fatal(err)
	}
	if input.Endpoint != "/api/v1/services/aigc/video-generation/video-synthesis" {
		t.Fatalf("endpoint = %q", input.Endpoint)
	}
}

func TestNormalizeLegacyOpenAIProtocol(t *testing.T) {
	for _, protocol := range []string{"openai_compatible", "new_api"} {
		input := ModelRouteInput{RouteName: "Primary", Protocol: protocol, UpstreamModel: "model-a", BaseURL: "https://example.com"}
		if err := normalizeModelRouteInput(&input); err != nil {
			t.Fatal(err)
		}
		if input.Protocol != "openai" {
			t.Fatalf("protocol %q normalized to %q", protocol, input.Protocol)
		}
	}
}

func TestLegacyRouteCostInfersPerTokenBilling(t *testing.T) {
	rule := map[string]interface{}{"input_cost_per_m": 0.25, "output_cost_per_m": 1.25}
	if err := validateRouteCostRule(rule); err != nil {
		t.Fatal(err)
	}
	if rule["billing_type"] != "per_token" {
		t.Fatalf("billing type = %#v", rule["billing_type"])
	}
}

func TestDefaultRouteCostRuleFollowsModelBillingType(t *testing.T) {
	for _, billingType := range []string{"per_request", "per_image", "per_second"} {
		rule := defaultRouteCostRule(map[string]interface{}{"billing_type": billingType})
		if rule["billing_type"] != billingType || rule["unit_cost"] != float64(0) {
			t.Fatalf("billing type %q produced %#v", billingType, rule)
		}
	}
	rule := defaultRouteCostRule(map[string]interface{}{"billing_type": "dynamic"})
	if rule["billing_type"] != "per_token" {
		t.Fatalf("unsupported billing type should fall back safely: %#v", rule)
	}
}

func TestRouteFailureClassification(t *testing.T) {
	badRequest := &runtime.PlatformError{Code: "MODEL_PROVIDER_ERROR", StatusCode: 400}
	if isRouteFailoverError(badRequest) {
		t.Fatal("400 must not fail over or degrade a route")
	}
	if shouldRetrySameRoute(&runtime.PlatformError{Code: "MODEL_RATE_LIMITED", StatusCode: 429}, true) {
		t.Fatal("429 should move to another route immediately")
	}
	if !shouldRetrySameRoute(&runtime.PlatformError{Code: "MODEL_PROVIDER_ERROR", StatusCode: 503}, false) {
		t.Fatal("503 should retry the same route when configured")
	}
	if shouldRetrySameRoute(&runtime.PlatformError{Code: "MODEL_PROVIDER_ERROR", StatusCode: 502}, true) {
		t.Fatal("502 should switch failure domains before retrying the same route")
	}
	if shouldRetrySameRoute(&runtime.PlatformError{Code: "MODEL_TIMEOUT"}, false) {
		t.Fatal("a full timeout must not repeat the same slow request")
	}
}

func TestModelRouteFailoversSpreadGatewayHosts(t *testing.T) {
	routes := []ModelRoute{
		{ID: 1, BaseURL: "https://new-api.example.com/v1"},
		{ID: 2, BaseURL: "https://new-api.example.com/v1"},
		{ID: 3, BaseURL: "https://official.example.net/v1"},
		{ID: 4, BaseURL: "https://new-api.example.com/v1"},
	}
	spreadModelRouteFailureDomains(routes)
	if routes[0].ID != 1 || routes[1].ID != 3 {
		t.Fatalf("same gateway routes remained adjacent before an independent fallback: %#v", routes)
	}
}

func TestModelRouteSelectionWeightUsesObservedReliability(t *testing.T) {
	tests := []struct {
		route ModelRoute
		want  int
	}{
		{ModelRoute{Weight: 100}, 90},
		{ModelRoute{Weight: 100, SuccessCount: 90, FailureCount: 10}, 90},
		{ModelRoute{Weight: 100, FailureCount: 20}, 30},
		{ModelRoute{Weight: 50, SuccessCount: 90, FailureCount: 10}, 45},
		{ModelRoute{Weight: 0, SuccessCount: 100}, 0},
	}
	for _, test := range tests {
		if got := modelRouteSelectionWeight(test.route); got != test.want {
			t.Fatalf("selection weight = %d, want %d for %#v", got, test.want, test.route)
		}
	}
}

func TestRouteRequestAddsIdempotencyKey(t *testing.T) {
	model := &ModelFull{NewAPIExtraParams: map[string]interface{}{}}
	route := ModelRoute{Headers: map[string]interface{}{"X-Custom": "yes"}}
	extra := route.RequestExtraForRequest(model, "req_123")
	connection := extra["connection"].(map[string]interface{})
	headers := connection["headers"].(map[string]interface{})
	if headers["Idempotency-Key"] != "req_123" || headers["X-Custom"] != "yes" {
		t.Fatalf("headers = %#v", headers)
	}
}
