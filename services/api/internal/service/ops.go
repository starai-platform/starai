package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/util"
)

type OpsService struct {
	db        *pgxpool.Pool
	billing   *billing.Service
	cipherKey string
}

func NewOpsService(db *pgxpool.Pool, billing *billing.Service, cipherKey string) *OpsService {
	return &OpsService{db: db, billing: billing, cipherKey: cipherKey}
}

// ---------- Announcements ----------

type AnnouncementDTO struct {
	ID          int64   `json:"id"`
	Title       string  `json:"title"`
	Content     string  `json:"content"`
	Level       string  `json:"level"`
	IsPublished bool    `json:"is_published"`
	IsForced    bool    `json:"is_forced"`
	StartsAt    *string `json:"starts_at,omitempty"`
	EndsAt      *string `json:"ends_at,omitempty"`
	CreatedAt   string  `json:"created_at"`
}

func (s *OpsService) ListActiveAnnouncements(ctx context.Context) ([]AnnouncementDTO, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, title, content, level, is_published, is_forced, starts_at, ends_at, created_at
		FROM announcements
		WHERE is_published=true
		  AND (starts_at IS NULL OR starts_at <= now())
		  AND (ends_at IS NULL OR ends_at >= now())
		ORDER BY created_at DESC LIMIT 20`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAnnouncements(rows)
}

func (s *OpsService) ListAllAnnouncements(ctx context.Context) ([]AnnouncementDTO, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, title, content, level, is_published, is_forced, starts_at, ends_at, created_at
		FROM announcements ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAnnouncements(rows)
}

func scanAnnouncements(rows pgx.Rows) ([]AnnouncementDTO, error) {
	var items []AnnouncementDTO
	for rows.Next() {
		var a AnnouncementDTO
		var starts, ends *time.Time
		var created time.Time
		if err := rows.Scan(&a.ID, &a.Title, &a.Content, &a.Level, &a.IsPublished, &a.IsForced, &starts, &ends, &created); err != nil {
			return nil, err
		}
		a.CreatedAt = created.Format(time.RFC3339)
		if starts != nil {
			ss := starts.Format(time.RFC3339)
			a.StartsAt = &ss
		}
		if ends != nil {
			es := ends.Format(time.RFC3339)
			a.EndsAt = &es
		}
		items = append(items, a)
	}
	return items, nil
}

type AnnouncementInput struct {
	Title       string `json:"title"`
	Content     string `json:"content"`
	Level       string `json:"level"`
	IsPublished bool   `json:"is_published"`
	IsForced    bool   `json:"is_forced"`
}

func (s *OpsService) CreateAnnouncement(ctx context.Context, adminID int64, in AnnouncementInput) (int64, error) {
	if in.Level == "" {
		in.Level = "info"
	}
	var id int64
	err := s.db.QueryRow(ctx,
		`INSERT INTO announcements (title, content, level, is_published, is_forced, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		in.Title, in.Content, in.Level, in.IsPublished, in.IsForced, adminID).Scan(&id)
	if err != nil {
		return 0, err
	}
	if in.IsPublished {
		_ = s.BroadcastAnnouncementNotifications(ctx, in.Title, in.Content)
	}
	return id, nil
}

func (s *OpsService) UpdateAnnouncement(ctx context.Context, id int64, in AnnouncementInput) error {
	if in.Level == "" {
		in.Level = "info"
	}
	var wasPublished bool
	_ = s.db.QueryRow(ctx, `SELECT is_published FROM announcements WHERE id=$1`, id).Scan(&wasPublished)
	_, err := s.db.Exec(ctx,
		`UPDATE announcements SET title=$1, content=$2, level=$3, is_published=$4, is_forced=$5, updated_at=now() WHERE id=$6`,
		in.Title, in.Content, in.Level, in.IsPublished, in.IsForced, id)
	if err != nil {
		return err
	}
	if in.IsPublished && !wasPublished {
		_ = s.BroadcastAnnouncementNotifications(ctx, in.Title, in.Content)
	}
	return nil
}

// BroadcastAnnouncementNotifications pushes a published announcement to every active user's notification inbox.
func (s *OpsService) BroadcastAnnouncementNotifications(ctx context.Context, title, content string) error {
	if title == "" {
		return nil
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO notifications (user_id, title, content, type)
		SELECT id, $1, $2, 'announcement' FROM users WHERE status='active'`,
		title, content)
	return err
}

func (s *OpsService) PushAnnouncementNotifications(ctx context.Context, id int64) error {
	var title, content string
	var published bool
	err := s.db.QueryRow(ctx,
		`SELECT title, content, is_published FROM announcements WHERE id=$1`, id).Scan(&title, &content, &published)
	if err != nil {
		return err
	}
	if !published {
		return errors.New("仅已发布的公告可推送通知")
	}
	return s.BroadcastAnnouncementNotifications(ctx, title, content)
}

func (s *OpsService) DeleteAnnouncement(ctx context.Context, id int64) error {
	_, err := s.db.Exec(ctx, `DELETE FROM announcements WHERE id=$1`, id)
	return err
}

// ---------- Notifications ----------

type NotificationDTO struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Type      string `json:"type"`
	IsRead    bool   `json:"is_read"`
	CreatedAt string `json:"created_at"`
}

func (s *OpsService) ListNotifications(ctx context.Context, userID int64) ([]NotificationDTO, int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, title, content, type, is_read, created_at
		FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []NotificationDTO
	for rows.Next() {
		var n NotificationDTO
		var created time.Time
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.Type, &n.IsRead, &created); err != nil {
			return nil, 0, err
		}
		n.CreatedAt = created.Format(time.RFC3339)
		items = append(items, n)
	}
	var unread int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false`, userID).Scan(&unread)
	return items, unread, nil
}

func (s *OpsService) MarkNotificationRead(ctx context.Context, userID, id int64) error {
	_, err := s.db.Exec(ctx, `UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2`, id, userID)
	return err
}

func (s *OpsService) MarkAllNotificationsRead(ctx context.Context, userID int64) error {
	_, err := s.db.Exec(ctx, `UPDATE notifications SET is_read=true WHERE user_id=$1 AND is_read=false`, userID)
	return err
}

func (s *OpsService) CreateNotification(ctx context.Context, userID int64, title, content, typ string) error {
	if userID <= 0 || title == "" {
		return nil
	}
	if typ == "" {
		typ = "system"
	}
	_, err := s.db.Exec(ctx,
		`INSERT INTO notifications (user_id, title, content, type) VALUES ($1,$2,$3,$4)`,
		userID, title, content, typ)
	return err
}

func (s *OpsService) GetUnreadCount(ctx context.Context, userID int64) (int, error) {
	var unread int
	err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=false`, userID).Scan(&unread)
	return unread, err
}

// ---------- Daily check-in ----------

type CheckinStatus struct {
	Enabled       bool    `json:"enabled"`
	CheckedToday  bool    `json:"checked_today"`
	Reward        float64 `json:"reward"`
	TotalCheckins int     `json:"total_checkins"`
}

func (s *OpsService) CheckinStatus(ctx context.Context, userID int64) (*CheckinStatus, error) {
	enabled := s.configBool(ctx, "daily_checkin_enabled", false)
	reward := s.configFloat(ctx, "daily_checkin_reward", 5)
	var checked bool
	s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM daily_checkins WHERE user_id=$1 AND checkin_date=CURRENT_DATE)`, userID).Scan(&checked)
	var total int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM daily_checkins WHERE user_id=$1`, userID).Scan(&total)
	return &CheckinStatus{Enabled: enabled, CheckedToday: checked, Reward: reward, TotalCheckins: total}, nil
}

func (s *OpsService) Checkin(ctx context.Context, userID int64) (float64, error) {
	if !s.configBool(ctx, "daily_checkin_enabled", false) {
		return 0, errors.New("签到功能未开启")
	}
	reward := s.configFloat(ctx, "daily_checkin_reward", 5)
	ct, err := s.db.Exec(ctx,
		`INSERT INTO daily_checkins (user_id, checkin_date, reward) VALUES ($1, CURRENT_DATE, $2)
		 ON CONFLICT (user_id, checkin_date) DO NOTHING`, userID, reward)
	if err != nil {
		return 0, err
	}
	if ct.RowsAffected() == 0 {
		return 0, errors.New("今日已签到")
	}
	if err := s.billing.Credit(ctx, userID, reward, "daily_checkin", "checkin", time.Now().Format("2006-01-02"), "每日签到奖励"); err != nil {
		return 0, err
	}
	_ = s.CreateNotification(ctx, userID, "签到成功", fmt.Sprintf("每日签到获得 %.2f 算力", reward), "reward")
	return reward, nil
}

// ---------- API tokens ----------

type ApiTokenDTO struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	Token      *string `json:"token,omitempty"`
	Status     string  `json:"status"`
	LastUsedAt *string `json:"last_used_at,omitempty"`
	CreatedAt  string  `json:"created_at"`
}

func (s *OpsService) ListApiTokens(ctx context.Context, userID int64) ([]ApiTokenDTO, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, name, prefix, token_cipher, status, last_used_at, created_at FROM api_tokens WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ApiTokenDTO
	for rows.Next() {
		var t ApiTokenDTO
		var cipher *string
		var lastUsed *time.Time
		var created time.Time
		if err := rows.Scan(&t.ID, &t.Name, &t.Prefix, &cipher, &t.Status, &lastUsed, &created); err != nil {
			return nil, err
		}
		if cipher != nil && *cipher != "" {
			if plain, err := util.DecryptCardCode(*cipher, s.cipherKey); err == nil {
				t.Token = &plain
			}
		}
		t.CreatedAt = created.Format(time.RFC3339)
		if lastUsed != nil {
			ls := lastUsed.Format(time.RFC3339)
			t.LastUsedAt = &ls
		}
		items = append(items, t)
	}
	return items, nil
}

// CreateApiToken returns the plaintext token exactly once.
func (s *OpsService) CreateApiToken(ctx context.Context, userID int64, name string) (string, *ApiTokenDTO, error) {
	if name == "" {
		name = "默认密钥"
	}
	raw := randomToken(24)
	token := "sk-starai-" + raw
	prefix := token[:14]
	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])
	tokenCipher, err := util.EncryptCardCode(token, s.cipherKey)
	if err != nil {
		return "", nil, err
	}
	var id int64
	var created time.Time
	err = s.db.QueryRow(ctx,
		`INSERT INTO api_tokens (user_id, name, token_hash, prefix, token_cipher, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id, created_at`,
		userID, name, hash, prefix, tokenCipher).Scan(&id, &created)
	if err != nil {
		return "", nil, err
	}
	return token, &ApiTokenDTO{ID: id, Name: name, Prefix: prefix, Token: &token, Status: "active", CreatedAt: created.Format(time.RFC3339)}, nil
}

func (s *OpsService) DeleteApiToken(ctx context.Context, userID, id int64) error {
	_, err := s.db.Exec(ctx, `DELETE FROM api_tokens WHERE id=$1 AND user_id=$2`, id, userID)
	return err
}

func (s *OpsService) AuthenticateApiToken(ctx context.Context, token string) (int64, error) {
	if token == "" {
		return 0, errors.New("API Key 不能为空")
	}
	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])
	var userID int64
	var tokenID int64
	err := s.db.QueryRow(ctx, `
		SELECT t.user_id, t.id
		FROM api_tokens t
		JOIN users u ON u.id = t.user_id
		WHERE t.token_hash=$1
		  AND COALESCE(NULLIF(t.status, ''), 'active')='active'
		  AND COALESCE(NULLIF(u.status, ''), 'active')='active'
		LIMIT 1`, hash).Scan(&userID, &tokenID)
	if err != nil {
		return 0, errors.New("API Key 无效或已停用")
	}
	_, _ = s.db.Exec(ctx, `UPDATE api_tokens SET last_used_at=now() WHERE id=$1`, tokenID)
	return userID, nil
}

// ---------- helpers ----------

func (s *OpsService) configBool(ctx context.Context, key string, fallback bool) bool {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key=$1`, key).Scan(&raw); err != nil {
		return fallback
	}
	return string(raw) == "true"
}

func (s *OpsService) configFloat(ctx context.Context, key string, fallback float64) float64 {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key=$1`, key).Scan(&raw); err != nil {
		return fallback
	}
	v, err := strconv.ParseFloat(string(raw), 64)
	if err != nil || v <= 0 {
		return fallback
	}
	return v
}

func randomToken(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)[:n]
}
