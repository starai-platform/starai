package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestContentTranslationDatabase(t *testing.T) {
	dsn := os.Getenv("I18N_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set I18N_TEST_DATABASE_URL for isolated translation regression")
	}
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `CREATE TEMP TABLE system_configs(key text PRIMARY KEY,value jsonb)`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "infra", "migrations", "046_dynamic_content_i18n.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, strings.ReplaceAll(string(migration), "CREATE TABLE ", "CREATE TEMP TABLE ")); err != nil {
		t.Fatal(err)
	}
	service := NewContentI18nService(pool)
	batch := func(key string) []PendingContentTranslation {
		t.Helper()
		if err := service.SyncEntity(ctx, "model", key, map[string]string{"/display_name": "原名称"}); err != nil {
			t.Fatal(err)
		}
		items, err := service.Pending(ctx, "en-US", "model", key, 10)
		if err != nil || len(items) != 1 {
			t.Fatalf("pending: %+v %v", items, err)
		}
		return items
	}
	read := func(item PendingContentTranslation) (string, string) {
		t.Helper()
		var value, status string
		if err := pool.QueryRow(ctx, `SELECT value,status FROM content_translations WHERE source_id=$1 AND locale='en-US'`, item.SourceID).Scan(&value, &status); err != nil {
			t.Fatal(err)
		}
		return value, status
	}
	values := func(items []PendingContentTranslation) map[int64]string {
		return map[int64]string{items[0].SourceID: "AI name"}
	}

	t.Run("current translation is visible and late failure cannot undo success", func(t *testing.T) {
		items := batch("normal")
		count, err := service.SaveAI(ctx, "en-US", values(items), items)
		if err != nil || count != 1 {
			t.Fatalf("save: %d %v", count, err)
		}
		if err := service.MarkFailed(ctx, "en-US", items, errors.New("late error")); err != nil {
			t.Fatal(err)
		}
		if value, status := read(items[0]); value != "AI name" || status != "translated" {
			t.Fatalf("late failure: %q %q", value, status)
		}
		model := &ModelDTO{DisplayName: "原名称"}
		if err := service.Apply(ctx, "model", "normal", "en-US", model); err != nil || model.DisplayName != "AI name" {
			t.Fatalf("apply: %+v %v", model, err)
		}
	})
	t.Run("source changes reject stale AI and manual saves", func(t *testing.T) {
		items := batch("changed")
		if err := service.SyncEntity(ctx, "model", "changed", map[string]string{"/display_name": "新名称"}); err != nil {
			t.Fatal(err)
		}
		if count, err := service.SaveAI(ctx, "en-US", values(items), items); err != nil || count != 0 {
			t.Fatalf("stale save: %d %v", count, err)
		}
		if err := service.MarkFailed(ctx, "en-US", items, errors.New("stale failure")); err != nil {
			t.Fatal(err)
		}
		if err := service.SaveManual(ctx, items[0].SourceID, "en-US", "old manual", true, items[0].SourceHash); err == nil {
			t.Fatal("stale manual translation accepted")
		}
		if value, status := read(items[0]); value != "" || status != "pending" {
			t.Fatalf("source overwritten: %q %q", value, status)
		}
	})
	for _, reviewed := range []bool{false, true} {
		name := "manual"
		if reviewed {
			name = "reviewed"
		}
		t.Run(name+" edits win over in-flight AI", func(t *testing.T) {
			items := batch(name)
			if err := service.SaveManual(ctx, items[0].SourceID, "en-US", "Human name", reviewed, items[0].SourceHash); err != nil {
				t.Fatal(err)
			}
			if count, err := service.SaveAI(ctx, "en-US", values(items), items); err != nil || count != 0 {
				t.Fatalf("AI overwrite: %d %v", count, err)
			}
			if err := service.MarkFailed(ctx, "en-US", items, errors.New("late failure")); err != nil {
				t.Fatal(err)
			}
			if value, status := read(items[0]); value != "Human name" || (reviewed && status != "reviewed") || (!reviewed && status != "translated") {
				t.Fatalf("manual overwritten: %q %q", value, status)
			}
		})
	}
	t.Run("failed items remain retryable", func(t *testing.T) {
		items := batch("retry")
		if err := service.MarkFailed(ctx, "en-US", items, errors.New("provider unavailable")); err != nil {
			t.Fatal(err)
		}
		if _, status := read(items[0]); status != "failed" {
			t.Fatal(status)
		}
		fresh, err := service.Pending(ctx, "en-US", "model", "retry", 10)
		if err != nil || len(fresh) != 1 {
			t.Fatalf("retry pending: %+v %v", fresh, err)
		}
		if count, err := service.SaveAI(ctx, "en-US", values(fresh), fresh); err != nil || count != 1 {
			t.Fatalf("retry: %d %v", count, err)
		}
	})
}
