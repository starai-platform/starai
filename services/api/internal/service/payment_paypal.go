package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type paypalLink struct {
	Href string `json:"href"`
	Rel  string `json:"rel"`
}

type paypalMoney struct {
	CurrencyCode string `json:"currency_code"`
	Value        string `json:"value"`
}

type paypalCapture struct {
	ID     string      `json:"id"`
	Status string      `json:"status"`
	Amount paypalMoney `json:"amount"`
}

type paypalOrderResponse struct {
	ID            string `json:"id"`
	Status        string `json:"status"`
	PurchaseUnits []struct {
		Payments struct {
			Captures []paypalCapture `json:"captures"`
		} `json:"payments"`
	} `json:"purchase_units"`
	Links []paypalLink `json:"links"`
}

func (s *PaymentService) createPayPalOrder(ctx context.Context, cfg PaymentProviderConfig, orderNo string, amount float64) (string, string, error) {
	token, err := s.paypalAccessToken(ctx, cfg)
	if err != nil {
		return "", "", err
	}
	amountText, err := providerAmountString(amount, cfg.Currency)
	if err != nil {
		return "", "", err
	}
	body := map[string]interface{}{
		"intent": "CAPTURE",
		"purchase_units": []interface{}{map[string]interface{}{
			"reference_id": "default",
			"custom_id":    orderNo,
			"invoice_id":   orderNo,
			"description":  cfg.ProductName,
			"amount": map[string]string{
				"currency_code": cfg.Currency,
				"value":         amountText,
			},
		}},
		"payment_source": map[string]interface{}{
			"paypal": map[string]interface{}{
				"experience_context": map[string]interface{}{
					"brand_name":                cfg.PayPalBrandName,
					"shipping_preference":       "NO_SHIPPING",
					"user_action":               "PAY_NOW",
					"payment_method_preference": "IMMEDIATE_PAYMENT_REQUIRED",
					"return_url":                replacePaymentURL(cfg.SuccessURL, orderNo),
					"cancel_url":                replacePaymentURL(cfg.CancelURL, orderNo),
				},
			},
		},
	}
	encoded, _ := json.Marshal(body)
	raw, status, err := s.providerRequest(ctx, http.MethodPost, s.paypalAPIBase(cfg)+"/v2/checkout/orders", map[string]string{
		"Authorization":     "Bearer " + token,
		"Content-Type":      "application/json",
		"Accept":            "application/json",
		"Prefer":            "return=representation",
		"PayPal-Request-Id": orderNo,
	}, encoded)
	if err != nil {
		return "", "", err
	}
	if status < 200 || status >= 300 {
		return "", "", paymentProviderAPIError("PayPal", status, raw)
	}
	var response paypalOrderResponse
	if json.Unmarshal(raw, &response) != nil || response.ID == "" {
		return "", "", errors.New("PayPal 返回的订单数据无效")
	}
	checkoutURL := paypalApprovalURL(response.Links)
	if !validHTTPURL(checkoutURL) {
		return "", "", errors.New("PayPal 未返回有效的付款批准地址")
	}
	return checkoutURL, response.ID, nil
}

func providerAmountString(amount float64, currency string) (string, error) {
	exponent, err := stripeCurrencyExponent(currency)
	if err != nil {
		return "", err
	}
	factor := math.Pow10(exponent)
	if math.Abs(amount*factor-math.Round(amount*factor)) > 0.000001 {
		return "", errors.New("支付金额精度不符合币种要求")
	}
	return strconv.FormatFloat(amount, 'f', exponent, 64), nil
}

func (s *PaymentService) CompletePayPalWebhook(ctx context.Context, raw []byte, headers map[string]string) (*PaymentCompletion, bool, error) {
	cfg, err := s.ProviderConfig(ctx)
	if err != nil {
		return nil, false, err
	}
	if !cfg.PayPalWebhookReady() {
		return nil, false, errors.New("PayPal webhook 配置不完整")
	}
	token, err := s.paypalAccessToken(ctx, cfg)
	if err != nil {
		return nil, false, err
	}
	if err := s.verifyPayPalWebhook(ctx, cfg, token, raw, headers); err != nil {
		return nil, false, err
	}
	var event struct {
		ID        string          `json:"id"`
		EventType string          `json:"event_type"`
		Resource  json.RawMessage `json:"resource"`
	}
	if json.Unmarshal(raw, &event) != nil || event.ID == "" {
		return nil, false, errors.New("PayPal webhook 数据格式错误")
	}
	digest := sha256.Sum256(raw)
	switch event.EventType {
	case "CHECKOUT.ORDER.APPROVED":
		var approved struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(event.Resource, &approved) != nil || approved.ID == "" {
			return nil, false, errors.New("PayPal 批准事件缺少订单号")
		}
		orderNo, err := s.localOrderByProviderID(ctx, "paypal", approved.ID)
		if err != nil {
			return nil, false, errors.New("PayPal 订单与平台订单不匹配")
		}
		capture, err := s.capturePayPalOrder(ctx, cfg, token, orderNo, approved.ID)
		if err != nil {
			return nil, false, err
		}
		amount, err := strconv.ParseFloat(capture.Amount.Value, 64)
		if err != nil || capture.Status != "COMPLETED" {
			return nil, false, errors.New("PayPal 订单尚未完成扣款")
		}
		result, err := s.completeOrder(ctx, orderNo, "paypal", capture.ID, amount, capture.Amount.CurrencyCode, hex.EncodeToString(digest[:]))
		return result, true, err
	case "PAYMENT.CAPTURE.COMPLETED":
		var captured struct {
			ID                string      `json:"id"`
			Status            string      `json:"status"`
			Amount            paypalMoney `json:"amount"`
			SupplementaryData struct {
				RelatedIDs struct {
					OrderID string `json:"order_id"`
				} `json:"related_ids"`
			} `json:"supplementary_data"`
		}
		if json.Unmarshal(event.Resource, &captured) != nil || captured.ID == "" || captured.SupplementaryData.RelatedIDs.OrderID == "" {
			return nil, false, errors.New("PayPal capture 事件字段不完整")
		}
		orderNo, err := s.localOrderByProviderID(ctx, "paypal", captured.SupplementaryData.RelatedIDs.OrderID)
		if err != nil {
			return nil, false, errors.New("PayPal capture 与平台订单不匹配")
		}
		amount, err := strconv.ParseFloat(captured.Amount.Value, 64)
		if err != nil || captured.Status != "COMPLETED" {
			return nil, false, errors.New("PayPal capture 金额或状态无效")
		}
		result, err := s.completeOrder(ctx, orderNo, "paypal", captured.ID, amount, captured.Amount.CurrencyCode, hex.EncodeToString(digest[:]))
		return result, true, err
	default:
		return nil, false, nil
	}
}

func (s *PaymentService) paypalAccessToken(ctx context.Context, cfg PaymentProviderConfig) (string, error) {
	form := url.Values{"grant_type": []string{"client_credentials"}}
	authorization := base64.StdEncoding.EncodeToString([]byte(cfg.PayPalClientID + ":" + cfg.PayPalClientSecret))
	raw, status, err := s.providerRequest(ctx, http.MethodPost, s.paypalAPIBase(cfg)+"/v1/oauth2/token", map[string]string{
		"Authorization": "Basic " + authorization,
		"Content-Type":  "application/x-www-form-urlencoded",
		"Accept":        "application/json",
	}, []byte(form.Encode()))
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", paymentProviderAPIError("PayPal OAuth", status, raw)
	}
	var response struct {
		AccessToken string `json:"access_token"`
	}
	if json.Unmarshal(raw, &response) != nil || response.AccessToken == "" {
		return "", errors.New("PayPal OAuth 未返回 access token")
	}
	return response.AccessToken, nil
}

func (s *PaymentService) verifyPayPalWebhook(ctx context.Context, cfg PaymentProviderConfig, token string, raw []byte, headers map[string]string) error {
	required := []string{"paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"}
	for _, key := range required {
		if strings.TrimSpace(headers[key]) == "" {
			return fmt.Errorf("PayPal webhook 缺少请求头 %s", key)
		}
	}
	verification := struct {
		AuthAlgo         string `json:"auth_algo"`
		CertURL          string `json:"cert_url"`
		TransmissionID   string `json:"transmission_id"`
		TransmissionSig  string `json:"transmission_sig"`
		TransmissionTime string `json:"transmission_time"`
		WebhookID        string `json:"webhook_id"`
	}{
		AuthAlgo: headers["paypal-auth-algo"], CertURL: headers["paypal-cert-url"],
		TransmissionID: headers["paypal-transmission-id"], TransmissionSig: headers["paypal-transmission-sig"],
		TransmissionTime: headers["paypal-transmission-time"], WebhookID: cfg.PayPalWebhookID,
	}
	metadata, _ := json.Marshal(verification)
	body := make([]byte, 0, len(metadata)+len(raw)+20)
	body = append(body, metadata[:len(metadata)-1]...)
	body = append(body, []byte(`,"webhook_event":`)...)
	body = append(body, raw...)
	body = append(body, '}')
	responseRaw, status, err := s.providerRequest(ctx, http.MethodPost, s.paypalAPIBase(cfg)+"/v1/notifications/verify-webhook-signature", map[string]string{
		"Authorization": "Bearer " + token,
		"Content-Type":  "application/json",
		"Accept":        "application/json",
	}, body)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return paymentProviderAPIError("PayPal webhook 验签", status, responseRaw)
	}
	var response struct {
		VerificationStatus string `json:"verification_status"`
	}
	if json.Unmarshal(responseRaw, &response) != nil || response.VerificationStatus != "SUCCESS" {
		return errors.New("PayPal webhook 签名校验失败")
	}
	return nil
}

func (s *PaymentService) capturePayPalOrder(ctx context.Context, cfg PaymentProviderConfig, token, orderNo, providerOrderID string) (paypalCapture, error) {
	headers := map[string]string{
		"Authorization":     "Bearer " + token,
		"Content-Type":      "application/json",
		"Accept":            "application/json",
		"Prefer":            "return=representation",
		"PayPal-Request-Id": orderNo + "-capture",
	}
	raw, status, err := s.providerRequest(ctx, http.MethodPost, s.paypalAPIBase(cfg)+"/v2/checkout/orders/"+url.PathEscape(providerOrderID)+"/capture", headers, []byte(`{}`))
	if err != nil {
		return paypalCapture{}, err
	}
	if status >= 200 && status < 300 {
		return firstCompletedPayPalCapture(raw)
	}
	// A repeated approved webhook can race with an already completed capture.
	// Fetching the order is safe and lets the idempotent local credit finish.
	getRaw, getStatus, getErr := s.providerRequest(ctx, http.MethodGet, s.paypalAPIBase(cfg)+"/v2/checkout/orders/"+url.PathEscape(providerOrderID), map[string]string{
		"Authorization": "Bearer " + token,
		"Accept":        "application/json",
	}, nil)
	if getErr == nil && getStatus >= 200 && getStatus < 300 {
		if capture, parseErr := firstCompletedPayPalCapture(getRaw); parseErr == nil {
			return capture, nil
		}
	}
	return paypalCapture{}, paymentProviderAPIError("PayPal capture", status, raw)
}

func firstCompletedPayPalCapture(raw []byte) (paypalCapture, error) {
	var order paypalOrderResponse
	if json.Unmarshal(raw, &order) != nil {
		return paypalCapture{}, errors.New("PayPal capture 响应格式错误")
	}
	for _, unit := range order.PurchaseUnits {
		for _, capture := range unit.Payments.Captures {
			if capture.Status == "COMPLETED" && capture.ID != "" {
				return capture, nil
			}
		}
	}
	return paypalCapture{}, errors.New("PayPal 响应中没有已完成的 capture")
}

func paypalApprovalURL(links []paypalLink) string {
	for _, rel := range []string{"payer-action", "approve"} {
		for _, link := range links {
			if link.Rel == rel {
				return link.Href
			}
		}
	}
	return ""
}

func (s *PaymentService) paypalAPIBase(cfg PaymentProviderConfig) string {
	if cfg.PayPalMode == "live" {
		return strings.TrimRight(s.paypalLiveAPI, "/")
	}
	return strings.TrimRight(s.paypalTestAPI, "/")
}
