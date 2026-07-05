package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/starai/api/internal/billing"
	"github.com/starai/api/internal/queue"
	"github.com/starai/api/internal/util"
)

type AgentService struct {
	db      *pgxpool.Pool
	billing *billing.Service
	queue   *asynq.Client
}

func NewAgentService(db *pgxpool.Pool, billing *billing.Service, q *asynq.Client) *AgentService {
	return &AgentService{db: db, billing: billing, queue: q}
}

type WorkflowNode struct {
	ID             string  `json:"id"`
	Type           string  `json:"type"`
	Name           string  `json:"name"`
	ModelCode      string  `json:"model_code"`
	PromptTemplate string  `json:"prompt_template"`
	Cost           float64 `json:"cost"`
}

type WorkflowDTO struct {
	Code          string                 `json:"code"`
	Name          string                 `json:"name"`
	Description   *string                `json:"description,omitempty"`
	Icon          *string                `json:"icon,omitempty"`
	Category      string                 `json:"category"`
	Nodes         []WorkflowNode         `json:"nodes"`
	InputSchema   map[string]interface{} `json:"input_schema"`
	PriceRule     map[string]interface{} `json:"price_rule"`
	DisplayConfig map[string]interface{} `json:"display_config"`
	RuntimeConfig map[string]interface{} `json:"runtime_config"`
	IsEnabled     bool                   `json:"is_enabled"`
}

func (s *AgentService) List(ctx context.Context, includeDisabled bool) ([]WorkflowDTO, error) {
	q := `SELECT code, name, description, icon, category, nodes, input_schema, price_rule, display_config, runtime_config, is_enabled FROM workflow_definitions`
	if !includeDisabled {
		q += ` WHERE is_enabled=true`
	}
	q += ` ORDER BY sort_order ASC, id ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []WorkflowDTO
	for rows.Next() {
		w, err := scanWorkflow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *w)
	}
	return items, nil
}

func (s *AgentService) Get(ctx context.Context, code string) (*WorkflowDTO, error) {
	row := s.db.QueryRow(ctx,
		`SELECT code, name, description, icon, category, nodes, input_schema, price_rule, display_config, runtime_config, is_enabled FROM workflow_definitions WHERE code=$1`, code)
	return scanWorkflowRow(row)
}

func (s *AgentService) getDefinition(ctx context.Context, code string) (int64, *WorkflowDTO, error) {
	var id int64
	var w WorkflowDTO
	var desc, icon *string
	var nodes, schema, price, display, runtime []byte
	err := s.db.QueryRow(ctx,
		`SELECT id, code, name, description, icon, category, nodes, input_schema, price_rule, display_config, runtime_config, is_enabled FROM workflow_definitions WHERE code=$1`, code).
		Scan(&id, &w.Code, &w.Name, &desc, &icon, &w.Category, &nodes, &schema, &price, &display, &runtime, &w.IsEnabled)
	if err != nil {
		return 0, nil, err
	}
	w.Description = desc
	w.Icon = icon
	json.Unmarshal(nodes, &w.Nodes)
	json.Unmarshal(schema, &w.InputSchema)
	json.Unmarshal(price, &w.PriceRule)
	json.Unmarshal(display, &w.DisplayConfig)
	json.Unmarshal(runtime, &w.RuntimeConfig)
	return id, &w, nil
}

type WorkflowProjectDTO struct {
	PublicID       string                 `json:"public_id"`
	WorkflowCode   string                 `json:"workflow_code"`
	WorkflowName   string                 `json:"workflow_name"`
	Title          string                 `json:"title,omitempty"`
	Status         string                 `json:"status"`
	Inputs         map[string]interface{} `json:"inputs"`
	Outputs        map[string]interface{} `json:"outputs"`
	EstimatedCost  float64                `json:"estimated_cost"`
	ActualCost     float64                `json:"actual_cost"`
	ErrorMessage   *string                `json:"error_message,omitempty"`
	NodeRuns       []NodeRunDTO           `json:"node_runs"`
	CurrentStep    string                 `json:"current_step,omitempty"`
	WaitingConfirm bool                   `json:"waiting_confirm"`
	MediaTasks     []AgentMediaTaskDTO    `json:"media_tasks,omitempty"`
	CreatedAt      string                 `json:"created_at"`
}

type AgentMediaTaskDTO struct {
	TaskNo       string                 `json:"task_no"`
	Status       string                 `json:"status"`
	Progress     int                    `json:"progress"`
	Output       map[string]interface{} `json:"output"`
	ErrorMessage *string                `json:"error_message,omitempty"`
}

type NodeRunDTO struct {
	NodeID     string                 `json:"node_id"`
	Name       string                 `json:"name"`
	Type       string                 `json:"type"`
	Status     string                 `json:"status"`
	Output     map[string]interface{} `json:"output"`
	Cost       float64                `json:"cost"`
	DurationMs int                    `json:"duration_ms"`
	Error      *string                `json:"error,omitempty"`
}

func (s *AgentService) CreateProject(ctx context.Context, userID int64, code string, inputs map[string]interface{}) (*WorkflowProjectDTO, error) {
	wfID, def, err := s.getDefinition(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("智能体不存在")
		}
		return nil, err
	}
	if !def.IsEnabled {
		return nil, errors.New("智能体已下线")
	}
	estimated := 0.0
	if v, ok := def.PriceRule["unit_price"].(float64); ok {
		estimated = v
	}
	if estimated == 0 {
		for _, n := range def.Nodes {
			estimated += n.Cost
		}
	}
	estimated += s.estimateAgentRuntimeCost(ctx, def.RuntimeConfig, inputs)
	publicID := util.NewPublicID("wfp")
	inputsJSON, _ := json.Marshal(inputs)
	if err := s.billing.Freeze(ctx, userID, estimated, "workflow", publicID); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return s.createBalanceFailedProject(ctx, userID, wfID, publicID, inputsJSON, estimated)
		}
		return nil, err
	}
	var projectID int64
	err = s.db.QueryRow(ctx, `
		INSERT INTO workflow_projects (public_id, user_id, workflow_id, status, inputs, estimated_cost)
		VALUES ($1,$2,$3,'pending',$4,$5) RETURNING id`,
		publicID, userID, wfID, inputsJSON, estimated).Scan(&projectID)
	if err != nil {
		s.billing.Unfreeze(ctx, userID, estimated, "workflow", publicID)
		return nil, err
	}
	if err := queue.EnqueueWorkflowTask(s.queue, queue.WorkflowTaskPayload{ProjectID: projectID, UserID: userID}); err != nil {
		s.db.Exec(ctx, `UPDATE workflow_projects SET status='failed', error_message='入队失败' WHERE id=$1`, projectID)
		s.billing.Unfreeze(ctx, userID, estimated, "workflow", publicID)
		return nil, err
	}
	return s.GetProject(ctx, userID, publicID)
}

func (s *AgentService) createBalanceFailedProject(ctx context.Context, userID, wfID int64, publicID string, inputsJSON []byte, estimated float64) (*WorkflowProjectDTO, error) {
	errMsg := billing.InsufficientBalanceMsg
	var projectID int64
	err := s.db.QueryRow(ctx, `
		INSERT INTO workflow_projects (public_id, user_id, workflow_id, status, inputs, estimated_cost, error_message, finished_at)
		VALUES ($1,$2,$3,'failed',$4,$5,$6,now()) RETURNING id`,
		publicID, userID, wfID, inputsJSON, estimated, errMsg).Scan(&projectID)
	if err != nil {
		return nil, err
	}
	return s.GetProject(ctx, userID, publicID)
}

func (s *AgentService) GetProject(ctx context.Context, userID int64, publicID string) (*WorkflowProjectDTO, error) {
	var p WorkflowProjectDTO
	var projectID int64
	var inputs, outputs []byte
	var created time.Time
	err := s.db.QueryRow(ctx, `
		SELECT p.id, p.public_id, w.code, w.name, p.status, p.inputs, p.outputs, p.estimated_cost, p.actual_cost, p.error_message, p.created_at
		FROM workflow_projects p JOIN workflow_definitions w ON w.id = p.workflow_id
		WHERE p.public_id=$1 AND p.user_id=$2`, publicID, userID).Scan(
		&projectID, &p.PublicID, &p.WorkflowCode, &p.WorkflowName, &p.Status, &inputs, &outputs,
		&p.EstimatedCost, &p.ActualCost, &p.ErrorMessage, &created)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(inputs, &p.Inputs)
	json.Unmarshal(outputs, &p.Outputs)
	p.CreatedAt = created.Format(time.RFC3339)
	if step, ok := p.Outputs["current_step"].(string); ok {
		p.CurrentStep = step
	}
	p.WaitingConfirm = p.Status == "waiting_confirm"
	p.MediaTasks = mediaTasksFromOutputs(p.Outputs)
	p.MediaTasks = s.refreshMediaTasks(ctx, userID, p.MediaTasks)
	runs, err := s.listNodeRuns(ctx, projectID)
	if err != nil {
		return nil, err
	}
	p.NodeRuns = runs
	return &p, nil
}

func (s *AgentService) listNodeRuns(ctx context.Context, projectID int64) ([]NodeRunDTO, error) {
	rows, err := s.db.Query(ctx, `
		SELECT node_id, name, type, status, output, cost, duration_ms, error
		FROM workflow_node_runs WHERE project_id=$1 ORDER BY seq ASC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var runs []NodeRunDTO
	for rows.Next() {
		var r NodeRunDTO
		var output []byte
		if err := rows.Scan(&r.NodeID, &r.Name, &r.Type, &r.Status, &output, &r.Cost, &r.DurationMs, &r.Error); err != nil {
			return nil, err
		}
		json.Unmarshal(output, &r.Output)
		runs = append(runs, r)
	}
	return runs, nil
}

func (s *AgentService) ListProjects(ctx context.Context, userID int64, page, pageSize int, workflowCode string) ([]WorkflowProjectDTO, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	var total int
	args := []interface{}{userID}
	where := `WHERE p.user_id=$1`
	if strings.TrimSpace(workflowCode) != "" {
		args = append(args, strings.TrimSpace(workflowCode))
		where += fmt.Sprintf(` AND w.code=$%d`, len(args))
	}
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM workflow_projects p JOIN workflow_definitions w ON w.id = p.workflow_id `+where, args...).Scan(&total)
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.db.Query(ctx, `
		SELECT p.public_id, w.code, w.name, p.status, p.inputs, p.estimated_cost, p.actual_cost, p.created_at
		FROM workflow_projects p JOIN workflow_definitions w ON w.id = p.workflow_id
		`+where+fmt.Sprintf(` ORDER BY p.created_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []WorkflowProjectDTO
	for rows.Next() {
		var p WorkflowProjectDTO
		var created time.Time
		var inputs []byte
		if err := rows.Scan(&p.PublicID, &p.WorkflowCode, &p.WorkflowName, &p.Status, &inputs, &p.EstimatedCost, &p.ActualCost, &created); err != nil {
			return nil, 0, err
		}
		json.Unmarshal(inputs, &p.Inputs)
		p.Title = projectDisplayTitle(p.WorkflowName, p.Inputs)
		p.CreatedAt = created.Format(time.RFC3339)
		items = append(items, p)
	}
	return items, total, nil
}

func projectDisplayTitle(fallback string, inputs map[string]interface{}) string {
	for _, key := range []string{"user_prompt", "prompt", "description", "title"} {
		if v, ok := inputs[key].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return fallback
}

func (s *AgentService) estimateAgentRuntimeCost(ctx context.Context, runtimeCfg map[string]interface{}, inputs map[string]interface{}) float64 {
	if runtimeCfg == nil {
		return 0
	}
	total := 0.0
	if code := stringValue(runtimeCfg["analysis_model_code"]); code != "" {
		total += s.estimateModelCostByCode(ctx, code, inputs, 500, 1000)
	}
	if code := stringValue(runtimeCfg["generation_model_code"]); code != "" {
		total += s.estimateModelCostByCode(ctx, code, inputs, 0, 0)
	}
	return total
}

func (s *AgentService) estimateModelCostByCode(ctx context.Context, code string, params map[string]interface{}, promptTokens, outputTokens int) float64 {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT price_rule FROM models WHERE code=$1 AND is_enabled=true`, code).Scan(&raw); err != nil {
		return 0
	}
	rule := map[string]interface{}{}
	_ = json.Unmarshal(raw, &rule)
	return estimateCostFromPriceRule(rule, params, promptTokens, outputTokens)
}

func estimateCostFromPriceRule(rule map[string]interface{}, params map[string]interface{}, promptTokens, outputTokens int) float64 {
	billingType := stringValue(rule["billing_type"])
	switch billingType {
	case "per_image":
		unit := floatValue(rule["unit_price"])
		n := floatValue(params["n"])
		if n <= 0 {
			n = floatValue(params["count"])
		}
		if n <= 0 {
			n = 1
		}
		return unit * n
	case "per_token":
		inPrice := perAgentTokenPrice(rule, "input_price")
		outPrice := perAgentTokenPrice(rule, "output_price")
		if promptTokens <= 0 {
			promptTokens = 500
		}
		if outputTokens <= 0 {
			outputTokens = 1000
		}
		cost := float64(promptTokens)*inPrice + float64(outputTokens)*outPrice
		if surcharge := floatValue(rule["surcharge_per_m"]); surcharge > 0 {
			cost += float64(promptTokens+outputTokens) / 1_000_000 * surcharge
		}
		return cost
	case "per_second":
		unit := floatValue(rule["unit_price"])
		duration := parseDurationSeconds(params)
		n := floatValue(params["count"])
		if n <= 0 {
			n = floatValue(params["n"])
		}
		if n <= 0 {
			n = 1
		}
		return unit * duration * n
	case "per_request":
		return floatValue(rule["unit_price"])
	default:
		return 0
	}
}

func perAgentTokenPrice(rule map[string]interface{}, key string) float64 {
	if v := floatValue(rule[key]); v > 0 {
		return v
	}
	if v := floatValue(rule[key+"_per_m"]); v > 0 {
		return v / 1_000_000
	}
	return 0
}

func (s *AgentService) RetryProject(ctx context.Context, userID int64, publicID string) error {
	var projectID int64
	var status string
	var estimated float64
	err := s.db.QueryRow(ctx,
		`SELECT id, status, estimated_cost FROM workflow_projects WHERE public_id=$1 AND user_id=$2`, publicID, userID).
		Scan(&projectID, &status, &estimated)
	if err != nil {
		return err
	}
	if status != "failed" {
		return errors.New("仅失败的项目可重试")
	}
	if err := s.billing.Freeze(ctx, userID, estimated, "workflow", publicID); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return errors.New(billing.InsufficientBalanceMsg)
		}
		return err
	}
	s.db.Exec(ctx, `UPDATE workflow_projects SET status='pending', error_message=NULL, updated_at=now() WHERE id=$1`, projectID)
	s.db.Exec(ctx, `DELETE FROM workflow_node_runs WHERE project_id=$1`, projectID)
	return queue.EnqueueWorkflowTask(s.queue, queue.WorkflowTaskPayload{ProjectID: projectID, UserID: userID})
}

// ---------- admin ----------

func (s *AgentService) SetEnabled(ctx context.Context, code string, enabled bool) error {
	_, err := s.db.Exec(ctx, `UPDATE workflow_definitions SET is_enabled=$1, updated_at=now() WHERE code=$2`, enabled, code)
	return err
}

type AgentUpsertInput struct {
	Code                string                 `json:"code"`
	Name                string                 `json:"name"`
	Description         string                 `json:"description"`
	Icon                string                 `json:"icon"`
	Category            string                 `json:"category"`
	Nodes               []WorkflowNode         `json:"nodes"`
	InputSchema         map[string]interface{} `json:"input_schema"`
	PriceRule           map[string]interface{} `json:"price_rule"`
	DisplayConfig       map[string]interface{} `json:"display_config"`
	RuntimeConfig       map[string]interface{} `json:"runtime_config"`
	AgentMode           string                 `json:"agent_mode"`
	AnalysisModelCode   string                 `json:"analysis_model_code"`
	GenerationModelCode string                 `json:"generation_model_code"`
	GenerationType      string                 `json:"generation_type"`
	PresetCode          string                 `json:"preset_code"`
	RequireImage        bool                   `json:"require_image"`
	DefaultCount        int                    `json:"default_count"`
	CandidateCount      int                    `json:"candidate_count"`
	CreativeScenes      []string               `json:"creative_scenes"`
	OutputScenes        []string               `json:"output_scenes"`
	AllowTextOnly       bool                   `json:"allow_text_only"`
	SupportReference    bool                   `json:"support_reference_image"`
	SupportMultiRefs    bool                   `json:"support_multiple_references"`
	SupportFirstLast    bool                   `json:"support_first_last_frame"`
	EnableStepConfirm   bool                   `json:"enable_step_confirm"`
	EnableAutopilot     bool                   `json:"enable_autopilot"`
	AllowPromptEdit     bool                   `json:"allow_prompt_edit"`
	IsEnabled           bool                   `json:"is_enabled"`
	SortOrder           int                    `json:"sort_order"`
}

func (s *AgentService) Upsert(ctx context.Context, in AgentUpsertInput) error {
	if in.Code == "" || in.Name == "" {
		return errors.New("编码和名称必填")
	}
	if in.Category == "" {
		in.Category = "workflow"
	}
	if in.InputSchema == nil {
		in.InputSchema = map[string]interface{}{}
	}
	if in.PriceRule == nil {
		in.PriceRule = map[string]interface{}{}
	}
	if in.DisplayConfig == nil {
		in.DisplayConfig = map[string]interface{}{}
	}
	if in.RuntimeConfig == nil {
		in.RuntimeConfig = buildAgentRuntimeConfig(in)
	}
	if _, ok := in.RuntimeConfig["agent_mode"]; !ok {
		in.RuntimeConfig["agent_mode"] = "custom_nodes"
	}
	if mode, _ := in.RuntimeConfig["agent_mode"].(string); mode == "simple_pipeline" {
		in = normalizeSimpleAgentInput(in)
	}
	nodes, _ := json.Marshal(in.Nodes)
	if len(in.Nodes) == 0 {
		nodes = []byte("[]")
	}
	schema, _ := json.Marshal(in.InputSchema)
	price, _ := json.Marshal(in.PriceRule)
	display, _ := json.Marshal(in.DisplayConfig)
	runtime, _ := json.Marshal(in.RuntimeConfig)
	var desc, icon *string
	if in.Description != "" {
		desc = &in.Description
	}
	if in.Icon != "" {
		icon = &in.Icon
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO workflow_definitions (code, name, description, icon, category, nodes, input_schema, price_rule, display_config, runtime_config, is_enabled, sort_order, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
		ON CONFLICT (code) DO UPDATE SET
		  name=$2, description=$3, icon=$4, category=$5, nodes=$6, input_schema=$7, price_rule=$8, display_config=$9, runtime_config=$10, is_enabled=$11, sort_order=$12, updated_at=now()`,
		in.Code, in.Name, desc, icon, in.Category, nodes, schema, price, display, runtime, in.IsEnabled, in.SortOrder)
	return err
}

func (s *AgentService) ConfirmStep(ctx context.Context, userID int64, publicID, step string, payload map[string]interface{}) error {
	if payload == nil {
		payload = map[string]interface{}{}
	}
	data, _ := json.Marshal(payload)
	tag, err := s.db.Exec(ctx, `
		UPDATE workflow_projects
		SET status='pending',
		    outputs = COALESCE(outputs,'{}'::jsonb) || jsonb_build_object('confirmed_step', $1::text, 'confirmation_payload', $2::jsonb, 'autopilot', false),
		    updated_at=now()
	WHERE public_id=$3 AND user_id=$4 AND status='waiting_confirm'`, step, string(data), publicID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("项目不在待确认状态")
	}
	var projectID int64
	if err := s.db.QueryRow(ctx, `SELECT id FROM workflow_projects WHERE public_id=$1 AND user_id=$2`, publicID, userID).Scan(&projectID); err != nil {
		return err
	}
	return queue.EnqueueWorkflowTask(s.queue, queue.WorkflowTaskPayload{ProjectID: projectID, UserID: userID})
}

func (s *AgentService) SetAutopilot(ctx context.Context, userID int64, publicID string, enabled bool) error {
	var projectID int64
	err := s.db.QueryRow(ctx, `SELECT id FROM workflow_projects WHERE public_id=$1 AND user_id=$2`, publicID, userID).Scan(&projectID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `
		UPDATE workflow_projects
		SET status=CASE WHEN status='waiting_confirm' AND $1 THEN 'pending' ELSE status END,
		    outputs = COALESCE(outputs,'{}'::jsonb) || jsonb_build_object('autopilot', $1::boolean),
		    updated_at=now()
		WHERE id=$2`, enabled, projectID)
	if err != nil {
		return err
	}
	if enabled {
		return queue.EnqueueWorkflowTask(s.queue, queue.WorkflowTaskPayload{ProjectID: projectID, UserID: userID})
	}
	return nil
}

func buildAgentRuntimeConfig(in AgentUpsertInput) map[string]interface{} {
	mode := in.AgentMode
	if mode == "" {
		mode = "custom_nodes"
	}
	genType := in.GenerationType
	if genType == "" {
		genType = in.Category
	}
	return map[string]interface{}{
		"agent_mode":            mode,
		"analysis_model_code":   in.AnalysisModelCode,
		"generation_model_code": in.GenerationModelCode,
		"generation_type":       genType,
		"preset_code":           firstAgentString(in.PresetCode, "ecommerce_main_image"),
		"require_image":         in.RequireImage,
		"default_count":         in.DefaultCount,
		"candidate_count":       positiveAgentInt(in.CandidateCount, 3),
		"creative_scenes":       normalizeAgentCreativeScenes(firstAgentStringSlice(in.CreativeScenes, in.OutputScenes), genType),
		"input_capabilities": map[string]interface{}{
			"allow_text_only":             in.AllowTextOnly,
			"support_reference_image":     in.SupportReference,
			"support_multiple_references": in.SupportMultiRefs,
			"support_first_last_frame":    in.SupportFirstLast,
		},
		"flow_options": map[string]interface{}{
			"enable_step_confirm": in.EnableStepConfirm,
			"enable_autopilot":    in.EnableAutopilot,
			"allow_prompt_edit":   in.AllowPromptEdit,
		},
	}
}

func normalizeSimpleAgentInput(in AgentUpsertInput) AgentUpsertInput {
	if in.GenerationType == "" {
		if s, ok := in.RuntimeConfig["generation_type"].(string); ok {
			in.GenerationType = s
		} else {
			in.GenerationType = in.Category
		}
	}
	if in.DefaultCount <= 0 {
		if v, ok := in.RuntimeConfig["default_count"].(float64); ok {
			in.DefaultCount = int(v)
		}
	}
	if in.DefaultCount <= 0 {
		in.DefaultCount = 1
	}
	if stringValue(in.RuntimeConfig["preset_code"]) == "" {
		in.RuntimeConfig["preset_code"] = firstAgentString(in.PresetCode, defaultPresetForType(in.GenerationType))
	}
	if _, ok := in.RuntimeConfig["candidate_count"]; !ok {
		in.RuntimeConfig["candidate_count"] = positiveAgentInt(in.CandidateCount, 3)
	}
	in.RuntimeConfig["creative_scenes"] = normalizeAgentCreativeScenes(firstAgentStringSlice(agentStringSlice(in.RuntimeConfig["creative_scenes"], nil), agentStringSlice(in.RuntimeConfig["output_scenes"], nil), in.CreativeScenes, in.OutputScenes), in.GenerationType)
	delete(in.RuntimeConfig, "output_scenes")
	if _, ok := in.RuntimeConfig["input_capabilities"]; !ok {
		in.RuntimeConfig["input_capabilities"] = map[string]interface{}{
			"allow_text_only":             in.AllowTextOnly,
			"support_reference_image":     in.SupportReference || in.RequireImage,
			"support_multiple_references": in.SupportMultiRefs,
			"support_first_last_frame":    in.SupportFirstLast,
		}
	}
	if _, ok := in.RuntimeConfig["flow_options"]; !ok {
		in.RuntimeConfig["flow_options"] = map[string]interface{}{
			"enable_step_confirm": trueIfUnset(in.EnableStepConfirm, true),
			"enable_autopilot":    trueIfUnset(in.EnableAutopilot, true),
			"allow_prompt_edit":   trueIfUnset(in.AllowPromptEdit, true),
		}
	}
	if len(in.Nodes) == 0 {
		in.Nodes = []WorkflowNode{
			{ID: "analysis", Type: "llm", Name: "需求分析", ModelCode: stringValue(in.RuntimeConfig["analysis_model_code"]), Cost: 0},
			{ID: "generate", Type: in.GenerationType, Name: "生成结果", ModelCode: stringValue(in.RuntimeConfig["generation_model_code"]), Cost: 0},
		}
	}
	if len(in.InputSchema) == 0 {
		in.InputSchema = map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"prompt": map[string]interface{}{"type": "string", "title": "需求描述", "placeholder": "简单描述你想要的效果，上传参考图后可直接生成"},
				"count":  map[string]interface{}{"type": "integer", "title": "生成数量", "default": in.DefaultCount, "minimum": 1, "maximum": 20},
			},
		}
	}
	if len(in.PriceRule) == 0 {
		in.PriceRule = map[string]interface{}{"billing_type": "per_request", "unit_price": 0}
	}
	if len(in.DisplayConfig) == 0 {
		in.DisplayConfig = defaultAgentDisplayConfig(in)
	}
	return in
}

func defaultAgentDisplayConfig(in AgentUpsertInput) map[string]interface{} {
	preset := agentPresetMeta(firstAgentString(stringValue(in.RuntimeConfig["preset_code"]), in.PresetCode, defaultPresetForType(in.GenerationType)))
	title := "结果生成"
	if in.GenerationType == "video" {
		title = "视频生成"
	} else if in.GenerationType == "image" {
		title = "图片生成"
	}
	return map[string]interface{}{
		"theme":        preset.Theme,
		"hero_tags":    preset.HeroTags,
		"feature_tags": preset.FeatureTags,
		"steps": []map[string]interface{}{
			{"icon": "🔎", "title": "需求智能分析", "subtitle": "AI 根据输入和参考图理解目标效果", "tags": []string{"需求识别", "素材分析"}},
			{"icon": "✅", "title": "方案确认", "subtitle": "确认或修改生成方案", "tags": []string{"逐步确认", "可编辑"}},
			{"icon": "🎬", "title": title, "subtitle": "调用选择的生成模型输出结果", "tags": []string{"异步生成", "进度跟踪"}},
		},
		"input": map[string]interface{}{"image_label": preset.ImageLabel, "placeholder": preset.Placeholder, "modes": []string{"逐步确认", "智能托管"}},
		"help":  preset.Help,
	}
}

type agentPreset struct {
	Theme       string
	HeroTags    []string
	FeatureTags []string
	ImageLabel  string
	Placeholder string
	Help        string
}

func agentPresetMeta(code string) agentPreset {
	switch code {
	case "ecommerce_scene_image":
		return agentPreset{"emerald", []string{"电商场景图", "多方案", "商品视觉"}, []string{"场景补全", "卖点强化", "商业构图", "批量生成"}, "商品/参考图", "例如：把这款产品放到高端家居场景，突出质感和卖点", "输入简单需求并上传商品图，AI 会生成多条场景化方案。"}
	case "poster_image":
		return agentPreset{"violet", []string{"营销海报", "文案构图", "品牌视觉"}, []string{"海报构图", "标题氛围", "活动主视觉", "多尺寸适配"}, "参考图", "例如：做一张新品上市海报，科技感，高级黑金风格", "适合活动海报、产品宣传图和品牌主视觉。"}
	case "product_showcase_video":
		return agentPreset{"rose", []string{"商品展示视频", "镜头规划", "短视频"}, []string{"镜头节奏", "卖点脚本", "商品运镜", "平台风格"}, "商品图/首帧", "例如：生成 5 秒商品展示短视频，镜头缓慢推进，突出材质", "上传商品图或首帧，AI 会规划镜头运动、卖点节奏和视频提示词。"}
	case "image_to_video":
		return agentPreset{"rose", []string{"图生视频", "动态扩展", "智能运镜"}, []string{"参考图驱动", "运动描述", "首帧保持", "短视频生成"}, "首帧图", "例如：让图片里的商品缓慢旋转，背景有柔和光影变化", "适合把静态图片扩展成短视频，支持智能托管或逐步确认。"}
	default:
		return agentPreset{"amber", []string{"电商主图", "AI智能体", "智能托管"}, []string{"主图构图", "商品卖点", "商业光影", "批量生成"}, "商品图", "例如：莫来石商品主图，白底高级质感，突出材质纹理", "输入一句话并上传商品图，AI 会生成多条电商主图方案，确认后调用图片模型生成。"}
	}
}

func defaultPresetForType(genType string) string {
	if genType == "video" {
		return "product_showcase_video"
	}
	return "ecommerce_main_image"
}

func firstAgentString(items ...string) string {
	for _, item := range items {
		if item != "" {
			return item
		}
	}
	return ""
}

func positiveAgentInt(v, fallback int) int {
	if v > 0 {
		return v
	}
	return fallback
}

func normalizeAgentCreativeScenes(items []string, generationType string) []string {
	fallback := "main_image"
	allowed := map[string]bool{}
	if generationType == "video" {
		fallback = "product_video"
		allowed["product_video"] = true
		allowed["image_to_video"] = true
	} else {
		allowed["main_image"] = true
		allowed["detail_image"] = true
		allowed["scene_image"] = true
		allowed["marketing_poster"] = true
	}
	out := []string{fallback}
	seen := map[string]bool{fallback: true}
	for _, item := range items {
		item = strings.TrimSpace(item)
		if !allowed[item] || seen[item] {
			continue
		}
		out = append(out, item)
		seen[item] = true
	}
	return out
}

func firstAgentStringSlice(items ...[]string) []string {
	for _, item := range items {
		if len(item) > 0 {
			return item
		}
	}
	return nil
}

func agentStringSlice(v interface{}, fallback []string) []string {
	switch items := v.(type) {
	case []string:
		return items
	case []interface{}:
		out := make([]string, 0, len(items))
		for _, item := range items {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return fallback
	}
}

func trueIfUnset(v bool, fallback bool) bool {
	if v {
		return true
	}
	return fallback
}

func stringValue(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func floatValue(v interface{}) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	default:
		return 0
	}
}

func mediaTasksFromOutputs(outputs map[string]interface{}) []AgentMediaTaskDTO {
	raw, ok := outputs["media_tasks"].([]interface{})
	if !ok {
		return nil
	}
	out := make([]AgentMediaTaskDTO, 0, len(raw))
	for _, item := range raw {
		m, _ := item.(map[string]interface{})
		if m == nil {
			continue
		}
		dto := AgentMediaTaskDTO{
			TaskNo:   stringValue(m["task_no"]),
			Status:   stringValue(m["status"]),
			Progress: intFromAgentAny(m["progress"]),
		}
		if om, ok := m["output"].(map[string]interface{}); ok {
			dto.Output = om
		}
		if em := stringValue(m["error_message"]); em != "" {
			dto.ErrorMessage = &em
		}
		out = append(out, dto)
	}
	return out
}

func (s *AgentService) refreshMediaTasks(ctx context.Context, userID int64, tasks []AgentMediaTaskDTO) []AgentMediaTaskDTO {
	if len(tasks) == 0 {
		return tasks
	}
	for i := range tasks {
		if tasks[i].TaskNo == "" {
			continue
		}
		var status string
		var outputRaw []byte
		var errMsg *string
		err := s.db.QueryRow(ctx, `
			SELECT status, output, error_message
			FROM tasks WHERE task_no=$1 AND user_id=$2`, tasks[i].TaskNo, userID).Scan(&status, &outputRaw, &errMsg)
		if err != nil {
			continue
		}
		tasks[i].Status = status
		out := map[string]interface{}{}
		_ = json.Unmarshal(outputRaw, &out)
		tasks[i].Output = out
		tasks[i].Progress = s.latestTaskProgress(ctx, tasks[i].TaskNo, status)
		if errMsg != nil && *errMsg != "" {
			tasks[i].ErrorMessage = errMsg
		}
	}
	return tasks
}

func (s *AgentService) latestTaskProgress(ctx context.Context, taskNo, status string) int {
	if status == "succeeded" || status == "failed" {
		return 100
	}
	var progress int
	err := s.db.QueryRow(ctx, `
		SELECT COALESCE((payload->>'progress')::int, 0)
		FROM task_events e
		JOIN tasks t ON t.id=e.task_id
		WHERE t.task_no=$1 AND e.event_type='progress'
		ORDER BY e.created_at DESC, e.id DESC
		LIMIT 1`, taskNo).Scan(&progress)
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

func intFromAgentAny(v interface{}) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	default:
		return 0
	}
}

func (s *AgentService) Delete(ctx context.Context, code string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM workflow_definitions WHERE code=$1`, code)
	return err
}

func scanWorkflow(rows pgx.Rows) (*WorkflowDTO, error) {
	var w WorkflowDTO
	var desc, icon *string
	var nodes, schema, price, display, runtime []byte
	if err := rows.Scan(&w.Code, &w.Name, &desc, &icon, &w.Category, &nodes, &schema, &price, &display, &runtime, &w.IsEnabled); err != nil {
		return nil, err
	}
	w.Description = desc
	w.Icon = icon
	json.Unmarshal(nodes, &w.Nodes)
	json.Unmarshal(schema, &w.InputSchema)
	json.Unmarshal(price, &w.PriceRule)
	json.Unmarshal(display, &w.DisplayConfig)
	json.Unmarshal(runtime, &w.RuntimeConfig)
	return &w, nil
}

func scanWorkflowRow(row pgx.Row) (*WorkflowDTO, error) {
	var w WorkflowDTO
	var desc, icon *string
	var nodes, schema, price, display, runtime []byte
	if err := row.Scan(&w.Code, &w.Name, &desc, &icon, &w.Category, &nodes, &schema, &price, &display, &runtime, &w.IsEnabled); err != nil {
		return nil, err
	}
	w.Description = desc
	w.Icon = icon
	json.Unmarshal(nodes, &w.Nodes)
	json.Unmarshal(schema, &w.InputSchema)
	json.Unmarshal(price, &w.PriceRule)
	json.Unmarshal(display, &w.DisplayConfig)
	json.Unmarshal(runtime, &w.RuntimeConfig)
	return &w, nil
}
