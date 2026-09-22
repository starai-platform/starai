package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

func normalizeProductPresetInputs(inputs map[string]interface{}) error {
	preset := strings.ToLower(strings.TrimSpace(stringValue(inputs["product_preset"])))
	if preset == "" {
		preset = "auto_showcase"
	}
	defaults := map[string]string{
		"auto_showcase": "根据商品实际类型和参考素材，生成适合主流电商展示的商品图。",
		"local_repair":  "仅修复用户圈选的问题区域；除明确要求保留的内容外，移除圈内红圈、箭头或文字标记；依据周边结构、材质和光影自然修复接缝、穿透、粘连、断裂、重复边缘及错误遮挡；保持圈外像素、原有构图和尺寸不变。",
		"wear":          "将商品自然穿戴在对应人体部位，保持商品关键结构和卖点。",
		"hold_use":      "由人物自然手持或使用商品，保持商品关键结构和卖点。",
		"background":    "保持商品本身和拍摄角度，生成干净自然的电商展示背景。",
		"detail":        "生成突出商品材质和工艺的细节特写。",
		"custom":        "",
	}
	defaultPrompt, ok := defaults[preset]
	if !ok {
		return fmt.Errorf("商品展示方式无效")
	}
	if strings.TrimSpace(stringValue(inputs["prompt"])) == "" {
		if defaultPrompt == "" {
			return fmt.Errorf("自定义展示方式需要填写商品精修要求")
		}
		inputs["prompt"] = defaultPrompt
	}
	if preset == "local_repair" {
		inputs["count"] = float64(1)
		inputs["aspect_ratio"] = "auto"
	}
	inputs["product_preset"] = preset
	return nil
}

func validateProductParameters(inputs map[string]interface{}) error {
	if err := normalizeProductPresetInputs(inputs); err != nil {
		return err
	}
	count := floatValue(inputs["count"])
	repairs := floatValue(inputs["max_repairs"])
	if math.IsNaN(count+repairs) || math.IsInf(count+repairs, 0) {
		return fmt.Errorf("数量和修正次数无效")
	}
	if count < 1 || count > 6 || math.Trunc(count) != count {
		return fmt.Errorf("交付数量必须为1至6张")
	}
	if repairs < 0 || repairs > 2 || math.Trunc(repairs) != repairs {
		return fmt.Errorf("自动修正次数必须为0至2次")
	}
	if len(stringValue(inputs["prompt"])) > 12000 {
		return fmt.Errorf("商品精修要求不能超过12000字节")
	}
	if len(stringValue(inputs["deliverables"])) > 12000 {
		return fmt.Errorf("逐张要求过长")
	}
	reviewMode := strings.ToLower(strings.TrimSpace(stringValue(inputs["review_mode"])))
	if reviewMode != "" && reviewMode != "standard" && reviewMode != "strict" {
		return fmt.Errorf("验收模式无效")
	}
	return nil
}

func productPriceTotal(workflowFee, imageUnitFee float64, count int) float64 {
	return workflowFee + float64(count)*imageUnitFee
}

func productBillingReservation(floorPrice, executionBudget float64) float64 {
	if executionBudget > floorPrice {
		return executionBudget
	}
	return floorPrice
}

func (s *AgentService) productPricing(ctx context.Context, runtime, priceRule map[string]interface{}, count int, quality string) (map[string]interface{}, float64, error) {
	workflowFee := floatValue(priceRule["unit_price"])
	quality = firstNonEmptyProduct(quality, "high")
	imageUnitFee := s.estimateModelCostByCode(ctx, stringValue(runtime["generation_model_code"]), map[string]interface{}{"n": 1, "count": 1, "quality": quality}, 0, 0)
	if workflowFee < 0 || math.IsNaN(workflowFee) || math.IsInf(workflowFee, 0) || imageUnitFee <= 0 {
		return nil, 0, fmt.Errorf("商品精修工作流或图片模型价格配置不完整，请联系管理员")
	}
	total := productPriceTotal(workflowFee, imageUnitFee, count)
	if total <= 0 || total > 1000 || math.IsNaN(total) || math.IsInf(total, 0) {
		return nil, 0, fmt.Errorf("商品精修预计费用无效，请联系管理员")
	}
	return map[string]interface{}{"workflow_fee": workflowFee, "image_unit_fee": imageUnitFee}, total, nil
}

func (s *AgentService) productExecutionBudget(ctx context.Context, runtime map[string]interface{}, count, repairs int, reviewMode, quality string) (float64, error) {
	analysis := s.estimateModelCostByCode(ctx, stringValue(runtime["analysis_model_code"]), map[string]interface{}{}, 8000, 4096)
	review := s.estimateModelCostByCode(ctx, stringValue(runtime["quality_model_code"]), map[string]interface{}{}, 8000, 4096)
	image := s.estimateModelCostByCode(ctx, stringValue(runtime["generation_model_code"]), map[string]interface{}{"n": 1, "count": 1, "quality": firstNonEmptyProduct(quality, "high")}, 0, 0)
	reviewCalls := 2.0 // candidate localization + detailed review
	if strings.EqualFold(strings.TrimSpace(reviewMode), "strict") {
		reviewCalls++ // independent verification
	}
	budget := analysis*2 + float64(count*(repairs+1))*(image+review*reviewCalls)
	if analysis <= 0 || review <= 0 || image <= 0 || budget <= 0 || budget > 1000 || math.IsNaN(budget) || math.IsInf(budget, 0) {
		return 0, fmt.Errorf("商品精修模型价格配置不完整，请联系管理员")
	}
	return budget, nil
}

func (s *AgentService) validateProductRequest(ctx context.Context, userID int64, runtime, inputs map[string]interface{}) error {
	if strings.TrimSpace(stringValue(inputs["review_mode"])) == "" {
		mode := strings.ToLower(strings.TrimSpace(stringValue(runtime["default_review_mode"])))
		if mode != "strict" {
			mode = "standard"
		}
		inputs["review_mode"] = mode
	}
	if err := validateProductParameters(inputs); err != nil {
		return err
	}
	var refs []struct {
		AssetID          string      `json:"asset_id"`
		Role             string      `json:"role"`
		EditRegions      [][]float64 `json:"edit_regions"`
		ProtectedRegions [][]float64 `json:"protected_regions"`
	}
	data, _ := json.Marshal(inputs["product_references"])
	if json.Unmarshal(data, &refs) != nil || len(refs) < 1 || len(refs) > 2 {
		return fmt.Errorf("请上传1至2张参考图：一张商品图和一张可选姿态或风格参考图")
	}
	// A new pose, hand or scene requires the model to recompose the whole image.
	// Do not let a standard single review deliver a visually similar replacement product.
	needsIdentityVerification := false
	for _, r := range refs {
		if r.Role == "pose" || r.Role == "style" {
			needsIdentityVerification = true
			break
		}
	}
	if preset := stringValue(inputs["product_preset"]); preset == "wear" || preset == "hold_use" {
		needsIdentityVerification = true
	}
	if needsIdentityVerification && strings.ToLower(strings.TrimSpace(stringValue(inputs["review_mode"]))) != "strict" {
		inputs["review_mode"] = "strict"
		inputs["_auto_identity_review"] = true
	}
	if s.storage == nil {
		return fmt.Errorf("素材存储不可用")
	}
	resolved := []map[string]interface{}{}
	products, repairs := 0, 0
	for _, r := range refs {
		for _, regions := range [][][]float64{r.EditRegions, r.ProtectedRegions} {
			if err := validateProductRegions(regions); err != nil {
				return err
			}
		}
		switch r.Role {
		case "product":
			products++
		case "repair":
			repairs++
			if len(r.EditRegions) == 0 {
				return fmt.Errorf("局部问题修复需要在待修图片上圈选至少一个问题区域")
			}
		case "pose", "style":
		default:
			return fmt.Errorf("参考图用途无效")
		}
		var kind, key string
		if err := s.db.QueryRow(ctx, `SELECT kind,object_key FROM assets WHERE public_id=$1 AND user_id=$2`, r.AssetID, userID).Scan(&kind, &key); err != nil || kind != "image" || key == "" {
			return fmt.Errorf("参考图不存在或无权访问，请重新上传")
		}
		resolved = append(resolved, map[string]interface{}{"asset_id": r.AssetID, "role": r.Role, "url": s.storage.PublicURL(key), "edit_regions": r.EditRegions, "protected_regions": r.ProtectedRegions})
	}
	localRepair := stringValue(inputs["product_preset"]) == "local_repair"
	if localRepair {
		if repairs != 1 {
			return fmt.Errorf("局部问题修复需要且只能设置一张待修图片")
		}
	} else if repairs > 0 {
		return fmt.Errorf("待修图片只能用于局部问题修复")
	} else if products == 0 {
		return fmt.Errorf("至少需要一张商品原图")
	}
	for _, field := range []string{"analysis_model_code", "quality_model_code", "generation_model_code"} {
		code := stringValue(runtime[field])
		var mode string
		var rule, schema, defaults []byte
		if code == "" {
			return fmt.Errorf("商品精修尚未配置分析、编辑和验收模型，请联系管理员")
		}
		if err := s.db.QueryRow(ctx, `SELECT request_mode,runtime_rule,input_schema,default_params FROM models WHERE code=$1 AND is_enabled=true`, code).Scan(&mode, &rule, &schema, &defaults); err != nil {
			return fmt.Errorf("模型不可用：%s", code)
		}
		if field == "generation_model_code" {
			if mode != "images" {
				return fmt.Errorf("商品编辑必须绑定图片模型")
			}
			var compatible bool
			if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM models m WHERE m.code=$1 AND (
              (NOT EXISTS(SELECT 1 FROM model_routes r WHERE r.model_id=m.id) AND m.runtime_rule#>>'{upstream,adapter}'='openai_images')
              OR EXISTS(SELECT 1 FROM model_routes r WHERE r.model_id=m.id AND r.is_enabled=true AND COALESCE(r.runtime_rule#>>'{upstream,adapter}',m.runtime_rule#>>'{upstream,adapter}')='openai_images')))`, code).Scan(&compatible); err != nil {
				return err
			}
			if !compatible {
				return fmt.Errorf("图片模型未配置支持蒙版的OpenAI Images线路，请在后台选择兼容编辑模型")
			}
			supportedRatios := productModelAspectRatios(schema)
			aspectRatio := strings.TrimSpace(stringValue(inputs["aspect_ratio"]))
			if aspectRatio == "" {
				aspectRatio = productDefaultAspectRatio(supportedRatios, defaults, localRepair)
			}
			if aspectRatio == "" {
				aspectRatio = "auto"
			}
			if len(supportedRatios) > 0 && !productStringInSlice(aspectRatio, supportedRatios) {
				return fmt.Errorf("图片比例%s不受当前生成模型支持", aspectRatio)
			}
			inputs["aspect_ratio"] = aspectRatio
			qualities := productModelQualities(schema)
			quality := strings.ToLower(strings.TrimSpace(stringValue(inputs["quality"])))
			if quality == "" {
				quality = productDefaultQuality(qualities, defaults, localRepair)
			}
			if len(qualities) > 0 && !productStringInSlice(quality, qualities) {
				return fmt.Errorf("生成质量%s不受当前图片模型支持，可选：%s", quality, strings.Join(qualities, "、"))
			}
			inputs["quality"] = quality
		} else {
			var config struct {
				Capabilities map[string]bool `json:"capabilities"`
			}
			_ = json.Unmarshal(rule, &config)
			if !config.Capabilities["vision"] && !config.Capabilities["image_input"] && !config.Capabilities["multimodal"] {
				return fmt.Errorf("分析和验收模型必须具备图片理解能力：%s", code)
			}
		}
	}
	inputs["product_references"], inputs["_mode"] = resolved, "auto"
	return nil
}

func productModelAspectRatios(schema []byte) []string {
	values := productModelStringEnum(schema, "aspect_ratio")
	if len(values) == 0 {
		return []string{"auto", "1:1"}
	}
	if !productStringInSlice("auto", values) {
		values = append([]string{"auto"}, values...)
	}
	return values
}

func productModelStringEnum(schema []byte, field string) []string {
	var value struct {
		Properties map[string]struct {
			Enum []string `json:"enum"`
		} `json:"properties"`
	}
	if json.Unmarshal(schema, &value) != nil {
		return nil
	}
	return value.Properties[field].Enum
}

func productModelQualities(schema []byte) []string {
	allowed := map[string]bool{"auto": true, "low": true, "medium": true, "high": true, "xhigh": true, "max": true}
	qualities := []string{}
	for _, quality := range productModelStringEnum(schema, "quality") {
		quality = strings.ToLower(strings.TrimSpace(quality))
		if allowed[quality] && !productStringInSlice(quality, qualities) {
			qualities = append(qualities, quality)
		}
	}
	if len(qualities) == 0 {
		return []string{"auto"}
	}
	return qualities
}

func productDefaultAspectRatio(supported []string, defaults []byte, localRepair bool) string {
	if localRepair {
		return "auto"
	}
	if productStringInSlice("1:1", supported) {
		return "1:1"
	}
	var configured map[string]interface{}
	_ = json.Unmarshal(defaults, &configured)
	value := strings.TrimSpace(stringValue(configured["aspect_ratio"]))
	if productStringInSlice(value, supported) {
		return value
	}
	if len(supported) > 0 {
		return supported[0]
	}
	return "auto"
}

func productDefaultQuality(supported []string, defaults []byte, localRepair bool) string {
	var configured map[string]interface{}
	_ = json.Unmarshal(defaults, &configured)
	value := strings.ToLower(strings.TrimSpace(stringValue(configured["quality"])))
	if value != "auto" && productStringInSlice(value, supported) {
		return value
	}
	if localRepair && productStringInSlice("xhigh", supported) {
		return "xhigh"
	}
	if productStringInSlice("high", supported) {
		return "high"
	}
	if productStringInSlice(value, supported) {
		return value
	}
	if len(supported) > 0 {
		return supported[0]
	}
	return "auto"
}

func firstNonEmptyProduct(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func productStringInSlice(value string, items []string) bool {
	for _, item := range items {
		if value == item {
			return true
		}
	}
	return false
}

func validateProductRegions(regions [][]float64) error {
	if len(regions) > 12 {
		return fmt.Errorf("每类最多12个区域")
	}
	for _, b := range regions {
		if len(b) != 4 {
			return fmt.Errorf("区域需要左、上、宽、高四个数值")
		}
		for _, v := range b {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return fmt.Errorf("区域数值无效")
			}
		}
		if b[0] < 0 || b[1] < 0 || b[2] <= 0 || b[3] <= 0 || b[0]+b[2] > 1.000001 || b[1]+b[3] > 1.000001 {
			return fmt.Errorf("区域超出原图，请调整框选范围")
		}
	}
	return nil
}

// Product runs have a sealed budget and immutable original references. A new
// brief is a new project, rather than reopening a settled budget via legacy retry.
func (s *AgentService) preventProductLegacyRetry(ctx context.Context, userID int64, publicID string) error {
	var mode string
	err := s.db.QueryRow(ctx, `SELECT COALESCE(w.runtime_config->>'agent_mode','') FROM workflow_projects p JOIN workflow_definitions w ON w.id=p.workflow_id WHERE p.public_id=$1 AND p.user_id=$2`, publicID, userID).Scan(&mode)
	if err != nil {
		return err
	}
	if mode == "product_refine" {
		return fmt.Errorf("商品精修已保留全部候选与检查记录，请修改要求后新建任务；原任务不会重复计费")
	}
	return nil
}
