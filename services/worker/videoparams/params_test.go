package videoparams

import "testing"

func TestSanitizeUpstreamPayloadUsesImagesForVeo(t *testing.T) {
	payload := map[string]interface{}{
		"model":            "veo_3_1-fast-fl",
		"first_frame":      "https://example.com/first.jpg",
		"last_frame":       "https://example.com/last.jpg",
		"reference_images": []interface{}{"https://example.com/ref.jpg"},
		"orientation":      "portrait",
	}

	got := SanitizeUpstreamPayload(payload, "/v1/videos")
	images, ok := got["images"].([]string)
	if !ok {
		t.Fatalf("images = %#v, want []string", got["images"])
	}
	want := []string{"https://example.com/first.jpg", "https://example.com/last.jpg", "https://example.com/ref.jpg"}
	if len(images) != len(want) {
		t.Fatalf("images len = %d, want %d (%#v)", len(images), len(want), images)
	}
	for i := range want {
		if images[i] != want[i] {
			t.Fatalf("images[%d] = %q, want %q", i, images[i], want[i])
		}
	}
	if _, ok := got["image_url"]; ok {
		t.Fatalf("image_url should not be sent for Veo JSON")
	}
	if got["aspect_ratio"] != "9:16" {
		t.Fatalf("aspect_ratio = %#v, want 9:16", got["aspect_ratio"])
	}
}

func TestSanitizeUpstreamPayloadUsesImageURLForSora(t *testing.T) {
	payload := map[string]interface{}{
		"model":            "sora-2-12s",
		"reference_images": []interface{}{"https://example.com/ref.jpg", "https://example.com/ignored.jpg"},
		"orientation":      "landscape",
	}

	got := SanitizeUpstreamPayload(payload, "/v1/videos")
	if got["image_url"] != "https://example.com/ref.jpg" {
		t.Fatalf("image_url = %#v", got["image_url"])
	}
	if _, ok := got["images"]; ok {
		t.Fatalf("images should not be sent for Sora")
	}
	if got["aspect_ratio"] != "16:9" {
		t.Fatalf("aspect_ratio = %#v, want 16:9", got["aspect_ratio"])
	}
}

func TestSanitizeUpstreamPayloadDropsAnalysisOnlyFields(t *testing.T) {
	payload := map[string]interface{}{
		"model":           "sora-2-12s",
		"prompt":          "product video",
		"negative_prompt": "low quality",
		"selling_points":  []interface{}{"texture"},
		"user_intent":     "main visual",
		"asset_notes":     "reference image",
	}

	got := SanitizeUpstreamPayload(payload, "/v1/videos")
	for _, key := range []string{"negative_prompt", "selling_points", "user_intent", "asset_notes"} {
		if _, ok := got[key]; ok {
			t.Fatalf("%s should not be sent to video upstream: %#v", key, got)
		}
	}
}
