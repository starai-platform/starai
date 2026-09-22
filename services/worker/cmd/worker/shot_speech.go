package main

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
)

// Finalize the speech clock before lip sync. Never stretch audio after this step.
func prepareShotSpeech(ctx context.Context, dir string, sources []composeSource, seconds int) (string, string, string, error) {
	var videos, audios []composeSource
	for _, source := range sources {
		switch source.Kind {
		case "video":
			videos = append(videos, source)
		case "audio":
			audios = append(audios, source)
		default:
			return "", "", "", fmt.Errorf("逐镜配音不支持图片")
		}
	}
	if len(videos) != 1 || seconds <= 0 || seconds > 600 {
		return "", "", "", fmt.Errorf("逐镜配音需要一个视频和1–600秒目标时长")
	}
	track := filepath.Join(dir, "speech.wav")
	if len(audios) == 0 {
		if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", strconv.Itoa(seconds), "-c:a", "pcm_s16le", track); err != nil {
			return "", "", "", err
		}
	} else {
		raw := filepath.Join(dir, "speech_raw.m4a")
		if err := concatAudioSources(ctx, dir, audios, raw); err != nil {
			return "", "", "", err
		}
		actual, err := probeComicAudioDuration(ctx, raw)
		if err != nil {
			return "", "", "", err
		}
		if actual > float64(seconds)+0.05 {
			return "", "", "", fmt.Errorf("本镜配音实际%.2f秒，超过镜头%d秒；请精简台词或延长镜头后重试，未截断台词或改变语速", actual, seconds)
		}
		if err := runFFmpeg(ctx, "-y", "-i", raw, "-af", "aresample=48000,asetpts=PTS-STARTPTS,apad", "-t", strconv.Itoa(seconds), "-ac", "2", "-c:a", "pcm_s16le", track); err != nil {
			return "", "", "", err
		}
	}
	return composeCanvasMedia(ctx, dir, []composeSource{videos[0], {Kind: "audio", Path: track}}, "mux", "keep", seconds)
}
