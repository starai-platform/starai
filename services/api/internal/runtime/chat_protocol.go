package runtime

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
)

const (
	chatProtocolOpenAI = "openai"
	chatProtocolClaude = "claude"
	chatProtocolGemini = "gemini"
)

type protocolMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

func chatProtocol(extra map[string]interface{}) string {
	conn, _ := extra["connection"].(map[string]interface{})
	protocol, _ := conn["protocol"].(string)
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "claude", "anthropic", "anthropic_messages", "claude_messages":
		return chatProtocolClaude
	case "gemini", "gemini_native", "google", "google_gemini":
		return chatProtocolGemini
	default:
		return chatProtocolOpenAI
	}
}

func connectionValue(extra map[string]interface{}, key, fallback string) string {
	conn, _ := extra["connection"].(map[string]interface{})
	if value, ok := conn[key].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func prepareChatRequest(endpoint string, req ChatRequest, extra map[string]interface{}) (string, []byte, string, error) {
	protocol := chatProtocol(extra)
	if protocol == chatProtocolOpenAI && (strings.TrimRight(endpoint, "/") == "/v1/responses" || strings.HasSuffix(strings.TrimRight(endpoint, "/"), "/responses") || extra["request_mode"] == "responses") {
		protocol = "responses"
		if endpoint == "" {
			endpoint = "/v1/responses"
		}
	}
	endpoint = chatEndpoint(protocol, endpoint, req.Model, req.Stream)
	var (
		body []byte
		err  error
	)
	switch protocol {
	case "responses":
		body, err = marshalResponsesRequest(req)
	case chatProtocolClaude:
		body, err = marshalClaudeRequest(req)
	case chatProtocolGemini:
		body, err = marshalGeminiRequest(req)
	default:
		req.Messages, err = openAIAudioMessages(req.Messages)
		if err == nil {
			body, err = marshalChatRequest(req)
		}
	}
	return endpoint, body, protocol, err
}

// Keep audio as bytes in provider requests; a URL in a text prompt is not audio input.
func openAIAudioMessages(messages interface{}) (interface{}, error) {
	raw, err := json.Marshal(messages)
	if err != nil {
		return nil, err
	}
	var items []map[string]interface{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	changed := false
	for _, message := range items {
		parts, _ := message["content"].([]interface{})
		for index, item := range parts {
			part, _ := item.(map[string]interface{})
			if part["type"] != "audio_url" {
				continue
			}
			media, _ := part["audio_url"].(map[string]interface{})
			ref, _ := media["url"].(string)
			header, payload, ok := strings.Cut(ref, ",")
			format := map[string]string{"data:audio/mpeg;base64": "mp3", "data:audio/mp3;base64": "mp3", "data:audio/wav;base64": "wav", "data:audio/x-wav;base64": "wav", "data:audio/wave;base64": "wav"}[header]
			if !ok || format == "" {
				return nil, &PlatformError{Code: "AUDIO_FORMAT_UNSUPPORTED", StatusCode: 400, Message: "当前聊天协议的音频理解需要MP3或WAV文件，请转换后上传，或选择支持该格式的Gemini原生线路"}
			}
			if decoded, err := base64.StdEncoding.DecodeString(payload); err != nil || len(decoded) == 0 {
				return nil, errors.New("音频数据无效")
			}
			parts[index] = map[string]interface{}{"type": "input_audio", "input_audio": map[string]interface{}{"data": payload, "format": format}}
			changed = true
		}
	}
	if !changed {
		return messages, nil
	}
	return items, nil
}

func chatEndpoint(protocol, endpoint, model string, stream bool) string {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" || (protocol == chatProtocolClaude && endpoint == "/v1/chat/completions") ||
		(protocol == chatProtocolGemini && endpoint == "/v1/chat/completions") {
		switch protocol {
		case chatProtocolClaude:
			endpoint = "/v1/messages"
		case chatProtocolGemini:
			endpoint = "/v1beta/models/{model}:generateContent"
		default:
			endpoint = "/v1/chat/completions"
		}
	}
	endpoint = strings.ReplaceAll(endpoint, "{model}", url.PathEscape(strings.TrimPrefix(model, "models/")))
	if protocol == chatProtocolGemini && stream && !strings.Contains(endpoint, "alt=") {
		separator := "?"
		if strings.Contains(endpoint, "?") {
			separator = "&"
		}
		endpoint += separator + "alt=sse"
	}
	return endpoint
}

func modelListEndpoint(protocol, configured string) string {
	if strings.TrimSpace(configured) != "" {
		return strings.TrimSpace(configured)
	}
	if protocol == chatProtocolGemini {
		return "/v1beta/models"
	}
	return "/v1/models"
}

func applyChatProtocolHeaders(req *http.Request, protocol string, extra map[string]interface{}) {
	switch protocol {
	case chatProtocolClaude:
		req.Header.Set("anthropic-version", connectionValue(extra, "anthropic_version", "2023-06-01"))
	}
}

func protocolMessages(messages interface{}) ([]protocolMessage, error) {
	if messages == nil {
		return nil, nil
	}
	raw, err := json.Marshal(messages)
	if err != nil {
		return nil, err
	}
	var result []protocolMessage
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func marshalClaudeRequest(req ChatRequest) ([]byte, error) {
	messages, err := protocolMessages(req.Messages)
	if err != nil {
		return nil, err
	}
	body := map[string]interface{}{
		"model":    req.Model,
		"messages": make([]interface{}, 0, len(messages)),
		"stream":   req.Stream,
	}
	var system []interface{}
	for _, message := range messages {
		role := message.Role
		if role == "system" || role == "developer" {
			system = append(system, claudeContentParts(message.Content)...)
			continue
		}
		if role != "user" && role != "assistant" {
			role = "user"
		}
		body["messages"] = append(body["messages"].([]interface{}), map[string]interface{}{
			"role":    role,
			"content": claudeContent(message.Content),
		})
	}
	if len(system) > 0 {
		if len(system) == 1 {
			if text, ok := system[0].(string); ok {
				body["system"] = text
			} else {
				body["system"] = system
			}
		} else {
			body["system"] = system
		}
	}
	maxTokens := firstInt(req.Extra, "max_tokens", "max_completion_tokens")
	if maxTokens <= 0 {
		maxTokens = 1024
	}
	body["max_tokens"] = maxTokens
	copyClaudeOption(body, req.Extra, "temperature")
	copyClaudeOption(body, req.Extra, "top_p")
	copyClaudeOption(body, req.Extra, "top_k")
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	if stop, ok := req.Extra["stop"]; ok {
		if text, ok := stop.(string); ok {
			body["stop_sequences"] = []string{text}
		} else {
			body["stop_sequences"] = stop
		}
	}
	for _, key := range []string{"tools", "tool_choice", "thinking", "output_config", "metadata"} {
		copyClaudeOption(body, req.Extra, key)
	}
	return json.Marshal(body)
}

func marshalGeminiRequest(req ChatRequest) ([]byte, error) {
	messages, err := protocolMessages(req.Messages)
	if err != nil {
		return nil, err
	}
	body := map[string]interface{}{"contents": []interface{}{}}
	var systemParts []interface{}
	for _, message := range messages {
		parts := geminiParts(message.Content)
		if message.Role == "system" || message.Role == "developer" {
			systemParts = append(systemParts, parts...)
			continue
		}
		role := "user"
		if message.Role == "assistant" || message.Role == "model" {
			role = "model"
		}
		body["contents"] = append(body["contents"].([]interface{}), map[string]interface{}{"role": role, "parts": parts})
	}
	if len(systemParts) > 0 {
		body["systemInstruction"] = map[string]interface{}{"parts": systemParts}
	}
	generation := map[string]interface{}{}
	copyGeminiOption(generation, req.Extra, "thinkingConfig", "thinkingConfig")
	if req.Temperature != nil {
		generation["temperature"] = *req.Temperature
	}
	copyGeminiOption(generation, req.Extra, "top_p", "topP")
	copyGeminiOption(generation, req.Extra, "top_k", "topK")
	if maxTokens := firstInt(req.Extra, "max_completion_tokens", "max_tokens"); maxTokens > 0 {
		generation["maxOutputTokens"] = maxTokens
	}
	if stop, ok := req.Extra["stop"]; ok {
		if text, ok := stop.(string); ok {
			generation["stopSequences"] = []string{text}
		} else {
			generation["stopSequences"] = stop
		}
	}
	if len(generation) > 0 {
		body["generationConfig"] = generation
	}
	if tools, ok := geminiTools(req.Extra["tools"]); ok {
		body["tools"] = tools
	}
	if safety, ok := req.Extra["safetySettings"]; ok {
		body["safetySettings"] = safety
	}
	return json.Marshal(body)
}

func claudeContent(content interface{}) interface{} {
	if text, ok := content.(string); ok {
		return text
	}
	return claudeContentParts(content)
}

func claudeContentParts(content interface{}) []interface{} {
	if text, ok := content.(string); ok {
		return []interface{}{map[string]interface{}{"type": "text", "text": text}}
	}
	items, ok := content.([]interface{})
	if !ok {
		return []interface{}{content}
	}
	out := make([]interface{}, 0, len(items))
	for _, item := range items {
		part, ok := item.(map[string]interface{})
		if !ok {
			out = append(out, item)
			continue
		}
		switch part["type"] {
		case "text":
			out = append(out, part)
		case "image_url":
			image, _ := part["image_url"].(map[string]interface{})
			out = append(out, map[string]interface{}{"type": "image", "source": claudeImageSource(image)})
		default:
			out = append(out, part)
		}
	}
	return out
}

func claudeImageSource(image map[string]interface{}) map[string]interface{} {
	imageURL, _ := image["url"].(string)
	if strings.HasPrefix(imageURL, "data:") {
		parts := strings.SplitN(imageURL, ",", 2)
		if len(parts) == 2 {
			mediaType := strings.TrimPrefix(strings.SplitN(parts[0], ";", 2)[0], "data:")
			return map[string]interface{}{"type": "base64", "media_type": mediaType, "data": parts[1]}
		}
	}
	return map[string]interface{}{"type": "url", "url": imageURL}
}

func geminiParts(content interface{}) []interface{} {
	if text, ok := content.(string); ok {
		return []interface{}{map[string]interface{}{"text": text}}
	}
	items, ok := content.([]interface{})
	if !ok {
		return []interface{}{map[string]interface{}{"text": fmt.Sprint(content)}}
	}
	parts := make([]interface{}, 0, len(items))
	for _, item := range items {
		part, ok := item.(map[string]interface{})
		if !ok {
			parts = append(parts, map[string]interface{}{"text": fmt.Sprint(item)})
			continue
		}
		switch part["type"] {
		case "text":
			parts = append(parts, map[string]interface{}{"text": part["text"]})
		case "image_url", "video_url", "audio_url":
			key, _ := part["type"].(string)
			media, _ := part[key].(map[string]interface{})
			parts = append(parts, geminiMediaPart(media))
		default:
			if text, ok := part["text"].(string); ok {
				parts = append(parts, map[string]interface{}{"text": text})
			} else {
				parts = append(parts, part)
			}
		}
	}
	return parts
}

func geminiMediaPart(media map[string]interface{}) map[string]interface{} {
	mediaURL, _ := media["url"].(string)
	if strings.HasPrefix(mediaURL, "data:") {
		parts := strings.SplitN(mediaURL, ",", 2)
		if len(parts) == 2 {
			mediaType := strings.TrimPrefix(strings.SplitN(parts[0], ";", 2)[0], "data:")
			if _, err := base64.StdEncoding.DecodeString(parts[1]); err == nil {
				return map[string]interface{}{"inlineData": map[string]interface{}{"mimeType": mediaType, "data": parts[1]}}
			}
		}
	}
	mediaType := "application/octet-stream"
	if parsed, err := url.Parse(mediaURL); err == nil {
		if detected := mime.TypeByExtension(strings.ToLower(path.Ext(parsed.Path))); strings.HasPrefix(detected, "video/") || strings.HasPrefix(detected, "image/") || strings.HasPrefix(detected, "audio/") {
			mediaType = strings.SplitN(detected, ";", 2)[0]
		}
	}
	return map[string]interface{}{"fileData": map[string]interface{}{"mimeType": mediaType, "fileUri": mediaURL}}
}

func geminiTools(value interface{}) ([]interface{}, bool) {
	items, ok := value.([]interface{})
	if !ok || len(items) == 0 {
		return nil, false
	}
	declarations := make([]interface{}, 0, len(items))
	for _, item := range items {
		tool, _ := item.(map[string]interface{})
		if tool == nil {
			continue
		}
		if _, alreadyNative := tool["functionDeclarations"]; alreadyNative {
			return items, true
		}
		if fn, ok := tool["function"].(map[string]interface{}); ok {
			declarations = append(declarations, fn)
		}
	}
	if len(declarations) == 0 {
		return nil, false
	}
	return []interface{}{map[string]interface{}{"functionDeclarations": declarations}}, true
}

func copyClaudeOption(target, source map[string]interface{}, key string) {
	if value, ok := source[key]; ok && value != nil {
		target[key] = value
	}
}

func copyGeminiOption(target, source map[string]interface{}, sourceKey, targetKey string) {
	if value, ok := source[sourceKey]; ok && value != nil {
		target[targetKey] = value
	}
}

func firstInt(values map[string]interface{}, keys ...string) int {
	for _, key := range keys {
		switch value := values[key].(type) {
		case int:
			if value > 0 {
				return value
			}
		case int64:
			if value > 0 {
				return int(value)
			}
		case float64:
			if value > 0 {
				return int(value)
			}
		case json.Number:
			if parsed, err := value.Int64(); err == nil && parsed > 0 {
				return int(parsed)
			}
		}
	}
	return 0
}

func decodeChatResponse(protocol string, raw []byte) (*ChatResponse, error) {
	if protocol == chatProtocolOpenAI || protocol == "responses" {
		return decodeOpenAIChatResponse(raw)
	}
	if protocol == chatProtocolClaude {
		var payload struct {
			Content []map[string]interface{} `json:"content"`
			Usage   struct {
				InputTokens              int `json:"input_tokens"`
				OutputTokens             int `json:"output_tokens"`
				CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
				CacheReadInputTokens     int `json:"cache_read_input_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, err
		}
		var builder, reasoning strings.Builder
		for _, item := range payload.Content {
			if item["type"] == "thinking" {
				reasoning.WriteString(stringAnyRuntime(item["thinking"]))
			}
			if itemType := stringAnyRuntime(item["type"]); itemType == "text" || itemType == "" {
				builder.WriteString(stringAnyRuntime(item["text"]))
			}
		}
		usage := ChatUsage{PromptTokens: payload.Usage.InputTokens, CompletionTokens: payload.Usage.OutputTokens, TotalTokens: payload.Usage.InputTokens + payload.Usage.OutputTokens, CacheReadInputTokens: payload.Usage.CacheReadInputTokens, CacheCreationInputTokens: payload.Usage.CacheCreationInputTokens}
		return &ChatResponse{Choices: []ChatChoice{{Message: ChatMessage{Role: "assistant", Content: builder.String(), ReasoningContent: reasoning.String()}}}, Usage: usage, ContentBlocks: mapSliceToInterfaces(payload.Content)}, nil
	}
	var payload struct {
		Candidates []struct {
			Content struct {
				Parts []map[string]interface{} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		Usage struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
			TotalTokenCount      int `json:"totalTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	var builder, reasoning strings.Builder
	if len(payload.Candidates) > 0 {
		for _, part := range payload.Candidates[0].Content.Parts {
			if part["thought"] == true {
				reasoning.WriteString(stringAnyRuntime(part["text"]))
			} else {
				builder.WriteString(stringAnyRuntime(part["text"]))
			}
		}
	}
	usage := ChatUsage{PromptTokens: payload.Usage.PromptTokenCount, CompletionTokens: payload.Usage.CandidatesTokenCount, TotalTokens: payload.Usage.TotalTokenCount}
	var blocks []interface{}
	if len(payload.Candidates) > 0 {
		blocks = mapSliceToInterfaces(payload.Candidates[0].Content.Parts)
	}
	return &ChatResponse{Choices: []ChatChoice{{Message: ChatMessage{Role: "assistant", Content: builder.String(), ReasoningContent: reasoning.String()}}}, Usage: usage, ContentBlocks: blocks}, nil
}

func stringAnyRuntime(value interface{}) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}

func mapSliceToInterfaces(values []map[string]interface{}) []interface{} {
	result := make([]interface{}, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func consumeChatStream(reader io.Reader, protocol string, ch chan<- StreamChunk) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	eventName := ""
	usage := ChatUsage{}
	hasOutput := false
	finish := func() {
		if !hasOutput {
			ch <- StreamChunk{Error: &PlatformError{Code: "MODEL_EMPTY_RESPONSE", StatusCode: 502, Message: "模型未返回可用正文，请稍后重试。"}}
			return
		}
		ch <- StreamChunk{Done: true}
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			eventName = ""
			continue
		}
		if strings.HasPrefix(line, "event:") {
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		data := ""
		if strings.HasPrefix(line, "data:") {
			data = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		} else if strings.HasPrefix(line, "{") {
			data = line
		}
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			finish()
			return
		}
		event, err := decodeChatStreamEvent(protocol, eventName, []byte(data))
		if err != nil {
			ch <- StreamChunk{Error: err}
			return
		}
		if event.FinalContent != "" && !hasOutput {
			event.Content = event.FinalContent
		}
		if event.Content != "" || event.ReasoningContent != "" {
			hasOutput = hasOutput || strings.TrimSpace(event.Content) != ""
			ch <- StreamChunk{Content: event.Content, ReasoningContent: event.ReasoningContent}
		}
		if len(event.ToolCalls) > 0 {
			hasOutput = true
			ch <- StreamChunk{ToolCalls: event.ToolCalls}
		}
		if event.Usage != nil {
			mergeChatUsage(&usage, event.Usage)
			current := usage
			ch <- StreamChunk{Usage: &current}
		}
		if event.Done {
			finish()
			return
		}
	}
	if err := scanner.Err(); err != nil {
		ch <- StreamChunk{Error: err}
		return
	}
	finish()
}

type decodedChatStreamEvent struct {
	Content          string
	FinalContent     string
	ReasoningContent string
	ToolCalls        []map[string]interface{}
	Usage            *ChatUsage
	Done             bool
}

func decodeChatStreamEvent(protocol, eventName string, raw []byte) (decodedChatStreamEvent, error) {
	if protocol == "responses" {
		return decodeResponsesStreamEvent(raw)
	}
	if protocol == chatProtocolOpenAI {
		var event struct {
			Error   json.RawMessage `json:"error"`
			Choices []struct {
				FinishReason string          `json:"finish_reason"`
				Message      json.RawMessage `json:"message"`
				Text         string          `json:"text"`
				Delta        struct {
					Content          json.RawMessage `json:"content"`
					Refusal          string          `json:"refusal"`
					Text             string          `json:"text"`
					ReasoningContent json.RawMessage `json:"reasoning_content"`
					Reasoning        json.RawMessage `json:"reasoning"`
					ToolCalls        []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *ChatUsage `json:"usage"`
		}
		if err := json.Unmarshal(raw, &event); err != nil {
			return decodedChatStreamEvent{}, &PlatformError{Code: "MODEL_INVALID_RESPONSE", StatusCode: 502, Message: "模型返回的数据格式无法解析，请检查模型线路配置。"}
		}
		if len(event.Error) > 0 && string(event.Error) != "null" {
			return decodedChatStreamEvent{}, &PlatformError{Code: "MODEL_PROVIDER_ERROR", StatusCode: 502, Message: "模型服务返回错误，未能完成回答，请稍后重试。"}
		}
		result := decodedChatStreamEvent{Usage: event.Usage}
		if len(event.Choices) > 0 {
			choice := event.Choices[0]
			if err := chatFinishError(choice.FinishReason); err != nil {
				return decodedChatStreamEvent{}, err
			}
			if choice.Delta.Refusal != "" {
				return decodedChatStreamEvent{}, chatFinishError("content_filter")
			}
			if len(choice.Message) > 0 && string(choice.Message) != "null" {
				response, err := decodeOpenAIChatResponse(raw)
				if err != nil {
					return decodedChatStreamEvent{}, err
				}
				return decodedChatStreamEvent{Content: response.Choices[0].Message.Content, ReasoningContent: response.Choices[0].Message.ReasoningContent, ToolCalls: response.Choices[0].ToolCalls, Usage: &response.Usage, Done: true}, nil
			}
			content, err := openAIAnswerText(choice.Delta.Content)
			if err != nil {
				return decodedChatStreamEvent{}, err
			}
			if content == "" {
				content = choice.Delta.Text
			}
			if content == "" {
				content = choice.Text
			}
			result.Content = content
			result.ReasoningContent = jsonText(choice.Delta.ReasoningContent)
			if result.ReasoningContent == "" {
				result.ReasoningContent = jsonText(choice.Delta.Reasoning)
			}
		}
		if len(event.Choices) > 0 {
			for _, call := range event.Choices[0].Delta.ToolCalls {
				result.ToolCalls = append(result.ToolCalls, map[string]interface{}{"index": call.Index, "id": call.ID, "function": map[string]interface{}{"name": call.Function.Name, "arguments": call.Function.Arguments}})
			}
		}
		return result, nil
	}
	if protocol == chatProtocolClaude {
		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Text        string `json:"text"`
				Thinking    string `json:"thinking"`
				Type        string `json:"type"`
				PartialJSON string `json:"partial_json"`
			} `json:"delta"`
			ContentBlock struct {
				Type string `json:"type"`
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"content_block"`
			Message struct {
				Usage struct {
					InputTokens int `json:"input_tokens"`
				} `json:"usage"`
			} `json:"message"`
			Usage struct {
				OutputTokens int `json:"output_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal(raw, &event); err != nil {
			return decodedChatStreamEvent{}, err
		}
		eventType := eventName
		if eventType == "" {
			eventType = event.Type
		}
		switch eventType {
		case "message_start":
			return decodedChatStreamEvent{Usage: &ChatUsage{PromptTokens: event.Message.Usage.InputTokens}}, nil
		case "message_delta":
			return decodedChatStreamEvent{Usage: &ChatUsage{CompletionTokens: event.Usage.OutputTokens}}, nil
		case "content_block_delta":
			if event.Delta.Type == "thinking_delta" {
				return decodedChatStreamEvent{ReasoningContent: event.Delta.Thinking}, nil
			}
			if event.Delta.Type == "input_json_delta" || event.Delta.PartialJSON != "" {
				return decodedChatStreamEvent{ToolCalls: []map[string]interface{}{{"type": "input_json_delta", "partial_json": event.Delta.PartialJSON}}}, nil
			}
			return decodedChatStreamEvent{Content: event.Delta.Text}, nil
		case "content_block_start":
			if event.ContentBlock.Type == "tool_use" {
				return decodedChatStreamEvent{ToolCalls: []map[string]interface{}{{"type": "tool_use", "id": event.ContentBlock.ID, "name": event.ContentBlock.Name}}}, nil
			}
			return decodedChatStreamEvent{}, nil
		case "message_stop":
			return decodedChatStreamEvent{Done: true}, nil
		case "error":
			return decodedChatStreamEvent{}, errors.New(connectionTestMessage(raw))
		default:
			return decodedChatStreamEvent{}, nil
		}
	}
	var event struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text         string                 `json:"text"`
					Thought      bool                   `json:"thought"`
					FunctionCall map[string]interface{} `json:"functionCall"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		Usage struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
			TotalTokenCount      int `json:"totalTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(raw, &event); err != nil {
		return decodedChatStreamEvent{}, err
	}
	var builder, reasoning strings.Builder
	calls := make([]map[string]interface{}, 0)
	done := false
	if len(event.Candidates) > 0 {
		for _, part := range event.Candidates[0].Content.Parts {
			if part.Thought {
				reasoning.WriteString(part.Text)
			} else {
				builder.WriteString(part.Text)
			}
			if len(part.FunctionCall) > 0 {
				calls = append(calls, map[string]interface{}{"functionCall": part.FunctionCall})
			}
		}
		done = event.Candidates[0].FinishReason != ""
	}
	usage := &ChatUsage{PromptTokens: event.Usage.PromptTokenCount, CompletionTokens: event.Usage.CandidatesTokenCount, TotalTokens: event.Usage.TotalTokenCount}
	if usage.PromptTokens == 0 && usage.CompletionTokens == 0 && usage.TotalTokens == 0 {
		usage = nil
	}
	return decodedChatStreamEvent{Content: builder.String(), ReasoningContent: reasoning.String(), ToolCalls: calls, Usage: usage, Done: done}, nil
}

func jsonText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var value interface{}
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	var out strings.Builder
	var appendText func(interface{})
	appendText = func(current interface{}) {
		switch item := current.(type) {
		case string:
			out.WriteString(item)
		case []interface{}:
			for _, child := range item {
				appendText(child)
			}
		case map[string]interface{}:
			for _, key := range []string{"text", "value", "content", "summary"} {
				if child, ok := item[key]; ok {
					appendText(child)
					return
				}
			}
		}
	}
	appendText(value)
	return out.String()
}

func mergeChatUsage(target *ChatUsage, source *ChatUsage) {
	if source == nil {
		return
	}
	if source.PromptTokens > 0 {
		target.PromptTokens = source.PromptTokens
	}
	if source.CompletionTokens > 0 {
		target.CompletionTokens = source.CompletionTokens
	}
	if source.TotalTokens > 0 {
		target.TotalTokens = source.TotalTokens
	}
	if source.CacheReadInputTokens > 0 {
		target.CacheReadInputTokens = source.CacheReadInputTokens
	}
	if source.CacheCreationInputTokens > 0 {
		target.CacheCreationInputTokens = source.CacheCreationInputTokens
	}
	if source.TotalTokens == 0 && (source.PromptTokens > 0 || source.CompletionTokens > 0) {
		target.TotalTokens = target.PromptTokens + target.CompletionTokens
	} else if target.TotalTokens == 0 {
		target.TotalTokens = target.PromptTokens + target.CompletionTokens
	}
}

// Media protocol adapters for images, video, and audio

func mediaProtocol(extra map[string]interface{}) string {
	conn, _ := extra["connection"].(map[string]interface{})
	protocol, _ := conn["protocol"].(string)
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	// Most image/video/audio APIs follow OpenAI format, but allow override
	switch protocol {
	case "openai", "":
		return "openai"
	default:
		return protocol
	}
}

// applyMediaProtocolHeaders adds protocol-specific headers for media calls.
//
// Media endpoints are reached over plain HTTP with the channel's configured
// headers (see applyAuthHeaders + connection.headers), so there is currently no
// protocol that requires an extra header the way Claude requires
// anthropic-version. Custom headers belong in connection.headers; this hook
// exists so a future protocol can be added in one place.
func applyMediaProtocolHeaders(req *http.Request, protocol string, extra map[string]interface{}) {
	if protocol == chatProtocolClaude {
		req.Header.Set("anthropic-version", connectionValue(extra, "anthropic_version", "2023-06-01"))
	}
}

func prepareImageRequest(req ImageRequest, protocol string, extra map[string]interface{}) ([]byte, error) {
	base := map[string]interface{}{
		"model":  req.Model,
		"prompt": req.Prompt,
		"n":      req.N,
		"size":   req.Size,
	}
	switch protocol {
	case "openai":
		return json.Marshal(base)
	default:
		// For custom protocols, merge with extra params
		if conn, ok := extra["connection"].(map[string]interface{}); ok {
			if customFields, ok := conn["request_transform"].(map[string]interface{}); ok {
				for k, v := range customFields {
					base[k] = v
				}
			}
		}
		return json.Marshal(base)
	}
}

// decodeImageResponse parses an image response.
//
// All known providers return either OpenAI's {"data":[...]} envelope or a shape
// that unmarshals compatibly, so there is one implementation rather than a
// per-protocol switch. The protocol argument is kept for symmetry with the
// prepare* functions and for future divergence.
func decodeImageResponse(protocol string, raw []byte) (*ImageResponse, error) {
	var result ImageResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func prepareVideoRequest(req VideoRequest, protocol string, extra map[string]interface{}) ([]byte, error) {
	base := map[string]interface{}{
		"model":  req.Model,
		"prompt": req.Prompt,
	}
	for k, v := range req.Extra {
		if k != "" && v != nil {
			base[k] = v
		}
	}
	switch protocol {
	case "openai":
		return json.Marshal(base)
	default:
		if conn, ok := extra["connection"].(map[string]interface{}); ok {
			if customFields, ok := conn["request_transform"].(map[string]interface{}); ok {
				for k, v := range customFields {
					base[k] = v
				}
			}
		}
		return json.Marshal(base)
	}
}

func decodeVideoResponse(protocol string, raw []byte) (*VideoResponse, error) {
	var result VideoResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func prepareAudioRequest(req AudioRequest, protocol string, extra map[string]interface{}) ([]byte, error) {
	base := map[string]interface{}{
		"model": req.Model,
		"input": req.Input,
	}
	if req.Voice != "" {
		base["voice"] = req.Voice
	}
	if req.Format != "" {
		base["response_format"] = req.Format
	}
	for k, v := range req.Extra {
		if k != "" && v != nil {
			base[k] = v
		}
	}
	switch protocol {
	case "openai":
		return json.Marshal(base)
	default:
		if conn, ok := extra["connection"].(map[string]interface{}); ok {
			if customFields, ok := conn["request_transform"].(map[string]interface{}); ok {
				for k, v := range customFields {
					base[k] = v
				}
			}
		}
		return json.Marshal(base)
	}
}

func decodeAudioResponse(protocol string, raw []byte) (*AudioResponse, error) {
	var result AudioResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
