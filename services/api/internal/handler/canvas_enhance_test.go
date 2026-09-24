package handler

import (
	"strings"
	"testing"
)

func TestCanvasEnhanceContext(t *testing.T) {
	for _, workflow := range []string{"video_creation", "video_creation_v2", "one_click_viral_remake", "viral_remake", "video_remake"} {
		if !strings.Contains(canvasEnhanceContext(workflow, "image"), "最终交付是动态视频") {
			t.Fatal(workflow)
		}
	}
	if !strings.Contains(canvasEnhanceContext("infinite_canvas", "video"), "最终交付是动态视频") {
		t.Fatal("canvas video target lost")
	}
	if !strings.Contains(canvasEnhanceContext("infinite_canvas", "image"), "静态画面") {
		t.Fatal("image target lost")
	}
	if !strings.Contains(canvasEnhanceContext("infinite_canvas", ""), "不擅自加入") {
		t.Fatal("unknown medium must stay neutral")
	}
	for target, expected := range map[string]string{
		"main_image":       "商品主图",
		"detail_image":     "详情长页",
		"scene_image":      "真实使用环境",
		"marketing_poster": "营销海报",
		"auto":             "只选择一种",
		"product_video":    "镜头运动",
		"image_to_video":   "锁定参考图主体",
		"ai_comic_drama":   "角色身份一致性",
	} {
		if !strings.Contains(canvasEnhanceContext("ecommerce_image", target), expected) {
			t.Fatalf("%s enhancement context is not scene-specific", target)
		}
	}
	if detail := canvasEnhanceContext("ecommerce_image", "detail_image"); !strings.Contains(detail, "不强加固定章节") || strings.Contains(detail, "统一色板、渐变、卡片") {
		t.Fatal("detail prompt enhancement still bakes in the old visual template")
	}
}

func TestFreeCommerceEnhanceContextKeepsEditableConcepts(t *testing.T) {
	for _, target := range []string{"detail_image", "main_image", "scene_image", "marketing_poster", "auto"} {
		context := freeCommerceEnhanceContext(target)
		if !strings.Contains(context, "AI") || strings.Contains(context, "不编造可验证的商品事实") {
			t.Fatalf("%s still uses precise-mode constraints: %s", target, context)
		}
	}
	if !strings.Contains(freeCommerceEnhanceContext("detail_image"), "主动补全未提供的材质、技术、功效与卖点") || !strings.Contains(freeCommerceEnhanceContext("detail_image"), "整页统一的主题、主辅色和视觉母题") {
		t.Fatal("free detail enhancement lost the editable concept-copy requirement")
	}
}

func TestCommerceDetailTextModesGiveDifferentEnhancementInstructions(t *testing.T) {
	free := commerceDetailTextModeGuide("free")
	rendered := commerceDetailTextModeGuide("render_text")
	if !strings.Contains(free, "随详情图直接生成") || !strings.Contains(free, "不要改成无字底图或后期叠字") {
		t.Fatalf("free mode does not request AI-integrated copy: %s", free)
	}
	if !strings.Contains(rendered, "无字底图") || !strings.Contains(rendered, "可编辑文字") {
		t.Fatalf("render-text mode lost the former typesetting path: %s", rendered)
	}
	if commerceDetailTextModeGuide("precise") != "" {
		t.Fatal("precise mode should not receive creative text guidance")
	}
}
