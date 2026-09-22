package runtime

import "encoding/json"

func marshalResponsesRequest(req ChatRequest) ([]byte, error) {
	messages, err := protocolMessages(req.Messages)
	if err != nil {
		return nil, err
	}
	for index := range messages {
		parts, ok := messages[index].Content.([]interface{})
		if !ok {
			continue
		}
		for _, raw := range parts {
			part, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			switch part["type"] {
			case "text":
				part["type"] = "input_text"
				if messages[index].Role == "assistant" {
					part["type"] = "output_text"
				}
			case "image_url":
				part["type"] = "input_image"
				if image, ok := part["image_url"].(map[string]interface{}); ok {
					part["image_url"] = image["url"]
					if image["detail"] != nil {
						part["detail"] = image["detail"]
					}
				}
			}
		}
	}
	body := map[string]interface{}{"model": req.Model, "input": messages, "stream": req.Stream}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	for key, value := range req.Extra {
		switch key {
		case "max_tokens", "max_completion_tokens":
			body["max_output_tokens"] = value
		case "reasoning_effort":
			reasoning, _ := req.Extra["reasoning"].(map[string]interface{})
			copy := map[string]interface{}{}
			for k, v := range reasoning {
				copy[k] = v
			}
			copy["effort"] = value
			body["reasoning"] = copy
		case "reasoning":
			if _, exists := req.Extra["reasoning_effort"]; !exists {
				body[key] = value
			}
		case "response_format":
			body["text"] = map[string]interface{}{"format": value}
		default:
			body[key] = value
		}
	}
	return json.Marshal(body)
}

func decodeResponsesStreamEvent(raw []byte) (decodedChatStreamEvent, error) {
	var event struct {
		Type     string          `json:"type"`
		Delta    string          `json:"delta"`
		Response json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(raw, &event); err != nil {
		return decodedChatStreamEvent{}, err
	}
	switch event.Type {
	case "response.output_text.delta":
		return decodedChatStreamEvent{Content: event.Delta}, nil
	case "response.reasoning_summary_text.delta":
		return decodedChatStreamEvent{ReasoningContent: event.Delta}, nil
	case "response.refusal.delta":
		return decodedChatStreamEvent{}, chatFinishError("content_filter")
	case "response.incomplete":
		return decodedChatStreamEvent{}, chatFinishError("length")
	case "response.failed", "error":
		return decodedChatStreamEvent{}, chatFinishError("error")
	case "response.completed":
		response, err := decodeOpenAIChatResponse(event.Response)
		if err != nil {
			return decodedChatStreamEvent{}, err
		}
		return decodedChatStreamEvent{FinalContent: response.Choices[0].Message.Content, Usage: &response.Usage, Done: true}, nil
	}
	return decodedChatStreamEvent{}, nil
}
