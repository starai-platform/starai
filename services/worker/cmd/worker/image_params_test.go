package main

import (
	"context"
	"strings"
	"testing"
)

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
		{name: "gpt image keeps configured model", endpoint: "/v1/videos", model: "gpt-image-2", tier: "4K", want: "gpt-image-2"},
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

func TestBuildVideoImagePayloadIncludesBananaReferenceImages(t *testing.T) {
	input := map[string]interface{}{
		"reference_images": []string{
			"data:image/png;base64,Zmlyc3Q=",
			"data:image/jpeg;base64,c2Vjb25k",
		},
	}

	payload := buildVideoImagePayload(context.Background(), nil, "/v1/videos", "nano_banana_2", "", "prompt", input)
	images, ok := payload["images"].([]string)
	if !ok {
		t.Fatalf("images type = %T, want []string; payload=%#v", payload["images"], payload)
	}
	if len(images) != 2 || images[0] != "data:image/png;base64,Zmlyc3Q=" || images[1] != "data:image/jpeg;base64,c2Vjb25k" {
		t.Fatalf("images = %#v, want both uploaded references", images)
	}
}

func TestBuildVideoImagePayloadIncludesGPTImageSizeWithoutChangingModel(t *testing.T) {
	input := map[string]interface{}{
		"size":             "1456x624",
		"image_size":       "4K",
		"reference_images": []string{"https://star-ai.example/product.jpg"},
	}

	payload := buildVideoImagePayload(context.Background(), nil, "/v1/videos", "gpt-image-2", "", "prompt", input)
	if payload["model"] != "gpt-image-2" {
		t.Fatalf("model = %v, want gpt-image-2", payload["model"])
	}
	if payload["size"] != "1456x624" {
		t.Fatalf("size = %v, want 1456x624", payload["size"])
	}
	if _, exists := payload["aspect_ratio"]; exists {
		t.Fatalf("GPT Image async payload should use size only: %#v", payload)
	}
	images, ok := payload["images"].([]string)
	if !ok || len(images) != 1 || images[0] != "https://star-ai.example/product.jpg" {
		t.Fatalf("public image URL was not preserved: %#v", payload["images"])
	}
}

func TestGPTImage25TransportOptions(t *testing.T) {
	input := map[string]interface{}{"aspect_ratio": "auto", "image_size": "4K"}
	rule := map[string]interface{}{"image": map[string]interface{}{"supported_size_tiers": []interface{}{"1K", "2K", "4K"}}}
	resolveImageGenerationInput(input, rule, "/v1/videos", "gpt-image-2.5-flare")
	payload := buildVideoImagePayload(context.Background(), rule, "/v1/videos", "gpt-image-2.5-flare", "", "prompt", input)
	if input["aspect_ratio"] != "auto" || payload["image_size"] != "4K" {
		t.Fatalf("auto ratio or tier lost: input=%#v payload=%#v", input, payload)
	}
	refs := []string{"1", "2", "3", "4", "5", "6", "7", "8", "9"}
	payload = buildVideoImagePayload(context.Background(), nil, "/v1/videos", "gpt-image-2.5-sunburst", "", "prompt", map[string]interface{}{"reference_images": refs})
	if images, ok := payload["images"].([]string); !ok || len(images) != 8 {
		t.Fatalf("images = %#v, want first 8 references", payload["images"])
	}
	endpoint, err := resolveImageRequestEndpoint(map[string]interface{}{"upstream": map[string]interface{}{"adapter": "otuapi_image", "edit_endpoint": "/v1/images/edits"}}, "/v1/images/generations", "gpt-image2", map[string]interface{}{"reference_images": []string{"https://example.com/ref.png"}})
	if err != nil || endpoint != "/v1/images/edits" {
		t.Fatalf("sync edit endpoint = %q, err=%v", endpoint, err)
	}
}

func TestGPTImage25AutoRatioKeepsAutoAndResolution(t *testing.T) {
	input := map[string]interface{}{
		"aspect_ratio": "auto",
		"image_size":   "4K",
		"size":         nil,
	}
	rule := map[string]interface{}{"image": map[string]interface{}{"supported_size_tiers": []interface{}{"1K", "2K", "4K"}}}

	resolveImageGenerationInput(input, rule, "/v1/videos", "gpt-image-2.5-flare")
	payload := buildVideoImagePayload(context.Background(), rule, "/v1/videos", "gpt-image-2.5-flare", "", "prompt", input)

	if input["aspect_ratio"] != "auto" || input["image_size"] != "4K" {
		t.Fatalf("auto selection was rewritten: %#v", input)
	}
	if _, exists := input["size"]; exists {
		t.Fatalf("auto selection must not resolve to a fixed size: %#v", input)
	}
	if payload["aspect_ratio"] != "auto" || payload["image_size"] != "4K" {
		t.Fatalf("payload lost auto ratio or tier: %#v", payload)
	}
}

func TestGPTImageAsyncKeepsEightReferences(t *testing.T) {
	refs := []string{"1", "2", "3", "4", "5", "6", "7", "8", "9"}
	payload := buildVideoImagePayload(context.Background(), nil, "/v1/videos", "gpt-image-2.5-sunburst", "", "prompt", map[string]interface{}{"reference_images": refs})
	images, ok := payload["images"].([]string)
	if !ok || len(images) != 8 {
		t.Fatalf("images = %#v, want first 8 references", payload["images"])
	}
}

func TestOtuapiSyncReferenceUsesEditsEndpoint(t *testing.T) {
	rule := map[string]interface{}{"upstream": map[string]interface{}{"adapter": "otuapi_image", "edit_endpoint": "/v1/images/edits"}}
	endpoint, err := resolveImageRequestEndpoint(rule, "/v1/images/generations", "gpt-image2", map[string]interface{}{"reference_images": []string{"https://example.com/ref.png"}})
	if err != nil {
		t.Fatal(err)
	}
	if endpoint != "/v1/images/edits" {
		t.Fatalf("endpoint = %s, want /v1/images/edits", endpoint)
	}
}

func TestBuildVideoImagePayloadFallsBackToImageURL(t *testing.T) {
	input := map[string]interface{}{
		"image_url": "data:image/png;base64,cGhvbmU=",
	}

	payload := buildVideoImagePayload(context.Background(), nil, "/v1/videos", "nano_banana_2", "", "prompt", input)
	images, ok := payload["images"].([]string)
	if !ok || len(images) != 1 || images[0] != "data:image/png;base64,cGhvbmU=" {
		t.Fatalf("image_url was not forwarded as Nano Banana images: %#v", payload)
	}
}

func TestNormalizePayloadMediaPreservesPublicAsyncImageURLs(t *testing.T) {
	payload := map[string]interface{}{
		"images": []string{"https://star-ai.example/product.jpg"},
	}
	if err := normalizePayloadMedia(context.Background(), payload, "/v1/videos"); err != nil {
		t.Fatal(err)
	}
	images, ok := payload["images"].([]string)
	if !ok || len(images) != 1 || images[0] != "https://star-ai.example/product.jpg" {
		t.Fatalf("public image URL was rewritten: %#v", payload["images"])
	}
}

func TestAgentPromptLocksUploadedReferenceSubject(t *testing.T) {
	prompt := agentPromptWithScene("create a premium product shot", map[string]interface{}{
		"image_url": "https://cdn.example/phone.png",
	})

	for _, required := range []string{"REFERENCE IMAGE GUIDANCE", "authoritative subject", "features the user has not explicitly requested to edit", "user-confirmed design, pose and viewpoint edits override these defaults"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("prompt does not contain %q: %s", required, prompt)
		}
	}
}

func TestImagePoliciesBindPrimaryAndAuxiliaryReferences(t *testing.T) {
	prompt := applyImageGenerationPolicies("保持鞋子后视角，鞋两边合理显示能观察到的文字部分", map[string]interface{}{
		"language":         "中文",
		"reference_images": []string{"https://cdn.example/product.jpg", "https://cdn.example/pose.jpg"},
	})
	for _, required := range []string{"Reference image 1 is the authoritative source", "References 2 and later are auxiliary", "Do not copy their product shape", "TEXT RENDERING POLICY:"} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("image policy does not contain %q: %s", required, prompt)
		}
	}
	for _, forbidden := range []string{"Generate all visible text", "LANGUAGE HARD REQUIREMENT:"} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("product-marking request incorrectly enabled generated copy %q: %s", forbidden, prompt)
		}
	}
	if got := applyImageGenerationPolicies(prompt, map[string]interface{}{"language": "中文", "reference_images": []string{"https://cdn.example/product.jpg", "https://cdn.example/pose.jpg"}}); got != prompt {
		t.Fatal("image policies were duplicated on the worker's second pass")
	}
}

func TestImagePoliciesAllowOnlyExplicitPosterCopy(t *testing.T) {
	prompt := applyImageGenerationPolicies("添加文案：夏日上新", map[string]interface{}{
		"language":       "中文",
		"creative_scene": "marketing_poster",
	})
	if !strings.Contains(prompt, "LANGUAGE HARD REQUIREMENT:") || !strings.Contains(prompt, "only the text explicitly requested") {
		t.Fatalf("explicit poster copy lost its language policy: %s", prompt)
	}
	if strings.Contains(prompt, "Generate all visible text") {
		t.Fatalf("old generate-everything instruction survived: %s", prompt)
	}
}

func TestAgentPromptDoesNotAddReferenceLockWithoutReference(t *testing.T) {
	prompt := agentPromptWithScene("create a premium product shot", map[string]interface{}{})
	if strings.Contains(prompt, "REFERENCE IMAGE GUIDANCE") {
		t.Fatalf("reference lock added without a reference: %s", prompt)
	}
}

func TestAgentPromptDoesNotTreatComicStyleCoverAsSubjectReference(t *testing.T) {
	prompt := agentPromptWithScene("create a premium product shot", map[string]interface{}{
		"comic_style": map[string]interface{}{"cover_url": "https://cdn.example/style-cover.png"},
	})
	if strings.Contains(prompt, "REFERENCE IMAGE GUIDANCE") {
		t.Fatalf("style cover incorrectly locked as the generated subject: %s", prompt)
	}
}
