package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAnalysisSendsLocalReferencePixelsInEveryProtocol(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("\x89PNG\r\n\x1a\nreference"))
	}))
	defer server.Close()
	inputs := map[string]interface{}{"image_url": server.URL, "reference_images": []string{server.URL}, "reference_asset_ids": []string{"asset1"}}
	refs, err := agentAnalysisReferenceImages(context.Background(), inputs)
	if err != nil || len(refs) != 1 || requests != 1 || !strings.HasPrefix(refs[0], "data:image/png;base64,") {
		t.Fatalf("refs=%v requests=%d err=%v", refs, requests, err)
	}
	if !strings.Contains(agentGenerationParamSummary(inputs), "参考图=1张") || inputs["image_url"] != server.URL {
		t.Fatal("reference aliases were counted twice or inputs mutated")
	}
	for _, spec := range []struct{ protocol, mode string }{{"openai", "chat"}, {"openai", "responses"}, {"claude", "chat"}, {"gemini", "chat"}} {
		body, _ := buildWorkerLLMRequest(workerModelRoute{Protocol: spec.protocol}, spec.mode, "vision", "system", "user", 0.35)
		applyAgentVisionContent(context.Background(), body, spec.protocol, spec.mode, "system", "user", refs)
		raw, _ := json.Marshal(body)
		if !strings.Contains(string(raw), strings.SplitN(refs[0], ",", 2)[1]) || strings.Contains(string(raw), server.URL) {
			t.Fatalf("%s/%s missing image bytes: %s", spec.protocol, spec.mode, raw)
		}
	}
}

func TestAnalysisStopsWhenReferenceIsUnreadable(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	refs, err := agentAnalysisReferenceImages(context.Background(), map[string]interface{}{"image_url": server.URL})
	if err == nil || len(refs) != 0 {
		t.Fatalf("unreadable image allowed: %v %v", refs, err)
	}
}

func TestAnalysisRequiresDeclaredImageSupport(t *testing.T) {
	if agentAnalysisModelAcceptsImages(agentAnalysisModel{RuntimeRule: map[string]interface{}{}}) {
		t.Fatal("text-only model accepted image content")
	}
	model := agentAnalysisModel{RuntimeRule: map[string]interface{}{"capabilities": map[string]interface{}{"vision": true}}}
	if !agentAnalysisModelAcceptsImages(model) {
		t.Fatal("vision model rejected image content")
	}
}

func TestLLMMediaValidationAndVideoSerialization(t *testing.T) {
	ctx := context.Background()
	for _, ref := range []string{"invalid", "data:image/png;base64,aGVsbG8=", "data:image/png;base64,"} {
		if _, err := normalizeLLMImages(ctx, []string{ref}); err == nil {
			t.Fatalf("accepted invalid reference %q", ref)
		}
	}
	allowed, exists := workerMediaCapability(map[string]interface{}{"capabilities": map[string]interface{}{"vision": false, "multimodal": true}}, "vision", "image_input", "multimodal")
	if allowed || !exists {
		t.Fatal("explicit false did not override alias")
	}
	ref := "data:video/mp4;base64," + base64.StdEncoding.EncodeToString([]byte("video fixture"))
	for _, protocol := range []string{"openai", "gemini"} {
		body, _ := buildWorkerLLMRequest(workerModelRoute{Protocol: protocol}, "chat", "model", "system", "user", 0.3)
		applyAgentVisionContent(ctx, body, protocol, "chat", "system", "user", nil)
		if err := applyWorkerVideoContent(ctx, body, protocol, []string{ref}); err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(body)
		if !strings.Contains(string(raw), strings.SplitN(ref, ",", 2)[1]) {
			t.Fatalf("%s lost video: %s", protocol, raw)
		}
	}
}

func TestDetailPhotoUsesOneImageAndNeverReceivesCopy(t *testing.T) {
	inputs := map[string]interface{}{"count": 6, "n": 6, "creative_scene": "detail_image", "_detail_style": "暖白背景，石墨灰标题"}
	section := map[string]interface{}{"copy_title": "渐变针织", "copy_points": []string{"米白过渡至灰色"}, "image_prompt": "上身正面大图"}
	prompt := detailSectionGenerationPrompt("整页方案要求重复全身模特", section, 0, 6, inputs)
	for _, want := range []string{"数量=1", "暖白背景", "上身正面大图", "不做多格拼图", "不绘制任何新增文字"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("missing %s", want)
		}
	}
	if strings.Contains(prompt, "整页方案要求重复全身模特") || strings.Contains(prompt, "渐变针织") || strings.Contains(prompt, "米白过渡至灰色") || strings.Contains(prompt, "数量=6") || intAny(inputs["count"]) != 6 || strings.Contains(prompt, "SCENE HARD REQUIREMENT") {
		t.Fatal("whole-page generation instructions leaked into the module")
	}
}
