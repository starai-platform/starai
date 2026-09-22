package main

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestComicParallelStagePreservesOrderCostsAndConcurrency(t *testing.T) {
	var active, peak atomic.Int32
	items, cost, message := comicParallelStage(context.Background(), 6, 2, func(index int) ([]map[string]interface{}, float64, string) {
		n := active.Add(1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		defer active.Add(-1)
		time.Sleep(time.Duration(6-index) * time.Millisecond)
		return []map[string]interface{}{{"id": fmt.Sprint(index)}}, float64(index + 1), ""
	}, func(items []map[string]interface{}) {
		previous := -1
		for _, item := range items {
			index := intAny(item["id"])
			if index <= previous {
				t.Fatal("checkpoint out of order", items)
			}
			previous = index
		}
	})
	if peak.Load() != 2 || cost != 21 || message != "" || len(items) != 6 {
		t.Fatalf("peak=%d cost=%v error=%s items=%v", peak.Load(), cost, message, items)
	}
	for i, item := range items {
		if stringAny(item["id"]) != fmt.Sprint(i) {
			t.Fatal(items)
		}
	}
}

func TestComicConcurrentDatabaseCheckpoints(t *testing.T) {
	dsn := os.Getenv("COMIC_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set COMIC_TEST_DATABASE_URL for isolated checkpoint regression")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("comic_checkpoint_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `CREATE TABLE workflow_projects(id bigint PRIMARY KEY, outputs jsonb, updated_at timestamptz); INSERT INTO workflow_projects VALUES(1,'{}',now())`)
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for i := 0; i < 12; i++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			appendWorkflowMediaTask(ctx, pool, 1, map[string]interface{}{"task_no": fmt.Sprint(index), "status": "pending"})
			saveComicStageCheckpoint(ctx, pool, 1, "keyframes", []map[string]interface{}{{"id": fmt.Sprint(index)}})
			appendWorkflowMediaTask(ctx, pool, 1, map[string]interface{}{"task_no": fmt.Sprint(index), "status": "succeeded", "actual_cost": 1})
		}(i)
	}
	group.Wait()
	output := loadWorkflowOutputs(ctx, pool, 1)
	items := comicCollection(output["media_tasks"])
	if len(items) != 12 {
		t.Fatalf("lost media records: %v", output)
	}
	for _, raw := range items {
		if stringAny(mapAnyOr(raw, nil)["status"]) != "succeeded" {
			t.Fatal("lost final task update", raw)
		}
	}
	saveWorkflowOutputs(ctx, pool, 1, map[string]interface{}{"current_step": "compose"})
	if len(comicCollection(loadWorkflowOutputs(ctx, pool, 1)["media_tasks"])) != 12 {
		t.Fatal("stage snapshot discarded media ledger")
	}
}

func TestComicShotReferencesExcludeOtherCharacters(t *testing.T) {
	inputs := map[string]interface{}{"reference_images": []string{"https://example.com/unclassified.jpg"}, "comic_assets": []interface{}{
		map[string]interface{}{"asset_code": "A", "metadata": map[string]interface{}{"reference_urls": []string{"https://example.com/a.jpg"}}},
		map[string]interface{}{"asset_code": "B", "metadata": map[string]interface{}{"reference_urls": []string{"https://example.com/b.jpg"}}},
	}}
	shot := comicShotInputs(inputs, map[string]interface{}{"character_codes": []string{"B"}})
	refs := referenceImageURLs(shot)
	if len(refs) != 1 || refs[0] != "https://example.com/b.jpg" {
		t.Fatal(refs)
	}
	if len(comicCollection(inputs["comic_assets"])) != 2 {
		t.Fatal("modified shared inputs")
	}
}

func TestComicVideoIdentityReferencesExcludeLocation(t *testing.T) {
	inputs := map[string]interface{}{"comic_assets": []interface{}{
		map[string]interface{}{"asset_type": "character", "metadata": map[string]interface{}{"reference_urls": []string{"https://example.com/host.jpg"}}},
		map[string]interface{}{"asset_type": "location", "metadata": map[string]interface{}{"reference_urls": []string{"https://example.com/studio-with-person.jpg"}}},
	}}
	refs := comicVideoIdentityReferenceURLs(inputs, "seedance_2")
	if len(refs) != 1 || refs[0] != "https://example.com/host.jpg" {
		t.Fatal(refs)
	}
	if refs := comicVideoIdentityReferenceURLs(inputs, "omni_reference"); len(refs) != 0 {
		t.Fatal("Omni portrait video must use only its keyframe", refs)
	}
}

func TestComicQualityFailsClosed(t *testing.T) {
	for _, verdict := range []map[string]interface{}{
		{}, {"checked": false, "asset_consistency": 100}, {"checked": true},
		{"checked": true, "asset_consistency": 79}, {"checked": true, "asset_consistency": 101},
		{"checked": true, "asset_consistency": 95, "uncertain": true},
	} {
		if passed, _ := comicQualityDecision(verdict, 80); passed {
			t.Fatal("invalid review passed", verdict)
		}
	}
	if passed, reason := comicQualityDecision(map[string]interface{}{"checked": true, "asset_consistency": 90, "uncertain": false}, 80); !passed || reason != "" {
		t.Fatal(reason)
	}
}

func TestComicParallelCancellationSkipsGeneration(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	_, cost, message := comicParallelStage(ctx, 3, 2, func(int) ([]map[string]interface{}, float64, string) { called = true; return nil, 1, "" }, func([]map[string]interface{}) {})
	if called || cost != 0 || message == "" {
		t.Fatal(called, cost, message)
	}
}
