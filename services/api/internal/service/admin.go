package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/util"
	"golang.org/x/crypto/bcrypt"
)

var adminEmailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

type AdminService struct {
	db            *pgxpool.Pool
	billing       *billing.Service
	cardCipherKey string
}

func NewAdminService(db *pgxpool.Pool, billing *billing.Service, cardCipherKey string) *AdminService {
	return &AdminService{db: db, billing: billing, cardCipherKey: cardCipherKey}
}

type DashboardStats struct {
	TotalUsers             int     `json:"total_users"`
	NewUsersToday          int     `json:"new_users_today"`
	TotalTasks             int     `json:"total_tasks"`
	TasksToday             int     `json:"tasks_today"`
	SucceededTasks         int     `json:"succeeded_tasks"`
	FailedTasks            int     `json:"failed_tasks"`
	ActiveModels           int     `json:"active_models"`
	TotalRevenue           float64 `json:"total_revenue"`
	OnlineRevenue          float64 `json:"online_revenue"`
	CardRechargeAmount     float64 `json:"card_recharge_amount"`
	TotalConsumption       float64 `json:"total_consumption"`
	ConsumptionToday       float64 `json:"consumption_today"`
	ApiTokens              int     `json:"api_tokens"`
	ApiCalls               int     `json:"api_calls"`
	ApiCallsToday          int     `json:"api_calls_today"`
	ApiCost                float64 `json:"api_cost"`
	AvailableCards         int     `json:"available_cards"`
	UsedCards              int     `json:"used_cards"`
	TotalCardFaceValue     float64 `json:"total_card_face_value"`
	WalletBalanceTotal     float64 `json:"wallet_balance_total"`
	PublishedWorks         int     `json:"published_works"`
	PublishedAnnouncements int     `json:"published_announcements"`
	ReferredUsers          int     `json:"referred_users"`
	ActiveReferrers        int     `json:"active_referrers"`
	ReferralRewardCompute  float64 `json:"referral_reward_compute"`
	ReferralRewardCash     float64 `json:"referral_reward_cash"`
}

func (s *AdminService) Dashboard(ctx context.Context) (*DashboardStats, error) {
	var stats DashboardStats
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&stats.TotalUsers)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE`).Scan(&stats.NewUsersToday)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks`).Scan(&stats.TotalTasks)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks WHERE created_at >= CURRENT_DATE`).Scan(&stats.TasksToday)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks WHERE status='succeeded'`).Scan(&stats.SucceededTasks)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks WHERE status='failed'`).Scan(&stats.FailedTasks)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM models WHERE is_enabled=true`).Scan(&stats.ActiveModels)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid'`).Scan(&stats.OnlineRevenue)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE direction='in' AND type='card_recharge'`).Scan(&stats.CardRechargeAmount)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE direction='out'`).Scan(&stats.TotalConsumption)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM wallet_transactions WHERE direction='out' AND created_at >= CURRENT_DATE`).Scan(&stats.ConsumptionToday)
	stats.TotalRevenue = stats.OnlineRevenue + stats.CardRechargeAmount
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM api_tokens WHERE status='active'`).Scan(&stats.ApiTokens)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM ai_call_logs`).Scan(&stats.ApiCalls)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM ai_call_logs WHERE created_at >= CURRENT_DATE`).Scan(&stats.ApiCallsToday)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(cost),0) FROM ai_call_logs`).Scan(&stats.ApiCost)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM recharge_cards WHERE status='unused'`).Scan(&stats.AvailableCards)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM recharge_cards WHERE status='used'`).Scan(&stats.UsedCards)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(value),0) FROM recharge_cards`).Scan(&stats.TotalCardFaceValue)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(compute_balance),0) FROM wallets`).Scan(&stats.WalletBalanceTotal)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM gallery_items WHERE status='approved'`).Scan(&stats.PublishedWorks)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM announcements WHERE is_published=true`).Scan(&stats.PublishedAnnouncements)
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE referrer_id IS NOT NULL`).Scan(&stats.ReferredUsers)
	s.db.QueryRow(ctx, `SELECT COUNT(DISTINCT referrer_id) FROM users WHERE referrer_id IS NOT NULL`).Scan(&stats.ActiveReferrers)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM referral_rewards WHERE reward_account='compute'`).Scan(&stats.ReferralRewardCompute)
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM referral_rewards WHERE reward_account='cash'`).Scan(&stats.ReferralRewardCash)
	return &stats, nil
}

type AdminAccountDTO struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type AdminAccountInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
	Status   string `json:"status"`
}

func (s *AdminService) ensureAdminRole(ctx context.Context, role string) (int64, error) {
	role = strings.TrimSpace(role)
	if role == "" {
		role = "operator"
	}
	if role != "super_admin" && role != "operator" {
		return 0, fmt.Errorf("无效的管理员角色")
	}
	var id int64
	err := s.db.QueryRow(ctx, `SELECT id FROM admin_roles WHERE name=$1`, role).Scan(&id)
	if err == nil {
		return id, nil
	}
	perms := `[]`
	if role == "super_admin" {
		perms = `["*"]`
	}
	err = s.db.QueryRow(ctx, `
		INSERT INTO admin_roles (name, permissions) VALUES ($1,$2::jsonb)
		ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name
		RETURNING id`, role, perms).Scan(&id)
	return id, err
}

func (s *AdminService) ListAdminAccounts(ctx context.Context) ([]AdminAccountDTO, error) {
	rows, err := s.db.Query(ctx, `
		SELECT a.id, a.email, r.name, a.status, a.created_at, a.updated_at
		FROM admin_users a JOIN admin_roles r ON r.id=a.role_id
		ORDER BY a.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []AdminAccountDTO
	for rows.Next() {
		var item AdminAccountDTO
		var created, updated time.Time
		if err := rows.Scan(&item.ID, &item.Email, &item.Role, &item.Status, &created, &updated); err != nil {
			return nil, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		item.UpdatedAt = updated.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, nil
}

func (s *AdminService) CreateAdminAccount(ctx context.Context, in AdminAccountInput) (*AdminAccountDTO, error) {
	email := strings.TrimSpace(strings.ToLower(in.Email))
	if !adminEmailRe.MatchString(email) {
		return nil, fmt.Errorf("邮箱格式不正确")
	}
	if len(strings.TrimSpace(in.Password)) < 6 {
		return nil, fmt.Errorf("密码至少 6 位")
	}
	status := strings.TrimSpace(in.Status)
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "disabled" {
		return nil, fmt.Errorf("无效的账号状态")
	}
	roleID, err := s.ensureAdminRole(ctx, in.Role)
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), 10)
	if err != nil {
		return nil, err
	}
	var id int64
	err = s.db.QueryRow(ctx, `
		INSERT INTO admin_users (email, password_hash, role_id, status)
		VALUES ($1,$2,$3,$4) RETURNING id`, email, string(hash), roleID, status).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.GetAdminAccount(ctx, id)
}

func (s *AdminService) GetAdminAccount(ctx context.Context, id int64) (*AdminAccountDTO, error) {
	var item AdminAccountDTO
	var created, updated time.Time
	err := s.db.QueryRow(ctx, `
		SELECT a.id, a.email, r.name, a.status, a.created_at, a.updated_at
		FROM admin_users a JOIN admin_roles r ON r.id=a.role_id WHERE a.id=$1`, id).
		Scan(&item.ID, &item.Email, &item.Role, &item.Status, &created, &updated)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	item.UpdatedAt = updated.Format(time.RFC3339)
	return &item, nil
}

func (s *AdminService) UpdateAdminAccount(ctx context.Context, id int64, in AdminAccountInput) error {
	email := strings.TrimSpace(strings.ToLower(in.Email))
	if email != "" {
		if !adminEmailRe.MatchString(email) {
			return fmt.Errorf("邮箱格式不正确")
		}
		if _, err := s.db.Exec(ctx, `UPDATE admin_users SET email=$1, updated_at=now() WHERE id=$2`, email, id); err != nil {
			return err
		}
	}
	if strings.TrimSpace(in.Role) != "" {
		roleID, err := s.ensureAdminRole(ctx, in.Role)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(ctx, `UPDATE admin_users SET role_id=$1, updated_at=now() WHERE id=$2`, roleID, id); err != nil {
			return err
		}
	}
	if strings.TrimSpace(in.Status) != "" {
		if in.Status != "active" && in.Status != "disabled" {
			return fmt.Errorf("无效的账号状态")
		}
		if _, err := s.db.Exec(ctx, `UPDATE admin_users SET status=$1, updated_at=now() WHERE id=$2`, in.Status, id); err != nil {
			return err
		}
	}
	if strings.TrimSpace(in.Password) != "" {
		if len(strings.TrimSpace(in.Password)) < 6 {
			return fmt.Errorf("密码至少 6 位")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), 10)
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(ctx, `UPDATE admin_users SET password_hash=$1, updated_at=now() WHERE id=$2`, string(hash), id); err != nil {
			return err
		}
	}
	return nil
}

func (s *AdminService) ChangeAdminPassword(ctx context.Context, id int64, oldPassword, newPassword string) error {
	if len(strings.TrimSpace(newPassword)) < 6 {
		return fmt.Errorf("新密码至少 6 位")
	}
	var hash string
	if err := s.db.QueryRow(ctx, `SELECT password_hash FROM admin_users WHERE id=$1 AND status='active'`, id).Scan(&hash); err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(oldPassword)) != nil {
		return ErrInvalidCredentials
	}
	next, err := bcrypt.GenerateFromPassword([]byte(newPassword), 10)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE admin_users SET password_hash=$1, updated_at=now() WHERE id=$2`, string(next), id)
	return err
}

type UserListItem struct {
	ID                    int64               `json:"id"`
	PublicID              string              `json:"public_id"`
	Nickname              string              `json:"nickname"`
	AvatarURL             *string             `json:"avatar_url,omitempty"`
	Email                 string              `json:"email"`
	Status                string              `json:"status"`
	UserLevel             string              `json:"user_level"`
	MemberLevelID         int64               `json:"member_level_id"`
	MemberLevel           string              `json:"member_level"`
	ReferralCode          string              `json:"referral_code"`
	ReferrerID            *int64              `json:"referrer_id,omitempty"`
	ReferrerName          *string             `json:"referrer_name,omitempty"`
	DirectCount           int                 `json:"direct_count"`
	ComputeBalance        float64             `json:"compute_balance"`
	CashBalance           float64             `json:"cash_balance"`
	ApiTokenCount         int                 `json:"api_token_count"`
	ActiveApiTokenCount   int                 `json:"active_api_token_count"`
	ApiTokenLastUsedAt    *string             `json:"api_token_last_used_at,omitempty"`
	ApiTokenLastCreatedAt *string             `json:"api_token_last_created_at,omitempty"`
	ApiTokens             []AdminUserApiToken `json:"api_tokens,omitempty"`
	CreatedAt             string              `json:"created_at"`
}

func (s *AdminService) ListUsers(ctx context.Context, page, pageSize int) ([]UserListItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	var total int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&total)
	rows, err := s.db.Query(ctx, `
		SELECT u.id, u.public_id, u.nickname, u.avatar_url, u.status, u.user_level,
			COALESCE(ml.id,0), COALESCE(ml.name, u.user_level), u.referral_code, u.referrer_id, ru.nickname,
			(SELECT COUNT(*) FROM users c WHERE c.referrer_id=u.id),
			COALESCE(w.compute_balance,0), COALESCE(w.cash_balance,0), u.created_at,
			(SELECT COUNT(*) FROM api_tokens t WHERE t.user_id=u.id),
			(SELECT COUNT(*) FROM api_tokens t WHERE t.user_id=u.id AND t.status='active'),
			(SELECT MAX(t.last_used_at) FROM api_tokens t WHERE t.user_id=u.id),
			(SELECT MAX(t.created_at) FROM api_tokens t WHERE t.user_id=u.id),
			COALESCE((SELECT a.identifier FROM auth_identities a WHERE a.user_id=u.id AND a.provider='email' ORDER BY a.id LIMIT 1), '')
		FROM users u LEFT JOIN wallets w ON w.user_id = u.id
		LEFT JOIN member_levels ml ON ml.id = u.member_level_id
		LEFT JOIN users ru ON ru.id = u.referrer_id
		ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []UserListItem
	for rows.Next() {
		var u UserListItem
		var created time.Time
		var tokenLastUsed *time.Time
		var tokenLastCreated *time.Time
		rows.Scan(&u.ID, &u.PublicID, &u.Nickname, &u.AvatarURL, &u.Status, &u.UserLevel,
			&u.MemberLevelID, &u.MemberLevel, &u.ReferralCode, &u.ReferrerID, &u.ReferrerName, &u.DirectCount,
			&u.ComputeBalance, &u.CashBalance, &created, &u.ApiTokenCount, &u.ActiveApiTokenCount,
			&tokenLastUsed, &tokenLastCreated, &u.Email)
		u.CreatedAt = created.Format(time.RFC3339)
		if tokenLastUsed != nil {
			v := tokenLastUsed.Format(time.RFC3339)
			u.ApiTokenLastUsedAt = &v
		}
		if tokenLastCreated != nil {
			v := tokenLastCreated.Format(time.RFC3339)
			u.ApiTokenLastCreatedAt = &v
		}
		items = append(items, u)
	}
	for i := range items {
		items[i].ApiTokens = s.listAdminUserApiTokens(ctx, items[i].ID, true, 3)
	}
	return items, total, nil
}

type AdminUserAsset struct {
	PublicID  string  `json:"public_id"`
	Name      *string `json:"name,omitempty"`
	Kind      string  `json:"kind"`
	AssetType string  `json:"asset_type"`
	MimeType  *string `json:"mime_type,omitempty"`
	SizeBytes int64   `json:"size_bytes"`
	URL       string  `json:"url"`
	ObjectKey string  `json:"-"`
	CreatedAt string  `json:"created_at"`
}

type AdminUserRole struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	Description  *string `json:"description,omitempty"`
	SystemPrompt string  `json:"system_prompt"`
	IconURL      *string `json:"icon_url,omitempty"`
	IsDefault    bool    `json:"is_default"`
	CreatedAt    string  `json:"created_at"`
}

type AdminUserApiToken struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	Token      *string `json:"token,omitempty"`
	Status     string  `json:"status"`
	LastUsedAt *string `json:"last_used_at,omitempty"`
	CreatedAt  string  `json:"created_at"`
}

type AdminUserDetail struct {
	UserListItem
	Level          string               `json:"user_level"`
	Locale         string               `json:"locale"`
	FrozenCompute  float64              `json:"frozen_compute"`
	CashBalance    float64              `json:"cash_balance"`
	LoginProviders []string             `json:"login_providers"`
	WorksCount     int                  `json:"works_count"`
	Assets         []AdminUserAsset     `json:"assets"`
	Roles          []AdminUserRole      `json:"roles"`
	Children       []UserListItem       `json:"children"`
	Rewards        []ReferralRewardDTO  `json:"referral_rewards"`
	Withdrawals    []WithdrawalAdminDTO `json:"withdrawals"`
	ApiTokens      []AdminUserApiToken  `json:"api_tokens"`
}

type ReferralRewardDTO struct {
	ID               int64   `json:"id"`
	ReferrerID       int64   `json:"referrer_id"`
	ReferredID       int64   `json:"referred_id"`
	ReferredPublicID string  `json:"referred_public_id"`
	ReferredNickname string  `json:"referred_nickname"`
	RewardAccount    string  `json:"reward_account"`
	Amount           float64 `json:"amount"`
	TriggerType      string  `json:"trigger_type"`
	TriggerID        string  `json:"trigger_id"`
	CreatedAt        string  `json:"created_at"`
}

// GetUserDetail returns profile + wallet + uploaded assets + created prompt roles for admin view.
func (s *AdminService) GetUserDetail(ctx context.Context, userID int64) (*AdminUserDetail, error) {
	d := &AdminUserDetail{}
	var created time.Time
	var tokenLastUsed *time.Time
	var tokenLastCreated *time.Time
	err := s.db.QueryRow(ctx, `
		SELECT u.id, u.public_id, u.nickname, u.avatar_url, u.status, u.user_level,
			COALESCE(ml.id,0), COALESCE(ml.name, u.user_level), u.referral_code, u.referrer_id, ru.nickname,
			(SELECT COUNT(*) FROM users c WHERE c.referrer_id=u.id),
			u.locale, u.created_at,
			COALESCE(w.compute_balance,0), COALESCE(w.frozen_compute,0), COALESCE(w.cash_balance,0),
			(SELECT COUNT(*) FROM api_tokens t WHERE t.user_id=u.id),
			(SELECT COUNT(*) FROM api_tokens t WHERE t.user_id=u.id AND t.status='active'),
			(SELECT MAX(t.last_used_at) FROM api_tokens t WHERE t.user_id=u.id),
			(SELECT MAX(t.created_at) FROM api_tokens t WHERE t.user_id=u.id),
			COALESCE((SELECT a.identifier FROM auth_identities a WHERE a.user_id=u.id AND a.provider='email' ORDER BY a.id LIMIT 1), '')
		FROM users u LEFT JOIN wallets w ON w.user_id = u.id
		LEFT JOIN member_levels ml ON ml.id = u.member_level_id
		LEFT JOIN users ru ON ru.id = u.referrer_id
		WHERE u.id=$1`, userID).Scan(
		&d.ID, &d.PublicID, &d.Nickname, &d.AvatarURL, &d.Status, &d.Level,
		&d.MemberLevelID, &d.MemberLevel, &d.ReferralCode, &d.ReferrerID, &d.ReferrerName, &d.DirectCount,
		&d.Locale, &created,
		&d.ComputeBalance, &d.FrozenCompute, &d.CashBalance, &d.ApiTokenCount, &d.ActiveApiTokenCount,
		&tokenLastUsed, &tokenLastCreated, &d.Email)
	if err != nil {
		return nil, err
	}
	d.CreatedAt = created.Format(time.RFC3339)
	if tokenLastUsed != nil {
		v := tokenLastUsed.Format(time.RFC3339)
		d.ApiTokenLastUsedAt = &v
	}
	if tokenLastCreated != nil {
		v := tokenLastCreated.Format(time.RFC3339)
		d.ApiTokenLastCreatedAt = &v
	}

	provRows, err := s.db.Query(ctx, `SELECT DISTINCT provider FROM auth_identities WHERE user_id=$1 ORDER BY provider`, userID)
	if err == nil {
		defer provRows.Close()
		for provRows.Next() {
			var p string
			if provRows.Scan(&p) == nil {
				d.LoginProviders = append(d.LoginProviders, p)
			}
		}
	}

	d.ApiTokens = s.listAdminUserApiTokens(ctx, userID, false, 50)

	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM works WHERE user_id=$1`, userID).Scan(&d.WorksCount)

	assetRows, err := s.db.Query(ctx, `
		SELECT public_id, name, kind, asset_type, mime_type, COALESCE(size_bytes,0), object_key, created_at
		FROM assets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, userID)
	if err == nil {
		defer assetRows.Close()
		for assetRows.Next() {
			var a AdminUserAsset
			var c time.Time
			if assetRows.Scan(&a.PublicID, &a.Name, &a.Kind, &a.AssetType, &a.MimeType, &a.SizeBytes, &a.ObjectKey, &c) == nil {
				a.CreatedAt = c.Format(time.RFC3339)
				d.Assets = append(d.Assets, a)
			}
		}
	}

	roleRows, err := s.db.Query(ctx, `
		SELECT id, name, description, system_prompt, icon_url, is_default, created_at
		FROM prompt_roles WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, userID)
	if err == nil {
		defer roleRows.Close()
		for roleRows.Next() {
			var r AdminUserRole
			var c time.Time
			if roleRows.Scan(&r.ID, &r.Name, &r.Description, &r.SystemPrompt, &r.IconURL, &r.IsDefault, &c) == nil {
				r.CreatedAt = c.Format(time.RFC3339)
				d.Roles = append(d.Roles, r)
			}
		}
	}

	childRows, err := s.db.Query(ctx, `
		SELECT u.id, u.public_id, u.nickname, u.avatar_url, u.status, u.user_level,
			COALESCE(ml.id,0), COALESCE(ml.name, u.user_level), u.referral_code, u.referrer_id, ru.nickname,
			(SELECT COUNT(*) FROM users c WHERE c.referrer_id=u.id),
			COALESCE(w.compute_balance,0), COALESCE(w.cash_balance,0), u.created_at,
			COALESCE((SELECT a.identifier FROM auth_identities a WHERE a.user_id=u.id AND a.provider='email' ORDER BY a.id LIMIT 1), '')
		FROM users u
		LEFT JOIN wallets w ON w.user_id = u.id
		LEFT JOIN member_levels ml ON ml.id = u.member_level_id
		LEFT JOIN users ru ON ru.id = u.referrer_id
		WHERE u.referrer_id=$1
		ORDER BY u.created_at DESC LIMIT 50`, userID)
	if err == nil {
		defer childRows.Close()
		for childRows.Next() {
			var u UserListItem
			var c time.Time
			if childRows.Scan(&u.ID, &u.PublicID, &u.Nickname, &u.AvatarURL, &u.Status, &u.UserLevel,
				&u.MemberLevelID, &u.MemberLevel, &u.ReferralCode, &u.ReferrerID, &u.ReferrerName, &u.DirectCount,
				&u.ComputeBalance, &u.CashBalance, &c, &u.Email) == nil {
				u.CreatedAt = c.Format(time.RFC3339)
				d.Children = append(d.Children, u)
			}
		}
	}

	rewardRows, err := s.db.Query(ctx, `
		SELECT rr.id, rr.referrer_id, rr.referred_id, u.public_id, COALESCE(u.nickname,''), rr.reward_account,
		       rr.amount, rr.trigger_type, rr.trigger_id, rr.created_at
		FROM referral_rewards rr JOIN users u ON u.id = rr.referred_id
		WHERE rr.referrer_id=$1
		ORDER BY rr.created_at DESC LIMIT 50`, userID)
	if err == nil {
		defer rewardRows.Close()
		for rewardRows.Next() {
			var r ReferralRewardDTO
			var c time.Time
			if rewardRows.Scan(&r.ID, &r.ReferrerID, &r.ReferredID, &r.ReferredPublicID, &r.ReferredNickname,
				&r.RewardAccount, &r.Amount, &r.TriggerType, &r.TriggerID, &c) == nil {
				r.CreatedAt = c.Format(time.RFC3339)
				d.Rewards = append(d.Rewards, r)
			}
		}
	}

	withdrawRows, err := s.db.Query(ctx, `
		SELECT w.id, w.public_id, w.user_id, u.public_id, COALESCE(u.nickname,''), COALESCE(ai.identifier,''), w.method, w.amount, w.account_info,
		       w.status, w.admin_note, w.reviewed_at, w.paid_at, w.created_at, w.updated_at
		FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
		LEFT JOIN auth_identities ai ON ai.user_id=u.id AND ai.provider='email'
		WHERE w.user_id=$1
		ORDER BY w.created_at DESC LIMIT 20`, userID)
	if err == nil {
		defer withdrawRows.Close()
		for withdrawRows.Next() {
			item, err := scanAdminWithdrawal(withdrawRows)
			if err == nil {
				d.Withdrawals = append(d.Withdrawals, *item)
			}
		}
	}
	return d, nil
}

func (s *AdminService) listAdminUserApiTokens(ctx context.Context, userID int64, activeOnly bool, limit int) []AdminUserApiToken {
	if limit <= 0 {
		limit = 50
	}
	where := "user_id=$1"
	if activeOnly {
		where += " AND status='active'"
	}
	rows, err := s.db.Query(ctx, fmt.Sprintf(`
		SELECT id, name, prefix, token_cipher, status, last_used_at, created_at
		FROM api_tokens
		WHERE %s
		ORDER BY created_at DESC LIMIT $2`, where), userID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var items []AdminUserApiToken
	for rows.Next() {
		var t AdminUserApiToken
		var cipher *string
		var lastUsed *time.Time
		var c time.Time
		if rows.Scan(&t.ID, &t.Name, &t.Prefix, &cipher, &t.Status, &lastUsed, &c) != nil {
			continue
		}
		if cipher != nil && *cipher != "" {
			if plain, err := util.DecryptCardCode(*cipher, s.cardCipherKey); err == nil {
				t.Token = &plain
			}
		}
		t.CreatedAt = c.Format(time.RFC3339)
		if lastUsed != nil {
			v := lastUsed.Format(time.RFC3339)
			t.LastUsedAt = &v
		}
		items = append(items, t)
	}
	return items
}

func (s *AdminService) AdjustBalance(ctx context.Context, userID int64, amount float64, remark string) error {
	return s.billing.AdjustBalance(ctx, userID, amount, remark)
}

func (s *AdminService) AdjustAccountBalance(ctx context.Context, userID int64, account string, amount float64, remark string) error {
	if account == "" || account == "compute" {
		return s.billing.AdjustBalance(ctx, userID, amount, remark)
	}
	if account != "cash" {
		return fmt.Errorf("无效的余额账户")
	}
	if amount >= 0 {
		return s.billing.CreditCash(ctx, userID, amount, "admin_adjust", "admin", fmt.Sprintf("%d", userID), remark)
	}
	return s.billing.DebitCash(ctx, userID, -amount, "admin_adjust", "admin", fmt.Sprintf("%d", userID), remark)
}

// SetUserStatus freezes / bans / restores an end user account.
func (s *AdminService) SetUserStatus(ctx context.Context, userID int64, status string) error {
	if status != "active" && status != "frozen" && status != "banned" {
		return fmt.Errorf("无效的用户状态")
	}
	tag, err := s.db.Exec(ctx, `UPDATE users SET status=$1, updated_at=now() WHERE id=$2`, status, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("用户不存在")
	}
	return nil
}

type UserTransactionDTO struct {
	ID           int64   `json:"id"`
	Type         string  `json:"type"`
	Direction    string  `json:"direction"`
	Amount       float64 `json:"amount"`
	BalanceAfter float64 `json:"balance_after"`
	Remark       string  `json:"remark"`
	CreatedAt    string  `json:"created_at"`
}

// ListUserTransactions returns a user's wallet transactions for the admin user detail view.
func (s *AdminService) ListUserTransactions(ctx context.Context, userID int64, page, pageSize int) ([]UserTransactionDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	var total int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM wallet_transactions WHERE user_id=$1`, userID).Scan(&total)
	rows, err := s.db.Query(ctx, `
		SELECT id, type, direction, amount, balance_after, COALESCE(remark,''), created_at
		FROM wallet_transactions WHERE user_id=$1
		ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []UserTransactionDTO
	for rows.Next() {
		var t UserTransactionDTO
		var created time.Time
		if err := rows.Scan(&t.ID, &t.Type, &t.Direction, &t.Amount, &t.BalanceAfter, &t.Remark, &created); err != nil {
			return nil, 0, err
		}
		t.CreatedAt = created.Format(time.RFC3339)
		items = append(items, t)
	}
	return items, total, nil
}

type AdminUpdateUserInput struct {
	Email          *string  `json:"email"`
	Nickname       *string  `json:"nickname"`
	AvatarURL      *string  `json:"avatar_url"`
	Password       *string  `json:"password"`
	MemberLevelID  *int64   `json:"member_level_id"`
	ReferrerID     *int64   `json:"referrer_id"`
	ComputeBalance *float64 `json:"compute_balance"`
	CashBalance    *float64 `json:"cash_balance"`
}

func (s *AdminService) UpdateUser(ctx context.Context, userID int64, in AdminUpdateUserInput) error {
	if in.Email != nil {
		email := strings.TrimSpace(strings.ToLower(*in.Email))
		if !adminEmailRe.MatchString(email) {
			return fmt.Errorf("邮箱格式不正确")
		}
		var existUID int64
		if err := s.db.QueryRow(ctx, `SELECT user_id FROM auth_identities WHERE provider='email' AND identifier=$1 LIMIT 1`, email).Scan(&existUID); err == nil && existUID != userID {
			return fmt.Errorf("该邮箱已被其他账号使用")
		}
		tag, err := s.db.Exec(ctx, `UPDATE auth_identities SET identifier=$1 WHERE user_id=$2 AND provider='email'`, email, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			_, err = s.db.Exec(ctx, `INSERT INTO auth_identities (user_id, provider, identifier, verified) VALUES ($1,'email',$2,true)`, userID, email)
			if err != nil {
				return err
			}
		}
	}
	if in.Nickname != nil {
		s.db.Exec(ctx, `UPDATE users SET nickname=$1, updated_at=now() WHERE id=$2`, strings.TrimSpace(*in.Nickname), userID)
	}
	if in.AvatarURL != nil {
		s.db.Exec(ctx, `UPDATE users SET avatar_url=$1, updated_at=now() WHERE id=$2`, strings.TrimSpace(*in.AvatarURL), userID)
	}
	if in.Password != nil && strings.TrimSpace(*in.Password) != "" {
		if len(*in.Password) < 6 {
			return fmt.Errorf("密码至少 6 位")
		}
		h, err := bcrypt.GenerateFromPassword([]byte(*in.Password), 10)
		if err != nil {
			return err
		}
		tag, err := s.db.Exec(ctx, `UPDATE auth_identities SET credential_hash=$1 WHERE user_id=$2 AND provider='email'`, string(h), userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("该用户未绑定邮箱身份，无法设置密码")
		}
	}
	if in.MemberLevelID != nil {
		var code string
		if err := s.db.QueryRow(ctx, `SELECT code FROM member_levels WHERE id=$1 AND is_enabled=true`, *in.MemberLevelID).Scan(&code); err != nil {
			return fmt.Errorf("会员等级不存在或已禁用")
		}
		tag, err := s.db.Exec(ctx, `UPDATE users SET member_level_id=$1, user_level=$2, updated_at=now() WHERE id=$3`, *in.MemberLevelID, code, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("用户不存在")
		}
	}
	if in.ReferrerID != nil {
		if *in.ReferrerID <= 0 {
			tag, err := s.db.Exec(ctx, `UPDATE users SET referrer_id=NULL, updated_at=now() WHERE id=$1`, userID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return fmt.Errorf("用户不存在")
			}
		} else {
			if err := s.validateReferrer(ctx, userID, *in.ReferrerID); err != nil {
				return err
			}
			tag, err := s.db.Exec(ctx, `UPDATE users SET referrer_id=$1, updated_at=now() WHERE id=$2`, *in.ReferrerID, userID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return fmt.Errorf("用户不存在")
			}
		}
	}
	if in.ComputeBalance != nil {
		var current float64
		if err := s.db.QueryRow(ctx, `SELECT COALESCE(compute_balance,0) FROM wallets WHERE user_id=$1`, userID).Scan(&current); err != nil {
			return err
		}
		if diff := *in.ComputeBalance - current; diff != 0 {
			if err := s.AdjustAccountBalance(ctx, userID, "compute", diff, "管理员修改用户算力余额"); err != nil {
				return err
			}
		}
	}
	if in.CashBalance != nil {
		var current float64
		if err := s.db.QueryRow(ctx, `SELECT COALESCE(cash_balance,0) FROM wallets WHERE user_id=$1`, userID).Scan(&current); err != nil {
			return err
		}
		if diff := *in.CashBalance - current; diff != 0 {
			if err := s.AdjustAccountBalance(ctx, userID, "cash", diff, "管理员修改用户现金余额"); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *AdminService) validateReferrer(ctx context.Context, userID, referrerID int64) error {
	if userID == referrerID {
		return fmt.Errorf("上级不能是用户自己")
	}
	var exists int
	if err := s.db.QueryRow(ctx, `SELECT 1 FROM users WHERE id=$1`, referrerID).Scan(&exists); err != nil {
		return fmt.Errorf("上级用户不存在")
	}
	current := referrerID
	for i := 0; i < 100; i++ {
		var parent *int64
		if err := s.db.QueryRow(ctx, `SELECT referrer_id FROM users WHERE id=$1`, current).Scan(&parent); err != nil {
			return err
		}
		if parent == nil {
			return nil
		}
		if *parent == userID {
			return fmt.Errorf("不能形成循环推荐关系")
		}
		current = *parent
	}
	return fmt.Errorf("推荐关系层级异常")
}

type AdminUpdateUserAssetInput struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Kind        *string `json:"kind"`
	AssetType   *string `json:"asset_type"`
}

func (s *AdminService) UpdateUserAsset(ctx context.Context, userID int64, publicID string, in AdminUpdateUserAssetInput) error {
	sets := []string{}
	args := []interface{}{}
	i := 1
	if in.Name != nil {
		sets = append(sets, fmt.Sprintf("name=$%d", i))
		args = append(args, *in.Name)
		i++
	}
	if in.Description != nil {
		sets = append(sets, fmt.Sprintf("description=$%d", i))
		args = append(args, *in.Description)
		i++
	}
	if in.Kind != nil {
		sets = append(sets, fmt.Sprintf("kind=$%d", i))
		args = append(args, *in.Kind)
		i++
	}
	if in.AssetType != nil {
		sets = append(sets, fmt.Sprintf("asset_type=$%d", i))
		args = append(args, *in.AssetType)
		i++
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, userID, publicID)
	q := fmt.Sprintf(`UPDATE assets SET %s WHERE user_id=$%d AND public_id=$%d`, strings.Join(sets, ", "), i, i+1)
	tag, err := s.db.Exec(ctx, q, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("资产不存在")
	}
	return nil
}

func (s *AdminService) DeleteUserAsset(ctx context.Context, userID int64, publicID string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM assets WHERE user_id=$1 AND public_id=$2`, userID, publicID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("资产不存在")
	}
	return nil
}

type AdminUpdateUserRoleInput struct {
	Name         *string `json:"name"`
	Description  *string `json:"description"`
	SystemPrompt *string `json:"system_prompt"`
	IconURL      *string `json:"icon_url"`
	IsDefault    *bool   `json:"is_default"`
}

func (s *AdminService) UpdateUserRole(ctx context.Context, userID int64, roleID int64, in AdminUpdateUserRoleInput) error {
	sets := []string{"updated_at=now()"}
	args := []interface{}{}
	i := 1
	if in.Name != nil {
		sets = append(sets, fmt.Sprintf("name=$%d", i))
		args = append(args, *in.Name)
		i++
	}
	if in.Description != nil {
		sets = append(sets, fmt.Sprintf("description=$%d", i))
		args = append(args, *in.Description)
		i++
	}
	if in.SystemPrompt != nil {
		sets = append(sets, fmt.Sprintf("system_prompt=$%d", i))
		args = append(args, *in.SystemPrompt)
		i++
	}
	if in.IconURL != nil {
		sets = append(sets, fmt.Sprintf("icon_url=$%d", i))
		args = append(args, *in.IconURL)
		i++
	}
	if in.IsDefault != nil && *in.IsDefault {
		s.db.Exec(ctx, `UPDATE prompt_roles SET is_default=false, updated_at=now() WHERE user_id=$1`, userID)
		sets = append(sets, fmt.Sprintf("is_default=$%d", i))
		args = append(args, true)
		i++
	} else if in.IsDefault != nil {
		sets = append(sets, fmt.Sprintf("is_default=$%d", i))
		args = append(args, false)
		i++
	}
	if len(sets) <= 1 {
		return nil
	}
	args = append(args, userID, roleID)
	q := fmt.Sprintf(`UPDATE prompt_roles SET %s WHERE user_id=$%d AND id=$%d`, strings.Join(sets, ", "), i, i+1)
	tag, err := s.db.Exec(ctx, q, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("角色不存在")
	}
	return nil
}

func (s *AdminService) DeleteUserRole(ctx context.Context, userID int64, roleID int64) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM prompt_roles WHERE user_id=$1 AND id=$2`, userID, roleID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("角色不存在")
	}
	return nil
}

type MemberLevelDTO struct {
	ID                    int64   `json:"id"`
	Code                  string  `json:"code"`
	Name                  string  `json:"name"`
	ReferralRewardAmount  float64 `json:"referral_reward_amount"`
	ReferralRewardAccount string  `json:"referral_reward_account"`
	ReferralRewardType    string  `json:"referral_reward_type"`
	ReferralRewardTrigger string  `json:"referral_reward_trigger"`
	IsDefault             bool    `json:"is_default"`
	IsEnabled             bool    `json:"is_enabled"`
	SortOrder             int     `json:"sort_order"`
	CreatedAt             string  `json:"created_at"`
	UpdatedAt             string  `json:"updated_at"`
}

type MemberLevelInput struct {
	Code                  string  `json:"code"`
	Name                  string  `json:"name"`
	ReferralRewardAmount  float64 `json:"referral_reward_amount"`
	ReferralRewardAccount string  `json:"referral_reward_account"`
	ReferralRewardType    string  `json:"referral_reward_type"`
	ReferralRewardTrigger string  `json:"referral_reward_trigger"`
	IsDefault             bool    `json:"is_default"`
	IsEnabled             *bool   `json:"is_enabled"`
	SortOrder             int     `json:"sort_order"`
}

func (s *AdminService) ListMemberLevels(ctx context.Context) ([]MemberLevelDTO, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, code, name, referral_reward_amount, referral_reward_account,
		       COALESCE(referral_reward_type,'fixed'), COALESCE(referral_reward_trigger,'first_recharge'),
		       is_default, is_enabled, sort_order, created_at, updated_at
		FROM member_levels ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []MemberLevelDTO
	for rows.Next() {
		var item MemberLevelDTO
		var created, updated time.Time
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.ReferralRewardAmount, &item.ReferralRewardAccount,
			&item.ReferralRewardType, &item.ReferralRewardTrigger, &item.IsDefault, &item.IsEnabled, &item.SortOrder, &created, &updated); err != nil {
			return nil, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		item.UpdatedAt = updated.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, nil
}

func (s *AdminService) UpsertMemberLevel(ctx context.Context, in MemberLevelInput) (*MemberLevelDTO, error) {
	code := strings.TrimSpace(in.Code)
	name := strings.TrimSpace(in.Name)
	if code == "" || name == "" {
		return nil, fmt.Errorf("等级代码和名称不能为空")
	}
	if in.ReferralRewardAccount == "" {
		in.ReferralRewardAccount = "compute"
	}
	if in.ReferralRewardAccount != "compute" && in.ReferralRewardAccount != "cash" {
		return nil, fmt.Errorf("奖励账户类型无效")
	}
	if in.ReferralRewardType == "" {
		in.ReferralRewardType = "fixed"
	}
	if in.ReferralRewardType != "fixed" && in.ReferralRewardType != "percent" {
		return nil, fmt.Errorf("奖励计算方式无效")
	}
	if in.ReferralRewardTrigger == "" {
		in.ReferralRewardTrigger = "first_recharge"
	}
	if in.ReferralRewardTrigger != "first_recharge" && in.ReferralRewardTrigger != "every_recharge" {
		return nil, fmt.Errorf("奖励触发方式无效")
	}
	if in.ReferralRewardAmount < 0 {
		return nil, fmt.Errorf("奖励金额不能小于 0")
	}
	enabled := true
	if in.IsEnabled != nil {
		enabled = *in.IsEnabled
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if in.IsDefault {
		if _, err = tx.Exec(ctx, `UPDATE member_levels SET is_default=false, updated_at=now()`); err != nil {
			return nil, err
		}
	}
	var item MemberLevelDTO
	var created, updated time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO member_levels (code, name, referral_reward_amount, referral_reward_account, referral_reward_type, referral_reward_trigger, is_default, is_enabled, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (code) DO UPDATE SET
			name=EXCLUDED.name,
			referral_reward_amount=EXCLUDED.referral_reward_amount,
			referral_reward_account=EXCLUDED.referral_reward_account,
			referral_reward_type=EXCLUDED.referral_reward_type,
			referral_reward_trigger=EXCLUDED.referral_reward_trigger,
			is_default=EXCLUDED.is_default,
			is_enabled=EXCLUDED.is_enabled,
			sort_order=EXCLUDED.sort_order,
			updated_at=now()
		RETURNING id, code, name, referral_reward_amount, referral_reward_account, referral_reward_type, referral_reward_trigger, is_default, is_enabled, sort_order, created_at, updated_at`,
		code, name, in.ReferralRewardAmount, in.ReferralRewardAccount, in.ReferralRewardType, in.ReferralRewardTrigger, in.IsDefault, enabled, in.SortOrder).Scan(
		&item.ID, &item.Code, &item.Name, &item.ReferralRewardAmount, &item.ReferralRewardAccount,
		&item.ReferralRewardType, &item.ReferralRewardTrigger, &item.IsDefault, &item.IsEnabled, &item.SortOrder, &created, &updated)
	if err != nil {
		return nil, err
	}
	var hasDefault bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM member_levels WHERE is_default=true)`).Scan(&hasDefault); err != nil {
		return nil, err
	}
	if !hasDefault {
		if _, err = tx.Exec(ctx, `UPDATE member_levels SET is_default=true, is_enabled=true, updated_at=now() WHERE code='normal'`); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	item.UpdatedAt = updated.Format(time.RFC3339)
	return &item, nil
}

type WithdrawalAdminDTO struct {
	ID           int64                  `json:"id"`
	PublicID     string                 `json:"public_id"`
	UserID       int64                  `json:"user_id"`
	UserPublicID string                 `json:"user_public_id"`
	Nickname     string                 `json:"nickname"`
	Email        string                 `json:"email"`
	Method       string                 `json:"method"`
	Amount       float64                `json:"amount"`
	AccountInfo  map[string]interface{} `json:"account_info"`
	Status       string                 `json:"status"`
	AdminNote    *string                `json:"admin_note,omitempty"`
	ReviewedAt   *string                `json:"reviewed_at,omitempty"`
	PaidAt       *string                `json:"paid_at,omitempty"`
	CreatedAt    string                 `json:"created_at"`
	UpdatedAt    string                 `json:"updated_at"`
}

type WithdrawalReviewInput struct {
	Status    string `json:"status"`
	AdminNote string `json:"admin_note"`
}

type WithdrawalListFilter struct {
	Status    string
	Keyword   string
	StartDate string
	EndDate   string
}

func (s *AdminService) ListWithdrawals(ctx context.Context, filter WithdrawalListFilter, page, pageSize int) ([]WithdrawalAdminDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	whereParts := []string{}
	args := []interface{}{}
	if filter.Status != "" {
		args = append(args, filter.Status)
		whereParts = append(whereParts, fmt.Sprintf("w.status=$%d", len(args)))
	}
	if kw := strings.TrimSpace(filter.Keyword); kw != "" {
		args = append(args, "%"+strings.ToLower(kw)+"%")
		whereParts = append(whereParts, fmt.Sprintf(`(
			LOWER(COALESCE(u.nickname,'')) LIKE $%d OR
			LOWER(u.public_id) LIKE $%d OR
			LOWER(COALESCE(ai.identifier,'')) LIKE $%d OR
			LOWER(w.public_id) LIKE $%d
		)`, len(args), len(args), len(args), len(args)))
	}
	if filter.StartDate != "" {
		args = append(args, filter.StartDate)
		whereParts = append(whereParts, fmt.Sprintf("w.created_at >= $%d::date", len(args)))
	}
	if filter.EndDate != "" {
		args = append(args, filter.EndDate)
		whereParts = append(whereParts, fmt.Sprintf("w.created_at < ($%d::date + INTERVAL '1 day')", len(args)))
	}
	where := ""
	if len(whereParts) > 0 {
		where = "WHERE " + strings.Join(whereParts, " AND ")
	}
	var total int
	countSQL := `
		SELECT COUNT(*) FROM withdrawal_requests w
		JOIN users u ON u.id = w.user_id
		LEFT JOIN auth_identities ai ON ai.user_id=u.id AND ai.provider='email'
		` + where
	if err := s.db.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, pageSize, (page-1)*pageSize)
	limitIndex := len(args) - 1
	offsetIndex := len(args)
	rows, err := s.db.Query(ctx, fmt.Sprintf(`
		SELECT w.id, w.public_id, w.user_id, u.public_id, COALESCE(u.nickname,''), COALESCE(ai.identifier,''), w.method, w.amount, w.account_info,
		       w.status, w.admin_note, w.reviewed_at, w.paid_at, w.created_at, w.updated_at
		FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
		LEFT JOIN auth_identities ai ON ai.user_id=u.id AND ai.provider='email'
		%s
		ORDER BY w.created_at DESC, w.id DESC LIMIT $%d OFFSET $%d`, where, limitIndex, offsetIndex), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []WithdrawalAdminDTO
	for rows.Next() {
		item, err := scanAdminWithdrawal(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, *item)
	}
	return items, total, nil
}

func (s *AdminService) ReviewWithdrawal(ctx context.Context, adminID, withdrawalID int64, in WithdrawalReviewInput) error {
	if in.Status != "approved" && in.Status != "rejected" && in.Status != "paid" {
		return fmt.Errorf("提现状态无效")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var userID int64
	var amount float64
	var status string
	if err = tx.QueryRow(ctx, `SELECT user_id, amount, status FROM withdrawal_requests WHERE id=$1 FOR UPDATE`, withdrawalID).Scan(&userID, &amount, &status); err != nil {
		return err
	}
	if status != "pending" && !(status == "approved" && (in.Status == "paid" || in.Status == "rejected")) {
		return fmt.Errorf("当前提现状态不允许此操作")
	}
	nowSet := "reviewed_at=now()"
	if in.Status == "paid" {
		nowSet = "reviewed_at=COALESCE(reviewed_at, now()), paid_at=now()"
	}
	tag, err := tx.Exec(ctx, fmt.Sprintf(`
		UPDATE withdrawal_requests
		SET status=$1, admin_note=$2, reviewed_by=$3, %s, updated_at=now()
		WHERE id=$4`, nowSet), in.Status, in.AdminNote, adminID, withdrawalID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("提现申请不存在")
	}
	refID := fmt.Sprintf("%d", withdrawalID)
	if status == "pending" && (in.Status == "approved" || in.Status == "paid") {
		var deducted int
		if err = tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM cash_transactions
			WHERE user_id=$1 AND type='withdrawal' AND direction='out' AND ref_type='withdrawal' AND ref_id=$2`, userID, refID).Scan(&deducted); err != nil {
			return err
		}
		if deducted == 0 {
			var balance float64
			if err = tx.QueryRow(ctx, `SELECT cash_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance); err != nil {
				return err
			}
			if balance < amount {
				return billing.ErrInsufficientBalance
			}
			newBalance := balance - amount
			if _, err = tx.Exec(ctx, `UPDATE wallets SET cash_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `
				INSERT INTO cash_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
				VALUES ($1,'withdrawal','out',$2,$3,'withdrawal',$4,$5)`,
				userID, amount, newBalance, refID, "提现审核通过扣除"); err != nil {
				return err
			}
		}
	}
	if in.Status == "rejected" {
		var deducted int
		if err = tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM cash_transactions
			WHERE user_id=$1 AND type='withdrawal' AND direction='out' AND ref_type='withdrawal' AND ref_id=$2`, userID, refID).Scan(&deducted); err != nil {
			return err
		}
		if deducted > 0 {
			var refunded int
			if err = tx.QueryRow(ctx, `
				SELECT COUNT(*) FROM cash_transactions
				WHERE user_id=$1 AND type='withdrawal_refund' AND direction='in' AND ref_type='withdrawal' AND ref_id=$2`, userID, refID).Scan(&refunded); err != nil {
				return err
			}
			if refunded == 0 {
				var balance float64
				if err = tx.QueryRow(ctx, `SELECT cash_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance); err != nil {
					return err
				}
				newBalance := balance + amount
				if _, err = tx.Exec(ctx, `UPDATE wallets SET cash_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID); err != nil {
					return err
				}
				if _, err = tx.Exec(ctx, `
					INSERT INTO cash_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
					VALUES ($1,'withdrawal_refund','in',$2,$3,'withdrawal',$4,$5)`,
					userID, amount, newBalance, refID, "提现驳回退回"); err != nil {
					return err
				}
			}
		}
	}
	return tx.Commit(ctx)
}

func scanAdminWithdrawal(row scanner) (*WithdrawalAdminDTO, error) {
	var item WithdrawalAdminDTO
	var info []byte
	var reviewedAt, paidAt *time.Time
	var created, updated time.Time
	if err := row.Scan(&item.ID, &item.PublicID, &item.UserID, &item.UserPublicID, &item.Nickname, &item.Email, &item.Method, &item.Amount,
		&info, &item.Status, &item.AdminNote, &reviewedAt, &paidAt, &created, &updated); err != nil {
		return nil, err
	}
	_ = json.Unmarshal(info, &item.AccountInfo)
	if item.AccountInfo == nil {
		item.AccountInfo = map[string]interface{}{}
	}
	if reviewedAt != nil {
		v := reviewedAt.Format(time.RFC3339)
		item.ReviewedAt = &v
	}
	if paidAt != nil {
		v := paidAt.Format(time.RFC3339)
		item.PaidAt = &v
	}
	item.CreatedAt = created.Format(time.RFC3339)
	item.UpdatedAt = updated.Format(time.RFC3339)
	return &item, nil
}

type CardBatchInput struct {
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Value    float64 `json:"value"`
	Quantity int     `json:"quantity"`
}

type CardBatchDTO struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Value     float64 `json:"value"`
	Quantity  int     `json:"quantity"`
	CreatedAt string  `json:"created_at"`
}

func (s *AdminService) CreateCardBatch(ctx context.Context, adminID int64, input CardBatchInput) (*CardBatchDTO, []string, error) {
	if input.Quantity < 1 || input.Quantity > 1000 {
		return nil, nil, fmt.Errorf("数量须在 1-1000 之间")
	}
	if input.Type == "" {
		input.Type = "compute"
	}
	var batchID int64
	err := s.db.QueryRow(ctx, `
		INSERT INTO recharge_card_batches (name, type, value, quantity, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		input.Name, input.Type, input.Value, input.Quantity, adminID).Scan(&batchID)
	if err != nil {
		return nil, nil, err
	}
	var codes []string
	for i := 0; i < input.Quantity; i++ {
		code := generateCardCode()
		hash := util.HashCardCode(code)
		cipher, err := util.EncryptCardCode(code, s.cardCipherKey)
		if err != nil {
			return nil, nil, fmt.Errorf("加密卡密失败: %w", err)
		}
		_, err = s.db.Exec(ctx,
			`INSERT INTO recharge_cards (batch_id, code_hash, code_cipher, type, value, status) VALUES ($1,$2,$3,$4,$5,'unused')`,
			batchID, hash, cipher, input.Type, input.Value)
		if err != nil {
			return nil, nil, err
		}
		codes = append(codes, code)
	}
	now := time.Now().Format(time.RFC3339)
	return &CardBatchDTO{ID: batchID, Name: input.Name, Type: input.Type, Value: input.Value, Quantity: input.Quantity, CreatedAt: now}, codes, nil
}

func generateCardCode() string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("STARAI-%s", hex.EncodeToString(b)[:12])
}

func (s *AdminService) ListCardBatches(ctx context.Context) ([]CardBatchDTO, error) {
	rows, err := s.db.Query(ctx, `SELECT id, name, type, value, quantity, created_at FROM recharge_card_batches ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []CardBatchDTO
	for rows.Next() {
		var b CardBatchDTO
		var created time.Time
		rows.Scan(&b.ID, &b.Name, &b.Type, &b.Value, &b.Quantity, &created)
		b.CreatedAt = created.Format(time.RFC3339)
		items = append(items, b)
	}
	return items, nil
}

func (s *AdminService) GetSystemConfigs(ctx context.Context) (map[string]interface{}, error) {
	rows, err := s.db.Query(ctx, `SELECT key, value FROM system_configs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]interface{})
	for rows.Next() {
		var key string
		var value []byte
		rows.Scan(&key, &value)
		var v interface{}
		json.Unmarshal(value, &v)
		if isSensitiveConfigKey(key) {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				v = maskAdminSecret(s)
			}
		}
		result[key] = v
	}
	return result, nil
}

func (s *AdminService) UpdateSystemConfig(ctx context.Context, key string, value interface{}) error {
	if isSensitiveConfigKey(key) {
		if text, ok := value.(string); ok && isMaskedAdminSecret(text) {
			return nil
		}
	}
	data, _ := json.Marshal(value)
	_, err := s.db.Exec(ctx, `
		INSERT INTO system_configs (key, value, updated_at) VALUES ($1,$2,now())
		ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, key, data)
	return err
}

// CheckContentSafety checks only string values in user input. It deliberately
// stores neither the submitted content nor the matched term.
func (s *AdminService) CheckContentSafety(ctx context.Context, userID int64, source string, input interface{}) (bool, error) {
	var enabledRaw, termsRaw []byte
	if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='content_safety_enabled'`).Scan(&enabledRaw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	var enabled bool
	if json.Unmarshal(enabledRaw, &enabled) != nil || !enabled {
		return false, nil
	}
	if err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='content_safety_blocked_terms'`).Scan(&termsRaw); err != nil {
		return false, err
	}
	terms := parseBlockedTerms(termsRaw)
	if len(terms) == 0 {
		return false, nil
	}
	var generic interface{}
	raw, err := json.Marshal(input)
	if err != nil || json.Unmarshal(raw, &generic) != nil {
		return false, errors.New("内容安全检查无法解析输入")
	}
	texts := collectStringValues(generic, nil)
	for _, term := range terms {
		needle := strings.ToLower(strings.TrimSpace(term))
		if needle == "" {
			continue
		}
		for _, text := range texts {
			if strings.Contains(strings.ToLower(text), needle) {
				digest := sha256.Sum256([]byte(needle))
				_, err := s.db.Exec(ctx, `
					INSERT INTO content_safety_events (user_id, source, matched_term_digest)
					VALUES ($1,$2,$3)`, userID, source, hex.EncodeToString(digest[:]))
				return true, err
			}
		}
	}
	return false, nil
}

func parseBlockedTerms(raw []byte) []string {
	var terms []string
	if json.Unmarshal(raw, &terms) == nil {
		return terms
	}
	var encoded string
	if json.Unmarshal(raw, &encoded) == nil {
		_ = json.Unmarshal([]byte(encoded), &terms)
	}
	return terms
}

func collectStringValues(v interface{}, out []string) []string {
	switch value := v.(type) {
	case string:
		return append(out, value)
	case []string:
		return append(out, value...)
	case []interface{}:
		for _, item := range value {
			out = collectStringValues(item, out)
		}
	case map[string]interface{}:
		for _, item := range value {
			out = collectStringValues(item, out)
		}
	}
	return out
}

func (s *AdminService) LogOperation(ctx context.Context, adminID int64, action, targetType, targetID string, detail map[string]interface{}) {
	data, _ := json.Marshal(redactSensitiveDetail(detail))
	s.db.Exec(ctx, `INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5)`,
		adminID, action, targetType, targetID, data)
}

func isSensitiveConfigKey(key string) bool {
	k := strings.ToLower(key)
	return strings.Contains(k, "api_key") || strings.Contains(k, "token") || strings.Contains(k, "secret") || strings.Contains(k, "password")
}

func isSensitiveDetailKey(key string) bool {
	k := strings.ToLower(key)
	return strings.Contains(k, "api_key") || strings.Contains(k, "token") || strings.Contains(k, "secret") || strings.Contains(k, "password") || strings.Contains(k, "authorization")
}

func redactSensitiveDetail(v interface{}) interface{} {
	switch x := v.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(x))
		for k, val := range x {
			if isSensitiveDetailKey(k) {
				out[k] = "****"
			} else {
				out[k] = redactSensitiveDetail(val)
			}
		}
		return out
	case []interface{}:
		out := make([]interface{}, 0, len(x))
		for _, val := range x {
			out = append(out, redactSensitiveDetail(val))
		}
		return out
	default:
		return v
	}
}

func isMaskedAdminSecret(v string) bool {
	return strings.Contains(v, "***")
}

func maskAdminSecret(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	r := []rune(v)
	if len(r) <= 8 {
		return "****"
	}
	return string(r[:4]) + "****" + string(r[len(r)-4:])
}

type OperationLogDTO struct {
	ID         int64                  `json:"id"`
	AdminEmail string                 `json:"admin_email"`
	Action     string                 `json:"action"`
	TargetType *string                `json:"target_type,omitempty"`
	TargetID   *string                `json:"target_id,omitempty"`
	Detail     map[string]interface{} `json:"detail"`
	CreatedAt  string                 `json:"created_at"`
}

type OperationLogFilter struct {
	Admin     string
	StartDate string
	EndDate   string
}

func (s *AdminService) ListOperationLogs(ctx context.Context, page, pageSize int, filter OperationLogFilter) ([]OperationLogDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	where, args := buildOperationLogWhere(filter)
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM admin_operation_logs l LEFT JOIN admin_users a ON a.id = l.admin_id `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(ctx, `
		SELECT l.id, COALESCE(a.email,''), l.action, l.target_type, l.target_id, l.detail, l.created_at
		FROM admin_operation_logs l LEFT JOIN admin_users a ON a.id = l.admin_id
		`+where+fmt.Sprintf(` ORDER BY l.created_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []OperationLogDTO
	for rows.Next() {
		var l OperationLogDTO
		var detail []byte
		var created time.Time
		if err := rows.Scan(&l.ID, &l.AdminEmail, &l.Action, &l.TargetType, &l.TargetID, &detail, &created); err != nil {
			return nil, 0, err
		}
		json.Unmarshal(detail, &l.Detail)
		l.CreatedAt = created.Format(time.RFC3339)
		items = append(items, l)
	}
	return items, total, nil
}

func buildOperationLogWhere(filter OperationLogFilter) (string, []interface{}) {
	conds := []string{}
	args := []interface{}{}
	if admin := strings.TrimSpace(filter.Admin); admin != "" {
		args = append(args, "%"+strings.ToLower(admin)+"%")
		conds = append(conds, fmt.Sprintf("LOWER(COALESCE(a.email,'')) LIKE $%d", len(args)))
	}
	if start := strings.TrimSpace(filter.StartDate); start != "" {
		args = append(args, start)
		conds = append(conds, fmt.Sprintf("l.created_at >= $%d::date", len(args)))
	}
	if end := strings.TrimSpace(filter.EndDate); end != "" {
		args = append(args, end)
		conds = append(conds, fmt.Sprintf("l.created_at < ($%d::date + INTERVAL '1 day')", len(args)))
	}
	if len(conds) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

func (s *AdminService) GetOperationLog(ctx context.Context, id int64) (*OperationLogDTO, error) {
	var l OperationLogDTO
	var detail []byte
	var created time.Time
	err := s.db.QueryRow(ctx, `
		SELECT l.id, COALESCE(a.email,''), l.action, l.target_type, l.target_id, l.detail, l.created_at
		FROM admin_operation_logs l LEFT JOIN admin_users a ON a.id = l.admin_id
		WHERE l.id=$1`, id).Scan(&l.ID, &l.AdminEmail, &l.Action, &l.TargetType, &l.TargetID, &detail, &created)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(detail, &l.Detail)
	l.CreatedAt = created.Format(time.RFC3339)
	return &l, nil
}

func (s *AdminService) DeleteOperationLog(ctx context.Context, id int64) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM admin_operation_logs WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *AdminService) ClearOperationLogs(ctx context.Context) error {
	_, err := s.db.Exec(ctx, `DELETE FROM admin_operation_logs`)
	return err
}

type AICallLogDTO struct {
	ID           int64   `json:"id"`
	RequestID    string  `json:"request_id"`
	UserPublicID string  `json:"user_public_id"`
	ModelCode    *string `json:"model_code,omitempty"`
	PromptTokens int     `json:"prompt_tokens"`
	TotalTokens  int     `json:"total_tokens"`
	Cost         float64 `json:"cost"`
	Status       string  `json:"status"`
	ErrorCode    *string `json:"error_code,omitempty"`
	DurationMs   int     `json:"duration_ms"`
	CreatedAt    string  `json:"created_at"`
}

func (s *AdminService) ListAICallLogs(ctx context.Context, page, pageSize int) ([]AICallLogDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	var total int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM ai_call_logs`).Scan(&total)
	rows, err := s.db.Query(ctx, `
		SELECT l.id, l.request_id, u.public_id, m.code, l.prompt_tokens, l.total_tokens, l.cost, l.status, l.error_code, l.duration_ms, l.created_at
		FROM ai_call_logs l JOIN users u ON u.id = l.user_id LEFT JOIN models m ON m.id = l.model_id
		ORDER BY l.created_at DESC LIMIT $1 OFFSET $2`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []AICallLogDTO
	for rows.Next() {
		var l AICallLogDTO
		var created time.Time
		if err := rows.Scan(&l.ID, &l.RequestID, &l.UserPublicID, &l.ModelCode, &l.PromptTokens, &l.TotalTokens, &l.Cost, &l.Status, &l.ErrorCode, &l.DurationMs, &created); err != nil {
			return nil, 0, err
		}
		l.CreatedAt = created.Format(time.RFC3339)
		items = append(items, l)
	}
	return items, total, nil
}

type CardDTO struct {
	ID        int64   `json:"id"`
	Code      string  `json:"code"`
	Value     float64 `json:"value"`
	Status    string  `json:"status"`
	UsedBy    *int64  `json:"used_by,omitempty"`
	UsedAt    *string `json:"used_at,omitempty"`
	CreatedAt string  `json:"created_at"`
}

func (s *AdminService) ListBatchCards(ctx context.Context, batchID int64) ([]CardDTO, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, code_cipher, value, status, used_by, used_at, created_at FROM recharge_cards WHERE batch_id=$1 ORDER BY id`, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []CardDTO
	for rows.Next() {
		var c CardDTO
		var cipher *string
		var usedAt *time.Time
		var created time.Time
		if err := rows.Scan(&c.ID, &cipher, &c.Value, &c.Status, &c.UsedBy, &usedAt, &created); err != nil {
			return nil, err
		}
		c.CreatedAt = created.Format(time.RFC3339)
		if usedAt != nil {
			us := usedAt.Format(time.RFC3339)
			c.UsedAt = &us
		}
		if cipher != nil && *cipher != "" {
			if plain, err := util.DecryptCardCode(*cipher, s.cardCipherKey); err == nil {
				c.Code = plain
			}
		}
		items = append(items, c)
	}
	return items, nil
}

func (s *AdminService) DisableCard(ctx context.Context, cardID int64) error {
	_, err := s.db.Exec(ctx,
		`UPDATE recharge_cards SET status='disabled' WHERE id=$1 AND status='unused'`, cardID)
	return err
}
