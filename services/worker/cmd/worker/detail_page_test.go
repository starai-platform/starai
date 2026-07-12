package main

import (
	"bytes"
	"context"
	"encoding/base64"
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
	if len(sections) != 6 {
		t.Fatalf("sections=%d, want 6", len(sections))
	}
	if sections[0]["title"] != "定制首屏" {
		t.Fatalf("first section=%#v", sections[0])
	}
	if sections[5]["type"] != "specification" {
		t.Fatalf("last default section=%#v", sections[5])
	}
}

func TestDetailSectionPromptEnforcesConsistencyAndNoRenderedText(t *testing.T) {
	prompt := detailSectionGenerationPrompt(
		"玻尿酸精华液，30ml，三重保湿",
		map[string]interface{}{"type": "material", "title": "材质细节", "objective": "展示瓶身和滴管", "image_prompt": "微距商品摄影"},
		2,
		6,
		map[string]interface{}{"creative_scene": "detail_image", "creative_scene_label": "商品详情图"},
	)
	for _, expected := range []string{"DETAIL PAGE MODULE 3/6", "严格保持参考商品", "不绘制任何标题", "商品详情图"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("prompt missing %q: %s", expected, prompt)
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
		testPNGDataURL(t, 120, 60, color.RGBA{G: 255, A: 255}),
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
	if img.Bounds().Dx() != 120 || img.Bounds().Dy() != 156 {
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
