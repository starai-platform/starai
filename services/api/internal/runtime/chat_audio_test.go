package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestChatAudioReachesProvider(t *testing.T) {
	payload := base64.StdEncoding.EncodeToString([]byte("RIFF\x24\x00\x00\x00WAVEaudio"))
	messages := []map[string]interface{}{{"role": "user", "name": "creator", "content": []map[string]interface{}{
		{"type": "text", "text": "Use this audio to plan scenes"},
		{"type": "audio_url", "audio_url": map[string]interface{}{"url": "data:audio/wav;base64," + payload}},
	}}}
	original, _ := json.Marshal(messages)
	for _, protocol := range []string{"openai", "gemini"} {
		t.Run(protocol, func(t *testing.T) {
			var received map[string]interface{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
					t.Error(err)
				}
				w.Header().Set("Content-Type", "application/json")
				if protocol == "gemini" {
					_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"scene plan"}]}}]}`))
				} else {
					_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"scene plan"}}]}`))
				}
			}))
			defer server.Close()
			result, err := NewClient(server.URL, "test", 5, 5).ChatCompletionWithConfig(context.Background(), "", ChatRequest{Model: "audio-model", Messages: messages}, map[string]interface{}{"connection": map[string]interface{}{"protocol": protocol}})
			if err != nil {
				t.Fatal(err)
			}
			if result.Choices[0].Message.Content != "scene plan" {
				t.Fatal("response lost")
			}
			if protocol == "gemini" {
				parts := received["contents"].([]interface{})[0].(map[string]interface{})["parts"].([]interface{})
				media := parts[1].(map[string]interface{})["inlineData"].(map[string]interface{})
				if media["mimeType"] != "audio/wav" || media["data"] != payload {
					t.Fatal("Gemini did not receive audio bytes")
				}
			} else {
				message := received["messages"].([]interface{})[0].(map[string]interface{})
				part := message["content"].([]interface{})[1].(map[string]interface{})
				if message["name"] != "creator" || part["type"] != "input_audio" || !reflect.DeepEqual(part["input_audio"], map[string]interface{}{"data": payload, "format": "wav"}) {
					t.Fatal("OpenAI did not receive audio bytes or lost metadata")
				}
			}
			after, _ := json.Marshal(messages)
			if string(after) != string(original) {
				t.Fatal("adapter mutated messages used by failover")
			}
		})
	}
}

func TestChatAudioRejectsUnsupportedFormat(t *testing.T) {
	for _, ref := range []string{"https://example.com/a.mp3", "data:audio/mp4;base64,YQ==", "data:audio/mpeg;base64,invalid", "data:audio/mpeg;base64,"} {
		messages := []map[string]interface{}{{"role": "user", "content": []map[string]interface{}{{"type": "audio_url", "audio_url": map[string]interface{}{"url": ref}}}}}
		if _, _, _, err := prepareChatRequest("", ChatRequest{Messages: messages}, nil); err == nil {
			t.Fatalf("invalid audio accepted: %s", ref)
		}
	}
}
