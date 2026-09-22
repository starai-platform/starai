package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/draw"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNormalizeProductPlanJSONUnwrapsCheckRegions(t *testing.T) {
	planRaw := map[string]interface{}{
		"shots": []interface{}{map[string]interface{}{
			"checks": []interface{}{map[string]interface{}{"region": []interface{}{[]interface{}{0.379, 0.456, 0.231, 0.149}}}},
		}},
	}
	if got := normalizeProductPlanJSON(planRaw); got != 1 {
		t.Fatalf("normalized regions = %d, want 1", got)
	}
	var plan productPlan
	if err := json.Unmarshal(mustJSON(planRaw), &plan); err != nil {
		t.Fatalf("normalized plan still fails to decode: %v", err)
	}
	if got := plan.Shots[0].Checks[0].Region; got != (productBox{0.379, 0.456, 0.231, 0.149}) {
		t.Fatalf("region = %#v", got)
	}
}

func TestProductMaskAndCompositePreserveOriginalPixels(t *testing.T) {
	base := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	draw.Draw(base, base.Bounds(), image.NewUniform(color.NRGBA{20, 180, 210, 255}), image.Point{}, draw.Src)
	// Thin product strip and bottom structure must survive a completely wrong generation.
	for y := 20; y < 55; y++ {
		base.SetNRGBA(31, y, color.NRGBA{5, 90, 120, 255})
	}
	generated := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	draw.Draw(generated, generated.Bounds(), image.NewUniform(color.NRGBA{220, 130, 100, 255}), image.Point{}, draw.Src)
	mask, err := productRegionMask(base.Bounds(), []productBox{{0, 0, 1, 0.25}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := compositeProductPixels(base, generated, mask)
	if err != nil {
		t.Fatal(err)
	}
	for y := 16; y < 64; y++ {
		for x := 0; x < 64; x++ {
			if out.NRGBAAt(x, y) != base.NRGBAAt(x, y) {
				t.Fatalf("protected pixel changed at %d,%d", x, y)
			}
		}
	}
	if out.NRGBAAt(10, 10).R != 220 {
		t.Fatal("editable area was not changed")
	}
	crop, err := cropProductPixels(base, productBox{0.25, 0.25, 0.5, 0.5})
	if err != nil {
		t.Fatal(err)
	}
	if crop.NRGBAAt(15, 10) != base.NRGBAAt(31, 26) {
		t.Fatal("crop changed source pixels")
	}
	basePNG, _ := productPNG(base)
	maskPNG, _ := productPNG(mask)
	if err := validateProductMask(basePNG, maskPNG); err != nil {
		t.Fatal(err)
	}
	wrong, _ := productPNG(generated)
	if validateProductMask(basePNG, wrong) == nil {
		t.Fatal("wrong mask size accepted")
	}
	if validateProductMask(basePNG, basePNG) == nil {
		t.Fatal("opaque mask accepted")
	}
}

func TestProductPreservingEditKeepsSourceDimensions(t *testing.T) {
	base := image.NewNRGBA(image.Rect(0, 0, 20, 20))
	generated := image.NewNRGBA(image.Rect(0, 0, 10, 10))
	draw.Draw(base, base.Bounds(), image.NewUniform(color.NRGBA{255, 255, 255, 255}), image.Point{}, draw.Src)
	draw.Draw(generated, generated.Bounds(), image.NewUniform(color.NRGBA{30, 90, 180, 255}), image.Point{}, draw.Src)
	mask, err := productRegionMask(base.Bounds(), []productBox{{0, 0, 1, 1}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := finalizeProductPixels(false, base, generated, mask, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if out.Bounds() != base.Bounds() {
		t.Fatalf("product-preserving result resized from %v to %v", base.Bounds(), out.Bounds())
	}
}

func TestProductSceneCompositionCropsWithoutUpscaling(t *testing.T) {
	generated := image.NewNRGBA(image.Rect(0, 0, 1536, 1024))
	out, err := finalizeProductPixels(true, generated, generated, nil, "16:9")
	if err != nil {
		t.Fatal(err)
	}
	if out.Bounds().Dx() != 1536 || out.Bounds().Dy() != 864 {
		t.Fatalf("16:9 output bounds = %v", out.Bounds())
	}
}

func TestProductPreservingEditCropsAfterPixelComposite(t *testing.T) {
	base := image.NewNRGBA(image.Rect(0, 0, 300, 200))
	draw.Draw(base, base.Bounds(), image.NewUniform(color.NRGBA{20, 100, 180, 255}), image.Point{}, draw.Src)
	generated := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	draw.Draw(generated, generated.Bounds(), image.NewUniform(color.NRGBA{220, 120, 20, 255}), image.Point{}, draw.Src)
	mask, err := productRegionMask(base.Bounds(), []productBox{{0, 0, 1, 0.2}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := finalizeProductPixels(false, base, generated, mask, "1:1")
	if err != nil {
		t.Fatal(err)
	}
	if out.Bounds().Dx() != out.Bounds().Dy() {
		t.Fatalf("delivery ratio was not cropped: %v", out.Bounds())
	}
	got := color.NRGBAModel.Convert(out.At(out.Bounds().Dx()/2, out.Bounds().Dy()-1)).(color.NRGBA)
	if got != base.NRGBAAt(150, 199) {
		t.Fatal("protected product pixels changed before delivery crop")
	}
}

func TestProductRatioMatches(t *testing.T) {
	bounds := image.Rect(0, 0, 6000, 4000)
	if !productRatioMatches(bounds, "auto") || !productRatioMatches(bounds, "3:2") || productRatioMatches(bounds, "1:1") {
		t.Fatal("product output ratio matching is incorrect")
	}
}

func TestProductModelWorkingImageFollowsQuality(t *testing.T) {
	original := image.NewNRGBA(image.Rect(0, 0, 6000, 4000))
	high := resizeProductModelImage(original, productModelWorkingLimit("high"))
	maxQuality := resizeProductModelImage(original, productModelWorkingLimit("max"))
	if high.Bounds().Dx() != 2048 || high.Bounds().Dy()%16 != 0 {
		t.Fatalf("unexpected high working size: %v", high.Bounds())
	}
	if maxQuality.Bounds().Dx() <= high.Bounds().Dx() || maxQuality.Bounds().Dx()%16 != 0 || maxQuality.Bounds().Dy()%16 != 0 || maxQuality.Bounds().Dx()*maxQuality.Bounds().Dy() > 8_294_400 {
		t.Fatalf("unexpected max working size: %v", maxQuality.Bounds())
	}
	small := resizeProductModelImage(image.NewNRGBA(image.Rect(0, 0, 320, 320)), productModelWorkingLimit("low"))
	if small.Bounds().Dx()%16 != 0 || small.Bounds().Dy()%16 != 0 || small.Bounds().Dx()*small.Bounds().Dy() < 655_360 {
		t.Fatalf("small working image does not meet model constraints: %v", small.Bounds())
	}
}

func TestProductHighQualityEditBaseAndMaskStayAligned(t *testing.T) {
	original := image.NewNRGBA(image.Rect(0, 0, 6000, 4000))
	base := resizeProductModelImage(original, productModelWorkingLimit("high"))
	mask, err := productRegionMask(base.Bounds(), []productBox{{0, 0, 1, 1}})
	if err != nil {
		t.Fatal(err)
	}
	encodedBase, err := productJPEGData(base)
	if err != nil {
		t.Fatal(err)
	}
	baseBytes, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(encodedBase, "data:image/jpeg;base64,"))
	if err != nil {
		t.Fatal(err)
	}
	maskBytes, err := productPNG(mask)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateProductMask(baseBytes, maskBytes); err != nil {
		t.Fatalf("high-quality edit base and mask diverged: %v", err)
	}
}

func TestProductGenerationReferencesStayWithinUpstreamLimit(t *testing.T) {
	refs := []productReference{{Role: "product"}, {Role: "pose"}}
	if got := productGenerationReferenceIndexes(refs, 0, false, false); len(got) != 1 || got[0] != 1 {
		t.Fatalf("first attempt references = %v, want pose only after base", got)
	}
	if got := productGenerationReferenceIndexes(refs, 0, false, true); len(got) != 1 || got[0] != 0 {
		t.Fatalf("repair references = %v, want original product only after candidate base", got)
	}
	if got := productGenerationReferenceIndexes([]productReference{{Role: "repair"}, {Role: "product"}}, 0, true, false); len(got) != 1 || got[0] != 1 {
		t.Fatalf("local repair references = %v, want product reference only", got)
	}
}

func TestProductReviewRequiresEveryCheck(t *testing.T) {
	checks := []productCheck{{ID: "strip"}, {ID: "sole"}}
	for _, tc := range []struct {
		raw  string
		want string
	}{
		{`{"checked":true,"checks":[{"id":"strip","status":"pass","reason":"贴条完整"},{"id":"sole","status":"pass","reason":"鞋底一致"}]}`, "passed"},
		{`{"checked":true,"checks":[{"id":"strip","status":"pass","reason":"贴条完整"},{"id":"sole","status":"fail","reason":"新增孔洞"}]}`, "failed"},
		{`{"checked":true,"checks":[{"id":"strip","status":"pass","reason":"清楚"},{"id":"strip","status":"pass","reason":"重复"}]}`, "uncertain"},
		{`{"checked":true,"checks":[{"id":"strip","status":"pass","reason":"清楚"}]}`, "uncertain"},
		{`{"checked":true,"checks":[{"id":"strip","status":"pass","reason":"清楚"},{"id":"sole","status":"uncertain","reason":"看不清"}]}`, "uncertain"},
		{`{"checked":false,"checks":[]}`, "uncertain"},
	} {
		status, _ := productReviewDecision(parseJSONish(tc.raw), checks)
		if status != tc.want {
			t.Fatalf("got %s want %s", status, tc.want)
		}
	}
	for _, next := range []float64{0, -1, math.NaN(), math.Inf(1), 10.01} {
		if productBudgetAllows(10, next, 20) {
			t.Fatalf("unsafe budget allowed: %f", next)
		}
	}
	if !productBudgetAllows(10, 10, 20) {
		t.Fatal("exact remaining budget refused")
	}
}

func TestProductRepairUsesStrictVerificationFailure(t *testing.T) {
	attempt := productAttempt{
		Status: "failed",
		Review: map[string]interface{}{
			"checked": true,
			"checks":  []interface{}{map[string]interface{}{"id": "contact", "status": "pass"}},
		},
		Verification: map[string]interface{}{
			"checked": true,
			"checks": []interface{}{map[string]interface{}{
				"id": "contact", "status": "fail", "reason": "接合处仍有穿透",
				"region": []interface{}{0.2, 0.3, 0.4, 0.2},
			}},
		},
	}
	review := productRepairReview(attempt)
	if stringAny(review["checked"]) != "true" {
		t.Fatalf("strict verification was not selected: %#v", review)
	}
	regions, err := productRepairRegions(review)
	if err != nil {
		t.Fatal(err)
	}
	if len(regions) != 1 || regions[0] != (productBox{0.2, 0.3, 0.4, 0.2}) {
		t.Fatalf("unexpected strict repair regions: %#v", regions)
	}
}

func TestNormalizeProductPlanCountDropsPlannerExtras(t *testing.T) {
	plan := productPlan{Shots: []productShot{{Title: "用户交付"}, {Title: "模型擅自增加的验证图"}}}
	if !normalizeProductPlanCount(&plan, 1) || len(plan.Shots) != 1 || plan.Shots[0].Title != "用户交付" {
		t.Fatalf("unexpected normalized plan: %#v", plan.Shots)
	}
	if normalizeProductPlanCount(&plan, 2) {
		t.Fatal("missing shots must not be synthesized")
	}
}

func TestNormalizeProductPlanBoxesConvertsCornerCoordinates(t *testing.T) {
	plan := productPlan{Shots: []productShot{{
		ProtectedRegions: []productBox{{0.45, 0.35, 0.65, 0.85}},
		Checks:           []productCheck{{Region: productBox{0.2, 0.3, 0.8, 0.7}}},
	}}}
	if converted := normalizeProductPlanBoxes(&plan); converted != 1 {
		t.Fatalf("converted %d boxes", converted)
	}
	if got := plan.Shots[0].ProtectedRegions[0]; math.Abs(got[2]-0.2) > 0.000001 || math.Abs(got[3]-0.5) > 0.000001 {
		t.Fatalf("wrong protected conversion: %v", got)
	}
	if got := plan.Shots[0].Checks[0].Region; got != (productBox{0.2, 0.3, 0.8, 0.7}) {
		t.Fatalf("valid check box was changed: %v", got)
	}
	valid := productPlan{Shots: []productShot{{EditRegions: []productBox{{0.45, 0.35, 0.2, 0.5}}}}}
	if converted := normalizeProductPlanBoxes(&valid); converted != 0 {
		t.Fatalf("valid box was changed: %#v", valid.Shots[0].EditRegions)
	}
}

func TestSetProductProcessUpdatesStableEntry(t *testing.T) {
	outputs := map[string]interface{}{}
	setProductProcess(outputs, "plan", "planning", "running", "分析中", "")
	setProductProcess(outputs, "plan", "planning", "passed", "分析完成", "")
	records, ok := outputs["product_process_log"].([]map[string]interface{})
	if !ok || len(records) != 1 {
		t.Fatalf("unexpected process records: %#v", outputs["product_process_log"])
	}
	if stringAny(records[0]["status"]) != "passed" || stringAny(records[0]["message"]) != "分析完成" || stringAny(records[0]["created_at"]) == "" {
		t.Fatalf("process record not updated: %#v", records[0])
	}
}

func TestProductResultsNeedReviewStillRequiresGeneratedImage(t *testing.T) {
	if !productResultsNeedReview([]productShotResult{{Status: "needs_review", ImageURL: "https://example.com/result.png"}}) {
		t.Fatal("generated result with review findings should be marked needs_review")
	}
	if productResultsNeedReview([]productShotResult{{Status: "uncertain"}}) {
		t.Fatal("missing image is a generation failure, not a reviewable delivery")
	}
	if productResultsNeedReview([]productShotResult{{Status: "passed", ImageURL: "https://example.com/result.png"}}) {
		t.Fatal("passed result should not need review")
	}
}

func TestProductActualChargeUsesConfiguredFloorAndRealUsage(t *testing.T) {
	if got := productActualCharge(0.06, 0); got != 0 {
		t.Fatalf("zero usage charged %v", got)
	}
	if got := productActualCharge(0.06, 0.02); got != 0.06 {
		t.Fatalf("below-floor usage charged %v", got)
	}
	if got := productActualCharge(0.06, 0.171534); got != 0.171534 {
		t.Fatalf("real usage was capped at %v", got)
	}
}

func TestProductPlanRejectsUnsupportedOrUnverifiableWork(t *testing.T) {
	refs := []productReference{{URL: "https://example.com/shoe.png", Role: "product"}, {URL: "https://example.com/pose.png", Role: "pose"}}
	plan := productPlan{ProductType: "footwear", InteractionMode: "wear", Summary: "后视上脚", Keep: []string{"贴条"}, Shots: []productShot{{Title: "上脚", Method: "edit", Source: 1, Prompt: "加小腿", EditRegions: []productBox{{0, 0, 1, 0.3}}, Checks: []productCheck{{ID: "strip", Description: "贴条不变", Reference: 1, Region: productBox{0, 0, 1, 1}}, {ID: "composition", Description: "后视", Reference: 1, Region: productBox{0, 0, 1, 1}}}}}}
	plan.Shots[0].ProtectedRegions = []productBox{{0.2, 0.4, 0.3, 0.4}}
	if err := validateProductPlan(plan, refs, 1); err != nil {
		t.Fatal(err)
	}
	plan.Shots[0].Source = 2
	if validateProductPlan(plan, refs, 1) == nil {
		t.Fatal("pose photo accepted as product truth")
	}
	plan.Shots[0].Source = 1
	plan.Shots[0].Method = "generate"
	if validateProductPlan(plan, refs, 1) == nil {
		t.Fatal("unbounded redraw accepted")
	}
	plan.Shots[0].Method = "edit"
	plan.Missing = []string{"请提供后视图"}
	if validateProductPlan(plan, refs, 1) == nil {
		t.Fatal("missing evidence accepted")
	}
	if (productBox{0, 0, math.NaN(), 1}).valid() {
		t.Fatal("NaN region accepted")
	}
}

func TestDismissProductVisibilityOnlyMissingKeepsRealEvidenceRequest(t *testing.T) {
	plan := productPlan{Missing: []string{
		"后视角无法观察到鞋身两侧标识，无法确认是否一致",
		"请提供后视图",
	}}
	if dismissed := dismissProductVisibilityOnlyMissing(&plan); dismissed != 1 {
		t.Fatalf("dismissed = %d, want 1", dismissed)
	}
	if len(plan.Missing) != 1 || plan.Missing[0] != "请提供后视图" {
		t.Fatalf("real missing evidence was removed: %#v", plan.Missing)
	}
}

func TestProductReviewAcceptsIdentityDetailHiddenByRequestedView(t *testing.T) {
	checks := []productCheck{
		{ID: "identity_logo", Description: "侧面标识位置一致"},
		{ID: "composition", Description: "后视构图正确"},
	}
	review := parseJSONish(`{"checked":true,"checks":[{"id":"identity_logo","status":"uncertain","reason":"后视角无法观察到鞋身两侧标识，无法确认是否一致"},{"id":"composition","status":"pass","reason":"后视构图正确"}]}`)
	status, issues := productReviewDecision(review, checks)
	if status != "passed" || len(issues) != 0 {
		t.Fatalf("status=%s issues=%v", status, issues)
	}
}

func TestNormalizePlannerBoxSupportsThousandGridCorners(t *testing.T) {
	got, converted := normalizePlannerBox(productBox{252, 317, 445, 805})
	if !converted {
		t.Fatal("1000-grid corner box was not converted")
	}
	want := productBox{0.252, 0.317, 0.193, 0.488}
	for index := range want {
		if math.Abs(got[index]-want[index]) > 0.000001 {
			t.Fatalf("box = %v, want %v", got, want)
		}
	}
}

func TestFallbackProductPlanMakesSimpleEditRunnable(t *testing.T) {
	refs := []productReference{{URL: "https://example.com/product.png", Role: "product"}}
	plan, err := fallbackProductPlan(refs, 1, "background", "更换干净背景")
	if err != nil {
		t.Fatal(err)
	}
	if plan.ProductType != "other" || plan.InteractionMode != "background" || len(plan.Shots) != 1 || plan.Shots[0].Source != 1 {
		t.Fatalf("unexpected fallback: %#v", plan)
	}
	if err := validateProductPlan(plan, refs, 1); err != nil {
		t.Fatalf("fallback plan invalid: %v", err)
	}
}

func TestFallbackProductPlanRejectsUnidentifiedInteraction(t *testing.T) {
	refs := []productReference{{URL: "https://example.com/product.png", Role: "product"}, {URL: "https://example.com/pose.png", Role: "pose"}}
	if _, err := fallbackProductPlan(refs, 1, "wear", "生成自然上脚图"); err == nil {
		t.Fatal("interaction fallback must stop before image generation")
	}
}

func TestEnsureProductCompositionChecksAddsCanonicalCheck(t *testing.T) {
	plan := productPlan{Shots: []productShot{{Source: 1, Checks: []productCheck{{ID: "heel", Description: "后跟保持", Reference: 1, Region: productBox{0, 0, 0.5, 1}}}}}}
	if added := ensureProductCompositionChecks(&plan, "保持鞋子后视角，增加穿鞋小腿"); added != 1 {
		t.Fatalf("added = %d", added)
	}
	checks := plan.Shots[0].Checks
	if len(checks) != 2 || checks[1].ID != "composition" || checks[1].Reference != 1 || checks[1].Region != (productBox{0, 0, 1, 1}) {
		t.Fatalf("unexpected checks: %#v", checks)
	}
	if added := ensureProductCompositionChecks(&plan, "same"); added != 0 || len(plan.Shots[0].Checks) != 2 {
		t.Fatalf("composition check duplicated: %#v", plan.Shots[0].Checks)
	}
}

func TestNormalizeProductCheckIDsCanonicalizesCompositionAlias(t *testing.T) {
	plan := productPlan{Shots: []productShot{{Checks: []productCheck{
		{ID: "composition_view", Description: "后视构图"},
		{ID: "identity", Description: "商品一致"},
	}}}}
	if changed := normalizeProductCheckIDs(&plan); changed != 1 {
		t.Fatalf("changed = %d, want 1", changed)
	}
	if plan.Shots[0].Checks[0].ID != "composition" {
		t.Fatalf("composition alias was not canonicalized: %#v", plan.Shots[0].Checks)
	}
	if added := ensureProductCompositionChecks(&plan, "保持后视角"); added != 0 {
		t.Fatalf("canonical composition check was duplicated: %#v", plan.Shots[0].Checks)
	}
}

func TestPlannerCompositionAliasRemainsValidAfterPresetChecks(t *testing.T) {
	plan := productPlan{
		ProductType: "footwear", InteractionMode: "wear", Summary: "后视上脚", Keep: []string{"后跟", "鞋底", "针织纹理"},
		Shots: []productShot{{
			Title: "后视上脚", Method: "edit", Source: 1, Prompt: "保持后视角并自然穿入脚踝",
			EditRegions: []productBox{{0, 0, 1, 1}}, ProtectedRegions: []productBox{{0.2, 0.3, 0.5, 0.5}},
			Checks: []productCheck{
				{ID: "identity_material", Description: "针织纹理一致", Reference: 1, Region: productBox{0.2, 0.3, 0.5, 0.5}},
				{ID: "identity_sole", Description: "鞋底一致", Reference: 1, Region: productBox{0.2, 0.6, 0.5, 0.2}},
				{ID: "composition_view", Description: "保持后视构图", Reference: 1, Region: productBox{0, 0, 1, 1}},
			},
		}},
	}
	normalizeProductCheckIDs(&plan)
	ensureProductCompositionChecks(&plan, "保持鞋子后视角")
	ensureProductInteractionChecks(&plan)
	ensureProductWearChecks(&plan)
	ensureProductIdentityChecks(&plan)
	refs := []productReference{{URL: "https://example.com/shoe.jpg", Role: "product"}, {URL: "https://example.com/pose.jpg", Role: "pose"}}
	if err := validateProductPlan(plan, refs, 1); err != nil {
		t.Fatalf("normalized planner result should pass: %v; checks=%#v", err, plan.Shots[0].Checks)
	}
}

func TestEnsureProductWearChecksReplacePlannerContactChecks(t *testing.T) {
	plan := productPlan{ProductType: "footwear", InteractionMode: "wear", Shots: []productShot{{
		Title:  "后视上脚",
		Source: 1,
		Prompt: "添加穿鞋小腿，保留原有独立鞋舌",
		Checks: []productCheck{
			{ID: "strip", Description: "后跟贴条不变", Reference: 1, Region: productBox{0.2, 0.4, 0.2, 0.3}},
			{ID: "leg_contact_left", Description: "左侧小腿接触自然", Reference: 2, Region: productBox{0.2, 0.1, 0.5, 0.4}},
			{ID: "leg_contact_right", Description: "右侧小腿接触自然", Reference: 2, Region: productBox{0.6, 0.1, 0.3, 0.4}},
			{ID: "composition", Description: "构图正确", Reference: 1, Region: productBox{0, 0, 1, 1}},
		},
	}}}
	if changed := ensureProductWearChecks(&plan); changed != 1 {
		t.Fatalf("changed = %d", changed)
	}
	ids := map[string]bool{}
	for _, check := range plan.Shots[0].Checks {
		ids[check.ID] = true
	}
	if ids["leg_contact_left"] || ids["leg_contact_right"] || !ids["wear_contact_left"] || !ids["wear_contact_right"] || !ids["wear_tongue_placement"] || !ids["composition"] || !ids["strip"] {
		t.Fatalf("unexpected wear checks: %#v", plan.Shots[0].Checks)
	}
	if constraint := productWearGenerationConstraint(plan); !strings.Contains(constraint, "不能把鞋舌完全抹掉") || !strings.Contains(constraint, "脚踝朝鞋头的前侧") {
		t.Fatalf("missing physical constraint: %q", constraint)
	}
}

func TestProductWearChecksDoNotInventUnobservedTongueRequirement(t *testing.T) {
	plan := productPlan{ProductType: "footwear", InteractionMode: "wear", Keep: []string{"后跟贴条", "鞋底结构"}, Shots: []productShot{{
		Source: 1,
		Prompt: "保持后视角并自然穿入脚踝",
		Checks: []productCheck{{ID: "composition", Description: "后视上脚构图", Reference: 1, Region: productBox{0, 0, 1, 1}}},
	}}}
	if changed := ensureProductWearChecks(&plan); changed != 1 {
		t.Fatalf("changed = %d", changed)
	}
	for _, check := range plan.Shots[0].Checks {
		if check.ID == "wear_tongue_placement" {
			t.Fatalf("unobserved tongue became a hard requirement: %#v", plan.Shots[0].Checks)
		}
	}
	if constraint := productWearGenerationConstraint(plan); strings.Contains(constraint, "鞋舌主体") || !strings.Contains(constraint, "当前视角实际可见") || !strings.Contains(constraint, "无需强行展示") {
		t.Fatalf("unexpected evidence-free wear constraint: %q", constraint)
	}
}

func TestEnsureProductIdentityChecksAddsHardSameProductGate(t *testing.T) {
	plan := productPlan{InteractionMode: "wear", ProductType: "footwear", Shots: []productShot{{
		Source: 1,
		Checks: []productCheck{{ID: "composition", Description: "后视构图", Reference: 1, Region: productBox{0, 0, 1, 1}}},
	}}}
	if changed := ensureProductIdentityChecks(&plan); changed != 1 {
		t.Fatalf("changed = %d", changed)
	}
	checks := plan.Shots[0].Checks
	if len(checks) != 2 || checks[1].ID != "identity_product" || checks[1].Reference != 1 {
		t.Fatalf("missing product identity check: %#v", checks)
	}
	if changed := ensureProductIdentityChecks(&plan); changed != 1 {
		t.Fatalf("reapplying gate changed = %d", changed)
	}
	count := 0
	for _, check := range plan.Shots[0].Checks {
		if check.ID == "identity_product" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("identity check duplicated: %#v", plan.Shots[0].Checks)
	}
}

func TestProductCategoryPacksDoNotApplyFootwearRulesToOtherProducts(t *testing.T) {
	plan := productPlan{ProductType: "apparel", InteractionMode: "wear", Shots: []productShot{{Source: 1, Checks: []productCheck{{ID: "composition", Description: "服装穿戴构图", Reference: 1, Region: productBox{0, 0, 1, 1}}}}}}
	if changed := ensureProductInteractionChecks(&plan); changed != 1 {
		t.Fatalf("generic interaction checks changed = %d", changed)
	}
	if changed := ensureProductWearChecks(&plan); changed != 0 {
		t.Fatalf("footwear checks applied to apparel: %d", changed)
	}
	ids := map[string]bool{}
	for _, check := range plan.Shots[0].Checks {
		ids[check.ID] = true
	}
	if !ids["interaction_contact"] || !ids["interaction_visibility"] || ids["wear_tongue_placement"] {
		t.Fatalf("unexpected category checks: %#v", plan.Shots[0].Checks)
	}
}

func TestProductLocalizationUsesCandidateCoordinates(t *testing.T) {
	checks := []productCheck{{ID: "logo"}, {ID: "contact"}}
	regions, err := productLocalizationRegions(parseJSONish(`{"located":true,"regions":[{"id":"logo","region":[0.1,0.2,0.4,0.6]},{"id":"contact","region":[0.7,0.6,0.95,0.9]},{"id":"unknown","region":[0,0,1,1]}]}`), checks)
	if err != nil {
		t.Fatal(err)
	}
	if regions["logo"] != (productBox{0.1, 0.2, 0.4, 0.6}) {
		t.Fatalf("valid candidate region changed: %v", regions["logo"])
	}
	if got := regions["contact"]; math.Abs(got[2]-0.25) > 0.000001 || math.Abs(got[3]-0.3) > 0.000001 {
		t.Fatalf("corner coordinates not normalized: %v", got)
	}
	padded := padProductBox(productBox{0.02, 0.03, 0.2, 0.2}, 0.08)
	if padded[0] != 0 || padded[1] != 0 || padded[2] <= 0.2 || padded[3] <= 0.2 {
		t.Fatalf("candidate crop padding invalid: %v", padded)
	}
	if _, err := productLocalizationRegions(parseJSONish(`{"located":false,"regions":[]}`), checks); err == nil {
		t.Fatal("unlocated candidate accepted")
	}
}

func TestProductCategoryRuleAcceptsChineseCategory(t *testing.T) {
	if rule := productCategoryRule(nil, "服装/上衣"); !strings.Contains(rule, "领口") {
		t.Fatalf("Chinese apparel category not normalized: %q", rule)
	}
	runtime := map[string]interface{}{"product_category_rules": map[string]interface{}{"apparel": "自定义服装检查"}}
	if rule := productCategoryRule(runtime, "服装"); !strings.Contains(rule, "自定义服装检查") {
		t.Fatalf("configured category rule not used: %q", rule)
	}
}

func TestMainstreamProductCategoriesAreCanonicalized(t *testing.T) {
	cases := map[string]string{
		"运动鞋": "footwear", "连衣裙": "apparel", "腕表": "watch", "墨镜": "eyewear",
		"护肤品": "cosmetics", "冰箱": "appliance", "沙发": "furniture", "餐具": "kitchenware",
		"咖啡饮料": "beverage", "积木玩具": "toy", "汽车用品": "automotive", "宠物用品": "pet",
		"办公文具": "stationery", "母婴用品": "baby", "健康用品": "health", "unknown product": "other",
	}
	for input, expected := range cases {
		if got := canonicalProductCategory(input); got != expected {
			t.Errorf("canonicalProductCategory(%q)=%q, want %q", input, got, expected)
		}
		if rule := productCategoryRule(nil, input); !strings.Contains(rule, "只补用户未说明部分") {
			t.Errorf("category %q has no supplemental rule: %q", input, rule)
		}
	}
}

func TestProductConstraintContextKeepsPriorityAndConfiguredPreset(t *testing.T) {
	runtime := map[string]interface{}{"product_operation_rules": map[string]interface{}{"wear": "后台穿戴补充"}}
	plan := productPlan{ProductType: "鞋类", InteractionMode: "wear", Keep: []string{"后跟贴条"}, Change: []string{"增加小腿"}}
	context := productConstraintContext(runtime, "wear", plan, "鞋子改成红色")
	for _, expected := range []string{"用户明确要求", "鞋子改成红色", "参考图中可观察的事实", "预设只补充", "后台穿戴补充", "footwear", "后跟贴条", "增加小腿"} {
		if !strings.Contains(context, expected) {
			t.Errorf("constraint context missing %q: %s", expected, context)
		}
	}
}

func TestLocalRepairRequiresMarkedRepairReference(t *testing.T) {
	inputs := map[string]interface{}{
		"product_preset":     "local_repair",
		"product_references": []map[string]interface{}{{"url": "https://example.com/repair.png", "role": "repair", "edit_regions": []productBox{{0.4, 0.5, 0.2, 0.2}}}},
	}
	refs, err := productReferences(inputs)
	if err != nil || len(refs) != 1 || refs[0].Role != "repair" {
		t.Fatalf("valid local repair rejected: refs=%#v err=%v", refs, err)
	}
	inputs["product_references"] = []map[string]interface{}{{"url": "https://example.com/repair.png", "role": "repair"}}
	if _, err := productReferences(inputs); err == nil {
		t.Fatal("local repair without a marked region was accepted")
	}
}

func TestLocalRepairChecksAndPresetAreDeterministic(t *testing.T) {
	plan := productPlan{Shots: []productShot{{Source: 1, Checks: []productCheck{{ID: "composition", Description: "整体不变", Reference: 1, Region: productBox{0, 0, 1, 1}}}}}}
	if changed := ensureProductLocalRepairChecks(&plan, 1, []productBox{{0.3, 0.4, 0.1, 0.1}, {0.5, 0.5, 0.2, 0.2}}); changed != 1 {
		t.Fatalf("local repair checks changed=%d", changed)
	}
	ids := map[string]bool{}
	for _, check := range plan.Shots[0].Checks {
		ids[check.ID] = true
	}
	if !ids["local_repair"] || !ids["outside_preservation"] || canonicalProductPreset("repair") != "local_repair" || !strings.Contains(productPresetRule(nil, "local_repair"), "圈外像素") {
		t.Fatalf("local repair contract incomplete: %#v", plan.Shots[0].Checks)
	}
}

func TestLocalRepairPreservesOriginalResolutionAndOutsidePixels(t *testing.T) {
	original := image.NewNRGBA(image.Rect(0, 0, 200, 100))
	draw.Draw(original, original.Bounds(), image.NewUniform(color.NRGBA{20, 30, 40, 255}), image.Point{}, draw.Src)
	modelBase := resizeProductImage(original, 100, false)
	generated := image.NewNRGBA(modelBase.Bounds())
	draw.Draw(generated, generated.Bounds(), image.NewUniform(color.NRGBA{200, 100, 50, 255}), image.Point{}, draw.Src)
	modelMask, _ := productRegionMask(modelBase.Bounds(), []productBox{{0.4, 0.3, 0.2, 0.4}})
	originalMask, _ := productRegionMask(original.Bounds(), []productBox{{0.4, 0.3, 0.2, 0.4}})
	out, err := finalizeProductLocalRepair(original, modelBase, generated, modelMask, originalMask)
	if err != nil {
		t.Fatal(err)
	}
	if out.Bounds() != original.Bounds() || color.NRGBAModel.Convert(out.At(10, 10)).(color.NRGBA) != original.NRGBAAt(10, 10) {
		t.Fatalf("original size or outside pixels changed: bounds=%v pixel=%v", out.Bounds(), out.At(10, 10))
	}
	if color.NRGBAModel.Convert(out.At(100, 50)).(color.NRGBA).R != 200 {
		t.Fatal("selected repair region was not replaced")
	}
}

func TestProductRepairCannotUnlockProtectedOrCorrectRegions(t *testing.T) {
	b := image.Rect(0, 0, 100, 100)
	mask, err := protectedProductMask(b, []productBox{{0, 0, 1, 0.5}}, []productBox{{0.2, 0.2, 0.2, 0.2}}, []productBox{{0.1, 0.1, 0.3, 0.3}})
	if err != nil {
		t.Fatal(err)
	}
	if mask.NRGBAAt(30, 30).A != 255 {
		t.Fatal("protected product unlocked")
	}
	if mask.NRGBAAt(80, 20).A != 255 {
		t.Fatal("previously correct editable area unlocked")
	}
	if mask.NRGBAAt(15, 15).A != 0 {
		t.Fatal("actual defect cannot be edited")
	}
	if _, err := productRepairRegions(parseJSONish(`{"checks":[{"status":"fail"}]}`)); err == nil {
		t.Fatal("unlocated defect accepted")
	}
}

func TestProductEditUploadsActualMask(t *testing.T) {
	base := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	mask, _ := productRegionMask(base.Bounds(), []productBox{{0, 0, 1, 0.25}})
	b, _ := productPNG(base)
	m, _ := productPNG(mask)
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
			return
		}
		defer r.MultipartForm.RemoveAll()
		if r.URL.Path != "/v1/images/edits" || len(r.MultipartForm.File["mask"]) != 1 || len(r.MultipartForm.File["image[]"]) != 2 {
			t.Error("missing edit files")
		}
		if r.FormValue("mask") != "" {
			t.Error("mask leaked as a text parameter")
		}
		w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()
	payload := map[string]interface{}{"model": "gpt-image-2", "mask": productDataURL(m)}
	_, _, err := postOpenAIImagesUpstream(context.Background(), connectionConfig{BaseURL: server.URL}, "/v1/images/edits", payload, []string{productDataURL(b), productDataURL(b)}, nil, time.Second)
	if err != nil || !called {
		t.Fatalf("upload failed: %v", err)
	}
	if payload["mask"] == nil {
		t.Fatal("caller payload mutated")
	}
	_, _, err = postOpenAIImagesUpstream(context.Background(), connectionConfig{BaseURL: server.URL}, "/v1/images/edits", payload, nil, nil, time.Second)
	if err == nil {
		t.Fatal("mask without base allowed")
	}
}

func TestProductModelResizeKeepsBaseAndMaskAligned(t *testing.T) {
	base := image.NewNRGBA(image.Rect(0, 0, 2000, 1000))
	mask, err := productRegionMask(base.Bounds(), []productBox{{0, 0, 0.5, 1}})
	if err != nil {
		t.Fatal(err)
	}
	resized := resizeProductImage(base, 1536, false)
	resizedMask := resizeProductImage(mask, 1536, true)
	if resized.Bounds().Dx() != 1536 || resized.Bounds().Dy() != 768 || resized.Bounds() != resizedMask.Bounds() {
		t.Fatal("mask and base dimensions diverged")
	}
	if base.Bounds().Dx() != 2000 {
		t.Fatal("original dimensions changed")
	}
	_, _, _, alpha := resizedMask.At(1200, 300).RGBA()
	if alpha != 65535 {
		t.Fatal("mask lost protected alpha")
	}
}
