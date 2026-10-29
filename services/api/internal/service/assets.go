package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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

type SeedancePortraitGroup struct {
	GroupID     string `json:"group_id"`
	ProjectName string `json:"project_name"`
	CreatedAt   string `json:"created_at"`
}

func (s *AssetService) SaveSeedancePortraitGroup(ctx context.Context, userID int64, groupID, projectName string) error {
	_, err := s.db.Exec(ctx, `INSERT INTO seedance_portrait_groups(user_id,group_id,project_name)
		VALUES($1,$2,$3) ON CONFLICT(user_id,group_id) DO UPDATE SET project_name=EXCLUDED.project_name`,
		userID, strings.TrimSpace(groupID), strings.TrimSpace(projectName))
	return err
}

func (s *AssetService) ListSeedancePortraitGroups(ctx context.Context, userID int64) ([]SeedancePortraitGroup, error) {
	rows, err := s.db.Query(ctx, `SELECT group_id,project_name,created_at FROM seedance_portrait_groups WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []SeedancePortraitGroup{}
	for rows.Next() {
		var item SeedancePortraitGroup
		var created time.Time
		if err := rows.Scan(&item.GroupID, &item.ProjectName, &created); err != nil {
			return nil, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *AssetService) OwnsSeedancePortraitGroup(ctx context.Context, userID int64, groupID, projectName string) bool {
	var exists bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM seedance_portrait_groups WHERE user_id=$1 AND group_id=$2 AND project_name=$3)`,
		userID, strings.TrimSpace(groupID), strings.TrimSpace(projectName)).Scan(&exists)
	return err == nil && exists
}

func (s *AssetService) SaveSeedancePortraitAsset(ctx context.Context, userID int64, groupID, assetID, assetType string) error {
	_, err := s.db.Exec(ctx, `INSERT INTO seedance_portrait_assets(user_id,group_id,asset_id,asset_type)
		VALUES($1,$2,$3,$4) ON CONFLICT(user_id,asset_id) DO UPDATE SET group_id=EXCLUDED.group_id,asset_type=EXCLUDED.asset_type`,
		userID, strings.TrimSpace(groupID), strings.TrimSpace(assetID), strings.TrimSpace(assetType))
	return err
}

func (s *AssetService) OwnsSeedancePortraitAsset(ctx context.Context, userID int64, assetID string) bool {
	assetID = strings.TrimPrefix(strings.TrimSpace(assetID), "asset://")
	var exists bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM seedance_portrait_assets WHERE user_id=$1 AND asset_id=$2)`, userID, assetID).Scan(&exists)
	return err == nil && exists
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
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM assets`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(ctx, `
		SELECT public_id, name, description, kind, asset_type, mime_type, size_bytes, bucket, object_key, tags, created_at
		FROM assets`+where+fmt.Sprintf(` ORDER BY created_at DESC, public_id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
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
	return items, total, rows.Err()
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

func (s *AssetService) GetMany(ctx context.Context, userID int64, publicIDs []string) ([]AssetDTO, error) {
	if len(publicIDs) > 100 {
		return nil, errors.New("单次最多查询100个素材")
	}
	unique := make([]string, 0, len(publicIDs))
	seen := make(map[string]bool, len(publicIDs))
	for _, publicID := range publicIDs {
		publicID = strings.TrimSpace(publicID)
		if publicID != "" && !seen[publicID] {
			seen[publicID] = true
			unique = append(unique, publicID)
		}
	}
	if len(unique) == 0 {
		return []AssetDTO{}, nil
	}
	rows, err := s.db.Query(ctx, `SELECT public_id,name,description,kind,asset_type,mime_type,size_bytes,bucket,object_key,tags,created_at
		FROM assets WHERE user_id=$1 AND public_id=ANY($2)`, userID, unique)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byID := make(map[string]AssetDTO, len(unique))
	for rows.Next() {
		var item AssetDTO
		var tags []byte
		var created time.Time
		if err := rows.Scan(&item.PublicID, &item.Name, &item.Description, &item.Kind, &item.AssetType, &item.MimeType, &item.SizeBytes, &item.Bucket, &item.ObjectKey, &tags, &created); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(tags, &item.Tags)
		item.CreatedAt = created.Format(time.RFC3339)
		byID[item.PublicID] = item
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items := make([]AssetDTO, 0, len(byID))
	for _, publicID := range unique {
		if item, ok := byID[publicID]; ok {
			items = append(items, item)
		}
	}
	return items, nil
}

func (s *AssetService) IDByObjectKey(ctx context.Context, userID int64, key string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `SELECT public_id FROM assets WHERE user_id=$1 AND object_key=$2 LIMIT 1`, userID, key).Scan(&id)
	return id, err
}

func (s *AssetService) Delete(ctx context.Context, userID int64, publicID string) error {
	var assetID int64
	if err := s.db.QueryRow(ctx, `SELECT id FROM assets WHERE user_id=$1 AND public_id=$2`, userID, publicID).Scan(&assetID); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `UPDATE works SET asset_id=NULL WHERE user_id=$1 AND asset_id=$2`, userID, assetID); err != nil {
		return fmt.Errorf("detach asset from works: %w", err)
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM assets WHERE user_id=$1 AND public_id=$2`, userID, publicID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("资产不存在")
	}
	return nil
}
