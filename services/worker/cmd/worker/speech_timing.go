package main

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

func timedSpeechTempo(actual, target, rate, maximum float64) (float64, error) {
	if actual <= 0 || math.IsNaN(actual) || math.IsInf(actual, 0) || rate < 0.5 || maximum < rate || maximum > 2 || math.IsNaN(rate) || math.IsNaN(maximum) || target < 0 || target > 600 || math.IsNaN(target) {
		return 0, fmt.Errorf("配音时长或语速设置无效")
	}
	tempo := rate
	if target > 0 {
		tempo = math.Max(rate, actual/math.Max(0.1, target-0.08))
	}
	if tempo > maximum+0.001 {
		return 0, fmt.Errorf("配音原声实测%.2f秒，目标%.2f秒；按允许的最高%.2f倍仍需%.2f秒。请精简朗读正文后重新确认；原音频已保留，未截断内容", actual, target, maximum, actual/maximum)
	}
	return tempo, nil
}

func normalizeTimedSpeech(ctx context.Context, source, output string, target, rate, maximum float64, format string) (float64, float64, error) {
	actual, err := probeComicAudioDuration(ctx, source)
	if err != nil {
		return 0, 0, err
	}
	tempo, err := timedSpeechTempo(actual, target, rate, maximum)
	if err != nil {
		return actual, 0, err
	}
	filter := fmt.Sprintf("asetpts=PTS-STARTPTS,atempo=%.8f", tempo)
	args := []string{"-y", "-i", source, "-vn", "-af", filter}
	if target > 0 {
		args[len(args)-1] += ",apad"
		args = append(args, "-t", fmt.Sprintf("%.6f", target))
	}
	codec := "pcm_s16le"
	if format == "mp3" {
		codec = "libmp3lame"
	}
	args = append(args, "-c:a", codec, output)
	if err = runFFmpeg(ctx, args...); err != nil {
		return actual, tempo, err
	}
	duration, err := probeComicAudioDuration(ctx, output)
	if err == nil && target > 0 && math.Abs(duration-target) > 0.15 {
		err = fmt.Errorf("配音时长验收未通过：实测%.2f秒，目标%.2f秒", duration, target)
	}
	return duration, tempo, err
}

func finalizeTimedSpeech(ctx context.Context, taskNo, sourceURL string, settings map[string]interface{}, format string) (map[string]interface{}, error) {
	result := map[string]interface{}{"source_audio_url": sourceURL}
	dir, err := os.MkdirTemp("", "starai-speech-timing-*")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(dir)
	data, _, err := downloadAuthenticatedMedia(ctx, connectionConfig{}, sourceURL, 250<<20)
	if err != nil {
		return result, err
	}
	source := filepath.Join(dir, "source")
	if err = os.WriteFile(source, data, 0600); err != nil {
		return result, err
	}
	if format != "mp3" {
		format = "wav"
	}
	output := filepath.Join(dir, "result."+format)
	duration, tempo, err := normalizeTimedSpeech(ctx, source, output, floatAny(settings["duration"]), floatAny(settings["rate"]), floatAny(settings["max_rate"]), format)
	result["duration_seconds"], result["applied_speech_rate"] = duration, tempo
	if err != nil {
		return result, err
	}
	data, err = os.ReadFile(output)
	if err != nil {
		return result, err
	}
	if objectStore == nil {
		return result, fmt.Errorf("对象存储未启用，无法保存验收音频")
	}
	mime := "audio/wav"
	if format == "mp3" {
		mime = "audio/mpeg"
	}
	url, err := objectStore.Upload(ctx, "works/audio/"+taskNo+"/timed."+format, mime, bytes.NewReader(data), int64(len(data)))
	if err == nil {
		result["audio_url"] = url
	}
	return result, err
}
