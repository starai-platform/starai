package service

import "testing"

func TestBuildUpstreamAudioPayloadSupportsNestedMap(t *testing.T) {
	model := &ModelFull{
		ModelDTO:    ModelDTO{Code: "audio_minimax_speech_28_hd"},
		NewAPIModel: "speech-2.8-hd",
		RuntimeRule: map[string]interface{}{
			"upstream": map[string]interface{}{
				"include": []interface{}{"voice_id", "speed", "format"},
				"map": map[string]interface{}{
					"prompt":   "text",
					"voice_id": "voice_setting.voice_id",
					"speed":    "voice_setting.speed",
					"format":   "audio_setting.format",
				},
				"static": map[string]interface{}{
					"stream":          false,
					"output_format":   "hex",
					"subtitle_enable": false,
					"voice_setting":   map[string]interface{}{"vol": float64(1), "pitch": float64(0)},
					"audio_setting":   map[string]interface{}{"sample_rate": float64(32000), "bitrate": float64(128000), "channel": float64(1)},
				},
			},
		},
	}
	got := BuildUpstreamAudioPayload(model, map[string]interface{}{
		"prompt":   "hello",
		"voice_id": "male-qn-qingse",
		"speed":    1.15,
		"format":   "mp3",
	})
	if got["text"] != "hello" || got["model"] != "speech-2.8-hd" || got["stream"] != false {
		t.Fatalf("unexpected top-level payload: %#v", got)
	}
	voice, ok := got["voice_setting"].(map[string]interface{})
	if !ok {
		t.Fatalf("voice_setting missing: %#v", got)
	}
	if voice["voice_id"] != "male-qn-qingse" || voice["speed"] != 1.15 {
		t.Fatalf("unexpected voice_setting: %#v", voice)
	}
	if voice["vol"] != float64(1) || voice["pitch"] != float64(0) {
		t.Fatalf("missing MiniMax official voice defaults: %#v", voice)
	}
	audio, ok := got["audio_setting"].(map[string]interface{})
	if !ok || audio["format"] != "mp3" {
		t.Fatalf("unexpected audio_setting: %#v", got)
	}
	if audio["sample_rate"] != float64(32000) || audio["bitrate"] != float64(128000) || audio["channel"] != float64(1) {
		t.Fatalf("missing MiniMax official audio defaults: %#v", audio)
	}
	if got["output_format"] != "hex" || got["subtitle_enable"] != false {
		t.Fatalf("missing MiniMax official response defaults: %#v", got)
	}
	if _, ok := got["response_format"]; ok {
		t.Fatalf("response_format should not be sent: %#v", got)
	}
}
