package handler

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/starai/api/internal/service"
)

type creativeAgentWorkflowInput struct {
	Key      string        `json:"key"`
	Title    string        `json:"title,omitempty"`
	Type     string        `json:"type,omitempty"`
	Required bool          `json:"required,omitempty"`
	Enum     []interface{} `json:"enum,omitempty"`
	Default  interface{}   `json:"default,omitempty"`
}

type creativeAgentWorkflowCapability struct {
	Code             string                       `json:"code"`
	Name             string                       `json:"name"`
	Description      string                       `json:"description,omitempty"`
	Category         string                       `json:"category,omitempty"`
	GenerationType   string                       `json:"generation_type,omitempty"`
	Executor         string                       `json:"executor"`
	Inputs           []creativeAgentWorkflowInput `json:"inputs,omitempty"`
	RecentRuns       int                          `json:"recent_runs,omitempty"`
	SuccessRate      *float64                     `json:"success_rate,omitempty"`
	AvgDurationMS    int                          `json:"avg_duration_ms,omitempty"`
	FeedbackSamples  float64                      `json:"feedback_samples,omitempty"`
	SatisfactionRate *float64                     `json:"satisfaction_rate,omitempty"`
	definition       *service.WorkflowDTO
}

func creativeAgentWorkflowGenerationType(definition *service.WorkflowDTO) string {
	if definition == nil {
		return "workflow"
	}
	generationType := strings.TrimSpace(stringAny(definition.RuntimeConfig["generation_type"]))
	if generationType == "" {
		switch definition.Category {
		case "image", "video", "audio", "speech", "music":
			generationType = definition.Category
		}
	}
	if generationType == "" {
		generationType = "workflow"
	}
	return generationType
}

// A confirmed Agent plan is approval for one workflow definition, including
// its schema, runtime routing, nodes and pricing. Derived display-only runtime
// values are excluded so List and Get produce the same revision.
func creativeAgentWorkflowRevision(definition *service.WorkflowDTO) string {
	if definition == nil {
		return ""
	}
	runtimeConfig := copyStringMap(definition.RuntimeConfig)
	delete(runtimeConfig, "product_pricing")
	payload, _ := json.Marshal(struct {
		Code          string                 `json:"code"`
		Nodes         []service.WorkflowNode `json:"nodes"`
		InputSchema   map[string]interface{} `json:"input_schema"`
		PriceRule     map[string]interface{} `json:"price_rule"`
		RuntimeConfig map[string]interface{} `json:"runtime_config"`
	}{definition.Code, definition.Nodes, definition.InputSchema, definition.PriceRule, runtimeConfig})
	sum := sha256.Sum256(payload)
	return fmt.Sprintf("%x", sum[:16])
}

// A confirmation freezes the user-visible capability and price contract, not
// the current provider route. Route failover can therefore change without
// invalidating a plan, while schema, defaults or billing changes cannot.
func creativeAgentModelRevision(model *service.ModelFull) string {
	if model == nil {
		return ""
	}
	payload, _ := json.Marshal(struct {
		Code          string                 `json:"code"`
		Category      string                 `json:"category"`
		RequestMode   string                 `json:"request_mode"`
		InputSchema   map[string]interface{} `json:"input_schema"`
		DefaultParams map[string]interface{} `json:"default_params"`
		PriceRule     map[string]interface{} `json:"price_rule"`
		RuntimeRule   map[string]interface{} `json:"runtime_rule"`
	}{model.Code, model.Category, model.RequestMode, model.InputSchema, model.DefaultParams, model.PriceRule, model.RuntimeRule})
	sum := sha256.Sum256(payload)
	return fmt.Sprintf("%x", sum[:16])
}

func creativeAgentEstimatedModelCost(models *service.ModelService, model *service.ModelFull, plan map[string]interface{}) (float64, bool) {
	if models == nil || model == nil || plan == nil {
		return 0, false
	}
	params, _ := plan["params"].(map[string]interface{})
	quoteParams := copyStringMap(params)
	if _, ok := quoteParams["prompt"]; !ok {
		quoteParams["prompt"] = stringAny(plan["prompt"])
	}
	multiplier := 1
	if stringAny(quoteParams["content_layout"]) == "document_pages" {
		multiplier = creativeAgentPositiveInt(quoteParams["document_page_count"])
	} else if stringAny(plan["intent"]) == "workflow" && model.RequestMode == "video" {
		multiplier = creativeAgentPositiveInt(quoteParams["storyboard_grid"])
		// Each canvas segment creates one upstream task. Planner-provided count
		// must not multiply the same segment count a second time.
		delete(quoteParams, "count")
		delete(quoteParams, "n")
	}
	if multiplier < 1 {
		multiplier = 1
	}
	cost := models.EstimateCost(model, quoteParams, 0, 0) * float64(multiplier)
	return cost, cost > 0
}

func creativeAgentAttachModelQuote(models *service.ModelService, model *service.ModelFull, plan map[string]interface{}) {
	if model == nil || plan == nil {
		return
	}
	plan["model_revision"] = creativeAgentModelRevision(model)
	cost, available := creativeAgentEstimatedModelCost(models, model, plan)
	plan["cost_estimate_available"] = available
	if !available {
		delete(plan, "estimated_cost")
		plan["cost_estimate_note"] = "当前模型配置无法给出可靠费用预估；按实际调用计费，并非免费。"
		return
	}
	plan["estimated_cost"] = cost
	params, _ := plan["params"].(map[string]interface{})
	switch {
	case stringAny(params["content_layout"]) == "document_pages":
		plan["cost_estimate_note"] = "图片生成费用预估；逐页文字编排等其他步骤按实际调用计费。"
	case stringAny(plan["intent"]) == "workflow":
		plan["cost_estimate_note"] = "主要生成模型费用预估；文案、配音、合成等其他步骤按实际调用计费。"
	default:
		plan["cost_estimate_note"] = "主要生成模型费用预估；最终按实际生成结果计费。"
	}
}

func creativeAgentUsesCanvasWorkflow(code string) bool {
	switch strings.TrimSpace(code) {
	case "ai_comic_drama", "video_creation", "video_creation_v2", "one_click_viral_remake", "viral_remake", "content_image_post":
		return true
	default:
		return false
	}
}

func creativeAgentWorkflowProperties(schema map[string]interface{}) map[string]interface{} {
	if properties, ok := schema["properties"].(map[string]interface{}); ok {
		return properties
	}
	properties := map[string]interface{}{}
	for key, value := range schema {
		if key == "type" || key == "required" || key == "$schema" {
			continue
		}
		if _, ok := value.(map[string]interface{}); ok {
			properties[key] = value
		}
	}
	return properties
}

func creativeAgentWorkflowRequired(schema map[string]interface{}) map[string]bool {
	required := map[string]bool{}
	for _, value := range stringSliceAny(schema["required"]) {
		required[value] = true
	}
	for key, raw := range creativeAgentWorkflowProperties(schema) {
		if property, ok := raw.(map[string]interface{}); ok && property["required"] == true {
			required[key] = true
		}
	}
	return required
}

func creativeAgentWorkflowCapabilities(items []service.WorkflowDTO) []creativeAgentWorkflowCapability {
	capabilities := make([]creativeAgentWorkflowCapability, 0, len(items))
	for i := range items {
		item := &items[i]
		if !item.IsEnabled || item.Code == "general_creative_agent" || item.Code == "infinite_canvas" || item.RuntimeConfig["agent_callable"] == false {
			continue
		}
		generationType := creativeAgentWorkflowGenerationType(item)
		executor := "workflow"
		if creativeAgentUsesCanvasWorkflow(item.Code) {
			executor = "canvas"
		}
		required := creativeAgentWorkflowRequired(item.InputSchema)
		inputs := []creativeAgentWorkflowInput{}
		for key, raw := range creativeAgentWorkflowProperties(item.InputSchema) {
			property, _ := raw.(map[string]interface{})
			input := creativeAgentWorkflowInput{Key: key, Title: stringAny(property["title"]), Type: stringAny(property["type"]), Required: required[key], Default: property["default"]}
			if values, ok := property["enum"].([]interface{}); ok && len(values) <= 12 {
				input.Enum = values
			}
			inputs = append(inputs, input)
		}
		sort.Slice(inputs, func(i, j int) bool {
			if inputs[i].Required != inputs[j].Required {
				return inputs[i].Required
			}
			return inputs[i].Key < inputs[j].Key
		})
		description := ""
		if item.Description != nil {
			description = strings.TrimSpace(*item.Description)
		}
		capabilities = append(capabilities, creativeAgentWorkflowCapability{
			Code: item.Code, Name: item.Name, Description: description, Category: item.Category,
			GenerationType: generationType, Executor: executor, Inputs: inputs, definition: item,
		})
	}
	return capabilities
}

func (h *Handler) creativeAgentWorkflowCatalog(ctx context.Context) ([]creativeAgentWorkflowCapability, error) {
	if h == nil || h.agents == nil {
		return nil, nil
	}
	items, err := h.agents.List(ctx, false)
	if err != nil {
		return nil, err
	}
	capabilities := creativeAgentWorkflowCapabilities(items)
	if stats, statsErr := h.agents.AgentWorkflowOutcomeStats(ctx); statsErr == nil {
		creativeAgentApplyWorkflowOutcomes(capabilities, stats)
	}
	return capabilities, nil
}

func creativeAgentApplyWorkflowOutcomes(capabilities []creativeAgentWorkflowCapability, stats map[string]service.WorkflowOutcomeStat) {
	for index := range capabilities {
		stat, ok := stats[capabilities[index].Code]
		if !ok {
			continue
		}
		// Tiny samples are more likely to mislead the planner than help it.
		if stat.RecentRuns >= 3 {
			rate := stat.SuccessRate
			capabilities[index].RecentRuns = stat.RecentRuns
			capabilities[index].SuccessRate = &rate
			capabilities[index].AvgDurationMS = stat.AvgDurationMS
		}
		if stat.FeedbackSamples >= 3 {
			satisfaction := stat.SatisfactionRate
			capabilities[index].FeedbackSamples = stat.FeedbackSamples
			capabilities[index].SatisfactionRate = &satisfaction
		}
	}
}

func creativeAgentWorkflowCatalogPrompt(capabilities []creativeAgentWorkflowCapability) string {
	if len(capabilities) == 0 {
		return ""
	}
	data, _ := json.Marshal(capabilities)
	return "\n服务端当前已启用工作流能力目录（只能从中选择 workflow_code；普通单图、单段视频、语音和音乐仍使用对应媒体 intent，不要为了使用工作流而强行选择）：\n" + string(data) +
		"\nrecent_runs、success_rate、avg_duration_ms 是最近30天技术执行反馈；feedback_samples、satisfaction_rate 是达到最低样本量后展示的用户质量反馈。两者仅在功能匹配度相近时作为次级依据，不能替代能力匹配。选择工作流时同时返回 route_confidence(0到1)、route_reason 和最多3个 workflow_candidates；params 只能填写所选工作流 inputs 中的业务字段。素材URL、素材ID、模型编码、工具名和执行器由服务端注入，不得填写。必填输入不足时只追问最关键的一项。用户同时要求多种交付物时，只能选择一个本身覆盖完整需求的现有工作流；不得自行串联多个收费工作流。没有单个工作流覆盖时，先说明建议顺序并追问本轮优先交付物，不执行任务。"
}

func creativeAgentWorkflowDefinition(capabilities []creativeAgentWorkflowCapability, code string) *service.WorkflowDTO {
	for i := range capabilities {
		if capabilities[i].Code == strings.TrimSpace(code) {
			return capabilities[i].definition
		}
	}
	return nil
}

func creativeAgentWorkflowValueAllowed(value interface{}, property map[string]interface{}) bool {
	typeName := stringAny(property["type"])
	switch typeName {
	case "string":
		text, ok := value.(string)
		if !ok || len([]rune(text)) > 20000 {
			return false
		}
	case "integer":
		switch item := value.(type) {
		case int, int64:
		case float64:
			if item != float64(int(item)) {
				return false
			}
		default:
			return false
		}
	case "number":
		switch value.(type) {
		case int, int64, float64, float32:
		default:
			return false
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return false
		}
	case "array":
		items, ok := value.([]interface{})
		if !ok || len(items) > 100 {
			return false
		}
	}
	if typeName == "integer" || typeName == "number" {
		number, err := strconv.ParseFloat(fmt.Sprint(value), 64)
		if err != nil {
			return false
		}
		if minimum, ok := property["minimum"].(float64); ok && number < minimum {
			return false
		}
		if maximum, ok := property["maximum"].(float64); ok && number > maximum {
			return false
		}
		if minimum, ok := property["exclusiveMinimum"].(float64); ok && number <= minimum {
			return false
		}
		if maximum, ok := property["exclusiveMaximum"].(float64); ok && number >= maximum {
			return false
		}
	}
	if choices, ok := property["enum"].([]interface{}); ok && len(choices) > 0 {
		for _, choice := range choices {
			if fmt.Sprint(choice) == fmt.Sprint(value) {
				return true
			}
		}
		return false
	}
	return true
}

func creativeAgentWorkflowInputs(definition *service.WorkflowDTO, proposed map[string]interface{}) map[string]interface{} {
	inputs := map[string]interface{}{}
	properties := creativeAgentWorkflowProperties(definition.InputSchema)
	for key, raw := range properties {
		property, _ := raw.(map[string]interface{})
		if value, ok := property["default"]; ok {
			inputs[key] = value
		}
	}
	for key, value := range proposed {
		property, ok := properties[key].(map[string]interface{})
		if !ok || creativeAgentServerManagedWorkflowInput(key) {
			continue
		}
		if creativeAgentWorkflowValueAllowed(value, property) {
			inputs[key] = value
		}
	}
	return inputs
}

func creativeAgentServerManagedWorkflowInput(key string) bool {
	if strings.Contains(key, "model_code") || strings.Contains(key, "tool") || strings.HasSuffix(key, "_url") || strings.HasSuffix(key, "_asset_id") {
		return true
	}
	switch key {
	case "asset_ids", "reference_images", "reference_videos", "reference_audios", "product_references", "input_images", "input_videos", "input_audios":
		return true
	default:
		return false
	}
}

func creativeAgentWorkflowMissing(definition *service.WorkflowDTO, inputs map[string]interface{}) []string {
	properties := creativeAgentWorkflowProperties(definition.InputSchema)
	missing := []string{}
	for key := range creativeAgentWorkflowRequired(definition.InputSchema) {
		if key == "max_cost" || key == "_execution_budget" {
			continue
		}
		value, ok := inputs[key]
		if key == "consent_confirmed" {
			if value == true {
				continue
			}
		} else if ok && creativeAgentWorkflowValuePresent(value) {
			continue
		}
		title := key
		if property, ok := properties[key].(map[string]interface{}); ok && stringAny(property["title"]) != "" {
			title = stringAny(property["title"])
		}
		missing = append(missing, title)
	}
	sort.Strings(missing)
	return missing
}

func creativeAgentWorkflowValuePresent(value interface{}) bool {
	switch item := value.(type) {
	case nil:
		return false
	case string:
		return strings.TrimSpace(item) != ""
	case []interface{}:
		return len(item) > 0
	case []string:
		return len(item) > 0
	case map[string]interface{}:
		return len(item) > 0
	default:
		return true
	}
}

func creativeAgentRouteConfidence(plan map[string]interface{}) float64 {
	value, ok := plan["route_confidence"].(float64)
	if !ok || value < 0 || value > 1 {
		return 0
	}
	return value
}

const creativeAgentLowRouteConfidence = 0.55

func creativeAgentBoundedText(value interface{}, max int) string {
	text := strings.TrimSpace(stringAny(value))
	if max > 0 {
		chars := []rune(text)
		if len(chars) > max {
			text = string(chars[:max])
		}
	}
	return text
}

// Keep routing explanations useful for users and metrics without persisting
// arbitrary planner output or unavailable workflow codes.
func creativeAgentApplyRouteMetadata(plan, route map[string]interface{}, capabilities []creativeAgentWorkflowCapability, previousWorkflowCode string) {
	for _, key := range []string{"route_confidence", "route_reason", "workflow_candidates", "route_changed"} {
		delete(plan, key)
	}
	workflowCode := strings.TrimSpace(stringAny(plan["workflow_code"]))
	available := map[string]bool{}
	for _, capability := range capabilities {
		available[capability.Code] = true
	}
	if workflowCode == "" || !available[workflowCode] {
		return
	}
	if confidence := creativeAgentRouteConfidence(route); confidence > 0 {
		plan["route_confidence"] = confidence
	}
	if reason := creativeAgentBoundedText(route["route_reason"], 240); reason != "" {
		plan["route_reason"] = reason
	}
	candidates := make([]interface{}, 0, 3)
	seen := map[string]bool{}
	if values, ok := route["workflow_candidates"].([]interface{}); ok {
		for _, value := range values {
			candidate, ok := value.(map[string]interface{})
			if !ok {
				continue
			}
			code := strings.TrimSpace(stringAny(candidate["code"]))
			score, validScore := candidate["score"].(float64)
			if code == "" || seen[code] || !available[code] || !validScore || score < 0 || score > 1 {
				continue
			}
			item := map[string]interface{}{"code": code, "score": score}
			if reason := creativeAgentBoundedText(candidate["reason"], 160); reason != "" {
				item["reason"] = reason
			}
			candidates, seen[code] = append(candidates, item), true
			if len(candidates) == 3 {
				break
			}
		}
	}
	if len(candidates) > 0 {
		plan["workflow_candidates"] = candidates
	}
	previousWorkflowCode = strings.TrimSpace(previousWorkflowCode)
	if previousWorkflowCode != "" && previousWorkflowCode != workflowCode {
		plan["route_changed"] = true
	}
}

func creativeAgentRouteNeedsClarification(plan map[string]interface{}) bool {
	confidence := creativeAgentRouteConfidence(plan)
	candidates, _ := plan["workflow_candidates"].([]interface{})
	return confidence > 0 && confidence < creativeAgentLowRouteConfidence && len(candidates) > 1
}

func creativeAgentRouteCandidateNames(plan map[string]interface{}, capabilities []creativeAgentWorkflowCapability) string {
	names := map[string]string{}
	for _, capability := range capabilities {
		names[capability.Code] = capability.Name
	}
	result := []string{}
	if candidates, ok := plan["workflow_candidates"].([]interface{}); ok {
		for _, raw := range candidates {
			candidate, _ := raw.(map[string]interface{})
			if name := names[stringAny(candidate["code"])]; name != "" {
				result = append(result, "「"+name+"」")
			}
		}
	}
	return strings.Join(result, "、")
}

func creativeAgentRouteEvent(plan map[string]interface{}, previousWorkflowCode string) map[string]interface{} {
	workflowCode := strings.TrimSpace(stringAny(plan["workflow_code"]))
	modelCode := strings.TrimSpace(stringAny(plan["model_code"]))
	if workflowCode == "" && modelCode == "" {
		return nil
	}
	confidence := creativeAgentRouteConfidence(plan)
	event := map[string]interface{}{
		"type": "creative_agent_route", "intent": stringAny(plan["intent"]),
		"workflow_code": workflowCode, "model_code": modelCode,
		"needs_confirm": plan["needs_confirm"] == true, "plan_version": plan["plan_version"],
		"route_changed":  plan["route_changed"] == true,
		"low_confidence": confidence > 0 && confidence < creativeAgentLowRouteConfidence,
	}
	if previousWorkflowCode = strings.TrimSpace(previousWorkflowCode); previousWorkflowCode != "" {
		event["previous_workflow_code"] = previousWorkflowCode
	}
	for _, key := range []string{"route_confidence", "route_reason", "workflow_candidates", "model_selection_reason"} {
		if value, ok := plan[key]; ok {
			event[key] = value
		}
	}
	return event
}

func creativeAgentFirst(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func creativeAgentSetWorkflowAssetInputs(inputs, properties map[string]interface{}, assetIDs, images, videos, audios []string) {
	for key := range properties {
		switch key {
		case "reference_images", "product_references", "input_images":
			if len(images) > 0 {
				inputs[key] = images
			}
		case "reference_videos", "input_videos":
			if len(videos) > 0 {
				inputs[key] = videos
			}
		case "reference_audios", "input_audios":
			if len(audios) > 0 {
				inputs[key] = audios
			}
		case "video_url", "source_video_url":
			if value := creativeAgentFirst(videos); value != "" {
				inputs[key] = value
			}
		case "image_url", "source_image_url", "photo_url", "person_image_url":
			if value := creativeAgentFirst(images); value != "" {
				inputs[key] = value
			}
		case "garment_image_url":
			if len(images) > 1 {
				inputs[key] = images[1]
			}
		case "asset_id", "image_asset_id", "person_asset_id":
			if value := creativeAgentFirst(assetIDs); value != "" {
				inputs[key] = value
			}
		case "garment_asset_id":
			if len(assetIDs) > 1 {
				inputs[key] = assetIDs[1]
			}
		}
	}
}

func (h *Handler) finalizeCatalogWorkflowPlan(ctx context.Context, userID int64, req creativeAgentPlanRequest, draft *service.AgentDraft, definition *service.WorkflowDTO, proposed map[string]interface{}, route map[string]interface{}, text string) map[string]interface{} {
	properties := creativeAgentWorkflowProperties(definition.InputSchema)
	merged := map[string]interface{}{}
	if draft.Plan != nil && stringAny(draft.Plan["workflow_code"]) == definition.Code {
		if previous, ok := draft.Plan["params"].(map[string]interface{}); ok {
			for key, value := range previous {
				merged[key] = value
			}
		}
	}
	for key, value := range proposed {
		merged[key] = value
	}
	inputs := creativeAgentWorkflowInputs(definition, merged)
	prompt := creativeAgentSlotPrompt(draft.Slots)
	if prompt == "" {
		prompt = strings.TrimSpace(text)
	}
	if _, ok := properties["prompt"]; ok && prompt != "" {
		inputs["prompt"] = prompt
	}
	for _, key := range []string{"platform", "aspect_ratio", "quality", "style", "target_duration_sec", "music_prompt"} {
		if _, ok := properties[key]; ok {
			if value, exists := draft.Slots[key]; exists {
				inputs[key] = value
			}
		}
	}
	if _, ok := properties["count"]; ok {
		if count := creativeAgentPositiveInt(draft.Slots["image_count"]); count > 0 {
			inputs["count"] = count
		}
	}
	assetImages, assetVideos, assetAudios := h.assetMediaURLs(ctx, userID, req.AssetIDs)
	images := uniqueModelCodes(append(append([]string{}, req.ReferenceImageURLs...), assetImages...))
	videos := uniqueModelCodes(append(append([]string{}, req.ReferenceVideoURLs...), assetVideos...))
	audios := uniqueModelCodes(append(append([]string{}, req.ReferenceAudioURLs...), assetAudios...))
	creativeAgentSetWorkflowAssetInputs(inputs, properties, req.AssetIDs, images, videos, audios)
	if _, ok := properties["consent_confirmed"]; ok && regexpConsentConfirmed.MatchString(text) {
		inputs["consent_confirmed"] = true
	}

	generationType := creativeAgentWorkflowGenerationType(definition)
	draft.SetSlot("media_type", generationType, "workflow", definition.Code)
	delete(draft.Slots, "model_code")
	delete(draft.Sources, "model_code")

	result := map[string]interface{}{
		"intent": "workflow", "workflow_code": definition.Code, "prompt": prompt, "params": inputs,
		"needs_confirm": true, "reply": "已匹配工作流「" + definition.Name + "」，请核对输入后确认执行。",
		"model_selection_reason": "模型由工作流配置决定；执行时按线路健康状态选择，存在备用线路时异常会自动切换。",
	}
	result["asset_ids"] = append([]string{}, req.AssetIDs...)
	if len(images) > 0 {
		result["reference_image_urls"] = images
	}
	if len(videos) > 0 {
		result["reference_video_urls"] = videos
	}
	if len(audios) > 0 {
		result["reference_audio_urls"] = audios
	}
	missing := creativeAgentWorkflowMissing(definition, inputs)
	if prompt == "" {
		missing = append(missing, "具体任务要求")
	}
	draft.Missing = missing
	if len(missing) > 0 {
		draft.Status = "draft"
		result["intent"], result["needs_confirm"] = "clarify", false
		result["reply"] = "已匹配工作流「" + definition.Name + "」，请补充最关键的缺失输入：" + missing[0] + "。其余需求已保留。"
	} else {
		draft.Status = "awaiting_confirmation"
		cost, err := h.agents.EstimateWorkflowCost(ctx, definition, inputs)
		if err == nil && cost > 0 {
			result["estimated_cost"] = cost
			result["confirmed_max_cost"] = cost
			result["cost_estimate_available"] = true
			result["cost_estimate_note"] = "工作流总费用预估与本次确认上限；超出时不会开始执行。"
		} else {
			result["cost_estimate_available"] = false
			result["cost_estimate_note"] = "当前工作流无法给出可靠费用预估；按实际调用计费，并非免费。"
		}
	}
	return result
}

var regexpConsentConfirmed = regexp.MustCompile(`(?i)(本人|我本人|已获|已经获得|得到).{0,8}(同意|授权)|明确同意|consent(?:ed)?`)
