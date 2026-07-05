package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/util"
)

type GalleryService struct {
	db *pgxpool.Pool
}

func NewGalleryService(db *pgxpool.Pool) *GalleryService {
	return &GalleryService{db: db}
}

type GalleryItemDTO struct {
	PublicID     string   `json:"public_id"`
	ModelCode    *string  `json:"model_code,omitempty"`
	Title        *string  `json:"title,omitempty"`
	Prompt       *string  `json:"prompt,omitempty"`
	CoverURL     *string  `json:"cover_url,omitempty"`
	MediaURL     *string  `json:"media_url,omitempty"`
	ThumbnailURL *string  `json:"thumbnail_url,omitempty"`
	Type         string   `json:"type"`
	Tags         []string `json:"tags"`
	Status       string   `json:"status"`
	IsFeatured   bool     `json:"is_featured"`
	IsPaid       bool     `json:"is_paid"`
	Price        float64  `json:"price"`
	LikeCount    int      `json:"like_count"`
	CreatedAt    string   `json:"created_at"`
}

type GalleryTagDTO struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

func (s *GalleryService) ListTags(ctx context.Context) ([]GalleryTagDTO, error) {
	rows, err := s.db.Query(ctx, `SELECT name, slug FROM gallery_tags ORDER BY sort ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GalleryTagDTO
	for rows.Next() {
		var t GalleryTagDTO
		if err := rows.Scan(&t.Name, &t.Slug); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	return items, nil
}

func (s *GalleryService) ListPublic(ctx context.Context, tag string, page, pageSize int) ([]GalleryItemDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 60 {
		pageSize = 24
	}
	where := "status='approved'"
	args := []interface{}{}
	if tag != "" && tag != "all" {
		where += " AND tags @> $1::jsonb"
		tagJSON, _ := json.Marshal([]string{tag})
		args = append(args, string(tagJSON))
	}
	var total int
	s.db.QueryRow(ctx, "SELECT COUNT(*) FROM gallery_items WHERE "+where, args...).Scan(&total)
	args = append(args, pageSize, (page-1)*pageSize)
	q := `SELECT g.public_id, g.model_code, g.title, g.prompt, g.cover_url, g.type, g.tags, g.status, g.is_featured, COALESCE(g.is_paid,false), COALESCE(g.price,0), g.like_count, g.created_at,
		COALESCE(w.metadata,'{}'::jsonb), w.thumbnail_url
		FROM gallery_items g LEFT JOIN works w ON w.id=g.work_id WHERE ` +
		prefixGalleryWhere(where) + " ORDER BY g.is_featured DESC, g.created_at DESC LIMIT $" + itoa(len(args)-1) + " OFFSET $" + itoa(len(args))
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items, err := scanGalleryItems(rows)
	return items, total, err
}

func (s *GalleryService) ListAdmin(ctx context.Context, status string, page, pageSize int) ([]GalleryItemDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 30
	}
	where := "1=1"
	args := []interface{}{}
	if status != "" {
		where += " AND status=$1"
		args = append(args, status)
	}
	var total int
	s.db.QueryRow(ctx, "SELECT COUNT(*) FROM gallery_items WHERE "+where, args...).Scan(&total)
	args = append(args, pageSize, (page-1)*pageSize)
	q := `SELECT g.public_id, g.model_code, g.title, g.prompt, g.cover_url, g.type, g.tags, g.status, g.is_featured, COALESCE(g.is_paid,false), COALESCE(g.price,0), g.like_count, g.created_at,
		COALESCE(w.metadata,'{}'::jsonb), w.thumbnail_url
		FROM gallery_items g LEFT JOIN works w ON w.id=g.work_id WHERE ` +
		prefixGalleryWhere(where) + " ORDER BY g.created_at DESC LIMIT $" + itoa(len(args)-1) + " OFFSET $" + itoa(len(args))
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items, err := scanGalleryItems(rows)
	return items, total, err
}

func scanGalleryItems(rows pgx.Rows) ([]GalleryItemDTO, error) {
	var items []GalleryItemDTO
	for rows.Next() {
		var g GalleryItemDTO
		var tags []byte
		var meta []byte
		var workThumb *string
		var created time.Time
		if err := rows.Scan(&g.PublicID, &g.ModelCode, &g.Title, &g.Prompt, &g.CoverURL, &g.Type, &tags, &g.Status, &g.IsFeatured, &g.IsPaid, &g.Price, &g.LikeCount, &created, &meta, &workThumb); err != nil {
			return nil, err
		}
		json.Unmarshal(tags, &g.Tags)
		applyGalleryMedia(&g, meta, workThumb)
		g.CreatedAt = created.Format(time.RFC3339)
		items = append(items, g)
	}
	return items, nil
}

func (s *GalleryService) Get(ctx context.Context, publicID string) (*GalleryItemDTO, error) {
	var g GalleryItemDTO
	var tags []byte
	var meta []byte
	var workThumb *string
	var created time.Time
	err := s.db.QueryRow(ctx, `
		SELECT g.public_id, g.model_code, g.title, g.prompt, g.cover_url, g.type, g.tags, g.status, g.is_featured, COALESCE(g.is_paid,false), COALESCE(g.price,0), g.like_count, g.created_at,
		       COALESCE(w.metadata,'{}'::jsonb), w.thumbnail_url
		FROM gallery_items g LEFT JOIN works w ON w.id=g.work_id
		WHERE g.public_id=$1 AND g.status='approved'`, publicID).Scan(
		&g.PublicID, &g.ModelCode, &g.Title, &g.Prompt, &g.CoverURL, &g.Type, &tags, &g.Status, &g.IsFeatured, &g.IsPaid, &g.Price, &g.LikeCount, &created, &meta, &workThumb)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(tags, &g.Tags)
	applyGalleryMedia(&g, meta, workThumb)
	g.CreatedAt = created.Format(time.RFC3339)
	return &g, nil
}

// Clone returns the model code and prompt for "generate same" prefill.
func (s *GalleryService) Clone(ctx context.Context, publicID string, userID int64) (map[string]interface{}, error) {
	item, err := s.Get(ctx, publicID)
	if err != nil {
		return nil, err
	}
	if item.IsPaid && item.Price > 0 {
		if userID <= 0 {
			return nil, errors.New("请先登录后再使用付费作品")
		}
		if err := s.chargePaidClone(ctx, userID, item.Price, publicID); err != nil {
			return nil, err
		}
	}
	s.db.Exec(ctx, `UPDATE gallery_items SET like_count=like_count+1 WHERE public_id=$1`, publicID)
	return map[string]interface{}{
		"model_code": item.ModelCode,
		"prompt":     item.Prompt,
		"charged":    item.IsPaid && item.Price > 0,
		"price":      item.Price,
	}, nil
}

// PublishWork creates a gallery item from one of the user's works.
func (s *GalleryService) PublishWork(ctx context.Context, userID int64, workPublicID, title string, tags []string, auditRequired bool, isPaid bool, price float64) (*GalleryItemDTO, error) {
	var workID int64
	var prompt *string
	var thumb *string
	var wtype string
	var modelCode *string
	var metaRaw []byte
	err := s.db.QueryRow(ctx, `
		SELECT w.id, w.prompt, w.thumbnail_url, w.type, m.code, w.metadata
		FROM works w LEFT JOIN models m ON m.id = w.model_id
		WHERE w.public_id=$1 AND w.user_id=$2`, workPublicID, userID).Scan(&workID, &prompt, &thumb, &wtype, &modelCode, &metaRaw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("作品不存在")
		}
		return nil, err
	}
	var exists bool
	s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gallery_items WHERE work_id=$1)`, workID).Scan(&exists)
	if exists {
		return nil, errors.New("该作品已发布")
	}
	status := "approved"
	if auditRequired {
		status = "pending"
	}
	if title == "" && prompt != nil {
		title = truncate(*prompt, 20)
	}
	if tags == nil {
		tags = []string{}
	}
	if !isPaid || price < 0 {
		isPaid = false
		price = 0
	}
	tagJSON, _ := json.Marshal(tags)
	meta := map[string]interface{}{}
	_ = json.Unmarshal(metaRaw, &meta)
	mediaURL, coverURL := galleryMediaFromWork(wtype, meta, thumb)
	publicID := util.NewPublicID("gal")
	_, err = s.db.Exec(ctx, `
		INSERT INTO gallery_items (public_id, work_id, user_id, model_code, title, prompt, cover_url, type, tags, status, is_paid, price)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		publicID, workID, userID, modelCode, title, prompt, coverURL, wtype, tagJSON, status, isPaid, price)
	if err != nil {
		return nil, err
	}
	return &GalleryItemDTO{PublicID: publicID, Title: &title, Prompt: prompt, CoverURL: coverURL, MediaURL: mediaURL, ThumbnailURL: coverURL, Type: wtype, Tags: tags, Status: status, IsPaid: isPaid, Price: price}, nil
}

func (s *GalleryService) DeleteUserItem(ctx context.Context, userID int64, publicID string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM gallery_items WHERE user_id=$1 AND public_id=$2`, userID, publicID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("作品不存在")
	}
	return nil
}

func (s *GalleryService) Audit(ctx context.Context, id int64, status string, featured *bool) error {
	if status != "" {
		if status != "approved" && status != "rejected" && status != "pending" {
			return errors.New("无效状态")
		}
		s.db.Exec(ctx, `UPDATE gallery_items SET status=$1 WHERE id=$2`, status, id)
	}
	if featured != nil {
		s.db.Exec(ctx, `UPDATE gallery_items SET is_featured=$1 WHERE id=$2`, *featured, id)
	}
	return nil
}

func (s *GalleryService) Delete(ctx context.Context, id int64) error {
	_, err := s.db.Exec(ctx, `DELETE FROM gallery_items WHERE id=$1`, id)
	return err
}

func (s *GalleryService) ListAdminWithID(ctx context.Context, status string, page, pageSize int) ([]map[string]interface{}, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 30
	}
	where := "1=1"
	args := []interface{}{}
	if status != "" {
		where += " AND status=$1"
		args = append(args, status)
	}
	var total int
	s.db.QueryRow(ctx, "SELECT COUNT(*) FROM gallery_items WHERE "+where, args...).Scan(&total)
	args = append(args, pageSize, (page-1)*pageSize)
	q := `SELECT g.id, g.public_id, g.model_code, g.title, g.prompt, g.cover_url, g.type, g.tags, g.status, g.is_featured, COALESCE(g.is_paid,false), COALESCE(g.price,0), g.like_count, g.created_at,
		COALESCE(w.metadata,'{}'::jsonb), w.thumbnail_url
		FROM gallery_items g LEFT JOIN works w ON w.id=g.work_id WHERE ` +
		prefixGalleryWhere(where) + " ORDER BY g.created_at DESC LIMIT $" + itoa(len(args)-1) + " OFFSET $" + itoa(len(args))
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []map[string]interface{}
	for rows.Next() {
		var id int64
		var g GalleryItemDTO
		var tags []byte
		var meta []byte
		var workThumb *string
		var created time.Time
		if err := rows.Scan(&id, &g.PublicID, &g.ModelCode, &g.Title, &g.Prompt, &g.CoverURL, &g.Type, &tags, &g.Status, &g.IsFeatured, &g.IsPaid, &g.Price, &g.LikeCount, &created, &meta, &workThumb); err != nil {
			return nil, 0, err
		}
		json.Unmarshal(tags, &g.Tags)
		applyGalleryMedia(&g, meta, workThumb)
		items = append(items, map[string]interface{}{
			"id": id, "public_id": g.PublicID, "model_code": g.ModelCode, "title": g.Title,
			"prompt": g.Prompt, "cover_url": g.CoverURL, "type": g.Type, "tags": g.Tags,
			"media_url": g.MediaURL, "thumbnail_url": g.ThumbnailURL,
			"status": g.Status, "is_featured": g.IsFeatured, "is_paid": g.IsPaid, "price": g.Price, "like_count": g.LikeCount,
			"created_at": created.Format(time.RFC3339),
		})
	}
	return items, total, nil
}

func (s *GalleryService) chargePaidClone(ctx context.Context, userID int64, amount float64, publicID string) error {
	if amount <= 0 {
		return nil
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var balance, frozen float64
	if err = tx.QueryRow(ctx, `SELECT compute_balance, frozen_compute FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance, &frozen); err != nil {
		return err
	}
	if balance-frozen < amount {
		return errors.New("账户余额不足")
	}
	nextBalance := balance - amount
	if _, err = tx.Exec(ctx, `UPDATE wallets SET compute_balance=$1, updated_at=now() WHERE user_id=$2`, nextBalance, userID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
		VALUES ($1,'gallery_paid_clone','out',$2,$3,'gallery',$4,'灵感广场付费同款')`,
		userID, amount, nextBalance, publicID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func applyGalleryMedia(g *GalleryItemDTO, metaRaw []byte, workThumb *string) {
	meta := map[string]interface{}{}
	_ = json.Unmarshal(metaRaw, &meta)
	mediaURL, coverURL := galleryMediaFromWork(g.Type, meta, firstNonEmptyPtr(g.CoverURL, workThumb))
	g.MediaURL = firstNonEmptyPtr(g.MediaURL, mediaURL)
	g.CoverURL = firstNonEmptyPtr(g.CoverURL, coverURL)
	g.ThumbnailURL = firstNonEmptyPtr(g.ThumbnailURL, coverURL, g.CoverURL)
}

func galleryMediaFromWork(wtype string, meta map[string]interface{}, thumb *string) (*string, *string) {
	var media string
	var cover string
	switch wtype {
	case "video":
		media = firstGalleryURL(meta["video_url"], meta["videos"], meta["url"], meta["result_url"])
		cover = firstGalleryURL(meta["thumbnail"], nestedGalleryValue(meta["videos"], "thumbnail"), nestedGalleryValue(meta["videos"], "cover"), nestedGalleryValue(meta["videos"], "poster_url"))
	case "audio":
		media = firstGalleryURL(meta["audio_url"], meta["audios"], meta["url"])
	default:
		media = firstGalleryURL(meta["image_url"], meta["images"], meta["url"])
	}
	if cover == "" && thumb != nil {
		cover = strings.TrimSpace(*thumb)
	}
	if media == "" && thumb != nil {
		media = strings.TrimSpace(*thumb)
	}
	if cover == "" {
		cover = media
	}
	return stringPtr(media), stringPtr(cover)
}

func firstGalleryURL(values ...interface{}) string {
	for _, value := range values {
		switch v := value.(type) {
		case string:
			if s := strings.TrimSpace(v); s != "" {
				return s
			}
		case []interface{}:
			for _, item := range v {
				if s := firstGalleryURL(item); s != "" {
					return s
				}
			}
		case map[string]interface{}:
			if s := firstGalleryURL(v["url"], v["video_url"], v["image_url"], v["audio_url"], v["result_url"], v["download_url"], v["file_url"]); s != "" {
				return s
			}
		}
	}
	return ""
}

func nestedGalleryValue(value interface{}, key string) interface{} {
	arr, ok := value.([]interface{})
	if !ok {
		return nil
	}
	out := make([]interface{}, 0, len(arr))
	for _, item := range arr {
		if m, ok := item.(map[string]interface{}); ok {
			out = append(out, m[key])
		}
	}
	return out
}

func stringPtr(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func firstNonEmptyPtr(items ...*string) *string {
	for _, item := range items {
		if item != nil && strings.TrimSpace(*item) != "" {
			return item
		}
	}
	return nil
}

func prefixGalleryWhere(where string) string {
	where = strings.TrimSpace(where)
	if where == "1=1" {
		return where
	}
	where = strings.ReplaceAll(where, "status", "g.status")
	where = strings.ReplaceAll(where, "tags", "g.tags")
	return where
}
