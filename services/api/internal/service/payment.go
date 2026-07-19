package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/util"
)

type PaymentService struct {
	db            *pgxpool.Pool
	billing       *billing.Service
	httpClient    *http.Client
	stripeAPIBase string
	paypalLiveAPI string
	paypalTestAPI string
}

func NewPaymentService(db *pgxpool.Pool, billing *billing.Service) *PaymentService {
	return &PaymentService{
		db: db, billing: billing,
		httpClient:    &http.Client{Timeout: 20 * time.Second},
		stripeAPIBase: "https://api.stripe.com",
		paypalLiveAPI: "https://api-m.paypal.com",
		paypalTestAPI: "https://api-m.sandbox.paypal.com",
	}
}

type OrderDTO struct {
	OrderNo         string  `json:"order_no"`
	Channel         string  `json:"channel"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	ComputeCredited float64 `json:"compute_credited"`
	Status          string  `json:"status"`
	CheckoutURL     string  `json:"checkout_url,omitempty"`
	ExpiresAt       *string `json:"expires_at,omitempty"`
	PaidAt          *string `json:"paid_at,omitempty"`
	CreatedAt       string  `json:"created_at"`
}

type PaymentProviderConfig struct {
	Enabled             bool
	Provider            string
	Currency            string
	ProductName         string
	SuccessURL          string
	CancelURL           string
	CheckoutURL         string
	WebhookSecret       string
	StripeSecretKey     string
	StripeWebhookSecret string
	PayPalMode          string
	PayPalClientID      string
	PayPalClientSecret  string
	PayPalWebhookID     string
	PayPalBrandName     string
	ExpireMinutes       int
	MinAmount           float64
	MaxAmount           float64
}

type PaymentCompletion struct {
	OrderNo         string  `json:"order_no"`
	UserID          int64   `json:"-"`
	ComputeCredited float64 `json:"compute_credited"`
	AlreadyPaid     bool    `json:"already_paid"`
}

type AdminOrderDTO struct {
	OrderDTO
	UserPublicID string `json:"user_public_id"`
	Nickname     string `json:"nickname"`
}

func optionalPackageID(values []int64) interface{} {
	if len(values) > 0 && values[0] > 0 {
		return values[0]
	}
	return nil
}

type RechargePackageDTO struct {
	ID                      int64    `json:"-"`
	PublicID                string   `json:"public_id"`
	Name                    string   `json:"name"`
	Amount                  float64  `json:"amount"`
	ComputeCredits          *float64 `json:"compute_credits,omitempty"`
	EffectiveComputeCredits float64  `json:"effective_compute_credits"`
	CreditsMode             string   `json:"credits_mode"`
	Badge                   string   `json:"badge"`
	IsEnabled               bool     `json:"is_enabled"`
	SortOrder               int      `json:"sort_order"`
	CreatedAt               string   `json:"created_at,omitempty"`
	UpdatedAt               string   `json:"updated_at,omitempty"`
}

type RechargePackageInput struct {
	Name           string   `json:"name"`
	Amount         float64  `json:"amount"`
	ComputeCredits *float64 `json:"compute_credits"`
	Badge          string   `json:"badge"`
	IsEnabled      bool     `json:"is_enabled"`
	SortOrder      int      `json:"sort_order"`
}

func (s *PaymentService) ListRechargePackages(ctx context.Context, includeDisabled bool) ([]RechargePackageDTO, error) {
	where := "WHERE is_enabled=true"
	if includeDisabled {
		where = ""
	}
	rows, err := s.db.Query(ctx, `SELECT id, public_id, name, amount, compute_credits, badge, is_enabled, sort_order, created_at, updated_at
		FROM payment_packages `+where+` ORDER BY sort_order ASC, amount ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []RechargePackageDTO{}
	for rows.Next() {
		var item RechargePackageDTO
		var created, updated time.Time
		if err := rows.Scan(&item.ID, &item.PublicID, &item.Name, &item.Amount, &item.ComputeCredits, &item.Badge, &item.IsEnabled, &item.SortOrder, &created, &updated); err != nil {
			return nil, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		item.UpdatedAt = updated.Format(time.RFC3339)
		s.applyRechargePackageCredits(ctx, &item)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *PaymentService) ResolveRechargePackage(ctx context.Context, publicID string, legacyAmount float64) (*RechargePackageDTO, error) {
	var item RechargePackageDTO
	var created, updated time.Time
	publicID = strings.TrimSpace(publicID)
	var err error
	if publicID != "" {
		err = s.db.QueryRow(ctx, `SELECT id, public_id, name, amount, compute_credits, badge, is_enabled, sort_order, created_at, updated_at
			FROM payment_packages WHERE public_id=$1 AND is_enabled=true`, publicID).
			Scan(&item.ID, &item.PublicID, &item.Name, &item.Amount, &item.ComputeCredits, &item.Badge, &item.IsEnabled, &item.SortOrder, &created, &updated)
	} else {
		err = s.db.QueryRow(ctx, `SELECT id, public_id, name, amount, compute_credits, badge, is_enabled, sort_order, created_at, updated_at
			FROM payment_packages WHERE amount=$1 AND is_enabled=true ORDER BY id LIMIT 1`, legacyAmount).
			Scan(&item.ID, &item.PublicID, &item.Name, &item.Amount, &item.ComputeCredits, &item.Badge, &item.IsEnabled, &item.SortOrder, &created, &updated)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("充值套餐不存在或已停用，请刷新后重新选择")
	}
	if err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	item.UpdatedAt = updated.Format(time.RFC3339)
	s.applyRechargePackageCredits(ctx, &item)
	return &item, nil
}

func (s *PaymentService) applyRechargePackageCredits(ctx context.Context, item *RechargePackageDTO) {
	if item.ComputeCredits != nil && *item.ComputeCredits > 0 {
		item.EffectiveComputeCredits = roundCredits(*item.ComputeCredits)
		item.CreditsMode = "manual"
		return
	}
	item.EffectiveComputeCredits = roundCredits(item.Amount * s.computeRate(ctx))
	item.CreditsMode = "formula"
}

func roundCredits(value float64) float64 {
	return math.Round(value*1_000_000) / 1_000_000
}

func (s *PaymentService) UpsertRechargePackage(ctx context.Context, publicID string, input RechargePackageInput) (*RechargePackageDTO, error) {
	if math.IsNaN(input.Amount) || math.IsInf(input.Amount, 0) || input.Amount < 0.01 || input.Amount > 1_000_000 {
		return nil, errors.New("套餐金额需在 0.01 至 1000000 之间")
	}
	input.Amount = math.Round(input.Amount*100) / 100
	if input.ComputeCredits != nil {
		if math.IsNaN(*input.ComputeCredits) || math.IsInf(*input.ComputeCredits, 0) || *input.ComputeCredits <= 0 || *input.ComputeCredits > 1_000_000_000 {
			return nil, errors.New("指定到账算力需大于 0，留空则按默认公式计算")
		}
		value := roundCredits(*input.ComputeCredits)
		input.ComputeCredits = &value
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		input.Name = strconv.FormatFloat(input.Amount, 'f', 2, 64)
	}
	if len([]rune(input.Name)) > 128 || len([]rune(input.Badge)) > 64 {
		return nil, errors.New("套餐名称或角标过长")
	}
	var duplicate bool
	_ = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM payment_packages WHERE amount=$1 AND public_id<>$2)`, input.Amount, strings.TrimSpace(publicID)).Scan(&duplicate)
	if duplicate {
		return nil, errors.New("已存在相同金额的充值套餐")
	}
	if strings.TrimSpace(publicID) == "" {
		publicID = util.NewPublicID("pay")
		_, err := s.db.Exec(ctx, `INSERT INTO payment_packages (public_id, name, amount, compute_credits, badge, is_enabled, sort_order)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`, publicID, input.Name, input.Amount, input.ComputeCredits, strings.TrimSpace(input.Badge), input.IsEnabled, input.SortOrder)
		if err != nil {
			return nil, err
		}
	} else {
		tag, err := s.db.Exec(ctx, `UPDATE payment_packages SET name=$1, amount=$2, compute_credits=$3, badge=$4, is_enabled=$5, sort_order=$6, updated_at=now()
			WHERE public_id=$7`, input.Name, input.Amount, input.ComputeCredits, strings.TrimSpace(input.Badge), input.IsEnabled, input.SortOrder, publicID)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			return nil, pgx.ErrNoRows
		}
	}
	return s.ResolveRechargePackageAdmin(ctx, publicID)
}

func (s *PaymentService) ResolveRechargePackageAdmin(ctx context.Context, publicID string) (*RechargePackageDTO, error) {
	var item RechargePackageDTO
	var created, updated time.Time
	err := s.db.QueryRow(ctx, `SELECT id, public_id, name, amount, compute_credits, badge, is_enabled, sort_order, created_at, updated_at
		FROM payment_packages WHERE public_id=$1`, publicID).
		Scan(&item.ID, &item.PublicID, &item.Name, &item.Amount, &item.ComputeCredits, &item.Badge, &item.IsEnabled, &item.SortOrder, &created, &updated)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	item.UpdatedAt = updated.Format(time.RFC3339)
	s.applyRechargePackageCredits(ctx, &item)
	return &item, nil
}

func (s *PaymentService) DeleteRechargePackage(ctx context.Context, publicID string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM payment_packages WHERE public_id=$1`, strings.TrimSpace(publicID))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// CreateMockOrder creates an order and, for the mock channel, immediately marks it
// paid and credits compute balance to the user.
func (s *PaymentService) CreateMockOrder(ctx context.Context, userID int64, amount float64, channel string, packageID ...int64) (*OrderDTO, error) {
	return s.createMockOrder(ctx, userID, amount, channel, optionalPackageID(packageID), nil)
}

func (s *PaymentService) CreateMockPackageOrder(ctx context.Context, userID int64, pkg RechargePackageDTO, channel string) (*OrderDTO, error) {
	credits := pkg.EffectiveComputeCredits
	return s.createMockOrder(ctx, userID, pkg.Amount, channel, pkg.ID, &credits)
}

func (s *PaymentService) createMockOrder(ctx context.Context, userID int64, amount float64, channel string, packageID interface{}, creditsOverride *float64) (*OrderDTO, error) {
	if amount <= 0 {
		return nil, errors.New("充值金额必须大于 0")
	}
	if channel == "" {
		channel = "mock"
	}
	if channel != "mock" {
		return nil, errors.New("当前仅支持模拟支付渠道")
	}
	rate := s.computeRate(ctx)
	currency := "USD"
	if cfg, err := s.ProviderConfig(ctx); err == nil && cfg.Currency != "" {
		currency = cfg.Currency
	}
	credited := amount * rate
	if creditsOverride != nil && *creditsOverride > 0 {
		credited = roundCredits(*creditsOverride)
	}
	orderNo := fmt.Sprintf("ord_%d_%s", time.Now().UnixMilli(), util.NewPublicID("")[1:5])

	_, err := s.db.Exec(ctx,
		`INSERT INTO orders (order_no, user_id, channel, amount, currency, compute_credited, status, paid_at, payment_package_id)
		 VALUES ($1,$2,$3,$4,$5,$6,'paid',now(),$7)`,
		orderNo, userID, channel, amount, currency, credited, packageID)
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
		OrderNo: orderNo, Channel: channel, Amount: amount, Currency: currency, ComputeCredited: credited,
		Status: "paid", PaidAt: &now, CreatedAt: now,
	}, nil
}

// ProviderConfig returns the provider settings without exposing the webhook
// secret to callers. A provider is ready only when all required fields exist.
func (s *PaymentService) ProviderConfig(ctx context.Context) (PaymentProviderConfig, error) {
	rows, err := s.db.Query(ctx, `
		SELECT key, value FROM system_configs
		WHERE key LIKE 'payment_%' OR key LIKE 'stripe_%' OR key LIKE 'paypal_%'`)
	if err != nil {
		return PaymentProviderConfig{}, err
	}
	defer rows.Close()
	values := make(map[string]interface{})
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return PaymentProviderConfig{}, err
		}
		var value interface{}
		if err := json.Unmarshal(raw, &value); err == nil {
			values[key] = value
		}
	}
	cfg := PaymentProviderConfig{
		Enabled:             configBool(values["payment_enabled"], false),
		Provider:            strings.ToLower(strings.TrimSpace(configString(values["payment_provider"]))),
		Currency:            normalizeCurrency(configString(values["payment_currency"])),
		ProductName:         strings.TrimSpace(configString(values["payment_product_name"])),
		SuccessURL:          strings.TrimSpace(configString(values["payment_success_url"])),
		CancelURL:           strings.TrimSpace(configString(values["payment_cancel_url"])),
		CheckoutURL:         strings.TrimSpace(configString(values["payment_checkout_url_template"])),
		WebhookSecret:       strings.TrimSpace(configString(values["payment_webhook_secret"])),
		StripeSecretKey:     strings.TrimSpace(configString(values["stripe_secret_key"])),
		StripeWebhookSecret: strings.TrimSpace(configString(values["stripe_webhook_secret"])),
		PayPalMode:          strings.ToLower(strings.TrimSpace(configString(values["paypal_mode"]))),
		PayPalClientID:      strings.TrimSpace(configString(values["paypal_client_id"])),
		PayPalClientSecret:  strings.TrimSpace(configString(values["paypal_client_secret"])),
		PayPalWebhookID:     strings.TrimSpace(configString(values["paypal_webhook_id"])),
		PayPalBrandName:     strings.TrimSpace(configString(values["paypal_brand_name"])),
		ExpireMinutes:       configInt(values["payment_order_expire_minutes"], 30),
		MinAmount:           configFloat(values["payment_min_amount"], 1),
		MaxAmount:           configFloat(values["payment_max_amount"], 50000),
	}
	if cfg.Currency == "" {
		cfg.Currency = "USD"
	}
	if cfg.ProductName == "" {
		cfg.ProductName = "StarAI Credits"
	}
	if cfg.PayPalMode == "" {
		cfg.PayPalMode = "sandbox"
	}
	if cfg.PayPalBrandName == "" {
		cfg.PayPalBrandName = "StarAI"
	}
	if cfg.ExpireMinutes < 5 || cfg.ExpireMinutes > 1440 {
		cfg.ExpireMinutes = 30
	}
	return cfg, rows.Err()
}

func (c PaymentProviderConfig) Ready() bool {
	if !c.Enabled || normalizeCurrency(c.Currency) == "" {
		return false
	}
	switch c.Provider {
	case "generic":
		return validHTTPURL(c.CheckoutURL) && strings.Contains(c.CheckoutURL, "{order_no}") && c.GenericWebhookReady()
	case "stripe":
		validKey := strings.HasPrefix(c.StripeSecretKey, "sk_") || strings.HasPrefix(c.StripeSecretKey, "rk_")
		return validKey && c.StripeWebhookReady() &&
			validHTTPURL(c.SuccessURL) && validHTTPURL(c.CancelURL)
	case "paypal":
		return c.PayPalWebhookReady() &&
			validHTTPURL(c.SuccessURL) && validHTTPURL(c.CancelURL)
	default:
		return false
	}
}

func (c PaymentProviderConfig) GenericWebhookReady() bool {
	return len(c.WebhookSecret) >= 16
}

func (c PaymentProviderConfig) StripeWebhookReady() bool {
	return strings.HasPrefix(c.StripeWebhookSecret, "whsec_")
}

func (c PaymentProviderConfig) PayPalWebhookReady() bool {
	return (c.PayPalMode == "sandbox" || c.PayPalMode == "live") && c.PayPalClientID != "" &&
		c.PayPalClientSecret != "" && c.PayPalWebhookID != ""
}

// CreatePendingOrder creates an unpaid order for a configured external
// checkout. Money is never credited on this path; only a signed webhook can do
// that.
func (s *PaymentService) CreatePendingOrder(ctx context.Context, userID int64, amount float64, packageID ...int64) (*OrderDTO, error) {
	return s.createPendingOrder(ctx, userID, amount, optionalPackageID(packageID), nil)
}

func (s *PaymentService) CreatePendingPackageOrder(ctx context.Context, userID int64, pkg RechargePackageDTO) (*OrderDTO, error) {
	credits := pkg.EffectiveComputeCredits
	return s.createPendingOrder(ctx, userID, pkg.Amount, pkg.ID, &credits)
}

func (s *PaymentService) createPendingOrder(ctx context.Context, userID int64, amount float64, packageID interface{}, creditsOverride *float64) (*OrderDTO, error) {
	cfg, err := s.ProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	if !cfg.Ready() {
		return nil, errors.New("在线支付渠道尚未完整配置")
	}
	if amount < cfg.MinAmount || amount > cfg.MaxAmount {
		return nil, fmt.Errorf("充值金额需在 %.2f 至 %.2f 之间", cfg.MinAmount, cfg.MaxAmount)
	}
	rate := s.computeRate(ctx)
	credited := amount * rate
	if creditsOverride != nil && *creditsOverride > 0 {
		credited = roundCredits(*creditsOverride)
	}
	orderNo := fmt.Sprintf("ord_%d_%s", time.Now().UnixMilli(), util.NewPublicID("")[1:7])
	expireMinutes := cfg.ExpireMinutes
	if cfg.Provider == "stripe" && expireMinutes < 30 {
		expireMinutes = 30
	}
	if cfg.Provider == "paypal" && expireMinutes < 360 {
		expireMinutes = 360
	}
	expiresAt := time.Now().Add(time.Duration(expireMinutes) * time.Minute)
	_, err = s.db.Exec(ctx, `
		INSERT INTO orders (order_no, user_id, channel, amount, currency, compute_credited, status, expires_at, payment_package_id)
		VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)`, orderNo, userID, cfg.Provider, amount, cfg.Currency, credited, expiresAt, packageID)
	if err != nil {
		return nil, err
	}
	var checkoutURL, providerOrderID string
	switch cfg.Provider {
	case "generic":
		checkoutURL = strings.ReplaceAll(cfg.CheckoutURL, "{order_no}", url.QueryEscape(orderNo))
		checkoutURL = strings.ReplaceAll(checkoutURL, "{amount}", url.QueryEscape(strconv.FormatFloat(amount, 'f', 2, 64)))
	case "stripe":
		checkoutURL, providerOrderID, err = s.createStripeCheckout(ctx, cfg, orderNo, amount, expiresAt)
	case "paypal":
		checkoutURL, providerOrderID, err = s.createPayPalOrder(ctx, cfg, orderNo, amount)
	}
	if err != nil {
		_, _ = s.db.Exec(ctx, `UPDATE orders SET status='failed', remark=$1, updated_at=now() WHERE order_no=$2`, "provider_order_create_failed", orderNo)
		return nil, err
	}
	if !validHTTPURL(checkoutURL) {
		_, _ = s.db.Exec(ctx, `UPDATE orders SET status='failed', remark=$1, updated_at=now() WHERE order_no=$2`, "provider_checkout_url_invalid", orderNo)
		return nil, errors.New("支付渠道未返回有效收银台地址")
	}
	if _, err = s.db.Exec(ctx, `
		UPDATE orders SET checkout_url=$1, provider_order_id=NULLIF($2,''), updated_at=now()
		WHERE order_no=$3 AND status='pending'`, checkoutURL, providerOrderID, orderNo); err != nil {
		return nil, err
	}
	now := time.Now().Format(time.RFC3339)
	expires := expiresAt.Format(time.RFC3339)
	return &OrderDTO{OrderNo: orderNo, Channel: cfg.Provider, Amount: amount, Currency: cfg.Currency,
		ComputeCredited: credited, Status: "pending", CheckoutURL: checkoutURL,
		ExpiresAt: &expires, CreatedAt: now}, nil
}

// CompleteGenericWebhook verifies freshness and HMAC before atomically marking
// the order paid and crediting its wallet. Replayed callbacks are successful
// no-ops.
func (s *PaymentService) CompleteGenericWebhook(ctx context.Context, raw []byte, timestamp, signature string) (*PaymentCompletion, error) {
	cfg, err := s.ProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	if !cfg.GenericWebhookReady() {
		return nil, errors.New("支付回调未配置")
	}
	if err := VerifyGenericPaymentSignature(cfg.WebhookSecret, timestamp, raw, signature, time.Now()); err != nil {
		return nil, err
	}
	var payload struct {
		OrderNo       string  `json:"order_no"`
		Amount        float64 `json:"amount"`
		Status        string  `json:"status"`
		ProviderTrade string  `json:"provider_trade_no"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, errors.New("支付回调数据格式错误")
	}
	if strings.TrimSpace(payload.OrderNo) == "" || strings.TrimSpace(payload.ProviderTrade) == "" || payload.Status != "paid" {
		return nil, errors.New("支付回调字段无效")
	}
	digest := sha256.Sum256(raw)
	return s.completeOrder(ctx, payload.OrderNo, "generic", payload.ProviderTrade, payload.Amount, "", hex.EncodeToString(digest[:]))
}

func VerifyGenericPaymentSignature(secret, timestamp string, raw []byte, signature string, now time.Time) error {
	ts, err := strconv.ParseInt(strings.TrimSpace(timestamp), 10, 64)
	if err != nil || math.Abs(float64(now.Unix()-ts)) > 300 {
		return errors.New("支付回调时间戳无效或已过期")
	}
	provided, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(signature), "sha256="))
	if err != nil {
		return errors.New("支付回调签名格式错误")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(raw)
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return errors.New("支付回调签名校验失败")
	}
	return nil
}

func (s *PaymentService) completeOrder(ctx context.Context, orderNo, channel, providerTrade string, paidAmount float64, paidCurrency, digest string) (*PaymentCompletion, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var userID int64
	var amount, credited float64
	var status, currency string
	err = tx.QueryRow(ctx, `
		SELECT user_id, amount, compute_credited, status, currency
		FROM orders WHERE order_no=$1 AND channel=$2 FOR UPDATE`, orderNo, channel,
	).Scan(&userID, &amount, &credited, &status, &currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("支付订单不存在")
	}
	if err != nil {
		return nil, err
	}
	result := &PaymentCompletion{OrderNo: orderNo, UserID: userID, ComputeCredited: credited}
	if status == "paid" {
		result.AlreadyPaid = true
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		if err := s.billing.AwardReferralOnRecharge(ctx, userID, credited, "order", orderNo); err != nil {
			return nil, fmt.Errorf("订单已入账，但推荐奖励处理失败: %w", err)
		}
		return result, nil
	}
	if status != "pending" && status != "expired" {
		return nil, errors.New("支付订单状态不可入账")
	}
	if math.Abs(amount-paidAmount) > 0.000001 {
		return nil, errors.New("支付金额与订单不一致")
	}
	if paidCurrency != "" && normalizeCurrency(currency) != normalizeCurrency(paidCurrency) {
		return nil, errors.New("支付币种与订单不一致")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return nil, err
	}
	var balance float64
	if err = tx.QueryRow(ctx, `SELECT compute_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance); err != nil {
		return nil, err
	}
	newBalance := balance + credited
	if _, err = tx.Exec(ctx, `UPDATE wallets SET compute_balance=$1, updated_at=now() WHERE user_id=$2`, newBalance, userID); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark)
		VALUES ($1,'online_recharge','in',$2,$3,'order',$4,'在线充值')`, userID, credited, newBalance, orderNo); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `
		UPDATE orders SET status='paid', provider_trade_no=$1, callback_digest=$2, paid_at=now(), updated_at=now()
		WHERE order_no=$3`, providerTrade, digest, orderNo); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	if err := s.billing.AwardReferralOnRecharge(ctx, userID, credited, "order", orderNo); err != nil {
		return nil, fmt.Errorf("订单已入账，但推荐奖励处理失败: %w", err)
	}
	return result, nil
}

func validHTTPURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && parsed.Host != "" && (parsed.Scheme == "https" || parsed.Scheme == "http")
}

func normalizeCurrency(raw string) string {
	currency := strings.ToUpper(strings.TrimSpace(raw))
	if len(currency) != 3 {
		return ""
	}
	for _, ch := range currency {
		if ch < 'A' || ch > 'Z' {
			return ""
		}
	}
	return currency
}

func configString(v interface{}) string {
	s, _ := v.(string)
	return s
}

func configFloat(v interface{}, fallback float64) float64 {
	if n, ok := v.(float64); ok && n > 0 {
		return n
	}
	return fallback
}

func configInt(v interface{}, fallback int) int {
	if n, ok := v.(float64); ok {
		return int(n)
	}
	return fallback
}

func configBool(v interface{}, fallback bool) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return fallback
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

func (s *PaymentService) GetUserOrder(ctx context.Context, userID int64, orderNo string) (*OrderDTO, error) {
	var order OrderDTO
	var paidAt, expiresAt *time.Time
	var createdAt time.Time
	err := s.db.QueryRow(ctx, `
		SELECT order_no, channel, amount, currency, compute_credited, status,
		       COALESCE(checkout_url,''), expires_at, paid_at, created_at
		FROM orders WHERE user_id=$1 AND order_no=$2`, userID, orderNo,
	).Scan(&order.OrderNo, &order.Channel, &order.Amount, &order.Currency, &order.ComputeCredited,
		&order.Status, &order.CheckoutURL, &expiresAt, &paidAt, &createdAt)
	if err != nil {
		return nil, err
	}
	order.CreatedAt = createdAt.Format(time.RFC3339)
	if expiresAt != nil {
		value := expiresAt.Format(time.RFC3339)
		order.ExpiresAt = &value
	}
	if paidAt != nil {
		value := paidAt.Format(time.RFC3339)
		order.PaidAt = &value
	}
	return &order, nil
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
		SELECT o.order_no, o.channel, o.amount, o.currency, o.compute_credited, o.status, o.paid_at, o.created_at,
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
		if err := rows.Scan(&o.OrderNo, &o.Channel, &o.Amount, &o.Currency, &o.ComputeCredited, &o.Status, &paid, &created,
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
