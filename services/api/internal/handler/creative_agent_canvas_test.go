package handler

import (
	"encoding/json"
	"github.com/starai/api/internal/service"
	"strings"
	"testing"
)

func TestCreativeCanvasRouting(t *testing.T) {
	for _, tc := range []struct {
		kind, workflow, prompt string
		images                 []string
		want                   string
	}{
		{"text", "", "写一篇产品发布文案", nil, "agent-text"},
		{"image", "", "生成图片", nil, "text-image"},
		{"image", "", "根据商品参考图生成", []string{"https://example.com/product.png"}, "image-image"},
		{"image", "", "把这张图的背景替换成海边，保留人物", []string{"https://example.com/photo.png"}, "image-edit"},
		{"image", "", "编辑参考图的局部文字", []string{"https://example.com/photo.png"}, "image-edit"},
		{"image", "", "画一个图片编辑软件的海报", nil, "text-image"},
		{"image", "", "画一个写着爆款复刻的海报", nil, "text-image"},
		{"video", "", "视频", nil, "text-video"},
		{"video", "", "参考图视频", []string{"image"}, "image-video"},
		{"workflow", "video_creation", "故事", nil, "story-short-video"},
		{"video", "video_creation", "故事视频", nil, "story-short-video"},
		{"workflow", "ai_comic_drama", "旧方案", nil, "story-short-video"},
		{"workflow", "one_click_viral_remake", "商品", nil, "one-click-viral-remake"},
		{"workflow", "content_image_post", "内容图文", nil, "content-image-post"},
		{"speech", "", "朗读正文", nil, "agent-audio"},
		{"music", "", "音乐", nil, "agent-audio"},
	} {
		if got := creativeCanvasTemplate(tc.kind, tc.workflow, tc.prompt, map[string]interface{}{"reference_images": tc.images}); got != tc.want {
			t.Errorf("%s/%s: got %s want %s", tc.kind, tc.workflow, got, tc.want)
		}
	}
}

func TestCreativeWritingStaysInChatAndRetainsCopy(t *testing.T) {
	text := "把文章改成一份简短的发布文案"
	plan := guardCreativeAgentIntent(map[string]interface{}{"intent": "text", "prompt": text, "reply": "修改后的发布文案正文"}, text)
	draft := &service.AgentDraft{Version: 1, Slots: map[string]interface{}{"script": "原文内容"}}
	if err := mergeCreativeAgentDraft(draft, plan, text); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(draft)
	var restored service.AgentDraft
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if plan["intent"] != "chat" || plan["needs_confirm"] != false || !strings.Contains(stringAny(restored.Slots["script"]), "修改后的发布文案正文") {
		t.Fatalf("lost writing request: %#v", restored.Slots)
	}
	chat := &service.ModelFull{ModelDTO: service.ModelDTO{Category: "chat"}, RequestMode: "chat_completions"}
	image := &service.ModelFull{ModelDTO: service.ModelDTO{Category: "image"}, RequestMode: "images"}
	if !creativeAgentModelSupportsType(chat, "text") || creativeAgentModelSupportsType(image, "text") {
		t.Fatal("text workflow selected a media model")
	}
}
