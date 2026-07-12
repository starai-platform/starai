package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"github.com/starai/worker/internal/storage"
	"github.com/starai/worker/videoparams"
)

var objectStore storage.Store

const (
	TypeImageTask    = "image:generate"
	TypeWorkflowTask = "workflow:run"
)

type ImageTaskPayload struct {
	TaskNo    string                 `json:"task_no"`
	UserID    int64                  `json:"user_id"`
	ModelID   int64                  `json:"model_id"`
	ModelCode string                 `json:"model_code"`
	Input     map[string]interface{} `json:"input"`
}

type WorkflowTaskPayload struct {
	ProjectID int64 `json:"project_id"`
	UserID    int64 `json:"user_id"`
}

func main() {
	_ = godotenv.Load("../../.env.local", "../../.env", ".env.local", ".env")
	dbURL := getenv("DATABASE_URL", "postgres://starai:starai@localhost:5432/starai?sslmode=disable")
	redisURL := getenv("REDIS_URL", "redis://localhost:6379/0")
	newAPIBase := getenv("NEW_API_BASE_URL", "http://localhost:3002")
	newAPIToken := getenv("NEW_API_TOKEN", "sk-platform-internal-token")
	appEnv := getenv("APP_ENV", "development")
	baseURL := getenv("BASE_URL", "")
	localStoragePublicURL, localStoragePublicErr := configuredLocalStoragePublicURL(appEnv, baseURL, getenv("LOCAL_STORAGE_PUBLIC_URL", ""))

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	storageCfg := storage.LoadConfig(ctx, pool, storage.Config{
		Provider:  "minio",
		Endpoint:  getenv("MINIO_ENDPOINT", "localhost:9000"),
		AccessKey: getenv("MINIO_ACCESS_KEY", "starai"),
		SecretKey: getenv("MINIO_SECRET_KEY", "starai123"),
		Bucket:    getenv("MINIO_BUCKET", "starai-works"),
		PublicURL: getenv("MINIO_PUBLIC_URL", "http://localhost:9000"),
		UseSSL:    getenv("MINIO_USE_SSL", "false") == "true",
	})
	if storageCfg.Provider == "local" {
		storeErr := localStoragePublicErr
		var store storage.Store
		if storeErr == nil {
			store, storeErr = storage.NewLocal("", localStoragePublicURL)
		}
		if storeErr != nil {
			log.Printf("local storage init warning: %v", storeErr)
		} else {
			objectStore = store
		}
	} else {
		store, storeErr := storage.New(
			storageCfg.Endpoint,
			storageCfg.AccessKey,
			storageCfg.SecretKey,
			storageCfg.Bucket,
			storageCfg.PublicURL,
			storageCfg.UseSSL,
		)
		if storeErr != nil {
			log.Printf("object storage init warning: %v, falling back to local uploads", storeErr)
			localErr := localStoragePublicErr
			var localStore storage.Store
			if localErr == nil {
				localStore, localErr = storage.NewLocal("", localStoragePublicURL)
			}
			if localErr != nil {
				log.Printf("local storage init warning: %v", localErr)
			} else {
				objectStore = localStore
			}
		} else {
			objectStore = store
		}
	}

	redisOpt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		log.Fatal(err)
	}
	startWorkerHeartbeat(ctx, redisURL)

	srv := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: 5,
		Queues:      map[string]int{"image": 3, "workflow": 2, "default": 1},
	})

	mux := asynq.NewServeMux()
	mux.HandleFunc(TypeImageTask, func(ctx context.Context, t *asynq.Task) error {
		var payload ImageTaskPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil {
			return err
		}
		return processImageTask(ctx, pool, newAPIBase, newAPIToken, payload)
	})
	mux.HandleFunc(TypeWorkflowTask, func(ctx context.Context, t *asynq.Task) error {
		var payload WorkflowTaskPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil {
			return err
		}
		return processWorkflowTask(ctx, pool, newAPIBase, newAPIToken, payload)
	})

	log.Println("StarAI Worker started")
	if err := srv.Run(mux); err != nil {
		log.Fatal(err)
	}
}

func startWorkerHeartbeat(ctx context.Context, redisURL string) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("worker heartbeat disabled: %v", err)
		return
	}
	client := redis.NewClient(opt)
	write := func() {
		if err := client.Set(ctx, "worker:heartbeat", time.Now().Format(time.RFC3339), 2*time.Minute).Err(); err != nil {
			log.Printf("worker heartbeat failed: %v", err)
		}
	}
	write()
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				_ = client.Close()
				return
			case <-ticker.C:
				write()
			}
		}
	}()
}

func processImageTask(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p ImageTaskPayload) error {
	var err error
	pool.Exec(ctx, `UPDATE tasks SET status='running', started_at=now(), updated_at=now() WHERE task_no=$1`, p.TaskNo)

	var requestMode, endpoint, newAPIModel string
	var extraParamsRaw, runtimeRuleRaw []byte
	var retentionDays int
	pool.QueryRow(ctx, `SELECT request_mode, new_api_model, new_api_endpoint, new_api_extra_params, runtime_rule, retention_days FROM models WHERE id=$1`, p.ModelID).
		Scan(&requestMode, &newAPIModel, &endpoint, &extraParamsRaw, &runtimeRuleRaw, &retentionDays)
	isVideo := requestMode == "video"
	isAudio := requestMode == "audio"
	isImage := !isVideo && !isAudio

	runtimeRule := videoparams.ParseRuntimeRuleJSON(runtimeRuleRaw)
	extraParams := videoparams.ParseExtraParamsJSON(extraParamsRaw)
	conn := parseConnection(extraParams, baseURL, token)
	prompt, _ := p.Input["prompt"].(string)
	workPrompt := prompt
	if rawUserPrompt, ok := p.Input["user_prompt"].(string); ok && strings.TrimSpace(rawUserPrompt) != "" {
		workPrompt = rawUserPrompt
	}
	if isVideo || isImage {
		prompt = applyGenerationLanguage(prompt, p.Input)
		p.Input["prompt"] = prompt
	}

	var body []byte
	generationCount := 1
	if isVideo {
		if endpoint == "" {
			endpoint = "/v1/video/generations"
		}
		payload := videoparams.BuildUpstreamVideoPayload(p.ModelCode, newAPIModel, runtimeRule, extraParams, p.Input)
		payload = videoparams.SanitizeUpstreamPayload(payload, endpoint)
		body, _ = json.Marshal(payload)
	} else if isAudio {
		if endpoint == "" {
			endpoint = "/v1/audio/speech"
		}
		payload := videoparams.BuildUpstreamVideoPayload(p.ModelCode, newAPIModel, runtimeRule, extraParams, p.Input)
		body, _ = json.Marshal(payload)
	} else {
		if endpoint == "" {
			endpoint = "/v1/images/generations"
		}
		if v, ok := p.Input["n"].(float64); ok {
			generationCount = int(v)
		} else if v, ok := p.Input["count"].(float64); ok {
			generationCount = int(v)
		}
		if generationCount < 1 {
			generationCount = 1
		}
		if generationCount > 50 {
			generationCount = 50
		}
		resolveImageGenerationInput(p.Input, runtimeRule, endpoint, newAPIModel)
		persistTaskInput(ctx, pool, p.TaskNo, p.Input)
		if isGeminiNativeImageAPI(endpoint, newAPIModel) {
			imgBody := buildGeminiNativeImagePayload(ctx, newAPIModel, p.ModelCode, prompt, p.Input)
			body, _ = json.Marshal(imgBody)
		} else if isVideoImageAPI(endpoint, newAPIModel) {
			imgBody := buildVideoImagePayload(ctx, runtimeRule, endpoint, newAPIModel, p.ModelCode, prompt, p.Input)
			body, _ = json.Marshal(imgBody)
		} else {
			size, _ := p.Input["size"].(string)
			if size == "" {
				size = "1024x1024"
			}
			imgBody := map[string]interface{}{
				"model": newAPIModel, "prompt": prompt, "n": generationCount, "size": size,
			}
			if imgBody["model"] == "" {
				imgBody["model"] = p.ModelCode
			}
			if v, ok := p.Input["aspect_ratio"]; ok {
				imgBody["aspect_ratio"] = v
			}
			if refs, ok := p.Input["reference_images"]; ok {
				imgBody["image"] = normalizeReferenceImages(ctx, refs)
			}
			body, _ = json.Marshal(imgBody)
		}
	}

	var payloadMap map[string]interface{}
	_ = json.Unmarshal(body, &payloadMap)
	if isVideo {
		payloadMap = videoparams.SanitizeUpstreamPayload(payloadMap, endpoint)
	}
	normalizePayloadMedia(ctx, payloadMap, endpoint)

	var respBody []byte
	var statusCode int
	var resultData []mediaItem
	var upstreamID string
	if isImage && isVideoImageAPI(endpoint, newAPIModel) {
		resultData, upstreamID, err = runBananaImageBatch(ctx, pool, conn, endpoint, payloadMap, runtimeRule, p.TaskNo, generationCount)
		if err != nil {
			log.Printf("Task %s banana image batch failed: %v", p.TaskNo, err)
			return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", err.Error())
		}
		if upstreamID != "" {
			pool.Exec(ctx, `UPDATE tasks SET upstream_task_id=$1, updated_at=now() WHERE task_no=$2`, upstreamID, p.TaskNo)
		}
	} else if isVideo {
		respBody, statusCode, err = postVideoUpstream(ctx, conn, endpoint, payloadMap, p.TaskNo)
	} else {
		body, _ = json.Marshal(payloadMap)
		respBody, statusCode, err = doJSONRequestWithLimit(ctx, conn, "POST", joinBaseEndpoint(conn.BaseURL, resolveModelEndpoint(endpoint, newAPIModel)), body, upstreamRequestTimeout(runtimeRule, isAudio), 96<<20)
	}
	if err != nil {
		return failTask(ctx, pool, p, "MODEL_TIMEOUT", "生成超时，请重试")
	}
	if statusCode >= 400 {
		msg := upstreamErrorMessage(respBody)
		if statusCode == 524 {
			msg = "上游网关超时(524)，参考图过大或上游繁忙，请换小图或稍后重试"
		}
		log.Printf("Task %s upstream error %d: %s", p.TaskNo, statusCode, truncateText(string(respBody), 800))
		return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", msg)
	}

	if !(isImage && isVideoImageAPI(endpoint, newAPIModel)) {
		resultData, upstreamID = parseUpstreamMedia(respBody)
		if upstreamID != "" {
			pool.Exec(ctx, `UPDATE tasks SET upstream_task_id=$1, updated_at=now() WHERE task_no=$2`, upstreamID, p.TaskNo)
		}
		if len(resultData) == 0 && upstreamID != "" {
			pollCfg := parsePollConfig(runtimeRule, endpoint)
			log.Printf("Task %s upstream async id=%s poll=%s interval=%s timeout=%s", p.TaskNo, upstreamID, pollCfg.Path, pollCfg.Interval, pollCfg.Timeout)
			resultData, err = pollUpstreamTask(ctx, pool, conn, pollCfg, upstreamID, p.TaskNo)
			if err != nil {
				log.Printf("Task %s poll failed: %v", p.TaskNo, err)
				return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", err.Error())
			}
		}
	}
	if len(resultData) == 0 {
		log.Printf("Task %s empty upstream result: %s", p.TaskNo, truncateText(string(respBody), 500))
		msg := upstreamErrorMessage(respBody)
		if msg == "" || msg == "模型服务异常" {
			if isVideo {
				msg = "生成完成但未返回可用视频地址，请检查视频模型接口返回字段或轮询配置"
			} else if isAudio {
				msg = "生成完成但未返回可用音频地址"
			} else {
				msg = "生成完成但未返回可用图片地址"
			}
		}
		return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", msg)
	}

	var taskID int64
	var estimated float64
	pool.QueryRow(ctx, `SELECT id, estimated_cost FROM tasks WHERE task_no=$1`, p.TaskNo).Scan(&taskID, &estimated)
	actualCost := estimated

	var output, meta []byte
	workType := "image"
	thumbnail := resultData[0].URL
	if isVideo {
		workType = "video"
		videos := make([]map[string]string, 0, len(resultData))
		for i, item := range resultData {
			videoURL := strings.TrimSpace(item.URL)
			if videoURL == "" {
				continue
			}
			contentURL := ""
			if strings.Contains(strings.ToLower(videoURL), "/content") {
				contentURL = videoURL
			}
			if stored, err := mirrorUpstreamMedia(ctx, conn, videoURL, upstreamID, fmt.Sprintf("%s_%d", p.TaskNo, i+1), "video"); err != nil {
				if shouldMirrorMediaURL(videoURL, conn) {
					log.Printf("Task %s mirror video #%d failed: %v", p.TaskNo, i+1, err)
					return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", err.Error())
				}
				log.Printf("Task %s skip mirror for public url: %s", p.TaskNo, truncateText(videoURL, 100))
			} else if stored != "" {
				videoURL = stored
			}
			itemThumb := strings.TrimSpace(item.Thumbnail)
			if itemThumb == "" {
				itemThumb = videoURL
			}
			video := map[string]string{"url": videoURL, "thumbnail": itemThumb}
			if contentURL != "" && contentURL != videoURL {
				video["upstream_content_url"] = contentURL
			}
			videos = append(videos, video)
		}
		if len(videos) == 0 {
			return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", "生成完成但未返回视频")
		}
		videoURL := videos[0]["url"]
		thumbnail = videos[0]["thumbnail"]
		if thumbnail == "" {
			thumbnail = videoURL
		}
		out := map[string]interface{}{"video_url": videoURL, "videos": videos, "thumbnail": thumbnail, "upstream_task_id": upstreamID}
		if contentURL := videos[0]["upstream_content_url"]; contentURL != "" {
			out["upstream_content_url"] = contentURL
		}
		output, _ = json.Marshal(out)
		meta, _ = json.Marshal(map[string]interface{}{"video_url": videoURL, "videos": videos, "thumbnail": thumbnail})
	} else if isAudio {
		workType = "audio"
		audioURL := resultData[0].URL
		if audioURL == "" && resultData[0].B64JSON != "" {
			stored, err := storeBase64MediaResult(ctx, p.TaskNo, 1, resultData[0].B64JSON, resultData[0].MimeType, "audio")
			if err != nil {
				log.Printf("Task %s store base64 audio failed: %v", p.TaskNo, err)
			} else {
				audioURL = stored
			}
			if audioURL == "" {
				audioURL = normalizeAudioResultURL(resultData[0].B64JSON, resultData[0].MimeType)
			}
		}
		if audioURL == "" {
			return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", "生成完成但未返回可用音频地址")
		}
		thumbnail = audioURL
		output, _ = json.Marshal(map[string]interface{}{"audio_url": audioURL, "upstream_task_id": upstreamID})
		meta, _ = json.Marshal(map[string]interface{}{"audio_url": audioURL})
	} else {
		images := make([]map[string]string, 0, len(resultData))
		for idx, item := range resultData {
			url := normalizeImageResultURL(item.URL, item.B64JSON)
			if item.B64JSON != "" {
				if stored, err := storeBase64MediaResult(ctx, p.TaskNo, idx+1, item.B64JSON, item.MimeType, "image"); err != nil {
					log.Printf("Task %s store base64 image #%d failed: %v", p.TaskNo, idx+1, err)
				} else if stored != "" {
					url = stored
				}
			}
			if url == "" {
				continue
			}
			images = append(images, map[string]string{"url": url})
		}
		if len(images) == 0 {
			return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", "生成完成但未返回图片")
		}
		imageURL := images[0]["url"]
		output, _ = json.Marshal(map[string]interface{}{"image_url": imageURL, "images": images, "upstream_task_id": upstreamID})
		meta, _ = json.Marshal(map[string]interface{}{"image_url": imageURL})
	}

	txType, remark := "image_usage", "图片生成"
	if isVideo {
		txType, remark = "video_usage", "视频生成"
	} else if isAudio {
		txType, remark = "audio_usage", "音频生成"
	}
	if !boolInput(p.Input, "_skip_billing") {
		if err := chargeBilling(ctx, pool, p.UserID, estimated, actualCost, "task", p.TaskNo, txType, remark); err != nil {
			return fmt.Errorf("task %s billing: %w", p.TaskNo, err)
		}
	}

	if _, err := pool.Exec(ctx, `
		UPDATE tasks SET status='succeeded', output=$1, actual_cost=$2, error_code=NULL, error_message=NULL, finished_at=now(), updated_at=now() WHERE task_no=$3`,
		output, actualCost, p.TaskNo); err != nil {
		return fmt.Errorf("task %s finalize: %w", p.TaskNo, err)
	}

	publicID := fmt.Sprintf("work_%d", time.Now().UnixNano())
	var expires *time.Time
	if retentionDays > 0 {
		t := time.Now().Add(time.Duration(retentionDays) * 24 * time.Hour)
		expires = &t
	}
	pool.Exec(ctx, `
		INSERT INTO works (public_id, user_id, task_id, model_id, type, prompt, thumbnail_url, metadata, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		publicID, p.UserID, taskID, p.ModelID, workType, workPrompt, thumbnail, meta, expires)

	pool.Exec(ctx, `INSERT INTO task_events (task_id, event_type, payload) VALUES ($1,'completed',$2)`,
		taskID, output)

	workLabel := map[string]string{"image": "图片", "video": "视频", "audio": "音频"}[workType]
	if workLabel == "" {
		workLabel = "作品"
	}
	insertNotification(ctx, pool, p.UserID, "生成完成",
		fmt.Sprintf("您的%s任务已完成，任务号：%s", workLabel, p.TaskNo), "task")

	log.Printf("Task %s completed", p.TaskNo)
	return nil
}

func boolInput(m map[string]interface{}, key string) bool {
	v, ok := m[key]
	if !ok {
		return false
	}
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(strings.TrimSpace(t), "true") || strings.TrimSpace(t) == "1"
	default:
		return false
	}
}

type connectionConfig struct {
	BaseURL      string
	APIKey       string
	AuthType     string
	APIKeyHeader string
	Headers      map[string]string
}

func parseConnection(extra map[string]interface{}, fallbackBaseURL, fallbackToken string) connectionConfig {
	cfg := connectionConfig{BaseURL: trimRightSlash(fallbackBaseURL), APIKey: fallbackToken, AuthType: "bearer", APIKeyHeader: "Authorization", Headers: map[string]string{}}
	conn, _ := extra["connection"].(map[string]interface{})
	if conn == nil {
		return cfg
	}
	if s, ok := conn["base_url"].(string); ok && s != "" {
		cfg.BaseURL = trimRightSlash(s)
	}
	if s, ok := conn["api_key"].(string); ok {
		cfg.APIKey = s
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

func applyConnectionHeaders(req *http.Request, cfg connectionConfig) {
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

func trimRightSlash(s string) string {
	for len(s) > 1 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}

func joinBaseEndpoint(baseURL, endpoint string) string {
	baseURL = trimRightSlash(strings.TrimSpace(baseURL))
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
	return baseURL + endpoint
}

func upstreamRequestTimeout(runtimeRule map[string]interface{}, isAudio bool) time.Duration {
	if up, _ := runtimeRule["upstream"].(map[string]interface{}); up != nil {
		for _, key := range []string{"request_timeout_sec", "timeout_sec"} {
			if d := secondsFromAny(up[key]); d > 0 {
				if d > 30*time.Minute {
					return 30 * time.Minute
				}
				return d
			}
		}
	}
	if isAudio {
		return 15 * time.Minute
	}
	return 90 * time.Second
}

func normalizeImageResultURL(url, b64 string) string {
	url = strings.TrimSpace(url)
	if url != "" {
		return url
	}
	b64 = strings.TrimSpace(b64)
	if b64 == "" {
		return ""
	}
	if strings.HasPrefix(b64, "data:image/") {
		return b64
	}
	return "data:image/png;base64," + b64
}

func normalizeAudioResultURL(raw, contentType string) string {
	data, contentType, err := decodeEncodedMedia(raw, contentType, "audio")
	if err != nil || len(data) == 0 {
		return ""
	}
	contentType = normalizeMediaContentType(contentType, "audio")
	if contentType == "" {
		contentType = "audio/mpeg"
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)
}

func storeBase64ImageResult(ctx context.Context, taskNo string, idx int, raw string) (string, error) {
	return storeBase64MediaResult(ctx, taskNo, idx, raw, "", "image")
}

func storeBase64MediaResult(ctx context.Context, taskNo string, idx int, raw, contentType, kind string) (string, error) {
	if objectStore == nil {
		return "", nil
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	contentType = strings.TrimSpace(contentType)
	contentType = normalizeMediaContentType(contentType, kind)
	if contentType == "" {
		if kind == "audio" {
			contentType = "audio/mpeg"
		} else {
			contentType = "image/png"
		}
	}
	data, contentType, err := decodeEncodedMedia(raw, contentType, kind)
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", nil
	}
	if detected := http.DetectContentType(data); strings.HasPrefix(detected, kind+"/") {
		contentType = detected
	}
	if kind == "audio" && !validDownloadedMedia("audio", contentType, data) {
		return "", fmt.Errorf("invalid audio base64 content type=%s", contentType)
	}
	if kind == "image" && !validDownloadedMedia("image", contentType, data) {
		return "", fmt.Errorf("invalid image base64 content type=%s", contentType)
	}
	ext := mediaExtForContentType(contentType, kind)
	objectName := fmt.Sprintf("works/%s/%s/%d%s", kind, taskNo, idx, ext)
	return objectStore.Upload(ctx, objectName, contentType, bytes.NewReader(data), int64(len(data)))
}

func decodeEncodedMedia(raw, contentType, kind string) ([]byte, string, error) {
	raw = strings.TrimSpace(raw)
	contentType = normalizeMediaContentType(contentType, kind)
	if strings.HasPrefix(raw, "data:") {
		comma := strings.Index(raw, ",")
		if comma < 0 {
			return nil, "", fmt.Errorf("invalid data url")
		}
		meta := raw[:comma]
		raw = raw[comma+1:]
		if strings.HasPrefix(meta, "data:") {
			if semi := strings.Index(meta, ";"); semi > 5 {
				contentType = normalizeMediaContentType(meta[5:semi], kind)
			}
		}
	}
	if contentType == "" {
		if kind == "audio" {
			contentType = "audio/mpeg"
		} else {
			contentType = "image/png"
		}
	}
	if isHexEncodedMedia(raw) {
		if data, err := hex.DecodeString(raw); err == nil && validDownloadedMedia(kind, contentType, data) {
			return data, contentType, nil
		}
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, "", err
	}
	return data, contentType, nil
}

func isHexEncodedMedia(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) < 32 || len(s)%2 != 0 {
		return false
	}
	for _, r := range s {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

func normalizeMediaContentType(contentType, kind string) string {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if strings.Contains(ct, "/") {
		return contentType
	}
	if kind == "audio" {
		switch ct {
		case "mp3", "mpeg":
			return "audio/mpeg"
		case "wav", "wave":
			return "audio/wav"
		case "flac":
			return "audio/flac"
		case "ogg":
			return "audio/ogg"
		case "pcm":
			return "audio/pcm"
		}
	}
	if kind == "image" {
		switch ct {
		case "png":
			return "image/png"
		case "jpg", "jpeg":
			return "image/jpeg"
		case "webp":
			return "image/webp"
		case "gif":
			return "image/gif"
		}
	}
	return contentType
}

func imageExtForContentType(contentType string) string {
	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "jpeg"), strings.Contains(ct, "jpg"):
		return ".jpg"
	case strings.Contains(ct, "webp"):
		return ".webp"
	case strings.Contains(ct, "gif"):
		return ".gif"
	case strings.Contains(ct, "svg"):
		return ".svg"
	default:
		return ".png"
	}
}

func isBananaImageAPI(endpoint, model string) bool {
	model = strings.ToLower(strings.TrimSpace(model))
	endpoint = strings.TrimRight(strings.ToLower(strings.TrimSpace(endpoint)), "/")
	return endpoint == "/v1/videos" && strings.HasPrefix(model, "nano_banana")
}

func isGPTImageVideoAPI(endpoint, model string) bool {
	model = strings.ToLower(strings.TrimSpace(model))
	endpoint = strings.TrimRight(strings.ToLower(strings.TrimSpace(endpoint)), "/")
	return endpoint == "/v1/videos" && strings.HasPrefix(model, "gpt-image-2")
}

func isVideoImageAPI(endpoint, model string) bool {
	return isBananaImageAPI(endpoint, model) || isGPTImageVideoAPI(endpoint, model)
}

func isGeminiNativeImageAPI(endpoint, model string) bool {
	endpoint = strings.ToLower(strings.TrimSpace(endpoint))
	model = strings.ToLower(strings.TrimSpace(model))
	return strings.Contains(endpoint, ":generatecontent") || strings.Contains(endpoint, "/v1beta/models/") || strings.HasPrefix(model, "gemini-3")
}

func resolveModelEndpoint(endpoint, model string) string {
	if strings.Contains(endpoint, "{model}") {
		return strings.ReplaceAll(endpoint, "{model}", url.PathEscape(strings.TrimSpace(model)))
	}
	return endpoint
}

func buildVideoImagePayload(ctx context.Context, runtimeRule map[string]interface{}, endpoint, newAPIModel, fallbackModel, prompt string, input map[string]interface{}) map[string]interface{} {
	model := imageModelForSize(runtimeRule, endpoint, newAPIModel, fallbackModel, imageSizeTier(input))
	if model == "" {
		model = fallbackModel
	}
	payload := map[string]interface{}{
		"model":  model,
		"prompt": prompt,
	}
	if v, ok := input["aspect_ratio"]; ok {
		aspect := strings.TrimSpace(fmt.Sprint(v))
		if aspect != "" && !strings.EqualFold(aspect, "auto") {
			payload["aspect_ratio"] = aspect
		}
	}
	refs := collectBananaReferenceImages(ctx, input["reference_images"])
	if len(refs) == 0 {
		refs = collectBananaReferenceImages(ctx, input["images"])
	}
	if len(refs) == 0 {
		refs = collectBananaReferenceImages(ctx, input["image"])
	}
	if len(refs) > 5 {
		refs = refs[:5]
	}
	if len(refs) > 0 {
		payload["images"] = refs
	}
	return payload
}

func buildGeminiNativeImagePayload(ctx context.Context, newAPIModel, fallbackModel, prompt string, input map[string]interface{}) map[string]interface{} {
	model := strings.TrimSpace(newAPIModel)
	if model == "" {
		model = fallbackModel
	}
	parts := make([]map[string]interface{}, 0, 4)
	for _, ref := range collectBananaReferenceImages(ctx, input["reference_images"]) {
		if part := geminiImagePart(ref); len(part) > 0 {
			parts = append(parts, part)
		}
	}
	if len(parts) == 0 {
		for _, ref := range collectBananaReferenceImages(ctx, input["image"]) {
			if part := geminiImagePart(ref); len(part) > 0 {
				parts = append(parts, part)
			}
		}
	}
	parts = append(parts, map[string]interface{}{"text": prompt})
	imageConfig := map[string]interface{}{"aspectRatio": imageAspectRatio(input)}
	if strings.Contains(strings.ToLower(model), "gemini-3.1-flash-image-preview") {
		imageConfig["imageSize"] = imageSizeTier(input)
	}
	return map[string]interface{}{
		"contents": []map[string]interface{}{
			{"role": "user", "parts": parts},
		},
		"generationConfig": map[string]interface{}{
			"responseModalities": []string{"IMAGE"},
			"imageConfig":        imageConfig,
		},
	}
}

func geminiImagePart(src string) map[string]interface{} {
	src = strings.TrimSpace(src)
	if src == "" {
		return nil
	}
	if strings.HasPrefix(src, "data:image/") {
		comma := strings.Index(src, ",")
		semi := strings.Index(src, ";")
		if comma > 0 && semi > len("data:") {
			return map[string]interface{}{
				"inlineData": map[string]interface{}{
					"mimeType": src[len("data:"):semi],
					"data":     src[comma+1:],
				},
			}
		}
	}
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		return map[string]interface{}{"fileData": map[string]interface{}{"fileUri": src}}
	}
	return map[string]interface{}{"inlineData": map[string]interface{}{"mimeType": "image/png", "data": src}}
}

var standardImageSizes = map[string]map[string]string{
	"1:1":  {"1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880"},
	"16:9": {"1K": "1280x720", "2K": "2560x1440", "4K": "3840x2160"},
	"9:16": {"1K": "720x1280", "2K": "1440x2560", "4K": "2160x3840"},
	"3:2":  {"1K": "1248x832", "2K": "2496x1664", "4K": "3504x2336"},
	"2:3":  {"1K": "832x1248", "2K": "1664x2496", "4K": "2336x3504"},
	"4:3":  {"1K": "1152x864", "2K": "2304x1728", "4K": "3264x2448"},
	"3:4":  {"1K": "864x1152", "2K": "1728x2304", "4K": "2448x3264"},
	"5:4":  {"1K": "1120x896", "2K": "2240x1792", "4K": "3200x2560"},
	"4:5":  {"1K": "896x1120", "2K": "1792x2240", "4K": "2560x3200"},
	"7:3":  {"1K": "1456x624", "2K": "3024x1296", "4K": "3696x1584"},
	"3:7":  {"1K": "624x1456", "2K": "1296x3024", "4K": "1584x3696"},
	"21:9": {"1K": "1456x624", "2K": "3024x1296", "4K": "3696x1584"},
	"9:21": {"1K": "624x1456", "2K": "1296x3024", "4K": "1584x3696"},
	"2:1":  {"1K": "1440x720", "2K": "2880x1440", "4K": "3840x1920"},
	"1:2":  {"1K": "720x1440", "2K": "1440x2880", "4K": "1920x3840"},
	"3:1":  {"1K": "1440x480", "2K": "2880x960", "4K": "3840x1280"},
	"1:3":  {"1K": "480x1440", "2K": "960x2880", "4K": "1280x3840"},
}

func resolveImageGenerationInput(input map[string]interface{}, runtimeRule map[string]interface{}, endpoint, model string) {
	ratio := normalizeImageRatio(fmt.Sprint(input["aspect_ratio"]))
	supported := supportedImageRatios(runtimeRule, endpoint, model)
	if len(supported) > 0 && !stringInSlice(ratio, supported) {
		ratio = fallbackImageRatio(supported)
	}
	tier := normalizeImageSizeTier(fmt.Sprint(input["image_size"]))
	supportedSizes := supportedImageSizeTiers(runtimeRule)
	if len(supportedSizes) > 0 && !stringInSlice(tier, supportedSizes) {
		tier = supportedSizes[0]
	}
	size := imagePixelSize(ratio, tier)
	input["aspect_ratio"] = ratio
	input["image_size"] = tier
	input["size"] = size
	input["resolved_aspect_ratio"] = ratio
	input["resolved_image_size"] = tier
	input["resolved_size"] = size
}

func persistTaskInput(ctx context.Context, pool *pgxpool.Pool, taskNo string, input map[string]interface{}) {
	if input == nil {
		return
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return
	}
	_, _ = pool.Exec(ctx, `UPDATE tasks SET input=$1, updated_at=now() WHERE task_no=$2`, raw, taskNo)
}

func imageAspectRatio(input map[string]interface{}) string {
	return normalizeImageRatio(fmt.Sprint(input["aspect_ratio"]))
}

func imageSizeTier(input map[string]interface{}) string {
	return normalizeImageSizeTier(fmt.Sprint(input["image_size"]))
}

func normalizeImageRatio(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || strings.EqualFold(v, "auto") {
		return "1:1"
	}
	if _, ok := standardImageSizes[v]; ok {
		return v
	}
	return "1:1"
}

func normalizeImageSizeTier(v string) string {
	v = strings.ToUpper(strings.TrimSpace(v))
	switch v {
	case "2K", "4K":
		return v
	default:
		return "1K"
	}
}

func imagePixelSize(ratio, tier string) string {
	ratio = normalizeImageRatio(ratio)
	tier = normalizeImageSizeTier(tier)
	if byTier, ok := standardImageSizes[ratio]; ok {
		if size := byTier[tier]; size != "" {
			return size
		}
	}
	return "1024x1024"
}

func supportedImageRatios(runtimeRule map[string]interface{}, endpoint, model string) []string {
	if imageRule, ok := runtimeRule["image"].(map[string]interface{}); ok {
		if ratios := stringSlice(imageRule["supported_ratios"]); len(ratios) > 0 {
			return ratios
		}
	}
	endpoint = strings.TrimRight(strings.ToLower(strings.TrimSpace(endpoint)), "/")
	model = strings.ToLower(strings.TrimSpace(model))
	switch {
	case endpoint == "/v1/videos" && strings.HasPrefix(model, "nano_banana"):
		return []string{"1:1", "9:16", "16:9"}
	case endpoint == "/v1/videos" && strings.HasPrefix(model, "gpt-image-2"):
		return []string{"1:1", "5:4", "9:16", "21:9", "16:9", "3:2", "4:3", "4:5", "3:4", "2:3"}
	case isGeminiNativeImageAPI(endpoint, model):
		return []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}
	default:
		return nil
	}
}

func supportedImageSizeTiers(runtimeRule map[string]interface{}) []string {
	if imageRule, ok := runtimeRule["image"].(map[string]interface{}); ok {
		out := stringSlice(imageRule["supported_sizes"])
		if len(out) > 0 {
			normalized := make([]string, 0, len(out))
			for _, item := range out {
				normalized = append(normalized, normalizeImageSizeTier(item))
			}
			return normalized
		}
	}
	return nil
}

func fallbackImageRatio(supported []string) string {
	for _, preferred := range []string{"1:1", "16:9", "9:16"} {
		if stringInSlice(preferred, supported) {
			return preferred
		}
	}
	if len(supported) > 0 {
		return supported[0]
	}
	return "1:1"
}

func imageModelForSize(runtimeRule map[string]interface{}, endpoint, newAPIModel, fallbackModel, tier string) string {
	model := strings.TrimSpace(newAPIModel)
	if model == "" {
		model = fallbackModel
	}
	tier = normalizeImageSizeTier(tier)
	if imageRule, ok := runtimeRule["image"].(map[string]interface{}); ok {
		if bySize, ok := imageRule["model_by_size"].(map[string]interface{}); ok {
			if v := strings.TrimSpace(fmt.Sprint(bySize[tier])); v != "" && v != "<nil>" {
				return v
			}
		}
	}
	endpoint = strings.TrimRight(strings.ToLower(strings.TrimSpace(endpoint)), "/")
	lowerModel := strings.ToLower(strings.TrimSpace(model))
	if endpoint == "/v1/videos" && strings.HasPrefix(lowerModel, "nano_banana") {
		switch tier {
		case "2K":
			return "nano_banana_pro-2K"
		case "4K":
			return "nano_banana_pro-4K"
		default:
			return "nano_banana_pro-1K"
		}
	}
	if endpoint == "/v1/videos" && strings.HasPrefix(lowerModel, "gpt-image-2") {
		switch tier {
		case "2K":
			return "gpt-image-2-2K"
		case "4K":
			return "gpt-image-2-4K"
		default:
			return "gpt-image-2"
		}
	}
	return model
}

func stringSlice(v interface{}) []string {
	switch t := v.(type) {
	case []string:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s := strings.TrimSpace(item); s != "" {
				out = append(out, s)
			}
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s := strings.TrimSpace(fmt.Sprint(item)); s != "" && s != "<nil>" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func stringInSlice(v string, items []string) bool {
	for _, item := range items {
		if strings.EqualFold(strings.TrimSpace(item), strings.TrimSpace(v)) {
			return true
		}
	}
	return false
}

func collectBananaReferenceImages(ctx context.Context, refs interface{}) []string {
	normalized := normalizeReferenceImages(ctx, refs)
	switch v := normalized.(type) {
	case string:
		if s := strings.TrimSpace(v); s != "" {
			return []string{s}
		}
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s := strings.TrimSpace(item); s != "" {
				out = append(out, s)
			}
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s := strings.TrimSpace(fmt.Sprint(item)); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func runBananaImageBatch(ctx context.Context, pool *pgxpool.Pool, conn connectionConfig, endpoint string, payload map[string]interface{}, runtimeRule map[string]interface{}, taskNo string, count int) ([]mediaItem, string, error) {
	if count < 1 {
		count = 1
	}
	var all []mediaItem
	var upstreamIDs []string
	pollCfg := parsePollConfig(runtimeRule, endpoint)
	createEndpoint := resolveModelEndpoint(endpoint, strings.TrimSpace(fmt.Sprint(payload["model"])))
	for i := 0; i < count; i++ {
		body, _ := json.Marshal(payload)
		respBody, statusCode, err := doJSONRequest(ctx, conn, "POST", conn.BaseURL+createEndpoint, body, 90*time.Second)
		if err != nil {
			return nil, strings.Join(upstreamIDs, ","), err
		}
		if statusCode >= 400 {
			return nil, strings.Join(upstreamIDs, ","), fmt.Errorf("%s", upstreamErrorMessage(respBody))
		}
		items, upstreamID := parseUpstreamMedia(respBody)
		if upstreamID != "" {
			upstreamIDs = append(upstreamIDs, upstreamID)
		}
		if len(items) == 0 && upstreamID != "" {
			log.Printf("Task %s banana image #%d/%d async id=%s poll=%s", taskNo, i+1, count, upstreamID, pollCfg.Path)
			items, err = pollUpstreamTask(ctx, pool, conn, pollCfg, upstreamID, taskNo)
			if err != nil {
				return nil, strings.Join(upstreamIDs, ","), err
			}
		}
		if len(items) == 0 {
			return nil, strings.Join(upstreamIDs, ","), fmt.Errorf("生成完成但未返回图片")
		}
		all = append(all, items...)
		recordTaskProgress(ctx, pool, taskNo, "processing", fmt.Sprintf("%d", int(math.Round(float64(i+1)/float64(count)*100))))
	}
	return all, strings.Join(upstreamIDs, ","), nil
}

func normalizeReferenceImages(ctx context.Context, refs interface{}) interface{} {
	switch v := refs.(type) {
	case string:
		return normalizeReferenceImage(ctx, v)
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s := normalizeReferenceImage(ctx, item); s != "" {
				out = append(out, s)
			}
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				if normalized := normalizeReferenceImage(ctx, s); normalized != "" {
					out = append(out, normalized)
				}
			}
		}
		return out
	default:
		return refs
	}
}

func normalizeReferenceImage(ctx context.Context, src string) string {
	src = strings.TrimSpace(src)
	if src == "" || strings.HasPrefix(src, "data:image/") {
		return src
	}
	req, err := http.NewRequestWithContext(ctx, "GET", src, nil)
	if err != nil {
		return src
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return src
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return src
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/png"
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil || len(data) == 0 || len(data) > 10<<20 || !strings.HasPrefix(contentType, "image/") {
		return src
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)
}

type mediaItem struct {
	URL       string
	B64JSON   string
	MimeType  string
	Thumbnail string
}

type pollConfig struct {
	Path     string
	Interval time.Duration
	Timeout  time.Duration
}

func normalizePayloadMedia(ctx context.Context, payload map[string]interface{}, endpoint string) {
	videoAPI := strings.Contains(endpoint, "/v1/videos")
	for _, key := range []string{"image", "image_url", "images", "reference_images", "first_frame", "last_frame", "reference_audio"} {
		v, ok := payload[key]
		if !ok || v == nil {
			continue
		}
		// Sora /v1/videos：image_url 必须是公网 URL 或改走 multipart，禁止塞入巨型 base64 JSON
		if videoAPI && (key == "image_url" || key == "image") {
			if s := collapseMediaToString(v); s != "" {
				payload[key] = s
			}
			continue
		}
		normalized := normalizeReferenceImages(ctx, v)
		if key == "image" || key == "image_url" || key == "first_frame" || key == "last_frame" {
			if arr, ok := normalized.([]string); ok && len(arr) == 1 {
				payload[key] = arr[0]
				continue
			}
			if s, ok := normalized.(string); ok {
				payload[key] = s
				continue
			}
		}
		payload[key] = normalized
	}
}

func collapseMediaToString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case []string:
		if len(t) > 0 {
			return strings.TrimSpace(t[0])
		}
	case []interface{}:
		if len(t) > 0 {
			return strings.TrimSpace(fmt.Sprint(t[0]))
		}
	}
	return ""
}

// postVideoUpstream uses JSON (public image_url) or multipart (local/private reference file).
func postVideoUpstream(ctx context.Context, conn connectionConfig, endpoint string, payload map[string]interface{}, taskNo string) ([]byte, int, error) {
	target := conn.BaseURL + endpoint
	refURL := ""
	if s, ok := payload["image_url"].(string); ok {
		refURL = strings.TrimSpace(s)
	}
	useMultipart := refURL != "" && (strings.HasPrefix(refURL, "data:") || isPrivateMediaURL(refURL))
	if useMultipart {
		fileData, contentType, err := loadMediaBytes(ctx, refURL)
		if err != nil {
			return nil, 0, err
		}
		if len(fileData) == 0 {
			return nil, 0, fmt.Errorf("参考图读取失败")
		}
		delete(payload, "image_url")
		delete(payload, "image")
		delete(payload, "reference_images")
		log.Printf("Task %s video upstream multipart POST %s fields=%v fileBytes=%d", taskNo, target, payloadFieldKeys(payload), len(fileData))
		respBody, statusCode, err := doMultipartRequest(ctx, conn, target, payload, "input_reference", fileNameForMIME(contentType), fileData, contentType, 3*time.Minute)
		log.Printf("Task %s video upstream multipart response %d: %s", taskNo, statusCode, truncateText(string(respBody), 500))
		return respBody, statusCode, err
	}
	body, _ := json.Marshal(payload)
	log.Printf("Task %s video upstream JSON POST %s body=%s", taskNo, target, truncateText(string(body), 800))
	respBody, statusCode, err := doJSONRequest(ctx, conn, "POST", target, body, 3*time.Minute)
	log.Printf("Task %s video upstream JSON response %d: %s", taskNo, statusCode, truncateText(string(respBody), 500))
	return respBody, statusCode, err
}

func payloadFieldKeys(payload map[string]interface{}) []string {
	keys := make([]string, 0, len(payload))
	for k := range payload {
		keys = append(keys, k)
	}
	return keys
}

func isPrivateMediaURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	if strings.HasPrefix(raw, "data:") {
		return true
	}
	u, err := url.Parse(raw)
	if err != nil {
		return true
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "minio" {
		return true
	}
	if strings.HasPrefix(host, "192.168.") || strings.HasPrefix(host, "10.") || strings.HasPrefix(host, "172.") {
		return true
	}
	return false
}

func loadMediaBytes(ctx context.Context, src string) ([]byte, string, error) {
	src = strings.TrimSpace(src)
	if strings.HasPrefix(src, "data:") {
		comma := strings.Index(src, ",")
		if comma < 0 {
			return nil, "", fmt.Errorf("invalid data url")
		}
		meta := src[5:comma]
		contentType := "image/jpeg"
		if semi := strings.Index(meta, ";"); semi >= 0 {
			contentType = meta[:semi]
		} else if meta != "" {
			contentType = meta
		}
		raw, err := base64.StdEncoding.DecodeString(src[comma+1:])
		return raw, contentType, err
	}
	req, err := http.NewRequestWithContext(ctx, "GET", src, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("参考图下载失败 HTTP %d", resp.StatusCode)
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 15<<20))
	return data, contentType, err
}

func fileNameForMIME(contentType string) string {
	switch {
	case strings.Contains(contentType, "png"):
		return "reference.png"
	case strings.Contains(contentType, "webp"):
		return "reference.webp"
	default:
		return "reference.jpg"
	}
}

func doMultipartRequest(ctx context.Context, conn connectionConfig, target string, fields map[string]interface{}, fileField, fileName string, fileData []byte, contentType string, timeout time.Duration) ([]byte, int, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = w.WriteField(k, fmt.Sprint(v))
	}
	fw, err := w.CreateFormFile(fileField, fileName)
	if err != nil {
		return nil, 0, err
	}
	if _, err := fw.Write(fileData); err != nil {
		return nil, 0, err
	}
	_ = w.Close()

	req, err := http.NewRequestWithContext(ctx, "POST", target, &buf)
	if err != nil {
		return nil, 0, err
	}
	applyConnectionHeaders(req, conn)
	req.Header.Set("Content-Type", w.FormDataContentType())
	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	return respBody, resp.StatusCode, err
}

func doJSONRequest(ctx context.Context, conn connectionConfig, method, reqURL string, body []byte, timeout time.Duration) ([]byte, int, error) {
	return doJSONRequestWithLimit(ctx, conn, method, reqURL, body, timeout, 8<<20)
}

func doJSONRequestWithLimit(ctx context.Context, conn connectionConfig, method, reqURL string, body []byte, timeout time.Duration, maxBytes int64) ([]byte, int, error) {
	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, reqURL, reader)
	if err != nil {
		return nil, 0, err
	}
	applyConnectionHeaders(req, conn)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: timeout}
	if timeout <= 0 {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	if maxBytes <= 0 {
		maxBytes = 8 << 20
	}
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err == nil && int64(len(respBody)) > maxBytes {
		return respBody, resp.StatusCode, fmt.Errorf("上游响应超过大小限制(%dMB)", maxBytes>>20)
	}
	return respBody, resp.StatusCode, err
}

func parseUpstreamMedia(body []byte) ([]mediaItem, string) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		if item, ok := rawAudioMediaItem(body); ok {
			return []mediaItem{item}, ""
		}
		return nil, ""
	}
	raw = unwrapUpstreamBody(raw)
	items := extractMediaItems(raw)
	upstreamID := scalarString(raw, "task_id", "taskId", "generation_id", "request_id", "id")
	if len(items) > 0 {
		return items, upstreamID
	}
	// otuapi 等网关：异步任务 ID 在 task_id，顶层 id 常为数字记录号
	return nil, upstreamID
}

func rawAudioMediaItem(body []byte) (mediaItem, bool) {
	if len(body) < 8 {
		return mediaItem{}, false
	}
	contentType := detectRawAudioContentType(body)
	if contentType == "" {
		return mediaItem{}, false
	}
	return mediaItem{
		B64JSON:  base64.StdEncoding.EncodeToString(body),
		MimeType: contentType,
	}, true
}

func detectRawAudioContentType(body []byte) string {
	if len(body) < 4 {
		return ""
	}
	switch {
	case bytes.HasPrefix(body, []byte("ID3")):
		return "audio/mpeg"
	case len(body) >= 2 && body[0] == 0xff && (body[1]&0xe0) == 0xe0:
		return "audio/mpeg"
	case bytes.HasPrefix(body, []byte("fLaC")):
		return "audio/flac"
	case bytes.HasPrefix(body, []byte("OggS")):
		return "audio/ogg"
	case len(body) >= 12 && bytes.HasPrefix(body, []byte("RIFF")) && bytes.Equal(body[8:12], []byte("WAVE")):
		return "audio/wav"
	}
	if detected := http.DetectContentType(body); strings.HasPrefix(strings.ToLower(detected), "audio/") {
		return detected
	}
	return ""
}

func unwrapUpstreamBody(raw map[string]interface{}) map[string]interface{} {
	if data, ok := raw["data"].(map[string]interface{}); ok {
		merged := make(map[string]interface{}, len(raw)+len(data))
		for k, v := range raw {
			merged[k] = v
		}
		for k, v := range data {
			if _, exists := merged[k]; !exists {
				merged[k] = v
			}
		}
		return merged
	}
	return raw
}

func extractMediaItems(raw map[string]interface{}) []mediaItem {
	raw = unwrapUpstreamBody(raw)
	if it, ok := mediaItemFromMap(raw); ok {
		return []mediaItem{it}
	}
	if data, ok := raw["data"].([]interface{}); ok {
		var out []mediaItem
		for _, item := range data {
			m, _ := item.(map[string]interface{})
			if m == nil {
				if it, ok := mediaItemFromValue(item, raw); ok {
					out = append(out, it)
				}
				continue
			}
			if it, ok := mediaItemFromMap(m); ok {
				out = append(out, it)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	if it, ok := mediaItemFromValue(raw["data"], raw); ok {
		return []mediaItem{it}
	}
	if result, ok := raw["result"].(map[string]interface{}); ok {
		if items := extractMediaItems(result); len(items) > 0 {
			return items
		}
	}
	if output, ok := raw["output"].(map[string]interface{}); ok {
		return extractMediaItems(map[string]interface{}{"data": []interface{}{output}})
	}
	return nil
}

func mediaItemFromMap(m map[string]interface{}) (mediaItem, bool) {
	if mediaURL := firstMediaURL(m, mediaURLKeys()...); mediaURL != "" {
		thumb := firstMediaURL(m, "thumbnail", "cover_url", "poster_url")
		return mediaItem{URL: mediaURL, Thumbnail: thumb}, true
	}
	if b64 := firstString(m, encodedMediaKeys()...); b64 != "" && looksLikeEncodedMedia(b64) {
		return mediaItem{B64JSON: b64, MimeType: firstString(m, "mime_type", "mime", "content_type", "format", "audio_format")}, true
	}
	for _, key := range []string{"data", "result", "output", "audio_result"} {
		if it, ok := mediaItemFromValue(m[key], m); ok {
			return it, true
		}
	}
	return mediaItem{}, false
}

func mediaItemFromValue(v interface{}, parent map[string]interface{}) (mediaItem, bool) {
	switch t := v.(type) {
	case string:
		s := strings.TrimSpace(t)
		if isHTTPURL(s) {
			return mediaItem{URL: s}, true
		}
		if looksLikeEncodedMedia(s) {
			return mediaItem{B64JSON: s, MimeType: firstString(parent, "mime_type", "mime", "content_type", "format", "audio_format")}, true
		}
	case map[string]interface{}:
		return mediaItemFromMap(t)
	case []interface{}:
		for _, item := range t {
			if it, ok := mediaItemFromValue(item, parent); ok {
				return it, true
			}
		}
	}
	return mediaItem{}, false
}

func mediaURLKeys() []string {
	return []string{"url", "video_url", "result_url", "image_url", "audio_url", "audio", "audio_file", "download_url", "file_url", "content_url"}
}

func encodedMediaKeys() []string {
	return []string{"b64_json", "audio", "audio_data", "audio_base64", "audio_file", "audio_hex", "hex_audio", "base64", "data"}
}

func firstDirectMediaURL(raw map[string]interface{}) string {
	raw = unwrapUpstreamBody(raw)
	for _, key := range []string{"video_url", "result_url", "url", "download_url", "file_url", "fail_reason", "content_url"} {
		if u := firstMediaURL(raw, key); u != "" && !strings.Contains(strings.ToLower(u), "/content") {
			return u
		}
	}
	return ""
}

// firstSuccessMediaURL resolves playable media after upstream reports success.
// otuapi often returns result_url=/v1/videos/{id}/content instead of Apifox CDN video_url.
func firstSuccessMediaURL(raw map[string]interface{}, upstreamID string, conn connectionConfig) string {
	raw = unwrapUpstreamBody(raw)
	if u := firstDirectMediaURL(raw); u != "" {
		return u
	}
	if upstreamID != "" && strings.TrimSpace(conn.BaseURL) != "" {
		return strings.TrimRight(conn.BaseURL, "/") + "/v1/videos/" + url.PathEscape(upstreamID) + "/content"
	}
	for _, key := range []string{"video_url", "result_url", "url", "download_url", "file_url", "fail_reason", "content_url"} {
		if u := firstMediaURL(raw, key); u != "" && upstreamURLMatchesTask(u, upstreamID) {
			return u
		}
	}
	return ""
}

func upstreamURLMatchesTask(mediaURL, upstreamID string) bool {
	mediaURL = strings.TrimSpace(mediaURL)
	if mediaURL == "" || !isHTTPURL(mediaURL) {
		return false
	}
	if upstreamID == "" {
		return true
	}
	lower := strings.ToLower(mediaURL)
	if strings.Contains(lower, "/videos/") || strings.Contains(lower, "/content") {
		return strings.Contains(mediaURL, upstreamID)
	}
	return true
}

func upstreamURLIsSameOriginContent(mediaURL string, conn connectionConfig) bool {
	if !isHTTPURL(mediaURL) {
		return false
	}
	u, err := url.Parse(mediaURL)
	if err != nil {
		return false
	}
	base, err := url.Parse(conn.BaseURL)
	if err != nil || base.Host == "" {
		return false
	}
	lowerPath := strings.ToLower(u.Path)
	return strings.EqualFold(u.Host, base.Host) && strings.Contains(lowerPath, "/v1/videos/") && strings.Contains(lowerPath, "/content")
}

func isHTTPURL(s string) bool {
	s = strings.TrimSpace(s)
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

func firstMediaURL(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if s := scalarString(m, key); isHTTPURL(s) {
			return s
		}
	}
	return ""
}

func isValidMediaItem(it mediaItem) bool {
	return isHTTPURL(it.URL) || strings.TrimSpace(it.B64JSON) != ""
}

func looksLikeEncodedMedia(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	if strings.HasPrefix(s, "data:") {
		return true
	}
	if len(s) < 32 || strings.ContainsAny(s, "{}[]:,") {
		return false
	}
	if isHexEncodedMedia(s) {
		return true
	}
	_, err := base64.StdEncoding.DecodeString(s)
	return err == nil
}

// upstreamContentFailure detects otuapi-style errors stored in result_url/fail_reason as plain text.
func upstreamContentFailure(raw map[string]interface{}) string {
	raw = unwrapUpstreamBody(raw)
	for _, key := range []string{"fail_reason", "result_url", "error_message", "message"} {
		s := firstString(raw, key)
		if s == "" || isHTTPURL(s) {
			continue
		}
		return humanizeUpstreamFailure(s)
	}
	return ""
}

func humanizeUpstreamFailure(msg string) string {
	msg = strings.TrimSpace(msg)
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "unsafe") {
		return "生成内容未通过安全审核，请修改提示词或参考图后重试"
	}
	if strings.Contains(lower, "insufficient balance") || strings.Contains(lower, "insufficient_balance") {
		return "上游模型账户余额不足，请检查或更换可用渠道"
	}
	if strings.Contains(lower, "upstream_error") {
		return strings.TrimPrefix(strings.TrimSpace(strings.ReplaceAll(msg, "map[code:upstream_error message:", "")), "]")
	}
	if len([]rune(msg)) > 200 {
		return string([]rune(msg)[:200]) + "..."
	}
	return msg
}

func shouldMirrorMediaURL(raw string, conn connectionConfig) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.HasPrefix(raw, "data:") || !isHTTPURL(raw) {
		return false
	}
	if strings.HasPrefix(raw, "data:") || !isHTTPURL(raw) {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	base, err := url.Parse(conn.BaseURL)
	if err != nil || base.Host == "" {
		return false
	}
	// 同源地址（含 /v1/videos/{id}/content）需带鉴权下载后转存；公网 CDN 直链跳过转存
	return strings.EqualFold(u.Host, base.Host)
}

func mirrorUpstreamMedia(ctx context.Context, conn connectionConfig, mediaURL, upstreamID, taskNo, kind string) (string, error) {
	if !shouldMirrorMediaURL(mediaURL, conn) {
		return "", nil
	}
	candidates := buildMediaDownloadCandidates(conn, mediaURL, upstreamID)
	if len(candidates) == 0 {
		return "", nil
	}
	if objectStore == nil {
		return "", fmt.Errorf("视频需转存但本地/对象存储未就绪，请检查存储配置")
	}
	var lastErr error
	for i, candidate := range candidates {
		if !shouldMirrorMediaURL(candidate, conn) {
			continue
		}
		data, contentType, err := downloadAuthenticatedMedia(ctx, conn, candidate, 250<<20)
		if err == nil {
			if !validDownloadedMedia(kind, contentType, data) {
				return "", fmt.Errorf("上游返回的%s文件格式无效: content-type=%s body=%s", mediaKindLabel(kind), contentType, truncateText(string(data), 160))
			}
			ext := mediaExtForContentType(contentType, kind)
			objectName := fmt.Sprintf("works/%s/%s/%d%s", kind, taskNo, time.Now().UnixNano(), ext)
			publicURL, upErr := objectStore.Upload(ctx, objectName, contentType, bytes.NewReader(data), int64(len(data)))
			if upErr != nil {
				return "", fmt.Errorf("视频转存失败: %w", upErr)
			}
			log.Printf("Task %s mirrored %s -> %s (%d bytes)", taskNo, truncateText(candidate, 80), publicURL, len(data))
			return publicURL, nil
		}
		lastErr = err
		if i+1 < len(candidates) {
			log.Printf("Task %s download try %d failed (%v), next candidate", taskNo, i+1, err)
		}
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", nil
}

func validDownloadedMedia(kind, contentType string, data []byte) bool {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	detected := strings.ToLower(http.DetectContentType(data))
	head := data[:minInt(len(data), 64)]
	switch kind {
	case "video":
		return strings.HasPrefix(ct, "video/") ||
			strings.Contains(ct, "octet-stream") ||
			strings.HasPrefix(detected, "video/") ||
			bytes.Contains(head, []byte("ftyp")) ||
			bytes.HasPrefix(data, []byte{0x1A, 0x45, 0xDF, 0xA3})
	case "image":
		return strings.HasPrefix(ct, "image/") || strings.HasPrefix(detected, "image/")
	case "audio":
		return strings.HasPrefix(ct, "audio/") || strings.Contains(ct, "octet-stream") || strings.HasPrefix(detected, "audio/")
	default:
		return true
	}
}

func mediaKindLabel(kind string) string {
	switch kind {
	case "video":
		return "视频"
	case "image":
		return "图片"
	case "audio":
		return "音频"
	default:
		return "媒体"
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func buildMediaDownloadCandidates(conn connectionConfig, mediaURL, upstreamID string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(u string) {
		u = strings.TrimSpace(u)
		if u == "" || !isHTTPURL(u) || seen[u] {
			return
		}
		seen[u] = true
		out = append(out, u)
	}
	if upstreamID != "" && strings.TrimSpace(conn.BaseURL) != "" {
		add(strings.TrimRight(conn.BaseURL, "/") + "/v1/videos/" + url.PathEscape(upstreamID) + "/content")
	}
	add(mediaURL)
	return out
}

func isTransientDownloadStatus(code int) bool {
	switch code {
	case 404, 408, 429, 500, 502, 503, 520, 521, 522, 524:
		return true
	default:
		return false
	}
}

func downloadRetryDelay(attempt, statusCode int) time.Duration {
	var delay time.Duration
	if statusCode == 502 || statusCode == 503 || statusCode == 524 {
		delay = time.Duration(attempt*5) * time.Second
	} else {
		delay = time.Duration(attempt*3) * time.Second
	}
	if delay > 30*time.Second {
		return 30 * time.Second
	}
	return delay
}

func downloadAuthenticatedMedia(ctx context.Context, conn connectionConfig, mediaURL string, maxBytes int64) ([]byte, string, error) {
	client := &http.Client{Timeout: 15 * time.Minute}
	const maxAttempts = 45
	var resp *http.Response
	var err error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, "GET", mediaURL, nil)
		if err != nil {
			return nil, "", err
		}
		applyConnectionHeaders(req, conn)
		resp, err = client.Do(req)
		if err != nil {
			if attempt < maxAttempts {
				time.Sleep(downloadRetryDelay(attempt, 0))
				continue
			}
			return nil, "", fmt.Errorf("下载上游视频失败: %w", err)
		}
		if isTransientDownloadStatus(resp.StatusCode) && attempt < maxAttempts {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
			resp.Body.Close()
			if isHardDownload404(resp.StatusCode, body) {
				return nil, "", fmt.Errorf("下载上游视频 HTTP 404: %s", truncateText(string(body), 200))
			}
			delay := downloadRetryDelay(attempt, resp.StatusCode)
			log.Printf("download %s HTTP %d (attempt %d/%d), retry in %s: %s",
				truncateText(mediaURL, 60), resp.StatusCode, attempt, maxAttempts, delay, truncateText(string(body), 100))
			time.Sleep(delay)
			continue
		}
		break
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		msg := truncateText(string(body), 200)
		if resp.StatusCode == 502 || resp.StatusCode == 503 || resp.StatusCode == 524 {
			return nil, "", fmt.Errorf("上游视频暂不可用(HTTP %d)，请稍后重试: %s", resp.StatusCode, msg)
		}
		return nil, "", fmt.Errorf("下载上游视频 HTTP %d: %s", resp.StatusCode, msg)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxBytes {
		return nil, "", fmt.Errorf("视频超过大小限制(%dMB)", maxBytes>>20)
	}
	if len(data) == 0 {
		return nil, "", fmt.Errorf("上游返回空视频")
	}
	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if contentType == "" || strings.HasPrefix(contentType, "application/json") || data[0] == '{' {
		return nil, "", fmt.Errorf("上游未返回视频文件: %s", truncateText(string(data), 200))
	}
	return data, contentType, nil
}

func isHardDownload404(statusCode int, body []byte) bool {
	if statusCode != 404 {
		return false
	}
	lower := strings.ToLower(string(body))
	return strings.Contains(lower, "task not found") || strings.Contains(lower, "invalid_request_error")
}

func mediaExtForContentType(contentType, kind string) string {
	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "webm"):
		return ".webm"
	case strings.Contains(ct, "quicktime"), strings.Contains(ct, "mov"):
		return ".mov"
	case strings.Contains(ct, "mpeg"), strings.Contains(ct, "mp4"):
		return ".mp4"
	case strings.Contains(ct, "wav"):
		return ".wav"
	case strings.Contains(ct, "mp3"):
		return ".mp3"
	}
	if kind == "audio" {
		return ".mp3"
	}
	return ".mp4"
}

func firstString(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if s := scalarString(m, key); s != "" {
			return s
		}
	}
	return ""
}

func scalarString(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		v, ok := m[key]
		if !ok || v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			if s := strings.TrimSpace(t); s != "" {
				return s
			}
		case float64:
			if t != 0 {
				return strings.TrimSpace(fmt.Sprintf("%.0f", t))
			}
		case int, int64:
			s := strings.TrimSpace(fmt.Sprint(t))
			if s != "" && s != "0" {
				return s
			}
		default:
			if s := strings.TrimSpace(fmt.Sprint(t)); s != "" {
				return s
			}
		}
	}
	return ""
}

func parsePollConfig(runtimeRule map[string]interface{}, createEndpoint string) pollConfig {
	cfg := pollConfig{
		Path:     strings.TrimRight(createEndpoint, "/") + "/{id}",
		Interval: 5 * time.Second,
		Timeout:  60 * time.Minute,
	}
	up, _ := runtimeRule["upstream"].(map[string]interface{})
	if up == nil {
		return cfg
	}
	if s, ok := up["poll_path"].(string); ok && strings.TrimSpace(s) != "" {
		cfg.Path = strings.TrimSpace(s)
	}
	if strings.Contains(createEndpoint, "/v1/videos") && strings.Contains(cfg.Path, "/v1/video/generations") {
		cfg.Path = "/v1/videos/{id}"
	}
	if d := secondsFromAny(up["poll_interval_sec"]); d > 0 {
		cfg.Interval = d
	}
	if d := secondsFromAny(up["poll_timeout_sec"]); d > 0 {
		cfg.Timeout = d
	}
	return cfg
}

func secondsFromAny(v interface{}) time.Duration {
	switch n := v.(type) {
	case float64:
		if n > 0 {
			return time.Duration(n) * time.Second
		}
	case int:
		if n > 0 {
			return time.Duration(n) * time.Second
		}
	case int64:
		if n > 0 {
			return time.Duration(n) * time.Second
		}
	case json.Number:
		if f, err := n.Float64(); err == nil && f > 0 {
			return time.Duration(f) * time.Second
		}
	}
	return 0
}

func recordTaskProgress(ctx context.Context, pool *pgxpool.Pool, taskNo, status, progressRaw string) {
	if pool == nil || taskNo == "" {
		return
	}
	progress := parseProgressPercent(progressRaw)
	if progress < 0 {
		switch strings.ToLower(strings.TrimSpace(status)) {
		case "queued", "pending", "not_start":
			progress = 3
		case "in_progress", "processing", "running":
			progress = 25
		case "succeeded", "success", "completed", "done", "finished":
			progress = 100
		default:
			progress = 0
		}
	}
	if progress > 100 {
		progress = 100
	}
	var taskID int64
	if err := pool.QueryRow(ctx, `SELECT id FROM tasks WHERE task_no=$1`, taskNo).Scan(&taskID); err != nil {
		return
	}
	payload, _ := json.Marshal(map[string]interface{}{"status": status, "progress": progress})
	pool.Exec(ctx, `INSERT INTO task_events (task_id, event_type, payload) VALUES ($1,'progress',$2)`, taskID, payload)
}

func parseProgressPercent(raw string) int {
	raw = strings.TrimSpace(strings.TrimSuffix(raw, "%"))
	if raw == "" {
		return -1
	}
	if n, err := strconv.ParseFloat(raw, 64); err == nil {
		return int(math.Round(n))
	}
	return -1
}

func pollUpstreamTask(ctx context.Context, pool *pgxpool.Pool, conn connectionConfig, cfg pollConfig, upstreamID, taskNo string) ([]mediaItem, error) {
	escapedID := url.PathEscape(upstreamID)
	pollURL := conn.BaseURL + strings.Replace(cfg.Path, "{id}", escapedID, 1)
	deadline := time.Now().Add(cfg.Timeout)
	var lastStatus string
	var consecutiveErrors int
	var successPolls int
	const maxSuccessWait = 36
	attempt := 0
	for time.Now().Before(deadline) {
		attempt++
		body, statusCode, err := doJSONRequest(ctx, conn, "GET", pollURL, nil, 60*time.Second)
		if err != nil {
			consecutiveErrors++
			if attempt == 1 || attempt%6 == 0 {
				log.Printf("Task %s poll #%d request error: %v", taskNo, attempt, err)
			}
			time.Sleep(cfg.Interval)
			continue
		}
		if statusCode == 404 {
			return nil, fmt.Errorf("上游任务不存在(404)，请检查 poll_path 与任务 ID")
		}
		if statusCode >= 400 {
			consecutiveErrors++
			if attempt == 1 || attempt%6 == 0 {
				log.Printf("Task %s poll #%d HTTP %d: %s", taskNo, attempt, statusCode, truncateText(string(body), 300))
			}
			if consecutiveErrors >= 12 {
				return nil, fmt.Errorf("上游轮询持续失败(HTTP %d): %s", statusCode, truncateText(upstreamErrorMessage(body), 200))
			}
			time.Sleep(cfg.Interval)
			continue
		}
		consecutiveErrors = 0
		var raw map[string]interface{}
		if err := json.Unmarshal(body, &raw); err != nil {
			time.Sleep(cfg.Interval)
			continue
		}
		raw = unwrapUpstreamBody(raw)
		status := strings.ToLower(firstString(raw, "status", "state", "task_status"))
		progress := scalarString(raw, "progress")
		if status != lastStatus || attempt == 1 || attempt%12 == 0 {
			log.Printf("Task %s poll #%d status=%s progress=%s", taskNo, attempt, status, progress)
			recordTaskProgress(ctx, pool, taskNo, status, progress)
			lastStatus = status
		}
		switch status {
		case "failed", "error", "cancelled", "canceled", "failure":
			msg := firstString(raw, "error_message", "message", "error")
			if msg == "" {
				if fr := firstString(raw, "fail_reason"); fr != "" && !isHTTPURL(fr) {
					msg = fr
				}
			}
			if msg == "" {
				msg = upstreamErrorMessage(body)
			}
			if msg == "" || msg == "模型服务异常" {
				msg = "上游任务失败"
			}
			return nil, fmt.Errorf("%s", msg)
		case "succeeded", "success", "completed", "done", "finished":
			if failMsg := upstreamContentFailure(raw); failMsg != "" {
				return nil, fmt.Errorf("%s", failMsg)
			}
			if mediaURL := firstSuccessMediaURL(raw, upstreamID, conn); mediaURL != "" {
				log.Printf("Task %s poll #%d got media url: %s", taskNo, attempt, truncateText(mediaURL, 100))
				return []mediaItem{{URL: mediaURL}}, nil
			}
			successPolls++
			if successPolls < maxSuccessWait {
				if successPolls == 1 || successPolls%6 == 0 {
					log.Printf("Task %s poll #%d success waiting media url (%d/%d) result_url=%s video_url=%s",
						taskNo, attempt, successPolls, maxSuccessWait,
						truncateText(firstString(raw, "result_url"), 80),
						truncateText(firstString(raw, "video_url"), 80))
				}
				time.Sleep(cfg.Interval)
				continue
			}
			return nil, fmt.Errorf("上游未返回可下载的视频地址，请稍后重试: %s", truncateText(string(body), 400))
		case "queued", "in_progress", "processing", "pending", "running", "not_start", "":
			// keep polling
		default:
			if attempt <= 3 || attempt%12 == 0 {
				log.Printf("Task %s poll #%d unknown status %q: %s", taskNo, attempt, status, truncateText(string(body), 200))
			}
		}
		time.Sleep(cfg.Interval)
	}
	return nil, fmt.Errorf("生成超时（已轮询 %s），请稍后重试", cfg.Timeout)
}

func upstreamErrorMessage(body []byte) string {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		msg := strings.TrimSpace(string(body))
		if msg != "" {
			return humanizeUpstreamFailure(msg)
		}
		return "模型服务异常"
	}
	if errObj, ok := raw["error"].(map[string]interface{}); ok {
		if msg, ok := errObj["message"].(string); ok && strings.TrimSpace(msg) != "" {
			return humanizeUpstreamFailure(msg)
		}
	}
	if baseResp, ok := raw["base_resp"].(map[string]interface{}); ok {
		if msg := firstString(baseResp, "status_msg", "message", "error_message"); msg != "" {
			return humanizeUpstreamFailure(msg)
		}
		if code := firstString(baseResp, "status_code", "code"); code != "" && code != "0" {
			return "上游模型服务返回错误：" + code
		}
	}
	if msg := firstString(raw, "message", "error_message", "fail_reason", "error"); msg != "" {
		return humanizeUpstreamFailure(msg)
	}
	return "模型服务异常"
}

func truncateText(s string, max int) string {
	s = redactSensitiveLogText(s)
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "..."
}

var sensitiveLogPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)("?(?:api[_-]?key|authorization|token|secret|password)"?\s*[:=]\s*")([^"]+)(")`),
	regexp.MustCompile(`(?i)((?:api[_-]?key|authorization|token|secret|password)=)([^&\s]+)()`),
	regexp.MustCompile(`(?i)(Bearer\s+)([A-Za-z0-9._~+\-/=]{12,})()`),
}

func redactSensitiveLogText(s string) string {
	out := s
	for _, re := range sensitiveLogPatterns {
		out = re.ReplaceAllString(out, `${1}****${3}`)
	}
	return out
}

func failTask(ctx context.Context, pool *pgxpool.Pool, p ImageTaskPayload, code, msg string) error {
	var estimated float64
	pool.QueryRow(ctx, `SELECT estimated_cost FROM tasks WHERE task_no=$1`, p.TaskNo).Scan(&estimated)
	pool.Exec(ctx, `
		UPDATE tasks SET status='failed', error_code=$1, error_message=$2, finished_at=now(), updated_at=now() WHERE task_no=$3`,
		code, msg, p.TaskNo)
	if err := unfreezeBilling(ctx, pool, p.UserID, estimated, "task", p.TaskNo); err != nil {
		return fmt.Errorf("task %s release billing: %w", p.TaskNo, err)
	}
	insertNotification(ctx, pool, p.UserID, "生成失败",
		fmt.Sprintf("%s，任务号：%s", msg, p.TaskNo), "task")
	log.Printf("Task %s failed: %s", p.TaskNo, msg)
	return nil
}

func insertNotification(ctx context.Context, pool *pgxpool.Pool, userID int64, title, content, typ string) {
	if userID <= 0 || title == "" {
		return
	}
	if typ == "" {
		typ = "system"
	}
	pool.Exec(ctx,
		`INSERT INTO notifications (user_id, title, content, type) VALUES ($1,$2,$3,$4)`,
		userID, title, content, typ)
}

func chargeBilling(ctx context.Context, pool *pgxpool.Pool, userID int64, freezeAmount, actualAmount float64, refType, refID, txType, remark string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	lockedAmount, err := lockedFreezeAmount(ctx, tx, userID, refType, refID)
	if err != nil {
		return err
	}
	if lockedAmount <= 0 {
		return nil
	}
	if freezeAmount <= 0 || freezeAmount > lockedAmount {
		freezeAmount = lockedAmount
	}
	var balance, frozen float64
	if err = tx.QueryRow(ctx, `SELECT compute_balance, frozen_compute FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance, &frozen); err != nil {
		return err
	}
	charge := actualAmount
	if charge < 0 {
		charge = 0
	}
	if charge > freezeAmount {
		charge = freezeAmount
	}
	newBalance := balance - charge
	newFrozen := frozen - freezeAmount
	if newFrozen < 0 {
		newFrozen = 0
	}
	if _, err = tx.Exec(ctx, `UPDATE wallets SET compute_balance=$1, frozen_compute=$2, updated_at=now() WHERE user_id=$3`, newBalance, newFrozen, userID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE balance_freezes SET status='charged', released_at=now() WHERE user_id=$1 AND ref_type=$2 AND ref_id=$3 AND status='frozen'`, userID, refType, refID); err != nil {
		return err
	}
	if charge > 0 {
		if _, err = tx.Exec(ctx, `INSERT INTO wallet_transactions (user_id, type, direction, amount, balance_after, ref_type, ref_id, remark) VALUES ($1,$2,'out',$3,$4,$5,$6,$7)`, userID, txType, charge, newBalance, refType, refID, remark); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func unfreezeBilling(ctx context.Context, pool *pgxpool.Pool, userID int64, amount float64, refType, refID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	lockedAmount, err := lockedFreezeAmount(ctx, tx, userID, refType, refID)
	if err != nil {
		return err
	}
	if lockedAmount <= 0 {
		return nil
	}
	if amount <= 0 || amount > lockedAmount {
		amount = lockedAmount
	}
	if _, err = tx.Exec(ctx, `UPDATE wallets SET frozen_compute = GREATEST(frozen_compute - $1, 0), updated_at=now() WHERE user_id=$2`, amount, userID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE balance_freezes SET status='released', released_at=now() WHERE user_id=$1 AND ref_type=$2 AND ref_id=$3 AND status='frozen'`, userID, refType, refID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func lockedFreezeAmount(ctx context.Context, tx pgx.Tx, userID int64, refType, refID string) (float64, error) {
	rows, err := tx.Query(ctx, `SELECT amount FROM balance_freezes WHERE user_id=$1 AND ref_type=$2 AND ref_id=$3 AND status='frozen' FOR UPDATE`, userID, refType, refID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	total := 0.0
	for rows.Next() {
		var amount float64
		if err := rows.Scan(&amount); err != nil {
			return 0, err
		}
		total += amount
	}
	return total, rows.Err()
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func configuredLocalStoragePublicURL(appEnv, baseURL, explicit string) (string, error) {
	if v := strings.TrimRight(strings.TrimSpace(explicit), "/"); v != "" {
		return v, nil
	}
	if v := strings.TrimRight(strings.TrimSpace(baseURL), "/"); v != "" {
		return v + "/uploads-local", nil
	}
	if strings.EqualFold(strings.TrimSpace(appEnv), "production") {
		return "", fmt.Errorf("production local storage requires LOCAL_STORAGE_PUBLIC_URL or BASE_URL")
	}
	return "http://localhost:8080/uploads-local", nil
}

func jsonReader(data []byte) io.Reader {
	return &byteReader{data: data}
}

type byteReader struct {
	data []byte
	pos  int
}

func (r *byteReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}
