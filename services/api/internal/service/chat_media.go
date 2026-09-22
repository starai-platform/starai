package service

import (
	"encoding/json"
	"strings"

	"github.com/starai/api/internal/runtime"
)

// An explicit canonical switch wins over legacy aliases, including false.
func mediaCapability(rule map[string]interface{}, keys ...string) (bool, bool) {
	caps, _ := rule["capabilities"].(map[string]interface{})
	for _, key := range keys {
		if value, ok := caps[key].(bool); ok {
			return value, true
		}
	}
	return false, false
}

func chatRouteMediaError(model *ModelFull, route *ModelRoute, messages interface{}) error {
	data, err := json.Marshal(messages)
	if err != nil {
		return err
	}
	var items []struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(data, &items); err != nil {
		return err
	}
	for _, item := range items {
		var parts []struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(item.Content, &parts) != nil {
			continue
		}
		for _, part := range parts {
			var keys []string
			label := "图片"
			switch part.Type {
			case "image_url":
				keys = []string{"vision", "image_input", "multimodal"}
			case "video_url":
				keys = []string{"video_analysis", "video_input", "video_understanding"}
				label = "视频"
			case "audio_url", "input_audio":
				keys = []string{"audio_analysis", "audio_input", "audio_understanding"}
				label = "音频"
			default:
				continue
			}
			allowed, _ := mediaCapability(model.RuntimeRule, keys...)
			if override, exists := mediaCapability(route.RuntimeRule, keys...); exists {
				allowed = override
			}
			protocol := strings.ToLower(strings.TrimSpace(route.Protocol))
			videoUnsupported := protocol == "claude" || protocol == "anthropic" || protocol == "anthropic_messages" || protocol == "claude_messages" || strings.Contains(route.Endpoint, "/responses")
			if !allowed || ((part.Type == "video_url" || part.Type == "audio_url" || part.Type == "input_audio") && videoUnsupported) {
				return &runtime.PlatformError{Code: "MEDIA_INPUT_UNSUPPORTED", StatusCode: 400, Message: "模型线路未启用或协议不支持" + label + "理解，请检查模型及线路的媒体能力配置"}
			}
		}
	}
	return nil
}
