package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"math"
	"strings"

	xdraw "golang.org/x/image/draw"
)

// Coordinates are relative to the original product photo, never a thumbnail.
type productBox [4]float64

func (b productBox) valid() bool {
	for _, v := range b {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return b[0] >= 0 && b[1] >= 0 && b[2] > 0 && b[3] > 0 && b[0]+b[2] <= 1.000001 && b[1]+b[3] <= 1.000001
}

func (b productBox) rect(bounds image.Rectangle) image.Rectangle {
	return image.Rect(bounds.Min.X+int(b[0]*float64(bounds.Dx())), bounds.Min.Y+int(b[1]*float64(bounds.Dy())), bounds.Min.X+int(math.Ceil((b[0]+b[2])*float64(bounds.Dx()))), bounds.Min.Y+int(math.Ceil((b[1]+b[3])*float64(bounds.Dy())))).Intersect(bounds)
}

func decodeProductImage(data []byte) (image.Image, error) {
	c, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || c.Width <= 0 || c.Height <= 0 || int64(c.Width)*int64(c.Height) > 32_000_000 {
		return nil, fmt.Errorf("图片无效或超过3200万像素")
	}
	im, _, err := image.Decode(bytes.NewReader(data))
	return im, err
}

func productPNG(im image.Image) ([]byte, error) {
	var buf bytes.Buffer
	err := png.Encode(&buf, im)
	return buf.Bytes(), err
}

func productDataURL(data []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
}

func productJPEGData(im image.Image) (string, error) {
	var buf bytes.Buffer
	err := jpeg.Encode(&buf, im, &jpeg.Options{Quality: 92})
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), err
}

func resizeProductImage(source image.Image, limit int, mask bool) image.Image {
	b := source.Bounds()
	if b.Dx() <= limit && b.Dy() <= limit {
		return source
	}
	scale := math.Min(float64(limit)/float64(b.Dx()), float64(limit)/float64(b.Dy()))
	out := image.NewNRGBA(image.Rect(0, 0, int(math.Round(float64(b.Dx())*scale)), int(math.Round(float64(b.Dy())*scale))))
	if mask {
		xdraw.NearestNeighbor.Scale(out, out.Bounds(), source, b, draw.Src, nil)
	} else {
		xdraw.CatmullRom.Scale(out, out.Bounds(), source, b, draw.Src, nil)
	}
	return out
}

func productModelWorkingLimit(quality string) int {
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "low":
		return 1024
	case "medium", "auto":
		return 1536
	case "high":
		return 2048
	case "xhigh":
		return 2560
	case "max":
		return 3072
	default:
		return 1536
	}
}

// GPT Image 2/2.5 custom dimensions use multiples of 16, at least 655,360
// pixels, at most 8,294,400 pixels, and no edge longer than 3,840 pixels.
func resizeProductModelImage(source image.Image, limit int) image.Image {
	b := source.Bounds()
	if limit <= 0 || limit > 3840 {
		limit = 1536
	}
	const minPixels, maxPixels = 655_360.0, 8_294_400.0
	pixels := float64(b.Dx()) * float64(b.Dy())
	scale := 1.0
	if maxEdge := math.Max(float64(b.Dx()), float64(b.Dy())); maxEdge > float64(limit) {
		scale = float64(limit) / maxEdge
	}
	if pixels*scale*scale > maxPixels {
		scale = math.Sqrt(maxPixels / pixels)
	}
	upscale := pixels*scale*scale < minPixels
	if upscale {
		scale = math.Sqrt(minPixels / pixels)
	}
	align := func(value float64) int {
		if upscale {
			return max(16, int(math.Ceil(value/16))*16)
		}
		return max(16, int(math.Floor(value/16))*16)
	}
	width, height := align(float64(b.Dx())*scale), align(float64(b.Dy())*scale)
	if width == b.Dx() && height == b.Dy() {
		return source
	}
	out := image.NewNRGBA(image.Rect(0, 0, width, height))
	xdraw.CatmullRom.Scale(out, out.Bounds(), source, b, draw.Src, nil)
	return out
}

func productVisionData(source image.Image) (string, error) {
	var buf bytes.Buffer
	err := jpeg.Encode(&buf, resizeProductImage(source, 1536, false), &jpeg.Options{Quality: 94})
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), err
}

func validateProductMask(source, mask []byte) error {
	base, err := decodeProductImage(source)
	if err != nil {
		return err
	}
	config, err := png.DecodeConfig(bytes.NewReader(mask))
	if err != nil || config.Width != base.Bounds().Dx() || config.Height != base.Bounds().Dy() {
		return fmt.Errorf("蒙版必须为与底图同尺寸的PNG")
	}
	im, err := png.Decode(bytes.NewReader(mask))
	if err != nil {
		return fmt.Errorf("蒙版必须为带透明区域的PNG")
	}
	if base.Bounds().Size() != im.Bounds().Size() {
		return fmt.Errorf("蒙版与底图尺寸不一致")
	}
	editable := false
	for y := im.Bounds().Min.Y; y < im.Bounds().Max.Y; y++ {
		for x := im.Bounds().Min.X; x < im.Bounds().Max.X; x++ {
			_, _, _, a := im.At(x, y).RGBA()
			if a < 65535 {
				editable = true
				break
			}
		}
		if editable {
			break
		}
	}
	if !editable {
		return fmt.Errorf("蒙版没有可编辑的透明区域")
	}
	return nil
}

func productRegionMask(bounds image.Rectangle, regions []productBox) (*image.NRGBA, error) {
	if len(regions) == 0 || len(regions) > 12 {
		return nil, fmt.Errorf("局部编辑需要1至12个有效区域")
	}
	mask := image.NewNRGBA(bounds)
	draw.Draw(mask, bounds, image.NewUniform(color.NRGBA{255, 255, 255, 255}), image.Point{}, draw.Src)
	for _, region := range regions {
		if !region.valid() {
			return nil, fmt.Errorf("编辑区域超出原图")
		}
		draw.Draw(mask, region.rect(bounds), image.Transparent, image.Point{}, draw.Src)
	}
	return mask, nil
}

func protectedProductMask(bounds image.Rectangle, edit, protected []productBox, repair []productBox) (*image.NRGBA, error) {
	mask, err := productRegionMask(bounds, edit)
	if err != nil {
		return nil, err
	}
	for _, b := range protected {
		if !b.valid() {
			return nil, fmt.Errorf("保护区域无效")
		}
		draw.Draw(mask, b.rect(bounds), image.NewUniform(color.NRGBA{255, 255, 255, 255}), image.Point{}, draw.Src)
	}
	if len(repair) > 0 {
		localized, err := productRegionMask(bounds, repair)
		if err != nil {
			return nil, err
		}
		for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
			for x := bounds.Min.X; x < bounds.Max.X; x++ {
				if localized.NRGBAAt(x, y).A == 255 {
					mask.SetNRGBA(x, y, color.NRGBA{255, 255, 255, 255})
				}
			}
		}
	}
	return mask, nil
}

// Keep every opaque-mask pixel from the original; generation only contributes
// inside editable regions. Resizing is applied to the generated layer only.
func compositeProductPixels(source, generated, mask image.Image) (*image.NRGBA, error) {
	if source.Bounds().Size() != mask.Bounds().Size() {
		return nil, fmt.Errorf("保护蒙版尺寸不一致")
	}
	b := source.Bounds()
	resized := image.NewNRGBA(b)
	xdraw.CatmullRom.Scale(resized, b, generated, generated.Bounds(), draw.Src, nil)
	out := image.NewNRGBA(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			s := color.NRGBAModel.Convert(source.At(x, y)).(color.NRGBA)
			g := resized.NRGBAAt(x, y)
			_, _, _, alpha := mask.At(x, y).RGBA()
			keep := uint32(alpha >> 8)
			blend := func(a, b uint8) uint8 { return uint8((uint32(a)*keep + uint32(b)*(255-keep) + 127) / 255) }
			out.SetNRGBA(x, y, color.NRGBA{blend(s.R, g.R), blend(s.G, g.G), blend(s.B, g.B), blend(s.A, g.A)})
		}
	}
	return out, nil
}

// Scene composition keeps the model's native output dimensions. Local edits
// composite on the same reduced canvas that was sent to the image model.
func finalizeProductPixels(sceneComposition bool, base, generated, mask image.Image, aspectRatio string) (image.Image, error) {
	if sceneComposition {
		return cropProductAspect(generated, aspectRatio), nil
	}
	out, err := compositeProductPixels(base, generated, mask)
	if err != nil {
		return nil, err
	}
	// Ratio selection must not turn a product-preserving edit into a whole-image
	// regeneration. Apply a centered delivery crop after the original pixels and
	// generated context have been composited on their aligned source canvas.
	return cropProductAspect(out, aspectRatio), nil
}

// Local repair runs the image model on a bounded working copy, then composites
// the repaired patch back onto the original resolution. Pixels outside the
// user-selected mask therefore remain byte-for-byte identical.
func finalizeProductLocalRepair(original, modelBase, generated, modelMask, originalMask image.Image) (image.Image, error) {
	modelResult, err := compositeProductPixels(modelBase, generated, modelMask)
	if err != nil {
		return nil, err
	}
	return compositeProductPixels(original, modelResult, originalMask)
}

func cropProductAspect(source image.Image, aspectRatio string) image.Image {
	if strings.EqualFold(strings.TrimSpace(aspectRatio), "auto") || strings.TrimSpace(aspectRatio) == "" {
		return source
	}
	var ratioWidth, ratioHeight float64
	if n, _ := fmt.Sscanf(aspectRatio, "%f:%f", &ratioWidth, &ratioHeight); n != 2 || ratioWidth <= 0 || ratioHeight <= 0 {
		return source
	}
	bounds := source.Bounds()
	target := ratioWidth / ratioHeight
	width, height := bounds.Dx(), bounds.Dy()
	if actual := float64(width) / float64(height); actual > target {
		width = int(math.Round(float64(height) * target))
	} else if actual < target {
		height = int(math.Round(float64(width) / target))
	}
	if width <= 0 || height <= 0 || width == bounds.Dx() && height == bounds.Dy() {
		return source
	}
	left := bounds.Min.X + (bounds.Dx()-width)/2
	top := bounds.Min.Y + (bounds.Dy()-height)/2
	out := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.Draw(out, out.Bounds(), source, image.Pt(left, top), draw.Src)
	return out
}

func cropProductPixels(source image.Image, box productBox) (*image.NRGBA, error) {
	if !box.valid() {
		return nil, fmt.Errorf("特写裁切范围无效")
	}
	r := box.rect(source.Bounds())
	if r.Dx() < 16 || r.Dy() < 16 {
		return nil, fmt.Errorf("特写区域过小，请补充高清图")
	}
	out := image.NewNRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
	draw.Draw(out, out.Bounds(), source, r.Min, draw.Src)
	return out, nil
}
