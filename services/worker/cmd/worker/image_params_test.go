package main

import "testing"

func TestResolveImageGenerationInputFallsBackUnsupportedBananaRatio(t *testing.T) {
	input := map[string]interface{}{
		"aspect_ratio": "4:5",
		"image_size":   "4K",
	}

	resolveImageGenerationInput(input, nil, "/v1/videos", "nano_banana_pro-2K")

	if got := input["aspect_ratio"]; got != "1:1" {
		t.Fatalf("aspect_ratio = %v, want 1:1", got)
	}
	if got := input["image_size"]; got != "4K" {
		t.Fatalf("image_size = %v, want 4K", got)
	}
	if got := input["size"]; got != "2880x2880" {
		t.Fatalf("size = %v, want 2880x2880", got)
	}
}

func TestImageModelForSizeMapsAsyncImageFamilies(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		model    string
		tier     string
		want     string
	}{
		{name: "banana 1k", endpoint: "/v1/videos", model: "nano_banana_2", tier: "1K", want: "nano_banana_pro-1K"},
		{name: "banana 4k", endpoint: "/v1/videos", model: "nano_banana_pro-1K", tier: "4K", want: "nano_banana_pro-4K"},
		{name: "gpt image 2k", endpoint: "/v1/videos", model: "gpt-image-2", tier: "2K", want: "gpt-image-2-2K"},
		{name: "gpt image 4k", endpoint: "/v1/videos", model: "gpt-image-2-2K", tier: "4K", want: "gpt-image-2-4K"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := imageModelForSize(nil, tt.endpoint, tt.model, "", tt.tier); got != tt.want {
				t.Fatalf("model = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestImageModelForSizePrefersRuntimeRule(t *testing.T) {
	rule := map[string]interface{}{
		"image": map[string]interface{}{
			"model_by_size": map[string]interface{}{
				"2K": "custom-image-2k",
			},
		},
	}

	if got := imageModelForSize(rule, "/v1/videos", "gpt-image-2", "", "2K"); got != "custom-image-2k" {
		t.Fatalf("model = %s, want custom-image-2k", got)
	}
}

func TestGeminiNativePayloadImageSizeOnlyForFlash(t *testing.T) {
	input := map[string]interface{}{
		"aspect_ratio": "16:9",
		"image_size":   "4K",
	}

	flash := buildGeminiNativeImagePayload(nil, "gemini-3.1-flash-image-preview", "", "prompt", input)
	flashCfg := flash["generationConfig"].(map[string]interface{})["imageConfig"].(map[string]interface{})
	if got := flashCfg["imageSize"]; got != "4K" {
		t.Fatalf("flash imageSize = %v, want 4K", got)
	}

	pro := buildGeminiNativeImagePayload(nil, "gemini-3-pro-image-preview", "", "prompt", input)
	proCfg := pro["generationConfig"].(map[string]interface{})["imageConfig"].(map[string]interface{})
	if _, ok := proCfg["imageSize"]; ok {
		t.Fatalf("pro payload should not include imageSize: %#v", proCfg)
	}
}
