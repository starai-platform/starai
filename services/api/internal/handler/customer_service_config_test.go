package handler

import (
	"strings"
	"testing"

	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/service"
)

func TestValidateCustomerServiceConfig(t *testing.T) {
	tests := []struct {
		name string
		req  map[string]interface{}
		want string
	}{
		{name: "builtin", req: map[string]interface{}{"customer_service_mode": "builtin"}},
		{name: "custom script", req: map[string]interface{}{"customer_service_mode": "custom_script", "customer_service_custom_script": "<script>window.chat = true;</script>"}},
		{name: "invalid mode", req: map[string]interface{}{"customer_service_mode": "other"}, want: "首页客服方式参数错误"},
		{name: "missing script tag", req: map[string]interface{}{"customer_service_custom_script": "window.chat = true;"}, want: "第三方客服脚本必须包含完整的 <script> 标签"},
		{name: "too large", req: map[string]interface{}{"customer_service_custom_script": "<script>" + strings.Repeat("x", 100*1024) + "</script>"}, want: "第三方客服脚本不能超过 100KB"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validateCustomerServiceConfig(tt.req); got != tt.want {
				t.Fatalf("validateCustomerServiceConfig() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseCreativeAgentPlan(t *testing.T) {
	tests := []struct {
		name    string
		content string
		intent  string
		reply   string
	}{
		{
			name:    "fenced json",
			content: "```json\n{\"intent\":\"image\",\"prompt\":\"一只猫\"}\n```",
			intent:  "image",
		},
		{
			name:    "preamble and fenced json",
			content: "下面是执行计划：\n```JSON\n{\"intent\":\"chat\",\"reply\":\"## 科技资讯\\n- 结论 [1]\"}\n```\n",
			intent:  "chat",
			reply:   "## 科技资讯\n- 结论 [1]",
		},
		{
			name:    "quoted json",
			content: `"{\"intent\":\"chat\",\"reply\":\"含有 {花括号} 的回答\"}"`,
			intent:  "chat",
			reply:   "含有 {花括号} 的回答",
		},
		{
			name:    "json followed by explanation",
			content: "{\"intent\":\"chat\",\"reply\":\"已整理\"}\n以上为搜索结果。",
			intent:  "chat",
			reply:   "已整理",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plan := parseCreativeAgentPlan(tt.content)
			if plan == nil || plan["intent"] != tt.intent {
				t.Fatalf("unexpected plan: %#v", plan)
			}
			if tt.reply != "" && plan["reply"] != tt.reply {
				t.Fatalf("reply = %#v, want %#v", plan["reply"], tt.reply)
			}
		})
	}
	if parseCreativeAgentPlan("not json") != nil {
		t.Fatal("expected invalid planner output to return nil")
	}
	if parseCreativeAgentPlan("{\"sources\":[1,2]}") != nil {
		t.Fatal("expected unrelated JSON object to return nil")
	}
	for _, invalid := range []string{
		`{"intent":"generate_video","prompt":"cat"}`,
		`{"intent":"video","params":[]}`,
		`{"intent":"chat","reply":42}`,
		`{"intent":"image","needs_confirm":"yes"}`,
		`{"intent":"image","action":"execute"}`,
	} {
		if parseCreativeAgentPlan(invalid) != nil {
			t.Fatalf("expected invalid planner contract to be rejected: %s", invalid)
		}
	}
}

func TestCreativeAgentPlanFromStream(t *testing.T) {
	chat := creativeAgentPlanFromStream("CHAT\n## 今日资讯\n- 第一条 [1]")
	if chat["intent"] != "chat" || chat["reply"] != "## 今日资讯\n- 第一条 [1]" {
		t.Fatalf("unexpected streamed chat plan: %#v", chat)
	}
	image := creativeAgentPlanFromStream("PLAN\n{\"intent\":\"image\",\"reply\":\"正在生成\",\"prompt\":\"一只猫\",\"params\":{}}")
	if image["intent"] != "image" || image["prompt"] != "一只猫" {
		t.Fatalf("unexpected streamed generation plan: %#v", image)
	}
	bad := creativeAgentPlanFromStream("PLAN\n{\"intent\":\"video\",\"params\":[]}", "生成一个10秒视频")
	if bad["intent"] != "clarify" || bad["needs_confirm"] != false {
		t.Fatalf("invalid streamed plan must fail closed: %#v", bad)
	}
	contract := "# 租赁合同\n第三条 租赁期限为3年。\n第四条 押金按原约定支付。"
	edit := creativeAgentPlanFromStream(contract, "修改合同第三条为3年，其他不变，展示完整合同")
	if edit["intent"] != "chat" || edit["reply"] != contract {
		t.Fatal("plain document edit was mistaken for a media plan")
	}
	for _, raw := range []string{`{"intent":"chat","reply":"正文`, "PLAN\n" + contract} {
		if creativeAgentPlanFromStream(raw, "修改合同")["intent"] != "clarify" {
			t.Fatal("invalid protocol was exposed as document text")
		}
	}
	if creativeAgentPlanFromStream("已改成3秒", "时长改为3秒")["intent"] != "clarify" {
		t.Fatal("incremental media update bypassed plan validation")
	}
}

func TestCreativeAgentRolePromptKeepsPlannerBoundary(t *testing.T) {
	prompt := creativeAgentRolePrompt(&service.PromptRoleDTO{Name: "短剧导演", SystemPrompt: "擅长设计节奏紧凑的竖屏短剧"})
	for _, want := range []string{"短剧导演", "节奏紧凑", "不得改变", "严格按上述 JSON/流式协议"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("role prompt missing %q: %s", want, prompt)
		}
	}
}

func TestNormalizeCreativeAgentWorkflowPlan(t *testing.T) {
	plan := normalizeCreativeAgentWorkflowPlan(map[string]interface{}{
		"intent": "workflow", "workflow_code": "invented_workflow", "prompt": "角色冒险故事", "params": map[string]interface{}{},
	}, "根据参考图角色生成40-50秒视频，分段执行后合成成片")
	params, _ := plan["params"].(map[string]interface{})
	if plan["workflow_code"] != "video_creation" || params["storyboard_grid"] != 6 || params["duration_mode"] != "long" || params["target_duration_sec"] != 48 || params["_mode"] != "auto" {
		t.Fatalf("unexpected workflow plan: %#v", plan)
	}

	exact := normalizeCreativeAgentWorkflowPlan(map[string]interface{}{
		"intent": "workflow", "params": map[string]interface{}{"target_duration_sec": float64(22)},
	}, "生成短剧")
	exactParams := exact["params"].(map[string]interface{})
	if exactParams["storyboard_grid"] != 4 || exactParams["duration_mode"] != "standard" || exactParams["target_duration_sec"] != 22 {
		t.Fatalf("unexpected exact-duration layout: %#v", exactParams)
	}

	sixteen := normalizeCreativeAgentWorkflowPlan(map[string]interface{}{
		"intent": "workflow", "params": map[string]interface{}{},
	}, "生成16秒视频")
	sixteenParams := sixteen["params"].(map[string]interface{})
	if sixteenParams["storyboard_grid"] != 2 || sixteenParams["duration_mode"] != "long" || sixteenParams["target_duration_sec"] != 16 {
		t.Fatalf("unexpected 16-second layout: %#v", sixteenParams)
	}

	misclassified := normalizeCreativeAgentWorkflowPlan(map[string]interface{}{
		"intent": "video", "prompt": "角色短剧", "params": map[string]interface{}{"duration": float64(48)},
	}, "根据角色参考图生成48秒完整视频")
	if misclassified["intent"] != "workflow" || misclassified["workflow_code"] != "video_creation" {
		t.Fatalf("long-form video was not promoted to workflow: %#v", misclassified)
	}

	contentPost := normalizeCreativeAgentWorkflowPlan(map[string]interface{}{
		"intent": "image", "prompt": "秋季护肤主题", "params": map[string]interface{}{},
	}, "生成一套小红书图文笔记和配图")
	contentParams := contentPost["params"].(map[string]interface{})
	if contentPost["intent"] != "workflow" || contentPost["workflow_code"] != "content_image_post" || contentParams["image_count"] != 4 || contentParams["creative_scene"] != "content_image_post" {
		t.Fatalf("content image request was not promoted to workflow: %#v", contentPost)
	}

	for text, expected := range map[string]string{
		"生成一张图":      "image",
		"制作一个短视频":    "video",
		"写一篇微信公众号推文": "chat",
		"整理一份资料信息":   "chat",
	} {
		routed := normalizeCreativeAgentWorkflowPlan(map[string]interface{}{"intent": "chat", "reply": "已理解", "params": map[string]interface{}{}}, text)
		if routed["intent"] != expected {
			t.Fatalf("route %q=%v, want %s: %#v", text, routed["intent"], expected, routed)
		}
		if expected == "workflow" && (routed["workflow_code"] != "content_image_post" || strings.TrimSpace(stringAny(routed["prompt"])) == "") {
			t.Fatalf("content workflow is incomplete: %#v", routed)
		}
	}
	standaloneImage := normalizeCreativeAgentWorkflowPlan(map[string]interface{}{
		"intent": "image", "workflow_code": "content_image_post", "params": map[string]interface{}{},
	}, "生成一张图")
	if standaloneImage["intent"] != "image" || standaloneImage["workflow_code"] != "" {
		t.Fatalf("standalone image inherited stale content workflow: %#v", standaloneImage)
	}
}

func TestCreativeAgentRequestedImageCount(t *testing.T) {
	for text, want := range map[string]int{
		"生成6张配图":   6,
		"改成四张":     4,
		"需要3个卡片":   3,
		"把第4个要点改短": 0,
	} {
		if got := creativeAgentRequestedImageCount(text); got != want {
			t.Fatalf("creativeAgentRequestedImageCount(%q)=%d, want %d", text, got, want)
		}
	}
}

func TestNormalizeCreativeAgentMessages(t *testing.T) {
	messages := normalizeCreativeAgentMessages([]runtime.ChatMessage{
		{Role: "user", Content: "生成一张图片"},
		{Role: "assistant", Content: "已创建图片任务"},
		{Role: "assistant", Content: "生成完成"},
		{Role: "user", Content: "继续改成蓝色"},
	})
	if len(messages) != 3 || messages[1].Role != "assistant" || messages[1].Content != "已创建图片任务\n生成完成" || messages[2].Role != "user" {
		t.Fatalf("unexpected normalized messages: %#v", messages)
	}
}

func TestCreativeAgentSeparatesSpeechAndMusicModels(t *testing.T) {
	speech := &service.ModelFull{ModelDTO: service.ModelDTO{Code: "audio_tts", DisplayName: "Text to Speech"}, RequestMode: "audio"}
	music := &service.ModelFull{ModelDTO: service.ModelDTO{Code: "audio_music", DisplayName: "Music"}, RequestMode: "audio", RuntimeRule: map[string]interface{}{"audio": map[string]interface{}{"input_layout": "dual"}}}
	if !creativeAgentModelSupportsType(speech, "speech") || creativeAgentModelSupportsType(speech, "music") {
		t.Fatal("speech model classification failed")
	}
	if !creativeAgentModelSupportsType(music, "music") || creativeAgentModelSupportsType(music, "speech") {
		t.Fatal("music model classification failed")
	}
}
