package runtime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var transientHTTPStatuses = map[int]bool{
	404: true, 408: true, 429: true, 500: true, 502: true, 503: true, 520: true, 521: true, 522: true, 524: true,
}

type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
	streamTO   time.Duration
}

type RequestConfig struct {
	BaseURL      string
	APIKey       string
	AuthType     string
	APIKeyHeader string
	Headers      map[string]string
}

func NewClient(baseURL, token string, timeoutSec, streamTimeoutSec int) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		httpClient: &http.Client{
			Timeout: time.Duration(timeoutSec) * time.Second,
		},
		streamTO: time.Duration(streamTimeoutSec) * time.Second,
	}
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Stream      bool          `json:"stream"`
	Temperature float64       `json:"temperature,omitempty"`
}

type ChatUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type ChatResponse struct {
	Choices []struct {
		Message ChatMessage `json:"message"`
	} `json:"choices"`
	Usage ChatUsage `json:"usage"`
}

type StreamChunk struct {
	Content string
	Done    bool
	Usage   *ChatUsage
	Error   error
}

func (c *Client) ChatCompletion(ctx context.Context, endpoint string, req ChatRequest) (*ChatResponse, error) {
	return c.ChatCompletionWithConfig(ctx, endpoint, req, nil)
}

func (c *Client) ChatCompletionWithConfig(ctx context.Context, endpoint string, req ChatRequest, cfg map[string]interface{}) (*ChatResponse, error) {
	if endpoint == "" {
		endpoint = "/v1/chat/completions"
	}
	requestCfg := c.resolveConfig(cfg)
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", requestCfg.BaseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	applyAuthHeaders(httpReq, requestCfg)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, mapError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, normalizeHTTPError(resp)
	}
	var result ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) ChatCompletionStream(ctx context.Context, endpoint string, req ChatRequest) (<-chan StreamChunk, error) {
	return c.ChatCompletionStreamWithConfig(ctx, endpoint, req, nil)
}

func (c *Client) ChatCompletionStreamWithConfig(ctx context.Context, endpoint string, req ChatRequest, cfg map[string]interface{}) (<-chan StreamChunk, error) {
	req.Stream = true
	if endpoint == "" {
		endpoint = "/v1/chat/completions"
	}
	requestCfg := c.resolveConfig(cfg)
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", requestCfg.BaseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	applyAuthHeaders(httpReq, requestCfg)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	streamClient := &http.Client{Timeout: c.streamTO}
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return nil, mapError(err)
	}
	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		return nil, normalizeHTTPError(resp)
	}

	ch := make(chan StreamChunk, 32)
	go func() {
		defer close(ch)
		defer resp.Body.Close()
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				ch <- StreamChunk{Done: true}
				return
			}
			var event struct {
				Choices []struct {
					Delta struct {
						Content string `json:"content"`
					} `json:"delta"`
				} `json:"choices"`
				Usage *ChatUsage `json:"usage"`
			}
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				continue
			}
			if len(event.Choices) > 0 {
				content := event.Choices[0].Delta.Content
				if content != "" {
					ch <- StreamChunk{Content: content}
				}
			}
			if event.Usage != nil {
				ch <- StreamChunk{Done: true, Usage: event.Usage}
				return
			}
		}
		ch <- StreamChunk{Done: true}
	}()
	return ch, nil
}

type ImageRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	N      int    `json:"n"`
	Size   string `json:"size"`
}

type ImageResponse struct {
	Data []struct {
		URL string `json:"url"`
	} `json:"data"`
}

func (c *Client) ImageGeneration(ctx context.Context, endpoint string, req ImageRequest) (*ImageResponse, error) {
	if endpoint == "" {
		endpoint = "/v1/images/generations"
	}
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.token)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, mapError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, normalizeHTTPError(resp)
	}
	var result ImageResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) resolveConfig(extra map[string]interface{}) RequestConfig {
	cfg := RequestConfig{BaseURL: c.baseURL, APIKey: c.token, AuthType: "bearer", APIKeyHeader: "Authorization", Headers: map[string]string{}}
	conn, _ := extra["connection"].(map[string]interface{})
	if conn == nil {
		return cfg
	}
	if s, ok := conn["base_url"].(string); ok && strings.TrimSpace(s) != "" {
		cfg.BaseURL = strings.TrimRight(strings.TrimSpace(s), "/")
	}
	if s, ok := conn["api_key"].(string); ok {
		cfg.APIKey = strings.TrimSpace(s)
	}
	if s, ok := conn["auth_type"].(string); ok && s != "" {
		cfg.AuthType = s
	}
	if s, ok := conn["api_key_header"].(string); ok && s != "" {
		cfg.APIKeyHeader = s
	}
	if h, ok := conn["headers"].(map[string]interface{}); ok {
		for k, v := range h {
			if s, ok := v.(string); ok {
				cfg.Headers[k] = s
			}
		}
	}
	return cfg
}

func applyAuthHeaders(req *http.Request, cfg RequestConfig) {
	for k, v := range cfg.Headers {
		req.Header.Set(k, v)
	}
	switch cfg.AuthType {
	case "none":
		return
	case "api_key_header":
		if cfg.APIKey != "" {
			req.Header.Set(cfg.APIKeyHeader, cfg.APIKey)
		}
	default:
		if cfg.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
		}
	}
}

type PlatformError struct {
	Code    string
	Message string
}

func (e *PlatformError) Error() string {
	return e.Message
}

func mapError(err error) error {
	if strings.Contains(err.Error(), "timeout") || strings.Contains(err.Error(), "deadline") {
		return &PlatformError{Code: "MODEL_TIMEOUT", Message: "生成超时，请重试"}
	}
	return &PlatformError{Code: "MODEL_PROVIDER_ERROR", Message: "模型服务异常"}
}

func normalizeHTTPError(resp *http.Response) error {
	body, _ := io.ReadAll(resp.Body)
	msg := string(body)
	switch resp.StatusCode {
	case 401, 403:
		return &PlatformError{Code: "MODEL_AUTH_FAILED", Message: "模型暂不可用"}
	case 429:
		return &PlatformError{Code: "MODEL_RATE_LIMITED", Message: "当前使用人数较多，请稍后重试"}
	default:
		if strings.Contains(msg, "content_policy") || strings.Contains(msg, "CONTENT") {
			return &PlatformError{Code: "CONTENT_REJECTED", Message: "内容不符合平台规范"}
		}
		if strings.Contains(msg, "insufficient_quota") {
			return &PlatformError{Code: "MODEL_QUOTA_EXHAUSTED", Message: "模型额度不足，平台处理中"}
		}
		return &PlatformError{Code: "MODEL_PROVIDER_ERROR", Message: "模型服务异常"}
	}
}

func FormatSSE(event string, data interface{}) string {
	b, _ := json.Marshal(data)
	return fmt.Sprintf("event: %s\ndata: %s\n\n", event, string(b))
}

func (c *Client) ResolveConfig(extra map[string]interface{}) RequestConfig {
	return c.resolveConfig(extra)
}

// OpenAuthenticatedStream GETs an upstream media URL with channel credentials and transient retries.
func (c *Client) OpenAuthenticatedStream(ctx context.Context, extra map[string]interface{}, mediaURL string) (*http.Response, error) {
	cfg := c.resolveConfig(extra)
	client := &http.Client{Timeout: 15 * time.Minute}
	const maxAttempts = 15
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
		if err != nil {
			return nil, err
		}
		applyAuthHeaders(req, cfg)
		req.Header.Set("Accept", "video/mp4,video/*,*/*")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			if attempt < maxAttempts {
				time.Sleep(time.Duration(attempt*3) * time.Second)
				continue
			}
			return nil, mapError(err)
		}
		if transientHTTPStatuses[resp.StatusCode] && attempt < maxAttempts {
			io.Copy(io.Discard, io.LimitReader(resp.Body, 512))
			resp.Body.Close()
			time.Sleep(time.Duration(attempt*5) * time.Second)
			continue
		}
		if resp.StatusCode >= 400 {
			defer resp.Body.Close()
			return nil, normalizeHTTPError(resp)
		}
		return resp, nil
	}
	if lastErr != nil {
		return nil, mapError(lastErr)
	}
	return nil, &PlatformError{Code: "MODEL_PROVIDER_ERROR", Message: "上游视频暂不可用"}
}
