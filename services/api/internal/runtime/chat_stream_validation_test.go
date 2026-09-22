package runtime

import (
	"errors"
	"strings"
	"testing"
)

func TestStreamResponseValidation(t *testing.T) {
	for _, tc := range []struct{ name, payload, code, answer string }{
		{"glm moderation", `{"choices":[{"delta":{},"finish_reason":"sensitive"}]}`, "CONTENT_REJECTED", ""},
		{"moderation after partial answer", "{\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"sensitive\"}]}", "CONTENT_REJECTED", "partial"},
		{"openai moderation", `{"choices":[{"delta":{},"finish_reason":"content_filter"}]}`, "CONTENT_REJECTED", ""},
		{"length", `{"choices":[{"delta":{},"finish_reason":"length"}]}`, "MODEL_OUTPUT_LIMIT", ""},
		{"provider error", `{"error":{"message":"upstream error"}}`, "MODEL_PROVIDER_ERROR", ""},
		{"invalid json", `{"choices":`, "MODEL_INVALID_RESPONSE", ""},
		{"empty", `{"choices":[{"delta":{},"finish_reason":"stop"}]}`, "MODEL_EMPTY_RESPONSE", ""},
		{"reasoning only", `{"choices":[{"delta":{"reasoning_content":"private reasoning"},"finish_reason":"stop"}]}`, "MODEL_EMPTY_RESPONSE", ""},
		{"answer blocks", `{"choices":[{"delta":{"content":[{"type":"text","text":"CHAT\n正文"},{"type":"reasoning","text":"private"}]},"finish_reason":"stop"}]}`, "", "CHAT\n正文"},
		{"normal answer", `{"choices":[{"delta":{"content":"CHAT\n正文"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}`, "", "CHAT\n正文"},
		{"tool call", `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"weather","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`, "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ch := make(chan StreamChunk, 32)
			consumeChatStream(strings.NewReader("data: "+tc.payload+"\n\ndata: [DONE]\n\n"), chatProtocolOpenAI, ch)
			close(ch)
			var answer, code string
			done := false
			for chunk := range ch {
				answer += chunk.Content
				done = done || chunk.Done
				if chunk.Error != nil {
					var pe *PlatformError
					if !errors.As(chunk.Error, &pe) {
						t.Fatal(chunk.Error)
					}
					code = pe.Code
				}
			}
			if code != tc.code || answer != tc.answer || done != (tc.code == "") {
				t.Fatalf("code=%s answer=%q done=%v", code, answer, done)
			}
		})
	}
	for _, reason := range []string{"sensitive", "content_filter", "length", "network_error"} {
		if _, err := decodeChatResponse(chatProtocolOpenAI, []byte(`{"choices":[{"message":{"content":"partial"},"finish_reason":"`+reason+`"}]}`)); err == nil {
			t.Fatalf("nonstream accepted %s", reason)
		}
	}
}
