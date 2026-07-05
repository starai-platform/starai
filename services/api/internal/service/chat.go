package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

func (s *ChatService) ListConversations(ctx context.Context, userID int64, modelCode string) ([]ConversationDTO, error) {
	args := []interface{}{userID}
	where := "c.user_id=$1"
	if modelCode != "" {
		args = append(args, modelCode)
		where += fmt.Sprintf(" AND m.code=$%d", len(args))
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
}

type CompletionResult struct {
	RequestID      string  `json:"request_id"`
	ConversationID string  `json:"conversation_id"`
	Content        string  `json:"content"`
	Cost           float64 `json:"cost"`
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
	estimated := s.models.EstimateCost(model, input.Params, 0, 0)
	requestID := util.NewRequestID()

	if err := s.billing.Freeze(ctx, userID, estimated, "chat", requestID); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return nil, s.balanceError(ctx, userID, input, requestID)
		}
		return nil, err
	}

	temp := 0.7
	if v, ok := input.Params["temperature"].(float64); ok {
		temp = v
	}
	req := runtime.ChatRequest{
		Model:       model.NewAPIModel,
		Messages:    input.Messages,
		Temperature: temp,
	}
	start := time.Now()
	resp, err := s.runtime.ChatCompletionWithConfig(ctx, model.NewAPIEndpoint, req, model.NewAPIExtraParams)
	duration := int(time.Since(start).Milliseconds())
	if err != nil {
		s.billing.Unfreeze(ctx, userID, estimated, "chat", requestID)
		s.logCall(ctx, requestID, userID, model.ID, nil, 0, 0, 0, 0, "failed", err, duration)
		return nil, err
	}
	content := ""
	if len(resp.Choices) > 0 {
		content = resp.Choices[0].Message.Content
	}
	actualCost := s.models.EstimateCost(model, input.Params, resp.Usage.PromptTokens, resp.Usage.CompletionTokens)
	s.billing.Charge(ctx, userID, estimated, actualCost, "chat", requestID, "chat_usage", "对话消费")
	s.logCall(ctx, requestID, userID, model.ID, nil, resp.Usage.PromptTokens, resp.Usage.CompletionTokens, resp.Usage.TotalTokens, actualCost, "success", nil, duration)

	convID := input.ConversationID
	if convID == "" {
		conv, _ := s.CreateConversation(ctx, userID, input.ModelCode, truncate(input.Messages[len(input.Messages)-1].Content, 30))
		if conv != nil {
			convID = conv.PublicID
		}
	}
	s.saveMessages(ctx, convID, userID, input.Messages, content)

	return &CompletionResult{RequestID: requestID, ConversationID: convID, Content: content, Cost: actualCost}, nil
}

func (s *ChatService) CompletionStream(ctx context.Context, userID int64, input CompletionInput) (string, <-chan runtime.StreamChunk, error) {
	model, err := s.ResolveInputModel(ctx, &input)
	if err != nil {
		return "", nil, err
	}
	estimated := s.models.EstimateCost(model, input.Params, 0, 0)
	requestID := util.NewRequestID()
	if err := s.billing.Freeze(ctx, userID, estimated, "chat", requestID); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return "", nil, s.balanceError(ctx, userID, input, requestID)
		}
		return "", nil, err
	}
	temp := 0.7
	if v, ok := input.Params["temperature"].(float64); ok {
		temp = v
	}
	req := runtime.ChatRequest{Model: model.NewAPIModel, Messages: input.Messages, Temperature: temp}
	// per-request timeout override (seconds)
	if v, ok := input.Params["timeout_sec"].(float64); ok && v > 0 && v <= 600 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(v)*time.Second)
		defer cancel()
	}
	ch, err := s.runtime.ChatCompletionStreamWithConfig(ctx, model.NewAPIEndpoint, req, model.NewAPIExtraParams)
	if err != nil {
		s.billing.Unfreeze(ctx, userID, estimated, "chat", requestID)
		return "", nil, err
	}
	return requestID, ch, nil
}

func (s *ChatService) FinalizeStream(ctx context.Context, userID int64, requestID string, input CompletionInput, fullContent string, usage *runtime.ChatUsage, estimated float64) (string, error) {
	model, err := s.ResolveInputModel(ctx, &input)
	if err != nil {
		return "", err
	}
	prompt, completion, total := 0, 0, 0
	if usage != nil {
		prompt, completion, total = usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens
	}
	actualCost := s.models.EstimateCost(model, input.Params, prompt, completion)
	s.billing.Charge(ctx, userID, estimated, actualCost, "chat", requestID, "chat_usage", "对话消费")
	s.logCall(ctx, requestID, userID, model.ID, nil, prompt, completion, total, actualCost, "success", nil, 0)

	convID := input.ConversationID
	if convID == "" && len(input.Messages) > 0 {
		conv, _ := s.CreateConversation(ctx, userID, input.ModelCode, truncate(input.Messages[len(input.Messages)-1].Content, 30))
		if conv != nil {
			convID = conv.PublicID
		}
	}
	if convID != "" && len(input.Messages) > 0 {
		s.saveMessages(ctx, convID, userID, input.Messages, fullContent)
	}
	return convID, nil
}

func (s *ChatService) UnfreezeStream(ctx context.Context, userID int64, requestID string, estimated float64) {
	s.billing.Unfreeze(ctx, userID, estimated, "chat", requestID)
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
	requestID = util.NewRequestID()
	if len(modelCodes) == 0 {
		model, mErr := s.ResolveInputModel(ctx, &input)
		if mErr != nil {
			return "", 0, mErr
		}
		estimated = s.models.EstimateCost(model, input.Params, 0, 0)
	} else {
		estimated = s.EstimateModelsCost(ctx, modelCodes, input.Params)
	}
	if freezeErr := s.billing.Freeze(ctx, userID, estimated, "chat", requestID); freezeErr != nil {
		if errors.Is(freezeErr, billing.ErrInsufficientBalance) {
			return "", 0, s.balanceError(ctx, userID, input, requestID)
		}
		return "", 0, freezeErr
	}
	return requestID, estimated, nil
}

func (s *ChatService) FinalizeMultiChat(ctx context.Context, userID int64, requestID string, modelCode string, estimated, actualCost float64, promptTokens, completionTokens, totalTokens int) {
	model, err := s.models.GetFullByCode(ctx, modelCode)
	if err != nil {
		s.billing.Unfreeze(ctx, userID, estimated, "chat", requestID)
		return
	}
	s.billing.Charge(ctx, userID, estimated, actualCost, "chat", requestID, "chat_usage", "多模型协作消费")
	s.logCall(ctx, requestID, userID, model.ID, nil, promptTokens, completionTokens, totalTokens, actualCost, "success", nil, 0)
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
		s.saveMessages(ctx, convID, userID, input.Messages, errMsg)
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
	errCode := ""
	if err != nil {
		if pe, ok := err.(*runtime.PlatformError); ok {
			errCode = pe.Code
		} else {
			errCode = "UNKNOWN"
		}
		status = "failed"
	}
	s.db.Exec(ctx, `
		INSERT INTO ai_call_logs (request_id, user_id, model_id, conversation_id, prompt_tokens, completion_tokens, total_tokens, cost, status, error_code, duration_ms)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		requestID, userID, modelID, convID, prompt, completion, total, cost, status, errCode, duration)
}

func (s *ChatService) saveMessages(ctx context.Context, convPublicID string, userID int64, messages []runtime.ChatMessage, assistantContent string) {
	var convID int64
	err := s.db.QueryRow(ctx, `SELECT id FROM conversations WHERE public_id=$1 AND user_id=$2`, convPublicID, userID).Scan(&convID)
	if err != nil {
		return
	}
	last := messages[len(messages)-1]
	s.db.Exec(ctx, `INSERT INTO conversation_messages (conversation_id, role, content) VALUES ($1,$2,$3)`, convID, last.Role, last.Content)
	s.db.Exec(ctx, `INSERT INTO conversation_messages (conversation_id, role, content) VALUES ($1,'assistant',$2)`, convID, assistantContent)
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

func (s *ChatService) GetConversation(ctx context.Context, userID int64, publicID string) (map[string]interface{}, error) {
	var convID int64
	var title *string
	var created, updated time.Time
	err := s.db.QueryRow(ctx, `SELECT id, title, created_at, updated_at FROM conversations WHERE public_id=$1 AND user_id=$2`, publicID, userID).Scan(&convID, &title, &created, &updated)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT role, content, created_at FROM conversation_messages WHERE conversation_id=$1 ORDER BY created_at`, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var messages []map[string]string
	for rows.Next() {
		var role, content string
		var t time.Time
		rows.Scan(&role, &content, &t)
		messages = append(messages, map[string]string{"role": role, "content": content, "created_at": t.Format(time.RFC3339)})
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

func (s *ChatService) DeleteConversation(ctx context.Context, userID int64, publicID string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM conversations WHERE public_id=$1 AND user_id=$2`, publicID, userID)
	return err
}
