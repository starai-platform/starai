package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatCompletionClaudeProtocol(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Fatalf("request = %s, anthropic-version=%q", r.URL.Path, r.Header.Get("anthropic-version"))
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if _, ok := body["messages"].([]interface{}); !ok || body["max_tokens"] != float64(8) {
			t.Fatalf("claude body = %#v", body)
		}
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"claude reply"}],"usage":{"input_tokens":4,"output_tokens":3}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", 5, 5)
	response, err := client.ChatCompletionWithConfig(context.Background(), "", ChatRequest{
		Model: "claude-sonnet", Messages: []ChatMessage{{Role: "user", Content: "hello"}}, Extra: map[string]interface{}{"max_tokens": 8},
	}, map[string]interface{}{"connection": map[string]interface{}{"protocol": "claude", "base_url": server.URL, "api_key": "token"}})
	if err != nil {
		t.Fatal(err)
	}
	if response.Choices[0].Message.Content != "claude reply" || response.Usage.TotalTokens != 7 {
		t.Fatalf("response = %#v", response)
	}
}

func TestChatCompletionGeminiProtocol(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models/gemini-2.5-pro:generateContent" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		contents, ok := body["contents"].([]interface{})
		if !ok || len(contents) != 1 || body["generationConfig"] == nil {
			t.Fatalf("gemini body = %#v", body)
		}
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"gemini reply"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"totalTokenCount":7}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", 5, 5)
	response, err := client.ChatCompletionWithConfig(context.Background(), "", ChatRequest{
		Model: "gemini-2.5-pro", Messages: []ChatMessage{{Role: "user", Content: "hello"}}, Extra: map[string]interface{}{"max_completion_tokens": 8},
	}, map[string]interface{}{"connection": map[string]interface{}{"protocol": "gemini", "base_url": server.URL, "api_key": "token"}})
	if err != nil {
		t.Fatal(err)
	}
	if response.Choices[0].Message.Content != "gemini reply" || response.Usage.TotalTokens != 7 {
		t.Fatalf("response = %#v", response)
	}
}

func TestChatCompletionClaudeStreamProtocol(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":4}}}\n\n"))
		_, _ = w.Write([]byte("event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"hello\"}}\n\n"))
		_, _ = w.Write([]byte("event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":2}}\n\n"))
		_, _ = w.Write([]byte("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", 5, 5)
	chunks, err := client.ChatCompletionStreamWithConfig(context.Background(), "", ChatRequest{Model: "claude-sonnet", Messages: []ChatMessage{{Role: "user", Content: "hello"}}}, map[string]interface{}{"connection": map[string]interface{}{"protocol": "claude", "base_url": server.URL, "api_key": "token"}})
	if err != nil {
		t.Fatal(err)
	}
	var content string
	var usage *ChatUsage
	var done bool
	for chunk := range chunks {
		content += chunk.Content
		if chunk.Usage != nil {
			usage = chunk.Usage
		}
		done = done || chunk.Done
	}
	if content != "hello" || usage == nil || usage.TotalTokens != 6 || !done {
		t.Fatalf("content=%q usage=%#v done=%v", content, usage, done)
	}
}

func TestListModelsUsesOpenAIEnvelopeAndBaseV1Prefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path = %s, want /v1/models", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token" {
			t.Fatalf("authorization = %q", got)
		}
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"gpt-5.5","object":"model","owned_by":"openai"}]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL+"/v1", "token", 5, 5)
	items, err := client.ListModels(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != "gpt-5.5" {
		t.Fatalf("items = %#v", items)
	}
}

func TestTestModelConnectionSendsValidChatProbeWhenModelListUnavailable(t *testing.T) {
	var body map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"pong"}}]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", 5, 5)
	result := client.TestModelConnection(context.Background(), "/v1/chat/completions", "chat_completions", "test-model", nil)
	if !result.OK {
		t.Fatalf("result = %#v", result)
	}
	messages, ok := body["messages"].([]interface{})
	if !ok || len(messages) != 1 || !strings.Contains(result.Message, "正常") {
		t.Fatalf("body = %#v, result = %#v", body, result)
	}
}

func TestTestModelConnectionPreservesCustomMediaEndpoint(t *testing.T) {
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output":{"task_id":"task-1"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", 5, 5)
	result := client.TestModelConnection(context.Background(), "/api/v1/services/aigc/video-generation/video-synthesis", "video", "wan-v1", nil)
	if !result.OK || path != "/api/v1/services/aigc/video-generation/video-synthesis" {
		t.Fatalf("path=%q result=%#v", path, result)
	}
}

func TestTestImageConnectionUsesNonGeneratingValidationProbe(t *testing.T) {
	var body map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"prompt is required"}}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", 5, 5)
	result := client.TestModelConnection(context.Background(), "/v1/images/generations", "images", "gpt-image-2-2k", nil)
	if !result.OK || len(body) != 0 {
		t.Fatalf("body=%#v result=%#v", body, result)
	}
	if !strings.Contains(result.Message, "未提交生图") {
		t.Fatalf("message = %q", result.Message)
	}
}

func TestTestImageConnectionUsesModelListWithoutGenerating(t *testing.T) {
	postCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			postCount++
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-image-2-2k","object":"model"}]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", 5, 5)
	result := client.TestModelConnection(context.Background(), "/v1/images/generations", "images", "gpt-image-2-2k", nil)
	if !result.OK || postCount != 0 || !strings.Contains(result.Message, "未提交生图") {
		t.Fatalf("postCount=%d result=%#v", postCount, result)
	}
}

func TestJoinEndpointDoesNotDuplicateProviderPathPrefix(t *testing.T) {
	for _, test := range []struct{ baseURL, endpoint, want string }{
		{"https://tokenhub.tencentmaas.com/v1", "/v1/images/generations", "https://tokenhub.tencentmaas.com/v1/images/generations"},
		{"https://dashscope.aliyuncs.com/api/v1", "/api/v1/services/aigc/video-generation/video-synthesis", "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"},
	} {
		if got := joinEndpoint(test.baseURL, test.endpoint); got != test.want {
			t.Fatalf("joinEndpoint(%q, %q) = %q, want %q", test.baseURL, test.endpoint, got, test.want)
		}
	}
}

func TestTestModelConnectionUsesCanonicalBlankVideoEndpoint(t *testing.T) {
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", 5, 5)
	result := client.TestModelConnection(context.Background(), "", "video", "video-model", nil)
	if !result.OK || path != "/v1/video/generations" {
		t.Fatalf("path=%q result=%#v", path, result)
	}
}

func TestChatCompletionStreamRequestsUsage(t *testing.T) {
	var request map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":3,\"total_tokens\":15}}\n\n"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", 5, 5)
	chunks, err := client.ChatCompletionStreamWithConfig(context.Background(), "/chat", ChatRequest{Model: "test", Messages: []ChatMessage{{Role: "user", Content: "hello"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var usage *ChatUsage
	for chunk := range chunks {
		if chunk.Usage != nil {
			usage = chunk.Usage
		}
	}
	options, _ := request["stream_options"].(map[string]interface{})
	if options["include_usage"] != true {
		t.Fatalf("stream_options = %#v, want include_usage=true", options)
	}
	if usage == nil || usage.TotalTokens != 15 {
		t.Fatalf("usage = %#v, want total_tokens=15", usage)
	}
}
