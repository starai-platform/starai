package service

import "testing"

func TestSpeechComposeRequiresOneVideoAndPositiveDuration(t *testing.T) {
	input := CreateComposeTaskInput{Mode: "speech", TargetDuration: 8, Sources: []map[string]interface{}{{"kind": "video"}, {"kind": "audio"}, {"kind": "audio"}}}
	if err := validateComposeTaskInput(&input); err != nil {
		t.Fatal(err)
	}
	input.Sources = input.Sources[:1]
	if err := validateComposeTaskInput(&input); err != nil {
		t.Fatal(err)
	}
	input.TargetDuration = 0
	if err := validateComposeTaskInput(&input); err == nil {
		t.Fatal("missing shot duration accepted")
	}
	input.TargetDuration = 8
	input.Mode = "synced"
	if err := validateComposeTaskInput(&input); err == nil {
		t.Fatal("sync output without original audio accepted")
	}
}

func TestSyncVideoInputValidation(t *testing.T) {
	model := &ModelFull{RuntimeRule: map[string]interface{}{"lip_sync": map[string]interface{}{"provider": "sync"}, "video": map[string]interface{}{"prompt_required": false, "upload_profile": "none"}}}
	params := map[string]interface{}{"input": []interface{}{map[string]interface{}{"type": "video", "url": "https://example.com/v.mp4"}, map[string]interface{}{"type": "audio", "url": "https://example.com/a.wav"}}}
	if err := ValidateVideoParams(model, params); err != nil {
		t.Fatal(err)
	}
	params["input"].([]interface{})[1] = map[string]interface{}{"type": "audio", "url": "file:///private.wav"}
	if err := ValidateVideoParams(model, params); err == nil {
		t.Fatal("invalid media URL accepted")
	}
}

func TestValidateComposeTaskInput(t *testing.T) {
	tests := []struct {
		name    string
		input   CreateComposeTaskInput
		wantErr bool
	}{
		{
			name: "auto video and audio",
			input: CreateComposeTaskInput{
				Sources: []map[string]interface{}{{"kind": "video"}, {"kind": "audio"}},
				Mode:    "auto", OutputSize: "keep",
			},
		},
		{
			name: "concat same kind",
			input: CreateComposeTaskInput{
				Sources: []map[string]interface{}{{"kind": "video"}, {"kind": "video"}},
				Mode:    "concat", OutputSize: "1080x1920",
			},
		},
		{
			name: "concat mixed kinds",
			input: CreateComposeTaskInput{
				Sources: []map[string]interface{}{{"kind": "video"}, {"kind": "audio"}},
				Mode:    "concat", OutputSize: "keep",
			},
			wantErr: true,
		},
		{
			name: "mux requires exactly one audio",
			input: CreateComposeTaskInput{
				Sources: []map[string]interface{}{{"kind": "video"}, {"kind": "audio"}, {"kind": "audio"}},
				Mode:    "mux", OutputSize: "keep",
			},
			wantErr: true,
		},
		{
			name: "auto refuses ignored image",
			input: CreateComposeTaskInput{
				Sources: []map[string]interface{}{{"kind": "image"}, {"kind": "video"}},
				Mode:    "auto", OutputSize: "keep",
			},
			wantErr: true,
		},
		{
			name: "invalid output size",
			input: CreateComposeTaskInput{
				Sources: []map[string]interface{}{{"kind": "audio"}},
				Mode:    "auto", OutputSize: "999x999",
			},
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateComposeTaskInput(&test.input)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateComposeTaskInput() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}

func TestValidateComposeTaskInputAppliesDefaults(t *testing.T) {
	input := CreateComposeTaskInput{
		Sources: []map[string]interface{}{{"kind": "audio"}},
	}
	if err := validateComposeTaskInput(&input); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input.Mode != "auto" || input.OutputSize != "keep" {
		t.Fatalf("defaults = mode %q, size %q", input.Mode, input.OutputSize)
	}
}

func TestValidateComposeTaskInputSubtitles(t *testing.T) {
	input := CreateComposeTaskInput{
		Sources:   []map[string]interface{}{{"kind": "video"}},
		Subtitles: []ComposeSubtitleCue{{StartSec: 0, EndSec: 4, Text: " English\n中文字幕 "}},
	}
	if err := validateComposeTaskInput(&input); err != nil {
		t.Fatal(err)
	}
	if input.Subtitles[0].Text != "English\n中文字幕" {
		t.Fatalf("subtitle was not normalized: %q", input.Subtitles[0].Text)
	}
	input.SubtitleStyle, input.SubtitleTiming = "soft_box", "speech"
	input.Subtitles[0].SecondaryText = " 翻译 "
	input.Subtitles[0].SpeechEndSec = 4
	if err := validateComposeTaskInput(&input); err != nil || input.Subtitles[0].SecondaryText != "翻译" {
		t.Fatalf("valid bilingual subtitle: %v", err)
	}
	input.SubtitleStyle = "unknown"
	if err := validateComposeTaskInput(&input); err == nil {
		t.Fatal("unknown style accepted")
	}
	input.SubtitleStyle = "clean"
	input.Subtitles[0].SpeechEndSec = 3
	if err := validateComposeTaskInput(&input); err == nil {
		t.Fatal("invalid speech window accepted")
	}
	input.Subtitles[0].SpeechEndSec = 4
	input.Subtitles[0].EndSec = 0
	if err := validateComposeTaskInput(&input); err == nil {
		t.Fatal("invalid subtitle timing accepted")
	}
}
