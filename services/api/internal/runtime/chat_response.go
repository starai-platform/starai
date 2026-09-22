package runtime

import (
	"encoding/json"
	"strings"
)

// A successful HTTP/SSE connection can still end in a provider rejection.
// Keep the same interpretation for streamed and non-streamed responses.
func chatFinishError(reason string) error {
	switch reason {
	case "sensitive", "content_filter":
		return &PlatformError{Code: "CONTENT_REJECTED", StatusCode: 400, Message: "本次回复被模型服务商的内容审核终止，未能完成回答。"}
	case "length":
		return &PlatformError{Code: "MODEL_OUTPUT_LIMIT", StatusCode: 400, Message: "模型达到输出长度上限，回复未完成；请缩小本次输出范围，或由管理员提高输出上限。"}
	case "network_error", "error":
		return &PlatformError{Code: "MODEL_PROVIDER_ERROR", StatusCode: 502, Message: "模型服务中断，回复未完成，请稍后重试。"}
	}
	return nil
}

// Read only answer blocks. Reasoning and tool arguments are never publishable copy.
func openAIAnswerText(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text, nil
	}
	var value interface{}
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return openAIAnswerValue(value)
}

func openAIAnswerValue(value interface{}) (string, error) {
	switch item := value.(type) {
	case string:
		return item, nil
	case []interface{}:
		var out strings.Builder
		for _, part := range item {
			text, err := openAIAnswerValue(part)
			if err != nil {
				return "", err
			}
			out.WriteString(text)
		}
		return out.String(), nil
	case map[string]interface{}:
		kind := strings.ToLower(strings.TrimSpace(stringAnyRuntime(item["type"])))
		if kind == "refusal" {
			return "", &PlatformError{Code: "CONTENT_REJECTED", StatusCode: 400, Message: "模型拒绝生成正文：" + stringAnyRuntime(item["refusal"])}
		}
		if kind == "reasoning" || kind == "thinking" || kind == "analysis" || kind == "reasoning_content" {
			return "", nil
		}
		if kind != "" && kind != "text" && kind != "output_text" && kind != "text_delta" && kind != "content" {
			return "", nil
		}
		if text, ok := item["text"].(string); ok {
			return text, nil
		}
		if text, ok := item["value"].(string); ok {
			return text, nil
		}
		if text, ok := item["content"].(string); ok {
			return text, nil
		}
		if text, ok := item["text"].(map[string]interface{}); ok {
			return stringAnyRuntime(text["value"]), nil
		}
	}
	return "", nil
}

func decodeOpenAIChatResponse(raw []byte) (*ChatResponse, error) {
	var payload struct {
		ID         string `json:"id"`
		Model      string `json:"model"`
		Object     string `json:"object"`
		Status     string `json:"status"`
		OutputText string `json:"output_text"`
		Error      *struct {
			Message string `json:"message"`
		} `json:"error"`
		IncompleteDetails struct {
			Reason string `json:"reason"`
		} `json:"incomplete_details"`
		Usage struct {
			ChatUsage
			InputTokens        int `json:"input_tokens"`
			OutputTokens       int `json:"output_tokens"`
			InputTokensDetails struct {
				CachedTokens int `json:"cached_tokens"`
			} `json:"input_tokens_details"`
		} `json:"usage"`
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Role             string                   `json:"role"`
				Content          json.RawMessage          `json:"content"`
				ReasoningContent string                   `json:"reasoning_content"`
				Refusal          string                   `json:"refusal"`
				ToolCalls        []map[string]interface{} `json:"tool_calls"`
			} `json:"message"`
			ToolCalls []map[string]interface{} `json:"tool_calls"`
		} `json:"choices"`
		Output []struct {
			Type    string          `json:"type"`
			Role    string          `json:"role"`
			Phase   string          `json:"phase"`
			Content json.RawMessage `json:"content"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if payload.Error != nil {
		return nil, &PlatformError{Code: "MODEL_PROVIDER_ERROR", StatusCode: 502, Message: payload.Error.Message}
	}
	result := &ChatResponse{ID: payload.ID, Model: payload.Model, Usage: payload.Usage.ChatUsage}
	for _, choice := range payload.Choices {
		if err := chatFinishError(choice.FinishReason); err != nil {
			return nil, err
		}
		text, err := openAIAnswerText(choice.Message.Content)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(text) == "" && choice.Message.Refusal != "" {
			return nil, &PlatformError{Code: "CONTENT_REJECTED", StatusCode: 400, Message: "模型未生成正文：" + choice.Message.Refusal}
		}
		calls := choice.Message.ToolCalls
		if len(calls) == 0 {
			calls = choice.ToolCalls
		}
		result.Choices = append(result.Choices, ChatChoice{Message: ChatMessage{Role: choice.Message.Role, Content: text, ReasoningContent: choice.Message.ReasoningContent}, FinishReason: choice.FinishReason, ToolCalls: calls})
	}
	if len(payload.Choices) == 0 && (payload.Object == "response" || len(payload.Output) > 0 || payload.OutputText != "") {
		if payload.Status == "incomplete" {
			return nil, &PlatformError{Code: "MODEL_OUTPUT_LIMIT", StatusCode: 400, Message: "模型输出未完成（" + payload.IncompleteDetails.Reason + "），请检查输出额度后重试"}
		}
		if payload.Status != "" && payload.Status != "completed" {
			return nil, &PlatformError{Code: "MODEL_RESPONSE_NOT_COMPLETE", StatusCode: 400, Message: "模型尚未完成正文生成（" + payload.Status + "），请检查线路是否启用了后台异步响应"}
		}
		var answers []string
		for _, item := range payload.Output {
			if item.Type != "message" || item.Role != "assistant" || item.Phase == "commentary" {
				continue
			}
			text, err := openAIAnswerText(item.Content)
			if err != nil {
				return nil, err
			}
			if strings.TrimSpace(text) != "" {
				answers = append(answers, text)
			}
		}
		text := strings.Join(answers, "\n\n")
		if text == "" && len(payload.Output) == 0 {
			text = payload.OutputText
		}
		result.Choices = []ChatChoice{{Message: ChatMessage{Role: "assistant", Content: text}, FinishReason: "stop"}}
		result.Usage.PromptTokens = payload.Usage.InputTokens
		result.Usage.CompletionTokens = payload.Usage.OutputTokens
		result.Usage.CacheReadInputTokens = payload.Usage.InputTokensDetails.CachedTokens
	}
	if result.Usage.TotalTokens == 0 {
		result.Usage.TotalTokens = result.Usage.PromptTokens + result.Usage.CompletionTokens
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" && len(result.Choices[0].ToolCalls) == 0 {
		return nil, &PlatformError{Code: "MODEL_EMPTY_RESPONSE", StatusCode: 502, Message: "模型线路返回了空正文，请检查上游响应格式或更换线路后重试"}
	}
	return result, nil
}
