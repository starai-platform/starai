package service

import (
	"math"
	"strings"
	"testing"
)

func TestProductRequestBounds(t *testing.T) {
	input := map[string]interface{}{"prompt": "后视上脚，保留后跟贴条", "product_preset": "wear", "count": 1.0, "max_repairs": 2.0, "review_mode": "strict"}
	if err := validateProductParameters(input); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		key   string
		value interface{}
	}{
		{"count", 0.0}, {"count", 7.0}, {"count", 1.5}, {"max_repairs", 3.0}, {"max_repairs", -1.0}, {"product_preset", "unknown"}, {"review_mode", "unknown"},
	} {
		next := copyAgentMap(input)
		next[tc.key] = tc.value
		if validateProductParameters(next) == nil {
			t.Fatalf("accepted %s=%v", tc.key, tc.value)
		}
	}
}

func TestProductPresetFillsOptionalPrompt(t *testing.T) {
	input := map[string]interface{}{"prompt": "", "count": 1.0, "max_repairs": 1.0, "product_preset": "auto_showcase"}
	if err := validateProductParameters(input); err != nil {
		t.Fatal(err)
	}
	if stringValue(input["prompt"]) == "" || stringValue(input["product_preset"]) != "auto_showcase" {
		t.Fatalf("preset defaults were not applied: %#v", input)
	}
	custom := map[string]interface{}{"prompt": "", "count": 1.0, "max_repairs": 1.0, "product_preset": "custom"}
	if validateProductParameters(custom) == nil {
		t.Fatal("custom preset accepted without a prompt")
	}
}

func TestLocalRepairPresetForcesSingleOriginalSizeOutput(t *testing.T) {
	input := map[string]interface{}{"prompt": "", "count": 4.0, "max_repairs": 1.0, "product_preset": "local_repair", "aspect_ratio": "16:9"}
	if err := validateProductParameters(input); err != nil {
		t.Fatal(err)
	}
	if floatValue(input["count"]) != 1 || stringValue(input["aspect_ratio"]) != "auto" || !strings.Contains(stringValue(input["prompt"]), "圈选") {
		t.Fatalf("local repair defaults were not applied: %#v", input)
	}
}

func TestProductPriceTotal(t *testing.T) {
	if got := productPriceTotal(0.1, 0.2, 3); math.Abs(got-0.7) > 0.000000001 {
		t.Fatalf("price total = %v", got)
	}
	if got := productBillingReservation(0.7, 1.2); got != 1.2 {
		t.Fatalf("billing reservation = %v, want execution budget", got)
	}
	if got := productBillingReservation(0.7, 0.5); got != 0.7 {
		t.Fatalf("billing reservation = %v, want configured floor", got)
	}
}

func TestProductModelAspectRatios(t *testing.T) {
	ratios := productModelAspectRatios([]byte(`{"properties":{"aspect_ratio":{"enum":["auto","1:1","16:9"]}}}`))
	if len(ratios) != 3 || !productStringInSlice("16:9", ratios) || productStringInSlice("9:16", ratios) {
		t.Fatalf("unexpected ratios: %#v", ratios)
	}
}

func TestProductModelQualityFollowsCapability(t *testing.T) {
	schema25 := []byte(`{"properties":{"quality":{"enum":["auto","low","medium","high","xhigh","max"]},"aspect_ratio":{"enum":["1:1","16:9"]}}}`)
	qualities := productModelQualities(schema25)
	if len(qualities) != 6 || productDefaultQuality(qualities, []byte(`{"quality":"auto"}`), true) != "xhigh" || productDefaultQuality(qualities, []byte(`{"quality":"auto"}`), false) != "high" {
		t.Fatalf("unexpected GPT Image 2.5 quality defaults: %#v", qualities)
	}
	qualities2 := productModelQualities(nil)
	if len(qualities2) != 1 || qualities2[0] != "auto" || productDefaultQuality(qualities2, []byte(`{"quality":"1K"}`), true) != "auto" {
		t.Fatalf("unexpected GPT Image 2 qualities: %#v", qualities2)
	}
	ratios := productModelAspectRatios(schema25)
	if ratios[0] != "auto" || productDefaultAspectRatio(ratios, []byte(`{"aspect_ratio":"auto"}`), false) != "1:1" || productDefaultAspectRatio(ratios, nil, true) != "auto" {
		t.Fatalf("unexpected product ratio defaults: %#v", ratios)
	}
}

func TestProductRegionsStayInsideOriginal(t *testing.T) {
	if err := validateProductRegions([][]float64{{0.2, 0.3, 0.1, 0.4}}); err != nil {
		t.Fatal(err)
	}
	for _, b := range [][]float64{{0, 0, 1, 1, 1}, {0, 0, 1}, {0, 0, 0, 1}, {0.9, 0, 0.2, 1}, {0, 0, math.NaN(), 1}} {
		if validateProductRegions([][]float64{b}) == nil {
			t.Fatalf("invalid region accepted: %v", b)
		}
	}
}
