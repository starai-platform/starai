package videoparams

import (
	"encoding/json"
	"strconv"
	"testing"
)

func TestBuildUpstreamPayloadPreservesConfiguredVideoDurations(t *testing.T) {
	for _, seconds := range []int{5, 6, 8, 10, 12, 15} {
		t.Run(strconv.Itoa(seconds)+"s", func(t *testing.T) {
			got := BuildUpstreamVideoPayload(
				"video-configured-duration",
				"video-configured-duration",
				map[string]interface{}{
					"upstream": map[string]interface{}{
						"include": []interface{}{"duration"},
					},
				},
				nil,
				map[string]interface{}{
					"prompt":   "test",
					"duration": strconv.Itoa(seconds) + "s",
				},
			)
			got = SanitizeUpstreamPayload(got, "/v1/videos")
			duration, ok := got["duration"].(float64)
			if !ok || int(duration) != seconds {
				t.Fatalf("duration = %#v, want %d", got["duration"], seconds)
			}
		})
	}
}

func TestBuildAliyunQwenImagePayload(t *testing.T) {
	got := BuildUpstreamVideoPayload("qwen", "qwen-image-3.0-pro", map[string]interface{}{
		"upstream": map[string]interface{}{"adapter": "aliyun_qwen_image_v3", "map": map[string]interface{}{"prompt": "input.prompt"}},
	}, nil, map[string]interface{}{
		"prompt": "一只猫", "reference_images": []interface{}{"https://example.com/cat.png"},
		"count": 2, "size": "2048x2048", "prompt_extend": true, "prompt_extend_mode": "agent",
	})
	input := got["input"].(map[string]interface{})
	messages := input["messages"].([]interface{})
	content := messages[0].(map[string]interface{})["content"].([]interface{})
	if len(content) != 2 || content[0].(map[string]interface{})["image"] != "https://example.com/cat.png" {
		t.Fatalf("content = %#v", content)
	}
	parameters := got["parameters"].(map[string]interface{})
	if parameters["size"] != "2048*2048" || parameters["n"] != 2 || parameters["prompt_extend"] != true {
		t.Fatalf("parameters = %#v", parameters)
	}
	if parameters["prompt_extend_mode"] != "direct" {
		t.Fatalf("prompt_extend_mode = %#v, want direct for reference-image input", parameters["prompt_extend_mode"])
	}
}

func TestBuildAliyunQwenImageOmitsAutoSize(t *testing.T) {
	got := BuildUpstreamVideoPayload("qwen", "qwen-image-3.0", map[string]interface{}{
		"upstream": map[string]interface{}{"adapter": "aliyun_qwen_image_v3"},
	}, nil, map[string]interface{}{"prompt": "一只猫", "size": "auto"})
	if _, exists := got["parameters"].(map[string]interface{})["size"]; exists {
		t.Fatalf("Qwen auto size must be omitted upstream: %#v", got)
	}
}

func TestBuildAliyunTTSPayloadIncludesInstruction(t *testing.T) {
	got := BuildUpstreamVideoPayload("qwen-tts", "qwen-audio-3.0-tts-flash", map[string]interface{}{
		"upstream": map[string]interface{}{
			"include": []interface{}{"voice", "format", "sample_rate"},
			"map": map[string]interface{}{
				"prompt": "input.text", "voice": "input.voice", "format": "input.format",
				"sample_rate": "input.sample_rate",
			},
		},
	}, nil, map[string]interface{}{
		"prompt": "你好", "voice": "longanhuan_v3.6", "format": "wav",
		"sample_rate": 24000, "instruction": "温柔、稍慢地朗读",
	})
	input, ok := got["input"].(map[string]interface{})
	if !ok || input["text"] != "你好" || input["instruction"] != "温柔、稍慢地朗读" {
		t.Fatalf("unexpected Aliyun TTS input: %#v", got)
	}
}

func TestBuildAliyunVideoPayload(t *testing.T) {
	got := BuildUpstreamVideoPayload("wan3", "wan3.0-video", map[string]interface{}{
		"upstream": map[string]interface{}{"adapter": "aliyun_video_generation"},
	}, nil, map[string]interface{}{
		"prompt": "运镜", "first_frame": "https://example.com/first.png",
		"reference_audios": []interface{}{"https://example.com/music.mp3"},
		"resolution":       "720P", "ratio": "16:9", "duration": 10,
	})
	input := got["input"].(map[string]interface{})
	media := input["media"].([]interface{})
	if len(media) != 2 || media[0].(map[string]interface{})["type"] != "first_frame" || media[1].(map[string]interface{})["type"] != "reference_audio" {
		t.Fatalf("media = %#v", media)
	}
	parameters := got["parameters"].(map[string]interface{})
	if parameters["resolution"] != "720P" || intValue(parameters["duration"]) != 10 {
		t.Fatalf("parameters = %#v", parameters)
	}
}

func TestBuildAliyunHappyHorseI2VUsesFirstFrame(t *testing.T) {
	got := BuildUpstreamVideoPayload("happyhorse", "happyhorse-1.1-i2v", map[string]interface{}{
		"upstream": map[string]interface{}{"adapter": "aliyun_video_generation"},
	}, nil, map[string]interface{}{
		"reference_images": []interface{}{"https://example.com/first.png"},
	})
	media := got["input"].(map[string]interface{})["media"].([]interface{})
	if len(media) != 1 || media[0].(map[string]interface{})["type"] != "first_frame" {
		t.Fatalf("media = %#v, want one first_frame", media)
	}
}

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

func TestBuildVeoReferencePayloadSupportsTextAndReferenceModes(t *testing.T) {
	runtimeRule := map[string]interface{}{
		"upstream": map[string]interface{}{
			"adapter": "veo_reference_v1",
			"include": []interface{}{"generation_mode", "size", "reference_images"},
		},
	}
	references := []interface{}{
		"https://example.com/1.jpg",
		"https://example.com/2.jpg",
		"https://example.com/3.jpg",
		"https://example.com/ignored.jpg",
	}

	referencePayload := BuildUpstreamVideoPayload(
		"veo-reference",
		"veo_3_1-fast",
		runtimeRule,
		nil,
		map[string]interface{}{
			"prompt":           "product video",
			"generation_mode":  "reference",
			"size":             "1280x720",
			"reference_images": references,
		},
	)
	referencePayload = SanitizeUpstreamPayload(referencePayload, "/v1/videos")
	images, ok := referencePayload["images"].([]string)
	if !ok || len(images) != 3 {
		t.Fatalf("reference images = %#v, want exactly 3", referencePayload["images"])
	}
	if _, exists := referencePayload["generation_mode"]; exists {
		t.Fatalf("generation_mode must not be sent upstream: %#v", referencePayload)
	}
	if referencePayload["size"] != "1280x720" {
		t.Fatalf("size = %#v", referencePayload["size"])
	}

	textPayload := BuildUpstreamVideoPayload(
		"veo-reference",
		"veo_3_1-fast",
		runtimeRule,
		nil,
		map[string]interface{}{
			"prompt":           "text only",
			"generation_mode":  "text",
			"size":             "720x1280",
			"reference_images": references,
		},
	)
	textPayload = SanitizeUpstreamPayload(textPayload, "/v1/videos")
	if _, exists := textPayload["images"]; exists {
		t.Fatalf("text mode must not send stale images: %#v", textPayload)
	}
}

func TestBuildOmniReferencePayloadUsesUpToSevenImages(t *testing.T) {
	runtimeRule := map[string]interface{}{
		"video": map[string]interface{}{"upload_profile": "omni_reference"},
		"upstream": map[string]interface{}{
			"adapter": "omni_reference_v1",
			"include": []interface{}{"generation_mode", "size", "reference_images"},
		},
	}
	references := []interface{}{
		"https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg",
		"https://example.com/4.jpg", "https://example.com/5.jpg", "https://example.com/6.jpg",
		"https://example.com/7.jpg", "https://example.com/ignored.jpg",
	}

	payload := BuildUpstreamVideoPayload(
		"omni-flash", "omni_flash-10s", runtimeRule, nil,
		map[string]interface{}{
			"prompt": "product video", "generation_mode": "reference", "duration": float64(10),
			"size": "1280x720", "reference_images": references,
		},
	)
	payload = SanitizeUpstreamPayload(payload, "/v1/videos")
	images, ok := payload["images"].([]interface{})
	if !ok {
		if stringImages, stringOK := payload["images"].([]string); stringOK {
			if len(stringImages) != 7 {
				t.Fatalf("images len = %d, want 7", len(stringImages))
			}
		} else {
			t.Fatalf("images = %#v, want an array", payload["images"])
		}
	} else if len(images) != 7 {
		t.Fatalf("images len = %d, want 7", len(images))
	}
	for _, key := range []string{"generation_mode", "duration", "reference_images", "_video_upload_profile"} {
		if _, exists := payload[key]; exists {
			t.Fatalf("%s must not be sent upstream: %#v", key, payload)
		}
	}
}

func TestFramePairProfileAlwaysForwardsReferenceImagesForAliasedVeoModel(t *testing.T) {
	payload := BuildUpstreamVideoPayload(
		"partner-video", "partner-fast-fl",
		map[string]interface{}{
			"video":    map[string]interface{}{"upload_profile": "frame_pair"},
			"upstream": map[string]interface{}{"include": []interface{}{"size"}},
		},
		nil,
		map[string]interface{}{
			"prompt": "keep the subject consistent", "size": "1280x720",
			"first_frame":      "https://example.com/first.jpg",
			"last_frame":       "https://example.com/last.jpg",
			"reference_images": []interface{}{"https://example.com/reference.jpg"},
		},
	)
	payload = SanitizeUpstreamPayload(payload, "/v1/videos")
	images := mediaURLList(payload["images"])
	want := []string{"https://example.com/first.jpg", "https://example.com/last.jpg", "https://example.com/reference.jpg"}
	if len(images) != len(want) {
		t.Fatalf("images = %#v, want %#v", images, want)
	}
	for index := range want {
		if images[index] != want[index] {
			t.Fatalf("images[%d] = %q, want %q", index, images[index], want[index])
		}
	}
}

func TestVeoFramePairPayloadOnlySendsOrderedFrames(t *testing.T) {
	payload := BuildUpstreamVideoPayload(
		"veo-frame-pair", "veo_3_1-fl",
		map[string]interface{}{
			"video": map[string]interface{}{"upload_profile": "veo_frame_pair"},
			"upstream": map[string]interface{}{
				"adapter": "veo_frame_pair_v1",
				"include": []interface{}{"size", "first_frame", "last_frame"},
			},
		},
		nil,
		map[string]interface{}{
			"prompt": "transition from day to night", "size": "1280x720",
			"first_frame": "https://example.com/first.jpg",
			"last_frame":  "https://example.com/last.jpg",
			"reference_images": []interface{}{
				"https://example.com/must-not-be-sent.jpg",
			},
		},
	)
	payload = SanitizeUpstreamPayload(payload, "/v1/videos")
	images := mediaURLList(payload["images"])
	want := []string{"https://example.com/first.jpg", "https://example.com/last.jpg"}
	if len(images) != len(want) {
		t.Fatalf("images = %#v, want %#v", images, want)
	}
	for index := range want {
		if images[index] != want[index] {
			t.Fatalf("images[%d] = %q, want %q", index, images[index], want[index])
		}
	}
	for _, key := range []string{"first_frame", "last_frame", "reference_images", "duration", "generation_mode"} {
		if _, exists := payload[key]; exists {
			t.Fatalf("%s must not be sent upstream: %#v", key, payload)
		}
	}
	if payload["model"] != "veo_3_1-fl" {
		t.Fatalf("model = %#v, want veo_3_1-fl", payload["model"])
	}
}

func TestSizeBasedVideoAdaptersCanonicalizeDirectionWithoutConflicts(t *testing.T) {
	tests := []struct {
		name    string
		profile string
		adapter string
		params  map[string]interface{}
		want    string
	}{
		{name: "veo frame pair portrait", profile: "veo_frame_pair", adapter: "veo_frame_pair_v1", params: map[string]interface{}{"orientation": "portrait"}, want: "720x1280"},
		{name: "veo reference landscape", profile: "veo_reference", adapter: "veo_reference_v1", params: map[string]interface{}{"aspect_ratio": "16:9"}, want: "1280x720"},
		{name: "omni portrait", profile: "omni_reference", adapter: "omni_reference_v1", params: map[string]interface{}{"ratio": "9:16"}, want: "720x1280"},
		{name: "explicit size wins over stale alias", profile: "veo_reference", adapter: "veo_reference_v1", params: map[string]interface{}{"size": "1080x1920", "aspect_ratio": "16:9"}, want: "1080x1920"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			params := map[string]interface{}{"prompt": "test", "generation_mode": "text"}
			for key, value := range tt.params {
				params[key] = value
			}
			payload := BuildUpstreamVideoPayload("video-test", "video-test", map[string]interface{}{
				"video":    map[string]interface{}{"upload_profile": tt.profile},
				"upstream": map[string]interface{}{"adapter": tt.adapter},
			}, nil, params)
			payload = SanitizeUpstreamPayload(payload, "/v1/videos")
			if payload["size"] != tt.want {
				t.Fatalf("size = %#v, want %q; payload=%#v", payload["size"], tt.want, payload)
			}
			for _, key := range []string{"aspect_ratio", "orientation", "ratio"} {
				if _, exists := payload[key]; exists {
					t.Fatalf("conflicting %s must be removed: %#v", key, payload)
				}
			}
		})
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
				"static": map[string]interface{}{
					"stream":          false,
					"output_format":   "hex",
					"subtitle_enable": false,
					"voice_setting":   map[string]interface{}{"vol": float64(1), "pitch": float64(0)},
					"audio_setting":   map[string]interface{}{"sample_rate": float64(32000), "bitrate": float64(128000), "channel": float64(1)},
				},
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
	if voice["vol"] != float64(1) || voice["pitch"] != float64(0) {
		t.Fatalf("missing MiniMax official voice defaults: %#v", voice)
	}
	audio, ok := got["audio_setting"].(map[string]interface{})
	if !ok || audio["format"] != "mp3" {
		t.Fatalf("unexpected audio_setting: %#v", got)
	}
	if audio["sample_rate"] != float64(32000) || audio["bitrate"] != float64(128000) || audio["channel"] != float64(1) {
		t.Fatalf("missing MiniMax official audio defaults: %#v", audio)
	}
	if got["output_format"] != "hex" || got["subtitle_enable"] != false {
		t.Fatalf("missing MiniMax official response defaults: %#v", got)
	}
	if _, ok := got["response_format"]; ok {
		t.Fatalf("response_format should not be sent: %#v", got)
	}
}

func TestBuildUpstreamPayloadSupportsMinimaxMusicTemplate(t *testing.T) {
	got := BuildUpstreamVideoPayload(
		"audio_minimax_music_26",
		"music-3.0",
		map[string]interface{}{
			"upstream": map[string]interface{}{
				"include": []interface{}{"model_version", "music_prompt", "output_format", "format", "sample_rate", "bitrate", "is_instrumental", "lyrics_optimizer", "aigc_watermark"},
				"map": map[string]interface{}{
					"prompt":           "lyrics",
					"music_prompt":     "prompt",
					"model_version":    "model",
					"format":           "audio_setting.format",
					"sample_rate":      "audio_setting.sample_rate",
					"bitrate":          "audio_setting.bitrate",
					"is_instrumental":  "is_instrumental",
					"lyrics_optimizer": "lyrics_optimizer",
					"aigc_watermark":   "aigc_watermark",
				},
				"static": map[string]interface{}{"stream": false},
			},
		},
		nil,
		map[string]interface{}{
			"prompt":           "[Verse] hello",
			"music_prompt":     "upbeat pop",
			"model_version":    "music-3.0",
			"output_format":    "hex",
			"format":           "mp3",
			"sample_rate":      44100,
			"bitrate":          256000,
			"is_instrumental":  false,
			"lyrics_optimizer": true,
			"aigc_watermark":   false,
		},
	)
	if got["model"] != "music-3.0" || got["lyrics"] != "[Verse] hello" || got["prompt"] != "upbeat pop" {
		t.Fatalf("unexpected MiniMax music payload: %#v", got)
	}
	if got["output_format"] != "hex" || got["stream"] != false {
		t.Fatalf("missing MiniMax music output settings: %#v", got)
	}
	audio, ok := got["audio_setting"].(map[string]interface{})
	if !ok || audio["format"] != "mp3" || audio["sample_rate"] != float64(44100) || audio["bitrate"] != float64(256000) {
		t.Fatalf("unexpected MiniMax music audio_setting: %#v", got)
	}
	if got["is_instrumental"] != false || got["lyrics_optimizer"] != true || got["aigc_watermark"] != false {
		t.Fatalf("MiniMax music flags must be top-level: %#v", got)
	}
	for _, key := range []string{"is_instrumental", "lyrics_optimizer", "aigc_watermark"} {
		if _, nested := audio[key]; nested {
			t.Fatalf("%s must not be nested under audio_setting: %#v", key, got)
		}
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

func TestBuildUpstreamPayloadSupportsVolcengineSeedance2(t *testing.T) {
	got := BuildUpstreamVideoPayload(
		"doubao-seedance-2",
		"doubao-seedance-2-0-260128",
		map[string]interface{}{
			"upstream": map[string]interface{}{
				"adapter": "volcengine_seedance_2",
				"include": []interface{}{"generation_mode", "duration", "ratio", "generate_audio", "portrait_asset_id", "portrait_asset_type", "reference_images", "reference_videos", "reference_audios"},
			},
		},
		nil,
		map[string]interface{}{
			"prompt":              "使用图片1的主体和视频1的运镜",
			"generation_mode":     "image_video_audio",
			"duration":            "8s",
			"ratio":               "16:9",
			"generate_audio":      true,
			"portrait_asset_id":   "asset://authorized-person",
			"portrait_asset_type": "image",
			"reference_images":    []interface{}{"https://example.com/a.jpg"},
			"reference_videos":    []interface{}{"https://example.com/a.mp4"},
			"reference_audios":    []interface{}{"https://example.com/a.mp3"},
		},
	)
	if got["model"] != "doubao-seedance-2-0-260128" || got["duration"] != float64(8) || got["ratio"] != "16:9" {
		t.Fatalf("unexpected Seedance payload: %#v", got)
	}
	content, ok := got["content"].([]interface{})
	if !ok || len(content) != 5 {
		t.Fatalf("content = %#v, want text + portrait + image + video + audio", got["content"])
	}
	portrait, _ := content[1].(map[string]interface{})
	image, _ := content[2].(map[string]interface{})
	video, _ := content[3].(map[string]interface{})
	audio, _ := content[4].(map[string]interface{})
	portraitURL, _ := portrait["image_url"].(map[string]interface{})
	if portraitURL["url"] != "asset://authorized-person" {
		t.Fatalf("unexpected portrait asset: %#v", portrait)
	}
	if image["role"] != "reference_image" || video["role"] != "reference_video" || audio["role"] != "reference_audio" {
		t.Fatalf("unexpected Seedance roles: %#v", content)
	}
	if _, ok := got["generation_mode"]; ok {
		t.Fatalf("generation_mode must not be sent upstream: %#v", got)
	}
}

func TestBuildSeedancePayloadDropsRelativeAndDuplicateMediaReferences(t *testing.T) {
	got := BuildUpstreamVideoPayload(
		"doubao-seedance-2",
		"doubao-seedance-2-0-260128",
		map[string]interface{}{
			"upstream": map[string]interface{}{
				"adapter": "volcengine_seedance_2",
				"include": []interface{}{"generation_mode", "reference_images"},
			},
		},
		nil,
		map[string]interface{}{
			"prompt":          "test",
			"generation_mode": "image",
			"reference_images": []interface{}{
				"https://cdn.example/keyframe.png",
				"/assets/comic-styles/cn-ancient.svg",
				"https://cdn.example/keyframe.png",
			},
		},
	)
	content, ok := got["content"].([]interface{})
	if !ok || len(content) != 2 {
		t.Fatalf("content=%#v, want text plus one valid image", got["content"])
	}
	image, _ := content[1].(map[string]interface{})
	imageURL, _ := image["image_url"].(map[string]interface{})
	if imageURL["url"] != "https://cdn.example/keyframe.png" {
		t.Fatalf("unexpected Seedance image reference: %#v", image)
	}
}

func TestBuildUpstreamPayloadSupportsMiniMaxH3ReferenceMode(t *testing.T) {
	got := BuildUpstreamVideoPayload(
		"minimax-h3",
		"MiniMax-H3",
		map[string]interface{}{
			"upstream": map[string]interface{}{
				"adapter": "minimax_h3_v2",
				"include": []interface{}{"generation_mode", "duration", "resolution", "ratio", "aigc_watermark", "reference_images", "reference_videos", "reference_audios"},
			},
		},
		nil,
		map[string]interface{}{
			"prompt":           "保持人物一致并参考视频运镜",
			"generation_mode":  "reference",
			"duration":         "8s",
			"resolution":       "2K",
			"ratio":            "adaptive",
			"aigc_watermark":   false,
			"reference_images": []interface{}{"https://example.com/ref.png"},
			"reference_videos": []interface{}{"https://example.com/ref.mp4"},
			"reference_audios": []interface{}{"https://example.com/ref.mp3"},
		},
	)
	if got["model"] != "MiniMax-H3" || got["duration"] != float64(8) || got["resolution"] != "2K" {
		t.Fatalf("unexpected MiniMax-H3 payload: %#v", got)
	}
	content, ok := got["content"].([]interface{})
	if !ok || len(content) != 4 {
		t.Fatalf("content = %#v, want text + image + video + audio", got["content"])
	}
	for index, role := range []string{"reference_image", "reference_video", "reference_audio"} {
		item, _ := content[index+1].(map[string]interface{})
		if item["role"] != role {
			t.Fatalf("content[%d] role = %#v, want %s", index+1, item["role"], role)
		}
	}
	for _, key := range []string{"prompt", "generation_mode", "reference_images", "reference_videos", "reference_audios"} {
		if _, exists := got[key]; exists {
			t.Fatalf("%s must not be sent upstream: %#v", key, got)
		}
	}
}

func TestBuildUpstreamPayloadSupportsMiniMaxH3FirstLastFrames(t *testing.T) {
	got := BuildUpstreamVideoPayload(
		"minimax-h3",
		"MiniMax-H3",
		map[string]interface{}{"upstream": map[string]interface{}{
			"adapter": "minimax_h3_v2",
			"include": []interface{}{"generation_mode", "duration", "resolution", "ratio", "first_frame", "last_frame"},
		}},
		nil,
		map[string]interface{}{
			"prompt":          "从白天过渡到夜晚",
			"generation_mode": "first_last",
			"duration":        float64(5),
			"resolution":      "2K",
			"ratio":           "16:9",
			"first_frame":     "https://example.com/first.png",
			"last_frame":      "https://example.com/last.png",
		},
	)
	if got["ratio"] != "adaptive" {
		t.Fatalf("ratio = %#v, want adaptive for frame mode", got["ratio"])
	}
	content, ok := got["content"].([]interface{})
	if !ok || len(content) != 3 {
		t.Fatalf("content = %#v, want text + first + last", got["content"])
	}
	first, _ := content[1].(map[string]interface{})
	last, _ := content[2].(map[string]interface{})
	if first["role"] != "first_frame" || last["role"] != "last_frame" {
		t.Fatalf("unexpected frame roles: %#v", content)
	}
}

func TestMiniMaxH3DurationSurvivesWorkerJSONRoundTrip(t *testing.T) {
	payload := BuildUpstreamVideoPayload(
		"minimax-h3",
		"MiniMax-H3",
		map[string]interface{}{"upstream": map[string]interface{}{
			"adapter": "minimax_h3_v2",
			"include": []interface{}{"generation_mode", "duration", "resolution", "ratio"},
		}},
		nil,
		map[string]interface{}{
			"prompt":          "a cinematic ocean sunrise",
			"generation_mode": "text",
			"duration":        float64(8),
			"resolution":      "2K",
			"ratio":           "16:9",
		},
	)
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var finalPayload map[string]interface{}
	if err := json.Unmarshal(body, &finalPayload); err != nil {
		t.Fatal(err)
	}
	finalPayload = SanitizeUpstreamPayload(finalPayload, "/v2/video_generation")
	// The sanitizer is intentionally idempotent for native-duration endpoints,
	// so a future refactor cannot silently remove duration on a second pass.
	finalPayload = SanitizeUpstreamPayload(finalPayload, "/v2/video_generation")
	if got := finalPayload["duration"]; got != float64(8) {
		t.Fatalf("duration = %#v, want 8 after worker JSON round trip; payload=%#v", got, finalPayload)
	}
	if _, exists := finalPayload["_preserve_video_params"]; exists {
		t.Fatalf("internal preservation marker leaked upstream: %#v", finalPayload)
	}
}

func TestBuildAliyunHappyHorseVideoEditPayload(t *testing.T) {
	got := BuildUpstreamVideoPayload(
		"happyhorse-edit", "happyhorse-1.0-video-edit",
		map[string]interface{}{"upstream": map[string]interface{}{"adapter": "aliyun_video_generation"}}, nil,
		map[string]interface{}{
			"prompt": "replace the coat", "reference_videos": []interface{}{"https://cdn.example/input.mp4"},
			"reference_images": []interface{}{"https://cdn.example/coat.png"}, "resolution": "720P", "audio_setting": "origin",
		},
	)
	input := got["input"].(map[string]interface{})
	media := input["media"].([]interface{})
	if len(media) != 2 || media[0].(map[string]interface{})["type"] != "reference_image" || media[1].(map[string]interface{})["type"] != "video" {
		t.Fatalf("unexpected edit media: %#v", media)
	}
	parameters := got["parameters"].(map[string]interface{})
	if parameters["audio_setting"] != "origin" {
		t.Fatalf("audio_setting missing: %#v", parameters)
	}
}
