package runtime

import (
	"strings"
	"testing"
)

func TestNativeThinkingStaysOutOfAgentAnswer(t *testing.T) {
	for _, tc := range []struct{ protocol, stream, reply string }{
		{"claude", "event: content_block_delta\ndata: {\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"analysis\"}}\n\nevent: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"CHAT\\nanswer\"}}\n\nevent: message_stop\ndata: {}\n\n", `{"content":[{"type":"thinking","thinking":"analysis"},{"type":"text","text":"CHAT\nanswer"}]}`},
		{"gemini", "data: {\"candidates\":[{\"content\":{\"parts\":[{\"thought\":true,\"text\":\"analysis\"},{\"text\":\"CHAT\\nanswer\"}]},\"finishReason\":\"STOP\"}]}\n\n", `{"candidates":[{"content":{"parts":[{"thought":true,"text":"analysis"},{"text":"CHAT\nanswer"}]}}]}`},
		{"responses", "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"analysis\"}\n\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"CHAT\\nanswer\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"object\":\"response\",\"status\":\"completed\",\"output_text\":\"CHAT\\nanswer\",\"usage\":{\"input_tokens\":7,\"output_tokens\":3}}}\n\n", `{"object":"response","status":"completed","output_text":"CHAT\nanswer"}`},
	} {
		t.Run(tc.protocol, func(t *testing.T) {
			ch := make(chan StreamChunk, 16)
			consumeChatStream(strings.NewReader(tc.stream), tc.protocol, ch)
			close(ch)
			var content, reasoning string
			done := false
			for chunk := range ch {
				if chunk.Error != nil {
					t.Fatal(chunk.Error)
				}
				content += chunk.Content
				reasoning += chunk.ReasoningContent
				done = done || chunk.Done
			}
			if content != "CHAT\nanswer" || reasoning != "analysis" || !done {
				t.Fatal(content, reasoning, done)
			}
			response, err := decodeChatResponse(tc.protocol, []byte(tc.reply))
			if err != nil || response.Choices[0].Message.Content != "CHAT\nanswer" {
				t.Fatal(response, err)
			}
		})
	}
}
