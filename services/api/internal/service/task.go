package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
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
	ModelCode      *string                `json:"model_code,omitempty"`
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
	ModelCode string                 `json:"model_code"`
	Prompt    string                 `json:"prompt"`
	Params    map[string]interface{} `json:"params"`
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
		params[k] = v
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
	if err := s.billing.Freeze(ctx, userID, estimated, "task", taskNo); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return s.createBalanceFailedTask(ctx, userID, model.ID, taskType, taskNo, inputJSON, estimated)
		}
		return nil, err
	}
	var taskID int64
	err = s.db.QueryRow(ctx, `
		INSERT INTO tasks (task_no, user_id, model_id, type, status, input, estimated_cost)
		VALUES ($1,$2,$3,$4,'pending',$5,$6) RETURNING id`,
		taskNo, userID, model.ID, taskType, inputJSON, estimated).Scan(&taskID)
	if err != nil {
		s.billing.Unfreeze(ctx, userID, estimated, "task", taskNo)
		return nil, err
	}

	s.addEvent(ctx, taskID, "created", map[string]interface{}{"estimated_cost": estimated})

	payload := queue.ImageTaskPayload{
		TaskNo: taskNo, UserID: userID, ModelID: model.ID, ModelCode: model.Code, Input: params,
	}
	if err := queue.EnqueueImageTask(s.queue, payload); err != nil {
		s.FailTask(ctx, taskNo, "QUEUE_ERROR", "任务入队失败")
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
	err := s.db.QueryRow(ctx, `
		INSERT INTO tasks (task_no, user_id, model_id, type, status, input, estimated_cost, error_code, error_message, finished_at)
		VALUES ($1,$2,$3,$4,'failed',$5,$6,$7,$8,now()) RETURNING id`,
		taskNo, userID, modelID, taskType, inputJSON, estimated, errCode, errMsg).Scan(&taskID)
	if err != nil {
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

func (s *TaskService) getTask(ctx context.Context, where string, args ...interface{}) (*TaskDTO, error) {
	var t TaskDTO
	var input, output []byte
	var created time.Time
	var finished *time.Time
	q := `SELECT t.task_no, t.upstream_task_id, t.type, t.status, m.code, t.input, t.output, t.estimated_cost, t.actual_cost, t.error_code, t.error_message, t.created_at, t.finished_at
		FROM tasks t LEFT JOIN models m ON m.id = t.model_id WHERE ` + where
	var upstreamTaskID *string
	err := s.db.QueryRow(ctx, q, args...).Scan(
		&t.TaskNo, &upstreamTaskID, &t.Type, &t.Status, &t.ModelCode, &input, &output, &t.EstimatedCost, &t.ActualCost,
		&t.ErrorCode, &t.ErrorMessage, &created, &finished)
	if upstreamTaskID != nil && *upstreamTaskID != "" {
		t.UpstreamTaskID = upstreamTaskID
	}
	if err != nil {
		return nil, err
	}
	json.Unmarshal(input, &t.Input)
	json.Unmarshal(output, &t.Output)
	t.CreatedAt = created.Format(time.RFC3339)
	if finished != nil {
		fs := finished.Format(time.RFC3339)
		t.FinishedAt = &fs
	}
	return &t, nil
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
	return scanTasks(rows, total)
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
		SELECT t.task_no, t.upstream_task_id, t.type, t.status, m.code, t.input, t.output, t.estimated_cost, t.actual_cost, t.error_code, t.error_message, t.created_at, t.finished_at
		FROM tasks t LEFT JOIN models m ON m.id=t.model_id WHERE `+where+` ORDER BY t.created_at DESC LIMIT $`+itoa(argN)+` OFFSET $`+itoa(argN+1), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	return scanTasks(rows, total)
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

func scanTasks(rows pgx.Rows, total int) ([]TaskDTO, int, error) {
	var items []TaskDTO
	for rows.Next() {
		var t TaskDTO
		var input, output []byte
		var created time.Time
		var finished *time.Time
		var upstreamTaskID *string
		if err := rows.Scan(&t.TaskNo, &upstreamTaskID, &t.Type, &t.Status, &t.ModelCode, &input, &output, &t.EstimatedCost, &t.ActualCost,
			&t.ErrorCode, &t.ErrorMessage, &created, &finished); err != nil {
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
	var status string
	var estimated float64
	err := s.db.QueryRow(ctx, `SELECT status, estimated_cost FROM tasks WHERE task_no=$1 AND user_id=$2`, taskNo, userID).Scan(&status, &estimated)
	if err != nil {
		return err
	}
	if status != "pending" && status != "running" {
		return errors.New("任务无法取消")
	}
	_, err = s.db.Exec(ctx, `UPDATE tasks SET status='cancelled', finished_at=now(), updated_at=now() WHERE task_no=$1`, taskNo)
	if err != nil {
		return err
	}
	return s.billing.Unfreeze(ctx, userID, estimated, "task", taskNo)
}

func (s *TaskService) CancelByAdmin(ctx context.Context, taskNo string) error {
	var userID int64
	var status string
	var estimated float64
	var taskID int64
	err := s.db.QueryRow(ctx, `SELECT id, user_id, status, estimated_cost FROM tasks WHERE task_no=$1`, taskNo).Scan(&taskID, &userID, &status, &estimated)
	if err != nil {
		return err
	}
	if status != "pending" && status != "running" {
		return errors.New("任务无法取消")
	}
	_, err = s.db.Exec(ctx, `UPDATE tasks SET status='cancelled', finished_at=now(), updated_at=now() WHERE task_no=$1`, taskNo)
	if err != nil {
		return err
	}
	s.addEvent(ctx, taskID, "cancelled", map[string]interface{}{"by": "admin"})
	return s.billing.Unfreeze(ctx, userID, estimated, "task", taskNo)
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
	json.Unmarshal(input, &params)
	var modelCode string
	s.db.QueryRow(ctx, `SELECT code FROM models WHERE id=$1`, modelID).Scan(&modelCode)
	model, _ := s.models.GetFullByCode(ctx, modelCode)
	estimated := s.models.EstimateCost(model, params, 0, 0)
	if err := s.billing.Freeze(ctx, userID, estimated, "task", taskNo); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return errors.New(billing.InsufficientBalanceMsg)
		}
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE tasks SET status='pending', error_code=NULL, error_message=NULL, retry_count=retry_count+1, updated_at=now() WHERE task_no=$1`, taskNo)
	if err != nil {
		_ = s.billing.Unfreeze(ctx, userID, estimated, "task", taskNo)
		return err
	}
	payload := queue.ImageTaskPayload{TaskNo: taskNo, UserID: userID, ModelID: modelID, ModelCode: modelCode, Input: params}
	if err := queue.EnqueueImageTask(s.queue, payload); err != nil {
		_ = s.billing.Unfreeze(ctx, userID, estimated, "task", taskNo)
		_, _ = s.db.Exec(ctx, `UPDATE tasks SET status='failed', error_code='QUEUE_ERROR', error_message='Task enqueue failed during retry', finished_at=now(), updated_at=now() WHERE task_no=$1`, taskNo)
		return err
	}
	return nil
}

func (s *TaskService) FailTask(ctx context.Context, taskNo, errCode, errMsg string) error {
	var userID int64
	var estimated float64
	s.db.QueryRow(ctx, `SELECT user_id, estimated_cost FROM tasks WHERE task_no=$1`, taskNo).Scan(&userID, &estimated)
	_, err := s.db.Exec(ctx, `
		UPDATE tasks SET status='failed', error_code=$1, error_message=$2, finished_at=now(), updated_at=now() WHERE task_no=$3`,
		errCode, errMsg, taskNo)
	if err != nil {
		return err
	}
	return s.billing.Unfreeze(ctx, userID, estimated, "task", taskNo)
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
