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
	if stringValue(def.RuntimeConfig["agent_mode"]) == "comic_drama" {
		s.attachWorkflowToComicProject(ctx, userID, projectID, inputs)
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
	if stringValue(inputs["dialogue_model_codes"]) == "" {
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
	if stringValue(runtimeCfg["agent_mode"]) == "comic_drama" {
		if code := stringValue(runtimeCfg["analysis_model_code"]); code != "" {
			total += s.estimateModelCostByCode(ctx, code, inputs, 1200, 2500)
		}
		if code := firstAgentString(stringValue(runtimeCfg["image_model_code"]), stringValue(runtimeCfg["generation_model_code"])); code != "" {
			grid := positiveAgentInt(intFromAgentAny(firstAgentNonNil(inputs["storyboard_grid"], runtimeCfg["storyboard_grid"])), 6)
			total += s.estimateModelCostByCode(ctx, code, map[string]interface{}{"n": grid}, 0, 0)
		}
		if code := firstAgentString(stringValue(runtimeCfg["video_model_code"]), stringValue(runtimeCfg["generation_model_code"])); code != "" {
			grid := positiveAgentInt(intFromAgentAny(firstAgentNonNil(inputs["storyboard_grid"], runtimeCfg["storyboard_grid"])), 6)
			total += s.estimateModelCostByCode(ctx, code, map[string]interface{}{"count": grid}, 0, 0)
		}
		return total
	}
	if code := stringValue(runtimeCfg["analysis_model_code"]); code != "" {
		total += s.estimateModelCostByCode(ctx, code, inputs, 500, 1000)
	}
	if code := stringValue(runtimeCfg["generation_model_code"]); code != "" {
		generationInputs := inputs
		if stringValue(inputs["creative_scene"]) == "detail_image" && stringValue(runtimeCfg["generation_type"]) != "video" {
			generationInputs = make(map[string]interface{}, len(inputs)+2)
			for key, value := range inputs {
				generationInputs[key] = value
			}
			sectionCount := intFromAgentAny(inputs["detail_section_count"])
			if sectionCount < 4 || sectionCount > 8 {
				if requested := intFromAgentAny(inputs["count"]); requested >= 4 && requested <= 8 {
					sectionCount = requested
				} else {
					sectionCount = 6
				}
			}
			generationInputs["count"] = sectionCount
			generationInputs["n"] = sectionCount
		}
		total += s.estimateModelCostByCode(ctx, code, generationInputs, 0, 0)
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
	if _, err := s.db.Exec(ctx, `UPDATE workflow_projects SET status='pending', error_message=NULL, finished_at=NULL, updated_at=now() WHERE id=$1`, projectID); err != nil {
		_ = s.billing.Unfreeze(ctx, userID, estimated, "workflow", publicID)
		return err
	}
	// 保留既有节点记录。工作流会复用 outputs 中已成功的阶段；保留记录还能让
	// 最终结算包含失败前已经实际发生的媒体成本，并为运营排障留下审计轨迹。
	if err := queue.EnqueueWorkflowTask(s.queue, queue.WorkflowTaskPayload{ProjectID: projectID, UserID: userID}); err != nil {
		_, _ = s.db.Exec(ctx, `UPDATE workflow_projects SET status='failed', error_message='重试入队失败', finished_at=now(), updated_at=now() WHERE id=$1`, projectID)
		_ = s.billing.Unfreeze(ctx, userID, estimated, "workflow", publicID)
		return err
	}
	return nil
}

func (s *AgentService) RetryProjectNode(ctx context.Context, userID int64, publicID, nodeID string) error {
	nodeID = strings.TrimSpace(nodeID)
	allowed := map[string]bool{"comic_plan": true, "keyframes": true, "video_segments": true, "compose": true, "generate": true}
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
	if _, err := s.db.Exec(ctx, `UPDATE workflow_projects SET outputs=$1, updated_at=now() WHERE id=$2`, mustAgentJSON(outputs), projectID); err != nil {
		return err
	}
	return s.RetryProject(ctx, userID, publicID)
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
	if !ok || index >= len(items) {
		return errors.New("素材序号不存在")
	}
	item, ok := items[index].(map[string]interface{})
	if !ok {
		return errors.New("素材数据格式无效")
	}
	field := "image_url"
	if kind == "segments" {
		field = "video_url"
	}
	item[field] = strings.TrimSpace(rawURL)
	item["manual_replacement"] = true
	item["status"] = "succeeded"
	items[index] = item
	outputs[kind] = items
	if kind == "keyframes" {
		// 替换关键帧后，旧分段视频与最终成片已经失去来源一致性，必须显式失效。
		delete(outputs, "segments")
		delete(outputs, "final_video_url")
		delete(outputs, "thumbnail")
		outputs["current_step"] = "video_segments"
	} else {
		delete(outputs, "final_video_url")
		delete(outputs, "thumbnail")
		outputs["current_step"] = "compose"
	}
	if comic, ok := outputs["comic_drama"].(map[string]interface{}); ok {
		comic[kind] = items
		outputs["comic_drama"] = comic
	}
	_, err := s.db.Exec(ctx, `UPDATE workflow_projects SET outputs=$1, updated_at=now() WHERE id=$2`, mustAgentJSON(outputs), projectID)
	return err
}

func (s *AgentService) CancelProject(ctx context.Context, userID int64, publicID string) error {
	var projectID int64
	var status string
	var estimated float64
	if err := s.db.QueryRow(ctx,
		`SELECT id, status, estimated_cost FROM workflow_projects WHERE public_id=$1 AND user_id=$2`, publicID, userID).
		Scan(&projectID, &status, &estimated); err != nil {
		return err
	}
	if status != "pending" && status != "waiting_confirm" {
		return errors.New("仅排队中或待确认的项目可取消")
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE workflow_projects
		SET status='canceled', error_message='用户已取消', finished_at=now(), updated_at=now()
		WHERE id=$1 AND status IN ('pending','waiting_confirm')`, projectID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("项目状态已变化，请刷新后重试")
	}
	return s.billing.Unfreeze(ctx, userID, estimated, "workflow", publicID)
}

func pruneWorkflowOutputsForRetry(outputs map[string]interface{}, nodeID string) {
	switch nodeID {
	case "comic_plan":
		for _, key := range []string{"comic_drama", "analysis", "keyframes", "segments", "final_video_url", "thumbnail", "media_tasks", "current_step"} {
			delete(outputs, key)
		}
	case "keyframes":
		for _, key := range []string{"keyframes", "segments", "final_video_url", "thumbnail", "media_tasks"} {
			delete(outputs, key)
		}
		outputs["current_step"] = "keyframes"
	case "video_segments":
		for _, key := range []string{"segments", "final_video_url", "thumbnail", "media_tasks"} {
			delete(outputs, key)
		}
		outputs["current_step"] = "video_segments"
	case "compose":
		for _, key := range []string{"final_video_url", "thumbnail", "media_tasks"} {
			delete(outputs, key)
		}
		outputs["current_step"] = "compose"
	case "generate":
		delete(outputs, "media_tasks")
		outputs["current_step"] = "generate"
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
	} else if mode == "simple_pipeline" {
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
	if len(in.Nodes) == 0 {
		in.Nodes = []WorkflowNode{
			{ID: "comic_plan", Type: "llm", Name: "AI漫剧规划", ModelCode: stringValue(in.RuntimeConfig["analysis_model_code"]), Cost: 0},
			{ID: "keyframes", Type: "image", Name: "关键帧生成", ModelCode: stringValue(in.RuntimeConfig["image_model_code"]), Cost: 0},
			{ID: "video_segments", Type: "video", Name: "分段视频生成", ModelCode: stringValue(in.RuntimeConfig["video_model_code"]), Cost: 0},
			{ID: "compose", Type: "video", Name: "视频合成", ModelCode: "", Cost: 0},
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
	return v == 4 || v == 6 || v == 9
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
