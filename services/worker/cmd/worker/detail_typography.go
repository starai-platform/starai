package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	xdraw "golang.org/x/image/draw"
)

// One vision pass sees the actual clean images together, so copy and placement
// can follow each composition without adding an image-generation retry loop.
func planDetailTypography(ctx context.Context, pool *pgxpool.Pool, baseURL, token, modelCode string, sections []map[string]interface{}, sourceURLs []string, inputs, analysis map[string]interface{}) (map[string][]interface{}, float64, error) {
	model, message := loadAgentAnalysisModel(ctx, pool, modelCode)
	if message != "" {
		return nil, 0, fmt.Errorf("%s", message)
	}
	if !agentAnalysisModelAcceptsImages(model) {
		return nil, 0, fmt.Errorf("文案模型不支持图片理解")
	}
	images := make([]string, 0, len(sourceURLs))
	brief := make([]map[string]interface{}, 0, len(sourceURLs))
	ids := make([]string, 0, len(sourceURLs))
	for i, source := range sourceURLs {
		if source == "" {
			continue
		}
		imageData, err := detailTypographyImage(ctx, source)
		if err != nil {
			return nil, 0, err
		}
		section := sections[i]
		id := stringAny(section["id"])
		ids = append(ids, id)
		images = append(images, imageData)
		seedCopy := []string{}
		if raw, ok := section["text_layers"].([]interface{}); ok {
			for _, item := range raw {
				if layer, valid := mapAny(item); valid && strings.TrimSpace(stringAny(layer["text"])) != "" {
					seedCopy = append(seedCopy, stringAny(layer["text"]))
				}
			}
		}
		brief = append(brief, map[string]interface{}{"id": id, "objective": section["objective"], "layout": section["layout"], "image_prompt": section["image_prompt"], "draft_copy_for_inspiration_only": seedCopy})
	}
	if len(images) == 0 {
		return nil, 0, fmt.Errorf("没有可供排版的底图")
	}
	system := `你是电商详情页的创意文案与视觉排版总监。你将按顺序看到每一屏真实生成的底图；图片模型可能违背指令，已经把广告文案、参数、价格或购买按钮画在底图上。只返回严格JSON，顶层sections数组逐屏包含id、existing_copy数组、base_copy_present布尔值和text_layers数组；每个文字图层包含text、x、y、width、font_size、color、align、weight。x、y、width、font_size必须是相对画面宽高的0到1数值，color是#RRGGBB；可选background色值仅在确有必要时添加。不要套用任何固定坐标示例。
先逐屏识别并把底图已印出的广告文字抄到existing_copy数组：印在鞋身、包装等商品本体上的品牌标识不算广告文案；画在背景、信息卡、参数区或购买按钮上的可读文字才算。只要existing_copy非空，设base_copy_present=true且该屏text_layers=[]，绝不能再覆盖第二层文字。没有已有广告文案时existing_copy=[]且base_copy_present=false，再按实际画面决定是否添加文字。不要把放大镜特写、图标、鞋面、人物、品牌标识、现有文字或购买区域当作留白；若没有安全位置，text_layers也可以为空。
先看整组图，再重新构思整页的广告表达与每屏阅读节奏；草稿文案只是灵感，不要求沿用。用户明确要求原样显示的字句才逐字保留，其余可原创、改写、补充虚拟商品设定。允许一字、一句、长短句交错、局部标注、对白、叙事或纯画面；不强迫标题加副标题，不要每屏同样字数、同样位置或相同卡片。按每张底图真实主体、空白、光线和视觉流向决定文字放哪里；不同屏的文字位置与层级应有自然节奏。文字颜色从各屏底图的光线和色彩中取同系深浅，确保局部对比，别整页都用同一个纯黑或纯白；背景复杂时可以给短文案加小范围淡黑半透明底，但不要做横跨人物或商品的大横幅，也不要压住脸、鞋身或特写。没有安全位置可让该屏无字。整页色彩主题一致即可，不固定字体块或坐标。每层预估实际换行高度，图层不能重叠或越界。不要解释。`
	user := fmt.Sprintf("用户原始要求：%s\n整页视觉系统：%s\n以下屏幕信息和图片按同一顺序对应：%s", stringAny(inputs["user_prompt"]), string(mustJSON(analysis["design_system"])), string(mustJSON(brief)))
	result, err := executeWorkerLLMWithMedia(ctx, pool, baseURL, token, fmt.Sprintf("detail_type_%d", time.Now().UnixNano()), model, system, user, .8, 120*time.Second, images, nil)
	if err != nil {
		return nil, 0, err
	}
	pt, ct, crt, cwt := chatUsageTokenDetails(result.ResponseBody)
	cost := estimateModelCostByCodeWorker(ctx, pool, modelCode, result.RequestBody, pt, ct, crt, cwt)
	layers, err := parseDetailTypographyPlan(extractLLMText(result.ResponseBody), ids)
	if layers == nil {
		layers = map[string][]interface{}{}
	}
	for _, section := range sections {
		id := stringAny(section["id"])
		if _, ok := layers[id]; !ok {
			layers[id] = []interface{}{}
		}
	}
	placeDetailTypography(layers, ids, images)
	return layers, cost, err
}

// The vision model can return identical coordinates for every composition.
// Keep its copy and relative typography, but relocate the group to a quiet,
// readable patch of each actual image when that happens.
func placeDetailTypography(plans map[string][]interface{}, ids, previews []string) {
	used := [][2]float64{}
	colorUse := map[string]int{}
	for _, id := range ids {
		for _, item := range plans[id] {
			if layer, ok := mapAny(item); ok {
				colorUse[strings.ToUpper(stringAny(layer["color"]))]++
			}
		}
	}
	for i, id := range ids {
		layers := plans[id]
		if len(layers) == 0 || i >= len(previews) {
			continue
		}
		_, payload, ok := strings.Cut(previews[i], ",")
		if !ok {
			continue
		}
		data, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			continue
		}
		img, _, err := image.Decode(bytes.NewReader(data))
		if err != nil {
			continue
		}
		left, top, right, bottom := detailTypographyBounds(layers, img.Bounds().Dx(), img.Bounds().Dy())
		width, height := right-left, bottom-top
		if width <= 0 || height <= 0 || width > .92 || height > .92 || bottom > 1 {
			plans[id] = []interface{}{}
			continue
		}
		original := detailTypographyScore(img, left, top, width, height, layers)
		repeated := detailTypographyRepeated(left, top, used)
		bestX, bestY, bestScore := left, top, math.Inf(1)
		type candidate struct{ x, y, score float64 }
		candidates := []candidate{}
		for y := .04; y+height <= .96; y += .04 {
			for x := .04; x+width <= .96; x += .04 {
				score := detailTypographyScore(img, x, y, width, height, layers)
				candidates = append(candidates, candidate{x, y, score})
				if score < bestScore {
					bestX, bestY, bestScore = x, y, score
				}
			}
		}
		if repeated && len(used) > 0 {
			mostDistinct := -.001
			for _, candidate := range candidates {
				if candidate.score > bestScore+.003 {
					continue
				}
				nearest := math.Inf(1)
				for _, anchor := range used {
					nearest = math.Min(nearest, math.Hypot(candidate.x-anchor[0], candidate.y-anchor[1]))
				}
				if nearest > mostDistinct {
					bestX, bestY, bestScore, mostDistinct = candidate.x, candidate.y, candidate.score, nearest
				}
			}
		}
		// Small differences are not worth overriding an intentional AI layout.
		if bestScore < original-.008 || repeated && bestScore < original+.015 {
			for _, item := range layers {
				layer, _ := mapAny(item)
				layer["x"] = math.Round((floatAny(layer["x"])+bestX-left)*1000) / 1000
				layer["y"] = math.Round((floatAny(layer["y"])+bestY-top)*1000) / 1000
			}
			left, top = bestX, bestY
		}
		for index, item := range layers {
			layer, ok := mapAny(item)
			if !ok {
				continue
			}
			requested := parseDetailColor(stringAny(layer["color"]), color.RGBA{})
			neutral := max(requested.R, requested.G, requested.B)-min(requested.R, requested.G, requested.B) < 24
			if neutral || colorUse[strings.ToUpper(stringAny(layer["color"]))] > 1 {
				layer["color"] = detailTypographyInk(img, floatAny(layer["x"]), floatAny(layer["y"]), floatAny(layer["width"]), floatAny(layer["font_size"]), index)
			}
			if stringAny(layer["background"]) == "" && detailTypographyNeedsBackdrop(img, layer) {
				layer["background"] = "#000000"
				layer["color"] = "#F2F6F7"
			}
		}
		used = append(used, [2]float64{left, top})
	}
}

func detailTypographyNeedsBackdrop(img image.Image, layer map[string]interface{}) bool {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	left, top, right, bottom := detailTypographyBounds([]interface{}{layer}, w, h)
	startX, startY := int(left*float64(w)), int(top*float64(h))
	endX, endY := min(w-4, int(right*float64(w))), min(h-4, int(bottom*float64(h)))
	var sum, square, edges, count float64
	for py := startY + 4; py < endY; py += 8 {
		for px := startX + 4; px < endX; px += 8 {
			l := detailPixelLuma(img, px, py)
			sum += l
			square += l * l
			edges += math.Abs(l-detailPixelLuma(img, px+4, py)) + math.Abs(l-detailPixelLuma(img, px, py+4))
			count++
		}
	}
	if count == 0 {
		return false
	}
	mean := sum / count
	ink := parseDetailColor(stringAny(layer["color"]), color.RGBA{255, 255, 255, 255})
	inkLuma := (.2126*float64(ink.R) + .7152*float64(ink.G) + .0722*float64(ink.B)) / 255
	return square/count-mean*mean > .025 || edges/count/2 > .045 || math.Abs(mean-inkLuma) < .32
}

func detailTypographyInk(img image.Image, x, y, width, size float64, index int) string {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	left, top := int(x*float64(w)), int(y*float64(h))
	right := min(w, int((x+width)*float64(w)))
	bottom := min(h, top+max(12, int(size*float64(w)*1.6)))
	var red, green, blue, count float64
	for py := top; py < bottom; py += 8 {
		for px := left; px < right; px += 8 {
			r, g, b, _ := img.At(px+img.Bounds().Min.X, py+img.Bounds().Min.Y).RGBA()
			red += float64(r) / 257
			green += float64(g) / 257
			blue += float64(b) / 257
			count++
		}
	}
	if count == 0 {
		return "#FFFFFF"
	}
	red, green, blue = red/count, green/count, blue/count
	lightness := (.2126*red + .7152*green + .0722*blue) / 255
	if lightness > .55 {
		factor := math.Min(.34, .22+float64(index)*.035)
		return fmt.Sprintf("#%02X%02X%02X", uint8(red*factor), uint8(green*factor), uint8(blue*factor))
	}
	factor := math.Max(.68, .82-float64(index)*.035)
	return fmt.Sprintf("#%02X%02X%02X", uint8(255-(255-red)*(1-factor)), uint8(255-(255-green)*(1-factor)), uint8(255-(255-blue)*(1-factor)))
}

func detailTypographyRepeated(x, y float64, used [][2]float64) bool {
	for _, anchor := range used {
		if math.Hypot(x-anchor[0], y-anchor[1]) < .08 {
			return true
		}
	}
	return false
}

func detailTypographyBounds(layers []interface{}, imageWidth, imageHeight int) (float64, float64, float64, float64) {
	left, top, right, bottom := 1.0, 1.0, 0.0, 0.0
	occupied := [][3]float64{}
	for _, item := range layers {
		layer, ok := mapAny(item)
		if !ok {
			continue
		}
		x, y, width, size := floatAny(layer["x"]), floatAny(layer["y"]), floatAny(layer["width"]), floatAny(layer["font_size"])
		length := 0.0
		for _, r := range stringAny(layer["text"]) {
			if r < 128 {
				length += .55
			} else {
				length++
			}
		}
		lines := math.Max(1, math.Ceil(length*size/math.Max(width, .04)))
		height := math.Min(.85, lines*size*1.3*float64(imageWidth)/float64(imageHeight))
		for _, previous := range occupied {
			if x < previous[1] && x+width > previous[0] && y < previous[2]+.008 {
				y = previous[2] + .008
			}
		}
		layer["y"] = math.Round(y*1000) / 1000
		occupied = append(occupied, [3]float64{x, x + width, y + height})
		left, top = math.Min(left, x), math.Min(top, y)
		right, bottom = math.Max(right, x+width), math.Max(bottom, y+height)
	}
	return left, top, right, bottom
}

func detailTypographyScore(img image.Image, x, y, width, height float64, layers []interface{}) float64 {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	startX, startY := int(x*float64(w)), int(y*float64(h))
	endX, endY := int((x+width)*float64(w)), int((y+height)*float64(h))
	var texture, brightness, count float64
	for py := startY + 4; py < endY-4; py += 8 {
		for px := startX + 4; px < endX-4; px += 8 {
			l := detailPixelLuma(img, px, py)
			texture += math.Abs(l-detailPixelLuma(img, px+4, py)) + math.Abs(l-detailPixelLuma(img, px, py+4))
			brightness += l
			count++
		}
	}
	if count == 0 {
		return math.Inf(1)
	}
	texture /= count * 2
	brightness /= count
	ink := 0.0
	if len(layers) > 0 {
		if layer, ok := mapAny(layers[0]); ok {
			c := parseDetailColor(stringAny(layer["color"]), color.RGBA{255, 255, 255, 255})
			ink = (.2126*float64(c.R) + .7152*float64(c.G) + .0722*float64(c.B)) / 255
		}
	}
	contrastPenalty := math.Max(0, .38-math.Abs(brightness-ink))
	return texture*1.6 + contrastPenalty*.7
}

func detailPixelLuma(img image.Image, x, y int) float64 {
	r, g, b, _ := img.At(x+img.Bounds().Min.X, y+img.Bounds().Min.Y).RGBA()
	return (.2126*float64(r) + .7152*float64(g) + .0722*float64(b)) / 65535
}

func detailTypographyImage(ctx context.Context, sourceURL string) (string, error) {
	data, _, err := loadMediaBytes(ctx, sourceURL)
	if err != nil {
		return "", err
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 4096 || config.Height > 8192 {
		return "", fmt.Errorf("详情底图无法读取")
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	width, height := config.Width, config.Height
	if width > height && width > 768 {
		height = height * 768 / width
		width = 768
	} else if height > 768 {
		width = width * 768 / height
		height = 768
	}
	preview := image.NewRGBA(image.Rect(0, 0, width, height))
	xdraw.ApproxBiLinear.Scale(preview, preview.Bounds(), source, source.Bounds(), xdraw.Src, nil)
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, preview, &jpeg.Options{Quality: 72}); err != nil {
		return "", err
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes()), nil
}

func parseDetailTypographyPlan(content string, ids []string) (map[string][]interface{}, error) {
	parsed := parseJSONish(content)
	raw, ok := parsed["sections"].([]interface{})
	if !ok {
		return nil, fmt.Errorf("AI未返回详情排版")
	}
	wanted := map[string]bool{}
	for _, id := range ids {
		wanted[id] = true
	}
	result := map[string][]interface{}{}
	for _, item := range raw {
		section, valid := mapAny(item)
		if !valid {
			continue
		}
		id := stringAny(section["id"])
		if !wanted[id] {
			continue
		}
		present, _ := section["base_copy_present"].(bool)
		if present || len(stringSlice(section["existing_copy"])) > 0 {
			result[id] = []interface{}{}
			continue
		}
		layers, valid := section["text_layers"].([]interface{})
		if !valid {
			continue
		}
		clean := make([]interface{}, 0, min(len(layers), 24))
		for _, item := range layers[:min(len(layers), 24)] {
			layer, valid := mapAny(item)
			if !valid || strings.TrimSpace(stringAny(layer["text"])) == "" || len([]rune(stringAny(layer["text"]))) > 1000 {
				continue
			}
			x := detailTypographyFraction(layer["x"], .1, 0, .9)
			y := detailTypographyFraction(layer["y"], .15, 0, .9)
			width := detailTypographyFraction(layer["width"], .48, .08, 1-x)
			size := detailTypographyFraction(layer["font_size"], .05, .015, .14)
			layer["x"], layer["y"], layer["width"], layer["font_size"] = x, y, width, size
			if len(stringAny(layer["color"])) != 7 || !detailHexColor.MatchString(stringAny(layer["color"])) {
				layer["color"] = "#FFFFFF"
			}
			if bg := stringAny(layer["background"]); bg != "" && (len(bg) != 7 || !detailHexColor.MatchString(bg)) {
				delete(layer, "background")
			}
			clean = append(clean, layer)
		}
		result[id] = clean
	}
	if len(result) != len(wanted) {
		return result, fmt.Errorf("AI未完成整组文字规划")
	}
	return result, nil
}

func detailTypographyFraction(value interface{}, fallback, low, high float64) float64 {
	number := floatAny(value)
	if raw, ok := value.(string); ok {
		trimmed := strings.TrimSpace(raw)
		if percent, yes := strings.CutSuffix(trimmed, "%"); yes {
			trimmed = strings.TrimSpace(percent)
			parsed, err := strconv.ParseFloat(trimmed, 64)
			if err != nil {
				number = fallback
			} else {
				number = parsed / 100
			}
		} else if _, err := strconv.ParseFloat(trimmed, 64); err != nil {
			number = fallback
		}
	}
	if value == nil || math.IsNaN(number) || math.IsInf(number, 0) {
		number = fallback
	}
	if number == 0 && low > 0 {
		number = fallback
	}
	return math.Max(low, math.Min(high, number))
}
