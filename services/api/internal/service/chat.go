package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/runtime"
	"github.com/starai/api/internal/util"
)

type ChatService struct {
	db      *pgxpool.Pool
	models  *ModelService
	billing *billing.Service
	runtime *runtime.Client
	ops     *OpsService
}

func NewChatService(db *pgxpool.Pool, models *ModelService, billing *billing.Service, rt *runtime.Client, ops *OpsService) *ChatService {
	return &ChatService{db: db, models: models, billing: billing, runtime: rt, ops: ops}
}

func (s *ChatService) RuntimeClient() *runtime.Client {
	return s.runtime
}

type ConversationDTO struct {
	PublicID  string  `json:"public_id"`
	Title     *string `json:"title,omitempty"`
	ModelCode *string `json:"model_code,omitempty"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

func (s *ChatService) CreateConversation(ctx context.Context, userID int64, modelCode, title string) (*ConversationDTO, error) {
	publicID := util.NewPublicID("conv")
	var modelID *int64
	if modelCode != "" {
		m, err := s.models.GetByCode(ctx, modelCode, true)
		if err != nil {
			return nil, err
		}
		modelID = &m.ID
	}
	var id int64
	err := s.db.QueryRow(ctx,
		`INSERT INTO conversations (public_id, user_id, model_id, title) VALUES ($1,$2,$3,$4) RETURNING id`,
		publicID, userID, modelID, title).Scan(&id)
	if err != nil {
		return nil, err
	}
	now := time.Now().Format(time.RFC3339)
	return &ConversationDTO{PublicID: publicID, Title: &title, ModelCode: &modelCode, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *ChatService) ListConversations(ctx context.Context, userID int64, modelCode, scope string) ([]ConversationDTO, error) {
	args := []interface{}{userID}
	// Abandoned requests can create a conversation before the upstream model
	// answers. Keep those empty rows out of history: there is nothing to restore.
	where := "c.user_id=$1 AND EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.conversation_id=c.id)"
	if modelCode != "" {
		args = append(args, modelCode)
		where += fmt.Sprintf(" AND m.code=$%d", len(args))
	}
	if scope == "creative_agent" {
		where += ` AND (
			c.title ~ '^(Agent 通用智能体|Ageng 通用智能体|Agneg 通用智能体|通用智能体)'
			OR EXISTS (
				SELECT 1 FROM conversation_messages agent_message
				WHERE agent_message.conversation_id=c.id
				  AND agent_message.role='system'
				  AND agent_message.content ~ '"type":"creative_agent_[^"]+"'
			)
		)`
	}
	rows, err := s.db.Query(ctx, `
		SELECT c.public_id, c.title, m.code, c.created_at, c.updated_at
		FROM conversations c LEFT JOIN models m ON m.id = c.model_id
		WHERE `+where+` ORDER BY c.updated_at DESC LIMIT 50`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ConversationDTO
	for rows.Next() {
		var item ConversationDTO
		var created, updated time.Time
		if err := rows.Scan(&item.PublicID, &item.Title, &item.ModelCode, &created, &updated); err != nil {
			return nil, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		item.UpdatedAt = updated.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, nil
}

type CompletionInput struct {
	Model          string                 `json:"model"`
	ModelCode      string                 `json:"model_code"`
	ConversationID string                 `json:"conversation_id"`
	Messages       []runtime.ChatMessage  `json:"messages"`
	Params         map[string]interface{} `json:"params"`
	Stream         bool                   `json:"stream"`
	Ephemeral      bool                   `json:"ephemeral"`
	BillingLabel   string                 `json:"-"`
}

type CompletionResult struct {
	RequestID        string                   `json:"request_id"`
	ConversationID   string                   `json:"conversation_id"`
	Content          string                   `json:"content"`
	ReasoningContent string                   `json:"reasoning_content,omitempty"`
	ContentBlocks    []interface{}            `json:"content_blocks,omitempty"`
	ToolCalls        []map[string]interface{} `json:"tool_calls,omitempty"`
	Usage            runtime.ChatUsage        `json:"usage"`
	Cost             float64                  `json:"cost"`
}

type BalanceError struct {
	ConversationID string
	RequestID      string
}

func (e *BalanceError) Error() string {
	return billing.InsufficientBalanceMsg
}

func (s *ChatService) ResolveInputModel(ctx context.Context, input *CompletionInput) (*ModelFull, error) {
	if input == nil {
		return nil, errors.New("model not found")
	}
	model, err := s.models.ResolveChatModel(ctx, input.modelIdentifier())
	if err != nil {
		return nil, err
	}
	input.ModelCode = model.Code
	if input.Model == "" {
		input.Model = model.Code
	}
	return model, nil
}

func (in CompletionInput) modelIdentifier() string {
	if strings.TrimSpace(in.ModelCode) != "" {
		return strings.TrimSpace(in.ModelCode)
	}
	return strings.TrimSpace(in.Model)
}

func (s *ChatService) Completion(ctx context.Context, userID int64, input CompletionInput) (*CompletionResult, error) {
	model, err := s.ResolveInputModel(ctx, &input)
	if err != nil {
		return nil, err
	}

	prepareChatBillingParams(&input)
	estimated := s.models.EstimateCost(model, input.Params, 0, 0)
	requestID := util.NewRequestID()

	if err := s.billing.Freeze(ctx, userID, estimated, "chat", requestID); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return nil, s.balanceError(ctx, userID, input, requestID)
		}
		return nil, err
	}

	var temperature *float64
	if v, ok := input.Params["temperature"].(float64); ok {
		temperature = runtime.Float64Ptr(v)
	}
	req := runtime.ChatRequest{
		Model:       model.NewAPIModel,
		Messages:    chatRequestMessages(input.Messages, input.Params),
		Temperature: temperature,
		Extra:       nil,
	}
	start := time.Now()
	requestCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	resp, selectedRoute, err := s.chatCompletionWithFailover(requestCtx, requestID, model, req, input.Params)
	duration := int(time.Since(start).Milliseconds())
	if err != nil {
		if unfreezeErr := s.billing.Unfreeze(ctx, userID, estimated, "chat", requestID); unfreezeErr != nil {
			s.logCall(ctx, requestID, userID, model.ID, nil, 0, 0, 0, 0, "billing_failed", unfreezeErr, duration)
			return nil, fmt.Errorf("模型调用失败: %v；释放冻结额度失败: %w", err, unfreezeErr)
		}
		s.logCallWithRoute(ctx, requestID, userID, model.ID, routeID(selectedRoute), nil, 0, 0, 0, 0, 0, "failed", err, duration)
		return nil, err
	}
	content := ""
	reasoningContent := ""
	if len(resp.Choices) > 0 {
		content = resp.Choices[0].Message.Content
		reasoningContent = resp.Choices[0].Message.ReasoningContent
	}
	usage := normalizedChatUsage(resp.Usage, input, content)
	actualCost := s.models.EstimateCostWithTokenDetails(model, input.Params, usage.PromptTokens, usage.CompletionTokens, usage.CachedInputTokens(), usage.CacheCreationInputTokens)
	providerCost := EstimateRouteProviderCostWithTokenDetails(selectedRoute, input.Params, usage.PromptTokens, usage.CompletionTokens, usage.CachedInputTokens(), usage.CacheCreationInputTokens)
	if selectedRoute != nil {
		s.models.UpdateSuccessfulRouteAttemptCost(ctx, requestID, selectedRoute.ID, providerCost)
	}
	if err := s.billing.Charge(ctx, userID, estimated, actualCost, "chat", requestID, "chat_usage", chatBillingLabel(input.BillingLabel, "对话消费")); err != nil {
		s.logCall(ctx, requestID, userID, model.ID, nil, usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens, 0, "billing_failed", err, duration)
		return nil, fmt.Errorf("对话结算失败: %w", err)
	}
	s.logCallWithRoute(ctx, requestID, userID, model.ID, routeID(selectedRoute), nil, usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens, actualCost, providerCost, "success", nil, duration)

	convID := input.ConversationID
	if !input.Ephemeral {
		if convID == "" {
			conv, _ := s.CreateConversation(ctx, userID, input.ModelCode, truncate(input.Messages[len(input.Messages)-1].Content, 30))
			if conv != nil {
				convID = conv.PublicID
			}
		}
		s.saveMessages(ctx, convID, userID, input.Messages, content, reasoningContent)
	}

	var blocks []interface{}
	var toolCalls []map[string]interface{}
	if len(resp.ContentBlocks) > 0 {
		blocks = resp.ContentBlocks
	}
	if len(resp.Choices) > 0 {
		toolCalls = resp.Choices[0].ToolCalls
	}
	return &CompletionResult{RequestID: requestID, ConversationID: convID, Content: content, ReasoningContent: reasoningContent, ContentBlocks: blocks, ToolCalls: toolCalls, Usage: usage, Cost: actualCost}, nil
}

func (s *ChatService) CompletionStream(ctx context.Context, userID int64, input CompletionInput) (string, <-chan runtime.StreamChunk, float64, error) {
	model, err := s.ResolveInputModel(ctx, &input)
	if err != nil {
		return "", nil, 0, err
	}

	prepareChatBillingParams(&input)
	estimated := s.models.EstimateCost(model, input.Params, 0, 0)
	requestID := util.NewRequestID()
	if err := s.billing.Freeze(ctx, userID, estimated, "chat", requestID); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return "", nil, 0, s.balanceError(ctx, userID, input, requestID)
		}
		return "", nil, 0, err
	}
	var temperature *float64
	if v, ok := input.Params["temperature"].(float64); ok {
		temperature = runtime.Float64Ptr(v)
	}
	req := runtime.ChatRequest{Model: model.NewAPIModel, Messages: chatRequestMessages(input.Messages, input.Params), Temperature: temperature, Extra: nil}
	// per-request timeout override (seconds)
	var timeoutCancel context.CancelFunc
	if v, ok := input.Params["timeout_sec"].(float64); ok && v > 0 && v <= 600 {
		ctx, timeoutCancel = context.WithTimeout(ctx, time.Duration(v)*time.Second)
	}
	ch, _, err := s.chatCompletionStreamWithFailover(ctx, requestID, model, req, input.Params)
	if err != nil {
		if timeoutCancel != nil {
			timeoutCancel()
		}
		if unfreezeErr := s.billing.Unfreeze(ctx, userID, estimated, "chat", requestID); unfreezeErr != nil {
			return "", nil, 0, fmt.Errorf("模型流启动失败: %v；释放冻结额度失败: %w", err, unfreezeErr)
		}
		return "", nil, 0, err
	}
	if timeoutCancel != nil {
		forwarded := make(chan runtime.StreamChunk, 32)
		go func() {
			defer close(forwarded)
			defer timeoutCancel()
			for chunk := range ch {
				forwarded <- chunk
			}
		}()
		ch = forwarded
	}
	return requestID, ch, estimated, nil
}

func chatRequestMessages(messages []runtime.ChatMessage, params map[string]interface{}) interface{} {
	images := stringSliceParam(params["reference_images"])
	videos := stringSliceParam(params["reference_videos"])
	audios := stringSliceParam(params["reference_audios"])
	if len(images) == 0 && len(videos) == 0 && len(audios) == 0 {
		return messages
	}
	out := make([]map[string]interface{}, 0, len(messages))
	lastUser := -1
	for index, message := range messages {
		if message.Role == "user" {
			lastUser = index
		}
	}
	for index, message := range messages {
		if index != lastUser {
			out = append(out, map[string]interface{}{"role": message.Role, "content": message.Content})
			continue
		}
		content := []map[string]interface{}{
			{"type": "text", "text": message.Content},
		}
		for _, url := range images {
			content = append(content, map[string]interface{}{
				"type":      "image_url",
				"image_url": map[string]interface{}{"url": url},
			})
		}
		for _, url := range videos {
			content = append(content, map[string]interface{}{
				"type":      "video_url",
				"video_url": map[string]interface{}{"url": url},
			})
		}
		for _, url := range audios {
			content = append(content, map[string]interface{}{
				"type": "audio_url", "audio_url": map[string]interface{}{"url": url},
			})
		}
		out = append(out, map[string]interface{}{"role": message.Role, "content": content})
	}
	return out
}

func chatUpstreamParams(params map[string]interface{}) map[string]interface{} {
	allowed := []string{
		"max_tokens", "max_completion_tokens", "top_p", "response_format", "tools", "tool_choice",
		"reasoning_effort", "reasoning", "thinking", "enable_thinking", "thinking_budget", "thinkingConfig", "chat_template_kwargs", "reasoning_budget", "output_config", "seed", "stop", "presence_penalty", "frequency_penalty", "user", "n",
	}
	out := make(map[string]interface{}, len(allowed))
	for _, key := range allowed {
		if value, ok := params[key]; ok && value != nil {
			out[key] = value
		}
	}
	return out
}

func buildChatUpstreamParams(model *ModelFull, params map[string]interface{}) (map[string]interface{}, error) {
	merged := mergeModelRouteMaps(model.NewAPIExtraParams, model.DefaultParams)
	merged = mergeModelRouteMaps(merged, params)
	if limit := firstPositiveIntValue(params, "_agent_plan_output_limit"); limit > 0 {
		cfg := chatReasoningConfig(model)
		if enabled, _ := reasoningEnabled(merged, cfg); enabled && stringValue(cfg["mode"]) == "claude_budget" {
			budget, _ := reasoningBudget(merged, cfg)
			if budget+1024 > limit {
				limit = budget + 1024 // Preserve valid configured thinking budgets.
			}
		}
		key := "max_tokens"
		name := strings.ToLower(model.NewAPIModel)
		if merged["max_completion_tokens"] != nil || strings.HasPrefix(name, "gpt-5") || strings.HasPrefix(name, "gpt-6") || strings.HasPrefix(name, "o1") || strings.HasPrefix(name, "o3") || strings.HasPrefix(name, "o4") {
			key = "max_completion_tokens"
		}
		for _, existing := range []string{"max_tokens", "max_completion_tokens"} {
			if n := firstPositiveIntValue(merged, existing); n > 0 && n < limit {
				limit = n
			}
			delete(merged, existing)
		}
		merged[key] = limit
	}
	return applyChatReasoning(model, merged, chatUpstreamParams(merged))
}

func reasoningEnabled(params, config map[string]interface{}) (bool, error) {
	if raw, ok := params["deep_think"]; ok && raw != nil {
		value, ok := raw.(bool)
		if !ok {
			return false, errors.New("deep_think must be a boolean")
		}
		return value, nil
	}
	if raw, ok := params["chat_template_kwargs"].(map[string]interface{}); ok {
		if value, exists := raw["enable_thinking"]; exists {
			enabled, ok := value.(bool)
			if !ok {
				return false, errors.New("chat_template_kwargs.enable_thinking must be a boolean")
			}
			return enabled, nil
		}
	}
	if value, ok := config["default_enabled"].(bool); ok {
		return value, nil
	}
	return false, nil
}

func reasoningBudget(params, config map[string]interface{}) (int, error) {
	budget := firstPositiveIntValue(params, "reasoning_budget")
	if raw, supplied := params["reasoning_budget"]; supplied && raw != nil && budget <= 0 {
		return 0, errors.New("reasoning_budget must be a positive integer")
	}
	if budget <= 0 {
		budget = firstPositiveIntValue(config, "default_budget")
	}
	maximum := firstPositiveIntValue(config, "max_budget")
	if maximum > 0 && budget > maximum {
		return 0, errors.New("reasoning_budget exceeds the model limit")
	}
	return budget, nil
}

func stringSliceParam(value interface{}) []string {
	raw, ok := value.([]interface{})
	if !ok {
		if typed, typedOK := value.([]string); typedOK {
			return typed
		}
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, textOK := item.(string); textOK && strings.TrimSpace(text) != "" {
			out = append(out, strings.TrimSpace(text))
		}
	}
	return out
}

func routeID(route *ModelRoute) int64 {
	if route == nil {
		return 0
	}
	return route.ID
}

func legacyModelRoute(model *ModelFull) ModelRoute {
	conn, _ := model.NewAPIExtraParams["connection"].(map[string]interface{})
	return ModelRoute{
		ModelID: model.ID, RouteName: "legacy", UpstreamModel: model.NewAPIModel,
		Endpoint: model.NewAPIEndpoint, BaseURL: stringValue(conn["base_url"]),
		APIKey: stringValue(conn["api_key"]), AuthType: stringValue(conn["auth_type"]),
		APIKeyHeader: stringValue(conn["api_key_header"]), Protocol: stringValue(conn["protocol"]),
		Headers: mapValue(conn["headers"]), ExtraParams: copyMap(model.NewAPIExtraParams),
		TimeoutSeconds: 90, MaxRetries: 1, IsEnabled: true, HealthStatus: "healthy", Weight: 100,
	}
}

func mapValue(value interface{}) map[string]interface{} {
	if typed, ok := value.(map[string]interface{}); ok {
		return typed
	}
	return map[string]interface{}{}
}

func routeErrorDetails(err error) (int, string) {
	var platformErr *runtime.PlatformError
	if errors.As(err, &platformErr) {
		return platformErr.StatusCode, platformErr.Code
	}
	return 0, "UNKNOWN"
}

func isRouteFailoverError(err error) bool {
	var platformErr *runtime.PlatformError
	if !errors.As(err, &platformErr) {
		return true
	}
	if platformErr.Code == "CONTENT_REJECTED" {
		return false
	}
	if platformErr.StatusCode == 400 || platformErr.StatusCode == 422 {
		return false
	}
	return true
}

func shouldRetrySameRoute(err error, hasAlternative bool) bool {
	var platformErr *runtime.PlatformError
	if !errors.As(err, &platformErr) {
		return !hasAlternative
	}
	if platformErr.Code == "MODEL_TIMEOUT" || platformErr.Code == "CONTENT_REJECTED" || platformErr.Code == "MODEL_BAD_REQUEST" {
		return false
	}
	if platformErr.StatusCode == 408 || platformErr.StatusCode >= 500 {
		if hasAlternative && isGatewayFailureStatus(platformErr.StatusCode) {
			return false
		}
		return true
	}
	return platformErr.StatusCode == 0 && (platformErr.Code == "MODEL_TIMEOUT" || platformErr.Code == "MODEL_PROVIDER_ERROR")
}

func isGatewayFailureStatus(status int) bool {
	switch status {
	case 502, 503, 504, 520, 521, 522, 523, 524:
		return true
	default:
		return false
	}
}

func waitRouteRetry(ctx context.Context, retry int) bool {
	delay := time.Duration(retry+1) * 200 * time.Millisecond
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

const maxRouteAttemptsPerRequest = 8

func (s *ChatService) modelRuntimeRoutes(ctx context.Context, model *ModelFull) ([]ModelRoute, error) {
	routes, err := s.models.RuntimeRoutes(ctx, model)
	if err != nil {
		return nil, &runtime.PlatformError{Code: "MODEL_PROVIDER_ERROR", Message: "模型所有线路暂时不可用，请稍后重试"}
	}
	if len(routes) == 0 {
		routes = []ModelRoute{legacyModelRoute(model)}
	}
	return routes, nil
}

func (s *ChatService) chatCompletionWithFailover(ctx context.Context, requestID string, model *ModelFull, req runtime.ChatRequest, params map[string]interface{}) (*runtime.ChatResponse, *ModelRoute, error) {
	routes, err := s.modelRuntimeRoutes(ctx, model)
	if err != nil {
		return nil, nil, err
	}
	var lastErr error
	attempt := 0
routeLoop:
	for i := range routes {
		route := &routes[i]
		if mediaErr := chatRouteMediaError(model, route, req.Messages); mediaErr != nil {
			lastErr = mediaErr
			continue
		}
		attemptReq, mappingErr := chatRouteRequest(req, model, *route, params)
		if mappingErr != nil {
			lastErr = mappingErr
			continue
		}
		if !s.models.AcquireRouteProbe(ctx, route) {
			continue
		}
		for retry := 0; retry <= route.MaxRetries; retry++ {
			if attempt >= maxRouteAttemptsPerRequest {
				break routeLoop
			}
			attempt++
			started := time.Now()
			attemptCtx := ctx
			var cancel context.CancelFunc
			if route.TimeoutSeconds > 0 {
				attemptCtx, cancel = context.WithTimeout(ctx, time.Duration(route.TimeoutSeconds)*time.Second)
			}
			response, callErr := s.runtime.ChatCompletionWithConfig(attemptCtx, route.Endpoint, attemptReq, route.RequestExtraForRequest(model, requestID))
			if cancel != nil {
				cancel()
			}
			latency := int(time.Since(started).Milliseconds())
			if callErr == nil {
				s.models.MarkRouteSuccess(ctx, route.ID)
				s.models.LogRouteAttempt(ctx, requestID, model.ID, route.ID, attempt, "success", 200, "", latency, 0)
				return response, route, nil
			}
			lastErr = callErr
			statusCode, errorCode := routeErrorDetails(callErr)
			if platformErr, ok := callErr.(*runtime.PlatformError); ok && platformErr.Detail != "" {
				log.Printf("model route failed: request_id=%s route_id=%d status=%d code=%s detail=%q", requestID, route.ID, statusCode, errorCode, platformErr.Detail)
			}
			if !isRouteFailoverError(callErr) {
				s.models.LogRouteAttempt(ctx, requestID, model.ID, route.ID, attempt, "rejected", statusCode, errorCode, latency, 0)
				return nil, route, callErr
			}
			s.models.MarkRouteFailure(ctx, route.ID)
			s.models.LogRouteAttempt(ctx, requestID, model.ID, route.ID, attempt, "failed", statusCode, errorCode, latency, 0)
			if retry < route.MaxRetries && latency < 15_000 && shouldRetrySameRoute(callErr, len(routes) > 1) && waitRouteRetry(ctx, retry) {
				continue
			}
			break
		}
	}
	if lastErr == nil {
		lastErr = &runtime.PlatformError{Code: "MODEL_PROVIDER_ERROR", Message: "模型线路正在恢复探测，请稍后重试"}
	}
	return nil, nil, lastErr
}

func (s *ChatService) chatCompletionStreamWithFailover(ctx context.Context, requestID string, model *ModelFull, req runtime.ChatRequest, params map[string]interface{}) (<-chan runtime.StreamChunk, *ModelRoute, error) {
	routes, err := s.modelRuntimeRoutes(ctx, model)
	if err != nil {
		return nil, nil, err
	}
	var lastErr error
	attempt := 0
routeLoop:
	for i := range routes {
		route := &routes[i]
		if mediaErr := chatRouteMediaError(model, route, req.Messages); mediaErr != nil {
			lastErr = mediaErr
			continue
		}
		attemptReq, mappingErr := chatRouteRequest(req, model, *route, params)
		if mappingErr != nil {
			lastErr = mappingErr
			continue
		}
		if !s.models.AcquireRouteProbe(ctx, route) {
			continue
		}
		for retry := 0; retry <= route.MaxRetries; retry++ {
			if attempt >= maxRouteAttemptsPerRequest {
				break routeLoop
			}
			attempt++
			started := time.Now()
			chunks, callErr := s.runtime.ChatCompletionStreamWithConfig(ctx, route.Endpoint, attemptReq, route.RequestExtraForRequest(model, requestID))
			latency := int(time.Since(started).Milliseconds())
			if callErr == nil {
				s.models.MarkRouteSuccess(ctx, route.ID)
				s.models.LogRouteAttempt(ctx, requestID, model.ID, route.ID, attempt, "success", 200, "", latency, 0)
				forwarded := make(chan runtime.StreamChunk, 32)
				go func(selectedRouteID int64, selectedAttempt int) {
					defer close(forwarded)
					var streamError error
					for chunk := range chunks {
						if chunk.Error != nil {
							streamError = chunk.Error
						}
						forwarded <- chunk
					}
					if streamError != nil {
						if isRouteFailoverError(streamError) {
							s.models.MarkRouteFailure(context.Background(), selectedRouteID)
						}
						s.models.MarkStreamRouteAttemptFailed(context.Background(), requestID, selectedRouteID, selectedAttempt, streamError)
					}
				}(route.ID, attempt)
				return forwarded, route, nil
			}
			lastErr = callErr
			statusCode, errorCode := routeErrorDetails(callErr)
			if platformErr, ok := callErr.(*runtime.PlatformError); ok && platformErr.Detail != "" {
				log.Printf("model stream route failed: request_id=%s route_id=%d status=%d code=%s detail=%q", requestID, route.ID, statusCode, errorCode, platformErr.Detail)
			}
			if !isRouteFailoverError(callErr) {
				s.models.LogRouteAttempt(ctx, requestID, model.ID, route.ID, attempt, "rejected", statusCode, errorCode, latency, 0)
				return nil, route, callErr
			}
			s.models.MarkRouteFailure(ctx, route.ID)
			s.models.LogRouteAttempt(ctx, requestID, model.ID, route.ID, attempt, "failed", statusCode, errorCode, latency, 0)
			if retry < route.MaxRetries && latency < 15_000 && shouldRetrySameRoute(callErr, len(routes) > 1) && waitRouteRetry(ctx, retry) {
				continue
			}
			break
		}
	}
	if lastErr == nil {
		lastErr = &runtime.PlatformError{Code: "MODEL_PROVIDER_ERROR", Message: "模型线路正在恢复探测，请稍后重试"}
	}
	return nil, nil, lastErr
}

func (s *ChatService) FinalizeStream(ctx context.Context, userID int64, requestID string, input CompletionInput, fullContent, reasoningContent string, usage *runtime.ChatUsage, estimated float64) (string, error) {
	model, err := s.ResolveInputModel(ctx, &input)
	if err != nil {
		return "", err
	}
	normalized := runtime.ChatUsage{}
	if usage != nil {
		normalized = *usage
	}
	normalized = normalizedChatUsage(normalized, input, fullContent)
	actualCost := s.models.EstimateCostWithTokenDetails(model, input.Params, normalized.PromptTokens, normalized.CompletionTokens, normalized.CachedInputTokens(), normalized.CacheCreationInputTokens)
	selectedRoute, _ := s.models.SuccessfulRouteForRequest(ctx, requestID)
	providerCost := EstimateRouteProviderCostWithTokenDetails(selectedRoute, input.Params, normalized.PromptTokens, normalized.CompletionTokens, normalized.CachedInputTokens(), normalized.CacheCreationInputTokens)
	if selectedRoute != nil {
		s.models.UpdateSuccessfulRouteAttemptCost(ctx, requestID, selectedRoute.ID, providerCost)
	}
	if err := s.billing.Charge(ctx, userID, estimated, actualCost, "chat", requestID, "chat_usage", chatBillingLabel(input.BillingLabel, "对话消费")); err != nil {
		s.logCall(ctx, requestID, userID, model.ID, nil, normalized.PromptTokens, normalized.CompletionTokens, normalized.TotalTokens, 0, "billing_failed", err, 0)
		return "", fmt.Errorf("对话结算失败: %w", err)
	}
	s.logCallWithRoute(ctx, requestID, userID, model.ID, routeID(selectedRoute), nil, normalized.PromptTokens, normalized.CompletionTokens, normalized.TotalTokens, actualCost, providerCost, "success", nil, 0)
	if input.Ephemeral {
		return input.ConversationID, nil
	}

	convID := input.ConversationID
	if convID == "" && len(input.Messages) > 0 {
		conv, _ := s.CreateConversation(ctx, userID, input.ModelCode, truncate(input.Messages[len(input.Messages)-1].Content, 30))
		if conv != nil {
			convID = conv.PublicID
		}
	}
	if convID != "" && len(input.Messages) > 0 {
		s.saveMessages(ctx, convID, userID, input.Messages, fullContent, reasoningContent)
	}
	return convID, nil
}

func (s *ChatService) UnfreezeStream(ctx context.Context, userID int64, requestID string, estimated float64) error {
	return s.billing.Unfreeze(ctx, userID, estimated, "chat", requestID)
}

func (s *ChatService) EstimateModelsCost(ctx context.Context, modelCodes []string, params map[string]interface{}) float64 {
	total := 0.0
	for _, code := range modelCodes {
		model, err := s.models.GetFullByCode(ctx, code)
		if err != nil {
			continue
		}
		total += s.models.EstimateCost(model, params, 0, 0)
	}
	return total
}

func (s *ChatService) BeginMultiChat(ctx context.Context, userID int64, input CompletionInput, modelCodes []string) (requestID string, estimated float64, err error) {
	prepareChatBillingParams(&input)
	requestID = util.NewRequestID()
	if len(modelCodes) == 0 {
		model, mErr := s.ResolveInputModel(ctx, &input)
		if mErr != nil {
			return "", 0, mErr
		}
		estimated = s.models.EstimateCost(model, input.Params, 0, 0)
	} else {
		estimated = s.EstimateModelsCost(ctx, modelCodes, input.Params)
		if collaborationModel, modelErr := s.models.GetFullByCode(ctx, input.ModelCode); modelErr == nil && collaborationModel.Category == "multi_collab" {
			estimated += s.models.EstimateCost(collaborationModel, input.Params, 0, 0)
		}
	}
	if freezeErr := s.billing.Freeze(ctx, userID, estimated, "chat", requestID); freezeErr != nil {
		if errors.Is(freezeErr, billing.ErrInsufficientBalance) {
			return "", 0, s.balanceError(ctx, userID, input, requestID)
		}
		return "", 0, freezeErr
	}
	return requestID, estimated, nil
}

func (s *ChatService) FinalizeMultiChat(ctx context.Context, userID int64, requestID string, modelCode string, estimated, actualCost float64, promptTokens, completionTokens, totalTokens int) error {
	model, err := s.models.GetFullByCode(ctx, modelCode)
	if err != nil {
		return s.billing.Unfreeze(ctx, userID, estimated, "chat", requestID)
	}
	if err := s.billing.Charge(ctx, userID, estimated, actualCost, "chat", requestID, "chat_usage", "多模型协作消费"); err != nil {
		s.logCall(ctx, requestID, userID, model.ID, nil, promptTokens, completionTokens, totalTokens, 0, "billing_failed", err, 0)
		return err
	}
	s.logCall(ctx, requestID, userID, model.ID, nil, promptTokens, completionTokens, totalTokens, actualCost, "success", nil, 0)
	return nil
}

func prepareChatBillingParams(input *CompletionInput) {
	if input.Params == nil {
		input.Params = map[string]interface{}{}
	}
	if firstPositiveIntValue(input.Params, "_estimated_input_tokens") <= 0 {
		parts := make([]string, 0, len(input.Messages)*2)
		for _, message := range input.Messages {
			parts = append(parts, message.Role, message.Content)
		}
		input.Params["_estimated_input_tokens"] = estimateTextTokens(strings.Join(parts, "\n"))
	}
	if firstPositiveIntValue(input.Params, "_estimated_output_tokens") <= 0 {
		if output := firstPositiveIntValue(input.Params, "max_completion_tokens", "max_tokens"); output > 0 {
			input.Params["_estimated_output_tokens"] = output
		}
	}
}

func chatBillingLabel(configured, fallback string) string {
	if label := strings.TrimSpace(configured); label != "" {
		return label
	}
	return fallback
}

func normalizedChatUsage(usage runtime.ChatUsage, input CompletionInput, content string) runtime.ChatUsage {
	if usage.PromptTokens <= 0 {
		prepareChatBillingParams(&input)
		usage.PromptTokens = firstPositiveIntValue(input.Params, "_estimated_input_tokens")
	}
	if usage.CompletionTokens <= 0 {
		usage.CompletionTokens = estimateTextTokens(content)
	}
	if usage.TotalTokens <= 0 {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	return usage
}

func (s *ChatService) balanceError(ctx context.Context, userID int64, input CompletionInput, requestID string) *BalanceError {
	convID := s.recordBalanceFailure(ctx, userID, input, requestID)
	return &BalanceError{ConversationID: convID, RequestID: requestID}
}

func (s *ChatService) recordBalanceFailure(ctx context.Context, userID int64, input CompletionInput, requestID string) string {
	modelCode := input.modelIdentifier()
	if modelCode == "" {
		modelCode = "chat"
	}
	var modelID int64
	if model, err := s.models.ResolveChatModel(ctx, modelCode); err == nil {
		modelCode = model.Code
		modelID = model.ID
	}
	convID := input.ConversationID
	if convID == "" && len(input.Messages) > 0 {
		title := truncate(input.Messages[len(input.Messages)-1].Content, 30)
		conv, _ := s.CreateConversation(ctx, userID, modelCode, title)
		if conv != nil {
			convID = conv.PublicID
		}
	}
	errMsg := fmt.Sprintf("[%s]", billing.InsufficientBalanceMsg)
	if convID != "" && len(input.Messages) > 0 {
		s.saveMessages(ctx, convID, userID, input.Messages, errMsg, "")
	}
	s.db.Exec(ctx, `
		INSERT INTO ai_call_logs (request_id, user_id, model_id, conversation_id, prompt_tokens, completion_tokens, total_tokens, cost, status, error_code, duration_ms)
		VALUES ($1,$2,$3,$4,0,0,0,0,'failed','INSUFFICIENT_BALANCE',0)`,
		requestID, userID, modelID, nil)
	if s.ops != nil {
		_ = s.ops.CreateNotification(ctx, userID, "对话失败", billing.InsufficientBalanceMsg, "billing")
	}
	return convID
}

func (s *ChatService) logCall(ctx context.Context, requestID string, userID, modelID int64, convID *int64, prompt, completion, total int, cost float64, status string, err error, duration int) {
	s.logCallWithRoute(ctx, requestID, userID, modelID, 0, convID, prompt, completion, total, cost, 0, status, err, duration)
}

func (s *ChatService) logCallWithRoute(ctx context.Context, requestID string, userID, modelID, selectedRouteID int64, convID *int64, prompt, completion, total int, cost, providerCost float64, status string, err error, duration int) {
	errCode := ""
	if err != nil {
		if pe, ok := err.(*runtime.PlatformError); ok {
			errCode = pe.Code
		} else {
			errCode = "UNKNOWN"
		}
		status = "failed"
	}
	var routeRef interface{} = selectedRouteID
	if selectedRouteID <= 0 {
		routeRef = nil
	}
	if _, execErr := s.db.Exec(ctx, `
		INSERT INTO ai_call_logs (request_id, user_id, model_id, route_id, conversation_id, prompt_tokens, completion_tokens, total_tokens, cost, provider_cost, gross_profit, status, error_code, duration_ms)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9::numeric-$10::numeric,$11,$12,$13)`,
		requestID, userID, modelID, routeRef, convID, prompt, completion, total, cost, providerCost, status, errCode, duration); execErr != nil {
		log.Printf("ai call log insert failed request_id=%s: %v", requestID, execErr)
	}
}

func (s *ChatService) saveMessages(ctx context.Context, convPublicID string, userID int64, messages []runtime.ChatMessage, assistantContent, reasoningContent string) {
	var convID int64
	err := s.db.QueryRow(ctx, `SELECT id FROM conversations WHERE public_id=$1 AND user_id=$2`, convPublicID, userID).Scan(&convID)
	if err != nil {
		return
	}
	last := messages[len(messages)-1]
	s.db.Exec(ctx, `INSERT INTO conversation_messages (conversation_id, role, content) VALUES ($1,$2,$3)`, convID, last.Role, last.Content)
	s.db.Exec(ctx, `INSERT INTO conversation_messages (conversation_id, role, content, reasoning_content) VALUES ($1,'assistant',$2,$3)`, convID, assistantContent, reasoningContent)
	s.db.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE id=$1`, convID)
}

// SaveMultiMessages stores the user question plus a structured assistant snapshot
// (summary + per-model answers) so history can restore the full multi-collab view.
func (s *ChatService) SaveMultiMessages(ctx context.Context, convPublicID string, userID int64, messages []runtime.ChatMessage, results interface{}, summary string) {
	var convID int64
	err := s.db.QueryRow(ctx, `SELECT id FROM conversations WHERE public_id=$1 AND user_id=$2`, convPublicID, userID).Scan(&convID)
	if err != nil {
		return
	}
	var lastUser runtime.ChatMessage
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			lastUser = messages[i]
			break
		}
	}
	if lastUser.Role == "" {
		return
	}
	s.db.Exec(ctx, `INSERT INTO conversation_messages (conversation_id, role, content) VALUES ($1,$2,$3)`, convID, lastUser.Role, lastUser.Content)
	out := summary
	if strings.TrimSpace(out) == "" {
		b, _ := json.Marshal(results)
		out = string(b)
	} else {
		snapshot, _ := json.Marshal(map[string]interface{}{
			"type":    "multi_collab",
			"summary": summary,
			"results": results,
		})
		out = string(snapshot)
	}
	s.db.Exec(ctx, `INSERT INTO conversation_messages (conversation_id, role, content) VALUES ($1,'assistant',$2)`, convID, out)
	s.db.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE id=$1`, convID)
}

func truncate(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "..."
}

func (s *ChatService) GetConversation(ctx context.Context, userID int64, publicID string, limit int) (map[string]interface{}, error) {
	var convID int64
	var title *string
	var created, updated time.Time
	err := s.db.QueryRow(ctx, `SELECT id, title, created_at, updated_at FROM conversations WHERE public_id=$1 AND user_id=$2`, publicID, userID).Scan(&convID, &title, &created, &updated)
	if err != nil {
		return nil, err
	}
	query := `SELECT role,content,COALESCE(reasoning_content,''),created_at FROM conversation_messages WHERE conversation_id=$1 ORDER BY id`
	args := []interface{}{convID}
	if limit > 0 {
		if limit > 500 {
			limit = 500
		}
		query = `SELECT role,content,reasoning_content,created_at FROM (
			SELECT id,role,content,COALESCE(reasoning_content,'') AS reasoning_content,created_at
			FROM conversation_messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT $2
		) recent ORDER BY id`
		args = append(args, limit)
	}
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var messages []map[string]string
	for rows.Next() {
		var role, content, reasoningContent string
		var t time.Time
		rows.Scan(&role, &content, &reasoningContent, &t)
		messages = append(messages, map[string]string{"role": role, "content": content, "reasoning_content": reasoningContent, "created_at": t.Format(time.RFC3339)})
	}
	result, _ := json.Marshal(messages)
	_ = result
	return map[string]interface{}{
		"public_id":  publicID,
		"title":      title,
		"messages":   messages,
		"created_at": created.Format(time.RFC3339),
		"updated_at": updated.Format(time.RFC3339),
	}, nil
}

func (s *ChatService) AppendConversationMessage(ctx context.Context, userID int64, publicID, role, content string) error {
	role = strings.ToLower(strings.TrimSpace(role))
	content = strings.TrimSpace(content)
	if publicID == "" || content == "" || (role != "user" && role != "assistant" && role != "system") {
		return errors.New("conversation message parameters are invalid")
	}
	result, err := s.db.Exec(ctx, `
		INSERT INTO conversation_messages (conversation_id, role, content)
		SELECT id, $3, $4 FROM conversations WHERE public_id=$1 AND user_id=$2`, publicID, userID, role, content)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return errors.New("conversation not found")
	}
	_, _ = s.db.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE public_id=$1 AND user_id=$2`, publicID, userID)
	return nil
}

func (s *ChatService) DeleteConversation(ctx context.Context, userID int64, publicID string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM conversations WHERE public_id=$1 AND user_id=$2`, publicID, userID)
	return err
}

// DeleteConversationIfEmpty removes an abandoned conversation without risking
// a conversation that already contains user-visible history.
func (s *ChatService) DeleteConversationIfEmpty(ctx context.Context, userID int64, publicID string) error {
	_, err := s.db.Exec(ctx, `
		DELETE FROM conversations c
		WHERE c.public_id=$1 AND c.user_id=$2
		  AND NOT EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.conversation_id=c.id)`,
		publicID, userID)
	return err
}
