package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"

	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
)

func TestDetailLayoutKeepsPhotoAndWrapsApprovedCopy(t *testing.T) {
	typeface, err := opentype.Parse(goregular.TTF)
	if err != nil {
		t.Fatal(err)
	}
	photo := image.NewRGBA(image.Rect(0, 0, 800, 600))
	photo.Set(24, 35, color.RGBA{255, 0, 0, 255})
	section := map[string]interface{}{"copy_title": "Gradient knitwear", "copy_points": []string{"Cream to grey", "Ribbed cuffs"}}
	result, err := layoutDetailModule(photo, section, typeface)
	if err != nil {
		t.Fatal(err)
	}
	if result.Bounds() != photo.Bounds() || result.At(24, 35) != photo.At(24, 35) {
		t.Fatal("module size changed or pixels outside the copy card were overwritten")
	}
	if result.At(520, 300) == photo.At(520, 300) {
		t.Fatal("copy card was not integrated into the planned safe area")
	}
	hero, err := layoutDetailModule(photo, map[string]interface{}{"type": "hero", "copy_title": "Raincoat", "_style": "background #f5f5f7, accent #102030"}, typeface)
	if err != nil || hero.Bounds() != photo.Bounds() {
		t.Fatal("hero hierarchy was not rendered in place", err)
	}
	if hero.At(40, 40) == photo.At(40, 40) {
		t.Fatal("hero ignored the planned accent card")
	}
	blank, err := layoutDetailModule(photo, nil, typeface)
	if err != nil || blank.Bounds() != photo.Bounds() {
		t.Fatal("invented empty caption band", err)
	}
	_, err = layoutDetailModule(photo, map[string]interface{}{"copy_title": "中文"}, typeface)
	if err == nil {
		t.Fatal("unsupported glyph silently rendered")
	}
}

func TestDetailPaletteUsesNamedDesignSystemColors(t *testing.T) {
	background, accent := detailPalette(`{"palette":{"accent":"#65A8FF","background":"#EEF7FF","primary":"#15304D"}}`)
	if background != (color.RGBA{238, 247, 255, 255}) || accent != (color.RGBA{101, 168, 255, 255}) {
		t.Fatalf("design system palette was reordered: background=%#v accent=%#v", background, accent)
	}
}

func TestDetailLayoutLocalChinesePreview(t *testing.T) {
	input, output := os.Getenv("DETAIL_LAYOUT_PREVIEW_INPUT"), os.Getenv("DETAIL_LAYOUT_PREVIEW_OUTPUT")
	if input == "" || output == "" {
		t.Skip("optional local font and visual check")
	}
	typeface, err := loadDetailFont()
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(input)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	photo, _, err := image.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	result, err := layoutDetailModule(photo, map[string]interface{}{"copy_title": "米白渐变针织衫", "copy_points": []string{"米白到灰色的渐变设计", "罗纹袖口细节"}}, typeface)
	if err != nil {
		t.Fatal(err)
	}
	out, err := os.Create(output)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	if err := png.Encode(out, result); err != nil {
		t.Fatal(err)
	}
}
