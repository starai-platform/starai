package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strings"
	"testing"
)

func TestFreeDetailPlanningUsesEditableLayers(t *testing.T) {
	prompt := buildAgentAnalysisSystemPrompt("image", "ecommerce_image", 3, "detail_image", true)
	if !strings.Contains(prompt, "text_layers") || !strings.Contains(prompt, "不要默认加卡片") {
		t.Fatal("free detail prompt still requires the fixed caption card")
	}
	if strings.Contains(prompt, `"x":0.08`) || !strings.Contains(prompt, "不能每屏都复用相同坐标") {
		t.Fatal("free detail prompt still teaches repeated fixed coordinates")
	}
	if strings.Contains(commerceResolutionInstruction, "保留每屏的text_layers创意、文字和坐标") {
		t.Fatal("confirmation stage still freezes the draft copy and placement")
	}
	analysis := map[string]interface{}{"detail_sections": []interface{}{
		map[string]interface{}{"id": "detail_01", "image_prompt": "商品首屏", "text_layers": []interface{}{map[string]interface{}{"text": "让风穿过每一步", "x": 0.1, "y": 0.7, "width": 0.8, "font_size": 0.06}}},
		map[string]interface{}{"id": "detail_02", "image_prompt": "细节镜头", "copy_title": "旧模型标题", "copy_points": []interface{}{"旧模型说明"}},
	}}
	sections := agentDetailSections(analysis, map[string]interface{}{"creative_mode": "free", "creative_scene": "detail_image", "detail_section_count": 4}, "商品")
	if len(sections) != 4 {
		t.Fatalf("detail budget changed: %d", len(sections))
	}
	first := sections[0]["text_layers"].([]interface{})[0].(map[string]interface{})
	if first["text"] != "让风穿过每一步" {
		t.Fatalf("AI copy was replaced: %#v", first)
	}
	legacy := sections[1]["text_layers"].([]interface{})
	if len(legacy) != 2 || legacy[0].(map[string]interface{})["text"] != "旧模型标题" {
		t.Fatalf("legacy copy did not become editable layers: %#v", legacy)
	}
}

func TestVisionTypographyPlanKeepsDistinctAICopyAndPositions(t *testing.T) {
	content := `{"sections":[{"id":"detail_01","text_layers":[{"text":"只管向前跑","x":0.61,"y":0.27,"width":0.31,"font_size":0.07,"color":"#FFFFFF"}]},{"id":"detail_02","text_layers":[{"text":"风，从鞋面经过","x":0.09,"y":0.68,"width":0.62,"font_size":0.04,"color":"#A8E6CF"}]}]}`
	layers, err := parseDetailTypographyPlan(content, []string{"detail_01", "detail_02"})
	if err != nil {
		t.Fatal(err)
	}
	first := layers["detail_01"][0].(map[string]interface{})
	second := layers["detail_02"][0].(map[string]interface{})
	if first["text"] != "只管向前跑" || second["text"] != "风，从鞋面经过" || first["x"] == second["x"] {
		t.Fatalf("AI typography was replaced: %#v", layers)
	}
}

func TestVisionTypographyDoesNotOverlayBakedMarketingCopy(t *testing.T) {
	content := `{"sections":[{"id":"detail_04","existing_copy":["舒爽透气","36-43"],"base_copy_present":false,"text_layers":[{"text":"再画一遍参数","x":0.8,"y":0.1,"width":0.15,"font_size":0.04,"color":"#FFFFFF"}]}]}`
	layers, err := parseDetailTypographyPlan(content, []string{"detail_04"})
	if err != nil || len(layers["detail_04"]) != 0 {
		t.Fatalf("baked copy was overlaid again: %#v, %v", layers, err)
	}
}

func TestVisionTypographyMayLeaveBusyImagesWithoutOverlay(t *testing.T) {
	layers, err := parseDetailTypographyPlan(`{"sections":[{"id":"detail_02","existing_copy":[],"base_copy_present":false,"text_layers":[]}]}`, []string{"detail_02"})
	if err != nil || len(layers["detail_02"]) != 0 {
		t.Fatalf("busy image was forced to receive copy: %#v, %v", layers, err)
	}
}

func TestVisionTypographyRepairsOneBadFieldWithoutDiscardingCopy(t *testing.T) {
	content := `{"sections":[{"id":"one","text_layers":[{"text":"自在向前","x":"63%","y":1.2,"width":0.6,"font_size":"8%","color":"rgb(0,0,0)"}]},{"id":"two","text_layers":[{"text":"另一屏","x":0.2,"y":0.3,"width":0.5,"font_size":0.05,"color":"#AABBCC"}]}]}`
	layers, err := parseDetailTypographyPlan(content, []string{"one", "two"})
	if err != nil {
		t.Fatal(err)
	}
	first := layers["one"][0].(map[string]interface{})
	if first["text"] != "自在向前" || floatAny(first["x"]) != .63 || floatAny(first["y"]) != .9 || floatAny(first["width"]) > .371 || floatAny(first["font_size"]) != .08 || first["color"] != "#FFFFFF" || len(layers["two"]) != 1 {
		t.Fatalf("bad coordinate discarded the whole vision plan: %#v", layers)
	}
}

func TestVisionTypographyKeepsGoodScreensWhenAnotherIsMissing(t *testing.T) {
	layers, err := parseDetailTypographyPlan(`{"sections":[{"id":"one","text_layers":[{"text":"自在向前","x":0.2,"y":0.1,"width":0.5,"font_size":0.05,"color":"#123456"}]}]}`, []string{"one", "two"})
	if err == nil || len(layers["one"]) != 1 || len(layers["two"]) != 0 {
		t.Fatalf("one missing screen discarded valid typography: %#v, %v", layers, err)
	}
}

func TestTypographyMovesRepeatedCopyIntoEachImagesQuietArea(t *testing.T) {
	previews := []string{}
	for page := 0; page < 2; page++ {
		img := image.NewRGBA(image.Rect(0, 0, 400, 400))
		for y := 0; y < 400; y++ {
			for x := 0; x < 400; x++ {
				pixel := color.RGBA{170, 225, 235, 255}
				if page == 1 {
					pixel = color.RGBA{240, 210, 190, 255}
				}
				if page == 1 && x < 200 && (x/4+y/4)%2 == 0 {
					pixel = color.RGBA{0, 0, 0, 255}
				}
				img.SetRGBA(x, y, pixel)
			}
		}
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, img); err != nil {
			t.Fatal(err)
		}
		previews = append(previews, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(encoded.Bytes()))
	}
	plans := map[string][]interface{}{}
	for _, id := range []string{"one", "two"} {
		plans[id] = []interface{}{map[string]interface{}{"text": "自在向前", "x": .1, "y": .1, "width": .3, "font_size": .05, "color": "#000000"}}
	}
	placeDetailTypography(plans, []string{"one", "two"}, previews)
	first := plans["one"][0].(map[string]interface{})
	second := plans["two"][0].(map[string]interface{})
	if first["text"] != second["text"] || floatAny(first["x"]) != .1 || floatAny(second["x"]) < .5 || first["color"] == second["color"] {
		t.Fatalf("copy did not follow each image's quiet area: first=%#v, second=%#v", first, second)
	}
}

func TestTypographyInkFollowsLocalImageColor(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 400, 200))
	draw.Draw(img, image.Rect(0, 0, 200, 200), image.NewUniform(color.RGBA{170, 225, 235, 255}), image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(200, 0, 400, 200), image.NewUniform(color.RGBA{35, 65, 115, 255}), image.Point{}, draw.Src)
	left := parseDetailColor(detailTypographyInk(img, .05, .1, .35, .05, 0), color.RGBA{})
	right := parseDetailColor(detailTypographyInk(img, .55, .1, .35, .05, 0), color.RGBA{})
	if !(left.R < 80 && left.G > left.R && right.R > 200 && right.B > right.R) {
		t.Fatalf("ink does not follow local palette with contrast: left=%#v right=%#v", left, right)
	}
}

func TestTypographyQuietAreaIncludesWrappedSubtitle(t *testing.T) {
	layers := []interface{}{
		map[string]interface{}{"text": "每一步，都有风同行", "x": .1, "y": .1, "width": .35, "font_size": .05},
		map[string]interface{}{"text": "轻盈向前，自在出发", "x": .1, "y": .15, "width": .35, "font_size": .03},
	}
	_, _, _, bottom := detailTypographyBounds(layers, 1000, 1000)
	if floatAny(layers[1].(map[string]interface{})["y"]) <= .23 || bottom <= .26 {
		t.Fatalf("wrapped title did not reserve room for subtitle: %#v, bottom=%v", layers, bottom)
	}
}

func TestTypographyBackdropOnlyWhenImageNeedsIt(t *testing.T) {
	plain := image.NewRGBA(image.Rect(0, 0, 400, 400))
	busy := image.NewRGBA(image.Rect(0, 0, 400, 400))
	for y := 0; y < 400; y++ {
		for x := 0; x < 400; x++ {
			plain.SetRGBA(x, y, color.RGBA{170, 225, 235, 255})
			shade := uint8(255)
			if (x/8+y/8)%2 == 0 {
				shade = 20
			}
			busy.SetRGBA(x, y, color.RGBA{shade, shade, shade, 255})
		}
	}
	layer := map[string]interface{}{"text": "轻盈向前", "x": .1, "y": .1, "width": .4, "font_size": .05, "color": "#263C44"}
	if detailTypographyNeedsBackdrop(plain, layer) || !detailTypographyNeedsBackdrop(busy, layer) {
		t.Fatal("backdrop should be reserved for low-readability or busy image regions")
	}
}

func TestVisionTypographyReceivesRealDownscaledImage(t *testing.T) {
	url := testPNGDataURL(t, 1200, 600, color.White)
	preview, err := detailTypographyImage(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	_, payload, ok := strings.Cut(preview, ",")
	if !ok || !strings.HasPrefix(preview, "data:image/jpeg;base64,") {
		t.Fatalf("vision preview is not a JPEG image: %s", preview[:min(len(preview), 40)])
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		t.Fatal(err)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width != 768 || config.Height != 384 {
		t.Fatalf("vision preview dimensions: %#v, %v", config, err)
	}
}

func TestRenderTextDetailBaseImageDoesNotLockDraftCoordinates(t *testing.T) {
	section := map[string]interface{}{"type": "hero", "layout": "商品位于右侧，左侧有流动光影", "image_prompt": "蓝色运动鞋特写", "text_layers": []interface{}{map[string]interface{}{"text": "草稿", "x": .08, "y": .12, "width": .3, "font_size": .05}}}
	prompt := detailSectionGenerationPrompt("", section, 0, 4, map[string]interface{}{"creative_mode": "render_text", "user_prompt": "运动鞋"})
	if strings.Contains(prompt, `"x":0.08`) || !strings.Contains(prompt, "后续AI会看实际底图") {
		t.Fatalf("base image still follows fixed typography: %s", prompt)
	}
}

func TestRenderTextDetailBaseImageDropsTextInstructions(t *testing.T) {
	section := map[string]interface{}{"type": "feature", "layout": "产品与参数并列，简洁背景", "image_prompt": "运动鞋与技术参数并列展示，柔和自然光，购买按钮和价格信息突出"}
	prompt := detailSectionGenerationPrompt("", section, 3, 5, map[string]interface{}{"creative_mode": "render_text", "creative_scene": "detail_image", "user_prompt": "请写尺码36-43"})
	if strings.Contains(prompt, "技术参数并列展示") || strings.Contains(prompt, "购买按钮和价格信息突出") || strings.Contains(prompt, "用户明确要求：请写") || !strings.HasSuffix(prompt, "Genuine markings printed on the product may remain.") {
		t.Fatalf("image model still receives conflicting copy instructions: %s", prompt)
	}
}

func TestFreeDetailGeneratesPlannedCopyInsideImage(t *testing.T) {
	section := map[string]interface{}{"type": "hero", "layout": "商品位于右侧，标题融入左侧光影", "image_prompt": "蓝色运动鞋在清晨城市街道", "text_layers": []interface{}{
		map[string]interface{}{"text": "让风穿过每一步", "x": .08, "y": .12},
		map[string]interface{}{"text": "轻盈启程", "x": .08, "y": .2},
	}}
	inputs := map[string]interface{}{"creative_mode": "free", "creative_scene": "detail_image", "generation_language_label": "简体中文", "user_prompt": "运动鞋详情图"}
	prompt := detailSectionGenerationPrompt("", section, 0, 4, inputs)
	for _, expected := range []string{"文字与画面一次成型", "让风穿过每一步", "轻盈启程", "AI-INTEGRATED TEXT POLICY:", "简体中文", "不做后期叠字"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("native free detail prompt lost %q: %s", expected, prompt)
		}
	}
	for _, forbidden := range []string{"text-free visual background", "Those words are added after image generation", "后续AI会看实际底图"} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("native free mode leaked post-typesetting instruction %q: %s", forbidden, prompt)
		}
	}
	if !commerceGeneratesDetailText(inputs) || commerceRendersDetailText(inputs) {
		t.Fatal("free mode was not separated from render-text mode")
	}
}

func TestRenderTextAndFreeRemainCreativePlanningModes(t *testing.T) {
	for _, mode := range []string{"free", "render_text"} {
		if !commerceFreeCreation(map[string]interface{}{"creative_mode": mode}) {
			t.Fatalf("%s lost creative planning", mode)
		}
	}
	if !commerceRendersDetailText(map[string]interface{}{"creative_mode": "render_text"}) || commerceGeneratesDetailText(map[string]interface{}{"creative_mode": "render_text"}) {
		t.Fatal("render_text mode was not separated from native image text")
	}
}

func TestFreeDetailAnalysisRemovesPostTypesettingContradictions(t *testing.T) {
	system := buildAgentAnalysisSystemPrompt("image", "ecommerce_image", 3, "detail_image", true) + "\n" + commerceResolutionInstruction
	system = commerceNativeDetailAnalysisPrompt(system) + "\n" + commerceNativeDetailTextInstruction
	for _, forbidden := range []string{"image_prompt和layout只能描述无字底图", "最终文案与排版会在看到实际底图后再由AI决定", "图片模型不绘制新增文字", "文字由后期准确排版"} {
		if strings.Contains(system, forbidden) {
			t.Fatalf("native free analysis still contains post-typesetting rule %q", forbidden)
		}
	}
	if !strings.Contains(system, "图片模型一次完成画面与文字") || !strings.Contains(system, "AI原生文字") {
		t.Fatal("native free analysis lost its direct text-generation override")
	}
}

func TestDetailTextRendererMovesOverlappingCards(t *testing.T) {
	first := []image.Rectangle{image.Rect(80, 120, 500, 280)}
	top, ok := chooseDetailLayerTop(80, 180, 420, 100, 12, 1254, 1254, first)
	if !ok || top < 290 {
		t.Fatalf("second card still overlaps: top=%d, ok=%v", top, ok)
	}
}
