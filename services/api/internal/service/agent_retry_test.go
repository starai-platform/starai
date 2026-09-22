package service

import "testing"

func TestNormalizeComicAudioStrategy(t *testing.T) {
	if got := normalizeComicAudioStrategy("", "tts_model"); got != "hybrid" {
		t.Fatalf("strategy=%q, want hybrid", got)
	}
	if got := normalizeComicAudioStrategy("", ""); got != "video_native" {
		t.Fatalf("strategy=%q, want video_native", got)
	}
	if got := normalizeComicAudioStrategy("tts_only", "tts_model"); got != "tts_only" {
		t.Fatalf("strategy=%q, want tts_only", got)
	}
}

func TestPruneWorkflowOutputsForRetry(t *testing.T) {
	tests := []struct {
		node        string
		removed     []string
		preserved   []string
		currentStep string
	}{
		{node: "comic_plan", removed: []string{"comic_drama", "keyframes", "segments", "final_video_url", "media_tasks"}, currentStep: "comic_plan"},
		{node: "keyframes", removed: []string{"final_video_url", "media_tasks"}, preserved: []string{"comic_drama", "keyframes", "segments", "narrations"}, currentStep: "keyframes"},
		{node: "video_segments", removed: []string{"final_video_url", "media_tasks"}, preserved: []string{"keyframes", "segments"}, currentStep: "video_segments"},
		{node: "narrations", removed: []string{"final_video_url", "thumbnail", "media_tasks"}, preserved: []string{"segments", "narrations"}, currentStep: "narrations"},
		{node: "compose", removed: []string{"final_video_url", "thumbnail", "media_tasks"}, preserved: []string{"segments", "narrations"}, currentStep: "compose"},
	}
	for _, tt := range tests {
		t.Run(tt.node, func(t *testing.T) {
			outputs := map[string]interface{}{
				"comic_drama": map[string]interface{}{},
				"keyframes": []interface{}{
					map[string]interface{}{"id": "S01", "image_url": "keyframe.jpg"},
					map[string]interface{}{"id": "S02", "status": "failed", "error_message": "failed"},
				},
				"segments": []interface{}{
					map[string]interface{}{"id": "S01", "video_url": "segment.mp4"},
					map[string]interface{}{"id": "S02", "status": "failed", "error_message": "failed"},
				},
				"narrations": []interface{}{
					map[string]interface{}{"id": "S01", "audio_url": "voice.mp3", "status": "succeeded"},
					map[string]interface{}{"id": "S02", "audio_url": "", "status": "skipped"},
					map[string]interface{}{"id": "S03", "status": "failed", "error_message": "failed"},
				},
				"final_video_url": "video", "thumbnail": "thumb", "media_tasks": []interface{}{1}, "current_step": "result",
			}
			pruneWorkflowOutputsForRetry(outputs, tt.node)
			for _, key := range tt.removed {
				if _, ok := outputs[key]; ok {
					t.Fatalf("expected %s to be removed", key)
				}
			}
			for _, key := range tt.preserved {
				if _, ok := outputs[key]; !ok {
					t.Fatalf("expected %s to be preserved", key)
				}
			}
			if outputs["current_step"] != tt.currentStep {
				t.Fatalf("current_step=%v, want %s", outputs["current_step"], tt.currentStep)
			}
			if tt.node == "keyframes" {
				items, _ := outputs["keyframes"].([]interface{})
				if len(items) != 1 {
					t.Fatalf("successful keyframes=%d, want 1", len(items))
				}
			}
			if tt.node == "video_segments" {
				items, _ := outputs["segments"].([]interface{})
				if len(items) != 1 {
					t.Fatalf("successful segments=%d, want 1", len(items))
				}
			}
			if tt.node == "narrations" {
				items, _ := outputs["narrations"].([]interface{})
				if len(items) != 2 {
					t.Fatalf("successful or skipped narrations=%d, want 2", len(items))
				}
			}
		})
	}
}

func TestRefreshComicRetryModels(t *testing.T) {
	runtimeCfg := map[string]interface{}{
		"agent_mode":           "comic_drama",
		"image_model_code":     "image-new",
		"video_model_code":     "video-new",
		"narration_model_code": "audio-new",
	}

	t.Run("current agent models apply without a failed node and to downstream stages", func(t *testing.T) {
		for _, step := range []string{"", "comic_plan", "keyframes", "video_segments", "narrations", "compose"} {
			inputs := map[string]interface{}{"dialogue_model_codes": []string{"chat-old"}, "image_model_code": "image-old", "video_model_code": "video-old", "narration_model_code": "audio-old"}
			outputs := map[string]interface{}{"current_step": step, "segments": []interface{}{map[string]interface{}{"id": "S01", "video_url": "keep.mp4"}}}
			overrides := map[string]string{"dialogue_model_code": "chat-current", "image_model_code": "image-current", "video_model_code": "video-current", "narration_model_code": "audio-current"}
			refreshComicRetryModels(inputs, outputs, runtimeCfg, overrides)
			for _, key := range []string{"image_model_code", "video_model_code", "narration_model_code"} {
				if inputs[key] != overrides[key] {
					t.Fatalf("step %q: %s=%v, want %s", step, key, inputs[key], overrides[key])
				}
			}
			if codes := agentStringSlice(inputs["dialogue_model_codes"], nil); len(codes) != 1 || codes[0] != "chat-current" {
				t.Fatalf("step %q: old dialogue model retained: %v", step, codes)
			}
			if got := successfulComicStageItems(outputs["segments"], "video_url"); len(got) != 1 || got[0].(map[string]interface{})["video_url"] != "keep.mp4" {
				t.Fatalf("step %q: completed material changed: %v", step, got)
			}
		}
	})

	t.Run("comic plan uses explicit current chat model", func(t *testing.T) {
		inputs := map[string]interface{}{"dialogue_model_codes": []interface{}{"chat-old"}}
		outputs := map[string]interface{}{"current_step": "comic_plan"}
		refreshComicRetryModels(inputs, outputs, runtimeCfg, map[string]string{"dialogue_model_code": "chat-new"})
		codes := agentStringSlice(inputs["dialogue_model_codes"], nil)
		if len(codes) != 1 || codes[0] != "chat-new" {
			t.Fatalf("dialogue models=%v, want [chat-new]", codes)
		}
	})

	t.Run("empty failed video stage uses current model", func(t *testing.T) {
		inputs := map[string]interface{}{"video_model_code": "video-old"}
		outputs := map[string]interface{}{
			"current_step": "video_segments",
			"segments":     []interface{}{map[string]interface{}{"id": "S01", "status": "failed"}},
		}
		refreshComicRetryModels(inputs, outputs, runtimeCfg, map[string]string{"video_model_code": "video-selected"})
		if inputs["video_model_code"] != "video-selected" {
			t.Fatalf("video model=%v, want video-selected", inputs["video_model_code"])
		}
	})

	t.Run("partial video stage keeps snapshot on automatic retry", func(t *testing.T) {
		inputs := map[string]interface{}{"video_model_code": "video-old"}
		outputs := map[string]interface{}{
			"current_step": "video_segments",
			"segments": []interface{}{
				map[string]interface{}{"id": "S01", "video_url": "segment.mp4", "status": "succeeded"},
				map[string]interface{}{"id": "S02", "status": "failed"},
			},
		}
		refreshComicRetryModels(inputs, outputs, runtimeCfg, nil)
		if inputs["video_model_code"] != "video-old" {
			t.Fatalf("video model=%v, want video-old", inputs["video_model_code"])
		}
	})

	t.Run("explicit model switch applies only to unfinished video items", func(t *testing.T) {
		inputs := map[string]interface{}{"video_model_code": "video-old"}
		outputs := map[string]interface{}{
			"current_step": "video_segments",
			"segments": []interface{}{
				map[string]interface{}{"id": "S01", "video_url": "segment.mp4", "status": "succeeded"},
				map[string]interface{}{"id": "S02", "status": "failed"},
			},
		}
		refreshComicRetryModels(inputs, outputs, runtimeCfg, map[string]string{"video_model_code": "video-selected"})
		if inputs["video_model_code"] != "video-selected" {
			t.Fatalf("video model=%v, want video-selected", inputs["video_model_code"])
		}
		if got := successfulComicStageItems(outputs["segments"], "video_url"); len(got) != 1 {
			t.Fatalf("successful segments=%d, want 1", len(got))
		}
	})

	t.Run("empty stage falls back to current workflow model", func(t *testing.T) {
		inputs := map[string]interface{}{"video_model_code": "video-old"}
		outputs := map[string]interface{}{"current_step": "video_segments"}
		refreshComicRetryModels(inputs, outputs, runtimeCfg, nil)
		if inputs["video_model_code"] != "video-new" {
			t.Fatalf("video model=%v, want video-new", inputs["video_model_code"])
		}
	})
}

func TestComicAutoProjectNameUsesRuneSafeEllipsis(t *testing.T) {
	got := comicAutoProjectName("  一个   自动创建的漫剧项目名称，内容很长很长很长很长很长很长很长很长很长  ")
	runes := []rune(got)
	if len(runes) != 33 || runes[len(runes)-1] != '…' {
		t.Fatalf("unexpected auto project name %q (%d runes)", got, len(runes))
	}
}

func TestNormalizeComicAssetCodeUsesStableASCIIFallback(t *testing.T) {
	code := normalizeComicAssetCode("", "character_cda_123456789")
	if code != "CHARACTER_CDA_123456789" {
		t.Fatalf("code=%q", code)
	}
	if got := normalizeComicAssetCode("主角-01", "fallback"); got != "-01" && got != "01" {
		// Chinese labels are not used as identifiers; the explicit numeric suffix remains stable.
		t.Fatalf("unexpected normalized code %q", got)
	}
}
