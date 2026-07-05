package queue

import (
	"encoding/json"
	"time"

	"github.com/hibiken/asynq"
)

const (
	TypeImageTask    = "image:generate"
	TypeWorkflowTask = "workflow:run"
	QueueDefault     = "default"
	QueueImage       = "image"
	QueueWorkflow    = "workflow"
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

func NewClient(redisURL string) (*asynq.Client, error) {
	opt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, err
	}
	return asynq.NewClient(opt), nil
}

func EnqueueImageTask(client *asynq.Client, payload ImageTaskPayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	task := asynq.NewTask(TypeImageTask, data)
	// 视频异步轮询最长约 60 分钟，需高于 asynq 默认 30 分钟任务超时。
	_, err = client.Enqueue(task, asynq.Queue(QueueImage), asynq.MaxRetry(3), asynq.Timeout(90*time.Minute))
	return err
}

func EnqueueWorkflowTask(client *asynq.Client, payload WorkflowTaskPayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	task := asynq.NewTask(TypeWorkflowTask, data)
	_, err = client.Enqueue(task, asynq.Queue(QueueWorkflow), asynq.MaxRetry(1))
	return err
}
