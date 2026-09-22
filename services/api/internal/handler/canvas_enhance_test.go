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
}
