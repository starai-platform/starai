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
)

func (s *PaymentService) createStripeCheckout(ctx context.Context, cfg PaymentProviderConfig, orderNo string, amount float64, expiresAt time.Time) (string, string, error) {
	minor, err := stripeMinorAmount(amount, cfg.Currency)
	if err != nil {
		return "", "", err
	}
	values := url.Values{}
	values.Set("mode", "payment")
	values.Set("client_reference_id", orderNo)
	values.Set("success_url", replacePaymentURL(cfg.SuccessURL, orderNo))
	values.Set("cancel_url", replacePaymentURL(cfg.CancelURL, orderNo))
	values.Set("expires_at", strconv.FormatInt(expiresAt.Unix(), 10))
	values.Set("line_items[0][quantity]", "1")
	values.Set("line_items[0][price_data][currency]", strings.ToLower(cfg.Currency))
	values.Set("line_items[0][price_data][unit_amount]", strconv.FormatInt(minor, 10))
	values.Set("line_items[0][price_data][product_data][name]", cfg.ProductName)
	values.Set("metadata[order_no]", orderNo)
	values.Set("payment_intent_data[metadata][order_no]", orderNo)
	raw, status, err := s.providerRequest(ctx, http.MethodPost, strings.TrimRight(s.stripeAPIBase, "/")+"/v1/checkout/sessions", map[string]string{
		"Authorization":   "Bearer " + cfg.StripeSecretKey,
		"Content-Type":    "application/x-www-form-urlencoded",
		"Idempotency-Key": orderNo,
	}, []byte(values.Encode()))
	if err != nil {
		return "", "", err
	}
	if status < 200 || status >= 300 {
		return "", "", paymentProviderAPIError("Stripe", status, raw)
	}
	var response struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if json.Unmarshal(raw, &response) != nil || response.ID == "" || !validHTTPURL(response.URL) {
		return "", "", errors.New("Stripe 返回的 Checkout Session 无效")
	}
	return response.URL, response.ID, nil
}

func (s *PaymentService) CompleteStripeWebhook(ctx context.Context, raw []byte, signature string) (*PaymentCompletion, bool, error) {
	cfg, err := s.ProviderConfig(ctx)
	if err != nil {
		return nil, false, err
	}
	if !cfg.StripeWebhookReady() {
		return nil, false, errors.New("Stripe webhook 配置不完整")
	}
	if err := VerifyStripeSignature(cfg.StripeWebhookSecret, raw, signature, time.Now()); err != nil {
		return nil, false, err
	}
	var event struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		Data struct {
			Object struct {
				ID                string            `json:"id"`
				ClientReferenceID string            `json:"client_reference_id"`
				PaymentStatus     string            `json:"payment_status"`
				AmountTotal       int64             `json:"amount_total"`
				Currency          string            `json:"currency"`
				PaymentIntent     interface{}       `json:"payment_intent"`
				Metadata          map[string]string `json:"metadata"`
			} `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &event); err != nil {
		return nil, false, errors.New("Stripe webhook 数据格式错误")
	}
	if event.Type != "checkout.session.completed" && event.Type != "checkout.session.async_payment_succeeded" {
		return nil, false, nil
	}
	session := event.Data.Object
	if session.PaymentStatus != "paid" {
		return nil, false, nil
	}
	orderNo := strings.TrimSpace(session.ClientReferenceID)
	if orderNo == "" {
		orderNo = strings.TrimSpace(session.Metadata["order_no"])
	}
	if orderNo == "" || session.ID == "" {
		return nil, false, errors.New("Stripe Checkout Session 缺少平台订单号")
	}
	matches, err := s.providerOrderMatches(ctx, orderNo, "stripe", session.ID)
	if err != nil || !matches {
		return nil, false, errors.New("Stripe Checkout Session 与平台订单不匹配")
	}
	paidAmount, err := stripeMajorAmount(session.AmountTotal, session.Currency)
	if err != nil {
		return nil, false, err
	}
	providerTrade := session.ID
	if paymentIntent, ok := session.PaymentIntent.(string); ok && paymentIntent != "" {
		providerTrade = paymentIntent
	}
	digest := sha256.Sum256(raw)
	result, err := s.completeOrder(ctx, orderNo, "stripe", providerTrade, paidAmount, session.Currency, hex.EncodeToString(digest[:]))
	return result, true, err
}

func VerifyStripeSignature(secret string, raw []byte, header string, now time.Time) error {
	var timestamp int64
	var signatures [][]byte
	for _, part := range strings.Split(header, ",") {
		pair := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(pair) != 2 {
			continue
		}
		switch pair[0] {
		case "t":
			timestamp, _ = strconv.ParseInt(pair[1], 10, 64)
		case "v1":
			if decoded, err := hex.DecodeString(pair[1]); err == nil {
				signatures = append(signatures, decoded)
			}
		}
	}
	if timestamp == 0 || math.Abs(float64(now.Unix()-timestamp)) > 300 {
		return errors.New("Stripe webhook 时间戳无效或已过期")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "%d.", timestamp)
	_, _ = mac.Write(raw)
	expected := mac.Sum(nil)
	for _, signature := range signatures {
		if hmac.Equal(signature, expected) {
			return nil
		}
	}
	return errors.New("Stripe webhook 签名校验失败")
}

func stripeMinorAmount(amount float64, currency string) (int64, error) {
	exponent, err := stripeCurrencyExponent(currency)
	if err != nil {
		return 0, err
	}
	factor := math.Pow10(exponent)
	minor := math.Round(amount * factor)
	if minor <= 0 || math.Abs(amount*factor-minor) > 0.000001 {
		return 0, errors.New("Stripe 支付金额精度不符合币种要求")
	}
	return int64(minor), nil
}

func stripeMajorAmount(minor int64, currency string) (float64, error) {
	exponent, err := stripeCurrencyExponent(currency)
	if err != nil {
		return 0, err
	}
	return float64(minor) / math.Pow10(exponent), nil
}

func stripeCurrencyExponent(currency string) (int, error) {
	currency = normalizeCurrency(currency)
	if currency == "" {
		return 0, errors.New("Stripe 支付币种无效")
	}
	zeroDecimal := map[string]bool{"BIF": true, "CLP": true, "DJF": true, "GNF": true, "JPY": true, "KMF": true, "KRW": true, "MGA": true, "PYG": true, "RWF": true, "UGX": true, "VND": true, "VUV": true, "XAF": true, "XOF": true, "XPF": true}
	threeDecimal := map[string]bool{"BHD": true, "JOD": true, "KWD": true, "OMR": true, "TND": true}
	if zeroDecimal[currency] {
		return 0, nil
	}
	if threeDecimal[currency] {
		return 3, nil
	}
	return 2, nil
}

func replacePaymentURL(template, orderNo string) string {
	return strings.ReplaceAll(template, "{order_no}", url.QueryEscape(orderNo))
}
