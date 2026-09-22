package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/starai/api/internal/runtime"
)

func TestReasoningSwitchReachesProviderWire(t *testing.T) {
	for _, tc := range []struct {
		name, model, protocol, mode, path string
		off, on                           interface{}
	}{
		{"GLM", "GLM-4.6V", "openai", "", "thinking.type", "disabled", "enabled"},
		{"DeepSeek", "deepseek-v3.2", "openai", "", "thinking.type", "disabled", "enabled"},
		{"Qwen", "qwen3.8-27b", "openai", "", "enable_thinking", false, true},
		{"NVIDIA", "nvidia/nemotron", "openai", "nvidia_chat_template", "chat_template_kwargs.enable_thinking", false, true},
		{"OpenAI", "gpt-5.4", "openai", "", "reasoning_effort", "none", "high"},
		{"o3 cannot disable", "o3", "openai", "", "reasoning_effort", "low", "high"},
		{"Claude manual", "claude-sonnet-4-5", "claude", "", "thinking.type", "disabled", "enabled"},
		{"Claude adaptive", "claude-sonnet-4-6", "claude", "", "thinking.type", "disabled", "adaptive"},
		{"Gemini native", "gemini-3.8-flash", "gemini", "", "generationConfig.thinkingConfig.thinkingLevel", "low", "high"},
		{"Gemini compatible", "gemini-3.8-flash", "openai", "", "reasoning_effort", "low", "high"},
		{"Gemini budget", "gemini-2.5-flash", "gemini", "", "generationConfig.thinkingConfig.thinkingBudget", float64(0), float64(4096)},
		{"Responses", "gpt-6-astra", "openai", "", "reasoning.effort", "low", "high"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, enabled := range []bool{false, true} {
				var body map[string]interface{}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					w.Header().Set("Content-Type", "application/json")
					switch tc.protocol {
					case "claude":
						_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"ok"}]}`))
					case "gemini":
						_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}`))
					default:
						_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
					}
				}))
				defer server.Close()
				endpoint := "/v1/chat/completions"
				if tc.name == "Responses" {
					endpoint = "/v1/responses"
				}
				// The configured model differs from the selected route: route metadata must win.
				model := &ModelFull{NewAPIModel: "stale-model", ModelDTO: ModelDTO{DefaultParams: map[string]interface{}{"thinking": map[string]interface{}{"type": "enabled"}, "reasoning_effort": "medium"}}}
				route := ModelRoute{UpstreamModel: tc.model, Protocol: tc.protocol, BaseURL: server.URL, Endpoint: endpoint, RuntimeRule: map[string]interface{}{"reasoning": map[string]interface{}{"mode": tc.mode}}}
				req, err := chatRouteRequest(runtime.ChatRequest{Messages: []runtime.ChatMessage{{Role: "user", Content: "hello"}}, Temperature: runtime.Float64Ptr(.2)}, model, route, map[string]interface{}{"deep_think": enabled})
				if err != nil {
					t.Fatal(err)
				}
				_, err = runtime.NewClient(server.URL, "", 10, 10).ChatCompletionWithConfig(context.Background(), endpoint, req, route.RequestExtra(model))
				if err != nil {
					t.Fatal(err)
				}
				var got interface{} = body
				for _, key := range strings.Split(tc.path, ".") {
					m, ok := got.(map[string]interface{})
					if !ok {
						t.Fatalf("missing %s in %#v", tc.path, body)
					}
					got = m[key]
				}
				want := tc.off
				if enabled {
					want = tc.on
				}
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("enabled=%v got=%v want=%v body=%#v", enabled, got, want, body)
				}
				if _, exists := body["deep_think"]; exists {
					t.Fatal("internal UI flag leaked upstream")
				}
				if tc.name == "Responses" {
					if body["input"] == nil || body["messages"] != nil || body["reasoning_effort"] != nil {
						t.Fatal("invalid Responses request", body)
					}
				}
			}
		})
	}
}

func TestReasoningCapabilitiesAndCustomRoutes(t *testing.T) {
	for _, name := range []string{"unrecognized-model", "gpt-4.1", "qwen3-235b-thinking", "gpt-5-chat-latest"} {
		if reasoningCapability(chatReasoningConfig(&ModelFull{NewAPIModel: name})).Supported {
			t.Fatal("unexpected switch support", name)
		}
	}
	model := &ModelFull{NewAPIModel: "o3"}
	if reasoningCapability(chatReasoningConfig(model)).CanDisable {
		t.Fatal("o3 advertised a complete off switch")
	}
	model.RuntimeRule = map[string]interface{}{"reasoning": map[string]interface{}{"mode": "custom", "on_params": map[string]interface{}{"reasoning_effort": "high"}, "off_params": map[string]interface{}{"reasoning_effort": "low"}}}
	for _, enabled := range []bool{true, false} {
		params, err := buildChatUpstreamParams(model, map[string]interface{}{"deep_think": enabled})
		if err != nil || params["reasoning_effort"] == nil {
			t.Fatal(params, err)
		}
	}
	model.RuntimeRule = map[string]interface{}{"reasoning": map[string]interface{}{"mode": "claude_budget", "default_budget": 4096}}
	if _, err := buildChatUpstreamParams(model, map[string]interface{}{"deep_think": true, "max_tokens": 1024}); err == nil {
		t.Fatal("invalid Claude budget accepted")
	}
}
