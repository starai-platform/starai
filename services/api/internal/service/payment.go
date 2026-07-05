package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/util"
)

type PaymentService struct {
	db      *pgxpool.Pool
	billing *billing.Service
}

func NewPaymentService(db *pgxpool.Pool, billing *billing.Service) *PaymentService {
	return &PaymentService{db: db, billing: billing}
}

type OrderDTO struct {
	OrderNo         string  `json:"order_no"`
	Channel         string  `json:"channel"`
	Amount          float64 `json:"amount"`
	ComputeCredited float64 `json:"compute_credited"`
	Status          string  `json:"status"`
	PaidAt          *string `json:"paid_at,omitempty"`
	CreatedAt       string  `json:"created_at"`
}

type AdminOrderDTO struct {
	OrderDTO
	UserPublicID string `json:"user_public_id"`
	Nickname     string `json:"nickname"`
}

// CreateMockOrder creates an order and, for the mock channel, immediately marks it
// paid and credits compute balance to the user.
func (s *PaymentService) CreateMockOrder(ctx context.Context, userID int64, amount float64, channel string) (*OrderDTO, error) {
	if amount <= 0 {
		return nil, errors.New("充值金额必须大于 0")
	}
	if channel == "" {
		channel = "mock"
	}
	rate := s.computeRate(ctx)
	credited := amount * rate
	orderNo := fmt.Sprintf("ord_%d_%s", time.Now().UnixMilli(), util.NewPublicID("")[1:5])

	_, err := s.db.Exec(ctx,
		`INSERT INTO orders (order_no, user_id, channel, amount, compute_credited, status, paid_at)
		 VALUES ($1,$2,$3,$4,$5,'paid',now())`,
		orderNo, userID, channel, amount, credited)
	if err != nil {
		return nil, err
	}
	if err := s.billing.Credit(ctx, userID, credited, "online_recharge", "order", orderNo, "在线充值"); err != nil {
		return nil, err
	}
	if err := s.billing.AwardReferralOnRecharge(ctx, userID, credited, "order", orderNo); err != nil {
		return nil, err
	}
	now := time.Now().Format(time.RFC3339)
	return &OrderDTO{
		OrderNo: orderNo, Channel: channel, Amount: amount, ComputeCredited: credited,
		Status: "paid", PaidAt: &now, CreatedAt: now,
	}, nil
}

func (s *PaymentService) computeRate(ctx context.Context) float64 {
	var raw []byte
	err := s.db.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='payment_compute_rate'`).Scan(&raw)
	if err != nil {
		return 100
	}
	var rate float64
	if e := json.Unmarshal(raw, &rate); e != nil || rate <= 0 {
		return 100
	}
	return rate
}

func (s *PaymentService) ListOrders(ctx context.Context, page, pageSize int) ([]AdminOrderDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	var total int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM orders`).Scan(&total)
	rows, err := s.db.Query(ctx, `
		SELECT o.order_no, o.channel, o.amount, o.compute_credited, o.status, o.paid_at, o.created_at,
		       u.public_id, COALESCE(u.nickname,'')
		FROM orders o JOIN users u ON u.id = o.user_id
		ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []AdminOrderDTO
	for rows.Next() {
		var o AdminOrderDTO
		var paid *time.Time
		var created time.Time
		if err := rows.Scan(&o.OrderNo, &o.Channel, &o.Amount, &o.ComputeCredited, &o.Status, &paid, &created,
			&o.UserPublicID, &o.Nickname); err != nil {
			return nil, 0, err
		}
		o.CreatedAt = created.Format(time.RFC3339)
		if paid != nil {
			ps := paid.Format(time.RFC3339)
			o.PaidAt = &ps
		}
		items = append(items, o)
	}
	return items, total, nil
}
