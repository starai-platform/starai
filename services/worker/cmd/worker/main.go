package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"mime/multipart"
	"net/http"
	"net/textproto"
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

var (
	objectStore         storage.Store
	modelRouteCipherKey string
	// 异步任务默认轮询超时。过长会让故障任务长期占用并发槽位，
	// 可通过 WORKER_POLL_TIMEOUT_SEC 或模型 runtime_rule 的 poll_timeout_sec 覆盖。
	defaultPollTimeout = 15 * time.Minute
)

const (
	TypeImageTask    = "image:generate"
	TypeComposeTask  = "media:compose"
	TypeWorkflowTask = "workflow:run"
)

func configuredWorkExpiration(ctx context.Context, pool *pgxpool.Pool, fallbackDays int) *time.Time {
	days := fallbackDays
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT value FROM system_configs WHERE key='work_retention_days'`).Scan(&raw); err == nil {
		var value interface{}
		if json.Unmarshal(raw, &value) == nil {
			switch v := value.(type) {
			case float64:
				days = int(v)
			case string:
				if parsed, parseErr := strconv.Atoi(strings.TrimSpace(v)); parseErr == nil {
					days = parsed
				}
			}
		}
	}
	if days <= 0 {
		return nil
	}
	expires := time.Now().Add(time.Duration(days) * 24 * time.Hour)
	return &expires
}

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

type ComposeTaskPayload struct {
	TaskNo string                 `json:"task_no"`
	UserID int64                  `json:"user_id"`
	Input  map[string]interface{} `json:"input"`
}

func main() {
	_ = godotenv.Load("../../.env.local", "../../.env", ".env.local", ".env")
	modelRouteCipherKey = getenv("MODEL_ROUTE_CIPHER_KEY", getenv("ADMIN_JWT_SECRET", "dev-admin-jwt-secret"))
	dbURL := getenv("DATABASE_URL", "postgres://starai:starai@localhost:5432/starai?sslmode=disable")
	redisURL := getenv("REDIS_URL", "redis://localhost:6379/0")
	newAPIBase := getenv("NEW_API_BASE_URL", "http://localhost:3002")
	newAPIToken := getenv("NEW_API_TOKEN", "sk-platform-internal-token")
	appEnv := getenv("APP_ENV", "development")
	baseURL := getenv("BASE_URL", "")
	localStoragePublicURL, localStoragePublicErr := configuredLocalStoragePublicURL(appEnv, baseURL, getenv("LOCAL_STORAGE_PUBLIC_URL", ""))

	ctx := context.Background()
	concurrency := getenvInt("WORKER_CONCURRENCY", 20)
	poolCfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatal(err)
	}
	// 每个任务处理期间会用 Acquire 长期占住一条连接持有咨询锁，
	// 中途还会再从池里取连接做临时查询。pgxpool 默认 MaxConns 只有
	// max(4, CPU 核数)，并发大于它时所有槽位会卡在等连接上死锁，
	// 新任务永远停在 pending。
	poolCfg.MaxConns = int32(2*concurrency + 4)
	poolCfg.MinConns = 2
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
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

	if pollTimeoutSec := getenvInt("WORKER_POLL_TIMEOUT_SEC", 0); pollTimeoutSec > 0 {
		defaultPollTimeout = time.Duration(pollTimeoutSec) * time.Second
	}
	log.Printf("StarAI Worker config: concurrency=%d default poll timeout=%s", concurrency, defaultPollTimeout)

	srv := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: concurrency,
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
	mux.HandleFunc(TypeComposeTask, func(ctx context.Context, t *asynq.Task) error {
		var payload ComposeTaskPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil {
			return err
		}
		return processComposeTask(ctx, pool, payload)
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
	var claimedTaskID int64
	var currentStatus string
	if err := pool.QueryRow(ctx, `SELECT id, status FROM tasks WHERE task_no=$1`, p.TaskNo).Scan(&claimedTaskID, &currentStatus); err != nil {
		return err
	}
	lockConn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer lockConn.Release()
	var locked bool
	if err := lockConn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, -claimedTaskID).Scan(&locked); err != nil {
		return err
	}
	if !locked {
		log.Printf("Task %s is already being processed; duplicate delivery ignored", p.TaskNo)
		return nil
	}
	defer func() { _, _ = lockConn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, -claimedTaskID) }()
	if err := pool.QueryRow(ctx, `SELECT status FROM tasks WHERE id=$1`, claimedTaskID).Scan(&currentStatus); err != nil {
		return err
	}
	if currentStatus != "pending" && currentStatus != "running" {
		log.Printf("Task %s has terminal/non-runnable status %s; delivery ignored", p.TaskNo, currentStatus)
		return nil
	}
	if currentStatus == "pending" {
		if _, err := pool.Exec(ctx, `UPDATE tasks SET status='running', started_at=COALESCE(started_at,now()), updated_at=now() WHERE id=$1 AND status='pending'`, claimedTaskID); err != nil {
			return err
		}
	}

	var requestMode, category, endpoint, newAPIModel string
	var extraParamsRaw, runtimeRuleRaw []byte
	var retentionDays int
	if err := pool.QueryRow(ctx, `SELECT request_mode, category, new_api_model, new_api_endpoint, new_api_extra_params, runtime_rule, retention_days FROM models WHERE id=$1`, p.ModelID).
		Scan(&requestMode, &category, &newAPIModel, &endpoint, &extraParamsRaw, &runtimeRuleRaw, &retentionDays); err != nil {
		return failTask(ctx, pool, p, "MODEL_NOT_FOUND", "生成模型不存在或已被删除")
	}
	requestMode = normalizeWorkerMediaRequestMode(requestMode, category)
	isVideo := requestMode == "video"
	isAudio := requestMode == "audio"
	isImage := !isVideo && !isAudio

	legacyRuntimeRule := videoparams.ParseRuntimeRuleJSON(runtimeRuleRaw)
	legacyExtraParams := videoparams.ParseExtraParamsJSON(extraParamsRaw)
	prompt, _ := p.Input["prompt"].(string)
	workPrompt := prompt
	if rawUserPrompt, ok := p.Input["user_prompt"].(string); ok && strings.TrimSpace(rawUserPrompt) != "" {
		workPrompt = rawUserPrompt
	}
	if isVideo || isImage {
		prompt = applyGenerationLanguage(prompt, p.Input)
		p.Input["prompt"] = prompt
	}

	routes, err := loadWorkerModelRoutes(ctx, pool, p.ModelID, baseURL, token, newAPIModel, endpoint, legacyExtraParams, legacyRuntimeRule)
	if err != nil {
		message := "无法加载模型线路"
		if errors.Is(err, errNoEnabledModelRoutes) {
			message = "该模型没有启用的上游线路，请联系管理员"
		}
		return failTask(ctx, pool, p, "MODEL_ROUTE_ERROR", message)
	}
	var selected workerGenerationAttemptResult
	var lastRouteErr error
	attempt := 0
	selectedOK := false
	// 仅多线路时启用自动切换/熔断降级；单线路保持旧的直连行为。
	poolEnabled := len(routes) > 1
routeLoop:
	for _, route := range routes {
		if poolEnabled && !acquireWorkerRouteProbe(ctx, pool, route) {
			continue
		}
		if route.ID > 0 {
			_, _ = pool.Exec(ctx, `UPDATE tasks SET route_id=$1,updated_at=now() WHERE task_no=$2`, route.ID, p.TaskNo)
		}
		for retry := 0; retry <= route.MaxRetries; retry++ {
			if attempt >= maxWorkerRouteAttempts {
				break routeLoop
			}
			attempt++
			started := time.Now()
			candidate, callErr := executeWorkerGenerationAttempt(ctx, pool, p, route, isVideo, isAudio, isImage, prompt)
			latency := int(time.Since(started).Milliseconds())
			if callErr == nil && candidate.StatusCode < 400 && len(candidate.ResultData) == 0 {
				candidate.ResultData, candidate.UpstreamTaskID = parseUpstreamMedia(candidate.ResponseBody)
				if len(candidate.ResultData) == 0 && candidate.UpstreamTaskID == "" {
					callErr = fmt.Errorf("upstream returned no usable result")
				}
			}
			if callErr == nil && candidate.StatusCode < 400 {
				selected = candidate
				selectedOK = true
				markWorkerRouteSuccess(ctx, pool, route.ID)
				logWorkerRouteAttempt(ctx, pool, p.TaskNo, p.ModelID, route.ID, attempt, "success", candidate.StatusCode, latency)
				break
			}
			lastRouteErr = callErr
			if callErr == nil {
				lastRouteErr = fmt.Errorf("upstream HTTP %d: %s", candidate.StatusCode, upstreamErrorMessage(candidate.ResponseBody))
			}
			if callErr == nil && !workerStatusCanFailover(candidate.StatusCode) {
				logWorkerRouteAttempt(ctx, pool, p.TaskNo, p.ModelID, route.ID, attempt, "rejected", candidate.StatusCode, latency)
				return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", upstreamErrorMessage(candidate.ResponseBody))
			}
			markWorkerRouteFailure(ctx, pool, route.ID, poolEnabled)
			logWorkerRouteAttempt(ctx, pool, p.TaskNo, p.ModelID, route.ID, attempt, "failed", candidate.StatusCode, latency)
			log.Printf("Task %s route %d failed status=%d: %s", p.TaskNo, route.ID, candidate.StatusCode, truncateText(fmt.Sprint(lastRouteErr), 800))
			if retry < route.MaxRetries && workerShouldRetrySameRoute(callErr, candidate.StatusCode) && waitWorkerRouteRetry(ctx, retry) {
				continue
			}
			break
		}
		if selectedOK {
			break
		}
	}
	if !selectedOK {
		message := "所有可用线路均调用失败"
		if lastRouteErr != nil && strings.TrimSpace(lastRouteErr.Error()) != "" {
			message += "：" + humanizeUpstreamFailure(lastRouteErr.Error())
		}
		return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", message)
	}
	runtimeRule, conn, endpoint, newAPIModel := selected.RuntimeRule, selected.Connection, selected.Endpoint, selected.UpstreamModel
	respBody, resultData, upstreamID := selected.ResponseBody, selected.ResultData, selected.UpstreamTaskID
	if upstreamID != "" {
		_, _ = pool.Exec(ctx, `UPDATE tasks SET upstream_task_id=$1,route_id=$2,updated_at=now() WHERE task_no=$3`, upstreamID, nullableRouteID(selected.Route.ID), p.TaskNo)
	}

	usage := upstreamUsageFromBody(respBody)
	if !(isImage && isVideoImageAPI(endpoint, newAPIModel)) {
		resultData, upstreamID = parseUpstreamMedia(respBody)
		if upstreamID != "" {
			pool.Exec(ctx, `UPDATE tasks SET upstream_task_id=$1, updated_at=now() WHERE task_no=$2`, upstreamID, p.TaskNo)
		}
		if len(resultData) == 0 && upstreamID != "" {
			pollCfg := parsePollConfig(runtimeRule, endpoint)
			if responsePollPath := upstreamPollPath(respBody, conn.BaseURL); responsePollPath != "" {
				pollCfg.Path = responsePollPath
			}
			log.Printf("Task %s upstream async id=%s poll=%s interval=%s timeout=%s", p.TaskNo, upstreamID, pollCfg.Path, pollCfg.Interval, pollCfg.Timeout)
			var pollUsage upstreamUsageDetails
			resultData, pollUsage, err = pollUpstreamTask(ctx, pool, conn, pollCfg, upstreamID, p.TaskNo)
			if err != nil {
				log.Printf("Task %s poll failed: %v", p.TaskNo, err)
				return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", err.Error())
			}
			if pollUsage.hasAny() {
				usage = pollUsage
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
	billingInput := inputWithActualUpstreamUsage(p.Input, usage)
	if usage.hasAny() {
		actualCost = estimateModelCostByIDWorker(ctx, pool, p.ModelID, billingInput, usage.PromptTokens, usage.OutputTokens, 0, 0)
	}
	providerCost := workerRouteProviderCost(selected.Route, billingInput, usage.PromptTokens, usage.OutputTokens, 0, 0)
	updateWorkerRouteAttemptProviderCost(ctx, pool, p.TaskNo, selected.Route.ID, providerCost)

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
			stored, err := mirrorUpstreamMedia(ctx, conn, videoURL, upstreamID, fmt.Sprintf("%s_%d", p.TaskNo, i+1), "video")
			if err == nil && stored == "" {
				stored, err = persistGeneratedMedia(ctx, conn, videoURL, p.TaskNo, fmt.Sprintf("video_%d", i+1), "video", 500<<20)
			}
			if err != nil {
				log.Printf("Task %s persist video #%d failed: %v", p.TaskNo, i+1, err)
				return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", "生成成功，但作品转存失败："+err.Error())
			}
			if stored != "" {
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
		if stored, err := persistGeneratedMedia(ctx, conn, audioURL, p.TaskNo, "audio", "audio", 250<<20); err != nil {
			log.Printf("Task %s persist audio failed: %v", p.TaskNo, err)
			return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", "生成成功，但作品转存失败："+err.Error())
		} else if stored != "" {
			audioURL = stored
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
			if url != "" && item.B64JSON == "" {
				stored, err := persistGeneratedMedia(ctx, conn, url, p.TaskNo, fmt.Sprintf("image_%d", idx+1), "image", 50<<20)
				if err != nil {
					log.Printf("Task %s persist image #%d failed: %v", p.TaskNo, idx+1, err)
					return failTask(ctx, pool, p, "MODEL_PROVIDER_ERROR", "生成成功，但作品转存失败："+err.Error())
				}
				if stored != "" {
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
	if label := strings.TrimSpace(stringAny(p.Input["_billing_label"])); label != "" {
		remark = label
	}
	if boolInput(p.Input, "_skip_billing") {
		if _, err := pool.Exec(ctx, `
			UPDATE tasks SET status='succeeded', output=$1, actual_cost=$2, route_id=$3, provider_cost=$4, error_code=NULL, error_message=NULL, finished_at=now(), updated_at=now() WHERE task_no=$5 AND status='running'`,
			output, actualCost, nullableRouteID(selected.Route.ID), providerCost, p.TaskNo); err != nil {
			return fmt.Errorf("task %s finalize: %w", p.TaskNo, err)
		}
	} else if err := chargeBillingWithFinalize(ctx, pool, p.UserID, estimated, actualCost, "task", p.TaskNo, txType, remark, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE tasks SET status='succeeded', output=$1, actual_cost=$2, route_id=$3, provider_cost=$4, error_code=NULL, error_message=NULL, finished_at=now(), updated_at=now() WHERE task_no=$5 AND status='running'`,
			output, actualCost, nullableRouteID(selected.Route.ID), providerCost, p.TaskNo)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return fmt.Errorf("task is no longer running")
		}
		return nil
	}); err != nil {
		return fmt.Errorf("task %s billing/finalize: %w", p.TaskNo, err)
	}

	publicID := fmt.Sprintf("work_%d", time.Now().UnixNano())
	expires := configuredWorkExpiration(ctx, pool, retentionDays)
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

func normalizeWorkerMediaRequestMode(requestMode, category string) string {
	if !strings.EqualFold(strings.TrimSpace(requestMode), "custom") {
		return requestMode
	}
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "image":
		return "images"
	case "video", "audio":
		return strings.ToLower(strings.TrimSpace(category))
	default:
		return requestMode
	}
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

type workerModelRoute struct {
	ID                  int64
	Protocol            string
	UpstreamModel       string
	Endpoint            string
	Connection          connectionConfig
	ExtraParams         map[string]interface{}
	RuntimeRule         map[string]interface{}
	MediaOverrides      map[string]interface{}
	CostRule            map[string]interface{}
	Priority            int
	Weight              int
	TimeoutSeconds      int
	MaxRetries          int
	HealthStatus        string
	ConsecutiveFailures int
	CooldownUntil       *time.Time
	// LegacyRequestTransform holds connection.request_transform recovered from the
	// model's legacy extra_params before that block is stripped.
	LegacyRequestTransform map[string]interface{}
}

// workerRouteRequestTransform returns the effective request_transform for a
// route, preferring a route-level override over the model-level legacy value.
func workerRouteRequestTransform(route workerModelRoute) map[string]interface{} {
	if conn, ok := route.ExtraParams["connection"].(map[string]interface{}); ok {
		if rt, ok := conn["request_transform"].(map[string]interface{}); ok && len(rt) > 0 {
			return rt
		}
	}
	if rt, ok := route.ExtraParams["request_transform"].(map[string]interface{}); ok && len(rt) > 0 {
		return rt
	}
	return route.LegacyRequestTransform
}

var errNoEnabledModelRoutes = errors.New("model has configured routes but none are enabled")

func loadWorkerModelRoutes(ctx context.Context, pool *pgxpool.Pool, modelID int64, fallbackBaseURL, fallbackToken, legacyModel, legacyEndpoint string, legacyExtra, legacyRuntime map[string]interface{}) ([]workerModelRoute, error) {
	rows, err := pool.Query(ctx, `SELECT id,protocol,upstream_model,endpoint,base_url,api_key,auth_type,api_key_header,headers,extra_params,runtime_rule,cost_rule,priority,weight,timeout_seconds,max_retries,health_status,consecutive_failures,cooldown_until
		FROM model_routes WHERE model_id=$1 AND is_enabled=true ORDER BY priority,id`, modelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	routes := []workerModelRoute{}
	for rows.Next() {
		var route workerModelRoute
		var baseURL, apiKey, authType, apiKeyHeader string
		var headersRaw, extraRaw, runtimeRaw, costRaw []byte
		if err := rows.Scan(&route.ID, &route.Protocol, &route.UpstreamModel, &route.Endpoint, &baseURL, &apiKey, &authType, &apiKeyHeader, &headersRaw, &extraRaw, &runtimeRaw, &costRaw, &route.Priority, &route.Weight, &route.TimeoutSeconds, &route.MaxRetries, &route.HealthStatus, &route.ConsecutiveFailures, &route.CooldownUntil); err != nil {
			return nil, err
		}
		var headers map[string]interface{}
		_ = json.Unmarshal(headersRaw, &headers)
		apiKey, err = decryptWorkerRouteSecret(apiKey, modelRouteCipherKey)
		if err != nil {
			return nil, fmt.Errorf("route %d API key decrypt failed; check MODEL_ROUTE_CIPHER_KEY: %w", route.ID, err)
		}
		apiKey = resolveWorkerAPIKeyReference(apiKey)
		route.Connection = connectionConfig{BaseURL: trimRightSlash(baseURL), APIKey: apiKey, AuthType: authType, APIKeyHeader: apiKeyHeader, Headers: map[string]string{}}
		for key, value := range headers {
			if text, ok := value.(string); ok {
				route.Connection.Headers[key] = text
			}
		}
		_ = json.Unmarshal(extraRaw, &route.ExtraParams)
		_ = json.Unmarshal(runtimeRaw, &route.RuntimeRule)
		route.MediaOverrides = route.RuntimeRule
		_ = json.Unmarshal(costRaw, &route.CostRule)
		legacyExtraWithoutConnection := mergeWorkerMaps(legacyExtra, map[string]interface{}{})
		delete(legacyExtraWithoutConnection, "connection")
		// Preserve the non-credential part of the legacy connection block before it
		// is dropped: request_transform is configuration, not a secret, and the
		// media payload builders need it to support non-OpenAI upstreams.
		if legacyConn, ok := legacyExtra["connection"].(map[string]interface{}); ok {
			if rt, ok := legacyConn["request_transform"].(map[string]interface{}); ok && len(rt) > 0 {
				route.LegacyRequestTransform = rt
			}
		}
		route.ExtraParams = mergeWorkerMaps(legacyExtraWithoutConnection, route.ExtraParams)
		route.RuntimeRule = mergeWorkerMaps(legacyRuntime, route.RuntimeRule)
		routes = append(routes, route)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	// 熔断降级仅在多条启用线路时生效；单线路保持旧的直连行为，
	// 不受冷却窗口限制，并自愈残留的熔断状态。
	if len(routes) == 1 {
		healWorkerSingleRouteState(ctx, pool, &routes[0])
	} else if len(routes) > 1 {
		now := time.Now()
		active := make([]workerModelRoute, 0, len(routes))
		for _, route := range routes {
			if route.CooldownUntil == nil || !route.CooldownUntil.After(now) {
				active = append(active, route)
			}
		}
		if len(active) == 0 {
			return nil, fmt.Errorf("all model routes are cooling down")
		}
		routes = active
	}
	if len(routes) == 0 {
		var hasConfiguredRoutes bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM model_routes WHERE model_id=$1)`, modelID).Scan(&hasConfiguredRoutes); err != nil {
			return nil, err
		}
		if hasConfiguredRoutes {
			return nil, errNoEnabledModelRoutes
		}
		protocol := strings.ToLower(strings.TrimSpace(stringAny(legacyExtra["protocol"])))
		if connection, ok := legacyExtra["connection"].(map[string]interface{}); ok {
			protocol = strings.ToLower(strings.TrimSpace(firstNonEmpty(stringAny(connection["protocol"]), protocol)))
		}
		if protocol == "" {
			protocol = "openai"
		}
		routes = append(routes, workerModelRoute{Protocol: protocol, UpstreamModel: legacyModel, Endpoint: legacyEndpoint, Connection: parseConnection(legacyExtra, fallbackBaseURL, fallbackToken), ExtraParams: legacyExtra, RuntimeRule: legacyRuntime, Weight: 100, TimeoutSeconds: 120})
	}
	for start := 0; start < len(routes); {
		end := start + 1
		for end < len(routes) && routes[end].Priority == routes[start].Priority {
			end++
		}
		weightedWorkerRouteOrder(routes[start:end])
		start = end
	}
	return routes, nil
}

func decryptWorkerRouteSecret(value, secret string) (string, error) {
	const prefix = "enc:v1:"
	if value == "" || !strings.HasPrefix(value, prefix) {
		return value, nil
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil {
		return "", err
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted route secret")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func resolveWorkerAPIKeyReference(value string) string {
	apiKey := strings.TrimSpace(value)
	if strings.HasPrefix(apiKey, "${") && strings.HasSuffix(apiKey, "}") {
		envVar := strings.TrimSuffix(strings.TrimPrefix(apiKey, "${"), "}")
		if envValue := strings.TrimSpace(os.Getenv(envVar)); envValue != "" {
			return envValue
		}
	}
	return apiKey
}

func weightedWorkerRouteOrder(routes []workerModelRoute) {
	for pos := 0; pos < len(routes)-1; pos++ {
		total := 0
		for index := pos; index < len(routes); index++ {
			total += routes[index].Weight
		}
		if total <= 0 {
			return
		}
		pick := rand.Intn(total)
		selected := pos
		for index := pos; index < len(routes); index++ {
			pick -= routes[index].Weight
			if pick < 0 {
				selected = index
				break
			}
		}
		routes[pos], routes[selected] = routes[selected], routes[pos]
	}
}

func mergeWorkerMaps(base, override map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for key, value := range base {
		out[key] = value
	}
	for key, value := range override {
		baseMap, baseOK := out[key].(map[string]interface{})
		overrideMap, overrideOK := value.(map[string]interface{})
		if baseOK && overrideOK {
			out[key] = mergeWorkerMaps(baseMap, overrideMap)
		} else {
			out[key] = value
		}
	}
	return out
}

func markWorkerRouteSuccess(ctx context.Context, pool *pgxpool.Pool, routeID int64) {
	if routeID <= 0 {
		return
	}
	_, _ = pool.Exec(ctx, `UPDATE model_routes SET health_status='healthy',consecutive_failures=0,success_count=success_count+1,last_success_at=now(),cooldown_until=NULL,updated_at=now() WHERE id=$1`, routeID)
}

func acquireWorkerRouteProbe(ctx context.Context, pool *pgxpool.Pool, route workerModelRoute) bool {
	if route.ID <= 0 || (route.HealthStatus != "open" && route.HealthStatus != "half_open") {
		return true
	}
	tag, err := pool.Exec(ctx, `UPDATE model_routes SET health_status='half_open',cooldown_until=now()+interval '30 seconds',updated_at=now() WHERE id=$1 AND health_status IN ('open','half_open') AND (cooldown_until IS NULL OR cooldown_until<=now())`, route.ID)
	return err == nil && tag.RowsAffected() == 1
}

func nullableRouteID(routeID int64) interface{} {
	if routeID <= 0 {
		return nil
	}
	return routeID
}

func markWorkerRouteFailure(ctx context.Context, pool *pgxpool.Pool, routeID int64, poolEnabled bool) {
	if routeID <= 0 {
		return
	}
	if !poolEnabled {
		// 单线路只累计失败统计，不进入熔断/冷却，保持旧的直连重试行为。
		_, _ = pool.Exec(ctx, `UPDATE model_routes SET consecutive_failures=consecutive_failures+1,failure_count=failure_count+1,last_failure_at=now(),updated_at=now() WHERE id=$1`, routeID)
		return
	}
	_, _ = pool.Exec(ctx, `UPDATE model_routes SET consecutive_failures=consecutive_failures+1,failure_count=failure_count+1,last_failure_at=now(),health_status=CASE WHEN consecutive_failures+1>=5 THEN 'open' ELSE 'degraded' END,cooldown_until=CASE WHEN consecutive_failures+1>=5 THEN now()+interval '60 seconds' ELSE cooldown_until END,updated_at=now() WHERE id=$1`, routeID)
}

// healWorkerSingleRouteState 清除单线路模型残留的熔断/冷却状态，避免无降级可走时自伤。
func healWorkerSingleRouteState(ctx context.Context, pool *pgxpool.Pool, route *workerModelRoute) {
	if route.ID <= 0 {
		return
	}
	if route.HealthStatus != "open" && route.HealthStatus != "half_open" && route.CooldownUntil == nil {
		return
	}
	_, _ = pool.Exec(ctx, `UPDATE model_routes SET health_status='healthy',cooldown_until=NULL,updated_at=now() WHERE id=$1`, route.ID)
	route.HealthStatus = "healthy"
	route.CooldownUntil = nil
}

func logWorkerRouteAttempt(ctx context.Context, pool *pgxpool.Pool, taskNo string, modelID, routeID int64, attempt int, status string, statusCode, latencyMS int) {
	var routeRef interface{} = routeID
	if routeID <= 0 {
		routeRef = nil
	}
	_, _ = pool.Exec(ctx, `INSERT INTO model_route_attempts(request_id,model_id,route_id,attempt,status,status_code,latency_ms) VALUES($1,$2,$3,$4,$5,NULLIF($6,0),$7)`, taskNo, modelID, routeRef, attempt, status, statusCode, latencyMS)
}

func updateWorkerRouteAttemptProviderCost(ctx context.Context, pool *pgxpool.Pool, requestID string, routeID int64, providerCost float64) {
	if strings.TrimSpace(requestID) == "" || routeID <= 0 || providerCost < 0 {
		return
	}
	_, _ = pool.Exec(ctx, `UPDATE model_route_attempts SET provider_cost=$1 WHERE id=(
		SELECT id FROM model_route_attempts WHERE request_id=$2 AND route_id=$3 AND status IN ('success','SUCCESS') ORDER BY attempt DESC,id DESC LIMIT 1
	)`, providerCost, requestID, routeID)
}

func workerRouteProviderCost(route workerModelRoute, input map[string]interface{}, promptTokens, outputTokens, cacheReadTokens, cacheWriteTokens int) float64 {
	typeName := strings.ToLower(strings.TrimSpace(fmt.Sprint(route.CostRule["billing_type"])))
	value := func(key string) float64 { return floatAny(route.CostRule[key]) }
	switch typeName {
	case "per_token":
		inputCost := value("input_cost_per_m")
		cacheReadCost := value("cache_read_cost_per_m")
		if cacheReadCost <= 0 {
			cacheReadCost = inputCost
		}
		cacheWriteCost := value("cache_write_cost_per_m")
		if cacheWriteCost <= 0 {
			cacheWriteCost = inputCost
		}
		if cacheReadTokens < 0 {
			cacheReadTokens = 0
		}
		if cacheWriteTokens < 0 {
			cacheWriteTokens = 0
		}
		if cacheReadTokens+cacheWriteTokens > promptTokens {
			cacheReadTokens, cacheWriteTokens = 0, 0
		}
		uncached := promptTokens - cacheReadTokens - cacheWriteTokens
		return (float64(uncached)*inputCost + float64(cacheReadTokens)*cacheReadCost + float64(cacheWriteTokens)*cacheWriteCost + float64(outputTokens)*value("output_cost_per_m")) / 1_000_000
	case "per_image", "per_request":
		count := intAny(input["n"])
		if count <= 0 {
			count = intAny(input["count"])
		}
		if count <= 0 {
			count = 1
		}
		unitCost := value("unit_cost")
		if typeName == "per_image" {
			unitCost = workerImageTierValue(route.CostRule, input, "unit_cost_by_size", "unit_cost")
		}
		return float64(count) * unitCost
	case "per_second":
		seconds := floatAny(input["_actual_output_seconds"])
		if seconds <= 0 {
			seconds = workerDurationSeconds(input)
		}
		if seconds <= 0 {
			seconds = 1
		}
		return seconds * value("unit_cost")
	default:
		return value("unit_cost")
	}
}

type workerGenerationAttemptResult struct {
	Route           workerModelRoute
	RuntimeRule     map[string]interface{}
	Connection      connectionConfig
	Endpoint        string
	UpstreamModel   string
	ResponseBody    []byte
	StatusCode      int
	ResultData      []mediaItem
	UpstreamTaskID  string
	GenerationCount int
}

func executeWorkerGenerationAttempt(ctx context.Context, pool *pgxpool.Pool, p ImageTaskPayload, route workerModelRoute, isVideo, isAudio, isImage bool, prompt string) (workerGenerationAttemptResult, error) {
	if route.Connection.Headers == nil {
		route.Connection.Headers = map[string]string{}
	}
	if _, exists := route.Connection.Headers["Idempotency-Key"]; !exists {
		route.Connection.Headers["Idempotency-Key"] = p.TaskNo
	}
	result := workerGenerationAttemptResult{Route: route, RuntimeRule: route.RuntimeRule, Connection: route.Connection, Endpoint: route.Endpoint, UpstreamModel: route.UpstreamModel, GenerationCount: 1}
	if requiresAliyunWorkspaceEndpoint(route.UpstreamModel) && !isAliyunWorkspaceEndpoint(route.Connection.BaseURL) {
		return result, errors.New("阿里云百炼模型线路必须配置与模型和 API Key 同地域、带 WorkspaceId 的 HTTPS Endpoint")
	}
	extraParams := mergeWorkerMaps(route.ExtraParams, map[string]interface{}{})
	// The credential-bearing connection block is rebuilt from the resolved route
	// so downstream builders always see the effective base_url/api_key. Carry
	// request_transform across explicitly: loadWorkerModelRoutes strips the
	// legacy "connection" key, so it would otherwise be lost here.
	effectiveConn := map[string]interface{}{
		"base_url": route.Connection.BaseURL, "api_key": route.Connection.APIKey,
		"auth_type": route.Connection.AuthType, "api_key_header": route.Connection.APIKeyHeader,
	}
	if rt := workerRouteRequestTransform(route); len(rt) > 0 {
		effectiveConn["request_transform"] = rt
	}
	extraParams["connection"] = effectiveConn
	endpoint, upstreamModel := result.Endpoint, result.UpstreamModel
	var body []byte
	if isVideo {
		if endpoint == "" {
			endpoint = "/v1/video/generations"
		}
		body, _ = json.Marshal(videoparams.BuildUpstreamVideoPayload(p.ModelCode, upstreamModel, route.RuntimeRule, extraParams, p.Input))
	} else if isAudio {
		if endpoint == "" {
			endpoint = "/v1/audio/speech"
		}
		body, _ = json.Marshal(videoparams.BuildUpstreamVideoPayload(p.ModelCode, upstreamModel, route.RuntimeRule, extraParams, p.Input))
	} else {
		if endpoint == "" {
			endpoint = "/v1/images/generations"
		}
		result.GenerationCount = intAny(p.Input["n"])
		if result.GenerationCount <= 0 {
			result.GenerationCount = intAny(p.Input["count"])
		}
		if result.GenerationCount < 1 {
			result.GenerationCount = 1
		}
		if result.GenerationCount > 50 {
			result.GenerationCount = 50
		}
		resolveImageGenerationInput(p.Input, route.RuntimeRule, endpoint, upstreamModel)
		persistTaskInput(ctx, pool, p.TaskNo, p.Input)
		if isGeminiNativeImageAPI(endpoint, upstreamModel) {
			body, _ = json.Marshal(buildGeminiNativeImagePayload(ctx, upstreamModel, p.ModelCode, prompt, p.Input))
		} else if isVideoImageAPI(endpoint, upstreamModel) {
			body, _ = json.Marshal(buildVideoImagePayload(ctx, route.RuntimeRule, endpoint, upstreamModel, p.ModelCode, prompt, p.Input))
		} else if hasMappedMediaPayload(route.RuntimeRule) {
			body, _ = json.Marshal(buildMappedImagePayload(ctx, p.ModelCode, upstreamModel, route.RuntimeRule, extraParams, p.Input))
		} else if isOpenAIImagesAdapter(route.RuntimeRule) {
			body, _ = json.Marshal(buildOpenAIImagesPayload(upstreamModel, p.ModelCode, prompt, result.GenerationCount, p.Input))
		} else {
			size, _ := p.Input["size"].(string)
			if size == "" {
				size = "1024x1024"
			}
			isTencentImage := isTencentTokenHubImageAPI(route.Connection.BaseURL)
			if isTencentImage {
				size = strings.ReplaceAll(size, "x", ":")
			}
			imageBody := map[string]interface{}{"model": upstreamModel, "prompt": prompt, "n": result.GenerationCount, "size": size}
			if imageBody["model"] == "" {
				imageBody["model"] = p.ModelCode
			}
			if value, ok := p.Input["aspect_ratio"]; ok {
				imageBody["aspect_ratio"] = value
			}
			applyOpenAIImageOptions(imageBody, p.Input)
			if refs, ok := p.Input["reference_images"]; ok {
				if isTencentImage {
					imageBody["images"] = normalizeReferenceImages(ctx, refs)
				} else {
					imageBody["image"] = normalizeReferenceImages(ctx, refs)
				}
			}
			body, _ = json.Marshal(imageBody)
		}
	}
	openAIReferenceImages := []string(nil)
	if isImage && isOpenAIImagesAdapter(route.RuntimeRule) {
		openAIReferenceImages = referenceImageSources(p.Input["reference_images"])
		if len(openAIReferenceImages) > 0 {
			endpoint = openAIImageEditEndpoint(route.RuntimeRule, endpoint)
		}
	}
	result.Endpoint = endpoint
	var payload map[string]interface{}
	_ = json.Unmarshal(body, &payload)
	// Apply the route's final custom field overlay after every media-specific
	// builder. The video/audio builder intentionally strips connection (secrets),
	// so doing this inside only one builder silently skipped custom media routes.
	applyRequestTransform(payload, extraParams)
	if isVideo {
		payload = videoparams.SanitizeUpstreamPayload(payload, endpoint)
	}
	if err := normalizePayloadMedia(ctx, payload, endpoint); err != nil {
		return result, err
	}
	if isVideo {
		if err := validateOmniReferencePayload(payload); err != nil {
			return result, err
		}
	}
	var err error
	if isImage && isVideoImageAPI(endpoint, upstreamModel) {
		result.ResultData, result.UpstreamTaskID, err = runBananaImageBatch(ctx, pool, route.Connection, endpoint, payload, route.RuntimeRule, p.TaskNo, result.GenerationCount)
	} else if isImage && isOpenAIImagesAdapter(route.RuntimeRule) {
		timeout := upstreamRequestTimeout(route.RuntimeRule, false)
		if route.TimeoutSeconds > 0 {
			timeout = time.Duration(route.TimeoutSeconds) * time.Second
		}
		timeout = openAIImagesRequestTimeout(timeout)
		result.ResponseBody, result.StatusCode, err = postOpenAIImagesUpstream(ctx, route.Connection, endpoint, payload, openAIReferenceImages, timeout)
	} else if isVideo {
		result.ResponseBody, result.StatusCode, err = postVideoUpstream(ctx, route.Connection, endpoint, payload, p.TaskNo)
	} else {
		body, _ = json.Marshal(payload)
		timeout := upstreamRequestTimeout(route.RuntimeRule, isAudio)
		if route.TimeoutSeconds > 0 {
			timeout = time.Duration(route.TimeoutSeconds) * time.Second
		}
		result.ResponseBody, result.StatusCode, err = doJSONRequestWithLimit(ctx, route.Connection, "POST", joinBaseEndpoint(route.Connection.BaseURL, resolveModelEndpoint(endpoint, upstreamModel)), body, timeout, 96<<20)
	}
	return result, err
}

func applyOpenAIImageOptions(out, input map[string]interface{}) {
	for _, key := range []string{"quality", "style", "background", "output_format", "moderation", "input_fidelity", "seed", "negative_prompt", "watermark"} {
		if value, ok := input[key]; ok && value != nil && strings.TrimSpace(fmt.Sprint(value)) != "" {
			out[key] = value
		}
	}
}

func isOpenAIImagesAdapter(runtimeRule map[string]interface{}) bool {
	upstream, _ := runtimeRule["upstream"].(map[string]interface{})
	return strings.EqualFold(strings.TrimSpace(fmt.Sprint(upstream["adapter"])), "openai_images")
}

func openAIImagesRequestTimeout(configured time.Duration) time.Duration {
	// Large synchronous image bodies can arrive after the route's legacy 120s
	// default; aborting mid-body causes the paid request to be retried.
	if configured < 10*time.Minute {
		return 10 * time.Minute
	}
	return configured
}

func openAIImageEditEndpoint(runtimeRule map[string]interface{}, generationEndpoint string) string {
	upstream, _ := runtimeRule["upstream"].(map[string]interface{})
	if endpoint := strings.TrimSpace(fmt.Sprint(upstream["edit_endpoint"])); endpoint != "" && endpoint != "<nil>" {
		return endpoint
	}
	trimmed := strings.TrimRight(strings.TrimSpace(generationEndpoint), "/")
	if strings.HasSuffix(strings.ToLower(trimmed), "/generations") {
		return trimmed[:len(trimmed)-len("generations")] + "edits"
	}
	return "/v1/images/edits"
}

func buildOpenAIImagesPayload(upstreamModel, modelCode, prompt string, count int, input map[string]interface{}) map[string]interface{} {
	model := strings.TrimSpace(upstreamModel)
	if model == "" {
		model = modelCode
	}
	size := normalizeOpenAIImageSize(fmt.Sprint(input["size"]))
	payload := map[string]interface{}{
		"model":   model,
		"prompt":  prompt,
		"n":       count,
		"size":    size,
		"quality": normalizeOpenAIImageQuality(input["quality"]),
	}
	for _, key := range []string{"background", "output_format", "output_compression", "moderation", "input_fidelity", "user", "response_format"} {
		if value, ok := input[key]; ok && value != nil && strings.TrimSpace(fmt.Sprint(value)) != "" {
			payload[key] = value
		}
	}
	return payload
}

func normalizeOpenAIImageQuality(value interface{}) string {
	quality := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	switch quality {
	case "auto", "low", "medium", "high":
		return quality
	default:
		return "auto"
	}
}

func normalizeOpenAIImageSize(value string) string {
	size := strings.ToLower(strings.TrimSpace(value))
	if size == "auto" {
		return size
	}
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return "1024x1024"
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 || width == height {
		return "1024x1024"
	}
	if width > height {
		return "1536x1024"
	}
	return "1024x1536"
}

func referenceImageSources(value interface{}) []string {
	if source, ok := value.(string); ok {
		if source = strings.TrimSpace(source); source != "" {
			return []string{source}
		}
		return nil
	}
	return stringSlice(value)
}

func postOpenAIImagesUpstream(ctx context.Context, conn connectionConfig, endpoint string, payload map[string]interface{}, references []string, timeout time.Duration) ([]byte, int, error) {
	target := joinBaseEndpoint(conn.BaseURL, endpoint)
	if len(references) == 0 {
		body, _ := json.Marshal(payload)
		return doJSONRequestWithLimit(ctx, conn, "POST", target, body, timeout, 96<<20)
	}
	files := make([]multipartFile, 0, len(references))
	fileField := "image"
	if len(references) > 1 {
		fileField = "image[]"
	}
	for index, source := range references {
		data, contentType, err := loadMediaBytes(ctx, normalizeReferenceImage(ctx, source))
		if err != nil || len(data) == 0 {
			if err == nil {
				err = errors.New("empty image")
			}
			return nil, 0, fmt.Errorf("第 %d 张参考图读取失败: %w", index+1, err)
		}
		if !strings.HasPrefix(contentType, "image/") {
			contentType = http.DetectContentType(data)
		}
		if !strings.HasPrefix(contentType, "image/") {
			return nil, 0, fmt.Errorf("第 %d 张参考图不是有效图片", index+1)
		}
		files = append(files, multipartFile{Field: fileField, Name: fmt.Sprintf("%d-%s", index+1, fileNameForMIME(contentType)), ContentType: contentType, Data: data})
	}
	return doMultipartFilesRequest(ctx, conn, target, payload, files, timeout, 96<<20)
}

func requiresAliyunWorkspaceEndpoint(model string) bool {
	model = strings.ToLower(strings.TrimSpace(model))
	return strings.HasPrefix(model, "qwen-image-3.0") || strings.HasPrefix(model, "wan3.0-video") ||
		strings.HasPrefix(model, "happyhorse-") || strings.HasPrefix(model, "qwen-audio-3.0-tts-") ||
		strings.HasPrefix(model, "cosyvoice-v3") || strings.HasPrefix(model, "fun-music-")
}

func isAliyunWorkspaceEndpoint(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && parsed.Scheme == "https" && (parsed.Path == "" || parsed.Path == "/") && parsed.RawQuery == "" &&
		strings.HasSuffix(strings.ToLower(parsed.Hostname()), ".maas.aliyuncs.com") &&
		!strings.ContainsAny(parsed.Hostname(), "{}")
}

func isTencentTokenHubImageAPI(baseURL string) bool {
	baseURL = strings.ToLower(strings.TrimSpace(baseURL))
	return strings.Contains(baseURL, "tokenhub.tencentmaas.com") || strings.Contains(baseURL, "api.cloudai.tencent.com")
}

// hasMappedMediaPayload opts image requests into the same dotted-key mapping
// already used by video/audio. This supports native media APIs whose request
// body is nested (for example input.prompt and parameters.size) without adding
// a provider-specific code path for every upstream.
func hasMappedMediaPayload(runtimeRule map[string]interface{}) bool {
	upstream, _ := runtimeRule["upstream"].(map[string]interface{})
	mapping, _ := upstream["map"].(map[string]interface{})
	return len(mapping) > 0
}

func buildMappedImagePayload(ctx context.Context, modelCode, upstreamModel string, runtimeRule, extraParams, input map[string]interface{}) map[string]interface{} {
	params := mergeWorkerMaps(input, map[string]interface{}{})
	if refs, ok := params["reference_images"]; ok {
		params["reference_images"] = normalizeReferenceImages(ctx, refs)
	}
	return videoparams.BuildUpstreamVideoPayload(modelCode, upstreamModel, runtimeRule, extraParams, params)
}

// applyRequestTransform overlays connection.request_transform onto an outgoing
// upstream payload, so OpenAI-incompatible providers can be supported by
// configuration instead of code. A null value deletes the key, which is how a
// caller drops a field the upstream rejects (e.g. "size").
//
// Contract matches the API-side adapters in runtime/chat_protocol.go.
func applyRequestTransform(payload map[string]interface{}, extraParams map[string]interface{}) {
	if payload == nil || extraParams == nil {
		return
	}
	conn, ok := extraParams["connection"].(map[string]interface{})
	if !ok {
		return
	}
	overrides, ok := conn["request_transform"].(map[string]interface{})
	if !ok || len(overrides) == 0 {
		return
	}
	for key, value := range overrides {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if value == nil {
			delete(payload, key)
			continue
		}
		payload[key] = value
	}
}

func workerStatusCanFailover(status int) bool {
	switch status {
	case 0, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504, 520, 521, 522, 524:
		return true
	default:
		return false
	}
}

func workerShouldRetrySameRoute(err error, status int) bool {
	if err != nil {
		return true
	}
	return status == 408 || status >= 500
}

func waitWorkerRouteRetry(ctx context.Context, retry int) bool {
	timer := time.NewTimer(time.Duration(retry+1) * 200 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

const maxWorkerRouteAttempts = 8

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
		apiKey := strings.TrimSpace(s)
		// Decrypt at-rest secrets written by the API (util.EncryptSecret,
		// "enc:v1:" prefix). Plaintext values pass through unchanged, so rows
		// saved before encryption was introduced keep working.
		if decrypted, err := decryptWorkerRouteSecret(apiKey, modelRouteCipherKey); err != nil {
			log.Printf("model connection api_key decrypt failed; check MODEL_ROUTE_CIPHER_KEY: %v", err)
		} else {
			apiKey = decrypted
		}
		apiKey = resolveWorkerAPIKeyReference(apiKey)
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

// connectionForTaskPoll keeps creation-only DashScope async mode off task queries.
func connectionForTaskPoll(cfg connectionConfig) connectionConfig {
	if len(cfg.Headers) == 0 {
		return cfg
	}
	headers := make(map[string]string, len(cfg.Headers))
	for key, value := range cfg.Headers {
		if strings.EqualFold(strings.TrimSpace(key), "X-DashScope-Async") {
			continue
		}
		headers[key] = value
	}
	cfg.Headers = headers
	return cfg
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
	if strings.HasSuffix(baseURL, endpoint) {
		return baseURL
	}
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
	if len(refs) == 0 {
		refs = collectBananaReferenceImages(ctx, input["image_url"])
	}
	if len(refs) == 0 {
		refs = collectBananaReferenceImages(ctx, input["reference_image"])
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
	explicitSize := strings.TrimSpace(fmt.Sprint(input["size"]))
	ratioInput := strings.TrimSpace(fmt.Sprint(input["aspect_ratio"]))
	tierInput := strings.TrimSpace(fmt.Sprint(input["image_size"]))
	if explicitSize != "" && explicitSize != "<nil>" && !strings.EqualFold(explicitSize, "auto") &&
		(ratioInput == "" || ratioInput == "<nil>" || strings.EqualFold(ratioInput, "auto")) &&
		(tierInput == "" || tierInput == "<nil>" || strings.EqualFold(tierInput, "auto")) {
		input["resolved_size"] = explicitSize
		return
	}
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
			items, _, err = pollUpstreamTask(ctx, pool, conn, pollCfg, upstreamID, taskNo)
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
	// 参考图规范化同样需要超时，不可达的 URL 不能让任务挂死。
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	var data []byte
	contentType := ""
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode < 400 {
			contentType = resp.Header.Get("Content-Type")
			data, err = io.ReadAll(io.LimitReader(resp.Body, (20<<20)+1))
			if len(data) > 0 && !strings.HasPrefix(contentType, "image/") {
				contentType = http.DetectContentType(data)
			}
		}
	}
	if err != nil || len(data) == 0 || len(data) > 20<<20 || !strings.HasPrefix(contentType, "image/") {
		if objectStore == nil {
			return src
		}
		objectKey := objectStore.ObjectKeyFromURL(src)
		if objectKey == "" {
			return src
		}
		data, err = objectStore.ReadAll(ctx, objectKey, 20<<20)
		if err != nil || len(data) == 0 {
			return src
		}
		contentType = http.DetectContentType(data)
		if !strings.HasPrefix(contentType, "image/") {
			return src
		}
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)
}

func validateOmniReferencePayload(payload map[string]interface{}) error {
	if !strings.Contains(strings.ToLower(strings.TrimSpace(fmt.Sprint(payload["model"]))), "omni") {
		return nil
	}
	refs := payload["images"]
	if refs == nil {
		return nil
	}
	images := []string{}
	switch value := refs.(type) {
	case []string:
		images = value
	case []interface{}:
		for _, item := range value {
			images = append(images, strings.TrimSpace(fmt.Sprint(item)))
		}
	}
	for _, image := range images {
		if !strings.HasPrefix(strings.ToLower(image), "data:image/") {
			return errors.New("Omni 参考图读取失败：请检查对象存储或素材公网地址，已阻止降级为无参考图生成")
		}
	}
	return nil
}

type mediaItem struct {
	URL       string
	B64JSON   string
	MimeType  string
	Thumbnail string
}

type pollConfig struct {
	Path     string
	Method   string
	Body     map[string]interface{}
	Interval time.Duration
	Timeout  time.Duration
}

func normalizePayloadMedia(ctx context.Context, payload map[string]interface{}, endpoint string) error {
	if content, ok := payload["content"].([]interface{}); ok {
		for _, raw := range content {
			item, _ := raw.(map[string]interface{})
			if item == nil {
				continue
			}
			if imageObj, ok := item["image_url"].(map[string]interface{}); ok {
				if src, ok := imageObj["url"].(string); ok {
					if strings.HasPrefix(src, "data:") || isPrivateMediaURL(src) {
						imageObj["url"] = normalizeReferenceImage(ctx, src)
					}
				}
			}
		}
	}
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
	if input, ok := payload["input"].(map[string]interface{}); ok {
		if media, ok := input["media"].([]interface{}); ok {
			for _, raw := range media {
				item, _ := raw.(map[string]interface{})
				if item == nil {
					continue
				}
				kind := strings.ToLower(strings.TrimSpace(fmt.Sprint(item["type"])))
				src := strings.TrimSpace(fmt.Sprint(item["url"]))
				if src == "" || src == "<nil>" {
					continue
				}
				switch kind {
				case "first_frame", "last_frame", "reference_image":
					normalized := normalizeReferenceImage(ctx, src)
					if !strings.HasPrefix(normalized, "data:image/") && isPrivateMediaURL(normalized) {
						return errors.New("阿里云参考图片读取失败：请检查对象存储配置或将素材地址改为公网 HTTPS URL")
					}
					item["url"] = normalized
				case "video", "reference_video", "reference_audio":
					if isPrivateMediaURL(src) {
						mediaName := "音频"
						if kind == "video" || kind == "reference_video" {
							mediaName = "视频"
						}
						return fmt.Errorf("阿里云无法下载本地%s素材：请将对象存储公网地址（MINIO_PUBLIC_URL）配置为可被阿里云访问的 HTTPS 域名", mediaName)
					}
				}
			}
		}
		if messages, ok := input["messages"].([]interface{}); ok {
			for _, rawMessage := range messages {
				message, _ := rawMessage.(map[string]interface{})
				content, _ := message["content"].([]interface{})
				for _, rawItem := range content {
					item, _ := rawItem.(map[string]interface{})
					if src, ok := item["image"].(string); ok {
						normalized := normalizeReferenceImage(ctx, src)
						if !strings.HasPrefix(normalized, "data:image/") && isPrivateMediaURL(normalized) {
							return errors.New("阿里云参考图片读取失败：请检查对象存储配置或将素材地址改为公网 HTTPS URL")
						}
						item["image"] = normalized
					}
				}
			}
		}
	}
	return nil
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
	target := joinBaseEndpoint(conn.BaseURL, endpoint)
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
	// 参考图下载必须有超时，否则不可达的 URL 会让任务永久挂起占用并发槽位。
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
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

type multipartFile struct {
	Field       string
	Name        string
	ContentType string
	Data        []byte
}

func doMultipartRequest(ctx context.Context, conn connectionConfig, target string, fields map[string]interface{}, fileField, fileName string, fileData []byte, contentType string, timeout time.Duration) ([]byte, int, error) {
	return doMultipartFilesRequest(ctx, conn, target, fields, []multipartFile{{Field: fileField, Name: fileName, ContentType: contentType, Data: fileData}}, timeout, 2<<20)
}

func doMultipartFilesRequest(ctx context.Context, conn connectionConfig, target string, fields map[string]interface{}, files []multipartFile, timeout time.Duration, maxResponseBytes int64) ([]byte, int, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = w.WriteField(k, fmt.Sprint(v))
	}
	for _, file := range files {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, file.Field, file.Name))
		header.Set("Content-Type", file.ContentType)
		fw, err := w.CreatePart(header)
		if err != nil {
			return nil, 0, err
		}
		if _, err := fw.Write(file.Data); err != nil {
			return nil, 0, err
		}
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
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
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
	// timeout<=0 表示调用方未指定超时，兜底 5 分钟，避免无超时客户端挂死并发槽位。
	if timeout <= 0 {
		timeout = 5 * time.Minute
	}
	client := &http.Client{Timeout: timeout}
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
	upstreamID := scalarString(raw, "task_no", "taskNo", "task_id", "taskId", "generation_id", "generationId", "job_id", "jobId", "prediction_id", "request_id", "id")
	if upstreamID == "" {
		upstreamID = nestedScalarString(raw, "task_no", "taskNo", "task_id", "taskId", "generation_id", "generationId", "job_id", "jobId", "prediction_id", "request_id", "id")
	}
	if len(items) > 0 {
		return items, upstreamID
	}
	// otuapi 等网关：异步任务 ID 在 task_id，顶层 id 常为数字记录号
	return nil, upstreamID
}

func upstreamPollPath(body []byte, baseURL string) string {
	var raw map[string]interface{}
	if json.Unmarshal(body, &raw) != nil {
		return ""
	}
	raw = unwrapUpstreamBody(raw)
	pollPath := scalarString(raw, "poll_url", "pollUrl", "status_url", "statusUrl")
	if pollPath == "" {
		pollPath = nestedScalarString(raw, "poll_url", "pollUrl", "status_url", "statusUrl")
	}
	pollPath = strings.TrimSpace(pollPath)
	if !isHTTPURL(pollPath) {
		return pollPath
	}
	pollURL, pollErr := url.Parse(pollPath)
	base, baseErr := url.Parse(baseURL)
	if pollErr != nil || baseErr != nil || !strings.EqualFold(pollURL.Scheme, base.Scheme) || !strings.EqualFold(pollURL.Host, base.Host) {
		return ""
	}
	return pollPath
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
	merged := make(map[string]interface{}, len(raw))
	for k, v := range raw {
		merged[k] = v
	}
	for _, rootKey := range []string{"data", "task", "result", "output"} {
		nested, ok := raw[rootKey].(map[string]interface{})
		if !ok {
			continue
		}
		for k, v := range unwrapUpstreamBody(nested) {
			// The inner task is authoritative; gateway envelopes may retain stale
			// status/progress values while the provider task is already complete.
			merged[k] = v
		}
	}
	return merged
}

func extractMediaItems(raw map[string]interface{}) []mediaItem {
	raw = unwrapUpstreamBody(raw)
	for _, listKey := range []string{"data", "images", "videos", "audios", "results", "files", "choices"} {
		data, ok := raw[listKey].([]interface{})
		if !ok {
			continue
		}
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
	if it, ok := mediaItemFromMap(raw); ok {
		return []mediaItem{it}
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

func nestedScalarString(value interface{}, keys ...string) string {
	switch current := value.(type) {
	case map[string]interface{}:
		if found := scalarString(current, keys...); found != "" {
			return found
		}
		for _, child := range current {
			if found := nestedScalarString(child, keys...); found != "" {
				return found
			}
		}
	case []interface{}:
		for _, child := range current {
			if found := nestedScalarString(child, keys...); found != "" {
				return found
			}
		}
	}
	return ""
}

func mediaItemFromMap(m map[string]interface{}) (mediaItem, bool) {
	if mediaURL := firstMediaURL(m, mediaURLKeys()...); mediaURL != "" {
		thumb := firstMediaURL(m, "thumbnail", "cover_url", "poster_url", "last_frame_url")
		return mediaItem{URL: mediaURL, Thumbnail: thumb}, true
	}
	if b64 := firstString(m, encodedMediaKeys()...); b64 != "" && looksLikeEncodedMedia(b64) {
		return mediaItem{B64JSON: b64, MimeType: firstString(m, "mime_type", "mime", "content_type", "format", "audio_format")}, true
	}
	for _, key := range []string{"data", "result", "output", "message", "content", "audio", "audio_result", "images", "videos", "audios", "results", "files", "choices"} {
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
	return []string{"url", "uri", "src", "media_url", "output_url", "video_url", "result_url", "image_url", "image", "audio_url", "audio", "audio_file", "download_url", "file_url", "content_url"}
}

func encodedMediaKeys() []string {
	return []string{"b64_json", "audio", "audio_data", "audio_base64", "audio_file", "audio_hex", "hex_audio", "base64", "data"}
}

func firstDirectMediaURL(raw map[string]interface{}) string {
	raw = unwrapUpstreamBody(raw)
	if item, ok := mediaItemFromMap(raw); ok && isHTTPURL(item.URL) {
		return item.URL
	}
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
	if strings.Contains(lower, "tls handshake timeout") {
		return "连接上游时 TLS 握手超时，请检查服务器到上游的网络或代理"
	}
	if strings.Contains(lower, "client.timeout") || strings.Contains(lower, "context deadline exceeded") {
		return "等待上游响应超时；请求可能仍在生成，请检查上游网关超时设置"
	}
	if strings.Contains(lower, "504 gateway timeout") || strings.Contains(lower, "error code: 524") {
		return "上游网关超时（HTTP 504/524），不是模型参数错误"
	}
	if strings.Contains(lower, "<!doctype html") || strings.Contains(lower, "<html") {
		return "上游网关返回了 HTML 错误页，请检查该线路的网关日志"
	}
	if strings.Contains(lower, "unsafe") ||
		strings.Contains(lower, "blocked by moderation") ||
		strings.Contains(lower, "content moderation") ||
		strings.Contains(lower, "content policy") {
		return "生成内容未通过上游安全审核，请修改提示词或参考素材后重试（避免武器、暴力、敏感人物、侵权或受限内容）"
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
	// 同源地址（含 /v1/videos/{id}/content）需带鉴权下载后转存；公网 CDN 直链跳过转存
	return sameOriginURL(raw, conn.BaseURL)
}

func sameOriginURL(raw, baseURL string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	base, err := url.Parse(strings.TrimSpace(baseURL))
	return err == nil && u.Host != "" && base.Host != "" && strings.EqualFold(u.Host, base.Host)
}

func isManagedMediaURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	lower := strings.ToLower(raw)
	if strings.Contains(lower, "/uploads-local/") || strings.Contains(lower, "/starai-works/works/") {
		return true
	}
	for _, base := range []string{
		os.Getenv("MINIO_PUBLIC_URL"),
		os.Getenv("LOCAL_STORAGE_PUBLIC_URL"),
	} {
		base = strings.TrimRight(strings.TrimSpace(base), "/")
		if base != "" && strings.HasPrefix(raw, base+"/") {
			return true
		}
	}
	return false
}

// persistGeneratedMedia makes externally hosted generation results durable and
// browser-friendly. Some providers return image CDN URLs as
// application/octet-stream; storing the detected media type avoids intermittent
// broken previews and keeps completed projects independent from expiring URLs.
func persistGeneratedMedia(ctx context.Context, conn connectionConfig, mediaURL, taskNo, itemName, kind string, maxBytes int64) (string, error) {
	mediaURL = strings.TrimSpace(mediaURL)
	if mediaURL == "" || strings.HasPrefix(mediaURL, "data:") || !isHTTPURL(mediaURL) || isManagedMediaURL(mediaURL) {
		return "", nil
	}
	if objectStore == nil {
		return "", fmt.Errorf("对象存储未配置")
	}
	data, contentType, err := downloadAuthenticatedMedia(ctx, conn, mediaURL, maxBytes)
	if err != nil {
		return "", err
	}
	detected := http.DetectContentType(data)
	if strings.TrimSpace(contentType) == "" || strings.Contains(strings.ToLower(contentType), "octet-stream") {
		contentType = detected
	}
	if !validDownloadedMedia(kind, contentType, data) {
		return "", fmt.Errorf("上游返回的%s格式无效: content-type=%s", mediaKindLabel(kind), contentType)
	}
	ext := mediaExtForContentType(contentType, kind)
	safeName := strings.NewReplacer("/", "_", "\\", "_", " ", "_").Replace(itemName)
	objectName := fmt.Sprintf("works/%s/%s/%s_%d%s", kind, taskNo, safeName, time.Now().UnixNano(), ext)
	publicURL, err := objectStore.Upload(ctx, objectName, contentType, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	log.Printf("Task %s persisted external %s -> %s (%d bytes)", taskNo, kind, publicURL, len(data))
	return publicURL, nil
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
		// Never forward an upstream API key to a provider's result CDN.
		if sameOriginURL(mediaURL, conn.BaseURL) {
			applyConnectionHeaders(req, conn)
		}
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
	// 按媒体类型分别推断扩展名：此前统一兜底 .mp4 导致图片对象带 .mp4 后缀、audio/mpeg 误判为视频
	if kind == "image" {
		switch {
		case strings.Contains(ct, "png"):
			return ".png"
		case strings.Contains(ct, "webp"):
			return ".webp"
		case strings.Contains(ct, "gif"):
			return ".gif"
		case strings.Contains(ct, "jpeg"), strings.Contains(ct, "jpg"):
			return ".jpg"
		}
		return ".png"
	}
	if kind == "audio" {
		switch {
		case strings.Contains(ct, "wav"):
			return ".wav"
		case strings.Contains(ct, "ogg"):
			return ".ogg"
		case strings.Contains(ct, "m4a"), strings.Contains(ct, "aac"):
			return ".m4a"
		case strings.Contains(ct, "flac"):
			return ".flac"
		}
		return ".mp3"
	}
	switch {
	case strings.Contains(ct, "webm"):
		return ".webm"
	case strings.Contains(ct, "quicktime"), strings.Contains(ct, "mov"):
		return ".mov"
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
		Method:   http.MethodGet,
		Interval: 5 * time.Second,
		Timeout:  defaultPollTimeout,
	}
	up, _ := runtimeRule["upstream"].(map[string]interface{})
	if up == nil {
		return cfg
	}
	if s, ok := up["poll_path"].(string); ok && strings.TrimSpace(s) != "" {
		cfg.Path = strings.TrimSpace(s)
	}
	if method := strings.ToUpper(strings.TrimSpace(stringAny(up["poll_method"]))); method == http.MethodGet || method == http.MethodPost {
		cfg.Method = method
	}
	if body, ok := up["poll_body"].(map[string]interface{}); ok {
		cfg.Body = body
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
		case "queued", "pending", "not_start", "1":
			progress = 3
		case "in_progress", "processing", "running", "2", "3", "4":
			progress = 25
		case "succeeded", "success", "completed", "done", "finished", "5":
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

func pollUpstreamTask(ctx context.Context, pool *pgxpool.Pool, conn connectionConfig, cfg pollConfig, upstreamID, taskNo string) ([]mediaItem, upstreamUsageDetails, error) {
	pollConn := connectionForTaskPoll(conn)
	escapedID := url.PathEscape(upstreamID)
	pollURL := joinBaseEndpoint(conn.BaseURL, strings.Replace(cfg.Path, "{id}", escapedID, 1))
	pollMethod := strings.ToUpper(strings.TrimSpace(cfg.Method))
	if pollMethod == "" {
		pollMethod = http.MethodGet
	}
	deadline := time.Now().Add(cfg.Timeout)
	var lastStatus string
	var consecutiveErrors int
	var successPolls int
	const maxSuccessWait = 36
	attempt := 0
	for time.Now().Before(deadline) {
		attempt++
		var requestBody []byte
		if len(cfg.Body) > 0 {
			requestBody, _ = json.Marshal(cfg.Body)
			encodedID, _ := json.Marshal(upstreamID)
			requestBody = bytes.ReplaceAll(requestBody, []byte(`"{id}"`), encodedID)
		}
		body, statusCode, err := doJSONRequest(ctx, pollConn, pollMethod, pollURL, requestBody, 60*time.Second)
		if err != nil {
			consecutiveErrors++
			if attempt == 1 || attempt%6 == 0 {
				log.Printf("Task %s poll #%d request error: %v", taskNo, attempt, err)
			}
			time.Sleep(cfg.Interval)
			continue
		}
		if statusCode == 404 {
			return nil, upstreamUsageDetails{}, fmt.Errorf("上游任务不存在(404)，请检查 poll_path 与任务 ID")
		}
		if statusCode >= 400 {
			consecutiveErrors++
			if attempt == 1 || attempt%6 == 0 {
				log.Printf("Task %s poll #%d HTTP %d: %s", taskNo, attempt, statusCode, truncateText(string(body), 300))
			}
			if consecutiveErrors >= 12 {
				return nil, upstreamUsageDetails{}, fmt.Errorf("上游轮询持续失败(HTTP %d): %s", statusCode, truncateText(upstreamErrorMessage(body), 200))
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
		case "failed", "error", "cancelled", "canceled", "failure", "expired", "6":
			msg := firstString(raw, "error_message", "message", "error")
			if errorDetail, ok := raw["error"].(map[string]interface{}); ok {
				if detail := firstString(errorDetail, "message", "code"); detail != "" {
					msg = detail
				}
			}
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
			return nil, upstreamUsageDetails{}, fmt.Errorf("%s", humanizeUpstreamFailure(msg))
		case "succeeded", "success", "completed", "done", "finished", "5":
			if failMsg := upstreamContentFailure(raw); failMsg != "" {
				return nil, upstreamUsageDetails{}, fmt.Errorf("%s", failMsg)
			}
			if items := extractMediaItems(raw); len(items) > 0 {
				log.Printf("Task %s poll #%d got %d media item(s)", taskNo, attempt, len(items))
				return items, upstreamUsageFromBody(body), nil
			}
			if mediaURL := firstSuccessMediaURL(raw, upstreamID, conn); mediaURL != "" {
				log.Printf("Task %s poll #%d got media url: %s", taskNo, attempt, truncateText(mediaURL, 100))
				return []mediaItem{{URL: mediaURL}}, upstreamUsageFromBody(body), nil
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
			return nil, upstreamUsageDetails{}, fmt.Errorf("上游未返回可下载的视频地址，请稍后重试: %s", truncateText(string(body), 400))
		case "queued", "in_progress", "processing", "pending", "running", "not_start", "":
			// keep polling
		default:
			if attempt <= 3 || attempt%12 == 0 {
				log.Printf("Task %s poll #%d unknown status %q: %s", taskNo, attempt, status, truncateText(string(body), 200))
			}
		}
		time.Sleep(cfg.Interval)
	}
	return nil, upstreamUsageDetails{}, fmt.Errorf("生成超时（已轮询 %s），请稍后重试", cfg.Timeout)
}

type upstreamUsageDetails struct {
	PromptTokens       int
	OutputTokens       int
	VideoTokens        int
	InputSeconds       float64
	OutputSeconds      float64
	InputImageCount    int
	HasInputSeconds    bool
	HasOutputSeconds   bool
	HasInputImageCount bool
}

func (u upstreamUsageDetails) hasAny() bool {
	return u.PromptTokens > 0 || u.OutputTokens > 0 || u.VideoTokens > 0 || u.HasInputSeconds || u.HasOutputSeconds || u.HasInputImageCount
}

func inputWithActualUpstreamUsage(input map[string]interface{}, usage upstreamUsageDetails) map[string]interface{} {
	if usage.VideoTokens <= 0 && !usage.HasInputSeconds && !usage.HasOutputSeconds && !usage.HasInputImageCount {
		return input
	}
	out := make(map[string]interface{}, len(input)+4)
	for key, value := range input {
		out[key] = value
	}
	if usage.HasInputSeconds {
		out["_actual_input_seconds"] = usage.InputSeconds
	}
	if usage.HasOutputSeconds {
		out["_actual_output_seconds"] = usage.OutputSeconds
	}
	if usage.HasInputImageCount {
		out["_actual_input_image_count"] = usage.InputImageCount
	}
	if usage.VideoTokens > 0 {
		out["_actual_video_tokens"] = usage.VideoTokens
	}
	return out
}

func upstreamUsageTokens(body []byte) (int, int) {
	usage := upstreamUsageFromBody(body)
	return usage.PromptTokens, usage.OutputTokens
}

func upstreamUsageFromBody(body []byte) upstreamUsageDetails {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return upstreamUsageDetails{}
	}
	queue := []map[string]interface{}{raw}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if usage, ok := current["usage"].(map[string]interface{}); ok {
			details := upstreamUsageDetails{
				PromptTokens: intAny(firstNonNil(usage["prompt_tokens"], usage["input_tokens"], usage["text_tokens"])),
				OutputTokens: intAny(firstNonNil(usage["completion_tokens"], usage["output_tokens"], usage["audio_tokens"])),
				VideoTokens:  intAny(firstNonNil(usage["total_tokens"], usage["video_tokens"])),
			}
			if details.VideoTokens <= 0 {
				details.VideoTokens = details.OutputTokens
			}
			if details.OutputTokens <= 0 && details.VideoTokens > 0 {
				details.OutputTokens = details.VideoTokens
			}
			if value, exists := usage["input_seconds"]; exists {
				details.InputSeconds, details.HasInputSeconds = floatAny(value), true
			}
			if value, exists := usage["output_seconds"]; exists {
				details.OutputSeconds, details.HasOutputSeconds = floatAny(value), true
			}
			if value, exists := usage["input_image_count"]; exists {
				details.InputImageCount, details.HasInputImageCount = intAny(value), true
			}
			if !details.HasOutputSeconds {
				if value, exists := usage["total_seconds"]; exists {
					details.OutputSeconds = math.Max(0, floatAny(value)-details.InputSeconds)
					details.HasOutputSeconds = true
				}
			}
			if details.hasAny() {
				return details
			}
		}
		for _, key := range []string{"data", "result", "output", "task"} {
			if child, ok := current[key].(map[string]interface{}); ok {
				queue = append(queue, child)
			}
		}
	}
	return upstreamUsageDetails{}
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

// isFinalAsynqAttempt reports whether the current delivery is the last one
// asynq will make. On the final attempt a transient failure must still settle
// the task row and release the frozen balance, otherwise the task would be
// archived silently and the user's funds would stay frozen until an admin ran
// the 6-hour stale-task reconcile.
func isFinalAsynqAttempt(ctx context.Context) bool {
	retried, ok1 := asynq.GetRetryCount(ctx)
	maxRetry, ok2 := asynq.GetMaxRetry(ctx)
	if !ok1 || !ok2 {
		// Not running under an asynq handler (e.g. direct call in tests):
		// treat as final so we never skip settlement.
		return true
	}
	return retried >= maxRetry
}

// isTransientError checks if an error is temporary and should be retried
func isTransientError(code string, statusCode int, errMsg string) bool {
	// Transient HTTP status codes
	transientStatuses := map[int]bool{
		408: true, // Request Timeout
		429: true, // Too Many Requests
		500: true, // Internal Server Error
		502: true, // Bad Gateway
		503: true, // Service Unavailable
		504: true, // Gateway Timeout
		520: true, // Cloudflare Unknown Error
		521: true, // Web Server Is Down
		522: true, // Connection Timed Out
		524: true, // A Timeout Occurred
	}
	if transientStatuses[statusCode] {
		return true
	}

	// Transient error codes.
	// NOTE: MODEL_PROVIDER_ERROR is deliberately excluded — it is the worker's
	// catch-all code and is also used for permanent failures (upstream rejected
	// the request and cannot fail over, or the call succeeded but returned no
	// media). Those must not be retried. Transient provider failures are already
	// identified by their HTTP status code or message pattern below.
	transientCodes := map[string]bool{
		"MODEL_TIMEOUT":      true,
		"MODEL_RATE_LIMITED": true,
		"UPSTREAM_TIMEOUT":   true,
		"NETWORK_ERROR":      true,
		"CONNECTION_ERROR":   true,
	}
	if transientCodes[code] {
		return true
	}

	// Check error message for timeout/network patterns
	lowerMsg := strings.ToLower(errMsg)
	transientPatterns := []string{
		"timeout", "timed out", "deadline", "connection reset",
		"connection refused", "rate limit", "too many requests",
		"service unavailable", "bad gateway", "temporarily unavailable",
	}
	for _, pattern := range transientPatterns {
		if strings.Contains(lowerMsg, pattern) {
			return true
		}
	}

	return false
}

// RetryableError wraps transient errors to signal Asynq to retry
type RetryableError struct {
	Code       string
	Message    string
	StatusCode int
}

func (e *RetryableError) Error() string {
	return e.Message
}

func failTask(ctx context.Context, pool *pgxpool.Pool, p ImageTaskPayload, code, msg string) error {
	return failTaskWithStatusCode(ctx, pool, p, code, msg, 0)
}

func failTaskWithStatusCode(ctx context.Context, pool *pgxpool.Pool, p ImageTaskPayload, code, msg string, statusCode int) error {
	// Retry transient failures, but only while asynq still has attempts left.
	// On the last attempt fall through and settle the row + refund below.
	if isTransientError(code, statusCode, msg) && !isFinalAsynqAttempt(ctx) {
		log.Printf("Task %s transient error (code=%s status=%d), will retry: %s", p.TaskNo, code, statusCode, msg)
		return &RetryableError{
			Code:       code,
			Message:    msg,
			StatusCode: statusCode,
		}
	}

	// Permanent error - mark task as failed
	var estimated float64
	if err := pool.QueryRow(ctx, `SELECT estimated_cost FROM tasks WHERE task_no=$1`, p.TaskNo).Scan(&estimated); err != nil {
		return err
	}
	if err := unfreezeBillingWithFinalize(ctx, pool, p.UserID, estimated, "task", p.TaskNo, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE tasks SET status='failed', error_code=$1, error_message=$2, finished_at=now(), updated_at=now()
			WHERE task_no=$3 AND status IN ('pending','running')`, code, msg, p.TaskNo)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return fmt.Errorf("task is no longer active")
		}
		return nil
	}); err != nil {
		return fmt.Errorf("task %s release billing: %w", p.TaskNo, err)
	}
	insertNotification(ctx, pool, p.UserID, "生成失败",
		fmt.Sprintf("%s，任务号：%s", msg, p.TaskNo), "task")
	log.Printf("Task %s failed permanently: %s", p.TaskNo, msg)
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

func chargeBillingWithFinalize(ctx context.Context, pool *pgxpool.Pool, userID int64, freezeAmount, actualAmount float64, refType, refID, txType, remark string, finalize func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var balance, frozen float64
	if err = tx.QueryRow(ctx, `SELECT compute_balance, frozen_compute FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&balance, &frozen); err != nil {
		return err
	}
	lockedAmount, err := lockedFreezeAmount(ctx, tx, userID, refType, refID)
	if err != nil {
		return err
	}
	if lockedAmount <= 0 && actualAmount > 0 {
		return fmt.Errorf("active billing reservation not found for %s/%s", refType, refID)
	}
	if lockedAmount > 0 {
		_ = freezeAmount
		charge := actualAmount
		if charge < 0 {
			charge = 0
		}
		newBalance := balance - charge
		newFrozen := frozen - lockedAmount
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
	}
	if finalize != nil {
		if err = finalize(tx); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func unfreezeBillingWithFinalize(ctx context.Context, pool *pgxpool.Pool, userID int64, amount float64, refType, refID string, finalize func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT 1 FROM wallets WHERE user_id=$1 FOR UPDATE`, userID); err != nil {
		return err
	}
	lockedAmount, err := lockedFreezeAmount(ctx, tx, userID, refType, refID)
	if err != nil {
		return err
	}
	if lockedAmount > 0 {
		_ = amount
		if _, err = tx.Exec(ctx, `UPDATE wallets SET frozen_compute = GREATEST(frozen_compute - $1, 0), updated_at=now() WHERE user_id=$2`, lockedAmount, userID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE balance_freezes SET status='released', released_at=now() WHERE user_id=$1 AND ref_type=$2 AND ref_id=$3 AND status='frozen'`, userID, refType, refID); err != nil {
			return err
		}
	}
	if finalize != nil {
		if err = finalize(tx); err != nil {
			return err
		}
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

func getenvInt(key string, fallback int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
		log.Printf("warning: invalid integer for %s: %q, using fallback %d", key, v, fallback)
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
