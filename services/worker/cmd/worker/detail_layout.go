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
	if layers, ok := section["text_layers"]; ok {
		return layoutDetailTextLayers(img, layers, typeface)
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
	free := boolAny(section["_free_creation"])
	if !free && (len(titleLines) > 3 || len(bodyLines) > 6) {
		return nil, fmt.Errorf("详情文案过长，请缩短标题和说明后重试")
	}
	titleHeight, bodyHeight := int(titleSize*1.4), int(bodySize*1.6)
	contentHeight := padding*2 + len(titleLines)*titleHeight + len(bodyLines)*bodyHeight
	if contentHeight > b.Dy()-2*margin {
		return nil, fmt.Errorf("详情文案超出图片排版范围")
	}
	card := detailCopyCardRect(w, b.Dy(), contentHeight, placement)
	if free {
		contentWidth := 0
		for _, line := range titleLines {
			contentWidth = max(contentWidth, font.MeasureString(titleFace, line).Ceil())
		}
		for _, line := range bodyLines {
			contentWidth = max(contentWidth, font.MeasureString(bodyFace, line).Ceil())
		}
		width := min(card.Dx(), contentWidth+2*padding)
		if placement == "right" {
			card.Min.X = card.Max.X - width
		} else {
			card.Max.X = card.Min.X + width
		}
	}
	background, accent := detailPalette(stringAny(section["_style"]))
	var band color.Color = color.NRGBA{R: background.R, G: background.G, B: background.B, A: 238}
	titleColor, bodyColor := accent, detailContrastText(background)
	if free {
		band = color.NRGBA{R: background.R, G: background.G, B: background.B, A: 190}
		titleColor, bodyColor = detailContrastText(background), detailContrastText(background)
	} else if centered {
		band = color.NRGBA{R: accent.R, G: accent.G, B: accent.B, A: 238}
		titleColor = detailContrastText(accent)
		bodyColor = titleColor
	}
	canvas := image.NewRGBA(image.Rect(0, 0, w, b.Dy()))
	draw.Draw(canvas, canvas.Bounds(), img, b.Min, draw.Src)
	drawDetailRoundedRect(canvas, card, max(12, w/64), band)
	if !centered && !free {
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

// Free creation supplies an editable layout plan. No card, headline, or bullet
// treatment is added unless the plan explicitly asks for it.
func layoutDetailTextLayers(img image.Image, raw interface{}, typeface *opentype.Font) (image.Image, error) {
	items, ok := raw.([]interface{})
	if !ok {
		if typed, yes := raw.([]map[string]interface{}); yes {
			for _, item := range typed {
				items = append(items, item)
			}
		} else {
			return nil, fmt.Errorf("详情文字图层格式无效")
		}
	}
	if len(items) > 24 {
		return nil, fmt.Errorf("详情文字图层过多")
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	canvas := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(canvas, canvas.Bounds(), img, b.Min, draw.Src)
	occupied := []image.Rectangle{}
	for _, rawLayer := range items {
		layer, ok := mapAny(rawLayer)
		if !ok {
			return nil, fmt.Errorf("详情文字图层格式无效")
		}
		value := strings.TrimSpace(stringAny(layer["text"]))
		if value == "" {
			continue
		}
		if len([]rune(value)) > 1000 {
			return nil, fmt.Errorf("详情文字图层过长")
		}
		x := min(w-1, max(0, int(floatAny(layer["x"])*float64(w))))
		y := min(h-1, max(0, int(floatAny(layer["y"])*float64(h))))
		maxWidth := min(w-x, max(1, int(floatAny(layer["width"])*float64(w))))
		if maxWidth < 4 {
			return nil, fmt.Errorf("详情文字图层宽度不足")
		}
		size := math.Max(12, math.Min(float64(w)*0.18, floatAny(layer["font_size"])*float64(w)))
		if floatAny(layer["font_size"]) <= 0 {
			size = math.Max(18, float64(w)*0.045)
		}
		var face font.Face
		var lines []string
		var err error
		for size >= 12 {
			if face != nil {
				_ = face.Close()
			}
			face, err = opentype.NewFace(typeface, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
			if err != nil {
				return nil, err
			}
			lines, err = detailTextLines(face, value, maxWidth)
			if err != nil {
				_ = face.Close()
				return nil, err
			}
			if int(float64(len(lines))*size*1.3) <= h {
				break
			}
			size *= 0.9
		}
		if size < 12 {
			_ = face.Close()
			return nil, fmt.Errorf("详情文字图层超出画面")
		}
		lineHeight := int(size * 1.3)
		y = min(y, h-lineHeight*len(lines))
		bg := strings.TrimSpace(stringAny(layer["background"]))
		padding := 0
		if detailHexColor.MatchString(bg) {
			padding = max(8, int(float64(w)*0.012))
		}
		placedY, fits := chooseDetailLayerTop(x, y, maxWidth, lineHeight*len(lines), padding, w, h, occupied)
		if !fits {
			_ = face.Close()
			return nil, fmt.Errorf("详情文字图层空间不足，请调整排版")
		}
		y = placedY
		occupied = append(occupied, image.Rect(max(0, x-padding), max(0, y-padding), min(w, x+maxWidth+padding), min(h, y+lineHeight*len(lines)+padding)))
		lineXs := make([]int, len(lines))
		textLeft, textRight := w, 0
		for i, line := range lines {
			lineXs[i] = x
			lineWidth := font.MeasureString(face, line).Ceil()
			switch stringAny(layer["align"]) {
			case "center":
				lineXs[i] += (maxWidth - lineWidth) / 2
			case "right":
				lineXs[i] += maxWidth - lineWidth
			}
			textLeft = min(textLeft, lineXs[i])
			textRight = max(textRight, lineXs[i]+lineWidth)
		}
		if detailHexColor.MatchString(bg) {
			background := parseDetailColor(bg, color.RGBA{})
			rect := image.Rect(max(0, textLeft-padding), max(0, y-padding), min(w, textRight+padding), min(h, y+lineHeight*len(lines)+padding))
			drawDetailRoundedRect(canvas, rect, max(4, w/100), color.NRGBA{R: background.R, G: background.G, B: background.B, A: 94})
		}
		ink := parseDetailColor(stringAny(layer["color"]), color.RGBA{255, 255, 255, 255})
		d := font.Drawer{Dst: canvas, Src: image.NewUniform(color.NRGBA{R: ink.R, G: ink.G, B: ink.B, A: 235}), Face: face}
		for i, line := range lines {
			d.Dot = fixed.P(lineXs[i], y+i*lineHeight+face.Metrics().Ascent.Ceil())
			d.DrawString(line)
			if stringAny(layer["weight"]) == "bold" {
				d.Dot = fixed.P(lineXs[i]+max(1, w/1000), y+i*lineHeight+face.Metrics().Ascent.Ceil())
				d.DrawString(line)
			}
		}
		_ = face.Close()
	}
	return canvas, nil
}

func chooseDetailLayerTop(x, wantedY, width, height, padding, imageWidth, imageHeight int, occupied []image.Rectangle) (int, bool) {
	maxTop := imageHeight - height
	if maxTop < 0 {
		return 0, false
	}
	bestY, bestDistance, found := 0, imageHeight+1, false
	for top := 0; top <= maxTop; top++ {
		rect := image.Rect(max(0, x-padding), max(0, top-padding), min(imageWidth, x+width+padding), min(imageHeight, top+height+padding)).Inset(-max(4, imageWidth/200))
		clear := true
		for _, other := range occupied {
			if rect.Overlaps(other) {
				clear = false
				break
			}
		}
		if !clear {
			continue
		}
		distance := top - wantedY
		if distance < 0 {
			distance = -distance
		}
		if !found || distance < bestDistance {
			bestY, bestDistance, found = top, distance, true
		}
	}
	return bestY, found
}

func typesetDetailSection(ctx context.Context, publicID, sourceURL string, section map[string]interface{}, typeface *opentype.Font) (string, error) {
	if layers, ok := section["text_layers"].([]interface{}); ok && len(layers) == 0 {
		return sourceURL, nil
	}
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
