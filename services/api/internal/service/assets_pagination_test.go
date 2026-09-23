package service

import (
	"context"
	"testing"
)

func TestAssetPagination(t *testing.T) {
	pool := agentTestDatabase(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `CREATE TABLE assets(public_id text PRIMARY KEY,user_id bigint,name text,description text,kind text,asset_type text,mime_type text,size_bytes bigint,bucket text,object_key text,tags jsonb,created_at timestamptz);
INSERT INTO assets SELECT 'asset-'||lpad(n::text,3,'0'),1,'lesson '||n,'','image','role','image/png',1,'test','key','[]',now() FROM generate_series(1,45) n;
INSERT INTO assets SELECT 'private',2,'lesson private','','image','role','image/png',1,'test','private','[]',now();`)
	if err != nil {
		t.Fatal(err)
	}
	s := NewAssetService(pool)
	seen := map[string]bool{}
	for page := 1; page <= 3; page++ {
		items, total, err := s.List(ctx, 1, "lesson", "", "image", "role", page, 20)
		want := 20
		if page == 3 {
			want = 5
		}
		if err != nil || total != 45 || len(items) != want {
			t.Fatalf("page=%d count=%d total=%d error=%v", page, len(items), total, err)
		}
		for _, item := range items {
			if item.PublicID == "private" || seen[item.PublicID] {
				t.Fatal("duplicate or unauthorized asset", item.PublicID)
			}
			seen[item.PublicID] = true
		}
	}
	items, total, err := s.List(ctx, 1, "missing", "", "image", "role", 1, 20)
	if err != nil || total != 0 || len(items) != 0 {
		t.Fatal("search did not reset total", total, err)
	}
	batch, err := s.GetMany(ctx, 1, []string{"asset-002", "private", "asset-001", "asset-002"})
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 2 || batch[0].PublicID != "asset-002" || batch[1].PublicID != "asset-001" {
		t.Fatalf("batch lookup did not preserve authorized caller order: %#v", batch)
	}
}
