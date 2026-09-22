package runtime

import "testing"

func TestGeminiReferenceMediaTypes(t *testing.T) {
	for _, item := range []struct{ url, mime string }{
		{"https://assets.example/video.mp4?token=abc", "video/mp4"},
		{"https://assets.example/product.png", "image/png"},
	} {
		part := geminiMediaPart(map[string]interface{}{"url": item.url})
		file := part["fileData"].(map[string]interface{})
		if file["mimeType"] != item.mime || file["fileUri"] != item.url {
			t.Fatalf("reference media incorrectly encoded: %#v", file)
		}
	}
}
