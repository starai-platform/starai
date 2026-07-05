package billing

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInsufficientBalance = errors.New("insufficient balance")
	ErrFreezeNotFound      = errors.New("freeze not found")
)

const InsufficientBalanceMsg = "账户余额不足"

type Service struct {
	db *pgxpool.Pool
}

func New(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (s *Service) GetWallet(ctx context.Context, userID int64) (compute, frozen float64, err error) {
	err = s.db.QueryRow(ctx,
		`SELECT compute_balance, frozen_compute FROM wallets WHERE user_id=$1`, userID,
	).Scan(&compute, &frozen)
	return
}

func (s *Service) EnsureWallet(ctx context.Context, userID int64) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, userID)
	return err
}

func (s *Service) Freeze(ctx context.Context, userID int64, amount float64, refType, refID string) error {
	if amount <= 0 {
		return nil
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var balance, frozen float64
	err = tx.QueryRow(ctx,
		`SELECT compute_balance, frozen_compute FROM wallets WHERE user_id=$1 FOR UPDATE`, userID,
	).Scan(&balance, &frozen)
	if err != nil {
		return err
	}
	available := balance - frozen
	if available < amount {
		return ErrInsufficientBalance
	}
	_, err = tx.Exec(ctx,
		`UPDATE wallets SET frozen_compute = frozen_compute + $1, updated_at=now() WHERE user_id=$2`,
		amount, userID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO balance_freezes (user_id, amount, ref_type, ref_id, status) VALUES ($1,$2,$3,$4,'frozen')`,
		userID, amount, refType, refID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) Charge(ctx context.Context, userID int64, freezeAmount, actualAmount float64, refType, refID, txType, remark string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	lockedAmount, err := sumLockedFreezes(ctx, tx, userID, refType, refID)
	if err != nil {
		return err
	}
	if lockedAmount <= 0 {
		return nil
	}
	if freezeAmount <= 0 || freezeAmount > lockedAmount {
		freezeAmount = lockedAmount
	}

	var balance, frozen float64
	err = tx.QueryRow(ctx,
		`SELECT compute_balance, frozen_compute FROM wallets WHERE user_id=$1 FOR UPDATE`, userID,
	).Scan(&balance, &frozen)
	if err != nil {
		return err
	}

	charge := actualAmount
	if charge > freezeAmount {
		charge = freezeAmount // 少扣不多扣
	}
	unfreeze := freezeAmount

	newBalance := balance - charge
	newFrozen := frozen - unfreeze
	if newFrozen < 0 {
		newFrozen = 0
	}

	_, err = tx.Exec(ctx,
		`UPDATE wallets SET compute_balance=$1, frozen_compute=$2, updated_at=now() WHERE user_id=$3`,
		newBalance, newFrozen, userID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`UPDATE balance_freezes SET status='charged', released_at=now() WHERE user_id=$1 AND ref_type=$2 AND ref_id=$3 AND status='frozen'`,
		userID, refType, refID)
	if err != nil {
		return err
	}

	if charge > 0 {
		_, err = tx.Exec(ctx,
			`INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
			 VALUES ($1,$2,'out',$3,$4,$5,$6,$7)`,
			userID, txType, charge, newBalance, refType, refID, remark)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) Unfreeze(ctx context.Context, userID int64, amount float64, refType, refID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	lockedAmount, err := sumLockedFreezes(ctx, tx, userID, refType, refID)
	if err != nil {
		return err
	}
	if lockedAmount <= 0 {
		return nil
	}
	if amount <= 0 || amount > lockedAmount {
		amount = lockedAmount
	}

	_, err = tx.Exec(ctx,
		`UPDATE wallets SET frozen_compute = GREATEST(frozen_compute - $1, 0), updated_at=now() WHERE user_id=$2`,
		amount, userID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`UPDATE balance_freezes SET status='released', released_at=now() WHERE user_id=$1 AND ref_type=$2 AND ref_id=$3 AND status='frozen'`,
		userID, refType, refID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func sumLockedFreezes(ctx context.Context, tx pgx.Tx, userID int64, refType, refID string) (float64, error) {
	rows, err := tx.Query(ctx,
		`SELECT amount FROM balance_freezes
		 WHERE user_id=$1 AND ref_type=$2 AND ref_id=$3 AND status='frozen'
		 FOR UPDATE`,
		userID, refType, refID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	total := 0.0
	for rows.Next() {
		var amount float64
		if err := rows.Scan(&amount); err != nil {
			return 0, err
		}
		total += amount
	}
	return total, rows.Err()
}

func (s *Service) Credit(ctx context.Context, userID int64, amount float64, txType, refType, refID, remark string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var balance float64
	err = tx.QueryRow(ctx,
		`SELECT compute_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID,
	).Scan(&balance)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_, err = tx.Exec(ctx, `INSERT INTO wallets (user_id, compute_balance) VALUES ($1, $2)`, userID, amount)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx,
				`INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
				 VALUES ($1,$2,'in',$3,$3,$4,$5,$6)`,
				userID, txType, amount, refType, refID, remark)
			if err != nil {
				return err
			}
			return tx.Commit(ctx)
		}
		return err
	}

	newBalance := balance + amount
	_, err = tx.Exec(ctx,
		`UPDATE wallets SET compute_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
		 VALUES ($1,$2,'in',$3,$4,$5,$6,$7)`,
		userID, txType, amount, newBalance, refType, refID, remark)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) CreditCash(ctx context.Context, userID int64, amount float64, txType, refType, refID, remark string) error {
	if amount <= 0 {
		return nil
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var balance float64
	err = tx.QueryRow(ctx, `SELECT cash_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_, err = tx.Exec(ctx, `INSERT INTO wallets (user_id, cash_balance) VALUES ($1, $2)`, userID, amount)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx,
				`INSERT INTO cash_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
				 VALUES ($1,$2,'in',$3,$3,$4,$5,$6)`,
				userID, txType, amount, refType, refID, remark)
			if err != nil {
				return err
			}
			return tx.Commit(ctx)
		}
		return err
	}

	newBalance := balance + amount
	_, err = tx.Exec(ctx, `UPDATE wallets SET cash_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO cash_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
		 VALUES ($1,$2,'in',$3,$4,$5,$6,$7)`,
		userID, txType, amount, newBalance, refType, refID, remark)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) DebitCash(ctx context.Context, userID int64, amount float64, txType, refType, refID, remark string) error {
	if amount <= 0 {
		return nil
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var balance float64
	if err = tx.QueryRow(ctx, `SELECT cash_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance); err != nil {
		return err
	}
	if balance < amount {
		return ErrInsufficientBalance
	}
	newBalance := balance - amount
	if _, err = tx.Exec(ctx, `UPDATE wallets SET cash_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx,
		`INSERT INTO cash_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
		 VALUES ($1,$2,'out',$3,$4,$5,$6,$7)`,
		userID, txType, amount, newBalance, refType, refID, remark); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) AwardReferralOnRecharge(ctx context.Context, referredID int64, rechargeAmount float64, triggerType, triggerID string) error {
	var rechargeCount int
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM wallet_transactions
		WHERE user_id=$1 AND direction='in' AND type IN ('card_recharge','online_recharge')`,
		referredID).Scan(&rechargeCount); err != nil {
		return err
	}
	var referrerID, levelID int64
	var account, rewardType, rewardTrigger string
	var rewardValue float64
	err := s.db.QueryRow(ctx, `
		SELECT u.referrer_id, ml.id, ml.referral_reward_account, ml.referral_reward_amount,
		       COALESCE(ml.referral_reward_type,'fixed'), COALESCE(ml.referral_reward_trigger,'first_recharge')
		FROM users u
		JOIN users r ON r.id = u.referrer_id
		JOIN member_levels ml ON ml.id = r.member_level_id
		WHERE u.id=$1 AND u.referrer_id IS NOT NULL AND ml.is_enabled=true`,
		referredID).Scan(&referrerID, &levelID, &account, &rewardValue, &rewardType, &rewardTrigger)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if rewardTrigger == "first_recharge" && rechargeCount != 1 {
		return nil
	}
	if rewardValue <= 0 {
		return nil
	}
	amount := rewardValue
	if rewardType == "percent" {
		amount = rechargeAmount * rewardValue / 100
	}
	if amount <= 0 {
		return nil
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var existing int
	if err = tx.QueryRow(ctx, `SELECT 1 FROM referral_rewards WHERE referred_id=$1 AND trigger_type=$2 AND trigger_id=$3`, referredID, triggerType, triggerID).Scan(&existing); err == nil {
		return nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	var balance float64
	if account == "cash" {
		if err = tx.QueryRow(ctx, `SELECT cash_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, referrerID).Scan(&balance); err != nil {
			return err
		}
		newBalance := balance + amount
		if _, err = tx.Exec(ctx, `UPDATE wallets SET cash_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, referrerID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx,
			`INSERT INTO cash_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
			 VALUES ($1,'referral_reward','in',$2,$3,$4,$5,'推荐奖励')`,
			referrerID, amount, newBalance, triggerType, triggerID); err != nil {
			return err
		}
	} else {
		if err = tx.QueryRow(ctx, `SELECT compute_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, referrerID).Scan(&balance); err != nil {
			return err
		}
		newBalance := balance + amount
		if _, err = tx.Exec(ctx, `UPDATE wallets SET compute_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, referrerID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx,
			`INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
			 VALUES ($1,'referral_reward','in',$2,$3,$4,$5,'推荐奖励')`,
			referrerID, amount, newBalance, triggerType, triggerID); err != nil {
			return err
		}
		account = "compute"
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO referral_rewards (referrer_id, referred_id, member_level_id, reward_account, amount, trigger_type, trigger_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		referrerID, referredID, levelID, account, amount, triggerType, triggerID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) AdjustBalance(ctx context.Context, userID int64, amount float64, remark string) error {
	if amount >= 0 {
		return s.Credit(ctx, userID, amount, "admin_adjust", "admin", fmt.Sprintf("%d", userID), remark)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var balance float64
	err = tx.QueryRow(ctx, `SELECT compute_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance)
	if err != nil {
		return err
	}
	deduct := -amount
	newBalance := balance - deduct
	_, err = tx.Exec(ctx, `UPDATE wallets SET compute_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
		 VALUES ($1,'admin_adjust','out',$2,$3,'admin',$4,$5)`,
		userID, deduct, newBalance, fmt.Sprintf("%d", userID), remark)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
