package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestCommerceLatestParametersOverrideWithoutMutatingOriginal(t *testing.T) {
	inputs := map[string]interface{}{"creative_scene": "main_image", "count": 4, "n": 4, "aspect_ratio": "1:1", "size": "1024x1024", "negative_prompt": "禁止文字"}
	original := copyMap(inputs)
	analysis := parseJSONish(`{"candidates":[{"id":"A","prompt":"产品图","params":{"count":9,"ratio":"16:9","size":"1280x720","quality":"high","_skip_billing":false},"negative_prompt":"不要红色"}]}`)
	got := mergeAgentGenerationInputs(inputs, analysis, "A", nil)
	if got["count"] != 4 || got["size"] != "1024x1024" || got["negative_prompt"] != "禁止文字" || got["quality"] != "high" {
		t.Fatalf("AI overwrote user parameters: %#v", got)
	}
	confirmed := map[string]interface{}{"params": map[string]interface{}{"n": 2, "ratio": "9:16", "enabled": false, "_skip_billing": false}, "negative_prompt": ""}
	got = mergeAgentGenerationInputs(inputs, analysis, "A", confirmed)
	if got["count"] != 2 || got["n"] != 2 || got["ratio"] != "9:16" || got["negative_prompt"] != "" || got["enabled"] != false {
		t.Fatalf("confirmation lost: %#v", got)
	}
	if _, ok := got["size"]; ok {
		t.Fatal("old square pixel size survived the new ratio")
	}
	if _, ok := got["_skip_billing"]; ok {
		t.Fatal("private execution field accepted from parameters")
	}
	applyAgentModelDefaults(got, map[string]interface{}{"aspect_ratio": "1:1", "size": "1024x1024"}, nil, "image")
	if err := prepareCommerceParameters(got); err != nil {
		t.Fatal(err)
	}
	if got["aspect_ratio"] != "9:16" || got["size"] != imagePixelSize("9:16", "1K") {
		t.Fatalf("ratio did not reach actual image size: %#v", got)
	}
	if !reflect.DeepEqual(inputs, original) {
		t.Fatal("original request was mutated")
	}
}

func TestCommerceParameterConflictsStopBeforeGeneration(t *testing.T) {
	for _, input := range []map[string]interface{}{
		{"count": 2.5}, {"count": 21}, {"aspect_ratio": "9:16", "size": "1280x720"},
		{"creative_scene": "detail_image", "detail_section_count": 9},
	} {
		if prepareCommerceParameters(input) == nil {
			t.Fatalf("accepted conflicting parameters: %#v", input)
		}
	}
	valid := map[string]interface{}{"aspect_ratio": "9:16", "size": "720x1280", "count": 2}
	if err := prepareCommerceParameters(valid); err != nil {
		t.Fatal(err)
	}
	defaulted := map[string]interface{}{"aspect_ratio": "9:16"}
	applyAgentModelDefaults(defaulted, map[string]interface{}{"size": "1024x1024", "image_size": "2K"}, nil, "image")
	if err := prepareCommerceParameters(defaulted); err != nil {
		t.Fatal(err)
	}
	if defaulted["size"] != imagePixelSize("9:16", "2K") {
		t.Fatalf("model default overwrote ratio: %#v", defaulted)
	}
}

func TestCommerceAutoAspectFollowsChannelAndScene(t *testing.T) {
	for _, tc := range []struct {
		input map[string]interface{}
		want  string
	}{
		{map[string]interface{}{"aspect_ratio": "auto", "creative_scene": "main_image", "user_prompt": "淘宝商品主图"}, "1:1"},
		{map[string]interface{}{"aspect_ratio": "auto", "creative_scene": "scene_image", "user_prompt": "发布渠道：抖音电商"}, "9:16"},
		{map[string]interface{}{"aspect_ratio": "auto", "creative_scene": "scene_image", "user_prompt": "做一张小红书种草图"}, "3:4"},
		{map[string]interface{}{"aspect_ratio": "auto", "creative_scene": "detail_image"}, "3:4"},
		{map[string]interface{}{"aspect_ratio": "16:9", "creative_scene": "main_image", "user_prompt": "抖音"}, "16:9"},
	} {
		wasAuto := tc.input["aspect_ratio"] == "auto"
		resolveCommerceAutoAspect(tc.input)
		if tc.input["aspect_ratio"] != tc.want || wasAuto && tc.input["ratio"] != tc.want {
			t.Fatalf("auto ratio=%#v want %s", tc.input, tc.want)
		}
		if _, ok := tc.input["size"]; ok {
			t.Fatalf("stale size survived auto ratio: %#v", tc.input)
		}
	}
}

func TestCommerceResolutionRejectsConflictAndDoesNotReappendOldRules(t *testing.T) {
	inputs := map[string]interface{}{"creative_scene": "main_image", "user_prompt": "旧需求站姿", "_commerce_resolved": true}
	for _, raw := range []string{`{"error":"用户要求竖图，但参数为横图"}`, `{}`, `{"candidates":[{"prompt":"A"},{"prompt":"B"}]}`} {
		if validateCommerceResolution(parseJSONish(raw), inputs) == nil {
			t.Fatalf("accepted unresolved output: %s", raw)
		}
	}
	prompt := "按最新修改坐姿弯腿，鞋带改红色，俯拍"
	resolved := map[string]interface{}{"candidates": []interface{}{map[string]interface{}{"prompt": prompt, "negative_prompt": ""}}}
	if err := validateCommerceResolution(resolved, inputs); err != nil {
		t.Fatal(err)
	}
	if got := agentPromptWithScene(prompt, inputs); !strings.Contains(got, prompt) || !strings.Contains(got, "TEXT RENDERING POLICY:") {
		t.Fatalf("final image safety policy missing after resolution: %s", got)
	}
	if got := detailSectionGenerationPrompt("", map[string]interface{}{"image_prompt": prompt}, 0, 5, inputs); !strings.Contains(got, prompt) || !strings.Contains(got, "TEXT RENDERING POLICY:") {
		t.Fatalf("detail module lost final image safety policy: %s", got)
	}
	task := agentMediaTaskInput(inputs, prompt, "test")
	if _, ok := task["_commerce_resolved"]; ok {
		t.Fatal("internal marker leaked to provider")
	}
}

func TestCommerceResolutionCacheTracksRequirementsParametersReferencesAndModels(t *testing.T) {
	inputs := map[string]interface{}{"user_prompt": "侧面图", "count": 1, "reference_images": []string{"original.png"}}
	draft := map[string]interface{}{"confirmed_prompt": "坐姿"}
	config := map[string]interface{}{"analysis_model_code": "chat", "generation_model_code": "image"}
	key := commerceResolutionKey(inputs, draft, config)
	if key != commerceResolutionKey(copyMap(inputs), copyMap(draft), copyMap(config)) {
		t.Fatal("identical retry missed cache")
	}
	for _, change := range []map[string]interface{}{{"count": 2}, {"user_prompt": "俯拍"}, {"reference_images": []string{"new.png"}}} {
		next := copyMap(inputs)
		for k, v := range change {
			next[k] = v
		}
		if key == commerceResolutionKey(next, draft, config) {
			t.Fatal("changed input reused old resolution")
		}
	}
	if key == commerceResolutionKey(inputs, map[string]interface{}{"confirmed_prompt": "站姿"}, config) {
		t.Fatal("confirmation edit reused old resolution")
	}
	if key == commerceResolutionKey(inputs, draft, map[string]interface{}{"analysis_model_code": "new", "generation_model_code": "image"}) {
		t.Fatal("model change reused old resolution")
	}
}

func TestCommerceAnalysisRejectsExplicitlyUnreadProductReference(t *testing.T) {
	inputs := map[string]interface{}{"creative_scene": "auto", "creative_mode": "precise", "reference_images": []string{"https://example.com/product.jpg"}}
	for _, notes := range []string{"无法直接读取URL内容，沿用用户确认描述：大疆无人机", "参考图1张附上；未提供可读视觉描述，沿用用户确认描述"} {
		analysis := parseJSONish(`{"creative_scene":"main_image","asset_notes":"` + notes + `","candidates":[{"prompt":"商品白底图"}]}`)
		if err := validateCommerceAnalysis(analysis, inputs); err == nil {
			t.Fatalf("unread reference was accepted as successful product analysis: %s", notes)
		}
	}
	analysis := parseJSONish(`{"creative_scene":"main_image","asset_notes":"深灰色机身，四个圆形保护圈，前置相机，顶部可见标识","candidates":[{"prompt":"商品白底图"}]}`)
	if err := validateCommerceAnalysis(analysis, inputs); err != nil {
		t.Fatal(err)
	}
	inputs["creative_mode"] = "free"
	analysis["asset_notes"] = "参考图暂时无法识别，按用户文字自由创作概念商品"
	if err := validateCommerceAnalysis(analysis, inputs); err != nil {
		t.Fatal("free creation should not block on an unread creative reference:", err)
	}
	delete(inputs, "reference_images")
	analysis["asset_notes"] = "没有参考图，无法查看实物，按用户文字制作概念图"
	if err := validateCommerceAnalysis(analysis, inputs); err != nil {
		t.Fatal("text-only concept generation must remain usable:", err)
	}
}

func TestCommerceFreeCreationOnlyLocksExplicitRequirements(t *testing.T) {
	inputs := map[string]interface{}{"creative_mode": "free", "creative_scene": "scene_image", "user_prompt": "做一张夏日卖鞋的图", "reference_images": []string{"https://example.com/shoes.jpg"}}
	if !commerceFreeCreation(inputs) {
		t.Fatal("free mode should allow creative completion")
	}
	prompt := agentPromptWithScene("海边活力广告", inputs)
	if !strings.Contains(prompt, "FREE CREATION REFERENCE GUIDANCE") || strings.Contains(prompt, "REFERENCE ROLE REQUIREMENT:") {
		t.Fatalf("free prompt still carries strict reference locks: %s", prompt)
	}
	if !strings.Contains(prompt, "remove or replace the old marking") || strings.Contains(prompt, "Preserve only genuine markings") {
		t.Fatalf("free prompt can still mix conflicting brand identities: %s", prompt)
	}
	inputs["user_prompt"] = "Logo不变，场景和人物大胆创作"
	if !commerceFreeCreation(inputs) {
		t.Fatal("locking one detail should not disable all free creation")
	}
	inputs["user_prompt"] = "保持商品不变，只换背景"
	if commerceFreeCreation(inputs) {
		t.Fatal("explicit preservation request must switch to precise behavior")
	}
}

func TestFreeDetailCountRespectsBriefAndResolutionKeepsPlan(t *testing.T) {
	inputs := map[string]interface{}{"creative_scene": "detail_image", "creative_mode": "free", "detail_section_count": 5, "user_prompt": "请做四个模块的鞋子详情图"}
	if got := detailSectionCount(inputs); got != 4 || detailSectionMinimum(inputs) != 4 {
		t.Fatalf("explicit brief count was ignored: %d", got)
	}
	inputs["user_prompt"] = "给我5个模块，不要4个模块"
	if got := detailSectionCount(inputs); got != 5 {
		t.Fatalf("negated later count overrode the requested one: %d", got)
	}
	inputs["user_prompt"] = "请做四个模块的鞋子详情图"
	freePrompt := buildAgentAnalysisSystemPrompt("image", "ecommerce_image", 3, "detail_image", true)
	if !strings.Contains(freePrompt, "主动构思购买理由、技术与规格概念") || strings.Contains(freePrompt, "每个模块上下边缘约6%–8%") || strings.Contains(freePrompt, "参考商品的形状、结构、颜色、包装文字和Logo必须保真") {
		t.Fatal("free planning still uses the rigid detail template")
	}
	if !strings.Contains(freePrompt, "主动补全材质、技术、功效") || strings.Contains(freePrompt, "仅填写有依据的卖点") {
		t.Fatal("free planning still suppresses AI-created product concepts")
	}
	if !strings.Contains(commerceResolutionInstruction, "不允许模块之间换色板或换主题") {
		t.Fatal("final resolution can split a detail page into unrelated visual styles")
	}
	inputs["_commerce_resolution"] = map[string]interface{}{"detail_sections": []map[string]interface{}{{}, {}, {}, {}}}
	sections := []interface{}{}
	for i := 0; i < 5; i++ {
		sections = append(sections, map[string]interface{}{"image_prompt": "画面"})
	}
	resolved := map[string]interface{}{"candidates": []interface{}{map[string]interface{}{"prompt": "广告概念"}}, "detail_sections": sections}
	if validateCommerceResolution(resolved, inputs) == nil {
		t.Fatal("resolution unexpectedly changed the selected plan's module count")
	}
}

func TestReusableAgentMediaTasksKeepOnlySuccessfulBatchSlots(t *testing.T) {
	raw := []interface{}{
		map[string]interface{}{"task_no": "ok", "batch_index": 0, "status": "succeeded"},
		map[string]interface{}{"task_no": "failed", "batch_index": 1, "status": "failed"},
		map[string]interface{}{"task_no": "outside", "batch_index": 9, "status": "succeeded"},
	}
	items := reusableAgentMediaTasks(raw, 3)
	if len(items) != 1 || stringAny(items[0]["task_no"]) != "ok" {
		t.Fatalf("unexpected reusable tasks: %#v", items)
	}
}

func TestAgentVariantPromptCyclesDistinctCreativeDirections(t *testing.T) {
	inputs := map[string]interface{}{"_variant_prompts": []string{"真实主图", "人物场景", "创意海报"}}
	if got := agentVariantPrompt(inputs, "默认", 1); got != "人物场景" {
		t.Fatalf("variant=%q", got)
	}
	if got := agentVariantPrompt(inputs, "默认", 4); got != "人物场景" {
		t.Fatalf("cycled variant=%q", got)
	}
	if got := agentVariantPrompt(nil, "默认", 0); got != "默认" {
		t.Fatalf("fallback=%q", got)
	}
}

func TestCommerceShoeWearRequestSurvivesPlanningAndImageTask(t *testing.T) {
	brief := "用参考图这双鞋，加一双人物的脚穿着鞋，只拍脚踝以下"
	inputs := map[string]interface{}{"creative_scene": "scene_image", "user_prompt": brief, "image_url": "https://example.com/shoes.jpg", "count": 1}
	system := buildAgentAnalysisSystemPrompt("image", "ecommerce_image", 3, "auto", false)
	if !strings.Contains(system, "按 scene_image 策划") || !strings.Contains(system, "不能因为参考图没有人物就省略人物") {
		t.Fatal("analysis is missing the requested transformation rules")
	}
	prompt := agentPromptWithScene("自然光商品摄影", inputs)
	task := agentMediaTaskInput(inputs, prompt, "test")
	for _, required := range []string{brief, "absence of people", "脚必须自然穿入鞋内", "不得直接复刻参考图"} {
		if !strings.Contains(stringAny(task["prompt"]), required) {
			t.Fatalf("image task lost %q", required)
		}
	}
	if refs := referenceImageURLs(task); len(refs) != 1 || refs[0] != inputs["image_url"] {
		t.Fatalf("shoe reference lost or duplicated: %#v", refs)
	}
	if strings.Contains(prompt, "If the user prompt or AI analysis conflicts with the reference subject, obey the reference image") {
		t.Fatal("reference preservation overrides the user's requested change")
	}
}

func TestCommerceAnalysisRoutesAndPreservesRequirements(t *testing.T) {
	for _, scene := range []string{"main_image", "scene_image", "detail_image", "marketing_poster"} {
		t.Run(scene, func(t *testing.T) {
			inputs := map[string]interface{}{"creative_scene": "auto", "user_prompt": "红色背景，俯视拍摄，不要道具", "detail_section_count": 5}
			analysis := parseJSONish(`{"creative_scene":"` + scene + `","recommendation":"A","candidates":[{"id":"A","prompt":"商品摄影，柔光"}]}`)
			sections := []interface{}{}
			for i := 0; i < 5; i++ {
				sections = append(sections, map[string]interface{}{"image_prompt": "红色背景，局部近景"})
			}
			analysis["detail_sections"] = sections
			if err := validateCommerceAnalysis(analysis, inputs); err != nil {
				t.Fatal(err)
			}
			resolved := mergeAgentGenerationInputs(inputs, analysis, "", nil)
			if stringAny(resolved["creative_scene"]) != scene || stringAny(inputs["creative_scene"]) != "auto" {
				t.Fatalf("incorrect routing or mutated input: %#v", resolved)
			}
			prompt := agentPromptWithScene(selectedAnalysisPrompt(analysis, ""), resolved)
			if !strings.Contains(prompt, stringAny(inputs["user_prompt"])) || strings.Contains(prompt, "If the user prompt or AI analysis conflicts, obey this scene requirement") {
				t.Fatalf("user requirements lost or overridden: %s", prompt)
			}
			inputs["creative_scene"] = "main_image"
			if got := mergeAgentGenerationInputs(inputs, analysis, "", nil); got["creative_scene"] != "main_image" {
				t.Fatal("AI changed an explicitly selected scene")
			}
		})
	}
}

func TestCommerceFidelityRulesReachPlanningAndEveryImageEntry(t *testing.T) {
	brief := "用裸鞋图生成上脚照，坐姿弯腿，俯拍，只拍小腿以下，将鞋带改为红色"
	inputs := map[string]interface{}{"creative_scene": "scene_image", "user_prompt": brief, "reference_images": []string{"https://example.com/product.jpg", "https://example.com/pose.jpg"}}
	for _, scene := range []string{"main_image", "scene_image", "marketing_poster"} {
		inputs["creative_scene"] = scene
		task := agentMediaTaskInput(inputs, agentPromptWithScene("柔光拍摄", inputs), "test")
		if !strings.Contains(stringAny(task["prompt"]), commerceTransformationInstruction) || !strings.Contains(stringAny(task["prompt"]), brief) || len(referenceImageURLs(task)) != 2 {
			t.Fatalf("%s lost fidelity rules, user requirements or original references", scene)
		}
	}
	inputs["creative_scene"] = "detail_image"
	for _, kind := range []string{"hero", "material", "usage", "closing"} {
		section := map[string]interface{}{"type": kind, "image_prompt": brief}
		prompt := detailSectionGenerationPrompt("", section, 0, 5, inputs)
		if !strings.Contains(prompt, "视觉真值") || !strings.Contains(prompt, "REFERENCE ROLE REQUIREMENT:") || !strings.Contains(prompt, brief) {
			t.Fatalf("detail %s lost fidelity rules or its shot requirements", kind)
		}
	}
	if !strings.Contains(buildAgentAnalysisSystemPrompt("image", "ecommerce_image", 3, "auto", false), commerceTransformationInstruction) {
		t.Fatal("planning and generation use different fidelity rules")
	}
}

func TestCommerceAnalysisInfersMissingOrInvalidScene(t *testing.T) {
	cases := []struct {
		brief string
		want  string
	}{
		{"生成商品详情页长图", "detail_image"},
		{"制作双十一促销海报", "marketing_poster"},
		{"商品主图，人物穿着这双鞋", "main_image"},
		{"加一双人物的脚穿着鞋", "scene_image"},
		{"把商品拍得更有质感", "main_image"},
	}
	for _, tc := range cases {
		analysis := map[string]interface{}{"creative_scene": "unexpected", "candidates": []interface{}{map[string]interface{}{"prompt": "商品摄影"}}}
		inputs := map[string]interface{}{"creative_scene": "auto", "user_prompt": tc.brief}
		if got := resolveCommerceScene(analysis, inputs); got != tc.want {
			t.Fatalf("brief %q resolved to %s, want %s", tc.brief, got, tc.want)
		}
		if tc.want != "detail_image" {
			if err := validateCommerceAnalysis(analysis, inputs); err != nil {
				t.Fatalf("missing AI scene should use deterministic fallback: %v", err)
			}
			if analysis["creative_scene"] != tc.want {
				t.Fatalf("resolved scene was not saved: %#v", analysis)
			}
		}
	}
}

func TestCommerceAnalysisRejectsUnusablePlans(t *testing.T) {
	for _, raw := range []string{
		`{}`,
		`{"creative_scene":"main_image","summary":"请上传更多信息"}`,
		`{"creative_scene":"main_image","candidates":[{"prompt":" "}]}`,
		`{"creative_scene":"detail_image","candidates":[{"prompt":"photo"}],"detail_sections":[]}`,
		`{"creative_scene":"detail_image","candidates":[{"prompt":"photo"}],"detail_sections":[{},{},{},{},{}]}`,
	} {
		if err := validateCommerceAnalysis(parseJSONish(raw), map[string]interface{}{"creative_scene": "auto"}); err == nil {
			t.Fatalf("accepted unusable plan: %s", raw)
		}
	}
	prompt := buildAgentAnalysisSystemPrompt("image", "ecommerce_image", 3, "auto", false)
	for _, required := range []string{"creative_scene", "main_image", "scene_image", "detail_image", "marketing_poster", "仅在 creative_scene=detail_image", "逐项保留到候选 prompt"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("analysis instruction missing %s", required)
		}
	}
}
