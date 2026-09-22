package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestComicLipSyncRouting(t *testing.T) {
	for _, test := range []struct {
		shot map[string]interface{}
		want bool
		bad  bool
	}{
		{map[string]interface{}{"narration": "画外解说"}, false, false},
		{map[string]interface{}{}, false, false},
		{map[string]interface{}{"dialogue": "你好", "speaker_code": "CHAR_01"}, true, false},
		{map[string]interface{}{"dialogue": "你好"}, false, true},
		{map[string]interface{}{"dialogue": "你好", "speaker_code": "CHAR_01", "narration": "旁白"}, false, true},
	} {
		got, err := comicNeedsLipSync(test.shot, nil, nil)
		if got != test.want || (err != nil) != test.bad {
			t.Fatalf("routing %v: %v %v", test.shot, got, err)
		}
	}
	a := comicLipSignature([]byte("video"), []byte("speech"), "sync-3")
	if a != comicLipSignature([]byte("video"), []byte("speech"), "sync-3") {
		t.Fatal("unchanged take must reuse checkpoint")
	}
	for _, b := range []string{comicLipSignature([]byte("other"), []byte("speech"), "sync-3"), comicLipSignature([]byte("video"), []byte("new voice"), "sync-3"), comicLipSignature([]byte("video"), []byte("speech"), "other-model")} {
		if a == b {
			t.Fatal("changed video/audio/model reused stale lip sync")
		}
	}
}

func TestComicSyncReusesFinishedTask(t *testing.T) {
	dsn := os.Getenv("SYNC_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SYNC_TEST_DATABASE_URL for isolated cached-task regression")
	}
	if _, err := ffmpegBinaryPath(); err != nil {
		t.Skip(err)
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("comic_sync_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `CREATE TABLE models(code text,new_api_model text,is_enabled boolean);
	INSERT INTO models VALUES('video_sync_lipsync','sync-3',true);
	CREATE TABLE tasks(id bigserial,task_no text,user_id bigint,input jsonb,status text,output jsonb,error_message text,estimated_cost numeric,actual_cost numeric);`)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	videoPath := filepath.Join(dir, "synced.mp4")
	audioPath := filepath.Join(dir, "voice.wav")
	if err = runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=1", "-c:v", "libx264", videoPath); err != nil {
		t.Fatal(err)
	}
	if err = runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", audioPath); err != nil {
		t.Fatal(err)
	}
	video, _ := os.ReadFile(videoPath)
	audio, _ := os.ReadFile(audioPath)
	signature := comicLipSignature(video, audio, "video_sync_lipsync:sync-3")
	server := httptest.NewServer(http.FileServer(http.Dir(dir)))
	defer server.Close()
	input, _ := json.Marshal(map[string]interface{}{"_workflow_project": "comic-test", "lip_sync_signature": signature})
	output, _ := json.Marshal(map[string]interface{}{"video_url": server.URL + "/synced.mp4"})
	_, err = pool.Exec(ctx, `INSERT INTO tasks(task_no,user_id,input,status,output,estimated_cost,actual_cost) VALUES('sync-done',42,$1,'succeeded',$2,1,1)`, input, output)
	if err != nil {
		t.Fatal(err)
	}
	outDir := filepath.Join(dir, "result")
	if err = os.Mkdir(outDir, 0700); err != nil {
		t.Fatal(err)
	}
	// No objectStore or real provider configured: only the persisted task can work.
	path, err := syncComicShot(ctx, pool, "", "", WorkflowTaskPayload{UserID: 42}, "comic-test", "video_sync_lipsync", videoPath, audioPath, outDir, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !mediaHasAudio(ctx, path) {
		t.Fatal("recovered result lost the locked voice")
	}
	if _, err = pool.Exec(ctx, `UPDATE tasks SET status='running'`); err != nil {
		t.Fatal(err)
	}
	_, err = syncComicShot(ctx, pool, "", "", WorkflowTaskPayload{UserID: 42}, "comic-test", "video_sync_lipsync", videoPath, audioPath, outDir, 1)
	if err == nil || !strings.Contains(err.Error(), "未重复提交") {
		t.Fatalf("pending task duplicated: %v", err)
	}
}

func TestComicLockedSpeechPreservesDuration(t *testing.T) {
	if _, err := ffmpegBinaryPath(); err != nil {
		t.Skip(err)
	}
	ctx := context.Background()
	dir := t.TempDir()
	video := filepath.Join(dir, "video.mp4")
	voice := filepath.Join(dir, "voice.wav")
	locked := filepath.Join(dir, "locked.wav")
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=2", "-c:v", "libx264", video); err != nil {
		t.Fatal(err)
	}
	if err := runFFmpeg(ctx, "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", voice); err != nil {
		t.Fatal(err)
	}
	if err := prepareComicShotAudio(ctx, video, voice, locked, 2, false); err != nil {
		t.Fatal(err)
	}
	output, err := muxLockedComicSpeech(ctx, video, locked, filepath.Join(dir, "out.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	duration, err := probeComicAudioDuration(ctx, output)
	if err != nil || math.Abs(duration-2) > 0.1 {
		t.Fatalf("duration drift: %f %v", duration, err)
	}
	if !mediaHasAudio(ctx, output) {
		t.Fatal("final speech missing")
	}
	if err := prepareComicShotAudio(ctx, output, "", filepath.Join(dir, "native.wav"), 2, true); err != nil {
		t.Fatal(err)
	}
}
