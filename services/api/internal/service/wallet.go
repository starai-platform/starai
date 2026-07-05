package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/util"
)

type WalletService struct {
	db      *pgxpool.Pool
	billing *billing.Service
}

func NewWalletService(db *pgxpool.Pool, billing *billing.Service) *WalletService {
	return &WalletService{db: db, billing: billing}
}

type WalletInfo struct {
	ComputeBalance float64 `json:"compute_balance"`
	FrozenCompute  float64 `json:"frozen_compute"`
	CashBalance    float64 `json:"cash_balance"`
}

func (s *WalletService) GetWallet(ctx context.Context, userID int64) (*WalletInfo, error) {
	var w WalletInfo
	var cash float64
	err := s.db.QueryRow(ctx,
		`SELECT compute_balance, frozen_compute, cash_balance FROM wallets WHERE user_id=$1`, userID,
	).Scan(&w.ComputeBalance, &w.FrozenCompute, &cash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &WalletInfo{}, nil
		}
		return nil, err
	}
	w.CashBalance = cash
	return &w, nil
}

type TransactionItem struct {
	ID           int64   `json:"id"`
	Type         string  `json:"type"`
	Direction    string  `json:"direction"`
	Amount       float64 `json:"amount"`
	BalanceAfter float64 `json:"balance_after"`
	RefType      *string `json:"ref_type,omitempty"`
	RefID        *string `json:"ref_id,omitempty"`
	Remark       *string `json:"remark,omitempty"`
	CreatedAt    string  `json:"created_at"`
}

type CashTransactionItem struct {
	ID           int64   `json:"id"`
	Type         string  `json:"type"`
	Direction    string  `json:"direction"`
	Amount       float64 `json:"amount"`
	BalanceAfter float64 `json:"balance_after"`
	RefType      *string `json:"ref_type,omitempty"`
	RefID        *string `json:"ref_id,omitempty"`
	Remark       *string `json:"remark,omitempty"`
	CreatedAt    string  `json:"created_at"`
}

func (s *WalletService) ListCashTransactions(ctx context.Context, userID int64, page, pageSize int) ([]CashTransactionItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM cash_transactions WHERE user_id=$1`, userID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, type, direction, amount, balance_after, ref_type, ref_id, remark, created_at
		FROM cash_transactions WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
		userID, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []CashTransactionItem
	for rows.Next() {
		var item CashTransactionItem
		var created time.Time
		if err := rows.Scan(&item.ID, &item.Type, &item.Direction, &item.Amount, &item.BalanceAfter,
			&item.RefType, &item.RefID, &item.Remark, &created); err != nil {
			return nil, 0, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, total, nil
}

type WithdrawalRequestInput struct {
	Method      string                 `json:"method"`
	Amount      float64                `json:"amount"`
	AccountInfo map[string]interface{} `json:"account_info"`
}

type WithdrawalRequestDTO struct {
	ID          int64                  `json:"id"`
	PublicID    string                 `json:"public_id"`
	Method      string                 `json:"method"`
	Amount      float64                `json:"amount"`
	AccountInfo map[string]interface{} `json:"account_info"`
	Status      string                 `json:"status"`
	AdminNote   *string                `json:"admin_note,omitempty"`
	ReviewedAt  *string                `json:"reviewed_at,omitempty"`
	PaidAt      *string                `json:"paid_at,omitempty"`
	CreatedAt   string                 `json:"created_at"`
	UpdatedAt   string                 `json:"updated_at"`
}

func (s *WalletService) CreateWithdrawal(ctx context.Context, userID int64, in WithdrawalRequestInput) (*WithdrawalRequestDTO, error) {
	method := strings.TrimSpace(strings.ToLower(in.Method))
	if method != "bank" && method != "wechat" && method != "alipay" && method != "paypal" {
		return nil, errors.New("提现方式无效")
	}
	if in.Amount <= 0 {
		return nil, errors.New("提现金额必须大于 0")
	}
	if in.AccountInfo == nil {
		in.AccountInfo = map[string]interface{}{}
	}
	data, _ := json.Marshal(in.AccountInfo)
	publicID := util.NewPublicID("wd")
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var cash float64
	if err := tx.QueryRow(ctx, `SELECT cash_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&cash); err != nil {
		return nil, err
	}
	if cash < in.Amount {
		return nil, errors.New("现金余额不足")
	}
	newBalance := cash - in.Amount
	if _, err := tx.Exec(ctx, `UPDATE wallets SET cash_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID); err != nil {
		return nil, err
	}
	var id int64
	var created, updated time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO withdrawal_requests (public_id, user_id, method, amount, account_info)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, created_at, updated_at`, publicID, userID, method, in.Amount, data).Scan(&id, &created, &updated)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO cash_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
		VALUES ($1,'withdrawal','out',$2,$3,'withdrawal',$4,'提现申请扣除')`,
		userID, in.Amount, newBalance, fmt.Sprintf("%d", id)); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &WithdrawalRequestDTO{
		ID: id, PublicID: publicID, Method: method, Amount: in.Amount, AccountInfo: in.AccountInfo,
		Status: "pending", CreatedAt: created.Format(time.RFC3339), UpdatedAt: updated.Format(time.RFC3339),
	}, nil
}

func (s *WalletService) ListWithdrawals(ctx context.Context, userID int64, page, pageSize int) ([]WithdrawalRequestDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM withdrawal_requests WHERE user_id=$1`, userID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, public_id, method, amount, account_info, status, admin_note, reviewed_at, paid_at, created_at, updated_at
		FROM withdrawal_requests WHERE user_id=$1
		ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []WithdrawalRequestDTO
	for rows.Next() {
		item, err := scanWithdrawal(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, *item)
	}
	return items, total, nil
}

type scanner interface {
	Scan(dest ...interface{}) error
}

func scanWithdrawal(row scanner) (*WithdrawalRequestDTO, error) {
	var item WithdrawalRequestDTO
	var info []byte
	var reviewedAt, paidAt *time.Time
	var created, updated time.Time
	if err := row.Scan(&item.ID, &item.PublicID, &item.Method, &item.Amount, &info, &item.Status, &item.AdminNote, &reviewedAt, &paidAt, &created, &updated); err != nil {
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

type ReferralSummaryDTO struct {
	ReferralCode  string             `json:"referral_code"`
	ReferrerID    *int64             `json:"referrer_id,omitempty"`
	ReferrerName  *string            `json:"referrer_name,omitempty"`
	DirectCount   int                `json:"direct_count"`
	RewardCompute float64            `json:"reward_compute"`
	RewardCash    float64            `json:"reward_cash"`
	Children      []ReferralChildDTO `json:"children"`
}

type ReferralChildDTO struct {
	ID             int64   `json:"id"`
	PublicID       string  `json:"public_id"`
	Nickname       string  `json:"nickname"`
	Email          string  `json:"email"`
	RechargeAmount float64 `json:"recharge_amount"`
	CreatedAt      string  `json:"created_at"`
}

func (s *WalletService) ReferralSummary(ctx context.Context, userID int64) (*ReferralSummaryDTO, error) {
	var out ReferralSummaryDTO
	if err := s.db.QueryRow(ctx, `
		SELECT u.referral_code, u.referrer_id, ru.nickname
		FROM users u LEFT JOIN users ru ON ru.id = u.referrer_id
		WHERE u.id=$1`, userID).Scan(&out.ReferralCode, &out.ReferrerID, &out.ReferrerName); err != nil {
		return nil, err
	}
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE referrer_id=$1`, userID).Scan(&out.DirectCount)
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM referral_rewards WHERE referrer_id=$1 AND reward_account='compute'`, userID).Scan(&out.RewardCompute)
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM referral_rewards WHERE referrer_id=$1 AND reward_account='cash'`, userID).Scan(&out.RewardCash)
	rows, err := s.db.Query(ctx, `
		SELECT u.id, u.public_id, COALESCE(u.nickname,''), COALESCE(ai.identifier,''), u.created_at,
		       COALESCE((SELECT SUM(o.amount) FROM orders o WHERE o.user_id=u.id AND o.status='paid'),0)
		       + COALESCE((SELECT SUM(wt.amount) FROM wallet_transactions wt WHERE wt.user_id=u.id AND wt.direction='in' AND wt.type='card_recharge'),0)
		FROM users u
		LEFT JOIN auth_identities ai ON ai.user_id=u.id AND ai.provider='email'
		WHERE u.referrer_id=$1
		ORDER BY u.created_at DESC LIMIT 100`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var child ReferralChildDTO
			var created time.Time
			if rows.Scan(&child.ID, &child.PublicID, &child.Nickname, &child.Email, &created, &child.RechargeAmount) == nil {
				child.CreatedAt = created.Format(time.RFC3339)
				out.Children = append(out.Children, child)
			}
		}
	}
	return &out, nil
}

func (s *WalletService) ListTransactions(ctx context.Context, userID int64, page, pageSize int) ([]TransactionItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	var total int
	err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM wallet_transactions WHERE user_id=$1`, userID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, type, direction, amount, balance_after, ref_type, ref_id, remark, created_at
		FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		userID, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []TransactionItem
	for rows.Next() {
		var item TransactionItem
		var created time.Time
		if err := rows.Scan(&item.ID, &item.Type, &item.Direction, &item.Amount, &item.BalanceAfter,
			&item.RefType, &item.RefID, &item.Remark, &created); err != nil {
			return nil, 0, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, total, nil
}

type RechargeRecord struct {
	ID        int64   `json:"id"`
	Type      string  `json:"type"`
	Amount    float64 `json:"amount"`
	Remark    *string `json:"remark,omitempty"`
	CreatedAt string  `json:"created_at"`
}

// ListRechargeRecords returns inbound recharge transactions (card or online).
func (s *WalletService) ListRechargeRecords(ctx context.Context, userID int64, page, pageSize int) ([]RechargeRecord, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	var total int
	s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM wallet_transactions WHERE user_id=$1 AND direction='in' AND type IN ('card_recharge','online_recharge','admin_adjust','daily_checkin')`,
		userID).Scan(&total)
	rows, err := s.db.Query(ctx, `
		SELECT id, type, amount, remark, created_at FROM wallet_transactions
		WHERE user_id=$1 AND direction='in' AND type IN ('card_recharge','online_recharge','admin_adjust','daily_checkin')
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, userID, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []RechargeRecord
	for rows.Next() {
		var r RechargeRecord
		var created time.Time
		if err := rows.Scan(&r.ID, &r.Type, &r.Amount, &r.Remark, &created); err != nil {
			return nil, 0, err
		}
		r.CreatedAt = created.Format(time.RFC3339)
		items = append(items, r)
	}
	return items, total, nil
}

func (s *WalletService) RedeemCard(ctx context.Context, userID int64, code string) (float64, error) {
	return s.RedeemCardAtomic(ctx, userID, code)

	code = strings.TrimSpace(strings.ToUpper(code))
	if code == "" {
		return 0, errors.New("卡密不能为空")
	}
	hash := util.HashCardCode(code)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var cardID int64
	var value float64
	var status string
	err = tx.QueryRow(ctx,
		`SELECT id, value, status FROM recharge_cards WHERE code_hash=$1 FOR UPDATE`, hash,
	).Scan(&cardID, &value, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, errors.New("卡密无效")
		}
		return 0, err
	}
	if status != "unused" {
		return 0, errors.New("卡密已使用或已失效")
	}
	_, err = tx.Exec(ctx,
		`UPDATE recharge_cards SET status='used', used_by=$1, used_at=now() WHERE id=$2`,
		userID, cardID)
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	if err = s.billing.Credit(ctx, userID, value, "card_recharge", "card", hash, "卡密充值"); err != nil {
		return 0, err
	}
	if err = s.billing.AwardReferralOnRecharge(ctx, userID, value, "card", hash); err != nil {
		return 0, err
	}
	return value, nil
}

func (s *WalletService) RedeemCardAtomic(ctx context.Context, userID int64, code string) (float64, error) {
	code = strings.TrimSpace(strings.ToUpper(code))
	if code == "" {
		return 0, errors.New("card code is required")
	}
	hash := util.HashCardCode(code)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var cardID int64
	var value float64
	var status string
	err = tx.QueryRow(ctx,
		`SELECT id, value, status FROM recharge_cards WHERE code_hash=$1 FOR UPDATE`,
		hash,
	).Scan(&cardID, &value, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, errors.New("invalid card code")
		}
		return 0, err
	}
	if status != "unused" {
		return 0, errors.New("card code is already used or disabled")
	}

	var balance float64
	err = tx.QueryRow(ctx, `SELECT compute_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if _, err = tx.Exec(ctx, `INSERT INTO wallets (user_id, compute_balance) VALUES ($1, 0)`, userID); err != nil {
				return 0, err
			}
			balance = 0
		} else {
			return 0, err
		}
	}

	newBalance := balance + value
	if _, err = tx.Exec(ctx,
		`UPDATE recharge_cards SET status='used', used_by=$1, used_at=now() WHERE id=$2 AND status='unused'`,
		userID, cardID); err != nil {
		return 0, err
	}
	if _, err = tx.Exec(ctx, `UPDATE wallets SET compute_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID); err != nil {
		return 0, err
	}
	if _, err = tx.Exec(ctx,
		`INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
		 VALUES ($1,'card_recharge','in',$2,$3,'card',$4,'Card recharge')`,
		userID, value, newBalance, hash); err != nil {
		return 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	if err = s.billing.AwardReferralOnRecharge(ctx, userID, value, "card", hash); err != nil {
		return 0, err
	}
	return value, nil
}

func (s *WalletService) GetPaymentConfig(ctx context.Context) (map[string]interface{}, error) {
	cfg, err := s.getConfigs(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"payment_enabled":       parseConfigBool(cfg["payment_enabled"], false),
		"card_recharge_enabled": parseConfigBool(cfg["card_recharge_enabled"], true),
	}, nil
}

func (s *WalletService) getConfigs(ctx context.Context) (map[string]interface{}, error) {
	rows, err := s.db.Query(ctx, `SELECT key, value FROM system_configs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]interface{})
	for rows.Next() {
		var key string
		var value []byte
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		var v interface{}
		json.Unmarshal(value, &v)
		result[key] = v
	}
	return result, nil
}

func parseConfigBool(v interface{}, fallback bool) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	if s, ok := v.(string); ok {
		return s == "true"
	}
	return fallback
}
