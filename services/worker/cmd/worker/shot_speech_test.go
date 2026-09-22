package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSyncPollDoesNotReturnEchoedInputs(t *testing.T) {
	items, id := parseUpstreamMedia([]byte(`{"id":"sync-1","status":"PENDING","input":[{"type":"video","url":"https://example.com/original.mp4"}]}`))
	if len(items) != 0 || id != "sync-1" {
		t.Fatalf("creation response: %v %s", items, id)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/generate/sync-1" {
			t.Errorf("path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"sync-1","status":"COMPLETED","outputUrl":"https://example.com/synced.mp4"}`))
	}))
	defer server.Close()
	items, _, err := pollUpstreamTask(context.Background(), nil, connectionConfig{BaseURL: server.URL, AuthType: "none"}, pollConfig{Path: "/v2/generate/{id}", Interval: time.Millisecond, Timeout: time.Second}, id, "")
	if err != nil || len(items) != 1 || items[0].URL != "https://example.com/synced.mp4" {
		t.Fatalf("poll: %v %v", items, err)
	}
}

func TestShotSpeechPadsSilenceAndRejectsOverflow(t *testing.T) {
	if _, err := ffmpegBinaryPath(); err != nil {
		t.Skip(err)
	}
	ctx := context.Background()
	dir := t.TempDir()
	video := filepath.Join(dir, "input.mp4")
	audio := filepath.Join(dir, "voice.wav")
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=1", "-c:v", "libx264", video); err != nil {
		t.Fatal(err)
	}
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", audio); err != nil {
		t.Fatal(err)
	}
	for _, withVoice := range []bool{false, true} {
		shotDir := filepath.Join(dir, map[bool]string{true: "voiced", false: "silent"}[withVoice])
		if err := os.Mkdir(shotDir, 0700); err != nil {
			t.Fatal(err)
		}
		sources := []composeSource{{Kind: "video", Path: video}}
		if withVoice {
			sources = append(sources, composeSource{Kind: "audio", Path: audio})
		}
		output, _, _, err := composeCanvasMedia(ctx, shotDir, sources, "speech", "keep", 1)
		if err != nil {
			t.Fatal(err)
		}
		duration, err := probeComicAudioDuration(ctx, output)
		if err != nil || duration < 0.95 || duration > 1.1 || !mediaHasAudio(ctx, output) {
			t.Fatalf("output duration/audio %f %v", duration, err)
		}
	}
	// A silent first shot must not remove the following voice or move it earlier.
	joined, _, _, err := composeCanvasMedia(ctx, dir, []composeSource{
		{Kind: "video", Path: filepath.Join(dir, "silent", "result.mp4")},
		{Kind: "video", Path: filepath.Join(dir, "voiced", "result.mp4")},
	}, "auto", "keep")
	if err != nil {
		t.Fatal(err)
	}
	ffmpeg, _ := ffmpegBinaryPath()
	pcm, err := exec.CommandContext(ctx, ffmpeg, "-v", "error", "-i", joined, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1").Output()
	if err != nil || len(pcm) < 30000 {
		t.Fatalf("decode joined speech: %v", err)
	}
	energy := func(data []byte) int64 {
		var sum int64
		for i := 0; i+1 < len(data); i += 2 {
			value := int64(int16(uint16(data[i]) | uint16(data[i+1])<<8))
			sum += value * value
		}
		return sum
	}
	if energy(pcm[:14000]) != 0 || energy(pcm[17000:19500]) == 0 {
		t.Fatal("voice was lost or moved into the silent shot")
	}
	_, _, _, err = composeCanvasMedia(ctx, dir, []composeSource{{Kind: "video", Path: video}, {Kind: "audio", Path: audio}}, "synced", "keep", 2)
	if err == nil || !strings.Contains(err.Error(), "时长") {
		t.Fatalf("changed sync duration accepted: %v", err)
	}
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", audio); err != nil {
		t.Fatal(err)
	}
	_, _, _, err = composeCanvasMedia(ctx, dir, []composeSource{{Kind: "video", Path: video}, {Kind: "audio", Path: audio}}, "speech", "keep", 1)
	if err == nil || !strings.Contains(err.Error(), "超过") {
		t.Fatalf("overflow must fail: %v", err)
	}
}
