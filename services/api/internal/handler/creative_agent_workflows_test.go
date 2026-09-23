package handler

import (
	"math"
	"strings"
	"testing"

	"github.com/starai/api/internal/service"
)

func TestCreativeAgentWorkflowCatalogAndInputBoundary(t *testing.T) {
	description := "上传商品图生成主图"
	items := []service.WorkflowDTO{
		{Code: "general_creative_agent", Name: "Agent", IsEnabled: true},
		{Code: "disabled", Name: "Disabled", IsEnabled: false},
		{Code: "internal", Name: "Internal", IsEnabled: true, RuntimeConfig: map[string]interface{}{"agent_callable": false}},
		{
			Code: "ecommerce_image", Name: "电商一键出图", Description: &description, Category: "image", IsEnabled: true,
			RuntimeConfig: map[string]interface{}{"generation_type": "image"},
			InputSchema: map[string]interface{}{
				"type": "object", "required": []interface{}{"product", "reference_images"},
				"properties": map[string]interface{}{
					"product":          map[string]interface{}{"type": "string", "title": "商品信息"},
					"reference_images": map[string]interface{}{"type": "array", "title": "商品图"},
					"count":            map[string]interface{}{"type": "integer", "enum": []interface{}{float64(1), float64(2)}, "default": float64(1)},
				},
			},
		},
	}
	catalog := creativeAgentWorkflowCapabilities(items)
	if len(catalog) != 1 || catalog[0].Code != "ecommerce_image" || catalog[0].Executor != "workflow" || catalog[0].GenerationType != "image" {
		t.Fatalf("unexpected catalog: %#v", catalog)
	}
	prompt := creativeAgentWorkflowCatalogPrompt(catalog)
	if !strings.Contains(prompt, "ecommerce_image") || !strings.Contains(prompt, "不得自行串联多个收费工作流") || strings.Contains(prompt, "general_creative_agent") || strings.Contains(prompt, "agent_callable") {
		t.Fatalf("catalog prompt leaked or omitted capabilities: %s", prompt)
	}
	inputs := creativeAgentWorkflowInputs(catalog[0].definition, map[string]interface{}{
		"product": "保温杯", "count": float64(2), "model_code": "forbidden", "reference_images": []interface{}{"https://untrusted.invalid/a.png"}, "unknown": true,
	})
	if inputs["product"] != "保温杯" || inputs["count"] != float64(2) || inputs["model_code"] != nil || inputs["reference_images"] != nil || inputs["unknown"] != nil {
		t.Fatalf("workflow input boundary failed: %#v", inputs)
	}
	inputs["reference_images"] = []string{}
	if missing := creativeAgentWorkflowMissing(catalog[0].definition, inputs); len(missing) != 1 || missing[0] != "商品图" {
		t.Fatalf("empty required asset list was accepted: %#v", missing)
	}
	creativeAgentSetWorkflowAssetInputs(inputs, creativeAgentWorkflowProperties(catalog[0].definition.InputSchema), []string{"asset_1"}, []string{"https://trusted.example/product.png"}, nil, nil)
	if missing := creativeAgentWorkflowMissing(catalog[0].definition, inputs); len(missing) != 0 {
		t.Fatalf("server-provided asset did not satisfy schema: %#v", missing)
	}
}

func TestCreativeAgentWorkflowOutcomesNeedEnoughEvidence(t *testing.T) {
	catalog := []creativeAgentWorkflowCapability{{Code: "few"}, {Code: "proven"}}
	creativeAgentApplyWorkflowOutcomes(catalog, map[string]service.WorkflowOutcomeStat{
		"few":    {RecentRuns: 2, SuccessRate: 1, AvgDurationMS: 100},
		"proven": {RecentRuns: 10, SuccessRate: 0.8, AvgDurationMS: 2500, FeedbackSamples: 3.25, SatisfactionRate: 0.72},
	})
	if catalog[0].SuccessRate != nil || catalog[0].RecentRuns != 0 {
		t.Fatalf("small sample leaked into planner catalog: %#v", catalog[0])
	}
	if catalog[1].SuccessRate == nil || *catalog[1].SuccessRate != 0.8 || catalog[1].RecentRuns != 10 || catalog[1].AvgDurationMS != 2500 || catalog[1].SatisfactionRate == nil || *catalog[1].SatisfactionRate != 0.72 {
		t.Fatalf("outcome feedback missing: %#v", catalog[1])
	}
	if prompt := creativeAgentWorkflowCatalogPrompt(catalog); !strings.Contains(prompt, "不能替代能力匹配") || !strings.Contains(prompt, "用户质量反馈") {
		t.Fatalf("planner outcome guard missing: %s", prompt)
	}
}

func TestCreativeAgentRouteMetadataIsBoundedAndAuditable(t *testing.T) {
	catalog := creativeAgentWorkflowCapabilities([]service.WorkflowDTO{
		{Code: "ecommerce_image", Name: "电商一键出图", IsEnabled: true},
		{Code: "photo_studio", Name: "AI 写真馆", IsEnabled: true},
	})
	plan := map[string]interface{}{"intent": "workflow", "workflow_code": "ecommerce_image", "needs_confirm": true, "model_selection_reason": "工作流配置"}
	route := map[string]interface{}{
		"route_confidence": 0.4, "route_reason": strings.Repeat("路", 300),
		"workflow_candidates": []interface{}{
			map[string]interface{}{"code": "ecommerce_image", "score": 0.4, "reason": "商品图"},
			map[string]interface{}{"code": "photo_studio", "score": 0.35},
			map[string]interface{}{"code": "missing", "score": 0.9},
		},
	}
	creativeAgentApplyRouteMetadata(plan, route, catalog, "photo_studio")
	if len([]rune(stringAny(plan["route_reason"]))) != 240 || plan["route_changed"] != true || !creativeAgentRouteNeedsClarification(plan) {
		t.Fatalf("route metadata was not normalized: %#v", plan)
	}
	if candidates, _ := plan["workflow_candidates"].([]interface{}); len(candidates) != 2 {
		t.Fatalf("unavailable candidate leaked: %#v", candidates)
	}
	event := creativeAgentRouteEvent(plan, "photo_studio")
	if event == nil || event["type"] != "creative_agent_route" || event["low_confidence"] != true || event["previous_workflow_code"] != "photo_studio" {
		t.Fatalf("unexpected route event: %#v", event)
	}
}

func TestCreativeAgentWorkflowRevisionTracksExecutableConfiguration(t *testing.T) {
	base := &service.WorkflowDTO{
		Code: "photo_studio", Nodes: []service.WorkflowNode{{ID: "generate", Type: "image"}},
		InputSchema:   map[string]interface{}{"type": "object", "properties": map[string]interface{}{"count": map[string]interface{}{"type": "integer"}}},
		PriceRule:     map[string]interface{}{"billing_type": "per_request", "unit_price": 1.0},
		RuntimeConfig: map[string]interface{}{"generation_type": "image", "model_code": "image_a"},
	}
	first := creativeAgentWorkflowRevision(base)
	base.RuntimeConfig["product_pricing"] = map[string]interface{}{"display": true}
	if got := creativeAgentWorkflowRevision(base); got != first {
		t.Fatalf("derived display pricing changed revision: %s != %s", got, first)
	}
	base.PriceRule["unit_price"] = 2.0
	if got := creativeAgentWorkflowRevision(base); got == first {
		t.Fatal("billing change did not invalidate confirmed workflow revision")
	}
}

func TestCreativeAgentModelRevisionTracksCapabilityAndPriceNotRoute(t *testing.T) {
	model := &service.ModelFull{
		ModelDTO: service.ModelDTO{
			Code: "video_a", Category: "video",
			InputSchema:   map[string]interface{}{"properties": map[string]interface{}{"duration": map[string]interface{}{"enum": []interface{}{8}}}},
			DefaultParams: map[string]interface{}{"duration": 8},
			PriceRule:     map[string]interface{}{"billing_type": "per_second", "unit_price": 0.5},
		},
		RequestMode: "video", NewAPIEndpoint: "/v1/video/a",
		RuntimeRule: map[string]interface{}{"video": map[string]interface{}{"upload_profile": "image"}},
	}
	first := creativeAgentModelRevision(model)
	model.NewAPIEndpoint = "/v1/video/healthy-route"
	if got := creativeAgentModelRevision(model); got != first {
		t.Fatalf("provider route change invalidated the confirmation: %s != %s", got, first)
	}
	model.PriceRule["unit_price"] = 0.6
	if got := creativeAgentModelRevision(model); got == first {
		t.Fatal("billing change did not invalidate the confirmed model revision")
	}
}

func TestCreativeAgentModelCostCoversRequestedOutputs(t *testing.T) {
	models := &service.ModelService{}
	video := &service.ModelFull{ModelDTO: service.ModelDTO{PriceRule: map[string]interface{}{"billing_type": "per_second", "unit_price": 0.5}}, RequestMode: "video"}
	videoPlan := map[string]interface{}{"intent": "workflow", "params": map[string]interface{}{"duration": 8, "storyboard_grid": 3}}
	if got, ok := creativeAgentEstimatedModelCost(models, video, videoPlan); !ok || got != 12 {
		t.Fatalf("video workflow cost = %v, available=%v; want 12, true", got, ok)
	}

	image := &service.ModelFull{ModelDTO: service.ModelDTO{PriceRule: map[string]interface{}{"billing_type": "per_image", "unit_price": 0.2}}, RequestMode: "images"}
	documentPlan := map[string]interface{}{"intent": "workflow", "params": map[string]interface{}{"content_layout": "document_pages", "document_page_count": 4, "count": 1}}
	if got, ok := creativeAgentEstimatedModelCost(models, image, documentPlan); !ok || math.Abs(got-0.8) > 0.000000001 {
		t.Fatalf("document image cost = %v, available=%v; want 0.8, true", got, ok)
	}
	directPlan := map[string]interface{}{"intent": "image", "params": map[string]interface{}{"count": 3}}
	if got, ok := creativeAgentEstimatedModelCost(models, image, directPlan); !ok || math.Abs(got-0.6) > 0.000000001 {
		t.Fatalf("direct image cost = %v, available=%v; want 0.6, true", got, ok)
	}
}

func TestCreativeAgentWorkflowRouteMetadataContract(t *testing.T) {
	plan := map[string]interface{}{
		"intent": "workflow", "workflow_code": "ecommerce_image", "route_confidence": 0.9, "route_reason": "需要商品套图",
		"workflow_candidates": []interface{}{map[string]interface{}{"code": "ecommerce_image", "score": 0.9}},
	}
	if !isCreativeAgentPlan(plan) || creativeAgentRouteConfidence(plan) != 0.9 {
		t.Fatalf("valid route metadata rejected: %#v", plan)
	}
	plan["route_confidence"] = 1.1
	if isCreativeAgentPlan(plan) {
		t.Fatal("out-of-range route confidence accepted")
	}
}
