package main

import (
	"context"
	"encoding/binary"
	"math"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/starai/worker/internal/storage"
)

func TestComicNarrationTempoNeverSilentlyTruncates(t *testing.T) {
	for _, tc := range []struct {
		actual, allotted float64
		valid            bool
	}{{9.12, 8, true}, {15, 8, true}, {3, 8, true}, {8, 8, true}, {16, 8, false}, {0, 8, false}, {math.NaN(), 8, false}} {
		tempo, err := comicNarrationTempo(tc.actual, tc.allotted)
		if (err == nil) != tc.valid {
			t.Fatalf("%+v: tempo=%f error=%v", tc, tempo, err)
		}
		if err == nil && tc.actual/tempo > tc.allotted-0.079 {
			t.Fatal("audio would exceed its slot")
		}
		if tc.actual == 15 && (tempo <= 1.25 || tempo > maxComicNarrationTempo) {
			t.Fatalf("long dialogue was not automatically accelerated: %f", tempo)
		}
	}
}

func TestComicAudioSharesSpareTimeFromLatestFailedProject(t *testing.T) {
	video := []interface{}{map[string]interface{}{"id": "S01", "duration_sec": 6, "source_duration_sec": 8}, map[string]interface{}{"id": "S02", "duration_sec": 6, "source_duration_sec": 8}}
	audio := []interface{}{map[string]interface{}{"id": "S01", "actual_duration_sec": 4.64}, map[string]interface{}{"id": "S02", "actual_duration_sec": 7.68}}
	v, a, err := alignComicNarrationTimeline(video, audio)
	if err != nil {
		t.Fatal(err)
	}
	total := 0.0
	for i := range v {
		s := v[i].(map[string]interface{})
		voice := a[i].(map[string]interface{})
		duration := floatAny(s["duration_sec"])
		total += duration
		if duration != floatAny(voice["duration_sec"]) || duration > 8 || floatAny(voice["tempo"]) > 1.06 {
			t.Fatalf("unnecessary speed/cut: %#v %#v", s, voice)
		}
	}
	if math.Abs(total-12) > 0.00001 || floatAny(v[1].(map[string]interface{})["duration_sec"]) <= 7 {
		t.Fatalf("still split 6+6: %#v", v)
	}
	if video[0].(map[string]interface{})["duration_sec"] != 6 || audio[0].(map[string]interface{})["duration_sec"] != nil {
		t.Fatal("source checkpoints were changed")
	}
	audio[1].(map[string]interface{})["actual_duration_sec"] = 20
	if _, _, err := alignComicNarrationTimeline(video, audio); err == nil {
		t.Fatal("unfit speech must not be clipped")
	}
}

func TestComicNarrationKeepsTailAfterAutomaticAcceleration(t *testing.T) {
	ffmpeg, err := ffmpegBinaryPath()
	if err != nil {
		t.Skipf("ffmpeg unavailable: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	dir := t.TempDir()
	source, output := filepath.Join(dir, "source.wav"), filepath.Join(dir, "aligned.wav")
	// Sound exists only in the tail of a 15-second source. Fitting it into an
	// 8-second shot requires more than the old 1.25x limit and must keep the tail.
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", `aevalsrc=if(gte(t\,8.6)\,0.4*sin(2*PI*880*t)\,0):s=44100:d=15`, "-c:a", "pcm_s16le", source); err != nil {
		t.Fatal(err)
	}
	if err := normalizeComicNarration(ctx, source, output, 8); err != nil {
		t.Fatal(err)
	}
	duration, err := probeComicAudioDuration(ctx, output)
	if err != nil || math.Abs(duration-8) > 0.01 {
		t.Fatalf("target changed: %f %v", duration, err)
	}
	pcm, err := exec.CommandContext(ctx, ffmpeg, "-v", "error", "-ss", "7.5", "-i", output, "-t", "0.35", "-f", "s16le", "-ac", "1", "pipe:1").Output()
	if err != nil {
		t.Fatal(err)
	}
	peak := 0.0
	for i := 0; i+1 < len(pcm); i += 2 {
		peak = math.Max(peak, math.Abs(float64(int16(binary.LittleEndian.Uint16(pcm[i:i+2])))))
	}
	if peak < 1000 {
		t.Fatalf("ending audio was lost: peak=%f", peak)
	}
	// Exercise the whole compositor too, including concatenation, AAC muxing and
	// final target-duration calibration; these must not cut the recovered tail.
	server := httptest.NewServer(http.FileServer(http.Dir(dir)))
	defer server.Close()
	store, err := storage.NewLocal(dir, server.URL)
	if err != nil {
		t.Fatal(err)
	}
	previousStore := objectStore
	objectStore = store
	t.Cleanup(func() { objectStore = previousStore })
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", filepath.Join(dir, "video.mp4")); err != nil {
		t.Fatal(err)
	}
	film, message := composeComicDramaVideo(ctx, nil, "audio-tail-test", []map[string]interface{}{{"id": "S01", "duration_sec": 8}}, []interface{}{map[string]interface{}{"id": "S01", "video_url": server.URL + "/video.mp4"}}, []interface{}{map[string]interface{}{"id": "S01", "audio_url": server.URL + "/source.wav"}}, map[string]interface{}{"target_duration_sec": 8}, nil, "", "", WorkflowTaskPayload{})
	if message != "" {
		t.Fatal(message)
	}
	filmPath := filepath.Join(dir, filepath.FromSlash(store.ObjectKeyFromURL(stringAny(film["final_video_url"]))))
	if duration, err := probeComicAudioDuration(ctx, filmPath); err != nil || math.Abs(duration-8) > 0.1 {
		t.Fatalf("final duration=%f error=%v", duration, err)
	}
	pcm, err = exec.CommandContext(ctx, ffmpeg, "-v", "error", "-ss", "7.5", "-i", filmPath, "-t", "0.35", "-f", "s16le", "-ac", "1", "pipe:1").Output()
	if err != nil {
		t.Fatal(err)
	}
	peak = 0
	for i := 0; i+1 < len(pcm); i += 2 {
		peak = math.Max(peak, math.Abs(float64(int16(binary.LittleEndian.Uint16(pcm[i:i+2])))))
	}
	if peak < 1000 {
		t.Fatalf("final mux cut the ending: peak=%f", peak)
	}
	if err := normalizeComicNarration(ctx, source, filepath.Join(dir, "too_short.wav"), 4); err == nil {
		t.Fatal("extreme truncation must fail, not publish")
	}
}
