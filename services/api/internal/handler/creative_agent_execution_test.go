package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/starai/api/internal/service"
)

func TestCreativeAgentIntentBoundary(t *testing.T) {
	for _, text := range []string{
		"这是什么？", "为什么又生成了", "解释一下", "先别生成视频，先写文案", "取消生成", "如何写好文案？", "解释这段脚本", "文章怎么写？", "视频提示词是什么？",
	} {
		plan := guardCreativeAgentIntent(map[string]interface{}{"intent": "video", "prompt": "生成一段视频文案", "needs_confirm": false}, text)
		if plan["intent"] != "chat" || plan["needs_confirm"] != false || plan["prompt"] != "" {
			t.Fatalf("%q must not generate: %#v", text, plan)
		}
	}
	for _, text := range []string{"写一篇文章", "开学季，做为一个程序员，给我一段程序开发人员15秒的短视频文案", "生成一段15秒的短视频文案", "帮我写一段歌词", "润色这段歌词", "修改一下脚本", "今天公司开会，讲的主要内容是如何提高工作效率，请帮我整理成 20秒左右的 1.2倍语速的文案出来"} {
		plan := guardCreativeAgentIntent(map[string]interface{}{"intent": "chat", "reply": "旧的直接交付正文"}, text)
		if plan["intent"] != "chat" || plan["needs_confirm"] != false || plan["reply"] != "旧的直接交付正文" {
			t.Fatalf("%q must deliver writing directly in chat: %#v", text, plan)
		}
	}
	for _, text := range []string{"根据这个文案生成15秒视频", "帮我写文案然后生成视频", "生成一张写着为什么的图片", "文案不用改，直接生成视频", "做一段15秒视频"} {
		plan := guardCreativeAgentIntent(map[string]interface{}{"intent": "video", "needs_confirm": false}, text)
		if plan["intent"] != "video" || plan["needs_confirm"] != true {
			t.Fatalf("%q must require confirmation: %#v", text, plan)
		}
	}
}

func TestCreativeAgentMediaNounBoundary(t *testing.T) {
	for _, text := range []string{"生成一张图", "画一幅插画", "制作产品图片"} {
		if !creativeAgentImageRequest(text) || creativeAgentVideoRequest(text) || creativeAgentContentImageWorkflowCue(text) {
			t.Fatalf("%q should be an image request", text)
		}
	}
	for _, text := range []string{"生成视频", "制作短视频", "拍一部短剧"} {
		if !creativeAgentVideoRequest(text) || creativeAgentImageRequest(text) {
			t.Fatalf("%q should be a video request", text)
		}
	}
	for _, text := range []string{"生成图文", "写一篇微信公众号推文并生成配图", "做一篇小红书图文笔记", "创作今日头条文章和配图"} {
		if !creativeAgentContentImageWorkflowCue(text) {
			t.Fatalf("%q should be a mixed content-image request", text)
		}
	}
	for _, text := range []string{"写一篇文章", "整理资料信息", "解释这段文字", "分析一篇小红书笔记", "写一篇微信公众号推文", "做一篇小红书笔记", "创作今日头条文章", "生成一篇公众号文章，不要配图", "生成小红书图文的纯文字文案，不需要生成图片"} {
		if creativeAgentMediaRequest(text) {
			t.Fatalf("%q should remain text-only", text)
		}
	}
}

func TestCreativeAgentVideoPlanUsesModelCapabilities(t *testing.T) {
	for _, tc := range []struct {
		target, maximum, count, seconds int
		intent                          string
	}{
		{15, 8, 2, 8, "workflow"}, {16, 8, 2, 8, "workflow"}, {22, 8, 3, 8, "workflow"},
		{48, 8, 6, 8, "workflow"}, {15, 15, 1, 15, "video"}, {30, 30, 1, 30, "video"}, {5, 8, 1, 8, "workflow"},
	} {
		model := &service.ModelFull{ModelDTO: service.ModelDTO{Code: "selected", InputSchema: map[string]interface{}{"properties": map[string]interface{}{"duration": map[string]interface{}{"enum": []interface{}{tc.maximum}}}}}}
		plan := prepareCreativeAgentVideoPlan(map[string]interface{}{"intent": "video", "params": map[string]interface{}{"target_duration_sec": tc.target}}, "按这个制作视频", model)
		params, _ := plan["params"].(map[string]interface{})
		if plan["intent"] != tc.intent || plan["needs_confirm"] != true || params["duration"] != tc.seconds || params["target_duration_sec"] != tc.target {
			t.Fatalf("target=%d maximum=%d: %#v", tc.target, tc.maximum, plan)
		}
		if tc.intent == "workflow" && params["storyboard_grid"] != tc.count {
			t.Fatalf("wrong segment count: %#v", plan)
		}
		if err := validateCreativeVideoExecution(model, params, tc.intent == "workflow"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCreativeAgentRejectsStaleDurationAndUnknownCapabilities(t *testing.T) {
	model := &service.ModelFull{ModelDTO: service.ModelDTO{Code: "eight", InputSchema: map[string]interface{}{"properties": map[string]interface{}{"duration": map[string]interface{}{"enum": []interface{}{8}}}}}}
	plan := prepareCreativeAgentVideoPlan(map[string]interface{}{"intent": "video", "params": map[string]interface{}{"target_duration_sec": 8}}, "生成15秒视频", model)
	params := plan["params"].(map[string]interface{})
	if params["target_duration_sec"] != 15 || params["storyboard_grid"] != 2 {
		t.Fatalf("stale planner duration won: %#v", plan)
	}
	if err := validateCreativeVideoExecution(model, params, false); err == nil {
		t.Fatal("direct generation must not silently reduce 15 seconds to 8")
	}
	params["storyboard_grid"] = 4
	if err := validateCreativeVideoExecution(model, params, true); err == nil {
		t.Fatal("changed confirmation plan accepted")
	}
	model.InputSchema = nil
	if got := prepareCreativeAgentVideoPlan(plan, "生成15秒视频", model); got["intent"] != "clarify" {
		t.Fatalf("unknown capability guessed: %#v", got)
	}
}

func TestCreativeAgentVideoParametersFollowSelectedModel(t *testing.T) {
	model := &service.ModelFull{ModelDTO: service.ModelDTO{
		Code: "capability-model",
		InputSchema: map[string]interface{}{"properties": map[string]interface{}{
			"duration":   map[string]interface{}{"enum": []interface{}{8}},
			"resolution": map[string]interface{}{"enum": []interface{}{"480P", "720P"}},
			"ratio":      map[string]interface{}{"enum": []interface{}{"16:9", "9:16"}},
		}},
	}}
	valid := map[string]interface{}{"target_duration_sec": 8, "quality": "720p", "aspect_ratio": "9:16"}
	plan := prepareCreativeAgentVideoPlan(map[string]interface{}{"intent": "video", "params": valid}, "", model)
	if plan["intent"] != "video" || plan["needs_confirm"] != true {
		t.Fatalf("supported parameters rejected: %#v", plan)
	}
	if err := validateCreativeVideoExecution(model, plan["params"].(map[string]interface{}), false); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ key, value, label string }{
		{"quality", "1080p", "画质"},
		{"aspect_ratio", "1:1", "画幅"},
	} {
		params := map[string]interface{}{"target_duration_sec": 8, tc.key: tc.value}
		got := prepareCreativeAgentVideoPlan(map[string]interface{}{"intent": "video", "params": params}, "", model)
		if got["intent"] != "clarify" || got["needs_confirm"] != false || got["invalid_field"] != tc.key || !strings.Contains(stringAny(got["reply"]), tc.label) {
			t.Fatalf("unsupported %s executable: %#v", tc.key, got)
		}
		if err := validateCreativeVideoExecution(model, params, false); err == nil {
			t.Fatalf("execution bypassed unsupported %s", tc.key)
		}
	}
}

func TestCreativeAgentMapsRatioAndQualityToNativeVideoSize(t *testing.T) {
	model := &service.ModelFull{ModelDTO: service.ModelDTO{
		Code:          "veo-size",
		DefaultParams: map[string]interface{}{"size": "1280x720"},
		InputSchema: map[string]interface{}{"properties": map[string]interface{}{
			"duration": map[string]interface{}{"enum": []interface{}{8}},
			"size":     map[string]interface{}{"enum": []interface{}{"1280x720", "720x1280", "1920x1080", "1080x1920"}},
		}},
	}}
	plan := prepareCreativeAgentVideoPlan(map[string]interface{}{"intent": "video", "params": map[string]interface{}{
		"target_duration_sec": 8, "aspect_ratio": "9:16", "quality": "1080p",
	}}, "", model)
	params := plan["params"].(map[string]interface{})
	if plan["intent"] != "video" || params["size"] != "1080x1920" {
		t.Fatalf("explicit portrait quality did not override model default: %#v", plan)
	}
	if err := validateCreativeVideoExecution(model, params, false); err != nil {
		t.Fatal(err)
	}

	portrait := prepareCreativeAgentVideoPlan(map[string]interface{}{"intent": "video", "params": map[string]interface{}{
		"target_duration_sec": 8, "aspect_ratio": "9:16",
	}}, "", model)
	if portrait["params"].(map[string]interface{})["size"] != "720x1280" {
		t.Fatalf("default quality portrait mapping failed: %#v", portrait)
	}

	unsupported := prepareCreativeAgentVideoPlan(map[string]interface{}{"intent": "video", "params": map[string]interface{}{
		"target_duration_sec": 8, "aspect_ratio": "9:16", "quality": "4k",
	}}, "", model)
	if unsupported["intent"] != "clarify" || unsupported["invalid_field"] != "quality" {
		t.Fatalf("unsupported native size became executable: %#v", unsupported)
	}

	stale := copyStringMap(params)
	stale["size"] = "1280x720"
	if err := validateCreativeVideoExecution(model, stale, false); err == nil {
		t.Fatal("stale default size bypassed confirmed portrait mapping")
	}
	if got := creativeAgentDimensionRatio(900, 1200); got != "3:4" {
		t.Fatalf("dimension ratio = %q, want 3:4", got)
	}
}

func TestCreativeAgentMapsImageQualityTier(t *testing.T) {
	model := &service.ModelFull{ModelDTO: service.ModelDTO{
		Code: "gpt-image", DefaultParams: map[string]interface{}{"quality": "1K"},
		RuntimeRule: map[string]interface{}{"image": map[string]interface{}{"supported_sizes": []interface{}{"1K", "2K", "4K"}}},
	}}
	mapped, field, issue := creativeAgentImageModelParams(model, map[string]interface{}{"quality": "4k", "aspect_ratio": "9:16"})
	if issue != "" || field != "" || mapped["quality"] != "4K" || mapped["image_size"] != "4K" {
		t.Fatalf("image tier mapping failed: mapped=%#v field=%q issue=%q", mapped, field, issue)
	}
	if _, field, issue = creativeAgentImageModelParams(model, map[string]interface{}{"quality": "1080p"}); field != "quality" || issue == "" {
		t.Fatalf("inexact image quality was silently accepted: field=%q issue=%q", field, issue)
	}
}

func TestCreativeAgentMapsVoiceGenderAndMusicInputs(t *testing.T) {
	speech := &service.ModelFull{ModelDTO: service.ModelDTO{InputSchema: map[string]interface{}{"properties": map[string]interface{}{
		"voice": map[string]interface{}{
			"enum":                      []interface{}{"female-default", "male-default"},
			"x-agent-default-by-gender": map[string]interface{}{"female": "female-default", "male": "male-default"},
		},
	}}}}
	if key, voice, ok := creativeAgentVoiceForGender(speech, "male"); !ok || key != "voice" || voice != "male-default" {
		t.Fatalf("male voice mapping failed: key=%q voice=%q ok=%v", key, voice, ok)
	}
	delete(speech.InputSchema["properties"].(map[string]interface{})["voice"].(map[string]interface{}), "x-agent-default-by-gender")
	if _, voice, ok := creativeAgentVoiceForGender(speech, "male"); !ok || voice != "male-default" {
		t.Fatalf("female label was mistaken for male: voice=%q ok=%v", voice, ok)
	}

	funMusic := &service.ModelFull{ModelDTO: service.ModelDTO{InputSchema: map[string]interface{}{"properties": map[string]interface{}{
		"mode": map[string]interface{}{"enum": []interface{}{"song", "instrumental"}},
	}}}, RuntimeRule: map[string]interface{}{"audio": map[string]interface{}{"secondary_prompt_key": "lyrics"}}}
	prompt, params := prepareCreativeMusicExecution(funMusic, "[Verse]\n春风吹过", map[string]interface{}{"music_prompt": "轻快流行"})
	if prompt != "轻快流行" || params["lyrics"] != "[Verse]\n春风吹过" || params["mode"] != "song" {
		t.Fatalf("description/lyrics mapping reversed: prompt=%q params=%#v", prompt, params)
	}
	prompt, params = prepareCreativeMusicExecution(funMusic, "不要唱", map[string]interface{}{"music_prompt": "舒缓钢琴", "is_instrumental": true})
	if prompt != "舒缓钢琴" || params["mode"] != "instrumental" || params["lyrics"] != nil {
		t.Fatalf("instrumental mapping failed: prompt=%q params=%#v", prompt, params)
	}

	miniMax := &service.ModelFull{RuntimeRule: map[string]interface{}{"audio": map[string]interface{}{
		"secondary_prompt_key": "music_prompt", "prompt_required": false,
	}}}
	prompt, params = prepareCreativeMusicExecution(miniMax, "生成纯音乐", map[string]interface{}{"music_prompt": "电影感弦乐", "is_instrumental": true})
	if prompt != "" || params["music_prompt"] != "电影感弦乐" {
		t.Fatalf("instrumental lyrics were not cleared: prompt=%q params=%#v", prompt, params)
	}
}

func TestCreativeAgentSelectsVideoReferenceMode(t *testing.T) {
	veo := &service.ModelFull{RuntimeRule: map[string]interface{}{"video": map[string]interface{}{
		"upload_profile": "veo_reference", "mode_param": "generation_mode",
	}}}
	params := map[string]interface{}{"generation_mode": "text"}
	if err := applyCreativeVideoReferenceMode(veo, params, 1, 0, 0); err != nil || params["generation_mode"] != "reference" {
		t.Fatalf("reference image did not enable native mode: params=%#v err=%v", params, err)
	}
	if err := applyCreativeVideoReferenceMode(veo, map[string]interface{}{}, 0, 1, 0); err == nil {
		t.Fatal("unsupported reference video was silently ignored")
	}
	seedance := &service.ModelFull{RuntimeRule: map[string]interface{}{"video": map[string]interface{}{"upload_profile": "seedance_2"}}}
	params = map[string]interface{}{}
	if err := applyCreativeVideoReferenceMode(seedance, params, 1, 1, 1); err != nil || params["generation_mode"] != "image_video_audio" {
		t.Fatalf("multimodal mode mapping failed: params=%#v err=%v", params, err)
	}
}

func TestCreativeAgentDetectsAudioReferenceCapability(t *testing.T) {
	unsupported := &service.ModelFull{RuntimeRule: map[string]interface{}{"upstream": map[string]interface{}{"include": []interface{}{"format"}}}}
	supported := &service.ModelFull{RuntimeRule: map[string]interface{}{"upstream": map[string]interface{}{"include": []interface{}{"format", "reference_audio"}}}}
	if creativeAgentAudioSupportsReference(unsupported) || !creativeAgentAudioSupportsReference(supported) {
		t.Fatal("audio reference capability detection failed")
	}
}

func TestCreativeAgentRequiresConfirmationBeforeSideEffects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{} // Any service access would panic: guards must run first.
	for _, tc := range []struct {
		name    string
		handler gin.HandlerFunc
		body    string
	}{
		{"generate", h.CreativeAgentGenerate, `{"media_type":"video","prompt":"test"}`},
		{"workflow", h.CreativeAgentRunWorkflow, `{"workflow_code":"ai_comic_drama","prompt":"test"}`},
		{"retry", h.RetryAgentProject, `{"conversation_id":"conv_test"}`},
		{"retry-node", h.RetryAgentProjectNode, `{"conversation_id":"conv_test","node_id":"compose"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router := gin.New()
			router.POST("/test", tc.handler)
			req := httptest.NewRequest(http.MethodPost, "/test", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			if response.Code != 400 || !strings.Contains(response.Body.String(), "确认") {
				t.Fatalf("unconfirmed request was not rejected: %d %s", response.Code, response.Body.String())
			}
		})
	}
}
