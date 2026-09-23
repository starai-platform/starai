package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// processNovelWorkshopWorkflow 处理AI小说工坊工作流
func processNovelWorkshopWorkflow(
	ctx context.Context,
	pool *pgxpool.Pool,
	baseURL, token string,
	p WorkflowTaskPayload,
	publicID string,
	workflowID int64,
	category string,
	estimated float64,
	inputs map[string]interface{},
	runtimeCfg map[string]interface{},
) error {
	outputs := loadWorkflowOutputs(ctx, pool, p.ProjectID)
	autopilot := boolAny(outputs["autopilot"]) || stringAny(inputs["_mode"]) == "auto"

	pool.Exec(ctx, `UPDATE workflow_projects SET status='running', started_at=COALESCE(started_at, now()), updated_at=now() WHERE id=$1 AND status IN ('pending','running')`, p.ProjectID)

	// 阶段1: 故事策划（Planning）
	planning, ok := mapAny(outputs["planning"])
	if !ok {
		nodeRunID := insertWorkflowNodeRun(ctx, pool, p.ProjectID, "planning", "故事策划", "llm", map[string]interface{}{"inputs": inputs}, 0)
		start := time.Now()
		out, errMsg := runNovelPlanning(ctx, pool, baseURL, token, p.ProjectID, runtimeCfg, inputs)
		duration := int(time.Since(start).Milliseconds())
		if errMsg != "" {
			pool.Exec(ctx, `UPDATE workflow_node_runs SET status='failed', error=$1, duration_ms=$2 WHERE id=$3`, errMsg, duration, nodeRunID)
			return failWorkflow(ctx, pool, p, publicID, estimated, "故事策划失败："+errMsg)
		}
		planning = out
		updateNodeRunSuccess(ctx, pool, nodeRunID, out, floatAny(out["_planning_cost"]), duration)
		outputs["planning"] = out
		outputs["current_stage"] = "planning_confirm"
		outputs["autopilot"] = autopilot
		saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
		if stopped, stopErr := stopWorkflowIfRequested(ctx, pool, p, publicID, estimated); stopped {
			return stopErr
		}

		// 如果不是自动托管模式，暂停等待用户确认；
		// 逐步确认模式按步骤分段扣费：策划完成先扣策划这一步的费用。
		if !autopilot {
			if err := chargeStepBilling(ctx, pool, p.UserID, p.ProjectID, publicID, workflowActualCost(ctx, pool, p.ProjectID, outputs)); err != nil {
				log.Printf("Novel project %s planning step billing failed: %v", publicID, err)
			}
			pool.Exec(ctx, `UPDATE workflow_projects SET status='waiting_confirm', updated_at=now() WHERE id=$1 AND status='running'`, p.ProjectID)
			return nil
		}
	}

	// 检查是否有用户确认的修改。前端会把大纲作为 JSON 对象回传，
	// 兼容对象与字符串两种形态；批次继续确认的 payload 为空时直接跳过。
	if confirmed := mapAnyOr(outputs["confirmation_payload"], map[string]interface{}{}); confirmed["outline"] != nil {
		if outlineMap, ok := mapAny(confirmed["outline"]); ok && len(outlineMap) > 0 {
			planning["outline"] = outlineMap
			outputs["planning"] = planning
			saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
		} else if outlineText := stringAny(confirmed["outline"]); outlineText != "" {
			planning["outline"] = outlineText
			outputs["planning"] = planning
			saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
		}
	}

	// 提取章节列表
	outline := mapAnyOr(planning["outline"], map[string]interface{}{})
	volumes := volumesFromOutline(outline)
	if len(volumes) == 0 {
		// Models occasionally return arrays as JSON strings or typed []map values.
		// Normalize those shapes before failing; use a minimal safe outline as a last resort.
		fallback := fallbackNovelPlanning(firstUserPrompt(inputs), stringAny(inputs["genre"]), stringAny(inputs["word_count_target"]), stringAny(inputs["style"]))
		fallbackOutline := mapAnyOr(fallback["outline"], map[string]interface{}{})
		volumes = volumesFromOutline(fallbackOutline)
		if len(volumes) == 0 {
			return failWorkflow(ctx, pool, p, publicID, estimated, "大纲中没有有效的章节")
		}
		planning["outline"] = fallbackOutline
		outputs["planning"] = planning
		saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
	}

	// 计算总章节数
	totalChapters := 0
	for _, vol := range volumes {
		totalChapters += len(chapterMaps(vol["chapters"]))
	}
	outputs["total_chapters"] = totalChapters
	outputs["current_chapter"] = intAny(outputs["current_chapter"])

	// 阶段2-4: 逐章创作循环
	chapters := chaptersSlice(outputs["chapters"])
	settingLedger := mapAnyOr(planning["setting_ledger"], map[string]interface{}{})
	batchSize := intAny(runtimeCfg["batch_size"])
	if batchSize <= 0 {
		batchSize = 10
	}

	currentChapter := len(chapters)
	allChapters := flattenChapters(volumes)

	for currentChapter < len(allChapters) {
		if stopped, stopErr := stopWorkflowIfRequested(ctx, pool, p, publicID, estimated); stopped {
			return stopErr
		}
		chapterInfo := allChapters[currentChapter]
		chapterNumber := currentChapter + 1

		// 节点2: 章节创作
		writeNodeID := insertWorkflowNodeRun(ctx, pool, p.ProjectID,
			fmt.Sprintf("write_chapter_%d", chapterNumber),
			fmt.Sprintf("创作第%d章", chapterNumber),
			"llm",
			map[string]interface{}{"chapter": chapterInfo},
			currentChapter*3)

		start := time.Now()
		previousSummary := ""
		if currentChapter > 0 {
			previousSummary = stringAny(chapters[currentChapter-1]["summary"])
		}

		rawContent, writeCost, errMsg := runNovelChapterWriting(
			ctx, pool, baseURL, token, p.ProjectID,
			runtimeCfg, inputs, chapterInfo, chapterNumber,
			previousSummary, settingLedger,
		)
		writeDuration := int(time.Since(start).Milliseconds())

		if errMsg != "" {
			pool.Exec(ctx, `UPDATE workflow_node_runs SET status='failed', error=$1, duration_ms=$2 WHERE id=$3`, errMsg, writeDuration, writeNodeID)
			outputs["current_chapter"] = currentChapter
			saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
			return failWorkflow(ctx, pool, p, publicID, estimated, fmt.Sprintf("第%d章创作失败：%s", chapterNumber, errMsg))
		}
		updateNodeRunSuccess(ctx, pool, writeNodeID, map[string]interface{}{"raw_content": rawContent}, writeCost, writeDuration)

		// 节点3: 润色审校
		polishNodeID := insertWorkflowNodeRun(ctx, pool, p.ProjectID,
			fmt.Sprintf("polish_chapter_%d", chapterNumber),
			fmt.Sprintf("润色第%d章", chapterNumber),
			"llm",
			map[string]interface{}{"raw_content": truncateText(rawContent, 200)},
			currentChapter*3+1)

		start = time.Now()
		polishedContent, consistencyCheck, ledgerUpdates, polishCost, errMsg := runNovelChapterPolishing(
			ctx, pool, baseURL, token, p.ProjectID,
			runtimeCfg, inputs, rawContent, chapterNumber, settingLedger,
		)
		polishDuration := int(time.Since(start).Milliseconds())

		if errMsg != "" {
			pool.Exec(ctx, `UPDATE workflow_node_runs SET status='failed', error=$1, duration_ms=$2 WHERE id=$3`, errMsg, polishDuration, polishNodeID)
			outputs["current_chapter"] = currentChapter
			saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
			return failWorkflow(ctx, pool, p, publicID, estimated, fmt.Sprintf("第%d章润色失败：%s", chapterNumber, errMsg))
		}
		updateNodeRunSuccess(ctx, pool, polishNodeID, map[string]interface{}{
			"polished_content":  truncateText(polishedContent, 200),
			"consistency_check": consistencyCheck,
		}, polishCost, polishDuration)

		// 节点4: 档案更新
		archiveNodeID := insertWorkflowNodeRun(ctx, pool, p.ProjectID,
			fmt.Sprintf("archive_chapter_%d", chapterNumber),
			fmt.Sprintf("更新档案%d", chapterNumber),
			"llm",
			map[string]interface{}{"chapter_number": chapterNumber},
			currentChapter*3+2)

		start = time.Now()
		chapterSummary, updatedLedger, wordCount, archiveCost, errMsg := runNovelChapterArchiving(
			ctx, pool, baseURL, token, p.ProjectID,
			runtimeCfg, inputs, polishedContent, chapterNumber, settingLedger, ledgerUpdates,
		)
		archiveDuration := int(time.Since(start).Milliseconds())

		if errMsg != "" {
			pool.Exec(ctx, `UPDATE workflow_node_runs SET status='failed', error=$1, duration_ms=$2 WHERE id=$3`, errMsg, archiveDuration, archiveNodeID)
			// 档案更新失败不阻断流程，使用默认值
			chapterSummary = fmt.Sprintf("第%d章内容", chapterNumber)
			updatedLedger = settingLedger
			wordCount = len([]rune(polishedContent))
		} else {
			updateNodeRunSuccess(ctx, pool, archiveNodeID, map[string]interface{}{
				"summary":    chapterSummary,
				"word_count": wordCount,
			}, archiveCost, archiveDuration)
			settingLedger = updatedLedger
		}

		// 保存章节
		chapter := map[string]interface{}{
			"chapter_number":    chapterNumber,
			"title":             stringAny(chapterInfo["title"]),
			"raw_content":       rawContent,
			"polished_content":  polishedContent,
			"summary":           chapterSummary,
			"word_count":        wordCount,
			"consistency_check": consistencyCheck,
			"status":            "completed",
			"created_at":        time.Now().Format(time.RFC3339),
		}
		chapters = append(chapters, chapter)
		currentChapter++

		outputs["chapters"] = chapters
		outputs["current_chapter"] = currentChapter
		outputs["setting_ledger"] = settingLedger
		saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
		if stopped, stopErr := stopWorkflowIfRequested(ctx, pool, p, publicID, estimated); stopped {
			return stopErr
		}

		// 每完成batch_size章或完成一卷，暂停确认（如果不是自动托管）；
		// 分段扣费：已完成的这批章节先结算，剩余冻结继续担保后续章节。
		if !autopilot && (currentChapter%batchSize == 0 || isVolumeEnd(currentChapter, volumes)) {
			outputs["current_stage"] = "batch_confirm"
			saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
			if err := chargeStepBilling(ctx, pool, p.UserID, p.ProjectID, publicID, workflowActualCost(ctx, pool, p.ProjectID, outputs)); err != nil {
				log.Printf("Novel project %s batch step billing failed: %v", publicID, err)
			}
			pool.Exec(ctx, `UPDATE workflow_projects SET status='waiting_confirm', updated_at=now() WHERE id=$1 AND status='running'`, p.ProjectID)
			return nil
		}
	}

	// 全部完成
	outputs["current_stage"] = "completed"
	saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)

	return completeNovelWorkflow(ctx, pool, p, publicID, estimated, outputs)
}

// runNovelPlanning 执行故事策划
func runNovelPlanning(
	ctx context.Context,
	pool *pgxpool.Pool,
	baseURL, token string,
	workflowProjectID int64,
	runtimeCfg, inputs map[string]interface{},
) (map[string]interface{}, string) {
	modelCode := firstNonEmpty(
		stringAny(inputs["model_code"]),
		stringAny(runtimeCfg["analysis_model_code"]),
		stringAny(runtimeCfg["generation_model_code"]),
		"chat_demo_v1",
	)

	model, errMsg := loadAgentAnalysisModel(ctx, pool, modelCode)
	if errMsg != "" {
		return nil, errMsg
	}

	genre := stringAny(inputs["genre"])
	wordCount := stringAny(inputs["word_count_target"])
	style := stringAny(inputs["style"])
	userPrompt := firstUserPrompt(inputs)
	languageRule := novelLanguageRule(inputs)
	structure := novelStructureRequirement(inputs)

	system := buildNovelPlanningSystemPrompt(genre, wordCount, style, structure, languageRule)
	user := fmt.Sprintf("用户创意：%s\n题材：%s\n目标字数：%s\n文风：%s\n\n请按要求输出完整的故事规划JSON。",
		userPrompt, genre, wordCount, style)

	requestID := fmt.Sprintf("novel_planning_%d", workflowProjectID)
	result, err := executeWorkerLLMWithRoutes(ctx, pool, baseURL, token, requestID, model, system, user, 0.7, 120*time.Second)
	if err != nil {
		return nil, "模型服务异常：" + err.Error()
	}

	text := extractLLMText(result.ResponseBody)
	if strings.TrimSpace(text) == "" {
		return nil, "模型未返回故事规划内容"
	}

	out := parseJSONish(text)
	if len(out) == 0 {
		// 降级处理：构造基础大纲
		out = fallbackNovelPlanning(userPrompt, genre, wordCount, style)
	}

	pt, ct, crt, cwt := chatUsageTokenDetails(result.ResponseBody)
	out["_planning_cost"] = estimateModelCostByCodeWorker(ctx, pool, modelCode, result.RequestBody, pt, ct, crt, cwt)
	out["_provider_cost"] = workerRouteProviderCost(result.Route, result.RequestBody, pt, ct, crt, cwt)
	out["_route_id"] = nullableRouteID(result.Route.ID)
	out["raw_text"] = text

	return out, ""
}

// buildNovelPlanningSystemPrompt 构建故事策划的system prompt
func buildNovelPlanningSystemPrompt(genre, wordCount, style, structure, languageRule string) string {
	languageLine := ""
	if languageRule != "" {
		languageLine = "\n6. 语言要求：" + languageRule
	}
	return fmt.Sprintf(`你是一位资深网文总编和故事策划专家。
任务：为一部%s的%s小说制定完整规划。

输出JSON格式（不要markdown代码块）：
{
  "title": "小说标题",
  "core_concept": "核心设定与卖点",
  "world_setting": "世界观设定",
  "characters": [
    {"name":"角色名","role":"主角/配角","personality":"性格特点","background":"背景"}
  ],
  "outline": {
    "volumes": [
      {
        "volume_number": 1,
        "volume_title": "卷名",
        "chapters": [
          {"chapter_number":1,"title":"章节标题","summary":"梗概（150字左右）","target_words":3000}
        ]
      }
    ]
  },
  "setting_ledger": {
    "timeline": "时间线说明",
    "key_locations": ["地点1","地点2"],
    "power_system": "力量体系/规则（%s题材特有）"
  }
}

规划要求：
1. 篇幅结构：%s
2. 设定要自洽，为后续创作留清晰框架
3. 章节梗概要具体，包含关键情节和转折
4. 人物设定要鲜明，主配角3-5人即可
5. 文风：%s%s`, wordCount, genre, genre, structure, style, languageLine)
}

// runNovelChapterWriting 执行章节创作
func runNovelChapterWriting(
	ctx context.Context,
	pool *pgxpool.Pool,
	baseURL, token string,
	workflowProjectID int64,
	runtimeCfg, inputs map[string]interface{},
	chapterInfo map[string]interface{},
	chapterNumber int,
	previousSummary string,
	settingLedger map[string]interface{},
) (string, float64, string) {
	modelCode := firstNonEmpty(
		stringAny(inputs["model_code"]),
		stringAny(runtimeCfg["generation_model_code"]),
		"chat_demo_v1",
	)

	model, errMsg := loadAgentAnalysisModel(ctx, pool, modelCode)
	if errMsg != "" {
		return "", 0, errMsg
	}

	genre := stringAny(inputs["genre"])
	style := stringAny(inputs["style"])
	chapterTitle := stringAny(chapterInfo["title"])
	chapterSummary := stringAny(chapterInfo["summary"])
	targetWords := intAny(chapterInfo["target_words"])
	if targetWords <= 0 {
		targetWords = 3000
	}

	system := fmt.Sprintf(`你是一位专业的%s题材网文写手。
文风要求：%s
当前任务：撰写第%d章正文

创作要求：
1. 严格遵循章节梗概，不偏离主线
2. 对照设定台账，确保人物状态、时间线一致
3. 控制字数在%d±500字范围
4. %s题材的节奏感和代入感
5. 避免套话，多用动作、对话、细节描写
6. 直接输出章节正文，不要前言后语、不要总结`, genre, style, chapterNumber, targetWords, genre)
	if languageRule := novelLanguageRule(inputs); languageRule != "" {
		system += "\n7. 语言要求：" + languageRule
	}

	ledgerJSON := boundedJSON(settingLedger, 8000)
	user := fmt.Sprintf(`章节标题：%s
章节梗概：%s
目标字数：%d字

上下文信息：
前文摘要：%s
设定台账：%s

	请开始创作：`, chapterTitle, truncateText(chapterSummary, 3000), targetWords, truncateText(previousSummary, 1600), ledgerJSON)

	requestID := fmt.Sprintf("novel_write_%d_ch%d", workflowProjectID, chapterNumber)
	result, err := executeWorkerLLMWithRoutes(ctx, pool, baseURL, token, requestID, model, system, user, 0.8, 180*time.Second)
	if err != nil {
		return "", 0, "模型服务异常：" + err.Error()
	}

	content := extractLLMText(result.ResponseBody)
	if strings.TrimSpace(content) == "" {
		return "", 0, "模型未返回章节内容"
	}

	pt, ct, crt, cwt := chatUsageTokenDetails(result.ResponseBody)
	cost := estimateModelCostByCodeWorker(ctx, pool, modelCode, result.RequestBody, pt, ct, crt, cwt)

	return content, cost, ""
}

// runNovelChapterPolishing 执行章节润色审校
func runNovelChapterPolishing(
	ctx context.Context,
	pool *pgxpool.Pool,
	baseURL, token string,
	workflowProjectID int64,
	runtimeCfg, inputs map[string]interface{},
	rawContent string,
	chapterNumber int,
	settingLedger map[string]interface{},
) (string, map[string]interface{}, map[string]interface{}, float64, string) {
	modelCode := firstNonEmpty(
		stringAny(inputs["model_code"]),
		stringAny(runtimeCfg["generation_model_code"]),
		"chat_demo_v1",
	)

	model, errMsg := loadAgentAnalysisModel(ctx, pool, modelCode)
	if errMsg != "" {
		return "", nil, nil, 0, errMsg
	}

	style := stringAny(inputs["style"])
	ledgerJSON := boundedJSON(settingLedger, 8000)

	system := fmt.Sprintf(`你是文学润色师和审校员，负责提升文字质量并把关设定一致性。

润色要求：
1. 保持情节和对话不变，只优化语言表达
2. 替换套话、重复表达
3. 增强画面感和节奏
4. 统一文风：%s

审校要求：
1. 检查人物状态是否与台账一致
2. 检查时间线逻辑
3. 检查是否提前泄露后续情节

输出JSON（不要markdown代码块）：
{
  "polished_content": "润色后正文",
  "consistency_check": {
    "issues": ["问题1","问题2"],
    "status": "通过/需修正"
  },
  "ledger_updates": {
    "character_states": {"角色名":"新状态"},
    "timeline": "本章时间点",
    "new_elements": ["本章新增的地点/物品"]
  }
}`, style)
	if languageRule := novelLanguageRule(inputs); languageRule != "" {
		system += "\n5. 语言要求：" + languageRule + "（润色不得改变原文语言）"
	}

	user := fmt.Sprintf(`任务：润色并审校第%d章

原始正文：
%s

设定台账：
%s

	请输出JSON：`, chapterNumber, truncateText(rawContent, 24000), ledgerJSON)

	requestID := fmt.Sprintf("novel_polish_%d_ch%d", workflowProjectID, chapterNumber)
	result, err := executeWorkerLLMWithRoutes(ctx, pool, baseURL, token, requestID, model, system, user, 0.5, 180*time.Second)
	if err != nil {
		return "", nil, nil, 0, "模型服务异常：" + err.Error()
	}

	text := extractLLMText(result.ResponseBody)
	out := parseJSONish(text)

	polishedContent := stringAny(out["polished_content"])
	if polishedContent == "" {
		// 降级：使用原文
		polishedContent = rawContent
	}

	consistencyCheck := mapAnyOr(out["consistency_check"], map[string]interface{}{
		"status": "通过",
		"issues": []string{},
	})
	ledgerUpdates := mapAnyOr(out["ledger_updates"], map[string]interface{}{})

	pt, ct, crt, cwt := chatUsageTokenDetails(result.ResponseBody)
	cost := estimateModelCostByCodeWorker(ctx, pool, modelCode, result.RequestBody, pt, ct, crt, cwt)

	return polishedContent, consistencyCheck, ledgerUpdates, cost, ""
}

// runNovelChapterArchiving 执行档案更新
func runNovelChapterArchiving(
	ctx context.Context,
	pool *pgxpool.Pool,
	baseURL, token string,
	workflowProjectID int64,
	runtimeCfg map[string]interface{},
	inputs map[string]interface{},
	polishedContent string,
	chapterNumber int,
	currentLedger, ledgerUpdates map[string]interface{},
) (string, map[string]interface{}, int, float64, string) {
	modelCode := firstNonEmpty(
		stringAny(inputs["model_code"]),
		stringAny(runtimeCfg["generation_model_code"]),
		"chat_demo_v1",
	)

	model, errMsg := loadAgentAnalysisModel(ctx, pool, modelCode)
	if errMsg != "" {
		return "", nil, 0, 0, errMsg
	}

	ledgerJSON := boundedJSON(currentLedger, 8000)
	updatesJSON := boundedJSON(ledgerUpdates, 4000)

	system := `你是档案员，负责维护设定台账的准确性。

输出JSON（不要markdown代码块）：
{
  "chapter_summary": "本章100字摘要，供后续章节参考",
  "updated_ledger": {
    "characters": [{"name":"角色名","current_state":"当前状态","location":"位置"}],
    "timeline": "更新后的时间线",
    "plot_progress": "情节进展到哪里"
  },
  "word_count": 3245
}`

	user := fmt.Sprintf(`任务：更新第%d章的档案信息

章节内容：
%s

当前台账：
%s

本章更新：
%s

	请输出JSON：`, chapterNumber, truncateText(polishedContent, 6000), ledgerJSON, updatesJSON)

	requestID := fmt.Sprintf("novel_archive_%d_ch%d", workflowProjectID, chapterNumber)
	result, err := executeWorkerLLMWithRoutes(ctx, pool, baseURL, token, requestID, model, system, user, 0.3, 60*time.Second)
	if err != nil {
		return "", nil, 0, 0, "模型服务异常：" + err.Error()
	}

	text := extractLLMText(result.ResponseBody)
	out := parseJSONish(text)

	summary := stringAny(out["chapter_summary"])
	if summary == "" {
		summary = fmt.Sprintf("第%d章内容", chapterNumber)
	}

	updatedLedger := mapAnyOr(out["updated_ledger"], currentLedger)
	wordCount := intAny(out["word_count"])
	if wordCount <= 0 {
		wordCount = len([]rune(polishedContent))
	}

	pt, ct, crt, cwt := chatUsageTokenDetails(result.ResponseBody)
	cost := estimateModelCostByCodeWorker(ctx, pool, modelCode, result.RequestBody, pt, ct, crt, cwt)

	return summary, updatedLedger, wordCount, cost, ""
}

// completeNovelWorkflow 完成小说工作流
func completeNovelWorkflow(
	ctx context.Context,
	pool *pgxpool.Pool,
	p WorkflowTaskPayload,
	publicID string,
	estimated float64,
	outputs map[string]interface{},
) error {
	if stopped, stopErr := stopWorkflowIfRequested(ctx, pool, p, publicID, estimated); stopped {
		return stopErr
	}
	totalCost := workflowActualCost(ctx, pool, p.ProjectID, outputs)
	totalCost = agentConfirmedWorkflowCost(ctx, pool, p.ProjectID, totalCost)
	chargeCost := incrementalWorkflowCharge(ctx, pool, p.ProjectID, totalCost)

	if err := chargeBillingWithFinalize(ctx, pool, p.UserID, estimated, chargeCost, "workflow", publicID, "workflow_usage", "AI小说工坊", func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE workflow_projects SET
				status=CASE WHEN status='canceling' THEN 'canceled' ELSE 'succeeded' END,
				outputs=$1, actual_cost=$2,
				error_message=CASE WHEN status='canceling' THEN '用户已停止，已完成内容已保留' ELSE NULL END,
				finished_at=now(), updated_at=now()
			WHERE id=$3 AND status IN ('running','canceling')`,
			mustJSON(outputs), totalCost, p.ProjectID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return fmt.Errorf("workflow is no longer running")
		}
		return nil
	}); err != nil {
		return fmt.Errorf("workflow %s billing/finalize: %w", publicID, err)
	}

	log.Printf("Novel workflow project %s completed (chapters=%d, cost=%.4f)",
		publicID, intAny(outputs["current_chapter"]), totalCost)
	return nil
}

// 辅助函数

// novelLanguageRule 根据用户选择的生成语言返回写作语言约束；
// 中文为默认语言不额外约束，避免浪费 token。
func novelLanguageRule(inputs map[string]interface{}) string {
	code := stringAny(inputs["language"])
	if code == "" || code == "zh-CN" {
		return ""
	}
	label := firstNonEmpty(stringAny(inputs["language_label"]), stringAny(inputs["language_name"]))
	if label == "" {
		switch code {
		case "en-US":
			label = "English"
		case "ja-JP":
			label = "日本語"
		case "ko-KR":
			label = "한국어"
		case "vi-VN":
			label = "Tiếng Việt"
		default:
			label = code
		}
	}
	return fmt.Sprintf("全书必须全程使用%s写作（包括标题、正文与人物对话），不得混用其他语言。", label)
}

// novelStructureRequirement 把目标篇幅换算成大纲的卷/章结构要求，
// 避免短篇也被要求规划 3-5 卷。
func novelStructureRequirement(inputs map[string]interface{}) string {
	switch stringAny(inputs["length_code"]) {
	case "short":
		return "全书规划为1卷，共8-12章，每章2000-3000字，总字数控制在3万字以内"
	case "long":
		return "全书规划为3-5卷，每卷15-25章，每章3000-5000字，总字数50万字以上"
	default:
		return "全书规划为2-3卷，每卷15-20章，每章2500-4000字，总字数约15万字"
	}
}

func fallbackNovelPlanning(userPrompt, genre, wordCount, style string) map[string]interface{} {
	return map[string]interface{}{
		"title":         "未命名小说",
		"core_concept":  userPrompt,
		"world_setting": fmt.Sprintf("%s题材世界观", genre),
		"characters": []map[string]interface{}{
			{"name": "主角", "role": "主角", "personality": "待定", "background": "待定"},
		},
		"outline": map[string]interface{}{
			"volumes": []map[string]interface{}{
				{
					"volume_number": 1,
					"volume_title":  "第一卷",
					"chapters": []map[string]interface{}{
						{"chapter_number": 1, "title": "第一章", "summary": userPrompt, "target_words": 3000},
						{"chapter_number": 2, "title": "第二章", "summary": "情节展开", "target_words": 3000},
						{"chapter_number": 3, "title": "第三章", "summary": "初步结局", "target_words": 3000},
					},
				},
			},
		},
		"setting_ledger": map[string]interface{}{
			"timeline":      "待定",
			"key_locations": []string{"主要场景"},
			"power_system":  "待定",
		},
	}
}

func volumesFromOutline(outline map[string]interface{}) []map[string]interface{} {
	value := outline["volumes"]
	if text, ok := value.(string); ok {
		value = parseJSONish(text)["volumes"]
	}
	return chapterMaps(value)
}

func flattenChapters(volumes []map[string]interface{}) []map[string]interface{} {
	var all []map[string]interface{}
	for _, vol := range volumes {
		all = append(all, chapterMaps(vol["chapters"])...)
	}
	return all
}

func chapterMaps(value interface{}) []map[string]interface{} {
	if value == nil {
		return nil
	}
	if text, ok := value.(string); ok {
		value = parseJSONish(text)
		if nested, ok := value.(map[string]interface{}); ok {
			value = nested["chapters"]
		}
	}
	if items, ok := value.([]map[string]interface{}); ok {
		return items
	}
	if items, ok := value.([]interface{}); ok {
		result := make([]map[string]interface{}, 0, len(items))
		for _, item := range items {
			if m, ok := item.(map[string]interface{}); ok {
				result = append(result, m)
			}
		}
		return result
	}
	return nil
}

func chaptersSlice(raw interface{}) []map[string]interface{} {
	arr, ok := raw.([]interface{})
	if !ok {
		return []map[string]interface{}{}
	}
	result := make([]map[string]interface{}, 0, len(arr))
	for _, item := range arr {
		if m, ok := item.(map[string]interface{}); ok {
			result = append(result, m)
		}
	}
	return result
}

// boundedJSON keeps the rolling setting context below the model's request limit.
// The full state remains persisted in project outputs; prompts only need its latest compact view.
func boundedJSON(value interface{}, maxChars int) string {
	b, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return truncateText(string(b), maxChars)
}

func isVolumeEnd(currentChapter int, volumes []map[string]interface{}) bool {
	accumulated := 0
	for _, vol := range volumes {
		accumulated += len(chapterMaps(vol["chapters"]))
		if accumulated == currentChapter {
			return true
		}
	}
	return false
}
