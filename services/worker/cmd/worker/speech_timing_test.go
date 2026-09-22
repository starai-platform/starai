package main

import (
	"context"
	"math"
	"path/filepath"
	"strings"
	"testing"
)

func TestTimedSpeechPreservesWordsAndRespectsSpeedLimit(t *testing.T) {
	if _, err := timedSpeechTempo(43, 20, 1.2, 1.5); err == nil || !strings.Contains(err.Error(), "28.67秒") {
		t.Fatalf("43-second speech must require shorter copy: %v", err)
	}
	if _, err := timedSpeechTempo(27, 20, 1.2, 1.2); err == nil {
		t.Fatal("fixed speed was silently increased")
	}
	if _, err := timedSpeechTempo(20, 20, 1.5, 1.2); err == nil {
		t.Fatal("invalid speed range accepted")
	}
	if _, err := ffmpegBinaryPath(); err != nil {
		t.Skip(err)
	}
	ctx := context.Background()
	dir := t.TempDir()
	source, output := filepath.Join(dir, "source.wav"), filepath.Join(dir, "timed.wav")
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=27", "-c:a", "pcm_s16le", source); err != nil {
		t.Fatal(err)
	}
	duration, tempo, err := normalizeTimedSpeech(ctx, source, output, 20, 1.2, 1.5, "wav")
	if err != nil || math.Abs(duration-20) > 0.1 || tempo < 1.2 || tempo > 1.5 || 27/tempo > 20 {
		t.Fatalf("duration=%v tempo=%v err=%v", duration, tempo, err)
	}
}
