package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/starai/worker/internal/storage"
)

func TestAgentDetailSectionsBuildsCompletePagePlan(t *testing.T) {
	analysis := map[string]interface{}{
		"detail_sections": []interface{}{
			map[string]interface{}{"id": "custom", "type": "hero", "title": "定制首屏", "image_prompt": "定制商品首屏"},
		},
	}
	sections := agentDetailSections(analysis, map[string]interface{}{"count": float64(1)}, "基础商品方案")
	if len(sections) != 5 {
		t.Fatalf("sections=%d, want 5", len(sections))
	}
	if sections[0]["title"] != "定制首屏" {
		t.Fatalf("first section=%#v", sections[0])
	}
	if sections[4]["type"] != "closing" {
		t.Fatalf("last default section=%#v", sections[4])
	}
	for _, section := range sections {
		if stringAny(section["layout"]) == "" || stringAny(section["copy_placement"]) == "" {
			t.Fatalf("section has no coordinated layout: %#v", section)
		}
	}
	if sections[0]["copy_placement"] != "top" || sections[4]["copy_placement"] != "bottom" {
		t.Fatalf("page rhythm is not coordinated: %#v", sections)
	}
}

func TestDetailSectionPromptEnforcesSingleDesignedModule(t *testing.T) {
	prompt := detailSectionGenerationPrompt(
		"玻尿酸精华液，30ml，三重保湿",
		map[string]interface{}{"type": "material", "title": "材质细节", "objective": "展示瓶身和滴管", "image_prompt": "微距商品摄影", "copy_title": "瓶身细节", "copy_points": []string{"30ml"}},
		2,
		6,
		map[string]interface{}{"creative_scene": "detail_image", "creative_scene_label": "商品详情图"},
	)
	for _, expected := range []string{"DETAIL PAGE MODULE 3/6", "视觉真值", "底图不绘制任何新增文字", "DESIGN SYSTEM", "2–3个有主次的局部特写卡片", "品牌渐变", "无字功能图标", "连续长页", "不得创造新颜色", "包装盒", "数量=1", "商品详情图"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("prompt missing %q: %s", expected, prompt)
		}
	}
}

func TestDetailSectionPromptDoesNotReserveBlankCopyCard(t *testing.T) {
	prompt := detailSectionGenerationPrompt("", map[string]interface{}{"type": "benefit", "image_prompt": "商品局部展示"}, 1, 5, map[string]interface{}{})
	if !strings.Contains(prompt, "不要生成或预留空白卡片") || strings.Contains(prompt, "面积约占画面的25%–35%") {
		t.Fatalf("empty copy still reserved a blank card: %s", prompt)
	}
}

func TestFreeDetailPlanKeepsCreativeLayoutAndSkipsTemplatePadding(t *testing.T) {
	analysisPrompt := buildAgentAnalysisSystemPrompt("image", "ecommerce_image", 3, "detail_image", true)
	if strings.Contains(analysisPrompt, "%!") {
		t.Fatal("free detail prompt contains a formatting error")
	}
	if !strings.Contains(analysisPrompt, "文案不是从用户提示词逐句改写") || !strings.Contains(analysisPrompt, "主动提出更具体的材质、技术、使用体验和功效卖点") || !strings.Contains(analysisPrompt, "不因用户没有提供依据就删除或留空") {
		t.Fatal("free detail planning must ask the AI to create original copy beyond sparse user input")
	}
	if strings.Contains(analysisPrompt, "不可把未提供的材质结构") || strings.Contains(analysisPrompt, "须有用户原话支持") {
		t.Fatal("free detail planning still blocks editable AI-created product concepts")
	}
	if !strings.Contains(analysisPrompt, "先确定整页唯一的design_system") || !strings.Contains(analysisPrompt, "不允许第2张起另换色板或艺术风格") || strings.Contains(analysisPrompt, "成图标题尽量12字内") {
		t.Fatal("free detail planning must share one visual direction without copy limits")
	}
	inputs := map[string]interface{}{"creative_scene": "detail_image", "creative_mode": "free", "detail_section_count": 5}
	sections := []interface{}{}
	for i := 0; i < 4; i++ {
		sections = append(sections, map[string]interface{}{"id": fmt.Sprintf("detail_%02d", i+1), "type": "feature", "layout": "不对称杂志跨页构图", "image_prompt": "以逆光展示商品"})
	}
	analysis := map[string]interface{}{"detail_sections": sections, "candidates": []interface{}{map[string]interface{}{"prompt": "逆光运动视觉"}}}
	if err := validateCommerceAnalysis(analysis, inputs); err != nil {
		t.Fatal(err)
	}
	planned := agentDetailSections(analysis, inputs, "")
	if len(planned) != 4 || planned[0]["layout"] != "不对称杂志跨页构图" {
		t.Fatalf("free plan was forced into the five-section template: %#v", planned)
	}
	prompt := detailSectionGenerationPrompt("", planned[0], 0, len(planned), inputs)
	if !strings.Contains(prompt, "不对称杂志跨页构图") || strings.Contains(prompt, "25%–35%") || strings.Contains(prompt, "6%–8%") || !strings.Contains(prompt, "不要按草稿文字坐标预留固定卡片") {
		t.Fatalf("free image prompt still contains fixed visual constraints: %s", prompt)
	}
	if !strings.Contains(prompt, "所有模块必须沿用上面的同一主题、主辅色与视觉母题") {
		t.Fatal("free modules may drift to unrelated themes and colors")
	}
	inputs["detail_section_count_locked"] = true
	if validateCommerceAnalysis(analysis, inputs) == nil {
		t.Fatal("manual module count must remain exact")
	}
}

func TestReusableDetailSectionRequiresExactSignature(t *testing.T) {
	taskInput := map[string]interface{}{"prompt": "模块提示", "reference_images": []string{"https://example.com/product.jpg"}}
	signature := detailSectionSignature("image-model", taskInput)
	page := map[string]interface{}{"sections": []interface{}{map[string]interface{}{
		"id": "detail_02", "status": "succeeded", "signature": signature,
		"task_no": "task_old", "image_url": "https://example.com/module.jpg",
	}}}
	if section, ok := reusableDetailSection(page, "detail_02", signature); !ok || stringAny(section["task_no"]) != "task_old" {
		t.Fatalf("matching completed section was not reused: %#v %v", section, ok)
	}
	if _, ok := reusableDetailSection(page, "detail_02", detailSectionSignature("other-model", taskInput)); ok {
		t.Fatal("section was reused after model/input changed")
	}
}

func TestAgentContentImageCardsKeepsPlanAndFillsRequestedCount(t *testing.T) {
	post := map[string]interface{}{
		"title": "秋季护肤指南",
		"cards": []interface{}{
			map[string]interface{}{"id": "cover", "role": "cover", "headline": "换季别焦虑", "copy": "三步稳住皮肤", "image_prompt": "秋日暖色护肤静物"},
		},
	}
	cards := agentContentImageCards(post, map[string]interface{}{"image_count": 4}, "秋季护肤")
	if len(cards) != 4 || cards[0]["id"] != "cover" || cards[3]["role"] != "cta" {
		t.Fatalf("unexpected content cards: %#v", cards)
	}
	for _, card := range cards {
		if strings.TrimSpace(stringAny(card["image_prompt"])) == "" {
			t.Fatalf("card has no image prompt: %#v", card)
		}
	}
}

func TestContentImageAnalysisPromptRequiresPublishableStructure(t *testing.T) {
	prompt := buildAgentAnalysisSystemPrompt("image", "content_image_post", 1, "content_image_post", false)
	for _, expected := range []string{"content_task", "objective", "deliverables", "content_post", "title", "body", "hashtags", "cards 数量必须严格等于", "不得把标题、正文、标签直接画进图片"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("content image prompt missing %q: %s", expected, prompt)
		}
	}
}

func TestComposeDetailPageLongImage(t *testing.T) {
	root := t.TempDir()
	store, err := storage.NewLocal(root, "http://localhost:8080/uploads-local")
	if err != nil {
		t.Fatal(err)
	}
	previous := objectStore
	objectStore = store
	t.Cleanup(func() { objectStore = previous })

	urls := []string{
		testPNGDataURL(t, 120, 80, color.RGBA{R: 255, A: 255}),
		testPNGDataURL(t, 60, 30, color.RGBA{G: 255, A: 255}),
	}
	got, err := composeDetailPageLongImage(context.Background(), "wfp_test", urls)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "/workflows/wfp_test/detail-page-") {
		t.Fatalf("url=%q", got)
	}
	files, err := filepath.Glob(filepath.Join(root, "workflows", "wfp_test", "detail-page-*.jpg"))
	if err != nil || len(files) != 1 {
		t.Fatalf("files=%v err=%v", files, err)
	}
	f, err := os.Open(files[0])
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 120 || img.Bounds().Dy() != 140 {
		t.Fatalf("bounds=%v", img.Bounds())
	}
}

func testPNGDataURL(t *testing.T, width, height int, fill color.Color) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, fill)
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(out.Bytes())
}

func TestDetailFallbackHasUniqueEvidenceBasedModules(t *testing.T) {
	for count := 4; count <= 8; count++ {
		sections := agentDetailSections(nil, map[string]interface{}{"detail_section_count": count}, "商品")
		if len(sections) != count {
			t.Fatalf("count %d: %#v", count, sections)
		}
		if count == 5 && sections[count-1]["type"] != "closing" {
			t.Fatalf("default five should close on the product: %#v", sections)
		}
		seen := map[string]bool{}
		for _, section := range sections {
			kind := stringAny(section["type"])
			if seen[kind] {
				t.Fatalf("duplicate %s", kind)
			}
			seen[kind] = true
		}
	}
}

func TestCommerceAnalysisRequiresGroundedClaimsAndDetailCopy(t *testing.T) {
	prompt := buildAgentAnalysisSystemPrompt("image", "ecommerce_image", 3, "detail_image", false)
	for _, want := range []string{"missing_information", "不能改变商品事实", "detail_section_count", "design_system", "page_flow", "copy_placement", "空白信息卡片", "无字功能图标", "连续长页", "2–3个局部近景", "不制作空参数表", "无依据时留空"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("missing %s", want)
		}
	}
}

func TestDetailDesignSystemIsSharedAndHasDeterministicFallback(t *testing.T) {
	want := `{"palette":{"accent":"#169BDB","background":"#EAF6FF"},"theme":"冰蓝科技"}`
	analysis := parseJSONish(`{"design_system":` + want + `}`)
	if got := detailDesignSystem(analysis); got != want {
		t.Fatalf("design system changed between modules: %s", got)
	}
	fallback := detailDesignSystem(map[string]interface{}{"style": "温暖自然"})
	for _, required := range []string{"温暖自然", "#F4F7FB", "surface", "icon_style", "product_treatment"} {
		if !strings.Contains(fallback, required) {
			t.Fatalf("fallback design system missing %q: %s", required, fallback)
		}
	}
}

func TestCommerceReferencesPreserveAllViews(t *testing.T) {
	inputs := map[string]interface{}{"image_url": "https://example.com/front.jpg", "reference_images": []string{"https://example.com/front.jpg", "https://example.com/back.jpg", "https://example.com/detail.jpg"}}
	refs := referenceImageURLs(inputs)
	if len(refs) != 3 || refs[0] != "https://example.com/front.jpg" {
		t.Fatalf("references: %#v", refs)
	}
	task := agentMediaTaskInput(inputs, "商品详情", "qa")
	if len(referenceImageURLs(task)) != 3 {
		t.Fatalf("task lost reference views: %#v", task)
	}
}

func TestCommerceVideoPromptIsExecutableAndGrounded(t *testing.T) {
	prompt := buildAgentAnalysisSystemPrompt("video", "product_showcase_video", 2, "product_video", false)
	for _, want := range []string{"商品视频导演", "起始姿态", "结束状态", "独立配音", "不强制三秒钩子", "内部结构", "2条"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("missing %s", want)
		}
	}
}

func TestCommerceWorkflowPlanFeedsSeparateMediaPrompts(t *testing.T) {
	node := workflowNode{Type: "llm", RequiredOutputFields: []string{"copy", "image_prompt", "video_prompt"}}
	out := map[string]interface{}{"text": `{"copy":"商品文案","image_prompt":"静态画面","video_prompt":"连续运动"}`}
	if err := validateWorkflowTextOutput(node, out); err != nil {
		t.Fatal(err)
	}
	vars := map[string]string{}
	absorbNodeOutputVars(vars, "copy", out)
	if got := renderTemplate("{{copy_image_prompt}}", vars); got != "静态画面" {
		t.Fatal(got)
	}
	if got := renderTemplate("{{copy_video_prompt}}", vars); got != "连续运动" {
		t.Fatal(got)
	}
	for _, text := range []string{`plain copy`, `{"copy":"text","image_prompt":{},"video_prompt":"motion"}`, `{"copy":"text","image_prompt":"still"}`} {
		if validateWorkflowTextOutput(node, map[string]interface{}{"text": text}) == nil {
			t.Fatal("invalid plan accepted")
		}
	}
}
