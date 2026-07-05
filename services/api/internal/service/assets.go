package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AssetService struct {
	db *pgxpool.Pool
}

func NewAssetService(db *pgxpool.Pool) *AssetService {
	return &AssetService{db: db}
}

type AssetDTO struct {
	PublicID    string   `json:"public_id"`
	Name        *string  `json:"name,omitempty"`
	Description *string  `json:"description,omitempty"`
	Kind        string   `json:"kind"`
	AssetType   string   `json:"asset_type"`
	MimeType    *string  `json:"mime_type,omitempty"`
	SizeBytes   int64    `json:"size_bytes"`
	URL         string   `json:"url"`
	Tags        []string `json:"tags"`
	CreatedAt   string   `json:"created_at"`
	Bucket      string   `json:"-"`
	ObjectKey   string   `json:"-"`
}

func (s *AssetService) Create(ctx context.Context, userID int64, publicID, bucket, objectKey string, name *string, description *string, kind string, assetType string, mime *string, size int64, tags []string) error {
	tagsJSON, _ := json.Marshal(tags)
	_, err := s.db.Exec(ctx, `
		INSERT INTO assets (public_id, user_id, bucket, object_key, name, description, kind, asset_type, mime_type, size_bytes, tags)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		publicID, userID, bucket, objectKey, name, description, kind, assetType, mime, size, tagsJSON)
	return err
}

func (s *AssetService) List(ctx context.Context, userID int64, q string, tag string, kind string, assetType string, page, pageSize int) ([]AssetDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	args := []interface{}{userID}
	where := ` WHERE user_id=$1`
	if q != "" {
		args = append(args, "%"+q+"%")
		where += fmt.Sprintf(" AND (name ILIKE $%d OR object_key ILIKE $%d)", len(args), len(args))
	}
	if tag != "" {
		args = append(args, tag)
		where += fmt.Sprintf(" AND tags ? $%d", len(args))
	}
	if kind != "" {
		args = append(args, kind)
		where += fmt.Sprintf(" AND kind=$%d", len(args))
	}
	if assetType != "" {
		args = append(args, assetType)
		where += fmt.Sprintf(" AND asset_type=$%d", len(args))
	}

	var total int
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM assets`+where, args...).Scan(&total)

	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(ctx, `
		SELECT public_id, name, description, kind, asset_type, mime_type, size_bytes, bucket, object_key, tags, created_at
		FROM assets`+where+fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []AssetDTO
	for rows.Next() {
		var a AssetDTO
		var bucket, key string
		var tagsJSON []byte
		var created time.Time
		if err := rows.Scan(&a.PublicID, &a.Name, &a.Description, &a.Kind, &a.AssetType, &a.MimeType, &a.SizeBytes, &bucket, &key, &tagsJSON, &created); err != nil {
			return nil, 0, err
		}
		json.Unmarshal(tagsJSON, &a.Tags)
		a.Bucket = bucket
		a.ObjectKey = key
		a.URL = "" // filled by handler from storage public url
		a.CreatedAt = created.Format(time.RFC3339)
		items = append(items, a)
	}
	return items, total, nil
}

func (s *AssetService) Get(ctx context.Context, userID int64, publicID string) (bucket, objectKey string, dto *AssetDTO, err error) {
	var a AssetDTO
	var tagsJSON []byte
	var created time.Time
	err = s.db.QueryRow(ctx, `
		SELECT public_id, name, description, kind, asset_type, mime_type, size_bytes, bucket, object_key, tags, created_at
		FROM assets WHERE public_id=$1 AND user_id=$2`, publicID, userID).
		Scan(&a.PublicID, &a.Name, &a.Description, &a.Kind, &a.AssetType, &a.MimeType, &a.SizeBytes, &bucket, &objectKey, &tagsJSON, &created)
	if err != nil {
		return "", "", nil, err
	}
	json.Unmarshal(tagsJSON, &a.Tags)
	a.CreatedAt = created.Format(time.RFC3339)
	return bucket, objectKey, &a, nil
}

func (s *AssetService) Delete(ctx context.Context, userID int64, publicID string) error {
	var assetID int64
	if err := s.db.QueryRow(ctx, `SELECT id FROM assets WHERE user_id=$1 AND public_id=$2`, userID, publicID).Scan(&assetID); err != nil {
		return err
	}
	_, _ = s.db.Exec(ctx, `UPDATE works SET asset_id=NULL WHERE user_id=$1 AND asset_id=$2`, userID, assetID)
	tag, err := s.db.Exec(ctx, `DELETE FROM assets WHERE user_id=$1 AND public_id=$2`, userID, publicID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("资产不存在")
	}
	return nil
}
