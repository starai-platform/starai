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
	"github.com/starai/api/internal/storage"
	"github.com/starai/api/internal/util"
)

type AgentService struct {
	db      *pgxpool.Pool
	billing *billing.Service
	queue   *asynq.Client
	storage storage.Store
}

func NewAgentService(db *pgxpool.Pool, billing *billing.Service, q *asynq.Client, store storage.Store) *AgentService {
	return &AgentService{db: db, billing: billing, queue: q, storage: store}
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
	SortOrder     int                    `json:"sort_order"`
}

type WorkflowOutcomeStat struct {
	RecentRuns       int
	SuccessRate      float64
	AvgDurationMS    int
	FeedbackSamples  float64
	SatisfactionRate float64
}

func (s *AgentService) List(ctx context.Context, includeDisabled bool) ([]WorkflowDTO, error) {
	q := `SELECT code, name, description, icon, category, nodes, input_schema, price_rule, display_config, runtime_config, is_enabled, sort_order FROM workflow_definitions`
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

// AgentWorkflowOutcomeStats summarizes only projects dispatched by the
// Creative Agent. Manual workflow runs must not bias the Agent's own router.
func (s *AgentService) AgentWorkflowOutcomeStats(ctx context.Context) (map[string]WorkflowOutcomeStat, error) {
	rows, err := s.db.Query(ctx, `WITH feedback AS (
		SELECT workflow_code,
			SUM(weight)::double precision AS sample_weight,
			COALESCE(SUM(weight) FILTER (WHERE rating=1),0)::double precision AS positive_weight
		FROM creative_agent_workflow_feedback
		WHERE updated_at>=now()-interval '30 days'
		GROUP BY workflow_code
	) SELECT w.code,
		COUNT(p.id) FILTER (WHERE p.status IN ('succeeded','failed')),
		COUNT(p.id) FILTER (WHERE p.status='succeeded'),
		COALESCE((AVG(EXTRACT(EPOCH FROM (p.finished_at-p.started_at))*1000)
			FILTER (WHERE p.status IN ('succeeded','failed') AND p.started_at IS NOT NULL AND p.finished_at IS NOT NULL))::double precision,0),
		COALESCE(f.sample_weight,0),
		(3+COALESCE(f.positive_weight,0))/(4+COALESCE(f.sample_weight,0))
		FROM workflow_definitions w
		LEFT JOIN workflow_projects p ON p.workflow_id=w.id
			AND p.created_at>=now()-interval '30 days'
			AND p.inputs ? '_agent_confirmation'
		LEFT JOIN feedback f ON f.workflow_code=w.code
		GROUP BY w.id,w.code,f.sample_weight,f.positive_weight`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := map[string]WorkflowOutcomeStat{}
	for rows.Next() {
		var code string
		var runs, successes int64
		var duration, feedbackSamples, satisfaction float64
		if err := rows.Scan(&code, &runs, &successes, &duration, &feedbackSamples, &satisfaction); err != nil {
			return nil, err
		}
		stat := WorkflowOutcomeStat{RecentRuns: int(runs), AvgDurationMS: int(duration), FeedbackSamples: feedbackSamples, SatisfactionRate: satisfaction}
		if runs > 0 {
			stat.SuccessRate = float64(successes) / float64(runs)
		}
		stats[code] = stat
	}
	return stats, rows.Err()
}

func (s *AgentService) Get(ctx context.Context, code string) (*WorkflowDTO, error) {
	row := s.db.QueryRow(ctx,
		`SELECT code, name, description, icon, category, nodes, input_schema, price_rule, display_config, runtime_config, is_enabled, sort_order FROM workflow_definitions WHERE code=$1`, code)
	w, err := scanWorkflowRow(row)
	if err == nil && stringValue(w.RuntimeConfig["agent_mode"]) == "product_refine" {
		if pricing, _, priceErr := s.productPricing(ctx, w.RuntimeConfig, w.PriceRule, 1, "high"); priceErr == nil {
			w.RuntimeConfig["product_pricing"] = pricing
		}
	}
	return w, err
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
	UserFeedback   int                    `json:"user_feedback,omitempty"`
	ErrorMessage   *string                `json:"error_message,omitempty"`
	NodeRuns       []NodeRunDTO           `json:"node_runs"`
	CurrentStep    string                 `json:"current_step,omitempty"`
	WaitingConfirm bool                   `json:"waiting_confirm"`
	MediaTasks     []AgentMediaTaskDTO    `json:"media_tasks,omitempty"`
	CreatedAt      string                 `json:"created_at"`
}

func (s *AgentService) recordWorkflowFeedback(ctx context.Context, userID int64, conversationID, workflowCode, targetType, targetRef, source string, rating int, weight float64) error {
	if rating != -1 && rating != 1 {
		return errors.New("评价参数无效")
	}
	result, err := s.db.Exec(ctx, `INSERT INTO creative_agent_workflow_feedback
		(user_id,conversation_public_id,workflow_code,target_type,target_ref,source,rating,weight)
		SELECT $1,$2,$3,$4,$5,$6,$7,$8
		WHERE EXISTS (SELECT 1 FROM conversations WHERE public_id=$2 AND user_id=$1)
		ON CONFLICT (user_id,target_type,target_ref,source) DO UPDATE SET
			conversation_public_id=EXCLUDED.conversation_public_id,
			workflow_code=EXCLUDED.workflow_code,rating=EXCLUDED.rating,
			weight=EXCLUDED.weight,updated_at=now()`,
		userID, strings.TrimSpace(conversationID), strings.TrimSpace(workflowCode), targetType, targetRef, source, rating, weight)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return errors.New("会话不存在")
	}
	return nil
}

func agentConfirmationConversation(value string) string {
	value = strings.TrimSpace(value)
	if pos := strings.LastIndexByte(value, ':'); pos > 0 {
		return value[:pos]
	}
	return ""
}

func (s *AgentService) RecordExplicitWorkflowFeedback(ctx context.Context, userID int64, conversationID, projectID string, rating int) error {
	var workflowCode, confirmation string
	if err := s.db.QueryRow(ctx, `SELECT w.code,COALESCE(p.inputs->>'_agent_confirmation','')
		FROM workflow_projects p JOIN workflow_definitions w ON w.id=p.workflow_id
		WHERE p.public_id=$1 AND p.user_id=$2 AND p.status='succeeded'`, strings.TrimSpace(projectID), userID).Scan(&workflowCode, &confirmation); err != nil {
		return err
	}
	if conversationID = strings.TrimSpace(conversationID); conversationID == "" || conversationID != agentConfirmationConversation(confirmation) {
		return errors.New("该任务不属于当前 Agent 会话")
	}
	return s.recordWorkflowFeedback(ctx, userID, conversationID, workflowCode, "project", projectID, "explicit", rating, 1)
}

func (s *AgentService) RecordWorkflowRouteChange(ctx context.Context, userID int64, conversationID, previousWorkflowCode string, planVersion int64) error {
	if planVersion <= 0 || strings.TrimSpace(previousWorkflowCode) == "" {
		return nil
	}
	target := fmt.Sprintf("%s:%d", strings.TrimSpace(conversationID), planVersion)
	return s.recordWorkflowFeedback(ctx, userID, conversationID, previousWorkflowCode, "plan", target, "route_change", -1, 0.25)
}

func (s *AgentService) RecordWorkflowRetryFeedback(ctx context.Context, userID int64, projectID string) error {
	var workflowCode, confirmation string
	if err := s.db.QueryRow(ctx, `SELECT w.code,COALESCE(p.inputs->>'_agent_confirmation','')
		FROM workflow_projects p JOIN workflow_definitions w ON w.id=p.workflow_id
		WHERE p.public_id=$1 AND p.user_id=$2`, strings.TrimSpace(projectID), userID).Scan(&workflowCode, &confirmation); err != nil {
		return err
	}
	conversationID := agentConfirmationConversation(confirmation)
	if conversationID == "" {
		return nil
	}
	return s.recordWorkflowFeedback(ctx, userID, conversationID, workflowCode, "project", projectID, "retry", -1, 0.25)
}

type AgentMediaTaskDTO struct {
	TaskNo       string                 `json:"task_no"`
	Type         string                 `json:"type,omitempty"`
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

type ComicDramaStyleDTO struct {
	PublicID  string `json:"public_id"`
	Name      string `json:"name"`
	Prompt    string `json:"prompt"`
	CoverURL  string `json:"cover_url"`
	Source    string `json:"source"`
	CreatedAt string `json:"created_at"`
}

type ComicDramaStyleInput struct {
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
	CoverURL string `json:"cover_url"`
	Mode     string `json:"mode"`
}

type ComicDramaProjectDTO struct {
	PublicID              string                 `json:"public_id"`
	WorkflowCode          string                 `json:"workflow_code"`
	Name                  string                 `json:"name"`
	Description           string                 `json:"description"`
	CoverURL              string                 `json:"cover_url"`
	Style                 map[string]interface{} `json:"style"`
	StyleID               string                 `json:"style_id,omitempty"`
	Orientation           string                 `json:"orientation"`
	Quality               string                 `json:"quality"`
	LastWorkflowProjectID string                 `json:"last_workflow_project_id,omitempty"`
	LastWorkflowStatus    string                 `json:"last_workflow_status,omitempty"`
	Archived              bool                   `json:"archived"`
	ArchivedAt            *string                `json:"archived_at,omitempty"`
	CreatedAt             string                 `json:"created_at"`
	UpdatedAt             string                 `json:"updated_at"`
}

type ComicDramaProjectInput struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	CoverURL     string `json:"cover_url"`
	StyleID      string `json:"style_id"`
	Orientation  string `json:"orientation"`
	Quality      string `json:"quality"`
	WorkflowCode string `json:"workflow_code"`
}

type ComicDramaAssetDTO struct {
	PublicID          string                 `json:"public_id"`
	AssetType         string                 `json:"asset_type"`
	AssetCode         string                 `json:"asset_code"`
	Name              string                 `json:"name"`
	Description       string                 `json:"description"`
	VisualPrompt      string                 `json:"visual_prompt"`
	ReferenceAssetIDs []string               `json:"reference_asset_ids"`
	Metadata          map[string]interface{} `json:"metadata"`
	Version           int                    `json:"version"`
	Status            string                 `json:"status"`
	UpdatedAt         string                 `json:"updated_at"`
}

type ComicDramaAssetInput struct {
	AssetType         string                 `json:"asset_type"`
	AssetCode         string                 `json:"asset_code"`
	Name              string                 `json:"name"`
	Description       string                 `json:"description"`
	VisualPrompt      string                 `json:"visual_prompt"`
	ReferenceAssetIDs []string               `json:"reference_asset_ids"`
	Metadata          map[string]interface{} `json:"metadata"`
	Status            string                 `json:"status"`
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
	if stringValue(def.RuntimeConfig["agent_mode"]) == "comic_drama" {
		inputs = mergeComicDramaRuntimeDefaults(def.RuntimeConfig, inputs)
		if err := s.validateComicDramaGenerationModels(ctx, inputs); err != nil {
			return nil, err
		}
		if err := s.ensureComicDramaProject(ctx, userID, code, inputs); err != nil {
			return nil, err
		}
	}
	if stringValue(def.RuntimeConfig["agent_mode"]) == "video_upscale" {
		inputs = mergeVideoUpscaleRuntimeDefaults(def.RuntimeConfig, inputs)
		if err := s.validateVideoUpscaleRequest(ctx, userID, def.RuntimeConfig, inputs); err != nil {
			return nil, err
		}
	}
	if stringValue(def.RuntimeConfig["agent_mode"]) == "video_redraw" {
		inputs = mergeVideoRedrawRuntimeDefaults(def.RuntimeConfig, inputs)
		if err := s.validateVideoRedrawRequest(ctx, userID, def.RuntimeConfig, inputs); err != nil {
			return nil, err
		}
	}
	if stringValue(def.RuntimeConfig["agent_mode"]) == "subtitle_remove" {
		inputs = mergeSubtitleRemovalRuntimeDefaults(def.RuntimeConfig, inputs)
		if err := s.validateSubtitleRemovalRequest(ctx, userID, def.RuntimeConfig, inputs); err != nil {
			return nil, err
		}
	}
	if stringValue(def.RuntimeConfig["agent_mode"]) == "photo_studio" {
		inputs = mergePhotoStudioRuntimeDefaults(def.RuntimeConfig, inputs)
		if err := s.validatePhotoStudioRequest(ctx, def.RuntimeConfig, inputs); err != nil {
			return nil, err
		}
	}
	if stringValue(def.RuntimeConfig["agent_mode"]) == "virtual_try_on" {
		inputs = mergeVirtualTryOnRuntimeDefaults(def.RuntimeConfig, inputs)
		if err := s.validateVirtualTryOnRequest(ctx, userID, def.RuntimeConfig, inputs); err != nil {
			return nil, err
		}
	}
	productEstimate := 0.0
	billingReservation := 0.0
	if stringValue(def.RuntimeConfig["agent_mode"]) == "product_refine" {
		if err := s.validateProductRequest(ctx, userID, def.RuntimeConfig, inputs); err != nil {
			return nil, err
		}
		_, productEstimate, err = s.productPricing(ctx, def.RuntimeConfig, def.PriceRule, intFromAgentAny(inputs["count"]), stringValue(inputs["quality"]))
		if err != nil {
			return nil, err
		}
		executionBudget, budgetErr := s.productExecutionBudget(ctx, def.RuntimeConfig, intFromAgentAny(inputs["count"]), intFromAgentAny(inputs["max_repairs"]), stringValue(inputs["review_mode"]), stringValue(inputs["quality"]))
		if budgetErr != nil {
			return nil, budgetErr
		}
		inputs["max_cost"] = productEstimate
		inputs["_execution_budget"] = executionBudget
		billingReservation = productBillingReservation(productEstimate, executionBudget)
		inputs["_billing_reservation"] = billingReservation
	}
	estimated := productEstimate
	if stringValue(def.RuntimeConfig["agent_mode"]) != "product_refine" {
		estimated, err = s.EstimateWorkflowCost(ctx, def, inputs)
		if err != nil {
			return nil, err
		}
	}
	if err := validateAgentCostLimit(inputs, estimated); err != nil {
		return nil, err
	}
	if billingReservation <= 0 {
		billingReservation = estimated
	}
	publicID := util.NewPublicID("wfp")
	inputsJSON, _ := json.Marshal(inputs)
	var projectID int64
	if err := s.billing.FreezeWithFinalize(ctx, userID, billingReservation, "workflow", publicID, func(tx pgx.Tx) error {
		if err := validateAgentSubmissionTx(ctx, tx, userID, inputs); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			INSERT INTO workflow_projects (public_id, user_id, workflow_id, status, inputs, estimated_cost)
			VALUES ($1,$2,$3,'pending',$4,$5) RETURNING id`,
			publicID, userID, wfID, inputsJSON, estimated).Scan(&projectID)
	}); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return s.createBalanceFailedProject(ctx, userID, wfID, publicID, inputsJSON, estimated)
		}
		return nil, err
	}
	if stringValue(def.RuntimeConfig["agent_mode"]) == "comic_drama" {
		s.attachWorkflowToComicProject(ctx, userID, projectID, inputs)
	}
	if err := queue.EnqueueWorkflowTask(s.queue, queue.WorkflowTaskPayload{ProjectID: projectID, UserID: userID}); err != nil {
		cleanupErr := s.billing.UnfreezeWithFinalize(ctx, userID, billingReservation, "workflow", publicID, func(tx pgx.Tx) error {
			_, updateErr := tx.Exec(ctx, `UPDATE workflow_projects SET status='failed', error_message='入队失败', finished_at=now(), updated_at=now() WHERE id=$1`, projectID)
			return updateErr
		})
		if cleanupErr != nil {
			return nil, fmt.Errorf("工作流入队失败: %v；回滚冻结额度失败: %w", err, cleanupErr)
		}
		return nil, err
	}
	return s.GetProject(ctx, userID, publicID)
}

func (s *AgentService) EstimateWorkflowCost(ctx context.Context, def *WorkflowDTO, inputs map[string]interface{}) (float64, error) {
	if def == nil {
		return 0, errors.New("工作流不存在")
	}
	if stringValue(def.RuntimeConfig["agent_mode"]) == "product_refine" {
		_, estimate, err := s.productPricing(ctx, def.RuntimeConfig, def.PriceRule, intFromAgentAny(inputs["count"]), stringValue(inputs["quality"]))
		return estimate, err
	}
	nodeEstimate := 0.0
	for _, node := range def.Nodes {
		nodeEstimate += node.Cost
	}
	runtimeEstimate := s.estimateAgentRuntimeCost(ctx, def.RuntimeConfig, inputs)
	return estimateAgentProjectCost(def.PriceRule, inputs, nodeEstimate, runtimeEstimate), nil
}

func validateAgentCostLimit(inputs map[string]interface{}, estimated float64) error {
	if strings.TrimSpace(stringValue(inputs["_agent_confirmation"])) == "" {
		return nil
	}
	if limit := floatValue(inputs["_agent_max_cost"]); limit > 0 && estimated > limit+0.000001 {
		return errors.New("生成费用预估已超过确认上限，请更新方案后重新确认")
	}
	return nil
}

func estimateAgentProjectCost(priceRule, inputs map[string]interface{}, nodeEstimate, runtimeEstimate float64) float64 {
	if stringValue(priceRule["billing_type"]) == "per_request" && floatValue(priceRule["unit_price"]) > 0 {
		return floatValue(priceRule["unit_price"])
	}
	if stringValue(priceRule["billing_type"]) == "per_chapter" {
		return chapterBasedCost(priceRule, novelChapterEstimate(inputs))
	}
	usage := runtimeEstimate
	if usage <= 0 {
		usage = nodeEstimate
	}
	if usage <= 0 {
		return 0
	}
	// model_actual/dynamic：冻结 工作流费 + 模型用量估算。
	return floatValue(priceRule["unit_price"]) + usage
}

func mergeVideoUpscaleRuntimeDefaults(runtimeCfg, inputs map[string]interface{}) map[string]interface{} {
	if inputs == nil {
		inputs = map[string]interface{}{}
	}
	if stringValue(inputs["target_resolution"]) == "" {
		inputs["target_resolution"] = firstAgentString(stringValue(runtimeCfg["default_target_resolution"]), "720P")
	}
	if _, ok := inputs["preserve_audio"]; !ok {
		if value, exists := runtimeCfg["preserve_audio"].(bool); exists {
			inputs["preserve_audio"] = value
		} else {
			inputs["preserve_audio"] = true
		}
	}
	if stringValue(inputs["enhancement_mode"]) == "" {
		inputs["enhancement_mode"] = firstAgentString(stringValue(runtimeCfg["default_enhancement_mode"]), "balanced")
	}
	inputs["count"] = 1
	inputs["n"] = 1
	inputs["_mode"] = "auto"
	return inputs
}

func (s *AgentService) validateVideoUpscaleRequest(ctx context.Context, userID int64, runtimeCfg, inputs map[string]interface{}) error {
	modelCode := strings.TrimSpace(stringValue(runtimeCfg["generation_model_code"]))
	if modelCode == "" {
		return errors.New("AI 视频高清尚未配置超分模型，请联系管理员")
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM models WHERE code=$1 AND category='video' AND is_enabled=true)`, modelCode).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("超分模型不存在、类型不匹配或已停用：%s", modelCode)
	}
	sourceVideo := firstAgentString(
		stringValue(inputs["video_url"]),
		stringValue(inputs["source_video_url"]),
		firstAgentURL(inputs["reference_videos"]),
	)
	if sourceVideo == "" {
		return errors.New("请先上传或从资产库选择源视频")
	}
	resolution := normalizeAgentUpscaleResolution(stringValue(inputs["target_resolution"]))
	if resolution == "" || !agentUpscaleResolutionAllowed(resolution, runtimeCfg["supported_resolutions"]) {
		return errors.New("目标清晰度不受支持")
	}
	if err := s.validateVideoSourceAsset(ctx, userID, runtimeCfg, inputs); err != nil {
		return err
	}
	inputs["video_url"] = sourceVideo
	inputs["source_video_url"] = sourceVideo
	inputs["reference_videos"] = []string{sourceVideo}
	inputs["target_resolution"] = resolution
	inputs["resolution"] = resolution
	return nil
}

func mergeVideoRedrawRuntimeDefaults(runtimeCfg, inputs map[string]interface{}) map[string]interface{} {
	if inputs == nil {
		inputs = map[string]interface{}{}
	}
	if _, ok := inputs["style_strength"]; !ok {
		inputs["style_strength"] = firstAgentNonNil(runtimeCfg["default_style_strength"], 0.65)
	}
	for _, key := range []string{"preserve_motion", "preserve_identity", "preserve_audio"} {
		if _, ok := inputs[key]; !ok {
			if value, exists := runtimeCfg[key].(bool); exists {
				inputs[key] = value
			} else {
				inputs[key] = true
			}
		}
	}
	inputs["count"], inputs["n"], inputs["_mode"] = 1, 1, "auto"
	return inputs
}

func mergeSubtitleRemovalRuntimeDefaults(runtimeCfg, inputs map[string]interface{}) map[string]interface{} {
	if inputs == nil {
		inputs = map[string]interface{}{}
	}
	if stringValue(inputs["subtitle_mode"]) == "" {
		inputs["subtitle_mode"] = firstAgentString(stringValue(runtimeCfg["default_subtitle_mode"]), "auto")
	}
	if stringValue(inputs["subtitle_region"]) == "" {
		inputs["subtitle_region"] = firstAgentString(stringValue(runtimeCfg["default_subtitle_region"]), "bottom_25")
	}
	if _, ok := inputs["protect_watermark"]; !ok {
		if value, exists := runtimeCfg["protect_watermark"].(bool); exists {
			inputs["protect_watermark"] = value
		} else {
			inputs["protect_watermark"] = true
		}
	}
	inputs["count"], inputs["n"], inputs["_mode"] = 1, 1, "auto"
	return inputs
}

func (s *AgentService) validateVideoRedrawRequest(ctx context.Context, userID int64, runtimeCfg, inputs map[string]interface{}) error {
	if err := s.validateEnabledVideoModel(ctx, stringValue(runtimeCfg["generation_model_code"]), "转绘"); err != nil {
		return err
	}
	if err := normalizeAgentVideoSource(inputs); err != nil {
		return err
	}
	if err := s.validateVideoSourceAsset(ctx, userID, runtimeCfg, inputs); err != nil {
		return err
	}
	strength := floatValue(inputs["style_strength"])
	if strength < 0 || strength > 1 {
		return errors.New("风格强度必须在 0 到 1 之间")
	}
	styleAssetID := strings.TrimSpace(stringValue(inputs["style_reference_asset_id"]))
	if styleAssetID == "" {
		return nil
	}
	var kind, url string
	if err := s.db.QueryRow(ctx, `SELECT kind, url FROM assets WHERE public_id=$1 AND user_id=$2`, styleAssetID, userID).Scan(&kind, &url); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("所选风格参考图不存在或无权访问")
		}
		return err
	}
	if kind != "image" {
		return errors.New("风格参考素材必须是图片")
	}
	inputs["style_reference_url"] = url
	inputs["reference_images"] = []string{url}
	return nil
}

func (s *AgentService) validateSubtitleRemovalRequest(ctx context.Context, userID int64, runtimeCfg, inputs map[string]interface{}) error {
	if err := normalizeAgentVideoSource(inputs); err != nil {
		return err
	}
	if err := s.validateVideoSourceAsset(ctx, userID, runtimeCfg, inputs); err != nil {
		return err
	}
	mode := stringValue(inputs["subtitle_mode"])
	if mode != "auto" && mode != "soft_track" && mode != "hardcoded_ai" {
		return errors.New("去字幕模式无效")
	}
	if mode == "hardcoded_ai" {
		return s.validateEnabledVideoModel(ctx, stringValue(runtimeCfg["generation_model_code"]), "硬字幕修复")
	}
	return nil
}

func normalizeAgentVideoSource(inputs map[string]interface{}) error {
	sourceVideo := firstAgentString(stringValue(inputs["video_url"]), stringValue(inputs["source_video_url"]), firstAgentURL(inputs["reference_videos"]))
	if sourceVideo == "" {
		return errors.New("请先上传或从资产库选择源视频")
	}
	inputs["video_url"] = sourceVideo
	inputs["source_video_url"] = sourceVideo
	inputs["reference_videos"] = []string{sourceVideo}
	return nil
}

func mergePhotoStudioRuntimeDefaults(runtimeCfg, inputs map[string]interface{}) map[string]interface{} {
	if inputs == nil {
		inputs = map[string]interface{}{}
	}
	if stringValue(inputs["photo_type"]) == "" {
		inputs["photo_type"] = "写真"
	}
	if stringValue(inputs["photo_type"]) != "证件照" && stringValue(inputs["style"]) == "" {
		inputs["style"] = "影棚质感"
	}
	if stringValue(inputs["id_background"]) == "" {
		inputs["id_background"] = "白色"
	}
	if intFromAgentAny(inputs["count"]) <= 0 {
		inputs["count"] = positiveAgentInt(intFromAgentAny(runtimeCfg["default_count"]), 1)
	}
	if stringValue(inputs["aspect_ratio"]) == "" {
		inputs["aspect_ratio"] = "3:4"
	}
	if stringValue(inputs["_mode"]) == "" {
		inputs["_mode"] = "auto"
	}
	return inputs
}

func (s *AgentService) validatePhotoStudioRequest(ctx context.Context, runtimeCfg, inputs map[string]interface{}) error {
	if stringValue(inputs["image_url"]) == "" && len(agentStringSlice(inputs["reference_images"], nil)) == 0 {
		return errors.New("请先上传一张本人照片")
	}
	photoTypes := map[string]bool{"写真": true, "职业照": true, "证件照": true}
	if !photoTypes[stringValue(inputs["photo_type"])] {
		return errors.New("写真类型无效")
	}
	if stringValue(inputs["photo_type"]) == "证件照" {
		backgrounds := map[string]bool{"白色": true, "蓝色": true, "红色": true}
		if !backgrounds[stringValue(inputs["id_background"])] {
			return errors.New("证件照底色无效")
		}
	}
	count := intFromAgentAny(inputs["count"])
	if count < 1 || count > 8 {
		return errors.New("生成张数必须在 1 到 8 之间")
	}
	code := firstAgentString(stringValue(inputs["model_code"]), stringValue(runtimeCfg["generation_model_code"]))
	if code == "" {
		return errors.New("写真馆工作流尚未配置图片模型，请联系管理员")
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM models WHERE code=$1 AND category='image' AND is_enabled=true)`, code).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("图片模型不存在、类型不匹配或已停用：%s", code)
	}
	return nil
}

func mergeVirtualTryOnRuntimeDefaults(runtimeCfg, inputs map[string]interface{}) map[string]interface{} {
	if inputs == nil {
		inputs = map[string]interface{}{}
	}
	if stringValue(inputs["garment_category"]) == "" {
		inputs["garment_category"] = "auto"
	}
	if stringValue(inputs["garment_photo_type"]) == "" {
		inputs["garment_photo_type"] = "auto"
	}
	if intFromAgentAny(inputs["count"]) <= 0 {
		inputs["count"] = positiveAgentInt(intFromAgentAny(runtimeCfg["default_count"]), 1)
	}
	if stringValue(inputs["aspect_ratio"]) == "" {
		inputs["aspect_ratio"] = "3:4"
	}
	if stringValue(inputs["image_size"]) == "" {
		inputs["image_size"] = "1K"
	}
	inputs["_mode"] = "auto"
	return inputs
}

func (s *AgentService) validateVirtualTryOnRequest(ctx context.Context, userID int64, runtimeCfg, inputs map[string]interface{}) error {
	if strings.TrimSpace(stringValue(inputs["person_image_url"])) == "" {
		return errors.New("请先上传人物照片")
	}
	if strings.TrimSpace(stringValue(inputs["garment_image_url"])) == "" {
		return errors.New("请先上传服装图片")
	}
	if confirmed, _ := inputs["consent_confirmed"].(bool); !confirmed {
		return errors.New("请确认人物照片为本人或已获得使用授权")
	}
	for _, item := range []struct {
		idKey  string
		urlKey string
		label  string
	}{
		{idKey: "person_asset_id", urlKey: "person_image_url", label: "人物照片"},
		{idKey: "garment_asset_id", urlKey: "garment_image_url", label: "服装图片"},
	} {
		assetID := strings.TrimSpace(stringValue(inputs[item.idKey]))
		if assetID == "" {
			return fmt.Errorf("%s缺少有效的素材标识，请重新上传", item.label)
		}
		var kind, objectKey string
		if err := s.db.QueryRow(ctx, `SELECT kind, object_key FROM assets WHERE public_id=$1 AND user_id=$2`, assetID, userID).Scan(&kind, &objectKey); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%s不存在或无权访问", item.label)
			}
			return err
		}
		if kind != "image" || strings.TrimSpace(objectKey) == "" {
			return fmt.Errorf("%s必须是有效图片", item.label)
		}
		if s.storage == nil {
			return errors.New("素材存储服务暂不可用，请稍后重试")
		}
		inputs[item.urlKey] = s.storage.PublicURL(objectKey)
	}
	categories := map[string]bool{"auto": true, "tops": true, "bottoms": true, "one-pieces": true}
	if !categories[stringValue(inputs["garment_category"])] {
		return errors.New("服装类型无效")
	}
	photoTypes := map[string]bool{"auto": true, "flat-lay": true, "model": true}
	if !photoTypes[stringValue(inputs["garment_photo_type"])] {
		return errors.New("商品图类型无效")
	}
	count := intFromAgentAny(inputs["count"])
	if count < 1 || count > 4 {
		return errors.New("试穿生成张数必须在 1 到 4 之间")
	}
	code := firstAgentString(stringValue(inputs["model_code"]), stringValue(runtimeCfg["generation_model_code"]))
	if code == "" {
		return errors.New("AI试衣间尚未配置多参考图图片模型，请联系管理员")
	}
	var storedCode, upstreamModel string
	var runtimeRaw []byte
	if err := s.db.QueryRow(ctx, `SELECT code, new_api_model, runtime_rule FROM models WHERE code=$1 AND category='image' AND is_enabled=true`, code).Scan(&storedCode, &upstreamModel, &runtimeRaw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("图片模型不存在、类型不匹配或已停用：%s", code)
		}
		return err
	}
	modelRuntime := map[string]interface{}{}
	_ = json.Unmarshal(runtimeRaw, &modelRuntime)
	if !virtualTryOnModelCompatible(storedCode, upstreamModel, modelRuntime, stringValue(runtimeCfg["generation_model_code"])) {
		return fmt.Errorf("当前模型不支持AI试衣间所需的双参考图输入：%s", code)
	}
	inputs["model_code"] = code
	return nil
}

func virtualTryOnModelCompatible(code, upstreamModel string, runtimeRule map[string]interface{}, configuredDefault string) bool {
	if code != "" && code == configuredDefault {
		return true
	}
	raw, _ := json.Marshal(runtimeRule)
	searchable := strings.ToLower(code + " " + upstreamModel + " " + string(raw))
	if strings.Contains(searchable, "nano_banana") || strings.Contains(searchable, "nano banana") || strings.Contains(searchable, "gpt-image-2") || strings.Contains(searchable, "gemini") {
		return true
	}
	imageRule, _ := runtimeRule["image"].(map[string]interface{})
	return intFromAgentAny(firstAgentNonNil(imageRule["max_reference_images"], runtimeRule["max_reference_images"])) >= 2
}

func (s *AgentService) validateEnabledVideoModel(ctx context.Context, code, label string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return fmt.Errorf("%s工作流尚未配置视频模型，请联系管理员", label)
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM models WHERE code=$1 AND category='video' AND is_enabled=true)`, code).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%s模型不存在、类型不匹配或已停用：%s", label, code)
	}
	return nil
}

func (s *AgentService) validateVideoSourceAsset(ctx context.Context, userID int64, runtimeCfg, inputs map[string]interface{}) error {
	assetID := strings.TrimSpace(stringValue(inputs["source_asset_id"]))
	if assetID == "" {
		return nil
	}
	var kind string
	var sizeBytes int64
	if err := s.db.QueryRow(ctx, `SELECT kind, COALESCE(size_bytes,0) FROM assets WHERE public_id=$1 AND user_id=$2`, assetID, userID).Scan(&kind, &sizeBytes); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("所选源视频资产不存在或无权访问")
		}
		return err
	}
	if kind != "video" {
		return errors.New("所选资产不是视频")
	}
	maxMB := intFromAgentAny(runtimeCfg["max_input_size_mb"])
	if maxMB > 0 && sizeBytes > int64(maxMB)*1024*1024 {
		return fmt.Errorf("源视频不能超过 %d MB", maxMB)
	}
	return nil
}

func firstAgentURL(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []string:
		if len(typed) > 0 {
			return strings.TrimSpace(typed[0])
		}
	case []interface{}:
		if len(typed) > 0 {
			return firstAgentURL(typed[0])
		}
	case map[string]interface{}:
		return firstAgentString(stringValue(typed["url"]), stringValue(typed["video_url"]))
	}
	return ""
}

func normalizeAgentUpscaleResolution(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "720P", "1280X720":
		return "720P"
	case "1K", "1080P", "1920X1080":
		return "1K"
	case "2K", "1440P", "2560X1440":
		return "2K"
	default:
		return ""
	}
}

func agentUpscaleResolutionAllowed(value string, raw interface{}) bool {
	allowed := map[string]bool{}
	for _, item := range agentStringSlice(raw, nil) {
		if normalized := normalizeAgentUpscaleResolution(item); normalized != "" {
			allowed[normalized] = true
		}
	}
	if len(allowed) == 0 {
		return value == "720P" || value == "1K" || value == "2K"
	}
	return allowed[value]
}

func (s *AgentService) validateComicDramaGenerationModels(ctx context.Context, inputs map[string]interface{}) error {
	audioStrategy := normalizeComicAudioStrategy(stringValue(inputs["audio_strategy"]), stringValue(inputs["narration_model_code"]))
	if audioStrategy != "video_native" && strings.TrimSpace(stringValue(inputs["narration_model_code"])) == "" {
		return fmt.Errorf("AI 漫剧当前音频策略需要配置配音模型")
	}
	checks := []struct {
		key      string
		category string
		label    string
	}{
		{key: "image_model_code", category: "image", label: "图片"},
		{key: "video_model_code", category: "video", label: "视频"},
	}
	if strings.TrimSpace(stringValue(inputs["narration_model_code"])) != "" {
		checks = append(checks, struct {
			key      string
			category string
			label    string
		}{key: "narration_model_code", category: "audio", label: "配音"})
	}
	for _, check := range checks {
		code := strings.TrimSpace(stringValue(inputs[check.key]))
		if code == "" {
			return fmt.Errorf("AI 漫剧未配置%s模型", check.label)
		}
		var exists bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM models WHERE code=$1 AND category=$2 AND is_enabled=true)`, code, check.category).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("所选%s模型不存在、类型不匹配或已停用：%s", check.label, code)
		}
	}
	for _, code := range agentStringSlice(inputs["dialogue_model_codes"], nil) {
		code = strings.TrimSpace(code)
		if code == "" {
			continue
		}
		var exists bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM models WHERE code=$1 AND category='chat' AND is_enabled=true)`, code).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("所选对话模型不存在、类型不匹配或已停用：%s", code)
		}
	}
	return nil
}

func (s *AgentService) ensureComicDramaProject(ctx context.Context, userID int64, workflowCode string, inputs map[string]interface{}) error {
	if strings.TrimSpace(stringValue(inputs["comic_project_id"])) != "" {
		return nil
	}
	prompt := firstAgentString(stringValue(inputs["user_prompt"]), stringValue(inputs["prompt"]), "未命名漫剧")
	name := comicAutoProjectName(prompt)
	description := strings.TrimSpace(prompt)
	coverURL := firstAgentMediaURL(inputs)
	style := map[string]interface{}{}
	if value, ok := inputs["comic_style"].(map[string]interface{}); ok {
		style = value
	}
	publicID := util.NewPublicID("cdp")
	_, err := s.db.Exec(ctx, `
		INSERT INTO comic_drama_projects
			(public_id, user_id, workflow_code, name, description, cover_url, style_snapshot, orientation, quality)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		publicID, userID, workflowCode, name, description, coverURL, mustAgentJSON(style),
		normalizeComicOrientation(stringValue(inputs["orientation"])),
		normalizeComicQuality(stringValue(inputs["quality"])))
	if err != nil {
		return err
	}
	inputs["comic_project_id"] = publicID
	inputs["comic_project_name"] = name
	inputs["comic_project_description"] = description
	return nil
}

func comicAutoProjectName(prompt string) string {
	prompt = strings.Join(strings.Fields(strings.TrimSpace(prompt)), " ")
	runes := []rune(prompt)
	if len(runes) > 32 {
		prompt = string(runes[:32]) + "…"
	}
	if prompt == "" {
		prompt = "未命名漫剧"
	}
	return prompt
}

func firstAgentMediaURL(inputs map[string]interface{}) string {
	for _, key := range []string{"image_url", "reference_image", "product_image"} {
		if value := strings.TrimSpace(stringValue(inputs[key])); value != "" {
			return value
		}
	}
	for _, value := range agentStringSlice(inputs["reference_images"], nil) {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func (s *AgentService) createBalanceFailedProject(ctx context.Context, userID, wfID int64, publicID string, inputsJSON []byte, estimated float64) (*WorkflowProjectDTO, error) {
	errMsg := billing.InsufficientBalanceMsg
	var projectID int64
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var confirmation map[string]interface{}
	if err := json.Unmarshal(inputsJSON, &confirmation); err != nil {
		return nil, err
	}
	if err := validateAgentSubmissionTx(ctx, tx, userID, confirmation); err != nil {
		return nil, err
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO workflow_projects (public_id, user_id, workflow_id, status, inputs, estimated_cost, error_message, finished_at)
		VALUES ($1,$2,$3,'failed',$4,$5,$6,now()) RETURNING id`,
		publicID, userID, wfID, inputsJSON, estimated, errMsg).Scan(&projectID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
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
		SELECT p.id, p.public_id, w.code, w.name, p.status, p.inputs, p.outputs, p.estimated_cost, p.actual_cost, p.error_message,
			COALESCE((SELECT rating FROM creative_agent_workflow_feedback f
				WHERE f.user_id=p.user_id AND f.target_type='project' AND f.target_ref=p.public_id AND f.source='explicit'),0),
			p.created_at
		FROM workflow_projects p JOIN workflow_definitions w ON w.id = p.workflow_id
		WHERE p.public_id=$1 AND p.user_id=$2`, publicID, userID).Scan(
		&projectID, &p.PublicID, &p.WorkflowCode, &p.WorkflowName, &p.Status, &inputs, &outputs,
		&p.EstimatedCost, &p.ActualCost, &p.ErrorMessage, &p.UserFeedback, &created)
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
		FROM workflow_node_runs WHERE project_id=$1 ORDER BY seq ASC, id ASC`, projectID)
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

func (s *AgentService) ListComicDramaStyles(ctx context.Context, userID int64, source string) ([]ComicDramaStyleDTO, error) {
	args := []interface{}{userID}
	where := `(source='system' OR user_id=$1)`
	switch strings.TrimSpace(source) {
	case "system":
		where = `source='system'`
		args = nil
	case "mine":
		where = `user_id=$1`
	}
	rows, err := s.db.Query(ctx, `
		SELECT public_id, name, prompt, cover_url, source, created_at
		FROM comic_drama_styles
		WHERE `+where+`
		ORDER BY CASE WHEN source='system' THEN 0 ELSE 1 END, sort_order ASC, created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ComicDramaStyleDTO{}
	for rows.Next() {
		var item ComicDramaStyleDTO
		var created time.Time
		if err := rows.Scan(&item.PublicID, &item.Name, &item.Prompt, &item.CoverURL, &item.Source, &created); err != nil {
			return nil, err
		}
		item.CreatedAt = created.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, nil
}

func (s *AgentService) CreateComicDramaStyle(ctx context.Context, userID int64, input ComicDramaStyleInput) (*ComicDramaStyleDTO, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, errors.New("风格名称不能为空")
	}
	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		if strings.TrimSpace(input.Mode) == "smart" {
			prompt = "请根据参考图保持角色、场景、色彩、线条和镜头语言一致。"
		} else {
			return nil, errors.New("风格提示词不能为空")
		}
	}
	publicID := util.NewPublicID("cds")
	var item ComicDramaStyleDTO
	var created time.Time
	err := s.db.QueryRow(ctx, `
		INSERT INTO comic_drama_styles (public_id, user_id, name, prompt, cover_url, source)
		VALUES ($1,$2,$3,$4,$5,'user')
		RETURNING public_id, name, prompt, cover_url, source, created_at`,
		publicID, userID, name, prompt, strings.TrimSpace(input.CoverURL)).
		Scan(&item.PublicID, &item.Name, &item.Prompt, &item.CoverURL, &item.Source, &created)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = created.Format(time.RFC3339)
	return &item, nil
}

func (s *AgentService) comicDramaRuntimeConfigByCode(ctx context.Context, code string) map[string]interface{} {
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT runtime_config FROM workflow_definitions WHERE code=$1`, strings.TrimSpace(code)).Scan(&raw); err != nil {
		return nil
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil
	}
	if stringValue(cfg["agent_mode"]) != "comic_drama" && stringValue(cfg["preset_code"]) != "ai_comic_drama" {
		return nil
	}
	return cfg
}

func (s *AgentService) ListComicDramaProjects(ctx context.Context, userID int64, includeArchived bool) ([]ComicDramaProjectDTO, error) {
	archiveFilter := "AND p.archived_at IS NULL"
	if includeArchived {
		archiveFilter = ""
	}
	rows, err := s.db.Query(ctx, `
		SELECT p.public_id, p.workflow_code, p.name, p.description, p.cover_url, p.style_snapshot, COALESCE(s.public_id,''), p.orientation, p.quality,
		       COALESCE(wp.public_id,''), COALESCE(wp.status,''), p.archived_at, p.created_at, p.updated_at
		FROM comic_drama_projects p
		LEFT JOIN comic_drama_styles s ON s.id = p.style_id
		LEFT JOIN workflow_projects wp ON wp.id = p.last_workflow_project_id
		WHERE p.user_id=$1 `+archiveFilter+`
		ORDER BY p.updated_at DESC, p.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ComicDramaProjectDTO{}
	for rows.Next() {
		item, err := scanComicDramaProject(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, nil
}

func (s *AgentService) GetComicDramaProject(ctx context.Context, userID int64, publicID string) (*ComicDramaProjectDTO, error) {
	row := s.db.QueryRow(ctx, `
		SELECT p.public_id, p.workflow_code, p.name, p.description, p.cover_url, p.style_snapshot, COALESCE(s.public_id,''), p.orientation, p.quality,
		       COALESCE(wp.public_id,''), COALESCE(wp.status,''), p.archived_at, p.created_at, p.updated_at
		FROM comic_drama_projects p
		LEFT JOIN comic_drama_styles s ON s.id = p.style_id
		LEFT JOIN workflow_projects wp ON wp.id = p.last_workflow_project_id
		WHERE p.user_id=$1 AND p.public_id=$2`, userID, publicID)
	return scanComicDramaProject(row)
}

func (s *AgentService) ListComicDramaAssets(ctx context.Context, userID int64, projectPublicID string) ([]ComicDramaAssetDTO, error) {
	rows, err := s.db.Query(ctx, `
		SELECT a.public_id, a.asset_type, a.asset_code, a.name, a.description, a.visual_prompt,
		       a.reference_asset_ids, a.metadata, a.version, a.status, a.updated_at
		FROM comic_drama_assets a
		JOIN comic_drama_projects p ON p.id=a.project_id
		WHERE p.public_id=$1 AND p.user_id=$2
		ORDER BY CASE a.asset_type WHEN 'character' THEN 0 WHEN 'prop' THEN 1 ELSE 2 END, a.name`, projectPublicID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ComicDramaAssetDTO{}
	for rows.Next() {
		var item ComicDramaAssetDTO
		var refsRaw, metadataRaw []byte
		var updated time.Time
		if err := rows.Scan(&item.PublicID, &item.AssetType, &item.AssetCode, &item.Name, &item.Description, &item.VisualPrompt, &refsRaw, &metadataRaw, &item.Version, &item.Status, &updated); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(refsRaw, &item.ReferenceAssetIDs)
		_ = json.Unmarshal(metadataRaw, &item.Metadata)
		item.UpdatedAt = updated.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *AgentService) UpsertComicDramaAsset(ctx context.Context, userID int64, projectPublicID, assetPublicID string, input ComicDramaAssetInput) (*ComicDramaAssetDTO, error) {
	assetType := strings.ToLower(strings.TrimSpace(input.AssetType))
	if assetType != "character" && assetType != "prop" && assetType != "location" {
		return nil, errors.New("资产类型必须是角色、道具或场景")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, errors.New("资产名称不能为空")
	}
	creating := strings.TrimSpace(assetPublicID) == ""
	if creating {
		assetPublicID = util.NewPublicID("cda")
	}
	codeFallback := assetType + "_" + assetPublicID
	code := normalizeComicAssetCode(input.AssetCode, codeFallback)
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = "draft"
	}
	if status != "draft" && status != "ready" && status != "locked" {
		return nil, errors.New("资产状态无效")
	}
	if input.Metadata == nil {
		input.Metadata = map[string]interface{}{}
	}
	refs := mustAgentJSON(input.ReferenceAssetIDs)
	metadata := mustAgentJSON(input.Metadata)
	if strings.TrimSpace(input.AssetCode) == "" && len(code) > 32 {
		code = code[len(code)-32:]
	}
	if creating {
		_, err := s.db.Exec(ctx, `INSERT INTO comic_drama_assets
			(public_id, project_id, asset_type, asset_code, name, description, visual_prompt, reference_asset_ids, metadata, status)
			SELECT $1,p.id,$2,$3,$4,$5,$6,$7,$8,$9 FROM comic_drama_projects p WHERE p.public_id=$10 AND p.user_id=$11`,
			assetPublicID, assetType, code, name, strings.TrimSpace(input.Description), strings.TrimSpace(input.VisualPrompt), refs, metadata, status, projectPublicID, userID)
		if err != nil {
			return nil, err
		}
	} else {
		tag, err := s.db.Exec(ctx, `UPDATE comic_drama_assets a SET
			asset_type=$1, asset_code=$2, name=$3, description=$4, visual_prompt=$5,
			reference_asset_ids=$6, metadata=$7, status=$8, version=version+1, updated_at=now()
			FROM comic_drama_projects p WHERE a.project_id=p.id AND a.public_id=$9 AND p.public_id=$10 AND p.user_id=$11`,
			assetType, code, name, strings.TrimSpace(input.Description), strings.TrimSpace(input.VisualPrompt), refs, metadata, status, assetPublicID, projectPublicID, userID)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			return nil, pgx.ErrNoRows
		}
	}
	items, err := s.ListComicDramaAssets(ctx, userID, projectPublicID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].PublicID == assetPublicID {
			return &items[i], nil
		}
	}
	return nil, pgx.ErrNoRows
}

func (s *AgentService) DeleteComicDramaAsset(ctx context.Context, userID int64, projectPublicID, assetPublicID string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM comic_drama_assets a USING comic_drama_projects p
		WHERE a.project_id=p.id AND a.public_id=$1 AND p.public_id=$2 AND p.user_id=$3`, assetPublicID, projectPublicID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func normalizeComicAssetCode(value, fallback string) string {
	value = strings.ToUpper(strings.TrimSpace(firstAgentString(value, fallback)))
	var out strings.Builder
	for _, r := range value {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			out.WriteRune(r)
		} else if out.Len() == 0 || !strings.HasSuffix(out.String(), "_") {
			out.WriteByte('_')
		}
		if out.Len() >= 64 {
			break
		}
	}
	result := strings.Trim(out.String(), "_-")
	if result == "" {
		return "ASSET"
	}
	return result
}

func (s *AgentService) CreateComicDramaProject(ctx context.Context, userID int64, input ComicDramaProjectInput) (*ComicDramaProjectDTO, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, errors.New("项目名称不能为空")
	}
	if len([]rune(name)) > 100 {
		return nil, errors.New("项目名称不能超过100个字")
	}
	workflowCode := strings.TrimSpace(input.WorkflowCode)
	if workflowCode == "" {
		workflowCode = "ai_comic_drama"
	}
	if runtimeCfg := s.comicDramaRuntimeConfigByCode(ctx, workflowCode); runtimeCfg != nil {
		if strings.TrimSpace(input.Orientation) == "" {
			input.Orientation = stringValue(runtimeCfg["orientation"])
		}
		if strings.TrimSpace(input.Quality) == "" {
			input.Quality = stringValue(runtimeCfg["quality"])
		}
	}
	orientation := normalizeComicOrientation(input.Orientation)
	quality := normalizeComicQuality(input.Quality)
	styleDBID, snapshot, err := s.resolveComicStyle(ctx, userID, input.StyleID)
	if err != nil {
		return nil, err
	}
	var styleArg interface{}
	if styleDBID != nil {
		styleArg = *styleDBID
	}
	publicID := util.NewPublicID("cdp")
	_, err = s.db.Exec(ctx, `
		INSERT INTO comic_drama_projects (public_id, user_id, workflow_code, name, description, cover_url, style_id, style_snapshot, orientation, quality)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		publicID, userID, workflowCode, name, strings.TrimSpace(input.Description), strings.TrimSpace(input.CoverURL), styleArg, mustAgentJSON(snapshot), orientation, quality)
	if err != nil {
		return nil, err
	}
	return s.GetComicDramaProject(ctx, userID, publicID)
}

func (s *AgentService) UpdateComicDramaProject(ctx context.Context, userID int64, publicID string, input ComicDramaProjectInput) (*ComicDramaProjectDTO, error) {
	styleDBID, snapshot, err := s.resolveComicStyle(ctx, userID, input.StyleID)
	if err != nil {
		return nil, err
	}
	var styleArg interface{}
	if styleDBID != nil {
		styleArg = *styleDBID
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, errors.New("项目名称不能为空")
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE comic_drama_projects
		SET name=$1, description=$2, cover_url=$3, style_id=$4, style_snapshot=$5, orientation=$6, quality=$7, updated_at=now()
		WHERE public_id=$8 AND user_id=$9`,
		name, strings.TrimSpace(input.Description), strings.TrimSpace(input.CoverURL), styleArg, mustAgentJSON(snapshot), normalizeComicOrientation(input.Orientation), normalizeComicQuality(input.Quality), publicID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, pgx.ErrNoRows
	}
	return s.GetComicDramaProject(ctx, userID, publicID)
}

func (s *AgentService) ArchiveComicDramaProject(ctx context.Context, userID int64, publicID string, archived bool) error {
	var value interface{}
	if archived {
		value = time.Now()
	}
	tag, err := s.db.Exec(ctx, `UPDATE comic_drama_projects SET archived_at=$1, updated_at=now() WHERE public_id=$2 AND user_id=$3`, value, publicID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (s *AgentService) DeleteComicDramaProject(ctx context.Context, userID int64, publicID string) error {
	tag, err := s.db.Exec(ctx, `
		DELETE FROM comic_drama_projects p
		WHERE p.public_id=$1 AND p.user_id=$2
		  AND NOT EXISTS (
		    SELECT 1 FROM workflow_projects wp
		    WHERE wp.id=p.last_workflow_project_id AND wp.status IN ('pending','running','waiting_confirm')
		  )`, publicID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("项目不存在或仍有任务正在执行")
	}
	return nil
}

func (s *AgentService) CloneComicDramaProject(ctx context.Context, userID int64, publicID string) (*ComicDramaProjectDTO, error) {
	project, err := s.GetComicDramaProject(ctx, userID, publicID)
	if err != nil {
		return nil, err
	}
	cloned, err := s.CreateComicDramaProject(ctx, userID, ComicDramaProjectInput{
		Name: project.Name + " 副本", Description: project.Description, CoverURL: project.CoverURL,
		StyleID: project.StyleID, Orientation: project.Orientation, Quality: project.Quality, WorkflowCode: project.WorkflowCode,
	})
	if err != nil {
		return nil, err
	}
	// 项目副本需要继承已锁定的角色、道具和场景；工作流和成片仍保持独立。
	_, err = s.db.Exec(ctx, `INSERT INTO comic_drama_assets
		(public_id, project_id, asset_type, asset_code, name, description, visual_prompt, reference_asset_ids, metadata, version, status)
		SELECT 'cda_' || substr(md5(random()::text || clock_timestamp()::text || a.id::text),1,20), target.id,
		       a.asset_type, a.asset_code, a.name, a.description, a.visual_prompt, a.reference_asset_ids, a.metadata, a.version, a.status
		FROM comic_drama_assets a
		JOIN comic_drama_projects source ON source.id=a.project_id AND source.public_id=$1 AND source.user_id=$2
		JOIN comic_drama_projects target ON target.public_id=$3 AND target.user_id=$2`, publicID, userID, cloned.PublicID)
	if err != nil {
		return nil, err
	}
	return cloned, nil
}

func (s *AgentService) DeleteComicDramaStyle(ctx context.Context, userID int64, publicID string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM comic_drama_styles WHERE public_id=$1 AND user_id=$2 AND source='user'`, publicID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("自定义风格不存在或不可删除")
	}
	return nil
}

func (s *AgentService) attachWorkflowToComicProject(ctx context.Context, userID, workflowProjectID int64, inputs map[string]interface{}) {
	publicID := stringValue(inputs["comic_project_id"])
	if publicID == "" {
		return
	}
	_, _ = s.db.Exec(ctx, `UPDATE comic_drama_projects SET last_workflow_project_id=$1, updated_at=now() WHERE public_id=$2 AND user_id=$3`, workflowProjectID, publicID, userID)
}

func scanComicDramaProject(row pgx.Row) (*ComicDramaProjectDTO, error) {
	var item ComicDramaProjectDTO
	var styleRaw []byte
	var created, updated time.Time
	var archivedAt *time.Time
	if err := row.Scan(&item.PublicID, &item.WorkflowCode, &item.Name, &item.Description, &item.CoverURL, &styleRaw, &item.StyleID, &item.Orientation, &item.Quality, &item.LastWorkflowProjectID, &item.LastWorkflowStatus, &archivedAt, &created, &updated); err != nil {
		return nil, err
	}
	_ = json.Unmarshal(styleRaw, &item.Style)
	if item.Style == nil {
		item.Style = map[string]interface{}{}
	}
	item.CreatedAt = created.Format(time.RFC3339)
	item.UpdatedAt = updated.Format(time.RFC3339)
	item.Archived = archivedAt != nil
	if archivedAt != nil {
		value := archivedAt.Format(time.RFC3339)
		item.ArchivedAt = &value
	}
	return &item, nil
}

func (s *AgentService) resolveComicStyle(ctx context.Context, userID int64, publicID string) (*int64, map[string]interface{}, error) {
	publicID = strings.TrimSpace(publicID)
	if publicID == "" {
		return nil, map[string]interface{}{}, nil
	}
	var id int64
	var name, prompt, coverURL, source string
	err := s.db.QueryRow(ctx, `
		SELECT id, name, prompt, cover_url, source
		FROM comic_drama_styles
		WHERE public_id=$1 AND (source='system' OR user_id=$2)`, publicID, userID).
		Scan(&id, &name, &prompt, &coverURL, &source)
	if err != nil {
		return nil, nil, err
	}
	snapshot := map[string]interface{}{"public_id": publicID, "name": name, "prompt": prompt, "cover_url": coverURL, "source": source}
	return &id, snapshot, nil
}

func projectDisplayTitle(fallback string, inputs map[string]interface{}) string {
	for _, key := range []string{"user_prompt", "prompt", "description", "title"} {
		if v, ok := inputs[key].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return fallback
}

func normalizeComicOrientation(value string) string {
	switch strings.TrimSpace(value) {
	case "portrait":
		return "portrait"
	default:
		return "landscape"
	}
}

func normalizeComicQuality(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "720P", "1080P":
		return strings.ToUpper(strings.TrimSpace(value))
	default:
		return "480P"
	}
}

func normalizeComicAudioStrategy(value, narrationModelCode string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "video_native", "tts_only", "hybrid":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		if strings.TrimSpace(narrationModelCode) != "" {
			return "hybrid"
		}
		return "video_native"
	}
}

func mustAgentJSON(value interface{}) []byte {
	raw, _ := json.Marshal(value)
	if raw == nil {
		return []byte("{}")
	}
	return raw
}

func mergeComicDramaRuntimeDefaults(runtimeCfg map[string]interface{}, inputs map[string]interface{}) map[string]interface{} {
	if inputs == nil {
		inputs = map[string]interface{}{}
	}
	defaults := map[string]string{
		"style_reference_mode": "style_reference_mode",
		"image_model_code":     "image_model_code",
		"video_model_code":     "video_model_code",
		"narration_model_code": "narration_model_code",
		"audio_strategy":       "audio_strategy",
		"orientation":          "orientation",
		"quality":              "quality",
	}
	for inputKey, runtimeKey := range defaults {
		if stringValue(inputs[inputKey]) != "" {
			continue
		}
		if value, ok := runtimeConfigValue(runtimeCfg, runtimeKey); ok {
			inputs[inputKey] = value
		}
	}
	if len(agentStringSlice(inputs["dialogue_model_codes"], nil)) == 0 {
		if value, ok := runtimeConfigValue(runtimeCfg, "dialogue_model_codes"); ok {
			inputs["dialogue_model_codes"] = value
		}
	}
	if _, ok := inputs["storyboard_grid"]; !ok {
		if value, ok := runtimeConfigValue(runtimeCfg, "storyboard_grid"); ok {
			inputs["storyboard_grid"] = value
		}
	}
	if _, ok := inputs["max_retry"]; !ok {
		if value, ok := runtimeConfigValue(runtimeCfg, "max_retry"); ok {
			inputs["max_retry"] = value
		}
	}
	if _, ok := inputs["_mode"]; !ok {
		if flow, ok := runtimeCfg["flow_options"].(map[string]interface{}); ok {
			if b, ok := flow["enable_step_confirm"].(bool); ok {
				if b {
					inputs["_mode"] = "step"
				} else {
					inputs["_mode"] = "auto"
				}
				return inputs
			}
		}
	}
	return inputs
}

func runtimeConfigValue(runtimeCfg map[string]interface{}, key string) (interface{}, bool) {
	if runtimeCfg == nil {
		return nil, false
	}
	value, ok := runtimeCfg[key]
	if !ok {
		return nil, false
	}
	switch v := value.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return nil, false
		}
	case []interface{}:
		if len(v) == 0 {
			return nil, false
		}
	case []string:
		if len(v) == 0 {
			return nil, false
		}
	}
	return value, true
}

func (s *AgentService) estimateAgentRuntimeCost(ctx context.Context, runtimeCfg map[string]interface{}, inputs map[string]interface{}) float64 {
	if runtimeCfg == nil {
		return 0
	}
	total := 0.0
	if stringValue(runtimeCfg["agent_mode"]) == "video_upscale" {
		if code := stringValue(runtimeCfg["generation_model_code"]); code != "" {
			params := make(map[string]interface{}, len(inputs)+4)
			for key, value := range inputs {
				params[key] = value
			}
			params["count"] = 1
			params["n"] = 1
			params["resolution"] = firstAgentString(stringValue(inputs["target_resolution"]), stringValue(runtimeCfg["default_target_resolution"]), "720P")
			params["operation"] = firstAgentString(stringValue(runtimeCfg["upscale_operation"]), "upscale")
			total += s.estimateModelCostByCode(ctx, code, params, 0, 0)
		}
		return total
	}
	if stringValue(runtimeCfg["agent_mode"]) == "video_redraw" {
		if code := stringValue(runtimeCfg["generation_model_code"]); code != "" {
			params := copyAgentMap(inputs)
			params["count"], params["n"] = 1, 1
			params["operation"] = firstAgentString(stringValue(runtimeCfg["redraw_operation"]), "video_redraw")
			total += s.estimateModelCostByCode(ctx, code, params, 0, 0)
		}
		return total
	}
	if stringValue(runtimeCfg["agent_mode"]) == "subtitle_remove" {
		mode := firstAgentString(stringValue(inputs["subtitle_mode"]), stringValue(runtimeCfg["default_subtitle_mode"]), "auto")
		if mode != "soft_track" {
			if code := stringValue(runtimeCfg["generation_model_code"]); code != "" {
				params := copyAgentMap(inputs)
				params["count"], params["n"] = 1, 1
				params["operation"] = firstAgentString(stringValue(runtimeCfg["subtitle_remove_operation"]), "subtitle_remove")
				total += s.estimateModelCostByCode(ctx, code, params, 0, 0)
			}
		}
		return total
	}
	if stringValue(runtimeCfg["agent_mode"]) == "photo_studio" {
		if code := stringValue(runtimeCfg["analysis_model_code"]); code != "" {
			total += s.estimateModelCostByCode(ctx, code, inputs, 500, 600)
		}
		if code := firstAgentString(stringValue(inputs["model_code"]), stringValue(runtimeCfg["generation_model_code"])); code != "" {
			params := copyAgentMap(inputs)
			params["n"] = positiveAgentInt(intFromAgentAny(inputs["count"]), positiveAgentInt(intFromAgentAny(runtimeCfg["default_count"]), 1))
			total += s.estimateModelCostByCode(ctx, code, params, 0, 0)
		}
		return total
	}
	if stringValue(runtimeCfg["agent_mode"]) == "virtual_try_on" {
		if code := firstAgentString(stringValue(inputs["model_code"]), stringValue(runtimeCfg["generation_model_code"])); code != "" {
			params := copyAgentMap(inputs)
			params["reference_images"] = []string{stringValue(inputs["person_image_url"]), stringValue(inputs["garment_image_url"])}
			params["n"] = positiveAgentInt(intFromAgentAny(inputs["count"]), positiveAgentInt(intFromAgentAny(runtimeCfg["default_count"]), 1))
			total += s.estimateModelCostByCode(ctx, code, params, 0, 0)
		}
		return total
	}
	if stringValue(runtimeCfg["agent_mode"]) == "comic_drama" {
		resolved := copyAgentMap(inputs)
		fillComicResumeModelDefaults(resolved, runtimeCfg)
		return s.estimateComicRemainingCost(ctx, runtimeCfg, resolved, remainingComicWork(resolved, nil, runtimeCfg))
	}
	if code := stringValue(runtimeCfg["analysis_model_code"]); code != "" {
		total += s.estimateModelCostByCode(ctx, code, inputs, 500, 1000)
	}
	if code := stringValue(runtimeCfg["generation_model_code"]); code != "" {
		generationInputs := inputs
		if (stringValue(inputs["creative_scene"]) == "detail_image" || stringValue(inputs["creative_scene"]) == "auto") && stringValue(runtimeCfg["generation_type"]) != "video" {
			generationInputs = make(map[string]interface{}, len(inputs)+2)
			for key, value := range inputs {
				generationInputs[key] = value
			}
			sectionCount := intFromAgentAny(inputs["detail_section_count"])
			if sectionCount < 4 || sectionCount > 8 {
				if requested := intFromAgentAny(inputs["count"]); requested >= 4 && requested <= 8 {
					sectionCount = requested
				} else {
					sectionCount = 5
				}
			}
			// Auto analysis may choose a detail page; reserve for either outcome.
			if stringValue(inputs["creative_scene"]) == "auto" && intFromAgentAny(inputs["count"]) > sectionCount {
				sectionCount = intFromAgentAny(inputs["count"])
			}
			generationInputs["count"] = sectionCount
			generationInputs["n"] = sectionCount
		}
		total += s.estimateModelCostByCode(ctx, code, generationInputs, 0, 0)
	}
	return total
}

func copyAgentMap(source map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(source)+4)
	for key, value := range source {
		out[key] = value
	}
	return out
}

func comicSegmentDurationSeconds(inputs, runtimeCfg map[string]interface{}) int {
	if seconds := intFromAgentAny(inputs["segment_duration_sec"]); seconds >= 1 && seconds <= 600 {
		return seconds
	}
	switch firstAgentString(stringValue(inputs["duration_mode"]), stringValue(runtimeCfg["duration_mode"])) {
	case "compact":
		return 4
	case "long":
		return 8
	default:
		return 5
	}
}

func normalizeComicVideoResolution(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "480p", "720p", "1080p", "4k":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "480p"
	}
}

func (s *AgentService) estimateModelCostByCode(ctx context.Context, code string, params map[string]interface{}, promptTokens, outputTokens int) float64 {
	var raw []byte
	var category string
	if err := s.db.QueryRow(ctx, `SELECT price_rule, category FROM models WHERE code=$1 AND is_enabled=true`, code).Scan(&raw, &category); err != nil {
		return 0
	}
	rule := map[string]interface{}{}
	_ = json.Unmarshal(raw, &rule)
	if category == "audio" {
		params = copyAgentMap(params)
		params["_billing_item_count"] = billingItemCount(params)
	}
	return estimateCostFromPriceRule(rule, params, promptTokens, outputTokens)
}

func estimateCostFromPriceRule(rule map[string]interface{}, params map[string]interface{}, promptTokens, outputTokens int) float64 {
	billingType := stringValue(rule["billing_type"])
	switch billingType {
	case "per_image":
		n := floatValue(params["n"])
		if n <= 0 {
			n = floatValue(params["count"])
		}
		if n <= 0 {
			n = 1
		}
		return imageTierPrice(rule, params, "unit_price_by_size", "unit_price") * n
	case "per_token":
		inPrice := perAgentTokenPrice(rule, "input_price")
		outPrice := perAgentTokenPrice(rule, "output_price")
		promptTokens, outputTokens = estimatedTokenCounts(rule, params, promptTokens, outputTokens)
		cost := float64(promptTokens)*inPrice + float64(outputTokens)*outPrice
		if surcharge := floatValue(rule["surcharge_per_m"]); surcharge > 0 {
			cost += float64(promptTokens+outputTokens) / 1_000_000 * surcharge
		}
		multiplier := floatValue(params["_billing_item_count"])
		if multiplier <= 0 {
			multiplier = 1
		}
		return cost * multiplier
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
	case "dynamic":
		return estimateDynamicCost(rule, params)
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

func (s *AgentService) RetryProject(ctx context.Context, userID int64, publicID string, modelOverrides map[string]string) error {
	return s.retryProject(ctx, userID, publicID, modelOverrides)
}

func (s *AgentService) retryProject(ctx context.Context, userID int64, publicID string, modelOverrides map[string]string) error {
	if err := s.preventProductLegacyRetry(ctx, userID, publicID); err != nil {
		return err
	}
	var projectID int64
	var status string
	var estimated float64
	var inputsRaw, outputsRaw, runtimeRaw []byte
	err := s.db.QueryRow(ctx,
		`SELECT p.id, p.status, p.estimated_cost, p.inputs, p.outputs, w.runtime_config
		 FROM workflow_projects p
		 JOIN workflow_definitions w ON w.id=p.workflow_id
		 WHERE p.public_id=$1 AND p.user_id=$2`, publicID, userID).
		Scan(&projectID, &status, &estimated, &inputsRaw, &outputsRaw, &runtimeRaw)
	if err != nil {
		return err
	}
	if status != "failed" {
		return errors.New("仅失败的项目可重试")
	}
	inputs, outputs, runtimeCfg := map[string]interface{}{}, map[string]interface{}{}, map[string]interface{}{}
	_ = json.Unmarshal(inputsRaw, &inputs)
	_ = json.Unmarshal(outputsRaw, &outputs)
	_ = json.Unmarshal(runtimeRaw, &runtimeCfg)
	refreshComicRetryModels(inputs, outputs, runtimeCfg, modelOverrides)
	if stringValue(runtimeCfg["agent_mode"]) == "comic_drama" {
		fillComicResumeModelDefaults(inputs, runtimeCfg)
		work := remainingComicWork(inputs, outputs, runtimeCfg)
		if _, ok := outputs["comic_drama"].(map[string]interface{}); ok && work.Plan {
			return errors.New("已保存的分镜为空，请重试规划节点；未提交新的素材任务")
		}
		if err := s.validateComicRemainingModels(ctx, inputs, work); err != nil {
			return err
		}
		estimated = s.estimateComicRemainingCost(ctx, runtimeCfg, inputs, work)
		// A prior settlement failure may leave real usage unpaid. It is not a
		// second generation charge, but still needs a reservation for finalization.
		_, unsettled, err := accruedWorkflowCostDB(ctx, s.db, projectID)
		if err != nil {
			return err
		}
		estimated += unsettled
		inputs["_resume_remaining"] = work
		inputs["_resume_unsettled_cost"] = unsettled
		inputs["_resume_estimated_cost"] = estimated
	}
	if err := s.billing.FreezeWithFinalize(ctx, userID, estimated, "workflow", publicID, func(tx pgx.Tx) error {
		var currentStatus string
		if err := tx.QueryRow(ctx, `SELECT status FROM workflow_projects WHERE id=$1 FOR UPDATE`, projectID).Scan(&currentStatus); err != nil {
			return err
		}
		if currentStatus != "failed" {
			return errors.New("仅失败的项目可重试")
		}
		// The calculation above is a snapshot. Fail closed if another editor or
		// node retry changed the checkpoints before this transaction acquired them.
		var unchanged bool
		if err := tx.QueryRow(ctx, `SELECT inputs=$2::jsonb AND outputs=$3::jsonb FROM workflow_projects WHERE id=$1`, projectID, inputsRaw, outputsRaw).Scan(&unchanged); err != nil {
			return err
		}
		if !unchanged {
			return errors.New("项目素材或参数已变化，请刷新后再续传")
		}
		var locked bool
		if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, projectID).Scan(&locked); err != nil {
			return err
		}
		if !locked {
			return errors.New("项目正在处理中，请稍后重试")
		}
		result, err := tx.Exec(ctx, `UPDATE workflow_projects SET status='pending', inputs=$2, error_message=NULL, finished_at=NULL, updated_at=now() WHERE id=$1 AND status='failed'`, projectID, mustAgentJSON(inputs))
		if err != nil {
			return err
		}
		if result.RowsAffected() != 1 {
			return errors.New("项目状态已变化，请刷新后重试")
		}
		return nil
	}); err != nil {
		if errors.Is(err, billing.ErrInsufficientBalance) {
			return errors.New(billing.InsufficientBalanceMsg)
		}
		return err
	}
	// 保留既有节点记录。工作流会复用 outputs 中已成功的阶段；保留记录还能让
	// 最终结算包含失败前已经实际发生的媒体成本，并为运营排障留下审计轨迹。
	if err := queue.EnqueueWorkflowTask(s.queue, queue.WorkflowTaskPayload{ProjectID: projectID, UserID: userID}); err != nil {
		cleanupErr := s.billing.UnfreezeWithFinalize(ctx, userID, estimated, "workflow", publicID, func(tx pgx.Tx) error {
			_, updateErr := tx.Exec(ctx, `UPDATE workflow_projects SET status='failed', error_message='重试入队失败', finished_at=now(), updated_at=now() WHERE id=$1 AND status='pending'`, projectID)
			return updateErr
		})
		if cleanupErr != nil {
			return fmt.Errorf("工作流重试入队失败: %v；回滚冻结额度失败: %w", err, cleanupErr)
		}
		return err
	}
	return nil
}

func (s *AgentService) RetryProjectNode(ctx context.Context, userID int64, publicID, nodeID string, modelOverrides map[string]string) error {
	if err := s.preventProductLegacyRetry(ctx, userID, publicID); err != nil {
		return err
	}
	nodeID = strings.TrimSpace(nodeID)
	allowed := map[string]bool{"comic_plan": true, "keyframes": true, "video_segments": true, "narrations": true, "compose": true, "generate": true}
	if !allowed[nodeID] {
		return errors.New("该节点不支持单独重试")
	}
	var projectID int64
	var status string
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT id, status, outputs FROM workflow_projects WHERE public_id=$1 AND user_id=$2`, publicID, userID).Scan(&projectID, &status, &raw); err != nil {
		return err
	}
	if status != "failed" {
		return errors.New("仅失败的项目可重试节点")
	}
	var failed bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workflow_node_runs WHERE project_id=$1 AND node_id=$2 AND status='failed')`, projectID, nodeID).Scan(&failed); err != nil {
		return err
	}
	if !failed && nodeID != "compose" {
		return errors.New("未找到失败的节点记录")
	}
	outputs := map[string]interface{}{}
	_ = json.Unmarshal(raw, &outputs)
	pruneWorkflowOutputsForRetry(outputs, nodeID)
	tag, err := s.db.Exec(ctx, `UPDATE workflow_projects SET outputs=$1, updated_at=now() WHERE id=$2 AND status='failed' AND outputs=$3::jsonb`, mustAgentJSON(outputs), projectID, raw)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("项目状态或素材已变化，请刷新后重试")
	}
	return s.retryProject(ctx, userID, publicID, modelOverrides)
}

func (s *AgentService) ReplaceComicProjectMedia(ctx context.Context, userID int64, publicID, kind string, index int, rawURL string) error {
	if kind != "keyframes" && kind != "segments" {
		return errors.New("素材类型无效")
	}
	var projectID int64
	var status string
	var raw []byte
	if err := s.db.QueryRow(ctx, `SELECT id, status, outputs FROM workflow_projects WHERE public_id=$1 AND user_id=$2`, publicID, userID).Scan(&projectID, &status, &raw); err != nil {
		return err
	}
	if status != "failed" && status != "waiting_confirm" {
		return errors.New("仅失败或待确认项目可替换素材")
	}
	outputs := map[string]interface{}{}
	_ = json.Unmarshal(raw, &outputs)
	items, ok := outputs[kind].([]interface{})
	if !ok || index < 0 || index >= len(items) {
		return errors.New("素材序号不存在")
	}
	item, ok := items[index].(map[string]interface{})
	if !ok {
		return errors.New("素材数据格式无效")
	}
	previous := make(map[string]interface{}, len(item))
	for key, value := range item {
		previous[key] = value
	}
	history, _ := outputs["media_history"].([]interface{})
	outputs["media_history"] = append(history, map[string]interface{}{"kind": kind, "reason": "manual_replacement", "item": previous})
	field := "image_url"
	if kind == "segments" {
		field = "video_url"
	}
	item[field] = strings.TrimSpace(rawURL)
	item["manual_replacement"] = true
	item["status"] = "succeeded"
	delete(item, "error_message")
	item["scores"] = map[string]interface{}{"checked": false, "status": "not_checked"}
	items[index] = item
	outputs[kind] = items
	if kind == "keyframes" {
		// 替换关键帧后，旧分段视频与最终成片已经失去来源一致性，必须显式失效。
		invalidateComicShotSegments(outputs, stringValue(item["id"]))
		delete(outputs, "final_video_url")
		delete(outputs, "thumbnail")
		outputs["current_step"] = "video_segments"
	} else {
		delete(outputs, "final_video_url")
		delete(outputs, "thumbnail")
		outputs["current_step"] = "compose"
		if comic, ok := outputs["comic_drama"].(map[string]interface{}); ok {
			delete(comic, "final_video_url")
			delete(comic, "thumbnail")
			delete(comic, "compose_status")
		}
	}
	if comic, ok := outputs["comic_drama"].(map[string]interface{}); ok {
		comic[kind] = items
		outputs["comic_drama"] = comic
	}
	tag, err := s.db.Exec(ctx, `UPDATE workflow_projects SET outputs=$1, updated_at=now() WHERE id=$2 AND status=$3 AND outputs=$4::jsonb`, mustAgentJSON(outputs), projectID, status, raw)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errors.New("项目已开始执行或素材已变化，请刷新后重试")
	}
	return nil
}

// A replaced frame invalidates only its own video; keep paid sibling clips.
func invalidateComicShotSegments(outputs map[string]interface{}, shotID string) {
	var kept []interface{}
	items, _ := outputs["segments"].([]interface{})
	for _, raw := range items {
		item, _ := raw.(map[string]interface{})
		if shotID != "" && stringValue(item["id"]) != "" && stringValue(item["id"]) != shotID {
			kept = append(kept, raw)
		} else {
			history, _ := outputs["media_history"].([]interface{})
			outputs["media_history"] = append(history, map[string]interface{}{"kind": "segments", "reason": "source_frame_changed", "item": raw})
		}
	}
	outputs["segments"] = kept
	if comic, ok := outputs["comic_drama"].(map[string]interface{}); ok {
		comic["segments"] = kept
		delete(comic, "final_video_url")
		delete(comic, "thumbnail")
		delete(comic, "compose_status")
	}
}

func (s *AgentService) CancelProject(ctx context.Context, userID int64, publicID string) error {
	var projectID int64
	var estimated float64
	var status string
	if err := s.db.QueryRow(ctx,
		`SELECT id, estimated_cost, status FROM workflow_projects WHERE public_id=$1 AND user_id=$2`, publicID, userID).
		Scan(&projectID, &estimated, &status); err != nil {
		return err
	}
	if status == "canceling" || status == "canceled" {
		return nil
	}
	if status == "running" {
		tag, err := s.db.Exec(ctx, `
			UPDATE workflow_projects
			SET status='canceling', error_message='正在停止：当前上游请求完成后不再启动后续步骤', updated_at=now()
			WHERE id=$1 AND status='running'`, projectID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("项目状态已变化，请刷新后重试")
		}
		return nil
	}
	if status != "pending" && status != "waiting_confirm" {
		return errors.New("当前项目无法停止")
	}
	cumulativeCost, chargeCost, err := s.accruedWorkflowCost(ctx, projectID)
	if err != nil {
		return err
	}
	finalize := func(tx pgx.Tx) error {
		var lockAvailable bool
		if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, projectID).Scan(&lockAvailable); err != nil {
			return err
		}
		if !lockAvailable {
			return errors.New("项目正在执行，暂时无法安全取消")
		}
		tag, err := tx.Exec(ctx, `
			UPDATE workflow_projects
			SET status='canceled', actual_cost=$2, error_message='用户已取消', finished_at=now(), updated_at=now()
			WHERE id=$1 AND status IN ('pending','waiting_confirm')`, projectID, cumulativeCost)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("仅排队中或待确认的项目可取消")
		}
		return nil
	}
	if chargeCost > 0 {
		return s.billing.ChargeWithFinalize(ctx, userID, estimated, chargeCost, "workflow", publicID, "workflow_usage", "工作流取消前已完成步骤", finalize)
	}
	return s.billing.UnfreezeWithFinalize(ctx, userID, estimated, "workflow", publicID, finalize)
}

func (s *AgentService) accruedWorkflowCost(ctx context.Context, projectID int64) (float64, float64, error) {
	return accruedWorkflowCostDB(ctx, s.db, projectID)
}

// queryRower 允许累计成本计算在 AgentService 与 OpsService 间复用。
type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
}

func accruedWorkflowCostDB(ctx context.Context, db queryRower, projectID int64) (float64, float64, error) {
	var raw, outputsRaw []byte
	var nodeCost, settledCost float64
	if err := db.QueryRow(ctx, `
		SELECT COALESCE(w.price_rule, '{}'::jsonb),
		       COALESCE((SELECT SUM(n.cost) FROM workflow_node_runs n WHERE n.project_id=p.id), 0),
		       p.actual_cost,
		       COALESCE(p.outputs, '{}'::jsonb)
		FROM workflow_projects p
		JOIN workflow_definitions w ON w.id=p.workflow_id
		WHERE p.id=$1`, projectID).Scan(&raw, &nodeCost, &settledCost, &outputsRaw); err != nil {
		return 0, 0, err
	}
	rule := map[string]interface{}{}
	_ = json.Unmarshal(raw, &rule)
	cumulativeCost := nodeCost
	switch stringValue(rule["billing_type"]) {
	case "per_request":
		if unitPrice := floatValue(rule["unit_price"]); nodeCost > 0 && unitPrice > 0 {
			cumulativeCost = unitPrice
		}
	case "per_chapter":
		outputs := map[string]interface{}{}
		_ = json.Unmarshal(outputsRaw, &outputs)
		if chapterCost := chapterBasedCost(rule, floatValue(outputs["current_chapter"])); chapterCost > 0 {
			cumulativeCost = chapterCost
		}
	default:
		// model_actual/dynamic：已产生用量时收取 工作流费 + 大模型用量费；
		// 用量取 min(上游真实成本, 按模型设定单价计算的售价)，与完成结算口径一致。
		if nodeCost > 0 {
			usage := nodeCost
			if provider := workflowUpstreamProviderCostDB(ctx, db, projectID); provider > 0 && provider < usage {
				usage = provider
			}
			cumulativeCost = usage + floatValue(rule["unit_price"])
		}
	}
	if cumulativeCost < 0 {
		cumulativeCost = 0
	}
	chargeCost := cumulativeCost - settledCost
	if chargeCost < 0 {
		chargeCost = 0
	}
	return cumulativeCost, chargeCost, nil
}

func pruneWorkflowOutputsForRetry(outputs map[string]interface{}, nodeID string) {
	switch nodeID {
	case "comic_plan":
		for _, key := range []string{"comic_drama", "analysis", "keyframes", "segments", "narrations", "final_video_url", "thumbnail", "media_tasks", "current_step"} {
			delete(outputs, key)
		}
		outputs["current_step"] = "comic_plan"
	case "keyframes":
		// 保留已经成功的关键帧。worker 会按分镜 ID 复用它们，只补失败或缺失项，
		// 避免局部失败后重复生成成功内容和产生不必要费用。
		outputs["keyframes"] = successfulComicStageItems(outputs["keyframes"], "image_url")
		for _, key := range []string{"final_video_url", "thumbnail", "media_tasks"} {
			delete(outputs, key)
		}
		// The worker checks each video's source frame before reusing it. Keep
		// sibling videos and independent speech; a failed frame is not a full reset.
		outputs["current_step"] = "keyframes"
	case "video_segments":
		// 视频片段同样按分镜 ID 增量补齐。
		outputs["segments"] = successfulComicStageItems(outputs["segments"], "video_url")
		for _, key := range []string{"final_video_url", "thumbnail", "media_tasks"} {
			delete(outputs, key)
		}
		outputs["current_step"] = "video_segments"
	case "narrations":
		outputs["narrations"] = successfulComicNarrationItems(outputs["narrations"])
		for _, key := range []string{"final_video_url", "thumbnail", "media_tasks"} {
			delete(outputs, key)
		}
		outputs["current_step"] = "narrations"
	case "compose":
		for _, key := range []string{"final_video_url", "thumbnail", "media_tasks"} {
			delete(outputs, key)
		}
		outputs["current_step"] = "compose"
	case "generate":
		outputs["media_tasks"] = successfulAgentMediaItems(outputs["media_tasks"])
		outputs["current_step"] = "generate"
	}
}

func successfulAgentMediaItems(raw interface{}) []interface{} {
	items, _ := raw.([]interface{})
	result := make([]interface{}, 0, len(items))
	for _, value := range items {
		item, ok := value.(map[string]interface{})
		if ok && stringValue(item["status"]) == "succeeded" {
			result = append(result, item)
		}
	}
	return result
}

func successfulComicStageItems(raw interface{}, outputKey string) []interface{} {
	items, _ := raw.([]interface{})
	result := make([]interface{}, 0, len(items))
	for _, value := range items {
		item, ok := value.(map[string]interface{})
		if !ok || stringValue(item[outputKey]) == "" || stringValue(item["status"]) == "failed" {
			continue
		}
		result = append(result, item)
	}
	return result
}

func successfulComicNarrationItems(raw interface{}) []interface{} {
	items, _ := raw.([]interface{})
	result := make([]interface{}, 0, len(items))
	for _, value := range items {
		item, ok := value.(map[string]interface{})
		if !ok || stringValue(item["status"]) == "failed" {
			continue
		}
		if stringValue(item["audio_url"]) == "" && stringValue(item["status"]) != "skipped" {
			continue
		}
		result = append(result, item)
	}
	return result
}

// Automatic retries keep a partial stage's model snapshot for consistency.
// An explicit user override changes only the unfinished items in that stage.
func refreshComicRetryModels(inputs, outputs, runtimeCfg map[string]interface{}, modelOverrides map[string]string) {
	if stringValue(runtimeCfg["agent_mode"]) != "comic_drama" && stringValue(runtimeCfg["preset_code"]) != "ai_comic_drama" {
		return
	}
	// Apply current models independently of node records: a worker may fail before
	// recording current_step, and downstream unfinished stages also need the update.
	for _, key := range []string{"image_model_code", "video_model_code", "narration_model_code"} {
		if code := strings.TrimSpace(modelOverrides[key]); code != "" {
			inputs[key] = code
		}
	}
	if code := strings.TrimSpace(modelOverrides["dialogue_model_code"]); code != "" {
		inputs["dialogue_model_codes"] = []string{code}
	}
	switch stringValue(outputs["current_step"]) {
	case "comic_plan":
		if code := strings.TrimSpace(modelOverrides["dialogue_model_code"]); code != "" {
			inputs["dialogue_model_codes"] = []string{code}
		} else if codes := agentStringSlice(runtimeCfg["dialogue_model_codes"], nil); len(codes) > 0 {
			inputs["dialogue_model_codes"] = codes
		} else if code := stringValue(runtimeCfg["analysis_model_code"]); code != "" {
			inputs["dialogue_model_codes"] = []string{code}
		}
	case "keyframes":
		if code := strings.TrimSpace(modelOverrides["image_model_code"]); code != "" {
			inputs["image_model_code"] = code
		} else if len(successfulComicStageItems(outputs["keyframes"], "image_url")) == 0 {
			if code := firstAgentString(stringValue(runtimeCfg["image_model_code"]), stringValue(runtimeCfg["generation_model_code"])); code != "" {
				inputs["image_model_code"] = code
			}
		}
	case "video_segments":
		if code := strings.TrimSpace(modelOverrides["video_model_code"]); code != "" {
			inputs["video_model_code"] = code
		} else if len(successfulComicStageItems(outputs["segments"], "video_url")) == 0 {
			if code := firstAgentString(stringValue(runtimeCfg["video_model_code"]), stringValue(runtimeCfg["generation_model_code"])); code != "" {
				inputs["video_model_code"] = code
			}
		}
	case "narrations":
		if code := strings.TrimSpace(modelOverrides["narration_model_code"]); code != "" {
			inputs["narration_model_code"] = code
		} else if len(successfulComicNarrationItems(outputs["narrations"])) == 0 {
			if code := stringValue(runtimeCfg["narration_model_code"]); code != "" {
				inputs["narration_model_code"] = code
			}
		}
	}
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
	if mode, _ := in.RuntimeConfig["agent_mode"].(string); mode == "comic_drama" {
		in = normalizeComicDramaAgentInput(in)
		if err := s.validateComicDramaGenerationModels(ctx, in.RuntimeConfig); err != nil {
			return err
		}
	} else if mode == "simple_pipeline" {
		in = normalizeSimpleAgentInput(in)
	} else if mode == "video_upscale" {
		in = normalizeVideoUpscaleAgentInput(in)
		if err := s.validateVideoUpscaleAdminModel(ctx, in.RuntimeConfig); err != nil {
			return err
		}
	} else if mode == "video_redraw" {
		in = normalizeVideoRedrawAgentInput(in)
		if err := s.validateVideoUpscaleAdminModel(ctx, in.RuntimeConfig); err != nil {
			return err
		}
	} else if mode == "subtitle_remove" {
		in = normalizeSubtitleRemovalAgentInput(in)
		if stringValue(in.RuntimeConfig["generation_model_code"]) != "" {
			if err := s.validateVideoUpscaleAdminModel(ctx, in.RuntimeConfig); err != nil {
				return err
			}
		}
	}
	if err := validateWorkflowPriceRule(in.PriceRule); err != nil {
		return err
	}
	nodes, _ := json.Marshal(in.Nodes)
	if len(in.Nodes) == 0 {
		nodes = []byte("[]")
	}
	schema, _ := json.Marshal(in.InputSchema)
	price, _ := json.Marshal(in.PriceRule)
	display, _ := json.Marshal(in.DisplayConfig)
	// Policy versions are only written through the validated, versioned endpoint.
	delete(in.RuntimeConfig, "agent_policy")
	delete(in.RuntimeConfig, "agent_policy_history")
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
		  name=$2, description=$3, icon=$4, category=$5, nodes=$6, input_schema=$7, price_rule=$8, display_config=$9,
		  runtime_config=$10::jsonb || (SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(workflow_definitions.runtime_config) WHERE key IN ('agent_policy','agent_policy_history')),
		  is_enabled=$11, sort_order=$12, updated_at=now()`,
		in.Code, in.Name, desc, icon, in.Category, nodes, schema, price, display, runtime, in.IsEnabled, in.SortOrder)
	return err
}

func validateWorkflowPriceRule(rule map[string]interface{}) error {
	billingType := strings.ToLower(strings.TrimSpace(stringValue(rule["billing_type"])))
	switch billingType {
	case "per_request", "model_actual", "dynamic", "per_chapter":
	default:
		return fmt.Errorf("不支持的工作流计费类型：%s", billingType)
	}
	for _, key := range []string{"unit_price", "planning_price", "free_trial_chapters"} {
		if floatValue(rule[key]) < 0 {
			return fmt.Errorf("工作流计费字段 %s 不能为负数", key)
		}
	}
	if billingType == "per_chapter" && floatValue(rule["unit_price"]) <= 0 && floatValue(rule["planning_price"]) <= 0 {
		return errors.New("按章计费至少需要配置章节单价或策划费")
	}
	return nil
}

// novelChapterEstimate 按目标篇幅估算章节数，用于创建时的冻结额度。
func novelChapterEstimate(inputs map[string]interface{}) float64 {
	switch stringValue(inputs["length_code"]) {
	case "short":
		return 10
	case "long":
		return 40
	default:
		return 20
	}
}

// chapterBasedCost 计算按章计费的累计费用：策划费 + 章节单价 × 超免费章节数。
func chapterBasedCost(rule map[string]interface{}, chapters float64) float64 {
	billable := chapters - floatValue(rule["free_trial_chapters"])
	if billable < 0 {
		billable = 0
	}
	cost := floatValue(rule["planning_price"]) + floatValue(rule["unit_price"])*billable
	if cost < 0 {
		cost = 0
	}
	return cost
}

// workflowUpstreamProviderCost 汇总小说工坊项目 LLM 调用的上游真实成本，
// 与 worker 端结算口径保持一致（每个 request_id 取最后一次成功调用）。
func (s *AgentService) workflowUpstreamProviderCost(ctx context.Context, projectID int64) float64 {
	return workflowUpstreamProviderCostDB(ctx, s.db, projectID)
}

func workflowUpstreamProviderCostDB(ctx context.Context, db queryRower, projectID int64) float64 {
	var total float64
	err := db.QueryRow(ctx, `
		SELECT COALESCE(SUM(latest_cost), 0) FROM (
			SELECT DISTINCT ON (request_id) provider_cost AS latest_cost
			FROM model_route_attempts
			WHERE status='SUCCESS' AND provider_cost IS NOT NULL
			  AND (request_id = $1
			       OR request_id LIKE $2
			       OR request_id LIKE $3
			       OR request_id LIKE $4)
			ORDER BY request_id, id DESC
		) t`,
		fmt.Sprintf("novel_planning_%d", projectID),
		fmt.Sprintf("novel_write_%d_ch%%", projectID),
		fmt.Sprintf("novel_polish_%d_ch%%", projectID),
		fmt.Sprintf("novel_archive_%d_ch%%", projectID)).Scan(&total)
	if err != nil {
		return 0
	}
	return total
}

func normalizeVideoRedrawAgentInput(in AgentUpsertInput) AgentUpsertInput {
	in.Category = "video"
	in.GenerationType = "video"
	in.RuntimeConfig["agent_mode"] = "video_redraw"
	in.RuntimeConfig["generation_type"] = "video"
	in.RuntimeConfig["preset_code"] = "video_redraw"
	if stringValue(in.RuntimeConfig["generation_model_code"]) == "" {
		in.RuntimeConfig["generation_model_code"] = in.GenerationModelCode
	}
	if floatValue(in.RuntimeConfig["default_style_strength"]) <= 0 {
		in.RuntimeConfig["default_style_strength"] = 0.65
	}
	for _, key := range []string{"preserve_motion", "preserve_identity", "preserve_audio"} {
		if _, ok := in.RuntimeConfig[key]; !ok {
			in.RuntimeConfig[key] = true
		}
	}
	if intFromAgentAny(in.RuntimeConfig["max_input_duration_sec"]) <= 0 {
		in.RuntimeConfig["max_input_duration_sec"] = 180
	}
	if intFromAgentAny(in.RuntimeConfig["max_input_size_mb"]) <= 0 {
		in.RuntimeConfig["max_input_size_mb"] = 500
	}
	in.RuntimeConfig["default_count"] = 1
	in.Nodes = []WorkflowNode{{ID: "redraw", Type: "video", Name: "一键转绘", ModelCode: stringValue(in.RuntimeConfig["generation_model_code"]), Cost: 0}}
	in.InputSchema = map[string]interface{}{
		"type": "object", "required": []string{"video_url"},
		"properties": map[string]interface{}{
			"video_url":         map[string]interface{}{"type": "string", "title": "源视频"},
			"style_strength":    map[string]interface{}{"type": "number", "title": "转绘强度", "minimum": 0.05, "maximum": 1, "default": in.RuntimeConfig["default_style_strength"]},
			"preserve_motion":   map[string]interface{}{"type": "boolean", "title": "保持动作", "default": in.RuntimeConfig["preserve_motion"]},
			"preserve_identity": map[string]interface{}{"type": "boolean", "title": "保持人物一致", "default": in.RuntimeConfig["preserve_identity"]},
			"preserve_audio":    map[string]interface{}{"type": "boolean", "title": "保留原音", "default": in.RuntimeConfig["preserve_audio"]},
		},
	}
	return in
}

func normalizeSubtitleRemovalAgentInput(in AgentUpsertInput) AgentUpsertInput {
	in.Category = "video"
	in.GenerationType = "video"
	in.RuntimeConfig["agent_mode"] = "subtitle_remove"
	in.RuntimeConfig["generation_type"] = "video"
	in.RuntimeConfig["preset_code"] = "subtitle_remove"
	if stringValue(in.RuntimeConfig["generation_model_code"]) == "" {
		in.RuntimeConfig["generation_model_code"] = in.GenerationModelCode
	}
	if stringValue(in.RuntimeConfig["default_subtitle_mode"]) == "" {
		in.RuntimeConfig["default_subtitle_mode"] = "auto"
	}
	if stringValue(in.RuntimeConfig["default_subtitle_region"]) == "" {
		in.RuntimeConfig["default_subtitle_region"] = "bottom_25"
	}
	if _, ok := in.RuntimeConfig["protect_watermark"]; !ok {
		in.RuntimeConfig["protect_watermark"] = true
	}
	if intFromAgentAny(in.RuntimeConfig["max_input_duration_sec"]) <= 0 {
		in.RuntimeConfig["max_input_duration_sec"] = 300
	}
	if intFromAgentAny(in.RuntimeConfig["max_input_size_mb"]) <= 0 {
		in.RuntimeConfig["max_input_size_mb"] = 1000
	}
	in.RuntimeConfig["default_count"] = 1
	in.Nodes = []WorkflowNode{{ID: "remove_subtitle", Type: "video", Name: "一键去字幕", ModelCode: stringValue(in.RuntimeConfig["generation_model_code"]), Cost: 0}}
	in.InputSchema = map[string]interface{}{
		"type": "object", "required": []string{"video_url"},
		"properties": map[string]interface{}{
			"video_url":         map[string]interface{}{"type": "string", "title": "源视频"},
			"subtitle_mode":     map[string]interface{}{"type": "string", "title": "去字幕模式", "enum": []string{"auto", "soft_track", "hardcoded_ai"}, "default": in.RuntimeConfig["default_subtitle_mode"]},
			"subtitle_region":   map[string]interface{}{"type": "string", "title": "字幕区域", "enum": []string{"bottom_15", "bottom_25", "bottom_35", "full_frame"}, "default": in.RuntimeConfig["default_subtitle_region"]},
			"protect_watermark": map[string]interface{}{"type": "boolean", "title": "保护水印与标识", "default": in.RuntimeConfig["protect_watermark"]},
		},
	}
	return in
}

func normalizeVideoUpscaleAgentInput(in AgentUpsertInput) AgentUpsertInput {
	in.Category = "video"
	in.GenerationType = "video"
	in.RuntimeConfig["agent_mode"] = "video_upscale"
	in.RuntimeConfig["generation_type"] = "video"
	in.RuntimeConfig["preset_code"] = "video_upscale"
	if stringValue(in.RuntimeConfig["generation_model_code"]) == "" {
		in.RuntimeConfig["generation_model_code"] = in.GenerationModelCode
	}
	if len(agentStringSlice(in.RuntimeConfig["supported_resolutions"], nil)) == 0 {
		in.RuntimeConfig["supported_resolutions"] = []string{"720P", "1K", "2K"}
	}
	if normalizeAgentUpscaleResolution(stringValue(in.RuntimeConfig["default_target_resolution"])) == "" {
		in.RuntimeConfig["default_target_resolution"] = "720P"
	}
	if _, ok := in.RuntimeConfig["preserve_audio"]; !ok {
		in.RuntimeConfig["preserve_audio"] = true
	}
	if stringValue(in.RuntimeConfig["default_enhancement_mode"]) == "" {
		in.RuntimeConfig["default_enhancement_mode"] = "balanced"
	}
	if intFromAgentAny(in.RuntimeConfig["max_input_duration_sec"]) <= 0 {
		in.RuntimeConfig["max_input_duration_sec"] = 300
	}
	if intFromAgentAny(in.RuntimeConfig["max_input_size_mb"]) <= 0 {
		in.RuntimeConfig["max_input_size_mb"] = 500
	}
	in.RuntimeConfig["default_count"] = 1
	in.Nodes = []WorkflowNode{{ID: "upscale", Type: "video", Name: "AI 视频高清", ModelCode: stringValue(in.RuntimeConfig["generation_model_code"]), Cost: 0}}
	in.InputSchema = map[string]interface{}{
		"type":     "object",
		"required": []string{"video_url", "target_resolution"},
		"properties": map[string]interface{}{
			"video_url":         map[string]interface{}{"type": "string", "title": "源视频"},
			"target_resolution": map[string]interface{}{"type": "string", "title": "目标清晰度", "enum": in.RuntimeConfig["supported_resolutions"], "default": in.RuntimeConfig["default_target_resolution"]},
			"preserve_audio":    map[string]interface{}{"type": "boolean", "title": "保留原音", "default": in.RuntimeConfig["preserve_audio"]},
			"enhancement_mode":  map[string]interface{}{"type": "string", "title": "增强模式", "enum": []string{"balanced", "detail", "denoise"}, "default": in.RuntimeConfig["default_enhancement_mode"]},
		},
	}
	if len(in.PriceRule) == 0 {
		in.PriceRule = map[string]interface{}{"billing_type": "model_actual", "unit_price": 0}
	}
	return in
}

func (s *AgentService) validateVideoUpscaleAdminModel(ctx context.Context, runtimeCfg map[string]interface{}) error {
	code := strings.TrimSpace(stringValue(runtimeCfg["generation_model_code"]))
	if code == "" {
		return errors.New("请选择支持视频转视频/超分的模型")
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM models WHERE code=$1 AND category='video' AND is_enabled=true)`, code).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("所选超分模型不存在、不是视频模型或已停用：%s", code)
	}
	return nil
}

func (s *AgentService) ConfirmStep(ctx context.Context, userID int64, publicID, step string, payload map[string]interface{}) error {
	if payload == nil {
		payload = map[string]interface{}{}
	}
	data, _ := json.Marshal(payload)
	tag, err := s.db.Exec(ctx, `
		UPDATE workflow_projects
		SET status='pending',
		    outputs = COALESCE(outputs,'{}'::jsonb) || jsonb_build_object('confirmed_step', CASE WHEN outputs->>'current_step'='keyframes_confirm' THEN 'keyframes_confirm' ELSE $1::text END, 'confirmation_payload', $2::jsonb, 'autopilot', false),
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

// AutoCompleteExpiredProductReviews reuses the normal product-accept path so
// timeout completion creates works, settles billing and remains idempotent.
func (s *AgentService) AutoCompleteExpiredProductReviews(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(ctx, `
		SELECT p.id,p.user_id
		FROM workflow_projects p
		JOIN workflow_definitions w ON w.id=p.workflow_id
		WHERE p.status='waiting_confirm'
		  AND w.runtime_config->>'agent_mode'='product_refine'
		  AND p.outputs->>'current_step'='product_review_confirm'
		  AND p.outputs ? 'review_deadline_at'
		  AND p.outputs->>'review_deadline_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
		  AND (p.outputs->>'review_deadline_at')::timestamptz <= now()
		ORDER BY (p.outputs->>'review_deadline_at')::timestamptz ASC
		LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	type expiredReview struct{ projectID, userID int64 }
	items := make([]expiredReview, 0, limit)
	for rows.Next() {
		var item expiredReview
		if err := rows.Scan(&item.projectID, &item.userID); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	completed := 0
	for _, item := range items {
		tag, err := s.db.Exec(ctx, `
			UPDATE workflow_projects
			SET status='pending',
			    outputs=outputs || jsonb_build_object('confirmed_step','product_accept','confirmation_payload','{}'::jsonb,'autopilot',false,'product_auto_completed',true),
			    updated_at=now()
			WHERE id=$1 AND status='waiting_confirm'
			  AND outputs->>'current_step'='product_review_confirm'
			  AND outputs->>'review_deadline_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
			  AND (outputs->>'review_deadline_at')::timestamptz <= now()`, item.projectID)
		if err != nil {
			return completed, err
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		if err := queue.EnqueueWorkflowTask(s.queue, queue.WorkflowTaskPayload{ProjectID: item.projectID, UserID: item.userID}); err != nil {
			_, _ = s.db.Exec(ctx, `
				UPDATE workflow_projects
				SET status='waiting_confirm',outputs=outputs-'confirmed_step'-'confirmation_payload'-'product_auto_completed',updated_at=now()
				WHERE id=$1 AND status='pending' AND outputs->>'product_auto_completed'='true'`, item.projectID)
			return completed, err
		}
		completed++
	}
	return completed, nil
}

func (s *AgentService) SetAutopilot(ctx context.Context, userID int64, publicID string, enabled bool) error {
	var projectID int64
	var status string
	err := s.db.QueryRow(ctx, `SELECT id, status FROM workflow_projects WHERE public_id=$1 AND user_id=$2`, publicID, userID).Scan(&projectID, &status)
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
	// 只有从待确认切换为排队状态时才入队。重复点击、刷新重放或已运行任务
	// 只更新偏好，不会再创建一个相同父任务。
	if enabled && status == "waiting_confirm" {
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

func normalizeComicDramaAgentInput(in AgentUpsertInput) AgentUpsertInput {
	in.Category = "video"
	in.GenerationType = "video"
	in.RuntimeConfig["agent_mode"] = "comic_drama"
	in.RuntimeConfig["generation_type"] = "video"
	in.RuntimeConfig["preset_code"] = "ai_comic_drama"
	if stringValue(in.RuntimeConfig["analysis_model_code"]) == "" {
		in.RuntimeConfig["analysis_model_code"] = in.AnalysisModelCode
	}
	if stringValue(in.RuntimeConfig["generation_model_code"]) == "" {
		in.RuntimeConfig["generation_model_code"] = in.GenerationModelCode
	}
	if stringValue(in.RuntimeConfig["video_model_code"]) == "" {
		in.RuntimeConfig["video_model_code"] = firstAgentString(stringValue(in.RuntimeConfig["generation_model_code"]), in.GenerationModelCode)
	}
	if stringValue(in.RuntimeConfig["image_model_code"]) == "" {
		in.RuntimeConfig["image_model_code"] = "image_fast_v1"
	}
	in.RuntimeConfig["audio_strategy"] = normalizeComicAudioStrategy(
		stringValue(in.RuntimeConfig["audio_strategy"]),
		stringValue(in.RuntimeConfig["narration_model_code"]),
	)
	if _, ok := in.RuntimeConfig["dialogue_model_codes"]; !ok {
		in.RuntimeConfig["dialogue_model_codes"] = []string{firstAgentString(stringValue(in.RuntimeConfig["analysis_model_code"]), in.AnalysisModelCode, "chat_demo_v1")}
	}
	if _, ok := in.RuntimeConfig["style_reference_mode"]; !ok {
		in.RuntimeConfig["style_reference_mode"] = "image_reference"
	}
	if _, ok := in.RuntimeConfig["duration_mode"]; !ok {
		in.RuntimeConfig["duration_mode"] = "standard"
	}
	if !validComicGrid(intFromAgentAny(in.RuntimeConfig["storyboard_grid"])) {
		in.RuntimeConfig["storyboard_grid"] = 6
	}
	if intFromAgentAny(in.RuntimeConfig["max_retry"]) <= 0 {
		in.RuntimeConfig["max_retry"] = 2
	}
	if intFromAgentAny(in.RuntimeConfig["asset_consistency_score"]) <= 0 {
		in.RuntimeConfig["asset_consistency_score"] = 80
	}
	if intFromAgentAny(in.RuntimeConfig["logic_score"]) <= 0 {
		in.RuntimeConfig["logic_score"] = 50
	}
	if stringValue(in.RuntimeConfig["orientation"]) == "" {
		in.RuntimeConfig["orientation"] = "landscape"
	}
	if stringValue(in.RuntimeConfig["quality"]) == "" {
		in.RuntimeConfig["quality"] = "480P"
	}
	in.RuntimeConfig["output_mode"] = "composed_video"
	in.RuntimeConfig["creative_scenes"] = []string{"ai_comic_drama"}
	if _, ok := in.RuntimeConfig["input_capabilities"]; !ok {
		in.RuntimeConfig["input_capabilities"] = map[string]interface{}{
			"allow_text_only":             true,
			"support_reference_image":     true,
			"support_multiple_references": true,
			"support_first_last_frame":    false,
		}
	}
	if _, ok := in.RuntimeConfig["flow_options"]; !ok {
		in.RuntimeConfig["flow_options"] = map[string]interface{}{
			"enable_step_confirm": true,
			"enable_autopilot":    true,
			"allow_prompt_edit":   true,
		}
	}
	dialogueCodes := agentStringSlice(in.RuntimeConfig["dialogue_model_codes"], nil)
	planModelCode := stringValue(in.RuntimeConfig["analysis_model_code"])
	if len(dialogueCodes) > 0 {
		planModelCode = firstAgentString(dialogueCodes[0], planModelCode)
	}
	if len(in.Nodes) == 0 {
		in.Nodes = []WorkflowNode{
			{ID: "comic_plan", Type: "llm", Name: "AI漫剧规划", ModelCode: planModelCode, Cost: 0},
			{ID: "keyframes", Type: "image", Name: "关键帧生成", ModelCode: stringValue(in.RuntimeConfig["image_model_code"]), Cost: 0},
			{ID: "video_segments", Type: "video", Name: "分段视频生成", ModelCode: stringValue(in.RuntimeConfig["video_model_code"]), Cost: 0},
			{ID: "narrations", Type: "audio", Name: "对白与旁白配音", ModelCode: stringValue(in.RuntimeConfig["narration_model_code"]), Cost: 0},
			{ID: "compose", Type: "video", Name: "视频合成", ModelCode: "", Cost: 0},
		}
	} else {
		for index := range in.Nodes {
			switch in.Nodes[index].ID {
			case "comic_plan":
				in.Nodes[index].ModelCode = planModelCode
			case "keyframes":
				in.Nodes[index].ModelCode = stringValue(in.RuntimeConfig["image_model_code"])
			case "video_segments":
				in.Nodes[index].ModelCode = stringValue(in.RuntimeConfig["video_model_code"])
			case "narrations":
				in.Nodes[index].ModelCode = stringValue(in.RuntimeConfig["narration_model_code"])
			case "compose":
				in.Nodes[index].ModelCode = ""
			}
		}
	}
	if len(in.InputSchema) == 0 {
		in.InputSchema = map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"prompt": map[string]interface{}{"type": "string", "title": "漫剧创意", "placeholder": "描述你想生成的 AI 漫剧内容、角色和风格"},
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

func validComicGrid(v int) bool {
	return v == 2 || v == 4 || v == 6 || v == 9
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
	case "ai_comic_drama":
		return agentPreset{"comic", []string{"AI漫剧", "一键成片", "智能托管"}, []string{"剧本规划", "角色一致", "关键帧", "视频合成"}, "风格参考图", "例如：赛博城市里的少年侦探追查失控 AI，电影感，节奏紧凑", "输入故事创意，可上传风格参考图；AI 会规划剧本、角色、分镜、关键帧和分段视频，并自动合成为一个视频。"}
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

func firstAgentNonNil(items ...interface{}) interface{} {
	for _, item := range items {
		if item != nil {
			return item
		}
	}
	return nil
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
		allowed["ai_comic_drama"] = true
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
			Type:     stringValue(m["type"]),
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
	taskNos := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.TaskNo != "" {
			taskNos = append(taskNos, task.TaskNo)
		}
	}
	if len(taskNos) == 0 {
		return tasks
	}
	rows, err := s.db.Query(ctx, `
		SELECT t.task_no, t.status, t.output, t.error_message, COALESCE(progress.payload->>'progress', '')
		FROM tasks t
		LEFT JOIN LATERAL (
			SELECT e.payload FROM task_events e
			WHERE e.task_id=t.id AND e.event_type='progress'
			  AND t.status NOT IN ('succeeded', 'failed')
			ORDER BY e.created_at DESC, e.id DESC LIMIT 1
		) progress ON true
		WHERE t.task_no=ANY($1) AND t.user_id=$2`, taskNos, userID)
	if err != nil {
		return tasks
	}
	defer rows.Close()
	latest := make(map[string]AgentMediaTaskDTO, len(tasks))
	for rows.Next() {
		var task AgentMediaTaskDTO
		var progress string
		var outputRaw []byte
		if err := rows.Scan(&task.TaskNo, &task.Status, &outputRaw, &task.ErrorMessage, &progress); err != nil {
			return tasks
		}
		task.Output = map[string]interface{}{}
		_ = json.Unmarshal(outputRaw, &task.Output)
		task.Progress = taskProgress(task.Status, progress, false)
		latest[task.TaskNo] = task
	}
	if rows.Err() != nil {
		return tasks
	}
	for i := range tasks {
		if task, ok := latest[tasks[i].TaskNo]; ok {
			tasks[i].Status = task.Status
			tasks[i].Output = task.Output
			tasks[i].Progress = task.Progress
			if task.ErrorMessage != nil && *task.ErrorMessage != "" {
				tasks[i].ErrorMessage = task.ErrorMessage
			}
		}
	}
	return tasks
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
	if err := rows.Scan(&w.Code, &w.Name, &desc, &icon, &w.Category, &nodes, &schema, &price, &display, &runtime, &w.IsEnabled, &w.SortOrder); err != nil {
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
	if err := row.Scan(&w.Code, &w.Name, &desc, &icon, &w.Category, &nodes, &schema, &price, &display, &runtime, &w.IsEnabled, &w.SortOrder); err != nil {
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
