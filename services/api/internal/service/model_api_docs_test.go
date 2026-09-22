package service

import "testing"

func TestStandardAPIDocContentNormalizesLegacyChatResponse(t *testing.T) {
	doc := &APIDocDTO{Slug: "chat-model", ModelCode: "chat-model", RequestMode: "chat_completions", Endpoint: "/v1/chat/completions"}
	content := standardAPIDocContent(doc, map[string]interface{}{
		"response_example": map[string]interface{}{"code": 0, "message": "ok", "data": map[string]interface{}{}},
		"responses": map[string]interface{}{
			"200": map[string]interface{}{"description": "请求成功", "body": map[string]interface{}{"code": 0, "data": map[string]interface{}{}}},
		},
	})

	response, ok := content["response_example"].(map[string]interface{})
	if !ok || response["object"] != "chat.completion" {
		t.Fatalf("expected native chat completion response, got %#v", content["response_example"])
	}
	parameters, ok := content["parameters"].([]map[string]interface{})
	if !ok || len(parameters) == 0 {
		t.Fatalf("expected standard chat parameters, got %#v", content["parameters"])
	}
	responses, ok := content["responses"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected response definitions, got %#v", content["responses"])
	}
	success, ok := responses["200"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected 200 response definition, got %#v", responses["200"])
	}
	successBody, ok := success["body"].(map[string]interface{})
	if !ok || successBody["object"] != "chat.completion" {
		t.Fatalf("expected native 200 response body, got %#v", success["body"])
	}
}

func TestStandardAPIDocContentUsesNativeMediaTaskResponse(t *testing.T) {
	doc := &APIDocDTO{Slug: "image-model", ModelCode: "image-model", RequestMode: "images", Endpoint: "/v1/images/generations"}
	content := standardAPIDocContent(doc, nil)
	response, ok := content["response_example"].(map[string]interface{})
	if !ok || response["task_no"] != "task_xxx" || response["status"] != "pending" {
		t.Fatalf("expected native media task response, got %#v", content["response_example"])
	}
	if _, wrapped := response["data"]; wrapped {
		t.Fatalf("media task response must not use legacy data envelope: %#v", response)
	}
}

func TestOpenAIImagesAPIDocDeclaresEditUploadAndStandardQuality(t *testing.T) {
	doc := &APIDocDTO{
		Slug: "gpt-image", ModelCode: "gpt-image", RequestMode: "images", Endpoint: "/v1/images/generations",
		RuntimeRule: map[string]interface{}{"upstream": map[string]interface{}{"adapter": "openai_images"}},
	}
	content := standardAPIDocContent(doc, nil)
	example := content["request_example"].(map[string]interface{})
	if example["quality"] != "auto" {
		t.Fatalf("OpenAI Images example must use a standard quality: %#v", example)
	}
	foundImage := false
	for _, parameter := range content["parameters"].([]map[string]interface{}) {
		if parameter["name"] == "image" && parameter["type"] == "file|file[]" {
			foundImage = true
		}
	}
	if !foundImage {
		t.Fatalf("OpenAI Images docs must declare the multipart edit image element: %#v", content["parameters"])
	}
}

func TestStandardAPIDocResponsesUseNativeErrorShape(t *testing.T) {
	responses := standardAPIDocResponses(map[string]interface{}{
		"responses": map[string]interface{}{
			"400": map[string]interface{}{"description": "请求参数错误", "body": map[string]interface{}{"code": 400, "message": "参数错误"}},
		},
	}, map[string]interface{}{"object": "chat.completion"})
	badRequest, ok := responses["400"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected 400 response definition, got %#v", responses["400"])
	}
	body, ok := badRequest["body"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected 400 body, got %#v", badRequest["body"])
	}
	if _, ok := body["error"].(map[string]interface{}); !ok {
		t.Fatalf("expected native error body, got %#v", body)
	}
}

func TestStandardAPIDocContentUsesModelMediaDefaults(t *testing.T) {
	doc := &APIDocDTO{
		Slug: "qwen-tts", ModelCode: "qwen-tts", RequestMode: "audio", NewAPIModel: "qwen-audio-3.0-tts-flash",
		DefaultParams: map[string]interface{}{"voice": "longanhuan_v3.6", "format": "wav", "sample_rate": float64(24000)},
		InputSchema: map[string]interface{}{"properties": map[string]interface{}{
			"voice": map[string]interface{}{"type": "string", "title": "音色", "enum": []interface{}{"longanhuan_v3.6"}},
		}},
	}
	content := standardAPIDocContent(doc, nil)
	example := content["request_example"].(map[string]interface{})
	if example["voice"] != "longanhuan_v3.6" || example["sample_rate"] != float64(24000) {
		t.Fatalf("request_example = %#v", example)
	}
	foundInstruction := false
	for _, parameter := range content["parameters"].([]map[string]interface{}) {
		foundInstruction = foundInstruction || parameter["name"] == "instruction"
	}
	if !foundInstruction {
		t.Fatal("Qwen Audio API documentation must expose instruction")
	}
}

func TestStandardAPIDocContentSupportsFunMusicLyricsOnly(t *testing.T) {
	doc := &APIDocDTO{
		Slug: "fun-music", ModelCode: "fun-music", RequestMode: "audio", NewAPIModel: "fun-music-v1",
		DefaultParams: map[string]interface{}{"format": "mp3", "lyrics": "晚风吹过海面"},
	}
	content := standardAPIDocContent(doc, nil)
	example := content["request_example"].(map[string]interface{})
	if example["lyrics"] != "晚风吹过海面" {
		t.Fatalf("request_example = %#v", example)
	}
	parameters := content["parameters"].([]map[string]interface{})
	for _, parameter := range parameters {
		if parameter["name"] == "input" && parameter["required"] != false {
			t.Fatalf("Fun-Music input must be optional when lyrics is supplied: %#v", parameter)
		}
	}
}

func TestStandardAPIDocContentExplainsMiniMaxMusicInputs(t *testing.T) {
	doc := &APIDocDTO{
		Slug: "minimax-music", ModelCode: "minimax-music", RequestMode: "audio", NewAPIModel: "music-3.0",
		RuntimeRule: map[string]interface{}{"audio": map[string]interface{}{"prompt_required": false}},
	}
	content := standardAPIDocContent(doc, nil)
	example := content["request_example"].(map[string]interface{})
	if example["input"] == "" || example["music_prompt"] == "" {
		t.Fatalf("MiniMax Music example must include valid lyrics and music description: %#v", example)
	}
	for _, parameter := range content["parameters"].([]map[string]interface{}) {
		if parameter["name"] == "input" && parameter["required"] != false {
			t.Fatalf("MiniMax Music input must follow the model's optional-prompt rule: %#v", parameter)
		}
	}
}
