package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type workflowNode struct {
	ID             string  `json:"id"`
	Type           string  `json:"type"`
	Name           string  `json:"name"`
	ModelCode      string  `json:"model_code"`
	PromptTemplate string  `json:"prompt_template"`
	Cost           float64 `json:"cost"`
}

func processWorkflowTask(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload) error {
	var workflowID int64
	var inputsRaw []byte
	var estimated float64
	var publicID string
	err := pool.QueryRow(ctx,
		`SELECT workflow_id, inputs, estimated_cost, public_id FROM workflow_projects WHERE id=$1`,
		p.ProjectID).Scan(&workflowID, &inputsRaw, &estimated, &publicID)
	if err != nil {
		return err
	}

	var nodesRaw, runtimeRaw []byte
	var category string
	if err := pool.QueryRow(ctx, `SELECT nodes, category, runtime_config FROM workflow_definitions WHERE id=$1`, workflowID).
		Scan(&nodesRaw, &category, &runtimeRaw); err != nil {
		return failWorkflow(ctx, pool, p, publicID, estimated, "工作流定义缺失")
	}

	var inputs map[string]interface{}
	_ = json.Unmarshal(inputsRaw, &inputs)
	if inputs == nil {
		inputs = map[string]interface{}{}
	}

	runtimeCfg := map[string]interface{}{}
	_ = json.Unmarshal(runtimeRaw, &runtimeCfg)
	if stringAny(runtimeCfg["agent_mode"]) == "simple_pipeline" {
		return processSimpleAgentWorkflow(ctx, pool, baseURL, token, p, publicID, workflowID, category, estimated, inputs, runtimeCfg)
	}

	var nodes []workflowNode
	_ = json.Unmarshal(nodesRaw, &nodes)
	return processCustomWorkflow(ctx, pool, baseURL, token, p, publicID, category, estimated, inputs, nodes)
}

func processCustomWorkflow(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, publicID string, category string, estimated float64, inputs map[string]interface{}, nodes []workflowNode) error {
	vars := map[string]string{}
	for k, v := range inputs {
		vars[k] = fmt.Sprintf("%v", v)
	}
	pool.Exec(ctx, `UPDATE workflow_projects SET status='running', started_at=COALESCE(started_at, now()), updated_at=now() WHERE id=$1`, p.ProjectID)

	outputs := loadWorkflowOutputs(ctx, pool, p.ProjectID)
	var totalCost float64
	lastText := ""
	for seq, node := range nodes {
		if existing, ok := mapAny(outputs[node.ID]); ok {
			absorbNodeOutputVars(vars, node.ID, existing)
			if s := firstNonEmpty(stringAny(existing["text"]), stringAny(existing["generation_prompt"]), stringAny(existing["summary"]), stringAny(existing["raw_text"])); s != "" {
				lastText = s
			}
			continue
		}
		prompt := renderTemplate(node.PromptTemplate, vars)
		if strings.TrimSpace(prompt) == "" {
			if node.Type == "image" || node.Type == "video" {
				prompt = mediaPromptFallback(lastText, vars, inputs)
			}
		}
		nodeRunID := insertWorkflowNodeRun(ctx, pool, p.ProjectID, node.ID, node.Name, node.Type, map[string]interface{}{"prompt": prompt, "model_code": node.ModelCode}, seq)
		start := time.Now()
		out, errMsg := runNode(ctx, pool, baseURL, token, p.UserID, publicID, category, node, prompt, inputs)
		duration := int(time.Since(start).Milliseconds())
		if errMsg != "" {
			pool.Exec(ctx, `UPDATE workflow_node_runs SET status='failed', error=$1, duration_ms=$2 WHERE id=$3`, errMsg, duration, nodeRunID)
			return failWorkflow(ctx, pool, p, publicID, estimated, fmt.Sprintf("节点「%s」执行失败：%s", node.Name, errMsg))
		}
		absorbNodeOutputVars(vars, node.ID, out)
		lastText = firstNonEmpty(vars[node.ID+"_generation_prompt"], vars["generation_prompt"], vars[node.ID+"_text"], lastText)
		outputs[node.ID] = out
		for k, v := range out {
			outputs[node.ID+"_"+k] = v
		}
		if node.Type == "image" || node.Type == "video" {
			outputs["media_tasks"] = appendMediaTaskOutput(outputs["media_tasks"], out)
		}
		updateNodeRunSuccess(ctx, pool, nodeRunID, out, node.Cost, duration)
		totalCost += node.Cost
		if node.Type == "llm" && stringAny(inputs["_mode"]) != "auto" && !boolAny(outputs["autopilot"]) && stringAny(outputs["confirmed_step"]) == "" {
			outputs["current_step"] = "confirm"
			outputs["autopilot"] = false
			saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
			pool.Exec(ctx, `UPDATE workflow_projects SET status='waiting_confirm', updated_at=now() WHERE id=$1`, p.ProjectID)
			return nil
		}
	}

	pool.Exec(ctx, `
		UPDATE workflow_projects SET status='succeeded', outputs=$1, actual_cost=$2, finished_at=now(), updated_at=now() WHERE id=$3`,
		mustJSON(outputs), totalCost, p.ProjectID)
	chargeBilling(ctx, pool, p.UserID, estimated, totalCost, "workflow", publicID, "workflow_usage", "智能体工作流")
	log.Printf("Workflow project %s completed (cost=%.4f)", publicID, totalCost)
	return nil
}

func appendMediaTaskOutput(raw interface{}, out map[string]interface{}) []map[string]interface{} {
	items := []map[string]interface{}{}
	if arr, ok := raw.([]map[string]interface{}); ok {
		items = append(items, arr...)
	} else if arr, ok := raw.([]interface{}); ok {
		for _, item := range arr {
			if m, ok := item.(map[string]interface{}); ok {
				items = append(items, m)
			}
		}
	}
	taskNo := stringAny(out["_task_no"])
	if taskNo == "" {
		taskNo = newWorkflowTaskNo(len(items))
	}
	items = append(items, map[string]interface{}{
		"task_no":  taskNo,
		"status":   "succeeded",
		"progress": 100,
		"output":   out,
	})
	return items
}

func absorbNodeOutputVars(vars map[string]string, nodeID string, out map[string]interface{}) {
	if text := stringAny(out["text"]); text != "" {
		vars[nodeID] = text
		vars[nodeID+"_text"] = text
		if parsed := parseJSONish(text); len(parsed) > 0 {
			for k, v := range parsed {
				if s := stringAny(v); s != "" {
					vars[nodeID+"_"+k] = s
					if k == "generation_prompt" {
						vars["generation_prompt"] = s
					}
				}
			}
		}
	}
	for k, v := range out {
		if s := stringAny(v); s != "" {
			vars[nodeID+"_"+k] = s
			if k == "generation_prompt" {
				vars["generation_prompt"] = s
			}
		}
	}
}

func mediaPromptFallback(lastText string, vars map[string]string, inputs map[string]interface{}) string {
	if s := firstNonEmpty(vars["generation_prompt"], vars["analysis_generation_prompt"], lastText, vars["analysis"], vars["analysis_text"], firstUserPrompt(inputs)); s != "" {
		if parsed := parseJSONish(s); len(parsed) > 0 {
			return firstNonEmpty(stringAny(parsed["generation_prompt"]), stringAny(parsed["summary"]), stringAny(parsed["raw_text"]), s)
		}
		return s
	}
	return ""
}

func processSimpleAgentWorkflow(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, publicID string, workflowID int64, category string, estimated float64, inputs map[string]interface{}, runtimeCfg map[string]interface{}) error {
	outputs := loadWorkflowOutputs(ctx, pool, p.ProjectID)
	autopilot := boolAny(outputs["autopilot"]) || stringAny(inputs["_mode"]) == "auto"
	pool.Exec(ctx, `UPDATE workflow_projects SET status='running', started_at=COALESCE(started_at, now()), updated_at=now() WHERE id=$1`, p.ProjectID)

	analysis, ok := mapAny(outputs["analysis"])
	if !ok {
		nodeRunID := insertWorkflowNodeRun(ctx, pool, p.ProjectID, "analysis", "需求分析", "llm", map[string]interface{}{"inputs": inputs}, 0)
		start := time.Now()
		out, errMsg := runAgentAnalysis(ctx, pool, baseURL, token, stringAny(runtimeCfg["analysis_model_code"]), category, runtimeCfg, inputs)
		duration := int(time.Since(start).Milliseconds())
		if errMsg != "" {
			pool.Exec(ctx, `UPDATE workflow_node_runs SET status='failed', error=$1, duration_ms=$2 WHERE id=$3`, errMsg, duration, nodeRunID)
			return failWorkflow(ctx, pool, p, publicID, estimated, "需求分析失败："+errMsg)
		}
		analysis = out
		updateNodeRunSuccess(ctx, pool, nodeRunID, out, floatAny(out["_analysis_cost"]), duration)
		outputs["analysis"] = out
		outputs["current_step"] = "confirm"
		outputs["autopilot"] = autopilot
		saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
		if !autopilot {
			pool.Exec(ctx, `UPDATE workflow_projects SET status='waiting_confirm', updated_at=now() WHERE id=$1`, p.ProjectID)
			return nil
		}
	}

	confirmed := mapAnyOr(outputs["confirmation_payload"], map[string]interface{}{})
	candidateID := stringAny(confirmed["candidate_id"])
	finalPrompt := firstNonEmpty(stringAny(confirmed["prompt"]), stringAny(confirmed["final_prompt"]), selectedAnalysisPrompt(analysis, candidateID), firstUserPrompt(inputs))
	generationInputs := mergeAgentGenerationInputs(inputs, analysis, candidateID, confirmed)
	finalPrompt = agentPromptWithScene(finalPrompt, generationInputs)
	if _, done := outputs["media_tasks"]; done && stringAny(outputs["current_step"]) == "result" {
		return completeSimpleAgentWorkflow(ctx, pool, p, publicID, estimated, outputs)
	}

	nodeRunID := insertWorkflowNodeRun(ctx, pool, p.ProjectID, "generate", "生成结果", stringAny(runtimeCfg["generation_type"]), map[string]interface{}{"prompt": finalPrompt}, 1)
	start := time.Now()
	mediaTasks, errMsg := runAgentMediaTasks(ctx, pool, baseURL, token, p.ProjectID, p.UserID, publicID, runtimeCfg, generationInputs, finalPrompt)
	duration := int(time.Since(start).Milliseconds())
	generationCost := sumAgentMediaTaskCost(mediaTasks)
	out := map[string]interface{}{"media_tasks": mediaTasks, "cost": generationCost}
	outputs["media_tasks"] = mediaTasks
	outputs["current_step"] = "result"
	saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
	if errMsg != "" {
		pool.Exec(ctx, `UPDATE workflow_node_runs SET status='failed', output=$1, error=$2, duration_ms=$3 WHERE id=$4`, mustJSON(out), errMsg, duration, nodeRunID)
		return failWorkflow(ctx, pool, p, publicID, estimated, errMsg)
	}
	updateNodeRunSuccess(ctx, pool, nodeRunID, out, generationCost, duration)
	return completeSimpleAgentWorkflow(ctx, pool, p, publicID, estimated, outputs)
}

func runAgentAnalysis(ctx context.Context, pool *pgxpool.Pool, baseURL, token, modelCode, category string, runtimeCfg, inputs map[string]interface{}) (map[string]interface{}, string) {
	if modelCode == "" {
		modelCode = "chat_demo_v1"
	}
	upstreamModel, endpoint, extraParams, errMsg := loadAgentAnalysisModel(ctx, pool, modelCode)
	if errMsg != "" {
		return nil, errMsg
	}
	sceneCode := stringAny(inputs["creative_scene"])
	sceneLabel := firstNonEmpty(stringAny(inputs["creative_scene_label"]), agentCreativeSceneLabel(sceneCode))
	system := buildAgentAnalysisSystemPrompt(category, stringAny(runtimeCfg["preset_code"]), intAny(runtimeCfg["candidate_count"]), sceneCode)
	content := fmt.Sprintf("用户需求：%s\n参考图URL：%s\n出图场景：%s\n当前生成参数：%s\n请补全创作方案。", firstUserPrompt(inputs), firstImageURL(inputs), sceneLabel, agentGenerationParamSummary(inputs))
	bodyMap := copyLLMExtraParams(extraParams)
	bodyMap["model"] = firstNonEmpty(upstreamModel, modelCode)
	bodyMap["messages"] = []map[string]string{
		{"role": "system", "content": system},
		{"role": "user", "content": content},
	}
	if _, ok := bodyMap["temperature"]; !ok {
		bodyMap["temperature"] = 0.65
	}
	body, _ := json.Marshal(bodyMap)
	conn := parseConnection(extraParams, baseURL, token)
	target := strings.TrimSpace(endpoint)
	if target == "" {
		target = "/v1/chat/completions"
	}
	if strings.HasPrefix(target, "/") {
		target = trimRightSlash(conn.BaseURL) + target
	}
	respBody, status, err := doJSONRequest(ctx, conn, "POST", target, body, 90*time.Second)
	if err != nil {
		return nil, "模型服务异常：" + err.Error()
	}
	if status >= 400 {
		return nil, fmt.Sprintf("模型服务异常：HTTP %d %s", status, string(respBody))
	}
	text := extractLLMText(respBody)
	if strings.TrimSpace(text) == "" {
		return nil, "模型未返回分析内容"
	}
	out := normalizeAgentAnalysisOutput(text, category)
	pt, ct := chatUsageTokens(respBody)
	out["_analysis_cost"] = estimateModelCostByCodeWorker(ctx, pool, modelCode, bodyMap, pt, ct)
	return out, ""
}

func loadAgentAnalysisModel(ctx context.Context, pool *pgxpool.Pool, modelCode string) (string, string, map[string]interface{}, string) {
	var upstreamModel, endpoint string
	var extraRaw []byte
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(new_api_model,''), COALESCE(new_api_endpoint,''), COALESCE(new_api_extra_params,'{}'::jsonb)
		FROM models WHERE code=$1 AND is_enabled=true`, modelCode).Scan(&upstreamModel, &endpoint, &extraRaw); err != nil {
		return "", "", nil, "分析模型不存在或未启用：" + modelCode
	}
	extra := map[string]interface{}{}
	_ = json.Unmarshal(extraRaw, &extra)
	if extra == nil {
		extra = map[string]interface{}{}
	}
	return upstreamModel, endpoint, extra, ""
}

func buildAgentAnalysisSystemPrompt(category, presetCode string, candidateCount int, creativeScene string) string {
	target := "图片"
	extra := "每个候选方案必须适合图片生成模型，包含主体、材质、构图、光线、背景、商品卖点、商业质感、平台电商主图规范；prompt 要能直接传给图片生成接口。"
	if category == "video" {
		target = "视频"
		extra = "每个候选方案必须适合视频生成模型，包含镜头运动、节奏、时长感、商品卖点、首尾帧衔接、平台短视频风格；prompt 要能直接传给视频生成接口。"
	}
	if candidateCount <= 0 {
		candidateCount = 3
	}
	scene := agentPresetInstruction(presetCode, category)
	scene = firstNonEmpty(agentCreativeSceneInstruction(creativeScene), scene)
	return fmt.Sprintf(`你是电商AI创作智能体的方案分析引擎，当前生成类型是%s。
只输出严格JSON，不要Markdown，不要标题，不要解释，不要出现“某模型的回答”。
禁止输出与创作无关的运维、CPU、IO、数据库、系统瓶颈、监控等泛化建议。
当前创作场景：%s
必须严格遵守用户当前选择的生成参数，例如数量、时长、画面方向、比例、质量、参考图设置；不要在 prompt 中写入与这些参数冲突的时长、比例或方向。
你必须基于用户需求和参考图，给出%d条可选择的创作方案，并标记AI推荐方案。
JSON结构：
{
  "summary": "一句话概括创作目标",
  "user_intent": "用户真实需求",
  "asset_notes": "参考图中可利用的视觉信息；没有参考图则说明无",
  "selling_points": ["卖点1","卖点2","卖点3"],
  "style": "整体商业风格",
  "recommendation": "A",
  "candidates": [
    {"id":"A","title":"方案名","reason":"推荐理由","prompt":"可直接生成的完整提示词","negative_prompt":"需要避免的内容","params":{}},
    {"id":"B","title":"方案名","reason":"适用场景","prompt":"可直接生成的完整提示词","negative_prompt":"需要避免的内容","params":{}},
    {"id":"C","title":"方案名","reason":"适用场景","prompt":"可直接生成的完整提示词","negative_prompt":"需要避免的内容","params":{}}
  ],
  "generation_prompt": "AI推荐方案的prompt"
}
%s`, target, scene, candidateCount, extra)
}

func agentPresetInstruction(code, category string) string {
	switch code {
	case "ecommerce_scene_image":
		return "电商场景图。重点是保留商品主体识别度，补全真实使用场景，强化材质、尺度、光影和购买欲。"
	case "poster_image":
		return "营销海报。重点是广告构图、标题留白、品牌质感、活动氛围和可读性，避免把文字直接画错。"
	case "product_showcase_video":
		return "商品展示短视频。重点是首秒吸引、商品运镜、卖点节奏、镜头运动和平台短视频质感。"
	case "image_to_video":
		return "图生视频。重点是保持参考图主体一致，添加合理运动、镜头推进、光影变化和动态氛围。"
	default:
		if category == "video" {
			return "通用视频创作。重点是镜头、运动、节奏、主体一致性和可直接执行的视频提示词。"
		}
		return "电商商品主图。重点是商品主体清晰、白底或高级简洁背景、材质纹理、商业光影和平台主图规范。"
	}
}

func agentCreativeSceneLabel(code string) string {
	switch code {
	case "detail_image":
		return "商品详情图"
	case "scene_image":
		return "场景图"
	case "marketing_poster":
		return "营销海报"
	case "product_video":
		return "商品视频"
	case "image_to_video":
		return "图生视频"
	default:
		if code == "" {
			return "商品主图"
		}
		return code
	}
}

func agentCreativeSceneInstruction(code string) string {
	switch code {
	case "detail_image":
		return "商品详情图 / Product detail image. 必须突出商品结构、材质细节、功能卖点、规格层次和详情页模块感；不要生成普通商品主图、单一白底主图或营销海报。"
	case "scene_image":
		return "电商场景图 / Lifestyle scene image. 必须保留商品主体识别度，并把商品放入真实、有购买欲的使用场景；强化环境、生活方式、光影和商业质感；不要生成普通白底主图。"
	case "marketing_poster":
		return "营销海报 / Marketing poster. 必须使用广告构图、活动氛围、品牌质感、标题留白和传播冲击力；画面应像平台推广素材；不要生成普通商品主图或详情图。"
	case "product_video":
		return "商品视频 / Product showcase video. 必须围绕商品主体做展示短视频，包含首秒吸引、卖点节奏、商品运镜、商业光影和平台短视频质感；不要生成无关风景、空镜或默认素材。"
	case "image_to_video":
		return "图生视频 / Image-to-video. 必须严格保持参考图主体、材质和核心结构一致，只增加合理运动、镜头推进、光影变化和动态氛围；不要重新设计主体，不要变成普通商品视频。"
	case "main_image", "":
		return "电商商品主图 / Main product image. 必须商品主体清晰，背景干净或高级简洁，材质纹理突出，符合平台主图规范；避免过度场景化、详情页排版和复杂文字。"
	default:
		return ""
	}
}

func agentGenerationParamSummary(inputs map[string]interface{}) string {
	items := []string{}
	if s := generationLanguageLabel(inputs); s != "" {
		items = append(items, "生成语言="+s)
	}
	if s := stringAny(inputs["creative_scene_label"]); s != "" {
		items = append(items, "场景="+s)
	} else if s := agentCreativeSceneLabel(stringAny(inputs["creative_scene"])); s != "" {
		items = append(items, "场景="+s)
	}
	if n := intAny(inputs["count"]); n > 0 {
		items = append(items, fmt.Sprintf("数量=%d", n))
	} else if n := intAny(inputs["n"]); n > 0 {
		items = append(items, fmt.Sprintf("数量=%d", n))
	}
	for _, key := range []string{"duration", "duration_sec", "seconds"} {
		if s := stringAny(inputs[key]); s != "" {
			items = append(items, "时长="+s)
			break
		}
		if n := intAny(inputs[key]); n > 0 {
			items = append(items, fmt.Sprintf("时长=%d秒", n))
			break
		}
	}
	for _, key := range []string{"orientation", "direction"} {
		if s := stringAny(inputs[key]); s != "" {
			items = append(items, "画面方向="+s)
			break
		}
	}
	for _, key := range []string{"aspect_ratio", "ratio", "size"} {
		if s := stringAny(inputs[key]); s != "" {
			items = append(items, "比例/尺寸="+s)
			break
		}
	}
	if s := stringAny(inputs["quality"]); s != "" {
		items = append(items, "质量="+s)
	}
	refCount := 0
	if s := stringAny(inputs["image_url"]); s != "" {
		refCount++
	}
	if s := stringAny(inputs["first_frame"]); s != "" {
		refCount++
	}
	if s := stringAny(inputs["last_frame"]); s != "" {
		refCount++
	}
	for _, key := range []string{"reference_images", "reference_asset_ids", "asset_ids"} {
		switch v := inputs[key].(type) {
		case []interface{}:
			refCount += len(v)
		case []string:
			refCount += len(v)
		}
	}
	if refCount > 0 {
		items = append(items, fmt.Sprintf("参考图=%d张", refCount))
	} else {
		items = append(items, "参考图=无")
	}
	if len(items) == 0 {
		return "无特别参数"
	}
	return strings.Join(items, "；")
}

func agentPromptWithScene(prompt string, inputs map[string]interface{}) string {
	sceneCode := stringAny(inputs["creative_scene"])
	sceneLabel := firstNonEmpty(stringAny(inputs["creative_scene_label"]), agentCreativeSceneLabel(sceneCode))
	sceneInstruction := agentCreativeSceneInstruction(sceneCode)
	if strings.TrimSpace(sceneInstruction) == "" {
		return applyGenerationLanguage(prompt, inputs)
	}
	return applyGenerationLanguage(fmt.Sprintf("SCENE HARD REQUIREMENT: %s (%s)\n%s\nThe final media MUST visibly follow this scene. If the user prompt or AI analysis conflicts, obey this scene requirement.\n当前生成参数：%s\n\n%s", sceneLabel, sceneCode, sceneInstruction, agentGenerationParamSummary(inputs), strings.TrimSpace(prompt)), inputs)
}

func generationLanguageLabel(inputs map[string]interface{}) string {
	return firstNonEmpty(
		stringAny(inputs["language_label"]),
		stringAny(inputs["generation_language_label"]),
		stringAny(inputs["language_name"]),
		stringAny(inputs["generation_language_name"]),
		stringAny(inputs["language"]),
		stringAny(inputs["generation_language"]),
	)
}

func applyGenerationLanguage(prompt string, inputs map[string]interface{}) string {
	lang := strings.TrimSpace(generationLanguageLabel(inputs))
	if lang == "" {
		return prompt
	}
	cleanPrompt := strings.TrimSpace(prompt)
	instruction := fmt.Sprintf("LANGUAGE HARD REQUIREMENT: Generate all visible text, labels, captions, subtitles, product copy and marketing copy in %s. Unless the user's prompt explicitly requests another language, do not switch languages.", lang)
	if strings.Contains(cleanPrompt, "LANGUAGE HARD REQUIREMENT:") {
		return cleanPrompt
	}
	if cleanPrompt == "" {
		return instruction
	}
	return instruction + "\n\n" + cleanPrompt
}

func sumAgentMediaTaskCost(tasks []map[string]interface{}) float64 {
	total := 0.0
	for _, item := range tasks {
		total += floatAny(item["actual_cost"])
	}
	return total
}

func simpleAgentActualCost(ctx context.Context, pool *pgxpool.Pool, projectID int64, outputs map[string]interface{}) float64 {
	total := 0.0
	var nodeCost float64
	_ = pool.QueryRow(ctx, `SELECT COALESCE(SUM(cost),0) FROM workflow_node_runs WHERE project_id=$1`, projectID).Scan(&nodeCost)
	if nodeCost > 0 {
		return nodeCost
	}
	if raw, ok := outputs["media_tasks"].([]interface{}); ok {
		for _, item := range raw {
			if m, ok := item.(map[string]interface{}); ok {
				total += floatAny(m["actual_cost"])
			}
		}
	}
	if total <= 0 {
		total = floatAny(outputs["cost"])
	}
	return total
}

func chatUsageTokens(body []byte) (int, int) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return 0, 0
	}
	if usage, ok := raw["usage"].(map[string]interface{}); ok {
		return intAny(firstNonNil(usage["prompt_tokens"], usage["input_tokens"])), intAny(firstNonNil(usage["completion_tokens"], usage["output_tokens"]))
	}
	return 0, 0
}

func estimateModelCostByCodeWorker(ctx context.Context, pool *pgxpool.Pool, code string, params map[string]interface{}, promptTokens, outputTokens int) float64 {
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT price_rule FROM models WHERE code=$1`, code).Scan(&raw); err != nil {
		return 0
	}
	rule := map[string]interface{}{}
	_ = json.Unmarshal(raw, &rule)
	return estimatePriceRuleCostWorker(rule, params, promptTokens, outputTokens)
}

func estimateModelCostByIDWorker(ctx context.Context, pool *pgxpool.Pool, modelID int64, params map[string]interface{}, promptTokens, outputTokens int) float64 {
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT price_rule FROM models WHERE id=$1`, modelID).Scan(&raw); err != nil {
		return 0
	}
	rule := map[string]interface{}{}
	_ = json.Unmarshal(raw, &rule)
	return estimatePriceRuleCostWorker(rule, params, promptTokens, outputTokens)
}

func estimatePriceRuleCostWorker(rule map[string]interface{}, params map[string]interface{}, promptTokens, outputTokens int) float64 {
	switch stringAny(rule["billing_type"]) {
	case "per_image":
		n := floatAny(params["n"])
		if n <= 0 {
			n = floatAny(params["count"])
		}
		if n <= 0 {
			n = 1
		}
		return floatAny(rule["unit_price"]) * n
	case "per_token":
		if promptTokens <= 0 {
			promptTokens = 500
		}
		if outputTokens <= 0 {
			outputTokens = 1000
		}
		cost := float64(promptTokens)*tokenPriceWorker(rule, "input_price") + float64(outputTokens)*tokenPriceWorker(rule, "output_price")
		if surcharge := floatAny(rule["surcharge_per_m"]); surcharge > 0 {
			cost += float64(promptTokens+outputTokens) / 1_000_000 * surcharge
		}
		return cost
	case "per_second":
		duration := floatAny(params["duration"])
		if duration <= 0 {
			duration = floatAny(params["duration_sec"])
		}
		if duration <= 0 {
			duration = 1
		}
		n := floatAny(params["count"])
		if n <= 0 {
			n = floatAny(params["n"])
		}
		if n <= 0 {
			n = 1
		}
		return floatAny(rule["unit_price"]) * duration * n
	case "per_request":
		return floatAny(rule["unit_price"])
	default:
		return 0
	}
}

func tokenPriceWorker(rule map[string]interface{}, key string) float64 {
	if v := floatAny(rule[key]); v > 0 {
		return v
	}
	if v := floatAny(rule[key+"_per_m"]); v > 0 {
		return v / 1_000_000
	}
	return 0
}

func copyLLMExtraParams(extra map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for k, v := range extra {
		switch strings.ToLower(strings.TrimSpace(k)) {
		case "connection", "model", "messages", "input", "prompt", "stream":
			continue
		default:
			out[k] = v
		}
	}
	return out
}

func extractLLMText(body []byte) string {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return ""
	}
	if s := stringAny(raw["output_text"]); s != "" {
		return s
	}
	if choices, ok := raw["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if msg, ok := choice["message"].(map[string]interface{}); ok {
				if s := stringAny(msg["content"]); s != "" {
					return s
				}
				if parts, ok := msg["content"].([]interface{}); ok {
					items := make([]string, 0, len(parts))
					for _, part := range parts {
						if m, ok := part.(map[string]interface{}); ok {
							items = append(items, firstNonEmpty(stringAny(m["text"]), stringAny(m["content"])))
						}
					}
					return strings.TrimSpace(strings.Join(items, "\n"))
				}
			}
			if s := stringAny(choice["text"]); s != "" {
				return s
			}
		}
	}
	if output, ok := raw["output"].([]interface{}); ok {
		items := []string{}
		for _, item := range output {
			m, _ := item.(map[string]interface{})
			content, _ := m["content"].([]interface{})
			for _, part := range content {
				pm, _ := part.(map[string]interface{})
				items = append(items, firstNonEmpty(stringAny(pm["text"]), stringAny(pm["content"])))
			}
		}
		return strings.TrimSpace(strings.Join(items, "\n"))
	}
	return ""
}

func normalizeAgentAnalysisOutput(text, category string) map[string]interface{} {
	out := parseJSONish(text)
	if len(out) == 0 {
		prompt := strings.TrimSpace(text)
		if prompt == "" {
			prompt = "根据用户需求生成高质量电商商品视觉内容。"
		}
		out = map[string]interface{}{
			"summary":        "AI已生成创作方案，请确认后继续生成。",
			"user_intent":    prompt,
			"style":          "商业电商风格",
			"raw_text":       text,
			"candidates":     []map[string]interface{}{{"id": "A", "title": "默认方案", "reason": "模型返回了非JSON内容，已作为可编辑方案保留。", "prompt": prompt, "negative_prompt": "低清晰度、畸变、错别字、水印"}},
			"recommendation": "A",
		}
	}
	candidates := analysisCandidates(out)
	if len(candidates) == 0 {
		prompt := firstNonEmpty(stringAny(out["generation_prompt"]), stringAny(out["summary"]), strings.TrimSpace(text))
		candidates = []map[string]interface{}{{"id": "A", "title": defaultCandidateTitle(category), "reason": "基于分析内容自动整理。", "prompt": prompt, "negative_prompt": "低清晰度、畸变、错别字、水印"}}
		out["candidates"] = candidates
		out["recommendation"] = "A"
	}
	if stringAny(out["recommendation"]) == "" {
		out["recommendation"] = stringAny(candidates[0]["id"])
	}
	if stringAny(out["generation_prompt"]) == "" {
		out["generation_prompt"] = selectedAnalysisPrompt(out, "")
	}
	out["raw_text"] = text
	return out
}

func defaultCandidateTitle(category string) string {
	if category == "video" {
		return "视频创作方案"
	}
	return "图片创作方案"
}

func analysisCandidates(analysis map[string]interface{}) []map[string]interface{} {
	raw, ok := analysis["candidates"].([]interface{})
	if !ok {
		if arr, ok := analysis["candidates"].([]map[string]interface{}); ok {
			return arr
		}
		return nil
	}
	items := make([]map[string]interface{}, 0, len(raw))
	for idx, item := range raw {
		if m, ok := item.(map[string]interface{}); ok {
			if stringAny(m["id"]) == "" {
				m["id"] = string(rune('A' + idx))
			}
			items = append(items, m)
		}
	}
	return items
}

func selectedAnalysisPrompt(analysis map[string]interface{}, candidateID string) string {
	candidates := analysisCandidates(analysis)
	preferred := firstNonEmpty(candidateID, stringAny(analysis["recommendation"]))
	if preferred != "" {
		for _, item := range candidates {
			if strings.EqualFold(stringAny(item["id"]), preferred) {
				if s := stringAny(item["prompt"]); s != "" {
					return s
				}
			}
		}
	}
	for _, item := range candidates {
		if s := stringAny(item["prompt"]); s != "" {
			return s
		}
	}
	return firstNonEmpty(stringAny(analysis["generation_prompt"]), stringAny(analysis["summary"]), stringAny(analysis["raw_text"]))
}

func mergeAgentGenerationInputs(inputs, analysis map[string]interface{}, candidateID string, confirmed map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for k, v := range inputs {
		out[k] = v
	}
	candidate := selectedAnalysisCandidate(analysis, candidateID)
	if params, ok := candidate["params"].(map[string]interface{}); ok {
		for k, v := range params {
			if strings.HasPrefix(k, "_") {
				continue
			}
			if !hasMeaningfulInput(out, k) {
				out[k] = v
			}
		}
	}
	if s := stringAny(candidate["negative_prompt"]); s != "" {
		out["negative_prompt"] = s
	}
	if params, ok := confirmed["params"].(map[string]interface{}); ok {
		for k, v := range params {
			if strings.HasPrefix(k, "_") {
				continue
			}
			if !hasMeaningfulInput(out, k) {
				out[k] = v
			}
		}
	}
	if s := stringAny(confirmed["negative_prompt"]); s != "" {
		out["negative_prompt"] = s
	}
	return out
}

func hasMeaningfulInput(m map[string]interface{}, key string) bool {
	v, ok := m[key]
	if !ok || v == nil {
		return false
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t) != ""
	case []interface{}:
		return len(t) > 0
	case []string:
		return len(t) > 0
	default:
		return true
	}
}

func selectedAnalysisCandidate(analysis map[string]interface{}, candidateID string) map[string]interface{} {
	candidates := analysisCandidates(analysis)
	preferred := firstNonEmpty(candidateID, stringAny(analysis["recommendation"]))
	if preferred != "" {
		for _, item := range candidates {
			if strings.EqualFold(stringAny(item["id"]), preferred) {
				return item
			}
		}
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return map[string]interface{}{}
}

func runAgentMediaTasks(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, projectID, userID int64, publicID string, runtimeCfg, inputs map[string]interface{}, prompt string) ([]map[string]interface{}, string) {
	modelCode := stringAny(runtimeCfg["generation_model_code"])
	if modelCode == "" {
		return nil, "未配置生成模型"
	}
	genType := firstNonEmpty(stringAny(runtimeCfg["generation_type"]), "image")
	count := intAny(inputs["count"])
	if count <= 0 {
		count = intAny(runtimeCfg["default_count"])
	}
	if count <= 0 {
		count = 1
	}
	if count > 20 {
		count = 20
	}
	var modelID int64
	var requestMode string
	if err := pool.QueryRow(ctx, `SELECT id, request_mode FROM models WHERE code=$1`, modelCode).Scan(&modelID, &requestMode); err != nil {
		return nil, "生成模型不存在：" + modelCode
	}
	taskType := "image"
	if requestMode == "video" || genType == "video" {
		taskType = "video"
	}
	imageURL := firstImageURL(inputs)
	results := make([]map[string]interface{}, 0, count)
	successCount := 0
	firstErr := ""
	for i := 0; i < count; i++ {
		taskNo := newWorkflowTaskNo(i)
		taskInput := agentMediaTaskInput(inputs, prompt, publicID)
		taskInput["count"] = 1
		taskInput["n"] = 1
		if imageURL != "" {
			taskInput["reference_images"] = []string{imageURL}
		}
		taskEstimated := estimateModelCostByIDWorker(ctx, pool, modelID, taskInput, 0, 0)
		inputJSON, _ := json.Marshal(taskInput)
		_, err := pool.Exec(ctx, `
			INSERT INTO tasks (task_no, user_id, model_id, type, status, input, estimated_cost)
			VALUES ($1,$2,$3,$4,'pending',$5,$6)`, taskNo, userID, modelID, taskType, inputJSON, taskEstimated)
		if err != nil {
			if firstErr == "" {
				firstErr = err.Error()
			}
			results = append(results, map[string]interface{}{"task_no": taskNo, "status": "failed", "progress": 100, "error_message": err.Error()})
			continue
		}
		appendWorkflowMediaTask(ctx, pool, projectID, map[string]interface{}{"task_no": taskNo, "status": "pending", "progress": 5, "output": map[string]interface{}{}})
		_ = processImageTask(ctx, pool, baseURL, token, ImageTaskPayload{TaskNo: taskNo, UserID: userID, ModelID: modelID, ModelCode: modelCode, Input: taskInput})
		item := loadAgentMediaTask(ctx, pool, taskNo)
		appendWorkflowMediaTask(ctx, pool, projectID, item)
		if stringAny(item["status"]) == "succeeded" {
			successCount++
		} else if firstErr == "" {
			firstErr = firstNonEmpty(stringAny(item["error_message"]), "生成任务失败")
		}
		results = append(results, item)
	}
	if successCount == 0 {
		return results, firstNonEmpty(firstErr, "生成任务全部失败")
	}
	return results, ""
}

func completeSimpleAgentWorkflow(ctx context.Context, pool *pgxpool.Pool, p WorkflowTaskPayload, publicID string, estimated float64, outputs map[string]interface{}) error {
	saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
	actual := simpleAgentActualCost(ctx, pool, p.ProjectID, outputs)
	pool.Exec(ctx, `
		UPDATE workflow_projects SET status='succeeded', outputs=$1, actual_cost=$2, finished_at=now(), updated_at=now() WHERE id=$3`,
		mustJSON(outputs), actual, p.ProjectID)
	chargeBilling(ctx, pool, p.UserID, estimated, actual, "workflow", publicID, "workflow_usage", "智能体工作流")
	log.Printf("Workflow project %s completed (cost=%.4f)", publicID, actual)
	return nil
}

func runNode(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, userID int64, publicID string, category string, node workflowNode, prompt string, inputs map[string]interface{}) (map[string]interface{}, string) {
	switch node.Type {
	case "llm":
		if strings.TrimSpace(prompt) == "" {
			out, errMsg := runAgentAnalysis(ctx, pool, baseURL, token, node.ModelCode, category, map[string]interface{}{}, inputs)
			if errMsg != "" {
				return nil, errMsg
			}
			if stringAny(out["text"]) == "" {
				out["text"] = firstNonEmpty(stringAny(out["generation_prompt"]), stringAny(out["summary"]), stringAny(out["raw_text"]))
			}
			return out, ""
		}
		body, _ := json.Marshal(map[string]interface{}{
			"model":    node.ModelCode,
			"messages": []map[string]string{{"role": "user", "content": prompt}},
		})
		var result struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if !postJSON(ctx, baseURL+"/v1/chat/completions", token, body, &result) {
			return nil, "模型服务异常"
		}
		text := ""
		if len(result.Choices) > 0 {
			text = result.Choices[0].Message.Content
		}
		return map[string]interface{}{"text": text}, ""
	case "image":
		return runMediaNode(ctx, pool, baseURL, token, userID, publicID, node, prompt, inputs, "image")
	case "video":
		return runMediaNode(ctx, pool, baseURL, token, userID, publicID, node, prompt, inputs, "video")
	default:
		return nil, "未知节点类型"
	}
}

func runMediaNode(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, userID int64, publicID string, node workflowNode, prompt string, inputs map[string]interface{}, fallbackType string) (map[string]interface{}, string) {
	modelCode := strings.TrimSpace(node.ModelCode)
	if modelCode == "" {
		return nil, "未配置生成模型"
	}
	var modelID int64
	var requestMode string
	if err := pool.QueryRow(ctx, `SELECT id, request_mode FROM models WHERE code=$1`, modelCode).Scan(&modelID, &requestMode); err != nil {
		return nil, "生成模型不存在：" + modelCode
	}
	taskType := fallbackType
	if requestMode == "video" || requestMode == "audio" || requestMode == "image" {
		taskType = requestMode
	}
	taskInput := agentMediaTaskInput(inputs, prompt, publicID)
	taskNo := newWorkflowTaskNo(0)
	taskEstimated := estimateModelCostByIDWorker(ctx, pool, modelID, taskInput, 0, 0)
	inputJSON, _ := json.Marshal(taskInput)
	if _, err := pool.Exec(ctx, `
		INSERT INTO tasks (task_no, user_id, model_id, type, status, input, estimated_cost)
		VALUES ($1,$2,$3,$4,'pending',$5,$6)`, taskNo, userID, modelID, taskType, inputJSON, taskEstimated); err != nil {
		return nil, err.Error()
	}
	_ = processImageTask(ctx, pool, baseURL, token, ImageTaskPayload{TaskNo: taskNo, UserID: userID, ModelID: modelID, ModelCode: modelCode, Input: taskInput})
	item := loadAgentMediaTask(ctx, pool, taskNo)
	if stringAny(item["status"]) != "succeeded" {
		if msg := stringAny(item["error_message"]); msg != "" {
			return nil, msg
		}
		return nil, "生成任务失败"
	}
	out, _ := item["output"].(map[string]interface{})
	if out == nil {
		return nil, "生成完成但未返回结果"
	}
	out["_task_no"] = taskNo
	return out, ""
}

func agentMediaTaskInput(inputs map[string]interface{}, prompt, publicID string) map[string]interface{} {
	taskInput := map[string]interface{}{}
	for k, v := range inputs {
		if strings.HasPrefix(k, "_") || k == "prompt" || k == "product" || k == "input" || k == "description" || k == "requirement" {
			continue
		}
		taskInput[k] = v
	}
	taskInput["prompt"] = prompt
	taskInput["_skip_billing"] = true
	taskInput["_workflow_project"] = publicID
	if _, ok := taskInput["count"]; !ok {
		taskInput["count"] = 1
	}
	if _, ok := taskInput["n"]; !ok {
		taskInput["n"] = taskInput["count"]
	}
	imageURL := firstImageURL(inputs)
	if imageURL != "" {
		if _, ok := taskInput["reference_images"]; !ok {
			taskInput["reference_images"] = []string{imageURL}
		}
		if _, ok := taskInput["image_url"]; !ok {
			taskInput["image_url"] = imageURL
		}
	}
	return taskInput
}

func appendWorkflowMediaTask(ctx context.Context, pool *pgxpool.Pool, projectID int64, item map[string]interface{}) {
	if stringAny(item["task_no"]) == "" {
		return
	}
	outputs := loadWorkflowOutputs(ctx, pool, projectID)
	raw, _ := outputs["media_tasks"].([]interface{})
	next := make([]interface{}, 0, len(raw)+1)
	replaced := false
	for _, existing := range raw {
		m, _ := existing.(map[string]interface{})
		if stringAny(m["task_no"]) == stringAny(item["task_no"]) {
			next = append(next, item)
			replaced = true
		} else {
			next = append(next, existing)
		}
	}
	if !replaced {
		next = append(next, item)
	}
	outputs["media_tasks"] = next
	outputs["current_step"] = "generate"
	saveWorkflowOutputs(ctx, pool, projectID, outputs)
}

func postJSON(ctx context.Context, url, token string, body []byte, out interface{}) bool {
	req, _ := http.NewRequestWithContext(ctx, "POST", url, jsonReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return false
	}
	return json.NewDecoder(resp.Body).Decode(out) == nil
}

func renderTemplate(tpl string, vars map[string]string) string {
	out := tpl
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{{"+k+"}}", v)
	}
	return out
}

func insertWorkflowNodeRun(ctx context.Context, pool *pgxpool.Pool, projectID int64, nodeID, name, typ string, input map[string]interface{}, seq int) int64 {
	var nodeRunID int64
	pool.QueryRow(ctx, `
		INSERT INTO workflow_node_runs (project_id, node_id, name, type, status, input, seq)
		VALUES ($1,$2,$3,$4,'running',$5,$6) RETURNING id`,
		projectID, nodeID, name, typ, mustJSON(input), seq).Scan(&nodeRunID)
	return nodeRunID
}

func updateNodeRunSuccess(ctx context.Context, pool *pgxpool.Pool, nodeRunID int64, output map[string]interface{}, cost float64, duration int) {
	pool.Exec(ctx, `UPDATE workflow_node_runs SET status='succeeded', output=$1, cost=$2, duration_ms=$3 WHERE id=$4`,
		mustJSON(output), cost, duration, nodeRunID)
}

func loadWorkflowOutputs(ctx context.Context, pool *pgxpool.Pool, projectID int64) map[string]interface{} {
	var raw []byte
	out := map[string]interface{}{}
	if err := pool.QueryRow(ctx, `SELECT outputs FROM workflow_projects WHERE id=$1`, projectID).Scan(&raw); err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	if out == nil {
		out = map[string]interface{}{}
	}
	return out
}

func saveWorkflowOutputs(ctx context.Context, pool *pgxpool.Pool, projectID int64, outputs map[string]interface{}) {
	pool.Exec(ctx, `UPDATE workflow_projects SET outputs=$1, updated_at=now() WHERE id=$2`, mustJSON(outputs), projectID)
}

func loadAgentMediaTask(ctx context.Context, pool *pgxpool.Pool, taskNo string) map[string]interface{} {
	var status string
	var outputRaw []byte
	var errMsg *string
	var estimatedCost, actualCost float64
	if err := pool.QueryRow(ctx, `SELECT status, output, error_message, estimated_cost, actual_cost FROM tasks WHERE task_no=$1`, taskNo).Scan(&status, &outputRaw, &errMsg, &estimatedCost, &actualCost); err != nil {
		return map[string]interface{}{"task_no": taskNo, "status": "failed", "progress": 100, "error_message": err.Error()}
	}
	output := map[string]interface{}{}
	_ = json.Unmarshal(outputRaw, &output)
	progress := latestTaskEventProgress(ctx, pool, taskNo, status)
	if status == "succeeded" || status == "failed" {
		progress = 100
	}
	item := map[string]interface{}{"task_no": taskNo, "status": status, "progress": progress, "output": output, "estimated_cost": estimatedCost, "actual_cost": actualCost}
	if errMsg != nil && *errMsg != "" {
		item["error_message"] = *errMsg
	}
	return item
}

func latestTaskEventProgress(ctx context.Context, pool *pgxpool.Pool, taskNo, status string) int {
	var progress int
	err := pool.QueryRow(ctx, `
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

func parseJSONish(text string) map[string]interface{} {
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)
	out := map[string]interface{}{}
	if json.Unmarshal([]byte(text), &out) == nil {
		return out
	}
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start >= 0 && end > start {
		_ = json.Unmarshal([]byte(text[start:end+1]), &out)
	}
	return out
}

func firstUserPrompt(inputs map[string]interface{}) string {
	for _, key := range []string{"prompt", "product", "input", "description", "requirement"} {
		if s := stringAny(inputs[key]); s != "" {
			return s
		}
	}
	return ""
}

func firstImageURL(inputs map[string]interface{}) string {
	for _, key := range []string{"image_url", "product_image", "reference_image"} {
		if s := stringAny(inputs[key]); s != "" {
			return s
		}
	}
	for _, key := range []string{"reference_images", "images"} {
		switch v := inputs[key].(type) {
		case []interface{}:
			if len(v) > 0 {
				return stringAny(v[0])
			}
		case []string:
			if len(v) > 0 {
				return strings.TrimSpace(v[0])
			}
		}
	}
	return ""
}

func newWorkflowTaskNo(i int) string {
	return fmt.Sprintf("task_%d_wf%02d", time.Now().UnixNano(), i+1)
}

func mustJSON(v interface{}) []byte {
	b, _ := json.Marshal(v)
	return b
}

func mapAny(v interface{}) (map[string]interface{}, bool) {
	m, ok := v.(map[string]interface{})
	return m, ok && m != nil
}

func mapAnyOr(v interface{}, fallback map[string]interface{}) map[string]interface{} {
	if m, ok := mapAny(v); ok {
		return m
	}
	return fallback
}

func stringAny(v interface{}) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case float64:
		return strings.TrimSpace(strconv.FormatFloat(t, 'f', -1, 64))
	case int:
		return strconv.Itoa(t)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		if v == nil {
			return ""
		}
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func boolAny(v interface{}) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(strings.TrimSpace(t), "true") || strings.TrimSpace(t) == "1"
	default:
		return false
	}
}

func intAny(v interface{}) int {
	switch t := v.(type) {
	case int:
		return t
	case float64:
		return int(t)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(t))
		return n
	default:
		return 0
	}
}

func floatAny(v interface{}) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return f
	default:
		return 0
	}
}

func firstNonNil(values ...interface{}) interface{} {
	for _, v := range values {
		if v != nil {
			return v
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func failWorkflow(ctx context.Context, pool *pgxpool.Pool, p WorkflowTaskPayload, publicID string, estimated float64, msg string) error {
	pool.Exec(ctx, `UPDATE workflow_projects SET status='failed', error_message=$1, finished_at=now(), updated_at=now() WHERE id=$2`, msg, p.ProjectID)
	unfreezeBilling(ctx, pool, p.UserID, estimated, "workflow", publicID)
	log.Printf("Workflow project %s failed: %s", publicID, msg)
	return nil
}
