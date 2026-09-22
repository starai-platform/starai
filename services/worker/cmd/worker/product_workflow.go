package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type productAttempt struct {
	TaskNo       string                 `json:"task_no,omitempty"`
	ImageURL     string                 `json:"image_url,omitempty"`
	MaskURL      string                 `json:"mask_url,omitempty"`
	Status       string                 `json:"status"`
	Localization map[string]interface{} `json:"localization,omitempty"`
	Review       map[string]interface{} `json:"review,omitempty"`
	Verification map[string]interface{} `json:"verification,omitempty"`
	Issues       []string               `json:"issues,omitempty"`
}
type productShotResult struct {
	Title    string           `json:"title"`
	Status   string           `json:"status"`
	ImageURL string           `json:"image_url,omitempty"`
	Attempts []productAttempt `json:"attempts"`
}

func productResultsNeedReview(results []productShotResult) bool {
	for _, result := range results {
		if result.ImageURL != "" && result.Status != "passed" {
			return true
		}
	}
	return false
}

func productRepairReview(attempt productAttempt) map[string]interface{} {
	if attempt.Status != "passed" && len(attempt.Verification) > 0 {
		return attempt.Verification
	}
	return attempt.Review
}

func setProductQualitySummary(outputs map[string]interface{}, plan productPlan, inputs map[string]interface{}, results []productShotResult) {
	attempts, repairs, passed, delivered, verified := 0, 0, 0, 0, 0
	firstPass := true
	for _, result := range results {
		attempts += len(result.Attempts)
		if len(result.Attempts) > 1 {
			repairs += len(result.Attempts) - 1
			firstPass = false
		}
		if result.Status == "passed" {
			passed++
		}
		if result.ImageURL != "" {
			delivered++
		}
		for _, attempt := range result.Attempts {
			if len(attempt.Verification) > 0 {
				verified++
			}
		}
	}
	outputs["product_quality_summary"] = map[string]interface{}{
		"product_type": plan.ProductType, "interaction_mode": plan.InteractionMode,
		"product_preset":     canonicalProductPreset(stringAny(inputs["product_preset"])),
		"generation_quality": firstNonEmpty(stringAny(inputs["quality"]), "high"),
		"review_mode":        firstNonEmpty(stringAny(inputs["review_mode"]), "standard"),
		"first_pass":         firstPass && passed == len(results), "attempts": attempts,
		"repairs_used": repairs, "passed": passed, "delivered": delivered, "strict_verifications": verified,
	}
}

func productRatioMatches(bounds image.Rectangle, ratio string) bool {
	ratio = strings.TrimSpace(ratio)
	if ratio == "" || strings.EqualFold(ratio, "auto") {
		return true
	}
	var width, height float64
	if n, _ := fmt.Sscanf(ratio, "%f:%f", &width, &height); n != 2 || width <= 0 || height <= 0 || bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		return false
	}
	actual := float64(bounds.Dx()) / float64(bounds.Dy())
	target := width / height
	return math.Abs(actual-target)/target < 0.02
}

func setProductProcess(outputs map[string]interface{}, id, stage, status, message, detail string) {
	var records []map[string]interface{}
	_ = json.Unmarshal(mustJSON(outputs["product_process_log"]), &records)
	now := time.Now().UTC().Format(time.RFC3339)
	entry := map[string]interface{}{"id": id, "stage": stage, "status": status, "message": message, "updated_at": now}
	if detail != "" {
		entry["detail"] = detail
	}
	for i, record := range records {
		if stringAny(record["id"]) == id {
			if created := stringAny(record["created_at"]); created != "" {
				entry["created_at"] = created
			}
			records[i] = entry
			outputs["product_process_log"] = records
			outputs["current_step"] = stage
			return
		}
	}
	entry["created_at"] = now
	outputs["product_process_log"] = append(records, entry)
	outputs["current_step"] = stage
}

func saveProductProcess(ctx context.Context, pool *pgxpool.Pool, projectID int64, outputs map[string]interface{}, id, stage, status, message, detail string) error {
	setProductProcess(outputs, id, stage, status, message, detail)
	_, err := pool.Exec(ctx, `UPDATE workflow_projects SET outputs=$1,updated_at=now() WHERE id=$2`, mustJSON(outputs), projectID)
	return err
}

// The workflow owns a fixed budget reservation. Each external stage is checked
// before dispatch; final user charges are capped even if a provider exceeds its
// estimate. Raw accrued usage remains available for reconciliation.
func productBudgetAllows(spent, next, budget float64) bool {
	return !math.IsNaN(spent+next+budget) && !math.IsInf(spent+next+budget, 0) && spent >= 0 && next > 0 && budget > 0 && spent+next <= budget+0.000001
}

func productSpent(ctx context.Context, pool *pgxpool.Pool, id int64) (float64, error) {
	var cost float64
	err := pool.QueryRow(ctx, `SELECT
        COALESCE((SELECT SUM(cost) FROM workflow_node_runs WHERE project_id=$1 AND type='llm'),0) +
        COALESCE((SELECT SUM(actual_cost) FROM tasks WHERE input->>'_workflow_project'=(SELECT public_id FROM workflow_projects WHERE id=$1)),0)`, id).Scan(&cost)
	return cost, err
}

// Product pricing is a floor, not a cap. Once the workflow has incurred model
// usage, charge at least the configured estimate and use real usage when higher.
func productActualCharge(floorPrice, spent float64) float64 {
	if spent <= 0 || math.IsNaN(spent) || math.IsInf(spent, 0) {
		return 0
	}
	if floorPrice > spent {
		return floorPrice
	}
	return spent
}

func productLLM(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, code, node, system, prompt string, refs []string, budget float64) (map[string]interface{}, error) {
	var status string
	var saved []byte
	err := pool.QueryRow(ctx, `SELECT status,output FROM workflow_node_runs WHERE project_id=$1 AND node_id=$2 ORDER BY id DESC LIMIT 1`, p.ProjectID, node).Scan(&status, &saved)
	if err == nil {
		if status != "succeeded" {
			return nil, fmt.Errorf("%s上次调用未完成，已停止重复扣费，请检查后新建任务", node)
		}
		out := map[string]interface{}{}
		err = json.Unmarshal(saved, &out)
		return out, err
	}
	if err != pgx.ErrNoRows {
		return nil, err
	}
	model, msg := loadAgentAnalysisModel(ctx, pool, code)
	if msg != "" || !agentAnalysisModelAcceptsImages(model) {
		return nil, fmt.Errorf("请配置可读图的分析与验收模型：%s", msg)
	}
	images := make([]string, 0, len(refs))
	for _, ref := range refs {
		im, err := productImage(ctx, ref)
		if err != nil {
			return nil, err
		}
		data, err := productVisionData(im)
		if err != nil {
			return nil, err
		}
		images = append(images, data)
	}
	forecast := estimateModelCostByCodeWorker(ctx, pool, code, map[string]interface{}{"reference_images": images}, 8000, 4096, 0, 0)
	spent, err := productSpent(ctx, pool, p.ProjectID)
	if err != nil {
		return nil, err
	}
	if !productBudgetAllows(spent, forecast, budget) {
		return nil, fmt.Errorf("剩余预算不足以完成下一次分析或验收，已保留已有结果")
	}
	var projectState string
	if err := pool.QueryRow(ctx, `SELECT status FROM workflow_projects WHERE id=$1`, p.ProjectID).Scan(&projectState); err != nil {
		return nil, err
	}
	if projectState != "running" {
		return nil, fmt.Errorf("工作流已停止，未提交下一次模型调用")
	}
	nodeID := insertWorkflowNodeRun(ctx, pool, p.ProjectID, node, "商品分析与细节验收", "llm", map[string]interface{}{"model_code": code}, 0)
	if nodeID <= 0 {
		return nil, fmt.Errorf("无法记录分析任务")
	}
	start := time.Now()
	result, callErr := executeWorkerLLMWithRoutes(ctx, pool, baseURL, token, fmt.Sprintf("product_%d_%s", p.ProjectID, node), model, system, prompt, 0.1, 120*time.Second, images...)
	pt, ct, cr, cw := chatUsageTokenDetails(result.ResponseBody)
	cost := estimateModelCostByCodeWorker(ctx, pool, code, result.RequestBody, pt, ct, cr, cw)
	if len(result.ResponseBody) == 0 {
		cost = 0
	}
	if callErr != nil {
		_, _ = pool.Exec(ctx, `UPDATE workflow_node_runs SET status='failed',error=$1,cost=$2 WHERE id=$3`, callErr.Error(), cost, nodeID)
		return nil, callErr
	}
	out := parseJSONish(extractLLMText(result.ResponseBody))
	updateNodeRunSuccess(ctx, pool, nodeID, out, cost, int(time.Since(start).Milliseconds()))
	return out, nil
}

func saveProductImage(ctx context.Context, name string, im image.Image) (string, error) {
	data, err := productPNG(im)
	if err != nil {
		return "", err
	}
	if objectStore == nil {
		return "", fmt.Errorf("商品精修需要配置素材存储")
	}
	return storeBase64ImageResult(ctx, name, 0, productDataURL(data))
}

func saveProductModelImage(ctx context.Context, name string, im image.Image) (string, error) {
	data, err := productJPEGData(im)
	if err != nil {
		return "", err
	}
	if objectStore == nil {
		return "", fmt.Errorf("商品精修需要配置素材存储")
	}
	return storeBase64ImageResult(ctx, name, 0, data)
}

// The edit base and its mask must arrive at the upstream API with identical
// dimensions. Other references can remain capped to reduce request size.
func saveProductModelBase(ctx context.Context, name string, im image.Image) (string, error) {
	return saveProductModelImage(ctx, name, im)
}

func saveProductModelReference(ctx context.Context, name string, im image.Image) (string, error) {
	return saveProductModelImage(ctx, name, resizeProductImage(im, 1536, false))
}

// The configured GPT Image edit route accepts one base plus one reference.
// On repairs, the original product is more useful than repeating the pose.
func productGenerationReferenceIndexes(refs []productReference, baseIndex int, localRepair, repairFromPrevious bool) []int {
	candidates := make([]int, 0, len(refs))
	if localRepair {
		for index, ref := range refs {
			if ref.Role == "product" {
				candidates = append(candidates, index)
			}
		}
		candidates = append(candidates, baseIndex)
	} else {
		for index := range refs {
			candidates = append(candidates, index)
		}
	}
	for _, index := range candidates {
		if index == baseIndex && !repairFromPrevious {
			continue
		}
		return []int{index}
	}
	return nil
}

func productImage(ctx context.Context, url string) (image.Image, error) {
	if objectStore != nil {
		if key := objectStore.ObjectKeyFromURL(url); key != "" {
			data, err := objectStore.ReadAll(ctx, key, 128<<20)
			if err != nil {
				return nil, err
			}
			return decodeProductImage(data)
		}
	}
	data, _, err := loadMediaBytes(ctx, normalizeReferenceImage(ctx, url))
	if err != nil {
		return nil, err
	}
	return decodeProductImage(data)
}

func productGenerate(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, publicID, modelCode string, inputs map[string]interface{}, budget float64, shot, attempt int) (map[string]interface{}, error) {
	var modelID int64
	var defaultsRaw, runtimeRaw []byte
	if err := pool.QueryRow(ctx, `SELECT id,default_params,runtime_rule FROM models WHERE code=$1 AND is_enabled=true AND request_mode='images'`, modelCode).Scan(&modelID, &defaultsRaw, &runtimeRaw); err != nil {
		return nil, fmt.Errorf("未配置可用图片编辑模型")
	}
	defaults, runtime := map[string]interface{}{}, map[string]interface{}{}
	_ = json.Unmarshal(defaultsRaw, &defaults)
	_ = json.Unmarshal(runtimeRaw, &runtime)
	applyAgentModelDefaults(inputs, defaults, runtime, "image")
	inputs["count"], inputs["n"], inputs["_workflow_project"] = 1, 1, publicID
	inputs["_skip_billing"] = true
	inputs["_product_refine"] = true
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%d", publicID, shot, attempt)))
	taskNo := fmt.Sprintf("product_%x", hash[:12])
	var state string
	err := pool.QueryRow(ctx, `SELECT status FROM tasks WHERE task_no=$1`, taskNo).Scan(&state)
	if err == pgx.ErrNoRows {
		forecast := estimateModelCostByIDWorker(ctx, pool, modelID, inputs, 0, 0, 0, 0)
		spent, err := productSpent(ctx, pool, p.ProjectID)
		if err != nil {
			return nil, err
		}
		if !productBudgetAllows(spent, forecast, budget) {
			return nil, fmt.Errorf("剩余预算不足以生成下一张图片")
		}
		_, err = pool.Exec(ctx, `INSERT INTO tasks(task_no,user_id,model_id,type,status,input,estimated_cost) VALUES($1,$2,$3,'image','pending',$4,$5)`, taskNo, p.UserID, modelID, mustJSON(inputs), forecast)
		if err != nil {
			return nil, err
		}
		state = "pending"
	} else if err != nil {
		return nil, err
	}
	if state == "running" {
		return nil, fmt.Errorf("上次生图状态尚未确定，已停止重复提交，请检查任务%s", taskNo)
	}
	if state == "pending" {
		var projectState string
		if err := pool.QueryRow(ctx, `SELECT status FROM workflow_projects WHERE id=$1`, p.ProjectID).Scan(&projectState); err != nil {
			return nil, err
		}
		if projectState != "running" {
			return nil, fmt.Errorf("工作流已停止，未提交图片编辑")
		}
		if err := processImageTask(ctx, pool, baseURL, token, ImageTaskPayload{TaskNo: taskNo, UserID: p.UserID, ModelID: modelID, ModelCode: modelCode, Input: inputs}); err != nil {
			return nil, err
		}
	}
	item := loadAgentMediaTask(ctx, pool, taskNo)
	// Idempotent cost record, including a successfully generated but rejected image.
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workflow_node_runs WHERE project_id=$1 AND node_id=$2)`, p.ProjectID, taskNo).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		id := insertWorkflowNodeRun(ctx, pool, p.ProjectID, taskNo, "商品局部编辑", "image", map[string]interface{}{"task_no": taskNo}, shot+1)
		if id <= 0 {
			return nil, fmt.Errorf("无法记录图片成本")
		}
		updateNodeRunSuccess(ctx, pool, id, item, floatAny(item["actual_cost"]), 0)
	}
	if stringAny(item["status"]) != "succeeded" {
		return item, fmt.Errorf("图片编辑失败：%s", stringAny(item["error_message"]))
	}
	return item, nil
}

func finishProductWorkflow(ctx context.Context, pool *pgxpool.Pool, p WorkflowTaskPayload, publicID string, reserved, _ float64, outputs map[string]interface{}, message string) error {
	spent, err := productSpent(ctx, pool, p.ProjectID)
	if err != nil {
		return err
	}
	actual := productActualCharge(reserved, spent)
	outputs["incurred_cost"], outputs["cost"], outputs["current_step"] = spent, actual, "result"
	status := "succeeded"
	qualityStatus := "passed"
	if message != "" {
		status = "failed"
		qualityStatus = "needs_review"
	}
	var savedResults []productShotResult
	_ = json.Unmarshal(mustJSON(outputs["product_results"]), &savedResults)
	if message == "" && boolAny(outputs["product_review_skipped"]) {
		qualityStatus = "accepted_unreviewed"
	} else if productResultsNeedReview(savedResults) {
		qualityStatus = "needs_review"
	}
	outputs["quality_status"] = qualityStatus
	if message != "" {
		for i := range savedResults {
			if savedResults[i].Status == "processing" || savedResults[i].Status == "checking" {
				savedResults[i].Status = "uncertain"
			}
		}
	}
	outputs["product_results"] = savedResults
	return chargeBillingWithFinalize(ctx, pool, p.UserID, reserved, incrementalWorkflowCharge(ctx, pool, p.ProjectID, actual), "workflow", publicID, "workflow_usage", "商品精修与验收", func(tx pgx.Tx) error {
		var results []productShotResult
		_ = json.Unmarshal(mustJSON(outputs["product_results"]), &results)
		for i, r := range results {
			if r.ImageURL == "" {
				continue
			}
			itemQuality := "passed"
			if r.Status != "passed" {
				itemQuality = "needs_review"
			}
			_, err := tx.Exec(ctx, `INSERT INTO works(public_id,user_id,type,title,thumbnail_url,metadata) VALUES($1,$2,'image',$3,$4,$5) ON CONFLICT(public_id) DO NOTHING`, fmt.Sprintf("work_%s_%d", publicID, i), p.UserID, r.Title, r.ImageURL, mustJSON(map[string]interface{}{"image_url": r.ImageURL, "quality_status": itemQuality, "workflow_project": publicID}))
			if err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `UPDATE workflow_projects SET status=CASE WHEN status='canceling' THEN 'canceled' ELSE $1 END, outputs=$2,actual_cost=$3,error_message=NULLIF($4,''),finished_at=now(),updated_at=now() WHERE id=$5 AND status IN ('running','canceling')`, status, mustJSON(outputs), actual, message, p.ProjectID)
		if err == nil && tag.RowsAffected() != 1 {
			return fmt.Errorf("工作流状态已改变")
		}
		return err
	})
}

func processProductWorkflow(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, publicID string, reserved float64, inputs, runtime map[string]interface{}) error {
	outputs := loadWorkflowOutputs(ctx, pool, p.ProjectID)
	budget := floatAny(inputs["_execution_budget"])
	if budget <= 0 {
		budget = floatAny(inputs["max_cost"])
	}
	finish := func(msg string) error {
		if msg == "" {
			var currentResults []productShotResult
			_ = json.Unmarshal(mustJSON(outputs["product_results"]), &currentResults)
			if boolAny(outputs["product_review_skipped"]) {
				detail := "用户已确认成品，本次未运行自动验收与复核"
				if boolAny(outputs["product_auto_completed"]) {
					detail = "等待时间结束，系统已按当前成品自动完成，本次未运行自动验收与复核"
				}
				setProductProcess(outputs, "workflow_result", "result", "passed", "图片制作已完成", detail)
			} else if productResultsNeedReview(currentResults) {
				setProductProcess(outputs, "workflow_result", "result", "uncertain", "图片已生成，可查看和下载", "检查提示已保留；如不满意，可按检查问题手动修改对应图片")
			} else {
				setProductProcess(outputs, "workflow_result", "result", "passed", "全部图片制作与细节验收完成", "")
			}
		} else {
			setProductProcess(outputs, "workflow_result", "result", "failed", "流程未完成", msg)
		}
		return finishProductWorkflow(ctx, pool, p, publicID, reserved, budget, outputs, msg)
	}
	refs, err := productReferences(inputs)
	if err != nil {
		return finish(err.Error())
	}
	count := intAny(inputs["count"])
	aspectRatio := firstNonEmpty(stringAny(inputs["aspect_ratio"]), "auto")
	quality := strings.ToLower(firstNonEmpty(stringAny(inputs["quality"]), "high"))
	preset := canonicalProductPreset(stringAny(inputs["product_preset"]))
	localRepair := preset == "local_repair"
	repairIndex := -1
	for index, ref := range refs {
		if ref.Role == "repair" {
			repairIndex = index
			break
		}
	}
	if count < 1 || count > 6 || budget <= 0 || budget > 1000 {
		return finish("商品精修参数无效")
	}
	if localRepair && (count != 1 || repairIndex < 0 || !strings.EqualFold(aspectRatio, "auto")) {
		return finish("局部问题修复参数无效：需要一张待修图片、一个交付结果并保持原图比例")
	}
	urls := []string{}
	labels := []string{}
	for i, r := range refs {
		urls = append(urls, r.URL)
		labels = append(labels, fmt.Sprintf("附件%d：%s", i+1, r.Role))
	}
	brief := firstUserPrompt(inputs)
	if err := saveProductProcess(ctx, pool, p.ProjectID, outputs, "product_plan", "planning", "running", "正在分析商品结构、保护区域和交付清单", ""); err != nil {
		return err
	}
	planRaw, err := productLLM(ctx, pool, baseURL, token, p, stringAny(runtime["analysis_model_code"]), "product_plan", productPlanningSystem, fmt.Sprintf("约束优先级：用户明确要求 > 图片可观察事实 > 预设补充。\n用户要求：%s\n场景预设：%s\n场景补充（只补用户未说明部分）：%s\n成品比例：%s（auto表示跟随商品原图）\n参考用途：%s\n用户框选（非空的编辑和保护区域优先于自动规划）：%s\n逐张交付要求：%s\n准确交付%d张。", brief, preset, productPresetRule(runtime, preset), aspectRatio, strings.Join(labels, "；"), mustJSON(refs), stringAny(inputs["deliverables"]), count), urls, budget)
	if err != nil {
		setProductProcess(outputs, "product_plan", "planning", "failed", "商品分析未完成", err.Error())
		return finish(err.Error())
	}
	setProductProcess(outputs, "product_plan", "planning", "checking", "已取得分析方案，正在校验商品约束", "")
	outputs["product_plan"] = planRaw
	var plan productPlan
	for planningAttempt := 0; planningAttempt < 2; planningAttempt++ {
		if normalized := normalizeProductPlanJSON(planRaw); normalized > 0 {
			setProductProcess(outputs, "plan_region_shape", "planning", "passed", fmt.Sprintf("已纠正%d个验收区域格式", normalized), "分析模型多包了一层区域数组，已还原为左、上、宽、高")
		}
		err = json.Unmarshal(mustJSON(planRaw), &plan)
		if err == nil {
			if converted := normalizeProductPlanBoxes(&plan); converted > 0 {
				setProductProcess(outputs, "plan_coordinates", "planning", "passed", fmt.Sprintf("已纠正%d个区域坐标格式", converted), "识别结果使用了左上角与右下角坐标，已转换为左、上、宽、高")
			}
			if normalized := normalizeProductCheckIDs(&plan); normalized > 0 {
				setProductProcess(outputs, "plan_check_ids", "planning", "passed", fmt.Sprintf("已规范%d个内部验收编号", normalized), "构图等同义编号已合并为工作流标准编号")
			}
			if dismissed := dismissProductVisibilityOnlyMissing(&plan); dismissed > 0 {
				setProductProcess(outputs, "plan_visibility_scope", "planning", "passed", fmt.Sprintf("已忽略%d项因目标视角自然不可见而产生的伪缺失", dismissed), "只验收当前视角实际可见的商品结构，不强迫展示背面、侧面或合理遮挡部分")
			}
			for i := range plan.Shots {
				s := &plan.Shots[i]
				if localRepair {
					s.Source = repairIndex + 1
					s.Method = "edit"
					s.EditRegions = append([]productBox{}, refs[repairIndex].EditRegions...)
					s.ProtectedRegions = nil
				} else if s.Source >= 1 && s.Source <= len(refs) && s.Method == "edit" {
					r := refs[s.Source-1]
					if len(r.EditRegions) > 0 {
						s.EditRegions = r.EditRegions
					}
					if len(r.ProtectedRegions) > 0 {
						s.ProtectedRegions = r.ProtectedRegions
					}
				}
			}
			if normalizeProductPlanCount(&plan, count) {
				setProductProcess(outputs, "plan_count", "planning", "passed", fmt.Sprintf("已按生成数量保留%d个交付任务", count), "分析模型增加的额外任务不会提交生图")
			}
			if added := ensureProductCompositionChecks(&plan, brief); added > 0 {
				setProductProcess(outputs, "plan_composition_check", "planning", "passed", fmt.Sprintf("已补全%d张图片的用户需求与构图验收项", added), "构图验收项由系统依据原始要求补全，不再重复调用分析模型")
			}
			if changed := ensureProductInteractionChecks(&plan); changed > 0 {
				setProductProcess(outputs, "plan_interaction_checks", "planning", "passed", fmt.Sprintf("已为%d张图片补充通用交互与可见性验收", changed), "根据商品类别与交互方式检查接触、受力、遮挡和结构保留")
			}
			if changed := ensureProductWearChecks(&plan); changed > 0 {
				setProductProcess(outputs, "plan_wear_checks", "planning", "passed", fmt.Sprintf("已为%d张上脚图片固定左右接合与鞋舌遮挡验收", changed), "穿着物理关系由工作流强制检查，不依赖分析模型自行定位")
			}
			if changed := ensureProductIdentityChecks(&plan); changed > 0 {
				setProductProcess(outputs, "plan_identity_check", "planning", "passed", fmt.Sprintf("已为%d张交互图增加同款商品核验", changed), "外观相近的替代商品不能通过验收")
			}
			if localRepair {
				if changed := ensureProductLocalRepairChecks(&plan, repairIndex+1, refs[repairIndex].EditRegions); changed > 0 {
					setProductProcess(outputs, "plan_local_repair_checks", "planning", "passed", fmt.Sprintf("已为%d张图片固定局部修复与圈外保真验收", changed), "标注移除、结构修复和圈外像素保护由工作流强制检查")
				}
			}
			err = validateProductPlan(plan, refs, count)
		}
		outputs["product_plan"] = plan
		if boolInput(inputs, "_auto_identity_review") {
			setProductProcess(outputs, "identity_review_mode", "planning", "passed", "上脚或换场景已自动启用独立商品保真复核", "商品身份无法确认时不会作为成品交付")
		}
		if err == nil {
			if checkpointErr := saveProductProcess(ctx, pool, p.ProjectID, outputs, "product_plan", "planning", "passed", fmt.Sprintf("商品分析与交付方案校验通过，共%d张", count), ""); checkpointErr != nil {
				return checkpointErr
			}
			break
		}
		// Missing source evidence needs user input. A malformed or empty model
		// response falls back to a bounded plan instead of failing a paid request.
		if len(plan.Missing) > 0 {
			setProductProcess(outputs, "product_plan", "planning", "failed", "商品分析方案校验未通过", err.Error())
			return finish(err.Error())
		}
		if planningAttempt == 1 {
			validationErr := err
			fallbackPlan, fallbackErr := fallbackProductPlan(refs, count, preset, brief)
			if fallbackErr == nil {
				plan = fallbackPlan
				if changed := ensureProductCompositionChecks(&plan, brief); changed > 0 {
					setProductProcess(outputs, "plan_composition_check", "planning", "passed", fmt.Sprintf("已补全%d张图片的用户需求与构图验收项", changed), "系统兜底方案已补全构图验收")
				}
				if changed := ensureProductInteractionChecks(&plan); changed > 0 {
					setProductProcess(outputs, "plan_interaction_checks", "planning", "passed", fmt.Sprintf("已为%d张图片补充通用交互与可见性验收", changed), "系统兜底方案已补全交互验收")
				}
				if changed := ensureProductWearChecks(&plan); changed > 0 {
					setProductProcess(outputs, "plan_wear_checks", "planning", "passed", fmt.Sprintf("已为%d张上脚图片固定左右接合与鞋舌遮挡验收", changed), "系统兜底方案已补全上脚验收")
				}
				if changed := ensureProductIdentityChecks(&plan); changed > 0 {
					setProductProcess(outputs, "plan_identity_check", "planning", "passed", fmt.Sprintf("已为%d张交互图增加同款商品核验", changed), "系统兜底方案已补全商品身份验收")
				}
				err = validateProductPlan(plan, refs, count)
				outputs["product_plan"] = plan
				if err == nil {
					setProductProcess(outputs, "product_plan_fallback", "planning", "passed", "分析返回不完整，已启用稳定商品精修方案", "保留商品本体，只补充场景与交互")
					break
				}
			}
			if fallbackErr != nil {
				err = validationErr
			}
			setProductProcess(outputs, "product_plan", "planning", "failed", "商品分析方案校验未通过", err.Error())
			return finish(err.Error())
		}
		if checkpointErr := saveProductProcess(ctx, pool, p.ProjectID, outputs, "product_plan_repair", "planning", "running", "方案格式不完整，正在自动纠正", err.Error()); checkpointErr != nil {
			return checkpointErr
		}
		planRaw, err = productLLM(ctx, pool, baseURL, token, p, stringAny(runtime["analysis_model_code"]), "product_plan_repair", productPlanningSystem,
			fmt.Sprintf("纠正上次方案格式，保留用户需求和商品依据，返回完整JSON。约束优先级：用户明确要求 > 图片可观察事实 > 预设补充。\n用户要求：%s\n场景预设：%s\n场景补充：%s\n附件用途：%s\n用户框选：%s\n逐张要求：%s\n准确交付%d张。\n校验错误：%s\n原方案：%s\n矩形必须是[x,y,宽,高]，x+宽<=1且y+高<=1。不能将右下角坐标直接作为宽高；请根据原图重新确认区域，不能直接裁掉越界数值或扩大允许修改范围。", brief, preset, productPresetRule(runtime, preset), strings.Join(labels, "；"), mustJSON(refs), stringAny(inputs["deliverables"]), count, err.Error(), mustJSON(planRaw)), urls, budget)
		if err != nil {
			setProductProcess(outputs, "product_plan_repair", "planning", "failed", "方案自动纠正未完成", err.Error())
			return finish(err.Error())
		}
		setProductProcess(outputs, "product_plan_repair", "planning", "passed", "方案自动纠正已返回，正在重新校验", "")
		plan = productPlan{}
	}
	constraintContext := productConstraintContext(runtime, preset, plan, brief)
	var results []productShotResult
	_ = json.Unmarshal(mustJSON(outputs["product_results"]), &results)
	if len(results) == 0 {
		for _, s := range plan.Shots {
			results = append(results, productShotResult{Title: s.Title, Status: "pending", Attempts: []productAttempt{}})
		}
	}
	if len(results) != count {
		return finish("已保存的交付清单与策划不一致")
	}
	reviewAction := stringAny(outputs["confirmed_step"])
	reviewRequested := reviewAction == "product_review"
	acceptRequested := reviewAction == "product_accept"
	if reviewRequested || acceptRequested {
		delete(outputs, "review_deadline_at")
	}
	if reviewRequested {
		delete(outputs, "product_review_skipped")
		setProductProcess(outputs, "product_review_confirm", "product_review", "running", "已开始验收与复核", "正在按已生成成品逐项检查商品细节")
	}
	if acceptRequested {
		outputs["product_review_skipped"] = true
	}
	save := func() error {
		outputs["product_results"] = results
		setProductQualitySummary(outputs, plan, inputs, results)
		_, err := pool.Exec(ctx, `UPDATE workflow_projects SET outputs=$1,updated_at=now() WHERE id=$2`, mustJSON(outputs), p.ProjectID)
		return err
	}
	stopped := func() bool {
		var s string
		e := pool.QueryRow(ctx, `SELECT status FROM workflow_projects WHERE id=$1`, p.ProjectID).Scan(&s)
		return e != nil || s != "running"
	}
	for i, shot := range plan.Shots {
		if results[i].Status == "passed" {
			continue
		}
		if stopped() {
			return finish("用户已停止，已有结果已保留")
		}
		outputs["current_step"] = "product_edit"
		results[i].Status = "processing"
		setProductProcess(outputs, fmt.Sprintf("shot_%d_prepare", i+1), "product_edit", "running", fmt.Sprintf("正在准备第%d张：%s", i+1, shot.Title), "")
		if err = save(); err != nil {
			return err
		}
		productSource, err := productImage(ctx, refs[shot.Source-1].URL)
		if err != nil {
			setProductProcess(outputs, fmt.Sprintf("shot_%d_prepare", i+1), "product_edit", "failed", fmt.Sprintf("第%d张准备未完成", i+1), err.Error())
			return finish(err.Error())
		}
		sceneComposition := !localRepair && productInteractionTask(plan)
		baseIndex := shot.Source - 1
		source := productSource
		// A generated candidate is delivered immediately. Review findings are
		// advisory; another paid edit only runs after the user explicitly asks.
		maxAttempts := 1
		prepareDetail := "局部精修会锁定编辑区域外的原图像素"
		if localRepair {
			prepareDetail = "仅重绘用户圈选区域；圈外像素、原图尺寸和构图保持不变"
		}
		if sceneComposition {
			prepareDetail = "穿戴或使用场景将整幅自然重构；商品图作为身份依据，姿态图只指导构图，成品生成后由用户决定是否启动验收"
		} else if !localRepair {
			prepareDetail = "商品原图关键像素已锁定；姿态和风格图只指导人物、服装、背景与接触区域，不会替换商品本身"
		}
		setProductProcess(outputs, fmt.Sprintf("shot_%d_prepare", i+1), "product_edit", "passed", fmt.Sprintf("第%d张底图与重点区域准备完成", i+1), prepareDetail)
		for a := 0; a < maxAttempts; a++ {
			if stopped() {
				return finish("用户已停止，已有结果已保留")
			}
			if len(results[i].Attempts) <= a {
				results[i].Attempts = append(results[i].Attempts, productAttempt{Status: "pending"})
			}
			at := &results[i].Attempts[a]
			generateID := fmt.Sprintf("shot_%d_generate_%d", i+1, a+1)
			reviewID := fmt.Sprintf("shot_%d_review_%d", i+1, a+1)
			if at.Status == "failed" {
				continue
			}
			if at.ImageURL == "" {
				message := fmt.Sprintf("正在制作第%d张图片", i+1)
				if a > 0 {
					message = fmt.Sprintf("正在根据验收问题修正第%d张（第%d次）", i+1, a)
				}
				setProductProcess(outputs, generateID, "product_edit", "running", message, "")
				if err = save(); err != nil {
					return err
				}
				var candidate image.Image
				var e error
				if shot.Method == "crop" {
					candidate, err = cropProductPixels(source, shot.Crop)
				} else {
					var repair []productBox
					if a > 0 {
						repair, err = productRepairRegions(productRepairReview(results[i].Attempts[a-1]))
						if err != nil {
							return finish(err.Error())
						}
					}
					baseSource := source
					repairFromPrevious := a > 0 && results[i].Attempts[a-1].ImageURL != ""
					if repairFromPrevious {
						baseSource, e = productImage(ctx, results[i].Attempts[a-1].ImageURL)
						if e != nil {
							return finish(e.Error())
						}
					}
					modelBaseSource := resizeProductModelImage(baseSource, productModelWorkingLimit(quality))
					var mask *image.NRGBA
					if sceneComposition {
						mask, e = productRegionMask(modelBaseSource.Bounds(), []productBox{{0, 0, 1, 1}})
					} else {
						mask, e = protectedProductMask(modelBaseSource.Bounds(), shot.EditRegions, shot.ProtectedRegions, repair)
					}
					if e != nil {
						return finish(e.Error())
					}
					maskURL, e := saveProductImage(ctx, fmt.Sprintf("%s-mask-%d-%d", publicID, i, a), mask)
					if e != nil {
						return finish(e.Error())
					}
					at.MaskURL = maskURL
					baseRef, e := saveProductModelBase(ctx, fmt.Sprintf("%s-base-%d-%d", publicID, i, a), modelBaseSource)
					if e != nil {
						return finish(e.Error())
					}
					prompt := fmt.Sprintf("在第一张底图上局部编辑，透明蒙版外保持原样。之后附件是原始参考，商品结构以商品原图为准。\n%s\n%s\n本张检查：%s\n原始附件用途（从第二张起）：%s", shot.Prompt, constraintContext, mustJSON(shot.Checks), strings.Join(labels, "；"))
					if localRepair {
						prompt = fmt.Sprintf("第一张是待修底图，只允许重绘透明蒙版内的圈选问题区域。蒙版外必须逐像素保持不变，不改变整图构图、尺寸、比例、人物身份或其他商品细节。除非用户明确要求保留，圈选区域中的红圈、箭头、文字、高亮线等应视为缺陷标注并移除；根据圈外上下文、材质纹理、人体结构和后续商品参考，修复接缝、穿透、粘连、断裂、重复边缘、错误遮挡及标注残留。修复边缘要与圈外自然连续，不产生补丁边框。\n%s\n%s\n本张检查：%s\n附件用途：%s", shot.Prompt, constraintContext, mustJSON(shot.Checks), strings.Join(labels, "；"))
					} else if sceneComposition {
						prompt = fmt.Sprintf("第一张是商品原图，也是商品身份、拍摄视角和结构的最高优先级依据。以它为起点完成整幅自然重构；第二张只参考人物姿态、服装、构图和接触关系，严禁复制第二张里的商品。保持第一张商品的视角、轮廓、配色、材质、结构件、标识和可见文字。成片不得出现原图背景块、矩形边界、硬边或拼贴接缝。\n本张要求：%s\n用户原始要求：%s\n必须保留：%s\n本张检查：%s\n附件用途：%s", shot.Prompt, brief, strings.Join(plan.Keep, "；"), mustJSON(shot.Checks), strings.Join(labels, "；"))
						prompt += "\n除非用户明确要求改变商品角度，商品本体的拍摄角度、朝向、透视、左右排列和画面中的相对位置必须保持第一张原图不变；只在原位置自然加入人物或场景，不得旋转商品、改变鞋型或重新设计商品。"
						if repairFromPrevious {
							prompt = fmt.Sprintf("第一张是上一版候选图，只修正列出的失败问题；第二张商品原图仍是商品身份、视角、轮廓、配色、材质、结构件、标识和文字的最高优先级依据。不得沿用上一版的错误商品，不重新安排已经正确的人物姿态。\n本张要求：%s\n用户原始要求：%s\n必须保留：%s\n本张检查：%s\n附件用途：%s", shot.Prompt, brief, strings.Join(plan.Keep, "；"), mustJSON(shot.Checks), strings.Join(labels, "；"))
						}
					}
					if !sceneComposition {
						prompt += "\n商品身份是硬约束：成品必须是商品原图中的同一件商品，不能生成外观相近的替代款。"
					}
					prompt += productWearGenerationConstraint(plan)
					if a > 0 {
						prompt += "\n仅修正上次缺陷，不能把上次错误当作商品依据：" + strings.Join(results[i].Attempts[a-1].Issues, "；")
					}
					if !strings.EqualFold(aspectRatio, "auto") {
						prompt += "\n成品必须按" + aspectRatio + "构图，主体完整且不得拉伸；模型输出后仅允许居中裁切适配比例。"
					}
					generationRefs := []string{baseRef}
					referenceIndexes := productGenerationReferenceIndexes(refs, baseIndex, localRepair, repairFromPrevious)
					for _, refIndex := range referenceIndexes {
						ref := refs[refIndex]
						if len(generationRefs) >= 2 {
							continue
						}
						refImage, readErr := productImage(ctx, ref.URL)
						if readErr != nil {
							return finish(readErr.Error())
						}
						modelRef, saveErr := saveProductModelReference(ctx, fmt.Sprintf("%s-reference-%d-%d-%d", publicID, i, a, refIndex), refImage)
						if saveErr != nil {
							return finish(saveErr.Error())
						}
						generationRefs = append(generationRefs, modelRef)
					}
					if i > 0 && (results[0].Status == "passed" || results[0].Status == "accepted" || results[0].Status == "awaiting_review") && results[0].ImageURL != "" {
						hero, e := productImage(ctx, results[0].ImageURL)
						if e != nil {
							return finish(e.Error())
						}
						heroURL, e := saveProductModelReference(ctx, publicID+"-style-reference", hero)
						if e != nil {
							return finish(e.Error())
						}
						if len(generationRefs) < 2 {
							generationRefs = append(generationRefs, heroURL)
							prompt += "\n最后一张是已通过检查的套图代表图，仅参考光线和背景风格；商品身份仍以原始商品图为准，执行当前图片自己的构图要求。"
						}
					}
					gen := map[string]interface{}{"prompt": prompt, "reference_images": generationRefs, "quality": quality}
					if !sceneComposition {
						gen["mask"] = maskURL
					}
					if strings.EqualFold(aspectRatio, "auto") {
						gen["size"] = fmt.Sprintf("%dx%d", modelBaseSource.Bounds().Dx(), modelBaseSource.Bounds().Dy())
					} else {
						gen["aspect_ratio"], gen["image_size"] = aspectRatio, "1K"
					}
					item, e := productGenerate(ctx, pool, baseURL, token, p, publicID, stringAny(runtime["generation_model_code"]), gen, budget, i, a)
					if item != nil {
						at.TaskNo = stringAny(item["task_no"])
					}
					if e != nil {
						at.Status = "uncertain"
						at.Issues = []string{e.Error()}
						setProductProcess(outputs, generateID, "product_edit", "failed", fmt.Sprintf("第%d张制作未完成", i+1), e.Error())
						_ = save()
						return finish(e.Error())
					}
					out := mapAnyOr(item["output"], nil)
					rawURL := firstNonEmpty(stringAny(out["image_url"]), firstImageResultURL(out))
					generated, e := productImage(ctx, rawURL)
					if e != nil {
						return finish(e.Error())
					}
					if localRepair {
						fullMask, maskErr := protectedProductMask(baseSource.Bounds(), shot.EditRegions, nil, repair)
						if maskErr != nil {
							return finish(maskErr.Error())
						}
						candidate, err = finalizeProductLocalRepair(baseSource, modelBaseSource, generated, mask, fullMask)
					} else {
						candidate, err = finalizeProductPixels(sceneComposition, modelBaseSource, generated, mask, aspectRatio)
					}
				}
				if err != nil {
					return finish(err.Error())
				}
				at.ImageURL, err = saveProductImage(ctx, fmt.Sprintf("%s-result-%d-%d", publicID, i, a), candidate)
				if err != nil {
					return finish(err.Error())
				}
				at.Status = "checking"
				results[i].ImageURL = at.ImageURL
				setProductProcess(outputs, generateID, "product_edit", "passed", fmt.Sprintf("第%d张候选图已生成", i+1), "成品已保存；自动验收不会在用户确认前启动")
				if err = save(); err != nil {
					return err
				}
			}
			if stopped() {
				return finish("用户已停止，已有结果已保留")
			}
			if !reviewRequested {
				at.Status = "awaiting_review"
				results[i].Status = "awaiting_review"
				if acceptRequested {
					at.Status = "accepted"
					results[i].Status = "accepted"
					setProductProcess(outputs, reviewID, "product_review", "passed", fmt.Sprintf("第%d张已由用户确认", i+1), "本张未运行自动验收与复核")
				} else {
					setProductProcess(outputs, reviewID, "product_review", "waiting", fmt.Sprintf("第%d张等待手动验收", i+1), "图片已生成，自动验收与复核已暂停")
				}
				if err = save(); err != nil {
					return err
				}
				break
			}
			localizeID := fmt.Sprintf("shot_%d_localize_%d", i+1, a+1)
			setProductProcess(outputs, localizeID, "product_review", "running", fmt.Sprintf("正在定位第%d张成品的关键结构与交互区域", i+1), "定位使用成品坐标，不沿用商品原图坐标")
			if err = save(); err != nil {
				return err
			}
			localized, locateErr := productLLM(ctx, pool, baseURL, token, p, stringAny(runtime["quality_model_code"]), fmt.Sprintf("product_localize_%d_%d", i, a), productLocalizationSystem, fmt.Sprintf("%s\n本张：%s\n需要在候选图中定位的检查项：%s", constraintContext, shot.Prompt, mustJSON(shot.Checks)), []string{at.ImageURL}, budget)
			if stopped() {
				return finish("用户已停止，已有结果已保留")
			}
			localizedBoxes := map[string]productBox{}
			if locateErr == nil {
				localizedBoxes, locateErr = productLocalizationRegions(localized, shot.Checks)
			}
			if locateErr != nil {
				setProductProcess(outputs, localizeID, "product_review", "uncertain", fmt.Sprintf("第%d张动态定位不完整，使用全图与分区复核", i+1), locateErr.Error())
			} else {
				at.Localization = localized
				setProductProcess(outputs, localizeID, "product_review", "passed", fmt.Sprintf("第%d张已定位%d个成品检查区域", i+1, len(localizedBoxes)), "后续验收将使用成品局部放大图")
			}
			if err = save(); err != nil {
				return err
			}
			outputs["current_step"] = "product_review"
			setProductProcess(outputs, reviewID, "product_review", "running", fmt.Sprintf("正在验收第%d张商品细节", i+1), fmt.Sprintf("共%d个检查项", len(shot.Checks)))
			if err = save(); err != nil {
				return err
			}
			reviewRefs := append([]string{}, urls...)
			sourceCropIDs := []string{}
			// Local source crops keep thin strips, lettering and seams visible to review.
			for _, check := range shot.Checks {
				if len(sourceCropIDs) >= 3 || check.Region == (productBox{0, 0, 1, 1}) {
					continue
				}
				im, e := productImage(ctx, refs[check.Reference-1].URL)
				if e != nil {
					return finish(e.Error())
				}
				crop, e := cropProductPixels(im, check.Region)
				if e != nil {
					return finish(e.Error())
				}
				data, e := productPNG(crop)
				if e != nil {
					return finish(e.Error())
				}
				reviewRefs = append(reviewRefs, productDataURL(data))
				sourceCropIDs = append(sourceCropIDs, check.ID)
			}
			interactionReview := productInteractionTask(plan)
			candidateCropIDs := []string{}
			candidate, e := productImage(ctx, at.ImageURL)
			if e != nil {
				return finish(e.Error())
			}
			for _, check := range shot.Checks {
				region, ok := localizedBoxes[check.ID]
				if !ok || region[2]*region[3] >= 0.85 || len(candidateCropIDs) >= 4 {
					continue
				}
				region = padProductBox(region, 0.08)
				crop, cropErr := cropProductPixels(candidate, region)
				if cropErr != nil {
					continue
				}
				data, encodeErr := productPNG(crop)
				if encodeErr != nil {
					return finish(encodeErr.Error())
				}
				reviewRefs = append(reviewRefs, productDataURL(data))
				candidateCropIDs = append(candidateCropIDs, check.ID)
			}
			if len(candidateCropIDs) == 0 && interactionReview {
				for index, region := range []productBox{{0, 0.12, 0.56, 0.58}, {0.44, 0.12, 0.56, 0.58}} {
					crop, cropErr := cropProductPixels(candidate, region)
					if cropErr != nil {
						return finish(cropErr.Error())
					}
					data, encodeErr := productPNG(crop)
					if encodeErr != nil {
						return finish(encodeErr.Error())
					}
					reviewRefs = append(reviewRefs, productDataURL(data))
					candidateCropIDs = append(candidateCropIDs, fmt.Sprintf("fallback_%d", index+1))
				}
			}
			reviewRefs = append(reviewRefs, at.ImageURL)
			reviewLayout := fmt.Sprintf("原图局部对应检查项：%s；候选图局部对应检查项：%s；最后一张是完整候选图", strings.Join(sourceCropIDs, ","), strings.Join(candidateCropIDs, ","))
			reviewPrompt := fmt.Sprintf("%s\n附件用途：%s\n%s。\n本张：%s\n检查项：%s", constraintContext, strings.Join(labels, "；"), reviewLayout, shot.Prompt, mustJSON(shot.Checks))
			review, e := productLLM(ctx, pool, baseURL, token, p, stringAny(runtime["quality_model_code"]), fmt.Sprintf("product_review_%d_%d", i, a), productReviewSystem, reviewPrompt, reviewRefs, budget)
			if stopped() {
				return finish("用户已停止，已有结果已保留")
			}
			if e != nil {
				at.Status = "uncertain"
				at.Issues = []string{e.Error()}
				results[i].Status = "needs_review"
				setProductProcess(outputs, reviewID, "product_review", "uncertain", fmt.Sprintf("第%d张检查未完成，成品仍可查看和下载", i+1), e.Error())
				if err = save(); err != nil {
					return err
				}
				break
			}
			at.Review = review
			at.Status, at.Issues = productReviewDecision(review, shot.Checks)
			if at.Status == "passed" && strings.EqualFold(stringAny(inputs["review_mode"]), "strict") {
				verifyID := fmt.Sprintf("shot_%d_verify_%d", i+1, a+1)
				setProductProcess(outputs, verifyID, "product_review", "running", fmt.Sprintf("正在独立复核第%d张成品", i+1), "严格模式要求第二次验收独立通过")
				if err = save(); err != nil {
					return err
				}
				verificationSystem := productStrictReviewSystem
				verificationPrompt := reviewPrompt
				verificationRefs := reviewRefs
				if interactionReview {
					verificationSystem = productStrictIdentityReviewSystem
					verificationPrompt = fmt.Sprintf("%s\n附件1是唯一商品原图，附件2是完整候选图。直接逐项比对这两张图；不得把相同颜色、相同品牌或相近品类当作同一商品。\n本张要求：%s\n检查项：%s", constraintContext, shot.Prompt, mustJSON(shot.Checks))
					verificationRefs = []string{urls[baseIndex], at.ImageURL}
				}
				verification, verifyErr := productLLM(ctx, pool, baseURL, token, p, stringAny(runtime["quality_model_code"]), fmt.Sprintf("product_verify_%d_%d", i, a), verificationSystem, verificationPrompt, verificationRefs, budget)
				if stopped() {
					return finish("用户已停止，已有结果已保留")
				}
				if verifyErr != nil {
					at.Status, at.Issues = "uncertain", []string{verifyErr.Error()}
					setProductProcess(outputs, verifyID, "product_review", "uncertain", fmt.Sprintf("第%d张独立复核未完成", i+1), verifyErr.Error())
				} else {
					at.Verification = verification
					at.Status, at.Issues = productReviewDecision(verification, shot.Checks)
					setProductProcess(outputs, verifyID, "product_review", at.Status, fmt.Sprintf("第%d张独立复核%s", i+1, map[bool]string{true: "通过", false: "发现问题"}[at.Status == "passed"]), strings.Join(at.Issues, "；"))
				}
			}
			results[i].Status = at.Status
			if at.Status != "passed" {
				results[i].Status = "needs_review"
			}
			reviewMessage := fmt.Sprintf("第%d张细节检查通过", i+1)
			if at.Status != "passed" {
				reviewMessage = fmt.Sprintf("第%d张发现%d项需要处理的问题", i+1, len(at.Issues))
			}
			setProductProcess(outputs, reviewID, "product_review", at.Status, reviewMessage, strings.Join(at.Issues, "；"))
			if err = save(); err != nil {
				return err
			}
			break
		}
		if results[i].ImageURL == "" {
			return finish("图片生成未完成")
		}
	}
	if !reviewRequested && !acceptRequested {
		waitMinutes := intAny(runtime["review_wait_minutes"])
		if waitMinutes < 30 || waitMinutes > 1440 {
			waitMinutes = 120
		}
		deadline := time.Now().UTC().Add(time.Duration(waitMinutes) * time.Minute)
		outputs["review_deadline_at"] = deadline.Format(time.RFC3339)
		outputs["review_wait_minutes"] = waitMinutes
		setProductProcess(outputs, "product_review_confirm", "product_review_confirm", "waiting", "首版图片已生成，等待你的决定", fmt.Sprintf("%d分钟内可选择验收；到期将按当前成品自动完成，不运行验收模型", waitMinutes))
		outputs["current_step"] = "product_review_confirm"
		tag, pauseErr := pool.Exec(ctx, `UPDATE workflow_projects SET status='waiting_confirm',outputs=$1,updated_at=now() WHERE id=$2 AND status='running'`, mustJSON(outputs), p.ProjectID)
		if pauseErr != nil {
			return pauseErr
		}
		if tag.RowsAffected() != 1 {
			return finish("用户已停止，已有结果已保留")
		}
		return nil
	}
	setProductQualitySummary(outputs, plan, inputs, results)
	if reviewRequested {
		setProductProcess(outputs, "product_review_confirm", "product_review", "passed", "验收与复核已完成", "检查结果已更新到对应成品")
	}
	return finish("")
}
