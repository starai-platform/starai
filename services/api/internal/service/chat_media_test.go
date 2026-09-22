package service

import (
	"github.com/starai/api/internal/runtime"
	"testing"
)

func TestChatMediaRouteCapabilities(t *testing.T) {
	rule := func(caps map[string]interface{}) map[string]interface{} {
		return map[string]interface{}{"capabilities": caps}
	}
	model := &ModelFull{RuntimeRule: rule(map[string]interface{}{"vision": true, "video_analysis": true})}
	messages := []runtime.ChatMessage{{Role: "user", Content: "分析附件"}}
	for _, field := range []string{"reference_images", "reference_videos"} {
		req := chatRequestMessages(messages, map[string]interface{}{field: []string{"https://example.com/media"}})
		if err := chatRouteMediaError(model, &ModelRoute{Protocol: "gemini"}, req); err != nil {
			t.Fatal(err)
		}
		if err := chatRouteMediaError(model, &ModelRoute{RuntimeRule: rule(map[string]interface{}{"vision": false, "image_input": true, "video_analysis": false})}, req); err == nil {
			t.Fatal("disabled route accepted media")
		}
		if err := chatRouteMediaError(&ModelFull{}, &ModelRoute{}, req); err == nil {
			t.Fatal("unknown capabilities accepted media")
		}
	}
	video := chatRequestMessages(messages, map[string]interface{}{"reference_videos": []string{"https://example.com/a.mp4"}})
	if chatRouteMediaError(model, &ModelRoute{Protocol: "claude"}, video) == nil {
		t.Fatal("unsupported protocol accepted video")
	}
	if err := chatRouteMediaError(&ModelFull{}, &ModelRoute{}, messages); err != nil {
		t.Fatal("text-only request rejected", err)
	}
	image := chatRequestMessages(messages, map[string]interface{}{"reference_images": []string{"https://example.com/a.png"}})
	if err := chatRouteMediaError(&ModelFull{}, &ModelRoute{RuntimeRule: rule(map[string]interface{}{"image_input": true})}, image); err != nil {
		t.Fatal("route override ignored", err)
	}
}
