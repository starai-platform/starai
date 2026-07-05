package service

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/util"
)

type WorksService struct {
	db *pgxpool.Pool
}

func NewWorksService(db *pgxpool.Pool) *WorksService {
	return &WorksService{db: db}
}

type WorkDTO struct {
	PublicID     string                 `json:"public_id"`
	Type         string                 `json:"type"`
	Title        *string                `json:"title,omitempty"`
	Prompt       *string                `json:"prompt,omitempty"`
	ThumbnailURL *string                `json:"thumbnail_url,omitempty"`
	Metadata     map[string]interface{} `json:"metadata"`
	ExpiresAt    *string                `json:"expires_at,omitempty"`
	CreatedAt    string                 `json:"created_at"`
}

func (s *WorksService) List(ctx context.Context, userID int64, page, pageSize int) ([]WorkDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	var total int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM works WHERE user_id=$1`, userID).Scan(&total)
	rows, err := s.db.Query(ctx, `
		SELECT w.public_id, w.type, w.title, w.prompt, w.thumbnail_url, w.metadata, COALESCE(t.output, '{}'::jsonb), w.expires_at, w.created_at
		FROM works w
		LEFT JOIN tasks t ON t.id = w.task_id
		WHERE w.user_id=$1 ORDER BY w.created_at DESC LIMIT $2 OFFSET $3`,
		userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []WorkDTO
	for rows.Next() {
		var w WorkDTO
		var meta []byte
		var taskOutput []byte
		var created time.Time
		var expires *time.Time
		if err := rows.Scan(&w.PublicID, &w.Type, &w.Title, &w.Prompt, &w.ThumbnailURL, &meta, &taskOutput, &expires, &created); err != nil {
			return nil, 0, err
		}
		json.Unmarshal(meta, &w.Metadata)
		w.Metadata = mergeWorkMetadata(w.Metadata, taskOutput)
		w.CreatedAt = created.Format(time.RFC3339)
		if expires != nil {
			es := expires.Format(time.RFC3339)
			w.ExpiresAt = &es
		}
		items = append(items, w)
	}
	return items, total, nil
}

func (s *WorksService) Get(ctx context.Context, userID int64, publicID string) (*WorkDTO, error) {
	var w WorkDTO
	var meta []byte
	var taskOutput []byte
	var created time.Time
	var expires *time.Time
	err := s.db.QueryRow(ctx, `
		SELECT w.public_id, w.type, w.title, w.prompt, w.thumbnail_url, w.metadata, COALESCE(t.output, '{}'::jsonb), w.expires_at, w.created_at
		FROM works w
		LEFT JOIN tasks t ON t.id = w.task_id
		WHERE w.public_id=$1 AND w.user_id=$2`, publicID, userID).Scan(
		&w.PublicID, &w.Type, &w.Title, &w.Prompt, &w.ThumbnailURL, &meta, &taskOutput, &expires, &created)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(meta, &w.Metadata)
	w.Metadata = mergeWorkMetadata(w.Metadata, taskOutput)
	w.CreatedAt = created.Format(time.RFC3339)
	if expires != nil {
		es := expires.Format(time.RFC3339)
		w.ExpiresAt = &es
	}
	return &w, nil
}

func (s *WorksService) Delete(ctx context.Context, userID int64, publicID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var workID int64
	if err = tx.QueryRow(ctx, `SELECT id FROM works WHERE public_id=$1 AND user_id=$2`, publicID, userID).Scan(&workID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM gallery_items WHERE user_id=$1 AND work_id=$2`, userID, workID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM works WHERE id=$1 AND user_id=$2`, workID, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type ObjectDeleter interface {
	Delete(ctx context.Context, objectName string) error
	ObjectKeyFromURL(rawURL string) string
}

func (s *WorksService) DeleteWithStorage(ctx context.Context, userID int64, publicID string, store ObjectDeleter) error {
	w, err := s.Get(ctx, userID, publicID)
	if err != nil {
		return err
	}
	if store != nil {
		for _, key := range WorkStorageKeys(w, store) {
			_ = store.Delete(ctx, key)
		}
	}
	return s.Delete(ctx, userID, publicID)
}

func (s *WorksService) CleanupExpired(ctx context.Context, store ObjectDeleter, limit int) (int, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.db.Query(ctx, `
		SELECT w.public_id, w.type, w.title, w.prompt, w.thumbnail_url, w.metadata, COALESCE(t.output, '{}'::jsonb), w.expires_at, w.created_at
		FROM works w
		LEFT JOIN tasks t ON t.id = w.task_id
		WHERE w.expires_at IS NOT NULL AND w.expires_at <= now()
		ORDER BY w.expires_at ASC LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var items []WorkDTO
	for rows.Next() {
		var w WorkDTO
		var meta []byte
		var taskOutput []byte
		var created time.Time
		var expires *time.Time
		if err := rows.Scan(&w.PublicID, &w.Type, &w.Title, &w.Prompt, &w.ThumbnailURL, &meta, &taskOutput, &expires, &created); err != nil {
			return 0, err
		}
		json.Unmarshal(meta, &w.Metadata)
		w.Metadata = mergeWorkMetadata(w.Metadata, taskOutput)
		w.CreatedAt = created.Format(time.RFC3339)
		if expires != nil {
			es := expires.Format(time.RFC3339)
			w.ExpiresAt = &es
		}
		items = append(items, w)
	}
	for _, w := range items {
		if store != nil {
			for _, key := range WorkStorageKeys(&w, store) {
				_ = store.Delete(ctx, key)
			}
		}
		_, err = s.db.Exec(ctx, `DELETE FROM works WHERE public_id=$1`, w.PublicID)
		if err != nil {
			return 0, err
		}
	}
	return len(items), nil
}

func mergeWorkMetadata(meta map[string]interface{}, taskOutput []byte) map[string]interface{} {
	if meta == nil {
		meta = map[string]interface{}{}
	}
	var out map[string]interface{}
	if len(taskOutput) == 0 || json.Unmarshal(taskOutput, &out) != nil {
		return meta
	}
	for _, key := range []string{"images", "videos", "audios", "image_url", "video_url", "audio_url", "thumbnail", "upstream_task_id"} {
		if _, exists := meta[key]; exists {
			continue
		}
		if v, ok := out[key]; ok {
			meta[key] = v
		}
	}
	return meta
}

func WorkStorageKeys(w *WorkDTO, store ObjectDeleter) []string {
	if w == nil || store == nil {
		return nil
	}
	seen := map[string]bool{}
	var keys []string
	addURL := func(raw string) {
		if strings.TrimSpace(raw) == "" || strings.HasPrefix(raw, "data:") {
			return
		}
		key := store.ObjectKeyFromURL(raw)
		if key != "" && !seen[key] {
			seen[key] = true
			keys = append(keys, key)
		}
	}
	if w.ThumbnailURL != nil {
		addURL(*w.ThumbnailURL)
	}
	collectWorkURLs(w.Metadata, addURL)
	return keys
}

func collectWorkURLs(value interface{}, add func(string)) {
	switch v := value.(type) {
	case string:
		if _, err := url.ParseRequestURI(v); err == nil || strings.HasPrefix(v, "http") {
			add(v)
		}
	case []interface{}:
		for _, item := range v {
			collectWorkURLs(item, add)
		}
	case map[string]interface{}:
		for _, key := range []string{"url", "image_url", "video_url", "audio_url", "result_url", "thumbnail", "upstream_content_url"} {
			if raw, ok := v[key]; ok {
				collectWorkURLs(raw, add)
			}
		}
		for _, key := range []string{"images", "videos", "results", "data"} {
			if raw, ok := v[key]; ok {
				collectWorkURLs(raw, add)
			}
		}
	case map[string]string:
		for _, raw := range v {
			collectWorkURLs(raw, add)
		}
	}
}

func (s *WorksService) CreateFromTask(ctx context.Context, userID, taskID, modelID int64, prompt, imageURL string, retentionDays int) (*WorkDTO, error) {
	publicID := util.NewPublicID("work")
	var expires *time.Time
	if retentionDays > 0 {
		t := time.Now().Add(time.Duration(retentionDays) * 24 * time.Hour)
		expires = &t
	}
	meta, _ := json.Marshal(map[string]interface{}{"image_url": imageURL})
	var id int64
	err := s.db.QueryRow(ctx, `
		INSERT INTO works (public_id, user_id, task_id, model_id, type, prompt, thumbnail_url, metadata, expires_at)
		VALUES ($1,$2,$3,$4,'image',$5,$6,$7,$8) RETURNING id`,
		publicID, userID, taskID, modelID, prompt, imageURL, meta, expires).Scan(&id)
	if err != nil {
		return nil, err
	}
	now := time.Now().Format(time.RFC3339)
	var expStr *string
	if expires != nil {
		es := expires.Format(time.RFC3339)
		expStr = &es
	}
	return &WorkDTO{
		PublicID: publicID, Type: "image", Prompt: &prompt, ThumbnailURL: &imageURL,
		Metadata: map[string]interface{}{"image_url": imageURL}, ExpiresAt: expStr, CreatedAt: now,
	}, nil
}

func (s *WorksService) ListAdmin(ctx context.Context, page, pageSize int) ([]WorkDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	var total int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM works`).Scan(&total)
	rows, err := s.db.Query(ctx, `
		SELECT public_id, type, title, prompt, thumbnail_url, metadata, expires_at, created_at
		FROM works ORDER BY created_at DESC LIMIT $1 OFFSET $2`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []WorkDTO
	for rows.Next() {
		var w WorkDTO
		var meta []byte
		var created time.Time
		var expires *time.Time
		rows.Scan(&w.PublicID, &w.Type, &w.Title, &w.Prompt, &w.ThumbnailURL, &meta, &expires, &created)
		json.Unmarshal(meta, &w.Metadata)
		w.CreatedAt = created.Format(time.RFC3339)
		if expires != nil {
			es := expires.Format(time.RFC3339)
			w.ExpiresAt = &es
		}
		items = append(items, w)
	}
	return items, total, nil
}
