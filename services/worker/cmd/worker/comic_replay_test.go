package main

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/worker/internal/storage"
)

// Opt-in replay of an explicitly selected local project. Reads SQL and existing
// media only. Outputs a separate local artifact; no queue, billing or model call.
func TestComicExistingMaterialReplay(t *testing.T) {
	project, dir, dsn := os.Getenv("AGENT_COMPOSE_REPLAY_PROJECT"), os.Getenv("AGENT_COMPOSE_REPLAY_DIR"), os.Getenv("AGENT_DRAFT_TEST_DATABASE_URL")
	if project == "" || dir == "" || dsn == "" {
		t.Skip("set explicit project, output directory and local test DB")
	}
	if !filepath.IsAbs(dir) {
		t.Fatal("output directory must be absolute")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var inRaw, outRaw []byte
	if err := pool.QueryRow(ctx, `SELECT inputs,outputs FROM workflow_projects WHERE public_id=$1`, project).Scan(&inRaw, &outRaw); err != nil {
		t.Fatal(err)
	}
	inputs, outputs := map[string]interface{}{}, map[string]interface{}{}
	if err := json.Unmarshal(inRaw, &inputs); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(outRaw, &outputs); err != nil {
		t.Fatal(err)
	}
	plan, _ := outputs["comic_drama"].(map[string]interface{})
	shots := comicStoryboards(plan, nil)
	segments, _ := outputs["segments"].([]interface{})
	voices, _ := outputs["narrations"].([]interface{})
	if !comicStageComplete(segments, shots, "video_url") || !comicNarrationStageComplete(voices, shots) {
		t.Fatal("missing materials: replay will not generate anything")
	}
	local, err := storage.NewLocal(dir, "http://localhost/replay")
	if err != nil {
		t.Fatal(err)
	}
	old := objectStore
	objectStore = local
	t.Cleanup(func() { objectStore = old })
	final, message := composeComicDramaVideo(ctx, pool, project, shots, segments, voices, inputs, nil, "", "", WorkflowTaskPayload{})
	if message != "" {
		t.Fatal(message)
	}
	path := filepath.Join(dir, filepath.FromSlash(local.ObjectKeyFromURL(stringAny(final["final_video_url"]))))
	duration, err := probeComicAudioDuration(ctx, path)
	if err != nil || math.Abs(duration-float64(intAny(inputs["target_duration_sec"]))) > 0.1 || !mediaHasAudio(ctx, path) {
		t.Fatalf("invalid film: duration=%f error=%v", duration, err)
	}
	encoded, _ := json.Marshal(final["audio_alignment"])
	t.Logf("REPLAY_FILE=%s\nDURATION=%.3f\nAUDIO_ALIGNMENT=%s", path, duration, encoded)
}
