package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func comicNeedsLipSync(shot, inputs, runtime map[string]interface{}) (bool, error) {
	text, kind := comicStoryboardSpeech(shot, inputs, runtime)
	if text == "" || kind != "dialogue" {
		return false, nil
	}
	if stringAny(shot["narration"]) != "" {
		return false, fmt.Errorf("同一对白镜头不能混入旁白，请拆成不同分镜后继续")
	}
	if stringAny(shot["speaker_code"]) == "" {
		return false, fmt.Errorf("人物对白缺少 speaker_code，请确认单一说话人后继续")
	}
	return true, nil
}

func comicSyncModel(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var code string
	err := pool.QueryRow(ctx, `SELECT code FROM models WHERE code='video_sync_lipsync' AND is_enabled=true AND (runtime_rule->'lip_sync'->>'provider'='sync' OR runtime_rule->'lip_sync'->>'protocol' IN ('sync_v2','video_audio'))`).Scan(&code)
	if err != nil {
		return "", fmt.Errorf("人物对白需要口型同步，请在管理后台「系统配置 → 口型同步」配置并启用接口")
	}
	return code, nil
}

func comicLipSignature(video, audio []byte, model string) string {
	videoHash, audioHash := sha256.Sum256(video), sha256.Sum256(audio)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("comic-sync-v1:%s:%x:%x", model, videoHash, audioHash))))
}

// Use an actual finalized take, including native speech when there is no TTS.
// Matching successful tasks are reusable even if the later final concat failed.
func syncComicShot(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, publicID, modelCode, videoPath, audioPath, dir string, seconds float64) (string, error) {
	video, err := os.ReadFile(videoPath)
	if err != nil {
		return "", err
	}
	audio, err := os.ReadFile(audioPath)
	if err != nil {
		return "", err
	}
	var upstreamModel string
	if err = pool.QueryRow(ctx, `SELECT new_api_model FROM models WHERE code=$1 AND is_enabled=true`, modelCode).Scan(&upstreamModel); err != nil {
		return "", err
	}
	signature := comicLipSignature(video, audio, modelCode+":"+upstreamModel)
	var taskNo string
	err = pool.QueryRow(ctx, `SELECT task_no FROM tasks WHERE user_id=$1 AND input->>'_workflow_project'=$2 AND input->>'lip_sync_signature'=$3 AND status IN ('pending','running','succeeded') ORDER BY id DESC LIMIT 1`, p.UserID, publicID, signature).Scan(&taskNo)
	var result map[string]interface{}
	if err == nil {
		result = loadAgentMediaTask(ctx, pool, taskNo)
		if stringAny(result["status"]) != "succeeded" {
			return "", fmt.Errorf("已有口型同步任务 %s 正在处理，请稍后继续，未重复提交", taskNo)
		}
	} else if err != pgx.ErrNoRows {
		return "", err
	} else {
		videoURL, uploadErr := objectStore.Upload(ctx, fmt.Sprintf("works/video/%s/lipsync/%s.mp4", publicID, signature), "video/mp4", bytes.NewReader(video), int64(len(video)))
		if uploadErr != nil {
			return "", uploadErr
		}
		audioURL, uploadErr := objectStore.Upload(ctx, fmt.Sprintf("works/video/%s/lipsync/%s.wav", publicID, signature), "audio/wav", bytes.NewReader(audio), int64(len(audio)))
		if uploadErr != nil {
			return "", uploadErr
		}
		results, message := runAgentMediaTasks(ctx, pool, baseURL, token, p.ProjectID, p.UserID, publicID,
			map[string]interface{}{"generation_model_code": modelCode, "generation_type": "video"},
			map[string]interface{}{"count": 1, "duration": seconds, "lip_sync_signature": signature, "input": []interface{}{map[string]interface{}{"type": "video", "url": videoURL}, map[string]interface{}{"type": "audio", "url": audioURL}}}, "")
		if message != "" {
			return "", fmt.Errorf("口型同步失败：%s", message)
		}
		if len(results) != 1 {
			return "", fmt.Errorf("口型同步未返回唯一视频")
		}
		result = results[0]
	}
	output := mapAnyOr(result["output"], nil)
	address := firstMediaURL(output, "video_url", "url", "result_url")
	if address == "" {
		return "", fmt.Errorf("口型同步未返回视频，未跳过处理")
	}
	data, _, err := downloadAuthenticatedMedia(ctx, connectionConfig{}, address, 600<<20)
	if err != nil {
		return "", err
	}
	synced := filepath.Join(dir, "synced.mp4")
	if err = os.WriteFile(synced, data, 0600); err != nil {
		return "", err
	}
	actual, err := probeComicAudioDuration(ctx, synced)
	if err != nil || math.Abs(actual-seconds) > 0.1 {
		return "", fmt.Errorf("同步结果时长与本镜不一致，未变速或裁剪")
	}
	wantW, wantH := probeMediaDimensions(ctx, videoPath)
	gotW, gotH := probeMediaDimensions(ctx, synced)
	if wantW != gotW || wantH != gotH {
		return "", fmt.Errorf("同步结果画幅发生变化，已停止合成")
	}
	return muxLockedComicSpeech(ctx, synced, audioPath, filepath.Join(dir, "locked.mp4"))
}

func muxLockedComicSpeech(ctx context.Context, video, audio, output string) (string, error) {
	err := runFFmpeg(ctx, "-y", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest", "-movflags", "+faststart", output)
	return output, err
}

func prepareComicShotAudio(ctx context.Context, normalizedVideo, speechSource, output string, seconds float64, native bool) error {
	if speechSource != "" {
		return normalizeComicNarration(ctx, speechSource, output, seconds)
	}
	if native {
		return runFFmpeg(ctx, "-y", "-i", normalizedVideo, "-vn", "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2", output)
	}
	return runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", strconv.FormatFloat(seconds, 'f', 6, 64), "-c:a", "pcm_s16le", output)
}
