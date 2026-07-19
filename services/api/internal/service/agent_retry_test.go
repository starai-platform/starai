package service

import "testing"

func TestPruneWorkflowOutputsForRetry(t *testing.T) {
	tests := []struct {
		node        string
		removed     []string
		preserved   []string
		currentStep string
	}{
		{node: "keyframes", removed: []string{"keyframes", "segments", "final_video_url", "media_tasks"}, preserved: []string{"comic_drama"}, currentStep: "keyframes"},
		{node: "video_segments", removed: []string{"segments", "final_video_url", "media_tasks"}, preserved: []string{"keyframes"}, currentStep: "video_segments"},
		{node: "compose", removed: []string{"final_video_url", "thumbnail", "media_tasks"}, preserved: []string{"segments"}, currentStep: "compose"},
	}
	for _, tt := range tests {
		t.Run(tt.node, func(t *testing.T) {
			outputs := map[string]interface{}{
				"comic_drama": map[string]interface{}{}, "keyframes": []interface{}{1}, "segments": []interface{}{1},
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
		})
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
