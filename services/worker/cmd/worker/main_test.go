package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/starai/worker/internal/storage"
)

func TestParseQwenImageChoicesResponse(t *testing.T) {
	items, taskID := parseUpstreamMedia([]byte(`{"output":{"choices":[{"message":{"role":"assistant","content":[{"image":"https://example.com/qwen.png"}]}}]},"request_id":"req-1"}`))
	if taskID != "req-1" || len(items) != 1 || items[0].URL != "https://example.com/qwen.png" {
		t.Fatalf("items=%#v taskID=%q", items, taskID)
	}
}

func TestNormalizePayloadMediaEmbedsAliyunNestedImages(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0, 'I', 'H', 'D', 'R'})
	}))
	defer server.Close()
	payload := map[string]interface{}{"input": map[string]interface{}{
		"media":    []interface{}{map[string]interface{}{"type": "first_frame", "url": server.URL + "/first.png"}},
		"messages": []interface{}{map[string]interface{}{"content": []interface{}{map[string]interface{}{"image": server.URL + "/ref.png"}}}},
	}}
	if err := normalizePayloadMedia(context.Background(), payload, ""); err != nil {
		t.Fatal(err)
	}
	input := payload["input"].(map[string]interface{})
	mediaURL := input["media"].([]interface{})[0].(map[string]interface{})["url"].(string)
	messageURL := input["messages"].([]interface{})[0].(map[string]interface{})["content"].([]interface{})[0].(map[string]interface{})["image"].(string)
	if !strings.HasPrefix(mediaURL, "data:image/png;base64,") || !strings.HasPrefix(messageURL, "data:image/png;base64,") {
		t.Fatalf("nested images were not embedded: media=%q message=%q", mediaURL, messageURL)
	}
}

func TestNormalizePayloadMediaRejectsPrivateAliyunVideo(t *testing.T) {
	payload := map[string]interface{}{"input": map[string]interface{}{"media": []interface{}{
		map[string]interface{}{"type": "reference_video", "url": "http://localhost:9000/assets/ref.mp4"},
	}}}
	if err := normalizePayloadMedia(context.Background(), payload, ""); err == nil || !strings.Contains(err.Error(), "MINIO_PUBLIC_URL") {
		t.Fatalf("expected actionable private video error, got %v", err)
	}
}

func TestAliyunWorkspaceEndpointValidation(t *testing.T) {
	if !requiresAliyunWorkspaceEndpoint("qwen-image-3.0-pro") || !requiresAliyunWorkspaceEndpoint("wan3.0-video") || requiresAliyunWorkspaceEndpoint("gpt-image-1") {
		t.Fatal("unexpected Aliyun workspace model detection")
	}
	if !isAliyunWorkspaceEndpoint("https://ws-123.cn-beijing.maas.aliyuncs.com") {
		t.Fatal("valid workspace endpoint rejected")
	}
	for _, endpoint := range []string{"https://dashscope.aliyuncs.com", "http://ws-123.cn-beijing.maas.aliyuncs.com", "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com"} {
		if isAliyunWorkspaceEndpoint(endpoint) {
			t.Fatalf("invalid workspace endpoint accepted: %s", endpoint)
		}
	}
}

func TestResolveImageGenerationInputPreservesExplicitSize(t *testing.T) {
	input := map[string]interface{}{"size": "1536x1024", "aspect_ratio": "auto"}
	resolveImageGenerationInput(input, nil, "/v1/images/generations", "gpt-image")
	if input["size"] != "1536x1024" || input["resolved_size"] != "1536x1024" {
		t.Fatalf("explicit API size was overwritten: %#v", input)
	}
}

func TestApplyOpenAIImageOptionsKeepsThirdPartyParameters(t *testing.T) {
	out := map[string]interface{}{}
	applyOpenAIImageOptions(out, map[string]interface{}{
		"quality": "hd", "style": "natural", "input_fidelity": "high", "negative_prompt": "blur", "wait": true,
	})
	if out["quality"] != "hd" || out["style"] != "natural" || out["input_fidelity"] != "high" || out["negative_prompt"] != "blur" {
		t.Fatalf("third-party image options were lost: %#v", out)
	}
	if _, leaked := out["wait"]; leaked {
		t.Fatalf("platform control leaked upstream: %#v", out)
	}
}

func TestBuildOpenAIImagesPayloadUsesStrictCompatibleFields(t *testing.T) {
	payload := buildOpenAIImagesPayload("gpt-image-1", "fallback", "draw a cat", 2, map[string]interface{}{
		"size": "1344x768", "quality": "1K", "aspect_ratio": "16:9", "image_size": "1K",
		"negative_prompt": "blur", "watermark": true, "reference_images": []interface{}{"https://example.com/ref.png"},
		"background": "transparent", "output_format": "png", "input_fidelity": "high",
	})
	if payload["model"] != "gpt-image-1" || payload["prompt"] != "draw a cat" || payload["n"] != 2 {
		t.Fatalf("required OpenAI Images fields are wrong: %#v", payload)
	}
	if payload["quality"] != "auto" || payload["size"] != "1536x1024" {
		t.Fatalf("quality/size were not normalized: %#v", payload)
	}
	if payload["background"] != "transparent" || payload["output_format"] != "png" {
		t.Fatalf("supported OpenAI Images options were lost: %#v", payload)
	}
	if payload["input_fidelity"] != "high" {
		t.Fatalf("input fidelity was lost: %#v", payload)
	}
	for _, key := range []string{"aspect_ratio", "image_size", "negative_prompt", "watermark", "reference_images", "image"} {
		if _, leaked := payload[key]; leaked {
			t.Fatalf("non-standard field %q leaked upstream: %#v", key, payload)
		}
	}
}

func TestOpenAIImagesQualityCompatibility(t *testing.T) {
	for _, quality := range []string{"auto", "low", "medium", "high"} {
		if got := normalizeOpenAIImageQuality(quality); got != quality {
			t.Fatalf("quality %q normalized to %q", quality, got)
		}
	}
	if got := normalizeOpenAIImageQuality("2K"); got != "auto" {
		t.Fatalf("invalid quality normalized to %q, want auto", got)
	}
	if !isOpenAIImagesAdapter(map[string]interface{}{"upstream": map[string]interface{}{"adapter": "openai_images"}}) {
		t.Fatal("OpenAI Images adapter was not detected")
	}
	if !omitOpenAIImageQuality(map[string]interface{}{"upstream": map[string]interface{}{"omit_quality": true}}) {
		t.Fatal("route-level quality omission was not detected")
	}
}

func TestResolveImageRequestEndpointKeepsAsyncWholeImageAndRoutesMaskToEdits(t *testing.T) {
	runtimeRule := map[string]interface{}{"upstream": map[string]interface{}{
		"adapter":       "openai_images",
		"edit_endpoint": "/v1/images/edits",
	}}

	endpoint, err := resolveImageRequestEndpoint(runtimeRule, "/v1/videos", "gpt-image-2", map[string]interface{}{})
	if err != nil || endpoint != "/v1/videos" {
		t.Fatalf("whole-image endpoint = %q, err=%v", endpoint, err)
	}

	endpoint, err = resolveImageRequestEndpoint(runtimeRule, "/v1/videos", "gpt-image-2", map[string]interface{}{"mask": "data:image/png;base64,bWFzaw=="})
	if err != nil || endpoint != "/v1/images/edits" {
		t.Fatalf("masked endpoint = %q, err=%v", endpoint, err)
	}
}

func TestOpenAIImageMultipartFieldKeepsDefaultAndSupportsProviderOverride(t *testing.T) {
	if got := openAIImageMultipartField(nil, "https://api.openai.com", "gpt-image-2.5-flare", 2); got != "image[]" {
		t.Fatalf("default multi-image field = %q, want image[]", got)
	}
	runtimeRule := map[string]interface{}{"upstream": map[string]interface{}{"multipart_image_field": "image"}}
	if got := openAIImageMultipartField(runtimeRule, "https://api.openai.com", "gpt-image-2", 2); got != "image" {
		t.Fatalf("overridden multi-image field = %q, want image", got)
	}
	if got := openAIImageMultipartField(nil, "https://zexapi.com", "gpt-image-2.5-sunburst", 2); got != "image" {
		t.Fatalf("zexapi GPT Image 2.5 field = %q, want image", got)
	}
	if got := openAIImageMultipartField(nil, "https://zexapi.com", "gpt-image-2", 2); got != "image[]" {
		t.Fatalf("existing GPT Image 2 field = %q, want image[]", got)
	}
}

func TestOpenAIImagesRequestTimeoutAllowsLargeSynchronousResponse(t *testing.T) {
	if got := openAIImagesRequestTimeout(120 * time.Second); got != 10*time.Minute {
		t.Fatalf("timeout = %s, want 10m", got)
	}
	if got := openAIImagesRequestTimeout(15 * time.Minute); got != 15*time.Minute {
		t.Fatalf("configured timeout = %s, want 15m", got)
	}
}

func TestResolveWorkerAPIKeyReference(t *testing.T) {
	t.Setenv("STARAI_TEST_ROUTE_KEY", "resolved-secret")
	if got := resolveWorkerAPIKeyReference("${STARAI_TEST_ROUTE_KEY}"); got != "resolved-secret" {
		t.Fatalf("resolved key = %q", got)
	}
	if got := resolveWorkerAPIKeyReference("literal-secret"); got != "literal-secret" {
		t.Fatalf("literal key = %q", got)
	}
}

func TestOpenAIImagesReferenceUploadUsesEditsMultipart(t *testing.T) {
	var requestErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			requestErr = fmt.Errorf("path = %s", r.URL.Path)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			requestErr = err
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if r.FormValue("model") != "gpt-image-1" || r.FormValue("quality") != "high" || r.FormValue("input_fidelity") != "high" {
			requestErr = fmt.Errorf("fields = %#v", r.MultipartForm.Value)
		}
		if files := r.MultipartForm.File["image[]"]; len(files) != 2 {
			requestErr = fmt.Errorf("image files = %d", len(files))
		} else if files[0].Header.Get("Content-Type") != "image/png" {
			requestErr = fmt.Errorf("image content type = %s", files[0].Header.Get("Content-Type"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"aW1hZ2U="}]}`))
	}))
	defer server.Close()

	payload := buildOpenAIImagesPayload("gpt-image-1", "fallback", "edit these", 1, map[string]interface{}{
		"size": "1024x1024", "quality": "high", "input_fidelity": "high",
	})
	imageData := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nimage"))
	runtimeRule := map[string]interface{}{"upstream": map[string]interface{}{"adapter": "openai_images", "edit_endpoint": "/v1/images/edits"}}
	endpoint := openAIImageEditEndpoint(runtimeRule, "/v1/images/generations")
	body, status, err := postOpenAIImagesUpstream(context.Background(), connectionConfig{BaseURL: server.URL}, endpoint, payload, []string{imageData, imageData}, runtimeRule, time.Second)
	if err != nil || status != http.StatusOK || requestErr != nil {
		t.Fatalf("multipart edit failed: status=%d err=%v requestErr=%v body=%s", status, err, requestErr, body)
	}
}

func TestOmniReferenceUsesManagedAssetBytes(t *testing.T) {
	store, err := storage.NewLocal(t.TempDir(), "http://127.0.0.1:1/uploads-local")
	if err != nil {
		t.Fatal(err)
	}
	previousStore := objectStore
	objectStore = store
	defer func() { objectStore = previousStore }()

	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0, 'I', 'H', 'D', 'R'}
	assetURL, err := store.Upload(context.Background(), "assets/1/ref.png", "image/png", bytes.NewReader(png), int64(len(png)))
	if err != nil {
		t.Fatal(err)
	}
	normalized := normalizeReferenceImage(context.Background(), assetURL)
	if !strings.HasPrefix(normalized, "data:image/png;base64,") {
		t.Fatalf("managed reference was not embedded: %q", normalized)
	}
	payload := map[string]interface{}{"model": "omni_flash-10s", "images": []interface{}{normalized}}
	if err := validateOmniReferencePayload(payload); err != nil {
		t.Fatal(err)
	}
	payload["images"] = []interface{}{assetURL}
	if err := validateOmniReferencePayload(payload); err == nil {
		t.Fatal("unresolved Omni reference must not silently degrade to text-only generation")
	}
}

func TestParseUpstreamMediaKeepsTaskIDWhenMediaExists(t *testing.T) {
	body := []byte(`{
		"code": "success",
		"data": {
			"id": 4219436,
			"task_id": "task_8bSnSQRDipvCCp1iqew8z1H8y0mbFqoD",
			"status": "SUCCESS",
			"result_url": "https://otuapi.com/v1/videos/task_ijlim0lsyqb6Svhqgh1VkAQf1ys1nUne/content"
		}
	}`)

	items, upstreamID := parseUpstreamMedia(body)
	if upstreamID != "task_8bSnSQRDipvCCp1iqew8z1H8y0mbFqoD" {
		t.Fatalf("upstreamID = %q", upstreamID)
	}
	if len(items) != 1 || items[0].URL != "https://otuapi.com/v1/videos/task_ijlim0lsyqb6Svhqgh1VkAQf1ys1nUne/content" {
		t.Fatalf("items = %#v", items)
	}
}

func TestParseUpstreamMediaReadsBase64Audio(t *testing.T) {
	audio := base64.StdEncoding.EncodeToString([]byte("ID3\x04audio-audio-audio-audio-audio-audio-audio-audio"))
	body := []byte(`{
		"data": {
			"audio": "` + audio + `",
			"format": "mp3"
		}
	}`)

	items, upstreamID := parseUpstreamMedia(body)
	if upstreamID != "" {
		t.Fatalf("upstreamID = %q", upstreamID)
	}
	if len(items) != 1 {
		t.Fatalf("items = %#v", items)
	}
	if items[0].B64JSON != audio {
		t.Fatalf("audio base64 = %q", items[0].B64JSON)
	}
	if items[0].MimeType != "mp3" {
		t.Fatalf("mime/format = %q", items[0].MimeType)
	}
}

func TestParseUpstreamMediaReadsHexAudio(t *testing.T) {
	audio := hex.EncodeToString([]byte("ID3\x04audio-audio-audio-audio-audio-audio-audio-audio"))
	body := []byte(`{
		"data": {
			"audio": "` + audio + `",
			"format": "mp3"
		}
	}`)

	items, _ := parseUpstreamMedia(body)
	if len(items) != 1 {
		t.Fatalf("items = %#v", items)
	}
	if items[0].B64JSON != audio {
		t.Fatalf("audio hex = %q", items[0].B64JSON)
	}
	data, contentType, err := decodeEncodedMedia(items[0].B64JSON, items[0].MimeType, "audio")
	if err != nil {
		t.Fatal(err)
	}
	if string(data[:3]) != "ID3" {
		t.Fatalf("decoded head = %q", string(data[:3]))
	}
	if contentType != "audio/mpeg" {
		t.Fatalf("contentType = %q", contentType)
	}
	dataURL := normalizeAudioResultURL(items[0].B64JSON, items[0].MimeType)
	if dataURL == "" {
		t.Fatal("data url fallback is empty")
	}
	if got, want := dataURL[:22], "data:audio/mpeg;base64"; got != want {
		t.Fatalf("data url prefix = %q, want %q", got, want)
	}
}

func TestParseUpstreamMediaReadsHexAudioFromDataString(t *testing.T) {
	audio := hex.EncodeToString([]byte("ID3\x04music-music-music-music-music-music-music"))
	body := []byte(`{"data":"` + audio + `","format":"mp3"}`)

	items, _ := parseUpstreamMedia(body)
	if len(items) != 1 || items[0].B64JSON != audio {
		t.Fatalf("items = %#v", items)
	}
}

func TestParseUpstreamMediaReadsHexAudioFromAudioFile(t *testing.T) {
	audio := hex.EncodeToString([]byte("ID3\x04music-music-music-music-music-music-music"))
	body := []byte(`{"data":{"audio_file":"` + audio + `","audio_format":"mp3"}}`)

	items, _ := parseUpstreamMedia(body)
	if len(items) != 1 || items[0].B64JSON != audio || items[0].MimeType != "mp3" {
		t.Fatalf("items = %#v", items)
	}
}

func TestParseUpstreamMediaReadsNestedAudioResult(t *testing.T) {
	audio := hex.EncodeToString([]byte("ID3\x04music-music-music-music-music-music-music"))
	body := []byte(`{"data":{"audio_result":{"audio":"` + audio + `","format":"mp3"}}}`)

	items, _ := parseUpstreamMedia(body)
	if len(items) != 1 || items[0].B64JSON != audio {
		t.Fatalf("items = %#v", items)
	}
}

func TestParseUpstreamMediaReadsPluralMediaLists(t *testing.T) {
	tests := []struct {
		name string
		body string
		want []string
	}{
		{"images", `{"data":{"images":[{"url":"https://example.com/1.png"},{"image_url":"https://example.com/2.png"}]}}`, []string{"https://example.com/1.png", "https://example.com/2.png"}},
		{"videos", `{"result":{"videos":[{"video_url":"https://example.com/1.mp4"}]}}`, []string{"https://example.com/1.mp4"}},
		{"audios", `{"output":{"audios":[{"audio_url":"https://example.com/1.mp3"}]}}`, []string{"https://example.com/1.mp3"}},
		{"results", `{"results":[{"url":"https://example.com/1.webp"}]}`, []string{"https://example.com/1.webp"}},
		{"nested plural list", `{"data":[{"files":[{"uri":"https://example.com/1.wav"}]}]}`, []string{"https://example.com/1.wav"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items, _ := parseUpstreamMedia([]byte(tt.body))
			if len(items) != len(tt.want) {
				t.Fatalf("items = %#v", items)
			}
			for i, want := range tt.want {
				if items[i].URL != want {
					t.Fatalf("items[%d].URL = %q, want %q", i, items[i].URL, want)
				}
			}
		})
	}
}

func TestParseUpstreamMediaReadsTaskIDInsideArray(t *testing.T) {
	items, upstreamID := parseUpstreamMedia([]byte(`{"data":[{"task_id":"task-array-1","status":"queued"}]}`))
	if len(items) != 0 || upstreamID != "task-array-1" {
		t.Fatalf("items=%#v upstreamID=%q", items, upstreamID)
	}
}

func TestPlatformAsyncTaskResponseUsesPollURL(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/tasks/task-production-1" {
			t.Fatalf("poll path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"task_no":"task-production-1","status":"succeeded","output":{"images":[{"url":"https://example.com/result.png"}]}}`))
	}))
	defer server.Close()

	created := []byte(`{"task_no":"task-production-1","status":"pending","poll_url":"/v1/tasks/task-production-1"}`)
	items, upstreamID := parseUpstreamMedia(created)
	if len(items) != 0 || upstreamID != "task-production-1" {
		t.Fatalf("create response items=%#v upstreamID=%q", items, upstreamID)
	}
	pollPath := upstreamPollPath(created, server.URL)
	if pollPath != "/v1/tasks/task-production-1" {
		t.Fatalf("poll path = %q", pollPath)
	}
	items, _, err := pollUpstreamTask(context.Background(), nil, connectionConfig{BaseURL: server.URL, AuthType: "none"}, pollConfig{
		Path: pollPath, Interval: time.Millisecond, Timeout: time.Second,
	}, upstreamID, "local-task-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].URL != "https://example.com/result.png" {
		t.Fatalf("poll items = %#v", items)
	}
}

func TestDashScopeAsyncTaskRequestHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/video-synthesis":
			if got := r.Header.Get("X-DashScope-Async"); got != "enable" {
				t.Fatalf("create async header = %q", got)
			}
			_, _ = w.Write([]byte(`{"task_id":"task-1","status":"pending"}`))
		case "/tasks/task-1":
			if got := r.Header.Get("X-DashScope-Async"); got != "" {
				t.Fatalf("poll async header = %q", got)
			}
			if got := r.Header.Get("X-Keep"); got != "keep" {
				t.Fatalf("preserved header = %q", got)
			}
			if got := r.Header.Get("Authorization"); got != "Bearer key-1" {
				t.Fatalf("authorization = %q", got)
			}
			_, _ = w.Write([]byte(`{"status":"succeeded","output":{"videos":[{"url":"https://example.com/result.mp4"}]}}`))
		default:
			t.Fatalf("unexpected request path = %q", r.URL.Path)
		}
	}))
	defer server.Close()

	conn := connectionConfig{
		BaseURL: server.URL,
		APIKey:  "key-1",
		Headers: map[string]string{"x-dashscope-async": "enable", "X-Keep": "keep"},
	}
	if _, statusCode, err := doJSONRequest(context.Background(), conn, http.MethodPost, server.URL+"/video-synthesis", []byte(`{}`), time.Second); err != nil || statusCode != http.StatusOK {
		t.Fatalf("create request status=%d err=%v", statusCode, err)
	}
	items, _, err := pollUpstreamTask(context.Background(), nil, conn, pollConfig{Path: "/tasks/{id}", Interval: time.Millisecond, Timeout: time.Second}, "task-1", "local-task-header")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].URL != "https://example.com/result.mp4" {
		t.Fatalf("items = %#v", items)
	}
}

func TestPollUpstreamTaskSupportsPostBodyAndNumericSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/aiart/query" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["job_id"] != "job-123" {
			t.Fatalf("body = %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"5","data":[{"url":"https://example.com/result.png"}]}`))
	}))
	defer server.Close()

	items, _, err := pollUpstreamTask(context.Background(), nil, connectionConfig{BaseURL: server.URL, AuthType: "none"}, pollConfig{
		Path: "/v1/aiart/query", Method: http.MethodPost, Body: map[string]interface{}{"job_id": "{id}"},
		Interval: time.Millisecond, Timeout: time.Second,
	}, "job-123", "local-task-post")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].URL != "https://example.com/result.png" {
		t.Fatalf("items = %#v", items)
	}
}

func TestUpstreamPollPathRejectsForeignAbsoluteURL(t *testing.T) {
	body := []byte(`{"task_no":"task-1","poll_url":"https://attacker.example/tasks/task-1"}`)
	if got := upstreamPollPath(body, "https://api.example.com"); got != "" {
		t.Fatalf("foreign poll URL accepted: %q", got)
	}
}

func TestApplyRequestTransformUsesEffectiveConnection(t *testing.T) {
	payload := map[string]interface{}{"n": 1, "size": "1024x1024"}
	applyRequestTransform(payload, map[string]interface{}{
		"connection": map[string]interface{}{
			"request_transform": map[string]interface{}{"n": nil, "size": nil, "num_images": float64(2)},
		},
	})
	if _, ok := payload["n"]; ok {
		t.Fatalf("n was not removed: %#v", payload)
	}
	if _, ok := payload["size"]; ok {
		t.Fatalf("size was not removed: %#v", payload)
	}
	if payload["num_images"] != float64(2) {
		t.Fatalf("num_images was not applied: %#v", payload)
	}
}

func TestBuildMappedImagePayloadSupportsNestedNativeAPIFields(t *testing.T) {
	runtimeRule := map[string]interface{}{
		"upstream": map[string]interface{}{
			"include": []interface{}{"size", "count", "reference_images"},
			"map": map[string]interface{}{
				"model":            "model",
				"prompt":           "input.prompt",
				"size":             "parameters.size",
				"count":            "parameters.n",
				"reference_images": "input.img_url",
			},
		},
	}
	payload := buildMappedImagePayload(context.Background(), "fallback", "wanx-v1", runtimeRule, map[string]interface{}{}, map[string]interface{}{
		"prompt": "a cat", "size": "1024*1024", "count": float64(2),
		"reference_images": []interface{}{"data:image/png;base64,AA=="},
	})
	input, ok := payload["input"].(map[string]interface{})
	if !ok || input["prompt"] != "a cat" {
		t.Fatalf("input = %#v", payload["input"])
	}
	refs, ok := input["img_url"].([]interface{})
	if !ok || len(refs) != 1 || refs[0] != "data:image/png;base64,AA==" {
		t.Fatalf("img_url = %#v", input["img_url"])
	}
	parameters, ok := payload["parameters"].(map[string]interface{})
	if !ok || parameters["size"] != "1024*1024" || parameters["n"] != float64(2) {
		t.Fatalf("parameters = %#v", payload["parameters"])
	}
	if payload["model"] != "wanx-v1" {
		t.Fatalf("model = %#v", payload["model"])
	}
}

func TestNormalizeWorkerMediaRequestMode(t *testing.T) {
	for category, want := range map[string]string{"image": "images", "video": "video", "audio": "audio", "text": "custom"} {
		if got := normalizeWorkerMediaRequestMode("custom", category); got != want {
			t.Fatalf("category %s: got %q, want %q", category, got, want)
		}
	}
}

func TestParseUpstreamMediaReadsRawMP3Audio(t *testing.T) {
	body := append([]byte("ID3\x04\x00\x00\x00\x00\x00\x21TXXX=AIGC"), []byte("audio-audio-audio-audio-audio")...)

	items, upstreamID := parseUpstreamMedia(body)
	if upstreamID != "" {
		t.Fatalf("upstreamID = %q", upstreamID)
	}
	if len(items) != 1 {
		t.Fatalf("items = %#v", items)
	}
	if items[0].MimeType != "audio/mpeg" {
		t.Fatalf("mime = %q", items[0].MimeType)
	}
	data, contentType, err := decodeEncodedMedia(items[0].B64JSON, items[0].MimeType, "audio")
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "audio/mpeg" {
		t.Fatalf("contentType = %q", contentType)
	}
	if string(data[:3]) != "ID3" {
		t.Fatalf("decoded head = %q", string(data[:3]))
	}
}

func TestParseUpstreamMediaReadsAliyunNestedAudioURL(t *testing.T) {
	body := []byte(`{"output":{"audio":{"data":"","expires_at":1774936147,"id":"audio_1","url":"https://example.com/result.mp3"},"finish_reason":"stop"},"request_id":"req_1"}`)

	items, upstreamID := parseUpstreamMedia(body)
	if upstreamID != "req_1" {
		t.Fatalf("upstreamID = %q, want req_1", upstreamID)
	}
	if len(items) != 1 || items[0].URL != "https://example.com/result.mp3" {
		t.Fatalf("items = %#v", items)
	}
}

func TestSameOriginURLProtectsAuthorizationHeader(t *testing.T) {
	if !sameOriginURL("https://dashscope.aliyuncs.com/api/v1/tasks/1", "https://dashscope.aliyuncs.com/api/v1") {
		t.Fatal("same DashScope origin should be authenticated")
	}
	if sameOriginURL("https://dashscope-result.oss-cn-beijing.aliyuncs.com/result.mp3?signature=x", "https://dashscope.aliyuncs.com/api/v1") {
		t.Fatal("signed OSS result URL must not receive the upstream authorization header")
	}
}

func TestJoinBaseEndpointNormalizesMissingSlash(t *testing.T) {
	got := joinBaseEndpoint("https://api.minimax.cn/", "v1/music_generation")
	if got != "https://api.minimax.cn/v1/music_generation" {
		t.Fatalf("url = %q", got)
	}
}

func TestJoinBaseEndpointDoesNotDuplicateVersionPrefix(t *testing.T) {
	for _, test := range []struct{ baseURL, endpoint, want string }{
		{"https://tokenhub.tencentmaas.com/v1", "/v1/images/generations", "https://tokenhub.tencentmaas.com/v1/images/generations"},
		{"https://dashscope.aliyuncs.com/api/v1", "/api/v1/services/aigc/video-generation/video-synthesis", "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"},
		{"https://example.com/v1beta", "/v1beta/models/test:generateContent", "https://example.com/v1beta/models/test:generateContent"},
		{"https://example.com/v1/images/generations", "/v1/images/generations", "https://example.com/v1/images/generations"},
	} {
		if got := joinBaseEndpoint(test.baseURL, test.endpoint); got != test.want {
			t.Fatalf("joinBaseEndpoint(%q, %q) = %q, want %q", test.baseURL, test.endpoint, got, test.want)
		}
	}
}

func TestUnwrapUpstreamBodySupportsNestedTask(t *testing.T) {
	got := unwrapUpstreamBody(map[string]interface{}{
		"request_id": "req-1",
		"task": map[string]interface{}{
			"id":     "task-1",
			"status": "succeeded",
			"content": map[string]interface{}{
				"url": "https://example.com/result.mp4",
			},
		},
	})
	if got["status"] != "succeeded" || got["id"] != "task-1" {
		t.Fatalf("nested task was not unwrapped: %#v", got)
	}
	items := extractMediaItems(got)
	if len(items) != 1 || items[0].URL != "https://example.com/result.mp4" {
		t.Fatalf("nested task media not extracted: %#v", items)
	}
}

func TestUnwrapUpstreamBodyPrefersDeepTaskStatus(t *testing.T) {
	got := unwrapUpstreamBody(map[string]interface{}{
		"status":   "processing",
		"progress": 28,
		"data": map[string]interface{}{
			"task": map[string]interface{}{
				"status":    "completed",
				"progress":  100,
				"video_url": "https://example.com/result.mp4",
			},
		},
	})
	if got["status"] != "completed" || got["progress"] != 100 {
		t.Fatalf("deep task status was not preferred: %#v", got)
	}
	if got["video_url"] != "https://example.com/result.mp4" {
		t.Fatalf("deep task media was not unwrapped: %#v", got)
	}
}

func TestUpstreamRequestTimeoutSupportsAudioAndOverride(t *testing.T) {
	if got := upstreamRequestTimeout(nil, true); got != 15*time.Minute {
		t.Fatalf("audio timeout = %s", got)
	}
	got := upstreamRequestTimeout(map[string]interface{}{
		"upstream": map[string]interface{}{"request_timeout_sec": float64(900)},
	}, true)
	if got != 15*time.Minute {
		t.Fatalf("override timeout = %s", got)
	}
}

func TestFirstSuccessMediaURLAcceptsSameOriginContentFromFailReason(t *testing.T) {
	raw := map[string]interface{}{
		"status":      "SUCCESS",
		"fail_reason": "https://otuapi.com/v1/videos/task_content/content",
	}
	conn := connectionConfig{BaseURL: "https://otuapi.com"}

	got := firstSuccessMediaURL(raw, "task_original", conn)
	if got != "https://otuapi.com/v1/videos/task_original/content" {
		t.Fatalf("media url = %q", got)
	}
}

func TestBuildMediaDownloadCandidatesPreferOriginalTaskID(t *testing.T) {
	conn := connectionConfig{BaseURL: "https://otuapi.com"}
	got := buildMediaDownloadCandidates(conn, "https://otuapi.com/v1/videos/task_wrong/content", "task_original")

	want := []string{
		"https://otuapi.com/v1/videos/task_original/content",
		"https://otuapi.com/v1/videos/task_wrong/content",
	}
	if len(got) != len(want) {
		t.Fatalf("candidates = %#v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("candidate[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestShouldNotMirrorPublicCDNMediaURL(t *testing.T) {
	conn := connectionConfig{BaseURL: "https://otuapi.com"}

	if shouldMirrorMediaURL("https://oss-us.file-download.life/2026/06/13/video.mp4", conn) {
		t.Fatal("public CDN mp4 should be used directly instead of mirrored through /content")
	}
	if !shouldMirrorMediaURL("https://otuapi.com/v1/videos/task_original/content", conn) {
		t.Fatal("same-origin /content url should be mirrored")
	}
}

func TestHardDownload404(t *testing.T) {
	body := []byte(`{"error":{"message":"Task not found","type":"invalid_request_error"}}`)
	if !isHardDownload404(404, body) {
		t.Fatal("Task not found 404 should switch candidates without retrying")
	}
	if isHardDownload404(404, []byte(`{"error":{"message":"not ready"}}`)) {
		t.Fatal("generic 404 can still be transient")
	}
}

func TestParsePollConfigCorrectsLegacySoraVideosPath(t *testing.T) {
	cfg := parsePollConfig(map[string]interface{}{
		"upstream": map[string]interface{}{
			"poll_path": "/v1/video/generations/{id}",
		},
	}, "/v1/videos")

	if cfg.Path != "/v1/videos/{id}" {
		t.Fatalf("poll path = %q", cfg.Path)
	}
}

func TestUpstreamErrorMessageHumanizesUnsafePrompt(t *testing.T) {
	body := []byte(`{"code":"upstream_error","message":"The provided prompt is considered unsafe and it cannot be used to generate content."}`)

	got := upstreamErrorMessage(body)
	if got != "生成内容未通过上游安全审核，请修改提示词或参考素材后重试（避免武器、暴力、敏感人物、侵权或受限内容）" {
		t.Fatalf("message = %q", got)
	}
}

func TestHumanizeUpstreamFailureHandlesAsyncModerationBlock(t *testing.T) {
	got := humanizeUpstreamFailure("content blocked by moderation")
	want := "生成内容未通过上游安全审核，请修改提示词或参考素材后重试（避免武器、暴力、敏感人物、侵权或受限内容）"
	if got != want {
		t.Fatalf("message = %q, want %q", got, want)
	}
}

func TestHumanizeUpstreamFailureExplainsNetworkTimeouts(t *testing.T) {
	for input, want := range map[string]string{
		`Post "https://example.com": net/http: TLS handshake timeout`:                "连接上游时 TLS 握手超时，请检查服务器到上游的网络或代理",
		`context deadline exceeded (Client.Timeout exceeded while awaiting headers)`: "等待上游响应超时；请求可能仍在生成，请检查上游网关超时设置",
		`所有可用线路均调用失败：upstream HTTP 502: error code: 502`:                             "上游网关转发失败（HTTP 502）：请求已到网关，但可能尚未到达模型供应商；请检查网关任务日志",
		`upstream HTTP 504: <!DOCTYPE html><title>504 Gateway Timeout</title>`:       "上游网关超时（HTTP 504/524），不是模型参数错误",
	} {
		if got := humanizeUpstreamFailure(input); got != want {
			t.Fatalf("humanizeUpstreamFailure(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestHumanizeUpstreamFailureExplainsMissingAsyncTask(t *testing.T) {
	want := "上游已接收任务，但后续查询时任务不存在（NOT_FOUND）。可重试当前片段；若再次出现，请切换视频线路或检查该线路的任务查询接口"
	for _, input := range []string{"NOT_FOUND", "Task not found"} {
		if got := humanizeUpstreamFailure(input); got != want {
			t.Fatalf("humanizeUpstreamFailure(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestUpstreamErrorMessageReadsBaseResp(t *testing.T) {
	body := []byte(`{"data":null,"trace_id":"x","base_resp":{"status_code":1008,"status_msg":"insufficient balance"}}`)

	got := upstreamErrorMessage(body)
	want := "上游模型账户余额不足，请检查或更换可用渠道"
	if got != want {
		t.Fatalf("message = %q, want %q", got, want)
	}
}
