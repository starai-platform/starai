package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestComposeOutputDimensionsKeepUsesSource(t *testing.T) {
	width, height := composeOutputDimensions("keep")
	if width != 0 || height != 0 {
		t.Fatalf("keep dimensions = %dx%d, want source dimensions marker", width, height)
	}
	width, height = composeOutputDimensions("1080x1920")
	if width != 1080 || height != 1920 {
		t.Fatalf("explicit dimensions = %dx%d", width, height)
	}
}

func TestComposePreservesNativeAudioAlongsideSilentShots(t *testing.T) {
	binary, err := ffmpegBinaryPath()
	if err != nil {
		t.Skipf("ffmpeg unavailable: %v", err)
	}
	ctx := context.Background()
	dir := t.TempDir()
	voiced, silent := filepath.Join(dir, "voiced.mp4"), filepath.Join(dir, "silent.mp4")
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", voiced); err != nil {
		t.Fatal(err)
	}
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent); err != nil {
		t.Fatal(err)
	}
	output, _, _, err := composeCanvasMedia(ctx, dir, []composeSource{{Kind: "video", Path: voiced}, {Kind: "video", Path: silent}}, "concat", "keep", 2)
	if err != nil || !mediaHasAudio(ctx, output) {
		t.Fatalf("lost native audio: %v", err)
	}
	pcm, err := exec.CommandContext(ctx, binary, "-v", "error", "-i", output, "-t", "0.5", "-vn", "-f", "s16le", "-").Output()
	if err != nil {
		t.Fatal(err)
	}
	for _, sample := range pcm {
		if sample != 0 {
			return
		}
	}
	t.Fatal("native tone was replaced with silence")
}

func TestComposeCanvasMediaRejectsInvalidModeInputsBeforeFFmpeg(t *testing.T) {
	_, _, _, err := composeCanvasMedia(
		context.Background(),
		t.TempDir(),
		[]composeSource{
			{Kind: "video", Path: "video.mp4"},
			{Kind: "audio", Path: "audio.mp3"},
		},
		"concat",
		"keep",
	)
	if err == nil || !strings.Contains(err.Error(), "同类型") {
		t.Fatalf("expected mixed concat validation error, got %v", err)
	}

	_, _, _, err = composeCanvasMedia(
		context.Background(),
		t.TempDir(),
		[]composeSource{{Kind: "image", Path: "image.png"}, {Kind: "video", Path: "video.mp4"}},
		"auto",
		"keep",
	)
	if err == nil || !strings.Contains(err.Error(), "图片不能") {
		t.Fatalf("expected ignored image validation error, got %v", err)
	}
}

func TestComposeCanvasMediaAutoConcatsVideosAndMuxesAudio(t *testing.T) {
	if _, err := ffmpegBinaryPath(); err != nil {
		t.Skipf("ffmpeg unavailable: %v", err)
	}
	ctx := context.Background()
	tmpDir := t.TempDir()
	firstVideo := filepath.Join(tmpDir, "first.mp4")
	secondVideo := filepath.Join(tmpDir, "second.mp4")
	audioTrack := filepath.Join(tmpDir, "source.m4a")
	for _, item := range []struct {
		path  string
		color string
	}{{firstVideo, "red"}, {secondVideo, "blue"}} {
		if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c="+item.color+":s=160x90:d=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", item.path); err != nil {
			t.Fatalf("create fixture video: %v", err)
		}
	}
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", audioTrack); err != nil {
		t.Fatalf("create fixture audio: %v", err)
	}

	outputPath, kind, contentType, err := composeCanvasMedia(ctx, tmpDir, []composeSource{
		{Kind: "video", Path: firstVideo},
		{Kind: "video", Path: secondVideo},
		{Kind: "audio", Path: audioTrack},
	}, "auto", "keep")
	if err != nil {
		t.Fatalf("compose video remake output: %v", err)
	}
	if kind != "video" || contentType != "video/mp4" {
		t.Fatalf("output = %s %s, want video video/mp4", kind, contentType)
	}
	info, err := os.Stat(outputPath)
	if err != nil || info.Size() == 0 {
		t.Fatalf("missing composed output: %v", err)
	}
	if !mediaHasAudio(ctx, outputPath) {
		t.Fatal("composed video is missing the source audio track")
	}
	// A target duration must preserve both clips, extending short clips instead
	// of dropping later shots or returning the sum of provider defaults.
	outputPath, _, _, err = composeCanvasMedia(ctx, tmpDir, []composeSource{
		{Kind: "video", Path: firstVideo}, {Kind: "video", Path: secondVideo},
		{Kind: "audio", Path: audioTrack},
	}, "auto", "keep", 2)
	if err != nil {
		t.Fatal(err)
	}
	duration, err := probeComicAudioDuration(ctx, outputPath)
	if err != nil || duration < 1.9 || duration > 2.1 {
		t.Fatalf("target duration: got %v, err %v", duration, err)
	}
}

func TestComposeSubtitleHelpersAndBurnIn(t *testing.T) {
	if got := assText("A{B}\n中文字幕"); got != `A\{B\}\N中文字幕` {
		t.Fatalf("escaped subtitle = %q", got)
	}
	if got := wrapSubtitleText("如果你正在关注英伟达股票你一定清楚人工智能需求正在重塑科技市场走势"); strings.Contains(got, "\n") {
		t.Fatalf("Chinese words must not be hard-sliced: %q", got)
	}
	cues, err := parseComposeSubtitles([]map[string]interface{}{{"start_sec": 0, "end_sec": 1.5, "text": "Hello"}})
	if err != nil || len(cues) != 1 || assTime(cues[0].EndSec) != "0:00:01.50" {
		t.Fatalf("parsed cues = %#v, err %v", cues, err)
	}
	if _, err := ffmpegBinaryPath(); err != nil {
		t.Skipf("ffmpeg unavailable: %v", err)
	}
	ctx := context.Background()
	dir := t.TempDir()
	source := filepath.Join(dir, "source.mp4")
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", source); err != nil {
		t.Fatal(err)
	}
	output, count, err := burnComposeSubtitles(ctx, dir, source, []map[string]interface{}{{"start_sec": 0, "end_sec": 2, "text": "English\n中文字幕"}})
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(output)
	if err != nil || info.Size() == 0 || count != 1 || output == source {
		t.Fatalf("burn output=%q count=%d info=%v err=%v", output, count, info, err)
	}
}
