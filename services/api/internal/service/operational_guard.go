package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type FrozenBalanceItem struct {
	ID          int64   `json:"id"`
	UserID      int64   `json:"user_id"`
	Amount      float64 `json:"amount"`
	RefType     string  `json:"ref_type"`
	RefID       string  `json:"ref_id"`
	Status      string  `json:"status"`
	TaskStatus  *string `json:"task_status,omitempty"`
	Error       *string `json:"error,omitempty"`
	AgeMinutes  int     `json:"age_minutes"`
	CreatedAt   string  `json:"created_at"`
	ReleasedAt  *string `json:"released_at,omitempty"`
	WalletTxIDs []int64 `json:"wallet_tx_ids,omitempty"`
}

type OperationalStats struct {
	FrozenCount            int     `json:"frozen_count"`
	FrozenAmount           float64 `json:"frozen_amount"`
	StaleChatFreezes       int     `json:"stale_chat_freezes"`
	StaleTasks             int     `json:"stale_tasks"`
	StaleWorkflows         int     `json:"stale_workflows"`
	PendingTasks           int     `json:"pending_tasks"`
	RunningTasks           int     `json:"running_tasks"`
	RecentFailedTasks      int     `json:"recent_failed_tasks"`
	CardRechargeAnomalies  int     `json:"card_recharge_anomalies"`
	WorkerOnline           bool    `json:"worker_online"`
	WorkerLastHeartbeat    *string `json:"worker_last_heartbeat,omitempty"`
	WorkerHeartbeatAgeSecs *int    `json:"worker_heartbeat_age_seconds,omitempty"`
}

type CardRechargeAnomaly struct {
	CardID     int64   `json:"card_id"`
	UserID     *int64  `json:"user_id,omitempty"`
	Value      float64 `json:"value"`
	HashPrefix string  `json:"hash_prefix"`
	UsedAt     string  `json:"used_at"`
}

type OperationalOverview struct {
	Stats         OperationalStats      `json:"stats"`
	FrozenItems   []FrozenBalanceItem   `json:"frozen_items"`
	RecentFailed  []TaskDTO             `json:"recent_failed_tasks"`
	CardAnomalies []CardRechargeAnomaly `json:"card_anomalies"`
}

type ReconcileResult struct {
	ReleasedChatFreezes int `json:"released_chat_freezes"`
	FailedTasks         int `json:"failed_tasks"`
	FailedWorkflows     int `json:"failed_workflows"`
}

func (s *OpsService) OperationalOverview(ctx context.Context, workerHeartbeat *time.Time) (*OperationalOverview, error) {
	items, _, err := s.ListFrozenBalances(ctx, 1, 20)
	if err != nil {
		return nil, err
	}
	failed, _, _ := s.listRecentFailedTasks(ctx, 1, 10)
	anomalies, _ := s.ListCardRechargeAnomalies(ctx, 10)
	stats, err := s.operationalStats(ctx, workerHeartbeat)
	if err != nil {
		return nil, err
	}
	stats.CardRechargeAnomalies = len(anomalies)
	return &OperationalOverview{Stats: *stats, FrozenItems: items, RecentFailed: failed, CardAnomalies: anomalies}, nil
}

func (s *OpsService) operationalStats(ctx context.Context, workerHeartbeat *time.Time) (*OperationalStats, error) {
	var st OperationalStats
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*), COALESCE(SUM(amount),0) FROM balance_freezes WHERE status='frozen'`).Scan(&st.FrozenCount, &st.FrozenAmount)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM balance_freezes WHERE status='frozen' AND ref_type='chat' AND created_at < now() - interval '30 minutes'`).Scan(&st.StaleChatFreezes)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks WHERE status='pending'`).Scan(&st.PendingTasks)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks WHERE status='running'`).Scan(&st.RunningTasks)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks WHERE status IN ('pending','running') AND created_at < now() - interval '6 hours'`).Scan(&st.StaleTasks)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM workflow_projects WHERE status IN ('pending','running') AND created_at < now() - interval '12 hours'`).Scan(&st.StaleWorkflows)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks WHERE status='failed' AND updated_at >= now() - interval '24 hours'`).Scan(&st.RecentFailedTasks)
	if workerHeartbeat != nil {
		formatted := workerHeartbeat.Format(time.RFC3339)
		age := int(time.Since(*workerHeartbeat).Seconds())
		st.WorkerLastHeartbeat = &formatted
		st.WorkerHeartbeatAgeSecs = &age
		st.WorkerOnline = age <= 90
	}
	return &st, nil
}

func (s *OpsService) ListFrozenBalances(ctx context.Context, page, pageSize int) ([]FrozenBalanceItem, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM balance_freezes WHERE status='frozen'`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT f.id, f.user_id, f.amount, f.ref_type, f.ref_id, f.status,
		       CASE WHEN f.ref_type='task' THEN t.status WHEN f.ref_type='workflow' THEN wp.status ELSE NULL END AS task_status,
		       CASE WHEN f.ref_type='task' THEN t.error_message WHEN f.ref_type='workflow' THEN wp.error_message ELSE NULL END AS error_message,
		       EXTRACT(EPOCH FROM (now() - f.created_at))::int / 60 AS age_minutes,
		       f.created_at, f.released_at
		FROM balance_freezes f
		LEFT JOIN tasks t ON f.ref_type='task' AND t.task_no=f.ref_id
		LEFT JOIN workflow_projects wp ON f.ref_type='workflow' AND wp.public_id=f.ref_id
		WHERE f.status='frozen'
		ORDER BY f.created_at ASC
		LIMIT $1 OFFSET $2`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []FrozenBalanceItem
	for rows.Next() {
		var item FrozenBalanceItem
		var created time.Time
		var released *time.Time
		if err := rows.Scan(&item.ID, &item.UserID, &item.Amount, &item.RefType, &item.RefID, &item.Status, &item.TaskStatus, &item.Error, &item.AgeMinutes, &created, &released); err != nil {
			return nil, 0, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		if released != nil {
			v := released.Format(time.RFC3339)
			item.ReleasedAt = &v
		}
		txRows, _ := s.db.Query(ctx, `SELECT id FROM wallet_transactions WHERE user_id=$1 AND ref_type=$2 AND ref_id=$3 ORDER BY id DESC LIMIT 5`, item.UserID, item.RefType, item.RefID)
		if txRows != nil {
			for txRows.Next() {
				var id int64
				if txRows.Scan(&id) == nil {
					item.WalletTxIDs = append(item.WalletTxIDs, id)
				}
			}
			txRows.Close()
		}
		out = append(out, item)
	}
	return out, total, rows.Err()
}

func (s *OpsService) ReleaseFrozenBalance(ctx context.Context, freezeID int64) (*FrozenBalanceItem, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var item FrozenBalanceItem
	var created time.Time
	err = tx.QueryRow(ctx, `SELECT id, user_id, amount, ref_type, ref_id, status, created_at FROM balance_freezes WHERE id=$1 FOR UPDATE`, freezeID).
		Scan(&item.ID, &item.UserID, &item.Amount, &item.RefType, &item.RefID, &item.Status, &created)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	if item.Status != "frozen" {
		return nil, errors.New("freeze is not active")
	}
	if _, err = tx.Exec(ctx, `UPDATE wallets SET frozen_compute=GREATEST(frozen_compute-$1,0), updated_at=now() WHERE user_id=$2`, item.Amount, item.UserID); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `UPDATE balance_freezes SET status='released', released_at=now() WHERE id=$1 AND status='frozen'`, freezeID); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetFrozenBalanceByID(ctx, freezeID)
}

func (s *OpsService) GetFrozenBalanceByID(ctx context.Context, freezeID int64) (*FrozenBalanceItem, error) {
	var item FrozenBalanceItem
	var created time.Time
	var released *time.Time
	err := s.db.QueryRow(ctx, `
		SELECT id, user_id, amount, ref_type, ref_id, status, EXTRACT(EPOCH FROM (now() - created_at))::int / 60, created_at, released_at
		FROM balance_freezes WHERE id=$1`, freezeID).
		Scan(&item.ID, &item.UserID, &item.Amount, &item.RefType, &item.RefID, &item.Status, &item.AgeMinutes, &created, &released)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	if released != nil {
		v := released.Format(time.RFC3339)
		item.ReleasedAt = &v
	}
	return &item, nil
}

func (s *OpsService) ReconcileFrozenBalances(ctx context.Context) (*ReconcileResult, error) {
	var result ReconcileResult
	if n, err := s.releaseStaleChatFreezes(ctx); err != nil {
		return nil, err
	} else {
		result.ReleasedChatFreezes = n
	}
	if n, err := s.failStaleTasks(ctx); err != nil {
		return nil, err
	} else {
		result.FailedTasks = n
	}
	if n, err := s.failStaleWorkflows(ctx); err != nil {
		return nil, err
	} else {
		result.FailedWorkflows = n
	}
	return &result, nil
}

func (s *OpsService) releaseStaleChatFreezes(ctx context.Context) (int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id FROM balance_freezes
		WHERE status='frozen' AND ref_type='chat' AND created_at < now() - interval '30 minutes'
		ORDER BY created_at ASC LIMIT 200`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			if _, err := s.ReleaseFrozenBalance(ctx, id); err == nil {
				n++
			}
		}
	}
	return n, rows.Err()
}

func (s *OpsService) failStaleTasks(ctx context.Context) (int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT f.id, f.user_id, f.amount, f.ref_id
		FROM balance_freezes f
		JOIN tasks t ON t.task_no=f.ref_id
		WHERE f.status='frozen' AND f.ref_type='task'
		  AND t.status IN ('pending','running')
		  AND t.created_at < now() - interval '6 hours'
		ORDER BY t.created_at ASC LIMIT 200`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var freezeID, userID int64
		var amount float64
		var taskNo string
		if err := rows.Scan(&freezeID, &userID, &amount, &taskNo); err != nil {
			return n, err
		}
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return n, err
		}
		var status string
		if err = tx.QueryRow(ctx, `SELECT status FROM balance_freezes WHERE id=$1 FOR UPDATE`, freezeID).Scan(&status); err != nil {
			tx.Rollback(ctx)
			return n, err
		}
		if status != "frozen" {
			tx.Rollback(ctx)
			continue
		}
		_, err = tx.Exec(ctx, `UPDATE tasks SET status='failed', error_code='STALE_TIMEOUT', error_message='Task timed out by operational guard', finished_at=now(), updated_at=now() WHERE task_no=$1 AND status IN ('pending','running')`, taskNo)
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE wallets SET frozen_compute=GREATEST(frozen_compute-$1,0), updated_at=now() WHERE user_id=$2`, amount, userID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE balance_freezes SET status='released', released_at=now() WHERE id=$1 AND status='frozen'`, freezeID)
		}
		if err != nil {
			tx.Rollback(ctx)
			return n, err
		}
		if err = tx.Commit(ctx); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func (s *OpsService) failStaleWorkflows(ctx context.Context) (int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT f.id, f.user_id, f.amount, f.ref_id
		FROM balance_freezes f
		JOIN workflow_projects p ON p.public_id=f.ref_id
		WHERE f.status='frozen' AND f.ref_type='workflow'
		  AND p.status IN ('pending','running')
		  AND p.created_at < now() - interval '12 hours'
		ORDER BY p.created_at ASC LIMIT 200`)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var freezeID, userID int64
		var amount float64
		var publicID string
		if err := rows.Scan(&freezeID, &userID, &amount, &publicID); err != nil {
			return n, err
		}
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return n, err
		}
		var status string
		if err = tx.QueryRow(ctx, `SELECT status FROM balance_freezes WHERE id=$1 FOR UPDATE`, freezeID).Scan(&status); err != nil {
			tx.Rollback(ctx)
			return n, err
		}
		if status != "frozen" {
			tx.Rollback(ctx)
			continue
		}
		_, err = tx.Exec(ctx, `UPDATE workflow_projects SET status='failed', error_message='Workflow timed out by operational guard', finished_at=now(), updated_at=now() WHERE public_id=$1 AND status IN ('pending','running')`, publicID)
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE wallets SET frozen_compute=GREATEST(frozen_compute-$1,0), updated_at=now() WHERE user_id=$2`, amount, userID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE balance_freezes SET status='released', released_at=now() WHERE id=$1 AND status='frozen'`, freezeID)
		}
		if err != nil {
			tx.Rollback(ctx)
			return n, err
		}
		if err = tx.Commit(ctx); err != nil {
			return n, err
		}
		n++
	}
	return n, rows.Err()
}

func (s *OpsService) listRecentFailedTasks(ctx context.Context, page, pageSize int) ([]TaskDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 10
	}
	var total int
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks WHERE status='failed' AND updated_at >= now() - interval '24 hours'`).Scan(&total)
	rows, err := s.db.Query(ctx, `
		SELECT t.task_no, t.upstream_task_id, t.type, t.status, m.code, t.input, t.output, t.estimated_cost, t.actual_cost, t.error_code, t.error_message, t.created_at, t.finished_at
		FROM tasks t LEFT JOIN models m ON m.id=t.model_id
		WHERE t.status='failed'
		ORDER BY t.updated_at DESC LIMIT $1 OFFSET $2`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	return scanTasks(rows, total)
}

func (s *OpsService) ListCardRechargeAnomalies(ctx context.Context, limit int) ([]CardRechargeAnomaly, error) {
	if limit < 1 || limit > 100 {
		limit = 20
	}
	rows, err := s.db.Query(ctx, `
		SELECT c.id, c.used_by, c.value, LEFT(c.code_hash, 12), c.used_at
		FROM recharge_cards c
		LEFT JOIN wallet_transactions wt
		  ON wt.ref_type='card' AND wt.ref_id=c.code_hash AND wt.type='card_recharge' AND wt.direction='in'
		WHERE c.status='used' AND wt.id IS NULL
		ORDER BY c.used_at DESC NULLS LAST
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CardRechargeAnomaly
	for rows.Next() {
		var item CardRechargeAnomaly
		var usedAt *time.Time
		if err := rows.Scan(&item.CardID, &item.UserID, &item.Value, &item.HashPrefix, &usedAt); err != nil {
			return nil, err
		}
		if usedAt != nil {
			item.UsedAt = usedAt.Format(time.RFC3339)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
