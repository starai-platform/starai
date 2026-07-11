package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const maxPaymentProviderResponse = 1 << 20

func (s *PaymentService) providerRequest(ctx context.Context, method, endpoint string, headers map[string]string, body []byte) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	client := s.httpClient
	if client == nil {
		client = &http.Client{}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxPaymentProviderResponse+1))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if len(raw) > maxPaymentProviderResponse {
		return nil, resp.StatusCode, errors.New("支付渠道响应过大")
	}
	return raw, resp.StatusCode, nil
}

func paymentProviderAPIError(provider string, status int, raw []byte) error {
	message := ""
	var payload map[string]interface{}
	if json.Unmarshal(raw, &payload) == nil {
		message = nestedProviderMessage(payload)
	}
	message = strings.TrimSpace(message)
	if message == "" {
		message = strings.TrimSpace(string(raw))
	}
	if len([]rune(message)) > 300 {
		message = string([]rune(message)[:300])
	}
	if message == "" {
		message = http.StatusText(status)
	}
	return fmt.Errorf("%s API 请求失败（HTTP %d）：%s", provider, status, message)
}

func nestedProviderMessage(payload map[string]interface{}) string {
	if value, ok := payload["message"].(string); ok {
		return value
	}
	if value, ok := payload["error_description"].(string); ok {
		return value
	}
	if value, ok := payload["error"].(string); ok {
		return value
	}
	if value, ok := payload["error"].(map[string]interface{}); ok {
		if message, ok := value["message"].(string); ok {
			return message
		}
	}
	if details, ok := payload["details"].([]interface{}); ok && len(details) > 0 {
		if detail, ok := details[0].(map[string]interface{}); ok {
			if description, ok := detail["description"].(string); ok {
				return description
			}
		}
	}
	return ""
}

func (s *PaymentService) providerOrderMatches(ctx context.Context, orderNo, channel, providerOrderID string) (bool, error) {
	var stored string
	err := s.db.QueryRow(ctx, `
		SELECT COALESCE(provider_order_id,'') FROM orders
		WHERE order_no=$1 AND channel=$2`, orderNo, channel).Scan(&stored)
	if err != nil {
		return false, err
	}
	return stored != "" && stored == providerOrderID, nil
}

func (s *PaymentService) localOrderByProviderID(ctx context.Context, channel, providerOrderID string) (string, error) {
	var orderNo string
	err := s.db.QueryRow(ctx, `
		SELECT order_no FROM orders WHERE channel=$1 AND provider_order_id=$2`, channel, providerOrderID).Scan(&orderNo)
	return orderNo, err
}
