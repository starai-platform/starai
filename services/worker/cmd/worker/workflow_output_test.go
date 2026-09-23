package main

import "testing"

func TestValidateAgentExpectedWorkflowOutput(t *testing.T) {
	tests := []struct {
		name     string
		expected string
		outputs  map[string]interface{}
		valid    bool
	}{
		{"image", "image", map[string]interface{}{"media_tasks": []interface{}{map[string]interface{}{"status": "succeeded", "type": "image", "output": map[string]interface{}{"image_url": "https://cdn.example/result"}}}}, true},
		{"video", "video", map[string]interface{}{"final_video_url": "https://cdn.example/result"}, true},
		{"audio alias", "music", map[string]interface{}{"result": map[string]interface{}{"audio_url": "https://cdn.example/result"}}, true},
		{"extension fallback", "image", map[string]interface{}{"result_url": "https://cdn.example/result.webp?token=x"}, true},
		{"failed media", "image", map[string]interface{}{"media_tasks": []interface{}{map[string]interface{}{"status": "failed", "output": map[string]interface{}{"image_url": "https://cdn.example/stale.png"}}}}, false},
		{"wrong media", "video", map[string]interface{}{"image_url": "https://cdn.example/result.png"}, false},
		{"source only", "video", map[string]interface{}{"source_video_url": "https://cdn.example/source.mp4"}, false},
		{"missing", "image", map[string]interface{}{"text": "done"}, false},
		{"unscoped", "workflow", map[string]interface{}{"text": "done"}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateAgentExpectedWorkflowOutput(map[string]interface{}{"_agent_expected_output": tc.expected}, tc.outputs)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
}
