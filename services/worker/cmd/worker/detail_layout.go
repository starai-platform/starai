package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

var (
	detailHexColor        = regexp.MustCompile(`#[0-9a-fA-F]{6}`)
	detailBackgroundColor = regexp.MustCompile(`(?i)["']?background["']?\s*[:=]\s*["']?(#[0-9a-f]{6})`)
	detailAccentColor     = regexp.MustCompile(`(?i)["']?(?:accent|primary)["']?\s*[:=]\s*["']?(#[0-9a-f]{6})`)
)

func parseDetailColor(value string, fallback color.RGBA) color.RGBA {
	raw := strings.TrimPrefix(value, "#")
	n, err := strconv.ParseUint(raw, 16, 24)
	if err != nil {
		return fallback
	}
	return color.RGBA{uint8(n >> 16), uint8(n >> 8), uint8(n), 255}
}

func detailPalette(style string) (color.RGBA, color.RGBA) {
	matches := detailHexColor.FindAllString(style, 2)
	background, accent := color.RGBA{248, 247, 244, 255}, color.RGBA{38, 40, 44, 255}
	if match := detailBackgroundColor.FindStringSubmatch(style); len(match) > 1 {
		background = parseDetailColor(match[1], background)
	}
	if match := detailAccentColor.FindStringSubmatch(style); len(match) > 1 {
		accent = parseDetailColor(match[1], accent)
	}
	if len(matches) > 0 {
		if detailBackgroundColor.FindString(style) == "" {
			background = parseDetailColor(matches[0], background)
		}
	}
	if len(matches) > 1 {
		if detailAccentColor.FindString(style) == "" {
			accent = parseDetailColor(matches[1], accent)
		}
	}
	return background, accent
}

func detailContrastText(background color.RGBA) color.RGBA {
	if int(background.R)*299+int(background.G)*587+int(background.B)*114 > 150000 {
		return color.RGBA{32, 34, 37, 255}
	}
	return color.RGBA{250, 250, 250, 255}
}

func loadDetailFont() (*opentype.Font, error) {
	paths := []string{os.Getenv("DETAIL_FONT_PATH"), "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", filepath.Join(os.Getenv("WINDIR"), "Fonts", "msyh.ttc")}
	for _, path := range paths {
		if path == "" {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		collection, err := opentype.ParseCollection(data)
		if err != nil {
			continue
		}
		return collection.Font(0)
	}
	return nil, fmt.Errorf("详情排版缺少中文字体，请安装 font-noto-cjk 或设置 DETAIL_FONT_PATH")
}

func detailTextLines(face font.Face, text string, width int) ([]string, error) {
	var lines []string
	line := ""
	for _, r := range strings.TrimSpace(text) {
		if r == '\n' {
			lines = append(lines, line)
			line = ""
			continue
		}
		if _, ok := face.GlyphAdvance(r); !ok {
			return nil, fmt.Errorf("详情字体不支持字符 %q", r)
		}
		if line != "" && font.MeasureString(face, line+string(r)).Ceil() > width {
			lines = append(lines, line)
			line = ""
		}
		line += string(r)
	}
	if line != "" {
		lines = append(lines, line)
	}
	return lines, nil
}

func detailCopyPlacement(section map[string]interface{}) string {
	return normalizeDetailCopyPlacement(stringAny(section["copy_placement"]), detailDefaultCopyPlacement(stringAny(section["type"]), 0))
}

func detailCopyCardRect(width, height, contentHeight int, placement string) image.Rectangle {
	margin := max(18, width/24)
	if placement == "left" || placement == "right" {
		cardWidth := width * 46 / 100
		cardHeight := min(height-2*margin, max(contentHeight, height*32/100))
		y := (height - cardHeight) / 2
		if placement == "right" {
			return image.Rect(width-margin-cardWidth, y, width-margin, y+cardHeight)
		}
		return image.Rect(margin, y, margin+cardWidth, y+cardHeight)
	}
	cardWidth := width - 2*margin
	cardHeight := min(height-2*margin, contentHeight)
	if placement == "bottom" {
		return image.Rect(margin, height-margin-cardHeight, margin+cardWidth, height-margin)
	}
	return image.Rect(margin, margin, margin+cardWidth, margin+cardHeight)
}

func drawDetailRoundedRect(dst draw.Image, rect image.Rectangle, radius int, fill color.Color) {
	if rect.Empty() {
		return
	}
	radius = min(radius, min(rect.Dx(), rect.Dy())/2)
	if radius <= 0 {
		draw.Draw(dst, rect, &image.Uniform{C: fill}, image.Point{}, draw.Over)
		return
	}
	for y := rect.Min.Y; y < rect.Max.Y; y++ {
		inset := 0
		if y < rect.Min.Y+radius {
			dy := float64(rect.Min.Y + radius - y)
			inset = radius - int(math.Sqrt(float64(radius*radius)-dy*dy))
		} else if y >= rect.Max.Y-radius {
			dy := float64(y - (rect.Max.Y - radius - 1))
			inset = radius - int(math.Sqrt(float64(radius*radius)-dy*dy))
		}
		draw.Draw(dst, image.Rect(rect.Min.X+inset, y, rect.Max.X-inset, y+1), &image.Uniform{C: fill}, image.Point{}, draw.Over)
	}
}

// Typography is rasterized from approved copy over the clean safe area that
// the image model was asked to reserve. The generated module keeps its size and
// art direction instead of receiving the same detached header band every time.
func layoutDetailModule(img image.Image, section map[string]interface{}, typeface *opentype.Font) (image.Image, error) {
	b := img.Bounds()
	w := b.Dx()
	if w < 64 || w > 4096 || b.Dy() < 1 || b.Dy() > 8192 {
		return nil, fmt.Errorf("详情模块尺寸超出排版范围")
	}
	kind := strings.ToLower(strings.TrimSpace(stringAny(section["type"])))
	centered := kind == "hero" || kind == "closing"
	placement := detailCopyPlacement(section)
	side := placement == "left" || placement == "right"
	titleSize, bodySize := float64(w)*0.046, float64(w)*0.026
	if side {
		titleSize, bodySize = float64(w)*0.038, float64(w)*0.022
	}
	if kind == "hero" {
		titleSize *= 1.12
	}
	titleFace, err := opentype.NewFace(typeface, &opentype.FaceOptions{Size: titleSize, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		return nil, err
	}
	defer titleFace.Close()
	bodyFace, err := opentype.NewFace(typeface, &opentype.FaceOptions{Size: bodySize, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		return nil, err
	}
	defer bodyFace.Close()
	title := strings.TrimSpace(stringAny(section["copy_title"]))
	points := stringSlice(section["copy_points"])
	if title == "" && len(points) > 0 {
		title, points = points[0], points[1:]
	}
	if title == "" && len(points) == 0 {
		return img, nil
	}
	margin := max(18, w/24)
	cardWidth := w - 2*margin
	if side {
		cardWidth = w * 46 / 100
	}
	padding := max(18, w/32)
	textWidth := cardWidth - 2*padding
	titleLines, err := detailTextLines(titleFace, title, textWidth)
	if err != nil {
		return nil, err
	}
	var bodyLines []string
	for _, point := range points {
		lines, err := detailTextLines(bodyFace, point, textWidth)
		if err != nil {
			return nil, err
		}
		bodyLines = append(bodyLines, lines...)
	}
	if len(titleLines) > 3 || len(bodyLines) > 6 {
		return nil, fmt.Errorf("详情文案过长，请缩短标题和说明后重试")
	}
	titleHeight, bodyHeight := int(titleSize*1.4), int(bodySize*1.6)
	contentHeight := padding*2 + len(titleLines)*titleHeight + len(bodyLines)*bodyHeight
	card := detailCopyCardRect(w, b.Dy(), contentHeight, placement)
	background, accent := detailPalette(stringAny(section["_style"]))
	var band color.Color = color.NRGBA{R: background.R, G: background.G, B: background.B, A: 238}
	titleColor, bodyColor := accent, detailContrastText(background)
	if centered {
		band = color.NRGBA{R: accent.R, G: accent.G, B: accent.B, A: 238}
		titleColor = detailContrastText(accent)
		bodyColor = titleColor
	}
	canvas := image.NewRGBA(image.Rect(0, 0, w, b.Dy()))
	draw.Draw(canvas, canvas.Bounds(), img, b.Min, draw.Src)
	drawDetailRoundedRect(canvas, card, max(12, w/64), band)
	if !centered {
		stripe := max(4, w/240)
		drawDetailRoundedRect(canvas, image.Rect(card.Min.X, card.Min.Y, card.Min.X+stripe, card.Max.Y), stripe/2, accent)
	}
	d := font.Drawer{Dst: canvas, Src: image.NewUniform(titleColor), Face: titleFace}
	y := card.Min.Y + padding
	for _, line := range titleLines {
		x := card.Min.X + padding
		if centered {
			x = card.Min.X + (card.Dx()-font.MeasureString(titleFace, line).Ceil())/2
		}
		d.Dot = fixed.P(x, y+titleFace.Metrics().Ascent.Ceil())
		d.DrawString(line)
		y += titleHeight
	}
	d.Face = bodyFace
	d.Src = image.NewUniform(bodyColor)
	for _, line := range bodyLines {
		x := card.Min.X + padding
		if centered {
			x = card.Min.X + (card.Dx()-font.MeasureString(bodyFace, line).Ceil())/2
		}
		d.Dot = fixed.P(x, y+bodyFace.Metrics().Ascent.Ceil())
		d.DrawString(line)
		y += bodyHeight
	}
	return canvas, nil
}

func typesetDetailSection(ctx context.Context, publicID, sourceURL string, section map[string]interface{}, typeface *opentype.Font) (string, error) {
	if objectStore == nil {
		return "", fmt.Errorf("详情排版对象存储未初始化")
	}
	data, _, err := loadMediaBytes(ctx, sourceURL)
	if err != nil {
		return "", err
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width > 4096 || config.Height > 8192 {
		return "", fmt.Errorf("详情底图无效或尺寸超出安全范围")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	result, err := layoutDetailModule(img, section, typeface)
	if err != nil {
		return "", err
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, result, &jpeg.Options{Quality: 92}); err != nil {
		return "", err
	}
	name := fmt.Sprintf("workflows/%s/detail-module-%d.jpg", publicID, time.Now().UnixNano())
	return objectStore.Upload(ctx, name, "image/jpeg", bytes.NewReader(encoded.Bytes()), int64(encoded.Len()))
}
