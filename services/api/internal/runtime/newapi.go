package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

var transientHTTPStatuses = map[int]bool{
	404: true, 408: true, 429: true, 500: true, 502: true, 503: true, 504: true, 520: true, 521: true, 522: true, 523: true, 524: true,
}

type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
	streamTO   time.Duration
	streamHTTP sync.Map
}

type RequestConfig struct {
	BaseURL      string
	APIKey       string
	AuthType     string
	APIKeyHeader string
	Headers      map[string]string
}

type ConnectionTestResult struct {
	OK         bool   `json:"ok"`
	Message    string `json:"message"`
	StatusCode int    `json:"status_code,omitempty"`
	LatencyMS  int64  `json:"latency_ms"`
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
	Role             string `json:"role"`
	Content          string `json:"content"`
	ReasoningContent string `json:"reasoning_content,omitempty"`
}

type ChatRequest struct {
	Model         string                 `json:"model"`
	Messages      interface{}            `json:"messages"`
	Stream        bool                   `json:"stream"`
	StreamOptions *ChatStreamOptions     `json:"stream_options,omitempty"`
	Temperature   *float64               `json:"temperature,omitempty"`
	Extra         map[string]interface{} `json:"-"`
}

type ChatStreamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

func Float64Ptr(value float64) *float64 {
	return &value
}

type ChatUsage struct {
	PromptTokens             int `json:"prompt_tokens"`
	CompletionTokens         int `json:"completion_tokens"`
	TotalTokens              int `json:"total_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	PromptTokensDetails      struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
}

func (u ChatUsage) CachedInputTokens() int {
	if u.CacheReadInputTokens > 0 {
		return u.CacheReadInputTokens
	}
	return u.PromptTokensDetails.CachedTokens
}

type ChatResponse struct {
	ID            string        `json:"id,omitempty"`
	Model         string        `json:"model,omitempty"`
	Choices       []ChatChoice  `json:"choices"`
	Usage         ChatUsage     `json:"usage"`
	ContentBlocks []interface{} `json:"-"`
}

type ChatChoice struct {
	Message      ChatMessage              `json:"message"`
	ToolCalls    []map[string]interface{} `json:"tool_calls,omitempty"`
	FinishReason string                   `json:"finish_reason,omitempty"`
}

type UpstreamModel struct {
	ID      string `json:"id"`
	Object  string `json:"object,omitempty"`
	OwnedBy string `json:"owned_by,omitempty"`
	Created int64  `json:"created,omitempty"`
}

type StreamChunk struct {
	Content          string
	ReasoningContent string
	ToolCalls        []map[string]interface{}
	Done             bool
	Usage            *ChatUsage
	Error            error
}

func (c *Client) ChatCompletion(ctx context.Context, endpoint string, req ChatRequest) (*ChatResponse, error) {
	return c.ChatCompletionWithConfig(ctx, endpoint, req, nil)
}

func (c *Client) ChatCompletionWithConfig(ctx context.Context, endpoint string, req ChatRequest, cfg map[string]interface{}) (*ChatResponse, error) {
	requestCfg := c.resolveConfig(cfg)
	endpoint, body, protocol, err := prepareChatRequest(endpoint, req, cfg)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", joinEndpoint(requestCfg.BaseURL, endpoint), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	applyAuthHeaders(httpReq, requestCfg)
	applyChatProtocolHeaders(httpReq, protocol, cfg)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, mapError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, normalizeHTTPError(resp)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	return decodeChatResponse(protocol, raw)
}

func (c *Client) ChatCompletionStream(ctx context.Context, endpoint string, req ChatRequest) (<-chan StreamChunk, error) {
	return c.ChatCompletionStreamWithConfig(ctx, endpoint, req, nil)
}

func (c *Client) ChatCompletionStreamWithConfig(ctx context.Context, endpoint string, req ChatRequest, cfg map[string]interface{}) (<-chan StreamChunk, error) {
	req.Stream = true
	includeUsage := true
	if configured, ok := cfg["stream_include_usage"].(bool); ok {
		includeUsage = configured
	}
	if includeUsage {
		req.StreamOptions = &ChatStreamOptions{IncludeUsage: true}
	}
	requestCfg := c.resolveConfig(cfg)
	endpoint, body, protocol, err := prepareChatRequest(endpoint, req, cfg)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", joinEndpoint(requestCfg.BaseURL, endpoint), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	applyAuthHeaders(httpReq, requestCfg)
	applyChatProtocolHeaders(httpReq, protocol, cfg)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	streamClient := c.streamClient(cfg)
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
		consumeChatStream(resp.Body, protocol, ch)
	}()
	return ch, nil
}

func (c *Client) streamClient(cfg map[string]interface{}) *http.Client {
	seconds := 30
	if configured, ok := cfg["timeout_seconds"]; ok {
		switch value := configured.(type) {
		case int:
			seconds = value
		case int64:
			seconds = int(value)
		case float64:
			seconds = int(value)
		}
	}
	if seconds < 1 {
		seconds = 30
	}
	if seconds > 30 {
		seconds = 30
	}
	if c.streamTO > 0 && time.Duration(seconds)*time.Second > c.streamTO {
		seconds = int(c.streamTO / time.Second)
		if seconds < 1 {
			seconds = 1
		}
	}
	if cached, ok := c.streamHTTP.Load(seconds); ok {
		return cached.(*http.Client)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = time.Duration(seconds) * time.Second
	client := &http.Client{Transport: transport, Timeout: c.streamTO}
	actual, loaded := c.streamHTTP.LoadOrStore(seconds, client)
	if loaded {
		transport.CloseIdleConnections()
		return actual.(*http.Client)
	}
	return client
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
	return c.ImageGenerationWithConfig(ctx, endpoint, req, nil)
}

func (c *Client) ImageGenerationWithConfig(ctx context.Context, endpoint string, req ImageRequest, cfg map[string]interface{}) (*ImageResponse, error) {
	requestCfg := c.resolveConfig(cfg)
	endpoint = defaultEndpoint(endpoint, "/v1/images/generations")

	// Support protocol adaptation for images
	protocol := mediaProtocol(cfg)
	body, err := prepareImageRequest(req, protocol, cfg)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", joinEndpoint(requestCfg.BaseURL, endpoint), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	applyAuthHeaders(httpReq, requestCfg)
	applyMediaProtocolHeaders(httpReq, protocol, cfg)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, mapError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, normalizeHTTPError(resp)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	return decodeImageResponse(protocol, raw)
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
		apiKey := strings.TrimSpace(s)
		// Support environment variable reference: ${VAR_NAME}
		if strings.HasPrefix(apiKey, "${") && strings.HasSuffix(apiKey, "}") {
			envVar := strings.TrimSuffix(strings.TrimPrefix(apiKey, "${"), "}")
			if envValue := strings.TrimSpace(getEnv(envVar)); envValue != "" {
				apiKey = envValue
			}
		}
		cfg.APIKey = apiKey
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
	Code       string
	Message    string
	StatusCode int
	Detail     string
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
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	detail := connectionTestMessage(body)
	msg := strings.ToLower(detail)
	platformError := func(code, message string) error {
		return &PlatformError{Code: code, Message: message, StatusCode: resp.StatusCode, Detail: detail}
	}
	if strings.Contains(msg, "content_policy") || strings.Contains(msg, "content filter") || strings.Contains(msg, "safety") {
		return platformError("CONTENT_REJECTED", "内容不符合平台规范")
	}
	if strings.Contains(msg, "insufficient_quota") || strings.Contains(msg, "insufficient quota") {
		return platformError("MODEL_QUOTA_EXHAUSTED", "模型额度不足，平台处理中")
	}
	switch resp.StatusCode {
	case 400, 422:
		return platformError("MODEL_BAD_REQUEST", "模型请求参数或内容不兼容，请检查线路配置后重试")
	case 401, 403:
		return platformError("MODEL_AUTH_FAILED", "模型线路鉴权失败，平台处理中")
	case 429:
		return platformError("MODEL_RATE_LIMITED", "当前使用人数较多，请稍后重试")
	case 502, 503, 504, 520, 521, 522, 523, 524:
		return platformError("MODEL_GATEWAY_ERROR", "模型线路网关暂时异常，系统已尝试恢复，请稍后重试")
	default:
		return platformError("MODEL_PROVIDER_ERROR", "模型服务异常")
	}
}

func FormatSSE(event string, data interface{}) string {
	b, _ := json.Marshal(data)
	return fmt.Sprintf("event: %s\ndata: %s\n\n", event, string(b))
}

func (c *Client) ResolveConfig(extra map[string]interface{}) RequestConfig {
	return c.resolveConfig(extra)
}

func marshalChatRequest(req ChatRequest) ([]byte, error) {
	base := map[string]interface{}{
		"model":    req.Model,
		"messages": req.Messages,
		"stream":   req.Stream,
	}
	if req.StreamOptions != nil {
		base["stream_options"] = req.StreamOptions
	}
	if req.Temperature != nil {
		base["temperature"] = *req.Temperature
	}
	for key, value := range req.Extra {
		if key == "" || value == nil {
			continue
		}
		base[key] = value
	}
	return json.Marshal(base)
}

func defaultEndpoint(endpoint, fallback string) string {
	if strings.TrimSpace(endpoint) == "" {
		return fallback
	}
	return strings.TrimSpace(endpoint)
}

func joinEndpoint(baseURL, endpoint string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return baseURL
	}
	if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
		return endpoint
	}
	if !strings.HasPrefix(endpoint, "/") {
		endpoint = "/" + endpoint
	}
	if strings.HasSuffix(baseURL, endpoint) {
		return baseURL
	}
	// Allow Base URL to include the protocol prefix (/v1 or /v1beta) without
	// producing the common /v1/v1/... or /v1beta/v1beta/... duplicate path.
	for _, prefix := range []string{"/compatible-mode/v1", "/api/v1", "/v1beta", "/v1"} {
		if strings.HasSuffix(baseURL, prefix) && (endpoint == prefix || strings.HasPrefix(endpoint, prefix+"/")) {
			endpoint = strings.TrimPrefix(endpoint, prefix)
			if endpoint == "" {
				return baseURL
			}
			break
		}
	}
	return baseURL + endpoint
}

func (c *Client) ListModels(ctx context.Context, extra map[string]interface{}) ([]UpstreamModel, error) {
	cfg := c.resolveConfig(extra)
	protocol := chatProtocol(extra)
	endpoint := modelListEndpoint(protocol, "")
	if conn, ok := extra["connection"].(map[string]interface{}); ok {
		if configured, ok := conn["models_endpoint"].(string); ok && strings.TrimSpace(configured) != "" {
			configured = strings.TrimSpace(configured)
			if !(protocol == chatProtocolGemini && configured == "/v1/models") {
				endpoint = configured
			}
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, joinEndpoint(cfg.BaseURL, endpoint), nil)
	if err != nil {
		return nil, err
	}
	applyAuthHeaders(req, cfg)
	applyChatProtocolHeaders(req, protocol, extra)
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, mapError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, normalizeHTTPError(resp)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	var payload struct {
		Data   []UpstreamModel `json:"data"`
		Models []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		var items []UpstreamModel
		if arrayErr := json.Unmarshal(raw, &items); arrayErr == nil {
			return items, nil
		}
		return nil, err
	}
	if payload.Data != nil {
		return payload.Data, nil
	}
	items := make([]UpstreamModel, 0, len(payload.Models))
	for _, item := range payload.Models {
		id := item.ID
		if id == "" {
			id = strings.TrimPrefix(item.Name, "models/")
		}
		if id != "" {
			items = append(items, UpstreamModel{ID: id, Object: "model"})
		}
	}
	return items, nil
}

func (c *Client) TestModelConnection(ctx context.Context, endpoint, requestMode, model string, extra map[string]interface{}) (result ConnectionTestResult) {
	startedAt := time.Now()
	defer func() {
		result.LatencyMS = time.Since(startedAt).Milliseconds()
	}()

	cfg := c.resolveConfig(extra)
	if strings.TrimSpace(cfg.BaseURL) == "" {
		result.Message = "未配置上游 Base URL"
		return result
	}
	probeCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if requestMode == "chat_completions" || requestMode == "images" {
		listCtx, listCancel := context.WithTimeout(probeCtx, 5*time.Second)
		models, listErr := c.ListModels(listCtx, extra)
		listCancel()
		if listErr == nil {
			for _, item := range models {
				if item.ID == model {
					result.OK = true
					if requestMode == "images" {
						result.Message = "图片服务连接、鉴权及模型列表正常（未提交生图；参考图编辑接口未实际生成验证）"
					} else {
						result.Message = "连接、鉴权及模型列表正常"
					}
					result.StatusCode = http.StatusOK
					return result
				}
			}
			if requestMode == "chat_completions" {
				result.StatusCode = http.StatusOK
				result.Message = fmt.Sprintf("连接与鉴权正常，但上游模型列表中没有 %q", model)
				return result
			}
		}
		// Some OpenAI-compatible providers omit GET /v1/models. Fall back to
		// endpoint validation instead of treating a 404 as a bad key.
	}
	if strings.TrimSpace(endpoint) == "" {
		switch requestMode {
		case "responses":
			endpoint = "/v1/responses"
		case "images":
			endpoint = "/v1/images/generations"
		case "video":
			endpoint = "/v1/video/generations"
		case "audio":
			endpoint = "/v1/audio/speech"
		default:
			endpoint = "/v1/chat/completions"
		}
	}

	protocol := chatProtocol(extra)
	var body []byte
	var err error
	if requestMode == "chat_completions" {
		endpoint, body, protocol, err = prepareChatRequest(endpoint, ChatRequest{
			Model:    model,
			Messages: []ChatMessage{{Role: "user", Content: "ping"}},
			Extra:    map[string]interface{}{"max_completion_tokens": 1, "max_tokens": 1},
		}, extra)
		if err != nil {
			result.Message = "测试请求创建失败：" + err.Error()
			return result
		}
	} else if requestMode == "images" {
		protocol = mediaProtocol(extra)
		// An empty request can only exercise endpoint/auth/validation. Supplying a
		// model can make some providers enqueue a paid job despite an invalid prompt.
		body = []byte(`{}`)
	} else if requestMode == "video" {
		protocol = mediaProtocol(extra)
		body, err = prepareVideoRequest(VideoRequest{
			Model:  model,
			Prompt: "test",
			Extra:  map[string]interface{}{"duration": "5s", "size": "1280x720"},
		}, protocol, extra)
		if err != nil {
			result.Message = "测试请求创建失败：" + err.Error()
			return result
		}
	} else if requestMode == "audio" {
		protocol = mediaProtocol(extra)
		body, err = prepareAudioRequest(AudioRequest{
			Model:  model,
			Input:  "test",
			Voice:  "alloy",
			Format: "mp3",
		}, protocol, extra)
		if err != nil {
			result.Message = "测试请求创建失败：" + err.Error()
			return result
		}
	} else {
		probePayload := map[string]interface{}{"model": model, "stream": false}
		if requestMode == "responses" {
			probePayload["input"] = "ping"
		}
		body, _ = json.Marshal(probePayload)
	}
	req, err := http.NewRequestWithContext(probeCtx, http.MethodPost, joinEndpoint(cfg.BaseURL, endpoint), bytes.NewReader(body))
	if err != nil {
		result.Message = "测试请求创建失败：" + err.Error()
		return result
	}
	applyAuthHeaders(req, cfg)
	if requestMode == "chat_completions" {
		applyChatProtocolHeaders(req, protocol, extra)
	} else if requestMode == "images" || requestMode == "video" || requestMode == "audio" {
		applyMediaProtocolHeaders(req, protocol, extra)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "timeout") {
			result.Message = "连接超时，请检查上游地址或网络"
		} else {
			result.Message = "无法连接上游服务：" + err.Error()
		}
		return result
	}
	defer resp.Body.Close()
	result.StatusCode = resp.StatusCode
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	upstreamMessage := connectionTestMessage(raw)

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		result.OK = true
		result.Message = "连接、鉴权及模型路由正常"
	case resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnprocessableEntity:
		result.OK = true
		if requestMode == "images" {
			result.Message = "图片生成接口连接与鉴权正常（校验探针已响应，未提交生图；参考图编辑接口未实际生成验证）"
		} else {
			result.Message = "连接与鉴权正常（上游参数校验已响应）"
		}
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		result.Message = "鉴权失败，请检查 API Key、认证方式和请求头"
	case resp.StatusCode == http.StatusNotFound:
		result.Message = "上游接口不存在，请检查 Base URL 和 Endpoint"
	case resp.StatusCode == http.StatusTooManyRequests:
		result.Message = "已连接上游，但当前被限流或额度不足"
	default:
		result.Message = fmt.Sprintf("上游返回 HTTP %d", resp.StatusCode)
	}
	if !result.OK && upstreamMessage != "" {
		result.Message += "：" + upstreamMessage
	}
	return result
}

func connectionTestMessage(raw []byte) string {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return ""
	}
	var payload map[string]interface{}
	if json.Unmarshal(raw, &payload) == nil {
		if errObj, ok := payload["error"].(map[string]interface{}); ok {
			if message, ok := errObj["message"].(string); ok {
				text = message
			}
		} else if message, ok := payload["message"].(string); ok {
			text = message
		}
	}
	text = strings.Join(strings.Fields(text), " ")
	if len([]rune(text)) > 180 {
		text = string([]rune(text)[:180]) + "…"
	}
	return text
}

type VideoRequest struct {
	Model  string                 `json:"model"`
	Prompt string                 `json:"prompt"`
	Extra  map[string]interface{} `json:"-"`
}

type VideoResponse struct {
	TaskID string `json:"task_id,omitempty"`
	ID     string `json:"id,omitempty"`
	Status string `json:"status,omitempty"`
}

func (c *Client) VideoGeneration(ctx context.Context, endpoint string, req VideoRequest) (*VideoResponse, error) {
	return c.VideoGenerationWithConfig(ctx, endpoint, req, nil)
}

func (c *Client) VideoGenerationWithConfig(ctx context.Context, endpoint string, req VideoRequest, cfg map[string]interface{}) (*VideoResponse, error) {
	requestCfg := c.resolveConfig(cfg)
	endpoint = defaultEndpoint(endpoint, "/v1/video/generations")

	protocol := mediaProtocol(cfg)
	body, err := prepareVideoRequest(req, protocol, cfg)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", joinEndpoint(requestCfg.BaseURL, endpoint), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	applyAuthHeaders(httpReq, requestCfg)
	applyMediaProtocolHeaders(httpReq, protocol, cfg)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, mapError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, normalizeHTTPError(resp)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	return decodeVideoResponse(protocol, raw)
}

type AudioRequest struct {
	Model  string                 `json:"model"`
	Input  string                 `json:"input"`
	Voice  string                 `json:"voice,omitempty"`
	Format string                 `json:"format,omitempty"`
	Extra  map[string]interface{} `json:"-"`
}

type AudioResponse struct {
	TaskID string `json:"task_id,omitempty"`
	ID     string `json:"id,omitempty"`
	URL    string `json:"url,omitempty"`
	Status string `json:"status,omitempty"`
}

func (c *Client) AudioGeneration(ctx context.Context, endpoint string, req AudioRequest) (*AudioResponse, error) {
	return c.AudioGenerationWithConfig(ctx, endpoint, req, nil)
}

func (c *Client) AudioGenerationWithConfig(ctx context.Context, endpoint string, req AudioRequest, cfg map[string]interface{}) (*AudioResponse, error) {
	requestCfg := c.resolveConfig(cfg)
	endpoint = defaultEndpoint(endpoint, "/v1/audio/speech")

	protocol := mediaProtocol(cfg)
	body, err := prepareAudioRequest(req, protocol, cfg)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", joinEndpoint(requestCfg.BaseURL, endpoint), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	applyAuthHeaders(httpReq, requestCfg)
	applyMediaProtocolHeaders(httpReq, protocol, cfg)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, mapError(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, normalizeHTTPError(resp)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	return decodeAudioResponse(protocol, raw)
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

// getEnv retrieves environment variable value with fallback
func getEnv(key string) string {
	return os.Getenv(key)
}
