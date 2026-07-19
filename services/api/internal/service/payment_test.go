package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCreateMockOrderRejectsNonMockChannel(t *testing.T) {
	svc := &PaymentService{}
	if _, err := svc.CreateMockOrder(context.Background(), 1, 10, "alipay"); err == nil {
		t.Fatal("expected non-mock payment channel to be rejected")
	}
}

func TestRechargePackageAmountValidation(t *testing.T) {
	svc := &PaymentService{}
	for _, amount := range []float64{0, -1, 1_000_000.01} {
		if _, err := svc.UpsertRechargePackage(context.Background(), "", RechargePackageInput{Name: "invalid", Amount: amount, IsEnabled: true}); err == nil {
			t.Fatalf("expected amount %v to be rejected", amount)
		}
	}
}

func TestRechargePackageManualCreditsValidation(t *testing.T) {
	svc := &PaymentService{}
	invalid := 0.0
	if _, err := svc.UpsertRechargePackage(context.Background(), "", RechargePackageInput{Name: "invalid", Amount: 10, ComputeCredits: &invalid, IsEnabled: true}); err == nil {
		t.Fatal("zero manual credits should be rejected; nil is required for formula mode")
	}
	if got := roundCredits(72.1234567); got != 72.123457 {
		t.Fatalf("roundCredits=%v", got)
	}
}

func TestOptionalPackageID(t *testing.T) {
	if optionalPackageID(nil) != nil || optionalPackageID([]int64{0}) != nil {
		t.Fatal("empty package id should be NULL")
	}
	if got := optionalPackageID([]int64{42}); got != int64(42) {
		t.Fatalf("package id=%v", got)
	}
}

func TestVerifyGenericPaymentSignature(t *testing.T) {
	now := time.Unix(1_720_000_000, 0)
	timestamp := strconv.FormatInt(now.Unix(), 10)
	body := []byte(`{"order_no":"ord_test","amount":10,"status":"paid","provider_trade_no":"trade_1"}`)
	mac := hmac.New(sha256.New, []byte("a-random-test-secret"))
	_, _ = mac.Write([]byte(timestamp + "."))
	_, _ = mac.Write(body)
	signature := hex.EncodeToString(mac.Sum(nil))
	if err := VerifyGenericPaymentSignature("a-random-test-secret", timestamp, body, signature, now); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	if err := VerifyGenericPaymentSignature("a-random-test-secret", timestamp, body, "00", now); err == nil {
		t.Fatal("invalid signature accepted")
	}
	if err := VerifyGenericPaymentSignature("a-random-test-secret", timestamp, body, signature, now.Add(6*time.Minute)); err == nil {
		t.Fatal("expired timestamp accepted")
	}
}

func TestPaymentProviderConfigReady(t *testing.T) {
	cfg := PaymentProviderConfig{Enabled: true, Provider: "generic", Currency: "USD", CheckoutURL: "https://pay.example/checkout?order={order_no}", WebhookSecret: "a-random-test-secret"}
	if !cfg.Ready() {
		t.Fatal("complete generic provider config should be ready")
	}
	cfg.WebhookSecret = "short"
	if cfg.Ready() {
		t.Fatal("short webhook secret must not be ready")
	}
}

func TestStripeProviderConfigReady(t *testing.T) {
	cfg := PaymentProviderConfig{Enabled: true, Provider: "stripe", Currency: "USD", StripeSecretKey: "sk_test_example", StripeWebhookSecret: "whsec_example", SuccessURL: "https://example.com/success", CancelURL: "https://example.com/cancel"}
	if !cfg.Ready() {
		t.Fatal("complete Stripe config should be ready")
	}
	cfg.StripeWebhookSecret = "wrong"
	if cfg.Ready() {
		t.Fatal("invalid Stripe webhook secret accepted")
	}
}

func TestPayPalProviderConfigReady(t *testing.T) {
	cfg := PaymentProviderConfig{Enabled: true, Provider: "paypal", Currency: "USD", PayPalMode: "sandbox", PayPalClientID: "client", PayPalClientSecret: "secret", PayPalWebhookID: "webhook", SuccessURL: "https://example.com/success", CancelURL: "https://example.com/cancel"}
	if !cfg.Ready() {
		t.Fatal("complete PayPal config should be ready")
	}
	cfg.PayPalMode = "invalid"
	if cfg.Ready() {
		t.Fatal("invalid PayPal mode accepted")
	}
}

func TestVerifyStripeSignature(t *testing.T) {
	now := time.Unix(1_720_000_000, 0)
	raw := []byte(`{"id":"evt_1"}`)
	timestamp := strconv.FormatInt(now.Unix(), 10)
	mac := hmac.New(sha256.New, []byte("whsec_test"))
	_, _ = mac.Write([]byte(timestamp + "."))
	_, _ = mac.Write(raw)
	header := "t=" + timestamp + ",v1=" + hex.EncodeToString(mac.Sum(nil))
	if err := VerifyStripeSignature("whsec_test", raw, header, now); err != nil {
		t.Fatalf("valid Stripe signature rejected: %v", err)
	}
	if err := VerifyStripeSignature("whsec_test", raw, header, now.Add(6*time.Minute)); err == nil {
		t.Fatal("expired Stripe signature accepted")
	}
}

func TestStripeAmounts(t *testing.T) {
	for _, tc := range []struct {
		amount   float64
		currency string
		minor    int64
	}{{10.25, "USD", 1025}, {1000, "JPY", 1000}, {1.234, "KWD", 1234}} {
		minor, err := stripeMinorAmount(tc.amount, tc.currency)
		if err != nil || minor != tc.minor {
			t.Fatalf("stripeMinorAmount(%v,%s) = %d, %v", tc.amount, tc.currency, minor, err)
		}
	}
}

func TestCreateStripeCheckout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk_test_example" || r.Header.Get("Idempotency-Key") != "ord_test" {
			t.Errorf("unexpected Stripe headers")
		}
		body, _ := io.ReadAll(r.Body)
		values, _ := url.ParseQuery(string(body))
		if values.Get("client_reference_id") != "ord_test" || values.Get("line_items[0][price_data][unit_amount]") != "1234" {
			t.Errorf("unexpected Stripe form: %s", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "cs_test_1", "url": "https://checkout.stripe.test/session"})
	}))
	defer server.Close()
	svc := &PaymentService{httpClient: server.Client(), stripeAPIBase: server.URL}
	cfg := PaymentProviderConfig{Currency: "USD", ProductName: "Credits", StripeSecretKey: "sk_test_example", SuccessURL: "https://example.com/success?order={order_no}", CancelURL: "https://example.com/cancel"}
	checkout, sessionID, err := svc.createStripeCheckout(context.Background(), cfg, "ord_test", 12.34, time.Now().Add(time.Hour))
	if err != nil || sessionID != "cs_test_1" || !strings.HasPrefix(checkout, "https://") {
		t.Fatalf("Stripe checkout = %q, %q, %v", checkout, sessionID, err)
	}
}

func TestCreatePayPalOrder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/oauth2/token":
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "token"})
		case "/v2/checkout/orders":
			if r.Header.Get("Authorization") != "Bearer token" || r.Header.Get("PayPal-Request-Id") != "ord_test" {
				t.Errorf("unexpected PayPal headers")
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": "PAYPAL_ORDER", "links": []map[string]string{{"rel": "payer-action", "href": "https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL_ORDER"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	svc := &PaymentService{httpClient: server.Client(), paypalTestAPI: server.URL}
	cfg := PaymentProviderConfig{Currency: "USD", ProductName: "Credits", PayPalMode: "sandbox", PayPalClientID: "client", PayPalClientSecret: "secret", PayPalBrandName: "StarAI", SuccessURL: "https://example.com/success", CancelURL: "https://example.com/cancel"}
	checkout, providerID, err := svc.createPayPalOrder(context.Background(), cfg, "ord_test", 12.34)
	if err != nil || providerID != "PAYPAL_ORDER" || !strings.Contains(checkout, "paypal.com") {
		t.Fatalf("PayPal order = %q, %q, %v", checkout, providerID, err)
	}
}

func TestVerifyPayPalWebhookPostback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/notifications/verify-webhook-signature" || r.Header.Get("Authorization") != "Bearer token" {
			t.Errorf("unexpected PayPal verification request")
		}
		var payload struct {
			WebhookID    string          `json:"webhook_id"`
			WebhookEvent json.RawMessage `json:"webhook_event"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if payload.WebhookID != "WH_TEST" || !strings.Contains(string(payload.WebhookEvent), `"id": "event_1"`) {
			t.Errorf("webhook event was not preserved: %s", payload.WebhookEvent)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"verification_status": "SUCCESS"})
	}))
	defer server.Close()
	svc := &PaymentService{httpClient: server.Client(), paypalTestAPI: server.URL}
	cfg := PaymentProviderConfig{PayPalMode: "sandbox", PayPalWebhookID: "WH_TEST"}
	headers := map[string]string{
		"paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.paypal.test/cert",
		"paypal-transmission-id": "transmission", "paypal-transmission-sig": "signature", "paypal-transmission-time": "2026-01-01T00:00:00Z",
	}
	if err := svc.verifyPayPalWebhook(context.Background(), cfg, "token", []byte(`{ "id": "event_1", "event_type": "TEST" }`), headers); err != nil {
		t.Fatalf("PayPal webhook verification failed: %v", err)
	}
}

func TestProviderAmountString(t *testing.T) {
	if value, err := providerAmountString(1200, "JPY"); err != nil || value != "1200" {
		t.Fatalf("JPY amount = %q, %v", value, err)
	}
	if value, err := providerAmountString(12.34, "USD"); err != nil || value != "12.34" {
		t.Fatalf("USD amount = %q, %v", value, err)
	}
}
