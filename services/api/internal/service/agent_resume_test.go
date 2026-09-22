package service

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/starai/api/internal/billing"
)

func comicResumeFixture() (map[string]interface{}, map[string]interface{}) {
	inputs := map[string]interface{}{"audio_strategy": "tts_only", "storyboard_grid": 2, "image_model_code": "old_image", "video_model_code": "old_video", "narration_model_code": "old_audio"}
	outputs := map[string]interface{}{
		"comic_drama": map[string]interface{}{"storyboards": []interface{}{
			map[string]interface{}{"id": "S01", "dialogue": "你好"}, map[string]interface{}{"id": "S02", "narration": "出发"},
		}},
		"keyframes":    []interface{}{map[string]interface{}{"id": "S01", "image_url": "one.jpg"}, map[string]interface{}{"id": "S02", "image_url": "two.jpg"}},
		"segments":     []interface{}{map[string]interface{}{"id": "S01", "video_url": "one.mp4"}, map[string]interface{}{"id": "S02", "video_url": "two.mp4"}},
		"narrations":   []interface{}{map[string]interface{}{"id": "S01", "audio_url": "one.wav"}, map[string]interface{}{"id": "S02", "audio_url": "two.wav"}},
		"current_step": "compose",
	}
	return inputs, outputs
}

func TestComicRemainingWork(t *testing.T) {
	inputs, outputs := comicResumeFixture()
	runtime := map[string]interface{}{"agent_mode": "comic_drama"}
	if got := remainingComicWork(inputs, outputs, runtime); got != (comicRemainingWork{}) {
		t.Fatal(got)
	}
	// No model/database lookup at all when only local composition remains.
	s := &AgentService{}
	if err := s.validateComicRemainingModels(context.Background(), inputs, comicRemainingWork{}); err != nil {
		t.Fatal(err)
	}
	if got := s.estimateComicRemainingCost(context.Background(), runtime, inputs, comicRemainingWork{}); got != 0 {
		t.Fatal(got)
	}
	outputs["segments"] = []interface{}{
		map[string]interface{}{"id": "S01", "video_url": "old.mp4"},
		map[string]interface{}{"id": "S01", "video_url": "old.mp4", "status": "failed"},
		map[string]interface{}{"id": "unrelated", "video_url": "other.mp4"},
	}
	if got := remainingComicWork(inputs, outputs, runtime); got != (comicRemainingWork{Videos: 2}) {
		t.Fatal(got)
	}
	outputs["narrations"] = nil
	if got := remainingComicWork(inputs, outputs, runtime); got.Narrations != 2 {
		t.Fatal(got)
	}
	inputs["audio_strategy"] = "video_native"
	if got := remainingComicWork(inputs, outputs, runtime); got.Narrations != 0 {
		t.Fatal(got)
	}
	outputs["final_video_url"], outputs["current_step"] = "final.mp4", "result"
	if got := remainingComicWork(inputs, outputs, runtime); got != (comicRemainingWork{}) {
		t.Fatal(got)
	}
	inputs["audio_strategy"] = "tts_only"
	if got := remainingComicWork(inputs, nil, runtime); got != (comicRemainingWork{Plan: true, Assets: 6, Images: 2, Videos: 2, Narrations: 2}) {
		t.Fatal(got)
	}
	inputs, outputs = comicResumeFixture()
	outputs["comic_drama"] = map[string]interface{}{"storyboards": []interface{}{map[string]interface{}{"id": "S01"}, map[string]interface{}{"id": "S02"}}}
	outputs["narrations"] = nil
	if got := remainingComicWork(inputs, outputs, runtime); got.Narrations != 0 {
		t.Fatalf("silent shots billed: %+v", got)
	}
	defaults := map[string]interface{}{"analysis_model_code": "new_chat", "image_model_code": "new_image", "video_model_code": "new_video"}
	fillComicResumeModelDefaults(inputs, defaults)
	if inputs["image_model_code"] != "old_image" || agentStringSlice(inputs["dialogue_model_codes"], nil)[0] != "new_chat" {
		t.Fatal(inputs)
	}
}

func TestComicResumeDatabaseBillingAndModels(t *testing.T) {
	pool := agentTestDatabase(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `
	 ALTER TABLE workflow_projects ADD id bigserial, ADD workflow_id bigint, ADD status text DEFAULT 'failed', ADD estimated_cost numeric DEFAULT 100, ADD actual_cost numeric DEFAULT 5, ADD outputs jsonb, ADD error_message text, ADD finished_at timestamptz, ADD updated_at timestamptz;
	 CREATE TABLE workflow_definitions(id bigint PRIMARY KEY,runtime_config jsonb,price_rule jsonb);
	 CREATE TABLE workflow_node_runs(project_id bigint,cost numeric);
	 CREATE TABLE models(code text PRIMARY KEY, category text, is_enabled boolean, price_rule jsonb);
	 CREATE TABLE wallets(user_id bigint PRIMARY KEY,compute_balance numeric DEFAULT 0,frozen_compute numeric DEFAULT 0,updated_at timestamptz);
	 CREATE TABLE balance_freezes(id bigserial,user_id bigint,amount numeric,ref_type text,ref_id text,status text,released_at timestamptz);
	 INSERT INTO workflow_definitions VALUES (1,'{"agent_mode":"comic_drama"}','{"billing_type":"per_request","unit_price":5}');
	 INSERT INTO models VALUES ('old_image','image',false,'{}'),('old_video','video',false,'{}'),('old_audio','audio',false,'{}'),('new_video','video',true,'{"billing_type":"per_second","unit_price":2}');
	 INSERT INTO wallets(user_id) VALUES (1);`)
	if err != nil {
		t.Fatal(err)
	}
	inputs, outputs := comicResumeFixture()
	inputs["segment_duration_sec"] = 6
	_, err = pool.Exec(ctx, `INSERT INTO workflow_projects(public_id,user_id,workflow_id,inputs,outputs) VALUES ('resume',1,1,$1,$2)`, mustAgentJSON(inputs), mustAgentJSON(outputs))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workflow_node_runs VALUES (1,5)`); err != nil {
		t.Fatal(err)
	}
	// An isolated rejecting endpoint exercises enqueue rollback without sending
	// fake projects to the real queue or invoking paid generation.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			_, _ = conn.Write([]byte("-ERR test queue disabled\r\n"))
			_ = conn.Close()
		}
	}()
	q := asynq.NewClient(asynq.RedisClientOpt{Addr: listener.Addr().String(), DialTimeout: time.Second, ReadTimeout: time.Second, WriteTimeout: time.Second})
	defer q.Close()
	s := &AgentService{db: pool, billing: billing.New(pool), queue: q}
	checkAudit := func(wantEstimate float64, wantVideos int) {
		t.Helper()
		var status, reason string
		var raw []byte
		if err := pool.QueryRow(ctx, `SELECT status,error_message,inputs FROM workflow_projects WHERE public_id='resume'`).Scan(&status, &reason, &raw); err != nil {
			t.Fatal(err)
		}
		var saved map[string]interface{}
		_ = json.Unmarshal(raw, &saved)
		remaining, _ := saved["_resume_remaining"].(map[string]interface{})
		if status != "failed" || reason != "重试入队失败" || floatValue(saved["_resume_estimated_cost"]) != wantEstimate || intFromAgentAny(remaining["videos"]) != wantVideos {
			t.Fatalf("did not reach enqueue with correct reservation: %s %s %s", status, reason, raw)
		}
		var frozen float64
		if err := pool.QueryRow(ctx, `SELECT frozen_compute FROM wallets WHERE user_id=1`).Scan(&frozen); err != nil || frozen != 0 {
			t.Fatalf("reservation leaked: %v %v", frozen, err)
		}
		var preserved bool
		if err := pool.QueryRow(ctx, `SELECT outputs=$1::jsonb AND (SELECT count(*) FROM workflow_node_runs)=1 FROM workflow_projects WHERE public_id='resume'`, mustAgentJSON(outputs)).Scan(&preserved); err != nil || !preserved {
			t.Fatalf("retry discarded checkpoints or node history: %v %v", preserved, err)
		}
	}
	if err := s.retryProject(ctx, 1, "resume", nil); err == nil {
		t.Fatal("expected controlled queue failure")
	}
	checkAudit(0, 0) // Zero balance and all old models disabled still reach compose enqueue.
	outputs["segments"] = []interface{}{map[string]interface{}{"id": "S01", "video_url": "one.mp4"}}
	if _, err := pool.Exec(ctx, `UPDATE workflow_projects SET outputs=$1`, mustAgentJSON(outputs)); err != nil {
		t.Fatal(err)
	}
	if err := s.retryProject(ctx, 1, "resume", nil); err == nil {
		t.Fatal("missing video accepted disabled model")
	}
	if _, err := pool.Exec(ctx, `UPDATE wallets SET compute_balance=100`); err != nil {
		t.Fatal(err)
	}
	if err := s.retryProject(ctx, 1, "resume", map[string]string{"video_model_code": "new_video"}); err == nil {
		t.Fatal("expected controlled queue failure")
	}
	checkAudit(12, 1) // One missing 6-second video, not the original whole-project 100.
	var amount float64
	if err := pool.QueryRow(ctx, `SELECT amount FROM balance_freezes ORDER BY id DESC LIMIT 1`).Scan(&amount); err != nil || amount != 12 {
		t.Fatalf("incorrect reservation: %v %v", amount, err)
	}
	_, outputs = comicResumeFixture()
	if _, err := pool.Exec(ctx, `UPDATE workflow_projects SET outputs=$1,actual_cost=0`, mustAgentJSON(outputs)); err != nil {
		t.Fatal(err)
	}
	if err := s.retryProject(ctx, 1, "resume", nil); err == nil {
		t.Fatal("expected controlled queue failure")
	}
	checkAudit(5, 0) // Historical unpaid usage, no repeat generation cost.
	if err := s.validateComicRemainingModels(ctx, map[string]interface{}{"image_model_code": "new_video", "video_model_code": "new_video"}, comicRemainingWork{Images: 1, Videos: 1}); err == nil {
		t.Fatal("same code hid wrong image category")
	}
}
