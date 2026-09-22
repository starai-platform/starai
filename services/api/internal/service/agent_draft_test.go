package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAgentSlotsValidateAndRequireEvidenceForReplacement(t *testing.T) {
	d := &AgentDraft{Version: 2, Slots: map[string]interface{}{"character": "Alice", "target_duration_sec": 15}}
	if err := ApplyAgentSlotUpdates(d, map[string]interface{}{"character": "Bob", "style": "写实"}, nil, "改成22秒"); err != nil {
		t.Fatal(err)
	}
	if d.Slots["character"] != "Alice" || d.Slots["style"] != "写实" {
		t.Fatal(d.Slots)
	}
	if err := ApplyAgentSlotUpdates(d, map[string]interface{}{"character": "Bob"}, map[string]interface{}{"character": "角色改成Bob"}, "角色改成Bob"); err != nil {
		t.Fatal(err)
	}
	if d.Slots["character"] != "Bob" || d.Sources["character"].Source != "user" {
		t.Fatal(d.Slots)
	}
	for _, update := range []map[string]interface{}{{"confirmed": true}, {"model_code": "injected"}, {"target_duration_sec": 999}, {"target_duration_sec": 15.5}, {"image_count": 0}, {"image_count": 7}, {"use_previous_media": "true"}, {"aspect_ratio": "wrong"}} {
		if err := ApplyAgentSlotUpdates(d, update, nil, "test"); err == nil {
			t.Fatalf("invalid slot accepted: %v", update)
		}
	}
	if err := ApplyAgentSlotUpdates(d, map[string]interface{}{"image_count": 4, "platform": "小红书"}, map[string]interface{}{"image_count": "4张", "platform": "小红书"}, "小红书生成4张配图"); err != nil {
		t.Fatalf("valid content image slots rejected: %v", err)
	}
	if err := ApplyAgentSlotUpdates(d, map[string]interface{}{"style": "changed", "unknown": true}, map[string]interface{}{"style": "changed"}, "changed"); err == nil {
		t.Fatal("invalid update accepted")
	}
	if d.Slots["style"] != "写实" {
		t.Fatal("invalid update partially applied")
	}
}

// Opt-in integration test. A unique temporary schema isolates all data; the
// real migration and production CAS methods run without invoking any model.
func agentTestDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("AGENT_DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set AGENT_DRAFT_TEST_DATABASE_URL for isolated database regression")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := fmt.Sprintf("agent_draft_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") })
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	_, err = pool.Exec(ctx, `CREATE TABLE conversations(public_id text PRIMARY KEY,user_id bigint,updated_at timestamptz DEFAULT now());
	 CREATE TABLE tasks(task_no text,user_id bigint,input jsonb);
	 CREATE TABLE workflow_projects(public_id text,user_id bigint,inputs jsonb);`)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "infra", "migrations", "099_creative_agent_draft.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	return pool
}

func TestAgentDraftDatabaseConfirmationLifecycle(t *testing.T) {
	pool := agentTestDatabase(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id) VALUES ('conv_test',1)`); err != nil {
		t.Fatal(err)
	}
	s := &ChatService{db: pool}
	d, err := s.BeginAgentDraftTurn(ctx, 1, "conv_test", 0)
	if err != nil {
		t.Fatal(err)
	}
	d.Slots = map[string]interface{}{"script": "keep script", "character": "Alice", "target_duration_sec": 15}
	d.Status = "awaiting_confirmation"
	d.Plan = map[string]interface{}{"intent": "video", "prompt": "keep script"}
	if err = s.SaveAgentDraft(ctx, 1, "conv_test", d); err != nil {
		t.Fatal(err)
	}
	if _, err = s.GetAgentDraft(ctx, 2, "conv_test"); err == nil {
		t.Fatal("cross-user read allowed")
	}
	if err = s.ClaimAgentDraft(ctx, 2, "conv_test", 1); err == nil {
		t.Fatal("cross-user confirmation allowed")
	}
	d2, err := s.BeginAgentDraftTurn(ctx, 1, "conv_test", 1)
	if err != nil {
		t.Fatal(err)
	}
	d2.SetSlot("target_duration_sec", 22, "user", "改成22秒")
	d2.Status = "awaiting_confirmation"
	d2.Plan = map[string]interface{}{"intent": "workflow", "prompt": "keep script"}
	if err = s.SaveAgentDraft(ctx, 1, "conv_test", d2); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveAgentDraft(ctx, 1, "conv_test", d); err == nil {
		t.Fatal("stale LLM reply overwrote newer plan")
	}
	if err = s.ClaimAgentDraft(ctx, 1, "conv_test", 1); err == nil {
		t.Fatal("old version confirmed")
	}
	if err = s.CancelAgentDraft(ctx, 1, "conv_test", 2); err != nil {
		t.Fatal(err)
	}
	if err = s.ClaimAgentDraft(ctx, 1, "conv_test", 2); err == nil {
		t.Fatal("cancelled version confirmed")
	}
	d4, err := s.BeginAgentDraftTurn(ctx, 1, "conv_test", 3)
	if err != nil {
		t.Fatal(err)
	}
	d4.Status = "awaiting_confirmation"
	d4.Plan = map[string]interface{}{"intent": "workflow"}
	if err = s.SaveAgentDraft(ctx, 1, "conv_test", d4); err != nil {
		t.Fatal(err)
	}
	var winners atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 16; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if s.ClaimAgentDraft(ctx, 1, "conv_test", 4) == nil {
				winners.Add(1)
			}
		}()
	}
	group.Wait()
	if winners.Load() != 1 {
		t.Fatalf("%d concurrent executions admitted", winners.Load())
	}
	if _, err = s.BeginAgentDraftTurn(ctx, 1, "conv_test", 4); err == nil {
		t.Fatal("uncertain execution allowed a replacement task")
	}
	marker, _ := json.Marshal(map[string]interface{}{"_agent_confirmation": AgentConfirmationKey("conv_test", 4)})
	if _, err = pool.Exec(ctx, `INSERT INTO tasks VALUES ('task_existing',1,$1)`, marker); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO tasks VALUES ('task_duplicate',1,$1)`, marker); err == nil {
		t.Fatal("database idempotency index not enforced")
	}
	restored, err := (&ChatService{db: pool}).GetAgentDraft(ctx, 1, "conv_test")
	if err != nil {
		t.Fatal(err)
	}
	if restored.Status != "submitted" || restored.ExecutionRef != "task_existing" || restored.Slots["script"] != "keep script" || restored.Slots["target_duration_sec"] != float64(22) {
		t.Fatalf("bad recovery: %#v", restored)
	}
	if err = s.ClaimAgentDraft(ctx, 1, "conv_test", 4); err == nil {
		t.Fatal("lost HTTP response caused duplicate execution")
	}
}

func TestAgentDraftDatabaseInterruptedSubmission(t *testing.T) {
	pool := agentTestDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s := &ChatService{db: pool}
	start := func(id string) {
		t.Helper()
		d := AgentDraft{Version: 1, Status: "executing", Slots: map[string]interface{}{"script": "保留已确认文案"}, Plan: map[string]interface{}{"prompt": "保留提示词", "plan_version": 1}}
		d.Init()
		raw, _ := json.Marshal(d)
		if _, err := pool.Exec(ctx, `INSERT INTO conversations(public_id,user_id,agent_state) VALUES ($1,1,$2)`, id, raw); err != nil {
			t.Fatal(err)
		}
	}
	age := func(id string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `UPDATE conversations SET updated_at=now()-interval '6 minutes' WHERE public_id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	start("conv_stale")
	d, err := s.GetAgentDraft(ctx, 1, "conv_stale")
	if err != nil || d.Status != "executing" || d.Version != 1 {
		t.Fatalf("fresh submission reset: %#v %v", d, err)
	}
	age("conv_stale")
	d, err = s.GetAgentDraft(ctx, 1, "conv_stale")
	if err != nil || d.Status != "awaiting_confirmation" || d.Version != 2 || d.Slots["script"] != "保留已确认文案" || d.Error == "" || d.Plan["plan_version"] != int64(2) {
		t.Fatalf("interrupted submission not recovered: %#v %v", d, err)
	}
	if err := s.CompleteAgentDraft(ctx, 1, "conv_stale", 1, "generation", "late_task", ""); err != nil {
		t.Fatal(err)
	}
	d, _ = s.GetAgentDraft(ctx, 1, "conv_stale")
	if d.ExecutionRef != "" || d.Version != 2 {
		t.Fatal("late old completion replaced recovered draft")
	}
	for _, tc := range []struct {
		user   int64
		marker string
	}{{1, "conv_stale:1"}, {1, "conv_stale:2"}, {2, "conv_stale:2"}, {1, "invalid"}} {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		err = validateAgentSubmissionTx(ctx, tx, tc.user, map[string]interface{}{"_agent_confirmation": tc.marker})
		_ = tx.Rollback(ctx)
		if err == nil {
			t.Fatalf("unconfirmed/stale/foreign submission accepted: %+v", tc)
		}
	}
	if err := s.ClaimAgentDraft(ctx, 1, "conv_stale", 2); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateAgentSubmissionTx(ctx, tx, 1, map[string]interface{}{"_agent_confirmation": "conv_stale:2"}); err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback(ctx)

	// Insertion wins the row lock: recovery must wait, then return that task.
	start("conv_race")
	age("conv_race")
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := validateAgentSubmissionTx(ctx, tx, 1, map[string]interface{}{"_agent_confirmation": "conv_race:1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO workflow_projects VALUES ('workflow_race',1,'{"_agent_confirmation":"conv_race:1"}')`); err != nil {
		t.Fatal(err)
	}
	type result struct {
		draft *AgentDraft
		err   error
	}
	finished := make(chan result, 1)
	go func() { d, err := s.GetAgentDraft(ctx, 1, "conv_race"); finished <- result{d, err} }()
	select {
	case got := <-finished:
		t.Fatalf("recovery bypassed insertion lock: %+v", got)
	case <-time.After(50 * time.Millisecond):
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	got := <-finished
	if got.err != nil || got.draft.Status != "submitted" || got.draft.ExecutionRef != "workflow_race" || got.draft.Version != 1 {
		t.Fatalf("committed submission not recovered: %+v", got)
	}
}
