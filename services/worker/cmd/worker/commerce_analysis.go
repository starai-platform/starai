package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const commerceResolutionInstruction = `当前是生图前最终校对，不是重新构思多个方案。只返回1个候选A及其generation_prompt；已合规的正文沿用，只修改冲突部分。
优先级：用户最新确认的明确修改 > 用户原始需求 > 已选方案补充 > 默认角色与场景建议。当前生成参数是即将提交接口的实际参数，不得自行改动，候选params返回{}。若用户明确文字要求与实际参数冲突，不能静默改写用户需求，返回{"error":"指出冲突的具体要求和参数"}；普通风格建议与用户需求冲突时直接删除或修正建议，不要求用户处理。
把原始需求、最新修改、参考依据、拍摄要求和参数整理为一份可直接执行的完整prompt，移除相反要求、重复说明及角色自述；negative_prompt也要同步清理，不能禁止用户明确要求出现的内容。不得把批量数量写成一张图里重复多个商品；每次图像请求只生成一张，数量由系统控制。
参考图继续以实际附件为准，不补写看不清的结构，不增加未经确认的卖点；用户明确要求修改商品设计时只改指定部位。不声称已完成实图质量验收。
详情页必须同步校对所有detail_sections，数量与当前detail_section_count一致，并原样保留同一份design_system。所有模块共享其色板、渐变、卡片材质、图标语言、装饰母题、商品处理和光线，只改变信息职责、景别和版式节奏，不能各自发明风格。每个image_prompt需独立包含本模块的商品依据、构图、穿戴关系、光线与禁止事项，不写“同上”，不把整页需求机械重复到每一张。
详情模块生成可直接衔接成长页的完整视觉底图，不是无设计的裸摄影照：允许与design_system一致的渐变、留白卡片、无字功能图标、光斑、线条和几何装饰；只使用与已确认卖点有关的视觉符号。copy_placement必须与画面留出的干净文字安全区一致。底图不绘制新增文字、字母和数字，copy_title/copy_points由后期准确排版。`

func isCommerceScene(scene string) bool {
	return scene == "main_image" || scene == "scene_image" || scene == "detail_image" || scene == "marketing_poster"
}

func commerceResolutionKey(inputs, draft, runtimeCfg map[string]interface{}) string {
	return fmt.Sprintf("%x", sha256.Sum256(mustJSON(map[string]interface{}{
		"version": 2, "inputs": inputs, "draft": draft, "analysis_model": runtimeCfg["analysis_model_code"], "generation_model": runtimeCfg["generation_model_code"],
	})))
}

func validateCommerceResolution(analysis, inputs map[string]interface{}) error {
	if message := stringAny(analysis["error"]); message != "" {
		return fmt.Errorf("%s", message)
	}
	if len(analysisCandidates(analysis)) != 1 {
		return fmt.Errorf("最终校对必须返回一个可执行方案")
	}
	return validateCommerceAnalysis(analysis, inputs)
}

func prepareCommerceParameters(inputs map[string]interface{}) error {
	for _, key := range []string{"count", "n"} {
		if !hasMeaningfulInput(inputs, key) {
			continue
		}
		value := floatAny(inputs[key])
		if value < 1 || value > 20 || value != float64(int(value)) {
			return fmt.Errorf("图片数量必须是1–20的整数，请调整参数")
		}
	}
	if stringAny(inputs["creative_scene"]) == "detail_image" && hasMeaningfulInput(inputs, "detail_section_count") {
		value := floatAny(inputs["detail_section_count"])
		if value < 4 || value > 8 || value != float64(int(value)) {
			return fmt.Errorf("详情模块数量必须是4–8的整数，请调整参数")
		}
	}
	ratio := firstNonEmpty(stringAny(inputs["aspect_ratio"]), stringAny(inputs["ratio"]))
	if ratio == "" || ratio == "auto" {
		return nil
	}
	if _, ok := standardImageSizes[ratio]; !ok {
		return fmt.Errorf("不支持图片比例 %s，请调整比例参数", ratio)
	}
	inputs["aspect_ratio"] = ratio
	delete(inputs, "ratio")
	size := stringAny(inputs["size"])
	if size == "" {
		inputs["size"] = imagePixelSize(ratio, stringAny(inputs["image_size"]))
		return nil
	}
	var width, height, rw, rh float64
	if n, _ := fmt.Sscanf(strings.ToLower(size), "%fx%f", &width, &height); n == 2 && width > 0 && height > 0 {
		fmt.Sscanf(ratio, "%f:%f", &rw, &rh)
		if rh > 0 && (width/height > rw/rh*1.02 || width/height < rw/rh*0.98) {
			return fmt.Errorf("图片比例 %s 与像素尺寸 %s 冲突，请统一参数", ratio, size)
		}
	}
	return nil
}

func resolveCommerceBeforeGeneration(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, projectID int64, runtimeCfg, inputs, analysis, confirmed map[string]interface{}, prompt string, outputs map[string]interface{}) (map[string]interface{}, string) {
	var defaultsRaw, runtimeRaw []byte
	if err := pool.QueryRow(ctx, `SELECT default_params, runtime_rule FROM models WHERE code=$1 AND is_enabled=true`, stringAny(runtimeCfg["generation_model_code"])).Scan(&defaultsRaw, &runtimeRaw); err != nil {
		return nil, "生成模型不可用，无法确认实际生图参数"
	}
	defaults, runtimeRule := map[string]interface{}{}, map[string]interface{}{}
	_ = json.Unmarshal(defaultsRaw, &defaults)
	_ = json.Unmarshal(runtimeRaw, &runtimeRule)
	if !hasMeaningfulInput(inputs, "count") {
		count := intAny(runtimeCfg["default_count"])
		if count <= 0 {
			count = 1
		}
		inputs["count"] = count
	}
	inputs["n"] = inputs["count"]
	applyAgentModelDefaults(inputs, defaults, runtimeRule, "image")
	if err := prepareCommerceParameters(inputs); err != nil {
		return nil, err.Error()
	}
	draft := map[string]interface{}{"selected_prompt": prompt, "confirmed_prompt": firstNonEmpty(stringAny(confirmed["prompt"]), stringAny(confirmed["final_prompt"])), "negative_prompt": inputs["negative_prompt"], "asset_notes": analysis["asset_notes"], "style": analysis["style"], "design_system": analysis["design_system"]}
	if stringAny(inputs["creative_scene"]) == "detail_image" {
		draft["detail_sections"] = agentDetailSections(analysis, inputs, prompt)
	}
	signature := commerceResolutionKey(inputs, draft, runtimeCfg)
	if previous, ok := mapAny(outputs["commerce_resolution"]); ok && stringAny(previous["signature"]) == signature {
		if resolved, ok := mapAny(previous["analysis"]); ok && validateCommerceResolution(resolved, inputs) == nil {
			return resolved, ""
		}
	}
	requestInputs, config := copyMap(inputs), copyMap(runtimeCfg)
	requestInputs["_commerce_resolution"] = draft
	config["candidate_count"] = 1
	nodeRunID := insertWorkflowNodeRun(ctx, pool, projectID, "prompt_resolution", "生图前需求校对", "llm", map[string]interface{}{"signature": signature}, 0)
	start := time.Now()
	resolved, message := runAgentAnalysis(ctx, pool, baseURL, token, stringAny(config["analysis_model_code"]), "image", config, requestInputs)
	duration := int(time.Since(start).Milliseconds())
	if message != "" {
		pool.Exec(ctx, `UPDATE workflow_node_runs SET status='failed', output=$1, error=$2, duration_ms=$3, cost=$4 WHERE id=$5`, mustJSON(resolved), message, duration, floatAny(resolved["_analysis_cost"]), nodeRunID)
		return nil, message
	}
	updateNodeRunSuccess(ctx, pool, nodeRunID, resolved, floatAny(resolved["_analysis_cost"]), duration)
	outputs["commerce_resolution"] = map[string]interface{}{"signature": signature, "analysis": resolved}
	saveWorkflowOutputs(ctx, pool, projectID, outputs)
	return resolved, ""
}

const commerceTransformationInstruction = `创作优先级：用户当前明确输入及最新确认修改优先，内置规范仅补充用户未指定的部分。以下商品保真、默认姿态、视角、构图和背景规则均为辅助默认，不得覆盖用户明确要求；已指定坐姿、弯腿、踮脚、俯拍、夸张透视或设计修改时按用户要求执行，不自动改为站姿平视。仅保留用户未要求修改的商品特征；用户明确要求改变颜色、扣件或版型时作为指定设计修改执行，不再声称修改后是原商品的精确实物还原。不把默认设置冒充用户要求，不擅自添加与输入相反的限制。
商品保真与画面创作必须分开：参考图用于锁定商品款式、配色、材质纹理、结构、Logo与细节，不要求复制参考图的背景、摆放、视角或有无人像。
先识别用户明确要求改变什么，再把该变化写成候选提示词中的具体可见结果。用户要求人物穿着、佩戴、手持或使用商品时，必须新增或调整相应人物、身体部位、姿态和接触关系；不能因为参考图没有人物就省略人物，也不能仅换光线或背景。对于穿鞋任务，脚必须自然穿入鞋内，鞋口与脚踝正确衔接，左右脚和鞋匹配，尺码比例、遮挡和落地阴影可信。只要求双脚时不要擅自扩成全身人物。
明确要求创作变化时，不得直接复刻参考图或只做近似复制；只有用户要求保持原构图、修复或放大时才保留相应呈现。新人物或动作不得改变商品款式。
商品细节锁定：服装保留可见的版型轮廓、裁片分界、缝线走向、领口、袖口、门襟；拉链的数量、位置、走向、长度和开合状态，纽扣的可见数量、间距、排列及扣眼对应关系均以商品图为准。鞋类保留鞋头形状、鞋楦宽窄、鞋面分片、车线、鞋舌、鞋口、鞋带孔和穿法、鞋底厚度与轮廓。不得因穿戴、姿态变化或美化而增删扣件、断开缝线、改变版型或把左右鞋简单镜像成结构错误的同一只鞋。只锁定可观察到的细节；看不清的数量和被遮挡结构不猜测，不用锐化纹理伪造证据。
视角与姿态分开控制：分别明确相机俯仰、观察方向、商品朝向、身体朝向和裁切范围。用户已指定角度与腿部姿态时全部保留，不能为满足角度而弯腿、交叉腿或扭转脚踝；未指定姿态的上脚展示默认双腿自然伸展、双脚稳定落地，不增加踮脚、深蹲、交叉腿等动作。用户明确要求动作时执行该动作，膝盖、脚踝和脚尖方向在解剖上合理，避免广角透视拉长或压扁商品。
穿戴接触：鞋内脚部被鞋面正确遮挡，脚踝从鞋口进入，脚趾不穿出封闭鞋头，脚跟不穿出鞋后帮，鞋底与地面接触及受力一致；服装沿身体形成自然褶皱但保留裁片和缝线，皮肤、肢体与面料不能相互穿透，拉链与纽扣附着于正确衣片。不能靠改变鞋楦、鞋底或服装版型来迁就错误姿势。
多图依据：商品图只决定商品身份与结构，人物或姿态图只约束用户指定的人物、动作和构图，不能把姿态参考中的鞋服替换成目标商品。用户未要求换角度时，优先采用已有商品图能证明细节的视角；只有正面图时不擅自设计背面或内部特写。用户要求的新角度涉及不可见关键细节时，分析阶段明确列入 missing_information，不声称精确还原。
局部修正时只改用户指出的缺陷：已正确的商品结构、角度、姿态、裁切和背景保持不变；仍以原始商品图确认款式，不能将上一张错误生成图当作新的商品真值。`

func resolveCommerceScene(analysis, inputs map[string]interface{}) string {
	if scene := stringAny(inputs["creative_scene"]); scene != "" && scene != "auto" {
		return scene
	}
	if scene := stringAny(analysis["creative_scene"]); scene == "main_image" || scene == "scene_image" || scene == "detail_image" || scene == "marketing_poster" {
		return scene
	}
	brief := strings.ToLower(firstNonEmpty(stringAny(inputs["user_prompt"]), firstUserPrompt(inputs)))
	for _, match := range []struct {
		scene string
		words []string
	}{
		{"detail_image", []string{"详情页", "详情图", "详情长图", "detail page"}},
		{"marketing_poster", []string{"营销海报", "促销海报", "活动海报", "广告海报", "poster"}},
		{"main_image", []string{"商品主图", "电商主图", "白底主图", "main image"}},
		{"scene_image", []string{"场景图", "使用场景", "上脚", "穿着", "佩戴", "手持", "真人", "模特", "人物", "lifestyle"}},
	} {
		for _, word := range match.words {
			if strings.Contains(brief, word) {
				return match.scene
			}
		}
	}
	return "main_image"
}

// Reject incomplete planning instead of sending an explanation or generic
// fallback to the image model as if it were an optimized product prompt.
func validateCommerceAnalysis(analysis, inputs map[string]interface{}) error {
	if len(referenceImageURLs(inputs)) > 0 {
		notes := strings.ToLower(stringAny(analysis["asset_notes"]))
		for _, unavailable := range []string{"无法直接读取", "无法读取", "无法查看", "无法识别图片", "未能读取", "未提供可读视觉描述", "沿用用户确认描述", "看不到", "cannot view", "cannot access", "unable to view", "unable to access"} {
			if strings.Contains(notes, unavailable) {
				return fmt.Errorf("分析模型未能理解商品参考图，已停止生图；请检查分析模型及线路的实际视觉能力")
			}
		}
	}
	scene := stringAny(inputs["creative_scene"])
	if scene == "auto" {
		scene = resolveCommerceScene(analysis, inputs)
		analysis["creative_scene"] = scene
	}
	candidates := analysisCandidates(analysis)
	if len(candidates) == 0 {
		return fmt.Errorf("AI未返回可执行的商品出图方案，请重试需求分析")
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(stringAny(candidate["prompt"])) == "" {
			return fmt.Errorf("AI商品出图方案缺少生成提示词，请重试需求分析")
		}
	}
	if scene == "detail_image" {
		sections, _ := analysis["detail_sections"].([]interface{})
		if len(sections) != detailSectionCount(inputs) {
			return fmt.Errorf("AI详情模块数量不完整，请重试需求分析")
		}
		for _, raw := range sections {
			section, _ := raw.(map[string]interface{})
			if strings.TrimSpace(stringAny(section["image_prompt"])) == "" {
				return fmt.Errorf("AI详情模块缺少独立提示词，请重试需求分析")
			}
		}
	}
	return nil
}
