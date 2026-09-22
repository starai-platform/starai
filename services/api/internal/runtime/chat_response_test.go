package runtime

import (
	"errors"
	"testing"
)

func TestOpenAIAnswerFormats(t *testing.T) {
	for _, tc := range []struct{ name, raw, text string }{
		{"chat", `{"choices":[{"message":{"role":"assistant","content":"正文"}}]}`, "正文"},
		{"blocks", `{"choices":[{"message":{"content":[{"type":"reasoning","text":"不要发布推理"},{"type":"text","text":"标题"},{"type":"output_text","text":"正文"}]}}]}`, "标题正文"},
		{"responses", `{"id":"resp_sol","model":"gpt-5.6-sol","object":"response","status":"completed","output":[{"type":"reasoning","content":[{"type":"text","text":"推理"}]},{"type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"我正在写作"}]},{"type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"最终正文"}]}],"usage":{"input_tokens":20,"output_tokens":10,"total_tokens":30,"input_tokens_details":{"cached_tokens":5}}}`, "最终正文"},
		{"flattened", `{"object":"response","status":"completed","output_text":"最终正文"}`, "最终正文"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result, err := decodeChatResponse("openai", []byte(tc.raw))
			if err != nil {
				t.Fatal(err)
			}
			if result.Choices[0].Message.Content != tc.text {
				t.Fatalf("got %q", result.Choices[0].Message.Content)
			}
			if tc.name == "responses" && (result.ID != "resp_sol" || result.Usage.PromptTokens != 20 || result.Usage.CompletionTokens != 10 || result.Usage.CachedInputTokens() != 5 || result.Usage.TotalTokens != 30) {
				t.Fatalf("lost identity/usage: %#v", result)
			}
		})
	}
}

func TestOpenAIEmptyAnswerDiagnostics(t *testing.T) {
	for _, tc := range []struct{ raw, code string }{
		{`{"choices":[{"finish_reason":"length","message":{"content":null,"reasoning_content":"thinking"}}]}`, "MODEL_OUTPUT_LIMIT"},
		{`{"object":"response","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output_text":"partial"}`, "MODEL_OUTPUT_LIMIT"},
		{`{"choices":[{"message":{"content":null,"refusal":"no"}}]}`, "CONTENT_REJECTED"},
		{`{"choices":[{"finish_reason":"content_filter","message":{"content":null}}]}`, "CONTENT_REJECTED"},
		{`{"object":"response","output":[{"type":"message","role":"assistant","content":[{"type":"refusal","refusal":"no"}]}]}`, "CONTENT_REJECTED"},
		{`{"choices":[{"message":{"content":null,"reasoning_content":"not the answer"}}]}`, "MODEL_EMPTY_RESPONSE"},
		{`{"choices":[]}`, "MODEL_EMPTY_RESPONSE"},
		{`{"object":"response","output":[{"type":"reasoning","content":[]}],"output_text":"do not fall back to reasoning"}`, "MODEL_EMPTY_RESPONSE"},
	} {
		_, err := decodeChatResponse("openai", []byte(tc.raw))
		var platform *PlatformError
		if !errors.As(err, &platform) || platform.Code != tc.code {
			t.Fatalf("got %v; want %s", err, tc.code)
		}
	}
	result, err := decodeChatResponse("openai", []byte(`{"choices":[{"finish_reason":"tool_calls","message":{"content":null,"tool_calls":[{"id":"call1","type":"function","function":{"name":"test","arguments":"{}"}}]}}]}`))
	if err != nil || len(result.Choices[0].ToolCalls) != 1 {
		t.Fatal("valid tool response rejected", err)
	}
}
