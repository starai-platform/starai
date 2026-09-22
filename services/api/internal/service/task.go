package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/queue"
	"github.com/starai/api/internal/util"
)

type TaskService struct {
	db      *pgxpool.Pool
	models  *ModelService
	billing *billing.Service
	queue   *asynq.Client
	ops     *OpsService
}

func NewTaskService(db *pgxpool.Pool, models *ModelService, billing *billing.Service, q *asynq.Client, ops *OpsService) *TaskService {
	return &TaskService{db: db, models: models, billing: billing, queue: q, ops: ops}
}

type TaskDTO struct {
	TaskNo         string                 `json:"task_no"`
	UpstreamTaskID *string                `json:"upstream_task_id,omitempty"`
	Type           string                 `json:"type"`
	Status         string                 `json:"status"`
	Progress       int                    `json:"progress"`
	UpstreamStatus string                 `json:"upstream_status,omitempty"`
	ModelCode      *string                `json:"model_code,omitempty"`
	UserName       string                 `json:"user_name,omitempty"`
	UserEmail      string                 `json:"user_email,omitempty"`
	Input          map[string]interface{} `json:"input"`
	Output         map[string]interface{} `json:"output"`
	EstimatedCost  float64                `json:"estimated_cost"`
	ActualCost     float64                `json:"actual_cost"`
	ErrorCode      *string                `json:"error_code,omitempty"`
	ErrorMessage   *string                `json:"error_message,omitempty"`
	CreatedAt      string                 `json:"created_at"`
	FinishedAt     *string                `json:"finished_at,omitempty"`
}

type CreateTaskInput struct {
	ModelCode    string                 `json:"model_code"`
	Prompt       string                 `json:"prompt"`
	Params       map[string]interface{} `json:"params"`
	BillingLabel string                 `json:"-"`
}

type CreateComposeTaskInput struct {
	TargetDuration int                      `json:"target_duration_sec"`
	Sources        []map[string]interface{} `json:"sources"`
	Mode           string                   `json:"mode"`
	OutputSize     string                   `json:"output_size"`
	Subtitles      []ComposeSubtitleCue     `json:"subtitles,omitempty"`
	SubtitleStyle  string                   `json:"subtitle_style,omitempty"`
	SubtitleTiming string                   `json:"subtitle_timing,omitempty"`
}

type ComposeSubtitleCue struct {
	StartSec       float64 `json:"start_sec"`
	EndSec         float64 `json:"end_sec"`
	Text           string  `json:"text"`
	SecondaryText  string  `json:"secondary_text,omitempty"`
	SpeechStartSec float64 `json:"speech_start_sec,omitempty"`
	SpeechEndSec   float64 `json:"speech_end_sec,omitempty"`
}

func validateComposeTaskInput(input *CreateComposeTaskInput) error {
	if input.TargetDuration < 0 || input.TargetDuration > 600 {
		return errors.New("合成目标时长必须为0–600秒")
	}
	input.Mode = strings.ToLower(strings.TrimSpace(input.Mode))
	if input.Mode == "" {
		input.Mode = "auto"
	}
	if input.Mode != "auto" && input.Mode != "concat" && input.Mode != "mux" && input.Mode != "speech" && input.Mode != "synced" {
		return errors.New("不支持的合成方式")
	}
	input.OutputSize = strings.ToLower(strings.TrimSpace(input.OutputSize))
	if input.OutputSize == "" {
		input.OutputSize = "keep"
	}
	allowedSizes := map[string]bool{
		"keep": true, "1920x1080": true, "1080x1920": true,
		"1080x1080": true, "720x1280": true, "720x480": true,
	}
	if !allowedSizes[input.OutputSize] {
		return errors.New("不支持的合成输出尺寸")
	}
	if len(input.Subtitles) > 500 {
		return errors.New("单次最多添加500条字幕")
	}
	if input.SubtitleStyle != "" && input.SubtitleStyle != "clean" && input.SubtitleStyle != "soft_box" && input.SubtitleStyle != "bold" {
		return errors.New("不支持的字幕样式")
	}
	if input.SubtitleTiming != "" && input.SubtitleTiming != "script" && input.SubtitleTiming != "speech" {
		return errors.New("不支持的字幕时间方式")
	}
	totalSubtitleRunes := 0
	for index := range input.Subtitles {
		cue := &input.Subtitles[index]
		cue.Text = strings.TrimSpace(cue.Text)
		cue.SecondaryText = strings.TrimSpace(cue.SecondaryText)
		totalSubtitleRunes += len([]rune(cue.Text)) + len([]rune(cue.SecondaryText))
		if cue.Text == "" || cue.StartSec < 0 || cue.EndSec <= cue.StartSec || cue.EndSec > 600 {
			return errors.New("字幕时间或文本无效")
		}
		if cue.SpeechStartSec < 0 || cue.SpeechEndSec > 600 || (cue.SpeechStartSec != 0 || cue.SpeechEndSec != 0) && (cue.SpeechStartSec > cue.StartSec || cue.SpeechEndSec < cue.EndSec) {
			return errors.New("字幕发声区间无效")
		}
	}
	if totalSubtitleRunes > 30000 {
		return errors.New("字幕文本过长")
	}
	counts := map[string]int{}
	for _, source := range input.Sources {
		kind := strings.ToLower(strings.TrimSpace(fmt.Sprint(source["kind"])))
		if kind != "image" && kind != "video" && kind != "audio" {
			return errors.New("合成素材类型无效")
		}
		counts[kind]++
	}
	if len(input.Subtitles) > 0 && counts["video"] == 0 {
		return errors.New("字幕只能添加到视频合成任务")
	}
	switch input.Mode {
	case "synced":
		if counts["video"] != 1 || counts["audio"] != 1 || counts["image"] > 0 || input.TargetDuration <= 0 {
			return errors.New("同步结果校验需要一个视频和原配音，以及正整数目标秒数")
		}
	case "speech":
		if counts["video"] != 1 || counts["image"] > 0 || input.TargetDuration <= 0 {
			return errors.New("逐镜配音需要一个视频、可选配音和正整数目标秒数")
		}
	case "concat":
		kindCount := 0
		for _, kind := range []string{"image", "video", "audio"} {
			if counts[kind] > 0 {
				kindCount++
			}
		}
		if kindCount != 1 || len(input.Sources) < 2 {
			return errors.New("顺序拼接需要至少两个同类型素材")
		}
	case "mux":
		if counts["video"] == 0 || counts["audio"] != 1 || counts["image"] > 0 {
			return errors.New("音视频合成需要至少一个视频和一个音频，且仅支持一条音轨")
		}
	default:
		if counts["image"] > 0 && (counts["video"] > 0 || counts["audio"] > 0) {
			return errors.New("图片不能与视频或音频直接自动合成，请先将图片生成视频")
		}
	}
	return nil
}

func (s *TaskService) CreateCompose(ctx context.Context, userID int64, input CreateComposeTaskInput) (*TaskDTO, error) {
	if len(input.Sources) == 0 {
		return nil, errors.New("请至少连接一个可合成的媒体节点")
	}
	if len(input.Sources) > 100 {
		return nil, errors.New("单次最多合成 100 个媒体素材")
	}
	if err := validateComposeTaskInput(&input); err != nil {
		return nil, err
	}
	taskNo := util.NewTaskNo()
	params := map[string]interface{}{
		"sources":             input.Sources,
		"mode":                input.Mode,
		"output_size":         input.OutputSize,
		"target_duration_sec": input.TargetDuration,
	}
	if len(input.Subtitles) > 0 {
		params["subtitles"] = input.Subtitles
		params["subtitle_style"] = input.SubtitleStyle
		params["subtitle_timing"] = input.SubtitleTiming
	}
	inputJSON, _ := json.Marshal(params)
	var taskID int64
	if err := s.db.QueryRow(ctx, `
		INSERT INTO tasks (task_no, user_id, model_id, type, status, input, estimated_cost)
		VALUES ($1,$2,NULL,'compose','pending',$3,0) RETURNING id`,
		taskNo, userID, inputJSON).Scan(&taskID); err != nil {
		return nil, err
	}
	s.addEvent(ctx, taskID, "created", map[string]interface{}{"estimated_cost": 0, "type": "compose"})
	if err := queue.EnqueueComposeTask(s.queue, queue.ComposeTaskPayload{TaskNo: taskNo, UserID: userID, Input: params}); err != nil {
		s.FailTask(ctx, taskNo, "QUEUE_ERROR", "合成任务入队失败")
		return nil, err
	}
	now := time.Now().Format(time.RFC3339)
	return &TaskDTO{
		TaskNo: taskNo, Type: "compose", Status: "pending", Input: params,
		EstimatedCost: 0, CreatedAt: now,
	}, nil
}

func (s *TaskService) Create(ctx context.Context, userID int64, input CreateTaskInput) (*TaskDTO, error) {
	model, err := s.models.GetFullByCode(ctx, input.ModelCode)
	if err != nil {
		return nil, err
	}
	if model.RequestMode != "images" && model.RequestMode != "video" && model.RequestMode != "audio" {
		return nil, errors.New("该模型不支持异步任务")
	}
	taskType := "image"
	if model.RequestMode == "video" {
		taskType = "video"
	} else if model.RequestMode == "audio" {
		taskType = "audio"
	}
	params := make(map[string]interface{})
	for k, v := range model.DefaultParams {
		params[k] = v
	}
	for k, v := range input.Params {
		if k == "_billing_label" {
			continue
		}
		params[k] = v
	}
	if label := strings.TrimSpace(input.BillingLabel); label != "" {
		params["_billing_label"] = label
	}
	if _, ok := params["user_prompt"]; !ok {
		params["user_prompt"] = input.Prompt
	}
	params["prompt"] = input.Prompt
	if taskType == "image" {
		if err := validateImageTaskParams(model, params); err != nil {
			return nil, err
		}
	} else if taskType == "video" {
		if err := ValidateVideoParams(model, params); err != nil {
			return nil, err
		}
	} else if taskType == "audio" {
		if err := validateAudioTaskParams(model, params); err != nil {
			return nil, err
		}
	}

	estimated := s.models.EstimateCost(model, params, 0, 0)
	taskNo := util.NewTaskNo()

	inputJSON, _ := json.Marshal(params)
	var taskID int64
	if err := s.billing.FreezeWithFinalize(ctx, userID, estimated, "task", taskNo, func(tx pgx.Tx) error {
		if err := validateAgentSubmissionTx(ctx, tx, userID, params); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			INSERT INTO tasks (task_no, user_id, model_id, type, status, input, estimated_cost)
			VALUES ($1,$2,$3,$4,'pending',$5,$6) RETURNING id`,
			taskNo, userID, model.ID, taskType, inputJSON, estimated).Scan(&taskID)
	}); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return s.createBalanceFailedTask(ctx, userID, model.ID, taskType, taskNo, inputJSON, estimated)
		}
		return nil, err
	}

	s.addEvent(ctx, taskID, "created", map[string]interface{}{"estimated_cost": estimated})

	payload := queue.ImageTaskPayload{
		TaskNo: taskNo, UserID: userID, ModelID: model.ID, ModelCode: model.Code, Input: params,
	}
	if err := queue.EnqueueImageTask(s.queue, payload); err != nil {
		if cleanupErr := s.FailTask(ctx, taskNo, "QUEUE_ERROR", "任务入队失败"); cleanupErr != nil {
			return nil, fmt.Errorf("任务入队失败: %v；回滚冻结额度失败: %w", err, cleanupErr)
		}
		return nil, err
	}

	now := time.Now().Format(time.RFC3339)
	var inputMap map[string]interface{}
	json.Unmarshal(inputJSON, &inputMap)
	return &TaskDTO{
		TaskNo: taskNo, Type: taskType, Status: "pending", Input: inputMap,
		EstimatedCost: estimated, CreatedAt: now,
	}, nil
}

func (s *TaskService) createBalanceFailedTask(ctx context.Context, userID, modelID int64, taskType, taskNo string, inputJSON []byte, estimated float64) (*TaskDTO, error) {
	errCode := "INSUFFICIENT_BALANCE"
	errMsg := billing.InsufficientBalanceMsg
	var taskID int64
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var confirmation map[string]interface{}
	if err := json.Unmarshal(inputJSON, &confirmation); err != nil {
		return nil, err
	}
	if err := validateAgentSubmissionTx(ctx, tx, userID, confirmation); err != nil {
		return nil, err
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO tasks (task_no, user_id, model_id, type, status, input, estimated_cost, error_code, error_message, finished_at)
		VALUES ($1,$2,$3,$4,'failed',$5,$6,$7,$8,now()) RETURNING id`,
		taskNo, userID, modelID, taskType, inputJSON, estimated, errCode, errMsg).Scan(&taskID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.addEvent(ctx, taskID, "failed", map[string]interface{}{"reason": errMsg, "code": errCode})
	if s.ops != nil {
		_ = s.ops.CreateNotification(ctx, userID, "任务创建失败", errMsg+"，任务号："+taskNo, "billing")
	}
	now := time.Now().Format(time.RFC3339)
	var inputMap map[string]interface{}
	json.Unmarshal(inputJSON, &inputMap)
	return &TaskDTO{
		TaskNo: taskNo, Type: taskType, Status: "failed", Input: inputMap,
		EstimatedCost: estimated, ErrorCode: &errCode, ErrorMessage: &errMsg,
		CreatedAt: now, FinishedAt: &now,
	}, nil
}

func maxReferenceImages(model *ModelFull) int {
	raw := interface{}(nil)
	if imageRule, ok := model.RuntimeRule["image"].(map[string]interface{}); ok {
		raw = imageRule["max_reference_images"]
	}
	if raw == nil {
		raw = model.DefaultParams["max_reference_images"]
	}
	if raw == nil {
		return 4
	}
	n := 0
	switch v := raw.(type) {
	case float64:
		n = int(v)
	case int:
		n = v
	case string:
		parsed, err := strconv.Atoi(v)
		if err == nil {
			n = parsed
		} else {
			n = 4
		}
	default:
		n = 4
	}
	if n < 0 {
		return 0
	}
	if n > 20 {
		return 20
	}
	return n
}

func referenceImageCount(refs interface{}) int {
	switch v := refs.(type) {
	case []interface{}:
		return len(v)
	case []string:
		return len(v)
	default:
		return 0
	}
}

func (s *TaskService) Get(ctx context.Context, userID int64, taskNo string) (*TaskDTO, error) {
	return s.getTask(ctx, "t.user_id=$1 AND t.task_no=$2", userID, taskNo)
}

func (s *TaskService) GetAdmin(ctx context.Context, taskNo string) (*TaskDTO, error) {
	return s.getTask(ctx, "t.task_no=$1", taskNo)
}

const taskReadSelect = `SELECT t.task_no, t.upstream_task_id, t.type, t.status, m.code, t.input, t.output, t.estimated_cost, t.actual_cost, t.error_code, t.error_message, t.created_at, t.finished_at
		, COALESCE(progress.payload->>'progress', ''), COALESCE(progress.payload->>'status', '')
		FROM tasks t LEFT JOIN models m ON m.id = t.model_id
		LEFT JOIN LATERAL (
			SELECT e.payload FROM task_events e
			WHERE e.task_id=t.id AND e.event_type='progress'
			  AND t.status NOT IN ('succeeded', 'failed', 'cancelled')
			ORDER BY e.created_at DESC, e.id DESC LIMIT 1
		) progress ON true WHERE `

type taskRowScanner interface {
	Scan(dest ...interface{}) error
}

func scanTaskRead(row taskRowScanner) (*TaskDTO, error) {
	var t TaskDTO
	var input, output []byte
	var created time.Time
	var finished *time.Time
	var progress, upstreamStatus string
	var upstreamTaskID *string
	if err := row.Scan(
		&t.TaskNo, &upstreamTaskID, &t.Type, &t.Status, &t.ModelCode, &input, &output, &t.EstimatedCost, &t.ActualCost,
		&t.ErrorCode, &t.ErrorMessage, &created, &finished, &progress, &upstreamStatus); err != nil {
		return nil, err
	}
	if upstreamTaskID != nil && *upstreamTaskID != "" {
		t.UpstreamTaskID = upstreamTaskID
	}
	_ = json.Unmarshal(input, &t.Input)
	_ = json.Unmarshal(output, &t.Output)
	t.CreatedAt = created.Format(time.RFC3339)
	if finished != nil {
		formatted := finished.Format(time.RFC3339)
		t.FinishedAt = &formatted
	}
	t.Progress = taskProgress(t.Status, progress, true)
	if t.Status == "running" || t.Status == "pending" {
		t.UpstreamStatus = upstreamStatus
	}
	return &t, nil
}

func (s *TaskService) getTask(ctx context.Context, where string, args ...interface{}) (*TaskDTO, error) {
	return scanTaskRead(s.db.QueryRow(ctx, taskReadSelect+where, args...))
}

// GetMany reads all visible task snapshots in one query and returns them in
// caller order. Canvas recovery uses this to avoid one HTTP and SQL query per
// generated page or clip.
func (s *TaskService) GetMany(ctx context.Context, userID int64, taskNos []string) ([]TaskDTO, error) {
	if len(taskNos) == 0 {
		return []TaskDTO{}, nil
	}
	if len(taskNos) > 100 {
		return nil, errors.New("单次最多查询100个任务")
	}
	unique := make([]string, 0, len(taskNos))
	seen := make(map[string]bool, len(taskNos))
	for _, taskNo := range taskNos {
		taskNo = strings.TrimSpace(taskNo)
		if taskNo != "" && !seen[taskNo] {
			seen[taskNo] = true
			unique = append(unique, taskNo)
		}
	}
	rows, err := s.db.Query(ctx, taskReadSelect+`t.user_id=$1 AND t.task_no=ANY($2)`, userID, unique)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byNumber := make(map[string]TaskDTO, len(unique))
	for rows.Next() {
		task, scanErr := scanTaskRead(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		byNumber[task.TaskNo] = *task
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	items := make([]TaskDTO, 0, len(byNumber))
	for _, taskNo := range unique {
		if task, ok := byNumber[taskNo]; ok {
			items = append(items, task)
		}
	}
	return items, nil
}

// Agent media snapshots historically treat cancellation differently from task details.
// Keep that behavior while sharing progress parsing and avoiding extra queries.
func taskProgress(status, raw string, cancelledIsTerminal bool) int {
	if status == "succeeded" || status == "failed" || (cancelledIsTerminal && status == "cancelled") {
		return 100
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 32)
	progress := int(parsed)
	if err == nil && progress > 0 {
		if progress > 99 {
			return 99
		}
		return progress
	}
	if status == "running" || status == "processing" || status == "in_progress" {
		return 25
	}
	return 8
}

func (s *TaskService) List(ctx context.Context, userID int64, page, pageSize int, modelCode, taskType string) ([]TaskDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	args := []interface{}{userID}
	where := "t.user_id=$1"
	if modelCode != "" {
		args = append(args, modelCode)
		where += fmt.Sprintf(" AND m.code=$%d", len(args))
	}
	if taskType != "" {
		args = append(args, taskType)
		where += fmt.Sprintf(" AND t.type=$%d", len(args))
	}
	var total int
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM tasks t LEFT JOIN models m ON m.id=t.model_id WHERE `+where, args...).Scan(&total)
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(ctx, `
		SELECT t.task_no, t.upstream_task_id, t.type, t.status, m.code, t.input, t.output, t.estimated_cost, t.actual_cost, t.error_code, t.error_message, t.created_at, t.finished_at
		FROM tasks t LEFT JOIN models m ON m.id=t.model_id WHERE `+where+fmt.Sprintf(` ORDER BY t.created_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	return scanTasks(rows, total, false)
}

func (s *TaskService) ListAdmin(ctx context.Context, page, pageSize int, status string) ([]TaskDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	where := "1=1"
	args := []interface{}{}
	argN := 1
	if status != "" {
		where += " AND t.status=$" + itoa(argN)
		args = append(args, status)
		argN++
	}
	var total int
	s.db.QueryRow(ctx, "SELECT COUNT(*) FROM tasks t WHERE "+where, args...).Scan(&total)
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(ctx, `
		SELECT t.task_no, t.upstream_task_id, t.type, t.status, m.code, t.input, t.output, t.estimated_cost, t.actual_cost, t.error_code, t.error_message, t.created_at, t.finished_at,
		       COALESCE(u.nickname, ''), COALESCE((SELECT a.identifier FROM auth_identities a WHERE a.user_id=u.id AND a.provider='email' ORDER BY a.id LIMIT 1), '')
		FROM tasks t LEFT JOIN models m ON m.id=t.model_id JOIN users u ON u.id=t.user_id WHERE `+where+` ORDER BY t.created_at DESC LIMIT $`+itoa(argN)+` OFFSET $`+itoa(argN+1), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	return scanTasks(rows, total, true)
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

func scanTasks(rows pgx.Rows, total int, includeUser bool) ([]TaskDTO, int, error) {
	var items []TaskDTO
	for rows.Next() {
		var t TaskDTO
		var input, output []byte
		var created time.Time
		var finished *time.Time
		var upstreamTaskID *string
		dest := []interface{}{&t.TaskNo, &upstreamTaskID, &t.Type, &t.Status, &t.ModelCode, &input, &output, &t.EstimatedCost, &t.ActualCost,
			&t.ErrorCode, &t.ErrorMessage, &created, &finished}
		if includeUser {
			dest = append(dest, &t.UserName, &t.UserEmail)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, 0, err
		}
		if upstreamTaskID != nil && *upstreamTaskID != "" {
			t.UpstreamTaskID = upstreamTaskID
		}
		json.Unmarshal(input, &t.Input)
		json.Unmarshal(output, &t.Output)
		t.CreatedAt = created.Format(time.RFC3339)
		if finished != nil {
			fs := finished.Format(time.RFC3339)
			t.FinishedAt = &fs
		}
		items = append(items, t)
	}
	return items, total, nil
}

func (s *TaskService) Cancel(ctx context.Context, userID int64, taskNo string) error {
	return s.cancelTask(ctx, taskNo, &userID, false)
}

func (s *TaskService) CancelByAdmin(ctx context.Context, taskNo string) error {
	return s.cancelTask(ctx, taskNo, nil, true)
}

func (s *TaskService) cancelTask(ctx context.Context, taskNo string, expectedUserID *int64, byAdmin bool) error {
	var taskID, userID int64
	var estimated float64
	err := s.db.QueryRow(ctx, `SELECT id, user_id, estimated_cost FROM tasks WHERE task_no=$1`, taskNo).Scan(&taskID, &userID, &estimated)
	if err != nil {
		return err
	}
	if expectedUserID != nil && userID != *expectedUserID {
		return pgx.ErrNoRows
	}
	err = s.billing.UnfreezeWithFinalize(ctx, userID, estimated, "task", taskNo, func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(ctx, `SELECT status FROM tasks WHERE id=$1 FOR UPDATE`, taskID).Scan(&status); err != nil {
			return err
		}
		if status != "pending" && status != "running" {
			return errors.New("任务无法取消")
		}
		var lockAvailable bool
		if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, -taskID).Scan(&lockAvailable); err != nil {
			return err
		}
		if !lockAvailable && !byAdmin {
			return errors.New("任务正在生成，暂时无法安全取消")
		}
		// 管理员强制取消不等锁：worker 收尾写入带 status='running' 条件，
		// 任务被取消后迟到结果不会覆盖状态，也不会重复扣费。
		tag, err := tx.Exec(ctx, `UPDATE tasks SET status='cancelled', finished_at=now(), updated_at=now() WHERE id=$1 AND status IN ('pending','running')`, taskID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("任务无法取消")
		}
		return nil
	})
	if err != nil {
		return err
	}
	by := "user"
	if byAdmin {
		by = "admin"
	}
	s.addEvent(ctx, taskID, "cancelled", map[string]interface{}{"by": by})
	return nil
}

func (s *TaskService) Retry(ctx context.Context, taskNo string) error {
	var userID, modelID int64
	var input []byte
	var status string
	err := s.db.QueryRow(ctx, `SELECT user_id, model_id, input, status FROM tasks WHERE task_no=$1`, taskNo).Scan(&userID, &modelID, &input, &status)
	if err != nil {
		return err
	}
	if status != "failed" {
		return errors.New("仅失败任务可重试")
	}
	var params map[string]interface{}
	if err := json.Unmarshal(input, &params); err != nil {
		return err
	}
	var modelCode string
	if err := s.db.QueryRow(ctx, `SELECT code FROM models WHERE id=$1`, modelID).Scan(&modelCode); err != nil {
		return err
	}
	model, err := s.models.GetFullByCode(ctx, modelCode)
	if err != nil {
		return err
	}
	estimated := s.models.EstimateCost(model, params, 0, 0)
	if err := s.billing.FreezeWithFinalize(ctx, userID, estimated, "task", taskNo, func(tx pgx.Tx) error {
		var lockedStatus string
		if err := tx.QueryRow(ctx, `SELECT status FROM tasks WHERE task_no=$1 FOR UPDATE`, taskNo).Scan(&lockedStatus); err != nil {
			return err
		}
		if lockedStatus != "failed" {
			return errors.New("仅失败任务可重试")
		}
		tag, err := tx.Exec(ctx, `UPDATE tasks SET status='pending', estimated_cost=$1, actual_cost=0, error_code=NULL, error_message=NULL, finished_at=NULL, retry_count=retry_count+1, updated_at=now() WHERE task_no=$2 AND status='failed'`, estimated, taskNo)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("仅失败任务可重试")
		}
		return nil
	}); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return errors.New(billing.InsufficientBalanceMsg)
		}
		return err
	}
	payload := queue.ImageTaskPayload{TaskNo: taskNo, UserID: userID, ModelID: modelID, ModelCode: modelCode, Input: params}
	if err := queue.EnqueueImageTask(s.queue, payload); err != nil {
		if cleanupErr := s.FailTask(ctx, taskNo, "QUEUE_ERROR", "Task enqueue failed during retry"); cleanupErr != nil {
			return fmt.Errorf("任务重试入队失败: %v；回滚冻结额度失败: %w", err, cleanupErr)
		}
		return err
	}
	return nil
}

func (s *TaskService) FailTask(ctx context.Context, taskNo, errCode, errMsg string) error {
	var userID int64
	var estimated float64
	if err := s.db.QueryRow(ctx, `SELECT user_id, estimated_cost FROM tasks WHERE task_no=$1`, taskNo).Scan(&userID, &estimated); err != nil {
		return err
	}
	return s.billing.UnfreezeWithFinalize(ctx, userID, estimated, "task", taskNo, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE tasks SET status='failed', error_code=$1, error_message=$2, finished_at=now(), updated_at=now()
			WHERE task_no=$3 AND status='pending'`,
			errCode, errMsg, taskNo)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("任务状态已变化，未释放冻结额度")
		}
		return nil
	})
}

func (s *TaskService) addEvent(ctx context.Context, taskID int64, eventType string, payload map[string]interface{}) {
	data, _ := json.Marshal(payload)
	s.db.Exec(ctx, `INSERT INTO task_events (task_id, event_type, payload) VALUES ($1,$2,$3)`, taskID, eventType, data)
}

func (s *TaskService) ListEvents(ctx context.Context, userID int64, taskNo string) ([]map[string]interface{}, error) {
	var taskID int64
	err := s.db.QueryRow(ctx, `SELECT id FROM tasks WHERE task_no=$1 AND user_id=$2`, taskNo, userID).Scan(&taskID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT event_type, payload, created_at FROM task_events WHERE task_id=$1 ORDER BY created_at`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []map[string]interface{}
	for rows.Next() {
		var eventType string
		var payload []byte
		var created time.Time
		rows.Scan(&eventType, &payload, &created)
		var p map[string]interface{}
		json.Unmarshal(payload, &p)
		events = append(events, map[string]interface{}{
			"event_type": eventType, "payload": p, "created_at": created.Format(time.RFC3339),
		})
	}
	return events, nil
}
