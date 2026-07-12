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

func TestBuildUpstreamPayloadSupportsNestedMap(t *testing.T) {
	got := BuildUpstreamVideoPayload(
		"audio_minimax_speech_28_hd",
		"speech-2.8-hd",
		map[string]interface{}{
			"upstream": map[string]interface{}{
				"include": []interface{}{"voice_id", "speed", "format"},
				"map": map[string]interface{}{
					"prompt":   "text",
					"voice_id": "voice_setting.voice_id",
					"speed":    "voice_setting.speed",
					"format":   "audio_setting.format",
				},
				"static": map[string]interface{}{"stream": false},
			},
		},
		nil,
		map[string]interface{}{
			"prompt":   "hello",
			"voice_id": "male-qn-qingse",
			"speed":    1.15,
			"format":   "mp3",
		},
	)
	if got["text"] != "hello" || got["model"] != "speech-2.8-hd" || got["stream"] != false {
		t.Fatalf("unexpected top-level payload: %#v", got)
	}
	voice, ok := got["voice_setting"].(map[string]interface{})
	if !ok {
		t.Fatalf("voice_setting missing: %#v", got)
	}
	if voice["voice_id"] != "male-qn-qingse" || voice["speed"] != 1.15 {
		t.Fatalf("unexpected voice_setting: %#v", voice)
	}
	audio, ok := got["audio_setting"].(map[string]interface{})
	if !ok || audio["format"] != "mp3" {
		t.Fatalf("unexpected audio_setting: %#v", got)
	}
	if _, ok := got["response_format"]; ok {
		t.Fatalf("response_format should not be sent: %#v", got)
	}
}

func TestBuildUpstreamPayloadSupportsMinimaxMusicTemplate(t *testing.T) {
	got := BuildUpstreamVideoPayload(
		"audio_minimax_music_26",
		"music-2.6",
		map[string]interface{}{
			"upstream": map[string]interface{}{
				"include": []interface{}{"model_version", "music_prompt", "output_format", "format", "sample_rate", "bitrate"},
				"map": map[string]interface{}{
					"prompt":        "lyrics",
					"music_prompt":  "prompt",
					"model_version": "model",
					"format":        "audio_setting.format",
					"sample_rate":   "audio_setting.sample_rate",
					"bitrate":       "audio_setting.bitrate",
				},
				"static": map[string]interface{}{"stream": false},
			},
		},
		nil,
		map[string]interface{}{
			"prompt":        "[Verse] hello",
			"music_prompt":  "upbeat pop",
			"model_version": "music-2.6",
			"output_format": "hex",
			"format":        "mp3",
			"sample_rate":   44100,
			"bitrate":       256000,
		},
	)
	if got["model"] != "music-2.6" || got["lyrics"] != "[Verse] hello" || got["prompt"] != "upbeat pop" {
		t.Fatalf("unexpected MiniMax music payload: %#v", got)
	}
	if got["output_format"] != "hex" || got["stream"] != false {
		t.Fatalf("missing MiniMax music output settings: %#v", got)
	}
	audio, ok := got["audio_setting"].(map[string]interface{})
	if !ok || audio["format"] != "mp3" || audio["sample_rate"] != float64(44100) || audio["bitrate"] != float64(256000) {
		t.Fatalf("unexpected MiniMax music audio_setting: %#v", got)
	}
}

func TestBuildUpstreamPayloadSupportsCompatibleSpeechMusicTemplate(t *testing.T) {
	got := BuildUpstreamVideoPayload(
		"music-2-6-openai",
		"music-2.6",
		map[string]interface{}{
			"upstream": map[string]interface{}{
				"include": []interface{}{"music_prompt", "format", "sample_rate", "bitrate"},
				"map": map[string]interface{}{
					"prompt":       "metadata.lyrics",
					"music_prompt": "input",
					"format":       "response_format",
					"sample_rate":  "metadata.sample_rate",
					"bitrate":      "metadata.bitrate",
				},
			},
		},
		nil,
		map[string]interface{}{
			"prompt":       "[Chorus] hello",
			"music_prompt": "Mandopop, upbeat",
			"format":       "mp3",
			"sample_rate":  44100,
			"bitrate":      256000,
		},
	)
	if got["input"] != "Mandopop, upbeat" || got["response_format"] != "mp3" {
		t.Fatalf("unexpected compatible music payload: %#v", got)
	}
	metadata, ok := got["metadata"].(map[string]interface{})
	if !ok || metadata["lyrics"] != "[Chorus] hello" || metadata["sample_rate"] != float64(44100) || metadata["bitrate"] != float64(256000) {
		t.Fatalf("unexpected compatible music metadata: %#v", got)
	}
}
