package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// photoStudioTypes 写真类型拍摄方向字典
var photoStudioTypes = map[string]string{
	"写真":  "艺术写真：强调情绪表达与氛围营造，姿态自然多变，光影层次丰富，杂志级画质",
	"职业照": "职业商务照：正式商务着装，坐姿或站姿端正，自信温和的微笑，干净背景，柔和三点布光，半身构图，突出专业与可信赖感",
	"证件照": "标准证件照：严格半身构图，面部占画面约三分之二，正视镜头，双耳清晰可见，表情自然端庄，均匀柔光无阴影，纯色背景，符合证件照规范",
}

// photoStudioStyles 风格倾向字典，每种风格一句摄影指导
var photoStudioStyles = map[string]string{
	"影棚质感":  "专业影棚布光，主灯与轮廓灯立体塑形，高级灰调背景，皮肤质感细腻",
	"杂志大片":  "时尚杂志封面级构图，强烈光影对比，高级感姿态，editorial风格后期",
	"黑白艺术":  "黑白胶片影调，高对比光影，突出面部轮廓与情绪张力，经典肖像质感",
	"韩系简约":  "韩式清新妆造，低饱和奶油色调，柔光打底，干净简约的背景",
	"日系清新":  "日系胶片感，过曝柔光，清淡色调，自然生活化的情绪捕捉",
	"港风胶片":  "港式复古胶片颗粒，浓郁红蓝色调，霓虹氛围，90年代明星写真感",
	"法式复古":  "法式慵懒浪漫，暖调胶片色彩，自然卷发与复古着装氛围，柔和窗光",
	"美式复古":  "美式复古色调，柯达胶片质感，自由奔放的姿态，阳光与公路元素",
	"国风古装":  "中国古风汉服造型，亭台楼阁或水墨背景，飘逸衣袂，古典东方美学",
	"旗袍风情":  "旗袍造型，东方韵味姿态，复古卷发光影，老上海风情布景",
	"新中式":   "新中式美学，现代剪裁中式元素服装，留白构图，雅致莫兰迪色调",
	"森系文艺":  "森林绿植环绕，自然光斑透过树叶，棉麻服装，清新文艺气息",
	"咖啡馆日常": "咖啡馆场景，暖黄灯光，拿铁与书本道具，放松的生活化抓拍感",
	"都市夜景":  "都市霓虹夜景，车流光轨与橱窗光影，冷调时尚街拍感",
	"海边度假":  "海滨度假风，碧海白沙，飘逸裙摆，夕阳金光，轻松度假氛围",
	"校园青春":  "校园青春风，教室操场背景，白衬衫校服元素，阳光活力的笑脸",
	"轻奢名媛":  "轻奢名媛风，精致礼服与珠宝，高级酒店或艺术空间布景，优雅姿态",
	"甜美少女":  "甜美少女风，粉嫩马卡龙色调，花朵与气球道具，俏皮可爱的表情",
	"酷飒街头":  "街头潮流风，oversize穿搭，涂鸦墙或天桥背景，硬朗光影，酷感表情",
	"运动活力":  "运动活力风，运动装束，动感姿态，汗水与阳光，充满能量的构图",
	"赛博霓虹":  "赛博朋克霓虹光效，蓝紫粉撞色光晕，未来科技感妆造与背景",
	"暗调情绪":  "低调暗调情绪片，单光源伦勃朗光，深邃阴影，强烈的情绪表达",
	"户外自然":  "户外自然风光，草地山川为背景，自然光黄金时刻，舒展大气的构图",
	"婚纱浪漫":  "婚纱浪漫风，洁白婚纱与头纱，柔焦逆光，唯美浪漫的仪式感",
	"雪景冬日":  "冬日雪景，飘雪与暖色围巾，冷白背景中的温暖情绪，呼出的白气",
	"商务精英":  "商务精英风，深色西装与质感配饰，写字楼背景，干练果断的气场",
	"纯白极简":  "纯白极简空间，白色服装，高调柔光，极简留白构图，纯净通透",
	"毕业季":   "毕业季主题，学士服与校园地标，抛学士帽的欢乐瞬间，青春纪念感",
	"古典油画":  "古典油画质感，文艺复兴式布光与构图，浓郁油彩肌理，古典华服",
	"二次元动漫": "二次元动漫风，漫展cos妆造，鲜明色彩，还原动漫角色设定的氛围",
	"敦煌飞天":  "敦煌飞天主题，壁画色彩与飘带元素，异域妆造，神秘华丽的东方美学",
	"民族风":   "民族风情，少数民族服饰与银饰，地域特色场景，浓郁的色彩表达",
	"金秋落叶":  "金秋落叶场景，暖橙色调，梧桐银杏大道，温柔知性的秋日氛围",
	"樱花春景":  "樱花春景，粉白花瓣飘落，柔光下的浪漫人像，清新甜美的春日感",
	"Y2K千禧": "Y2K千禧风，金属质感与高饱和撞色，复古数码相机质感，千禧辣妹造型",
	"多巴胺糖果": "多巴胺糖果色，高饱和明快撞色，活泼道具与夸张表情，快乐感染力",
	"欧式宫廷":  "欧式宫廷风，洛可可华服与宫廷布景，烛光辉映，油画般的华丽光影",
	"沙漠戈壁":  "沙漠戈壁场景，苍茫大地与长风，异域风情服饰，电影感广角构图",
}

// processPhotoStudioWorkflow AI写真馆：上传照片 + 写真类型 + 风格倾向，先由LLM设计拍摄方案，再批量生成写真
func processPhotoStudioWorkflow(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, publicID string, estimated float64, inputs, runtimeCfg map[string]interface{}) error {
	outputs := loadWorkflowOutputs(ctx, pool, p.ProjectID)
	autopilot := boolAny(outputs["autopilot"]) || stringAny(inputs["_mode"]) == "auto"

	// 幂等：生成已完成则直接收尾
	if _, done := outputs["media_tasks"]; done && stringAny(outputs["current_step"]) == "result" {
		return completeSimpleAgentWorkflow(ctx, pool, p, publicID, estimated, outputs)
	}

	photoURL := firstImageURL(inputs)
	if photoURL == "" {
		return failWorkflow(ctx, pool, p, publicID, estimated, "请先上传一张本人照片")
	}

	photoType := firstNonEmpty(stringAny(inputs["photo_type"]), "写真")
	styleName := stringAny(inputs["style"])
	if styleName == "" && photoType != "证件照" {
		styleName = "影棚质感"
	}
	basePrompt := buildPhotoStudioPrompt(photoType, styleName, stringAny(inputs["id_background"]), firstUserPrompt(inputs))

	// 阶段1：写真造型设计（LLM 可选增强，失败回退模板prompt）
	if _, done := outputs["styling"]; !done {
		nodeRunID := insertWorkflowNodeRun(ctx, pool, p.ProjectID, "styling", "写真造型设计", "llm", map[string]interface{}{
			"image_url":  photoURL,
			"photo_type": photoType,
			"style":      styleName,
			"model_code": stringAny(runtimeCfg["analysis_model_code"]),
		}, 1)
		start := time.Now()
		styling, errMsg := runPhotoStyling(ctx, pool, baseURL, token, p.ProjectID, runtimeCfg, inputs, basePrompt)
		if errMsg != "" {
			styling = map[string]interface{}{
				"generation_prompt": basePrompt,
				"summary":           basePrompt,
				"status":            "fallback",
			}
		}
		styling["photo_type"] = photoType
		styling["style"] = styleName
		styling["base_prompt"] = basePrompt
		styling["created_at"] = time.Now().Format(time.RFC3339)
		updateNodeRunSuccess(ctx, pool, nodeRunID, map[string]interface{}{"summary": stringAny(styling["summary"])}, floatAny(styling["_analysis_cost"]), int(time.Since(start).Milliseconds()))

		outputs["styling"] = styling
		outputs["current_step"] = "confirm"
		outputs["autopilot"] = autopilot
		saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
		if !autopilot {
			pool.Exec(ctx, `UPDATE workflow_projects SET status='waiting_confirm', updated_at=now() WHERE id=$1`, p.ProjectID)
			return nil
		}
	}
	styling := mapAnyOr(outputs["styling"], map[string]interface{}{})

	// 用户在确认页可修改拍摄方案
	confirmed := mapAnyOr(outputs["confirmation_payload"], map[string]interface{}{})
	if edited := stringAny(confirmed["prompt"]); edited != "" {
		styling["generation_prompt"] = edited
		styling["summary"] = edited
		outputs["styling"] = styling
		saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
	}
	finalPrompt := firstNonEmpty(
		stringAny(confirmed["prompt"]),
		stringAny(styling["generation_prompt"]),
		stringAny(styling["summary"]),
		basePrompt,
	)

	// 阶段2：写真拍摄生成（支持用户在前端选择 image 模型）
	genModelCode := firstNonEmpty(stringAny(inputs["model_code"]), stringAny(runtimeCfg["generation_model_code"]))
	genRuntime := copyMap(runtimeCfg)
	genRuntime["generation_model_code"] = genModelCode
	genRuntime["generation_type"] = "image"
	genInputs := copyMap(inputs)
	if stringAny(genInputs["aspect_ratio"]) == "" {
		genInputs["aspect_ratio"] = "3:4"
	}
	genInputs["reference_images"] = []string{photoURL}

	nodeRunID := insertWorkflowNodeRun(ctx, pool, p.ProjectID, "generate", "写真拍摄生成", "image", map[string]interface{}{
		"image_url":  photoURL,
		"model_code": genModelCode,
		"count":      intAny(genInputs["count"]),
	}, 2)
	start := time.Now()
	results, errMsg := runAgentMediaTasks(ctx, pool, baseURL, token, p.ProjectID, p.UserID, publicID, genRuntime, genInputs, finalPrompt)
	outputs["media_tasks"] = results
	outputs["current_step"] = "result"
	if errMsg != "" {
		saveWorkflowOutputs(ctx, pool, p.ProjectID, outputs)
		return failWorkflow(ctx, pool, p, publicID, estimated, "写真拍摄生成失败："+errMsg)
	}
	updateNodeRunSuccess(ctx, pool, nodeRunID, map[string]interface{}{"count": len(results)}, 0, int(time.Since(start).Milliseconds()))

	return completeSimpleAgentWorkflow(ctx, pool, p, publicID, estimated, outputs)
}

// runPhotoStyling 调LLM把基础prompt丰富为详细拍摄方案；未配置模型或失败时由调用方回退模板prompt
func runPhotoStyling(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, projectID int64, runtimeCfg, inputs map[string]interface{}, basePrompt string) (map[string]interface{}, string) {
	modelCode := firstNonEmpty(stringAny(runtimeCfg["analysis_model_code"]), "chat_demo_v1")
	model, errMsg := loadAgentAnalysisModel(ctx, pool, modelCode)
	if errMsg != "" {
		return nil, errMsg
	}

	system := `你是一位资深人像摄影造型总监。请根据用户照片拍摄需求，输出一份可直接用于AI绘画的拍摄方案JSON（不要markdown代码块）：
{
  "summary": "给用户的方案摘要，中文，100字以内，说明妆造、服装、场景与布光设计",
  "generation_prompt": "完整英文绘画提示词：以 preserve the exact facial features, face shape, skin tone and hairstyle of the person in the reference photo 开头，随后描述写真类型、风格、妆造、服装、场景、布光、构图与画质要求，不超过300词"
}`
	user := fmt.Sprintf("拍摄需求：%s\n\n请输出拍摄方案JSON。", basePrompt)

	requestID := fmt.Sprintf("photo_styling_%d", projectID)
	result, err := executeWorkerLLMWithRoutes(ctx, pool, baseURL, token, requestID, model, system, user, 0.7, 120*time.Second, referenceImageURLs(inputs)...)
	if err != nil {
		return nil, "模型服务异常：" + err.Error()
	}
	text := extractLLMText(result.ResponseBody)
	if strings.TrimSpace(text) == "" {
		return nil, "模型未返回拍摄方案"
	}

	out := parseJSONish(text)
	if stringAny(out["generation_prompt"]) == "" && stringAny(out["summary"]) == "" {
		out = map[string]interface{}{
			"generation_prompt": basePrompt,
			"summary":           basePrompt,
		}
	}
	if stringAny(out["status"]) == "" {
		out["status"] = "completed"
	}
	out["raw_text"] = text

	pt, ct, crt, cwt := chatUsageTokenDetails(result.ResponseBody)
	out["_analysis_cost"] = estimateModelCostByCodeWorker(ctx, pool, modelCode, result.RequestBody, pt, ct, crt, cwt)
	out["_provider_cost"] = workerRouteProviderCost(result.Route, result.RequestBody, pt, ct, crt, cwt)
	out["_route_id"] = nullableRouteID(result.Route.ID)
	return out, ""
}

// idPhotoBackgroundSpec 证件照底色按国内通行标准色值约束，
// 避免模型自由发挥导致审核系统不认（蓝底用于毕业证/工作证/求职，红底用于结婚登记/党团证件）。
func idPhotoBackgroundSpec(idBackground string) string {
	switch idBackground {
	case "蓝色":
		return "标准证件蓝纯色背景，色值 RGB(67,142,219) / #438EDB，整幅背景颜色均匀一致，不得有渐变、阴影或杂物"
	case "红色":
		return "标准正红纯色背景，色值 RGB(255,0,0) / #FF0000，整幅背景颜色均匀一致，不得有渐变、阴影或杂物"
	case "白色":
		return "纯白纯色背景，色值 RGB(255,255,255)，整幅背景颜色均匀一致，不得有阴影或杂物"
	default:
		return idBackground + "纯色背景，整幅背景颜色均匀一致"
	}
}

// buildPhotoStudioPrompt 模板prompt：确保写真类型、风格、底色与用户要求全部被实际消费
func buildPhotoStudioPrompt(photoType, styleName, idBackground, userPrompt string) string {
	var b strings.Builder
	b.WriteString("professional photorealistic portrait photography, strictly preserve the exact facial features, face shape, skin tone and hairstyle of the person in the reference photo")
	if direction, ok := photoStudioTypes[photoType]; ok {
		b.WriteString("；拍摄方向：" + direction)
	} else {
		b.WriteString("；拍摄方向：" + photoType)
	}
	if strings.TrimSpace(styleName) != "" {
		if direction, ok := photoStudioStyles[styleName]; ok {
			b.WriteString("；风格要求：" + direction)
		} else {
			b.WriteString("；风格要求：" + styleName)
		}
	}
	if photoType == "证件照" && idBackground != "" {
		b.WriteString("；背景底色：" + idPhotoBackgroundSpec(idBackground))
	}
	if strings.TrimSpace(userPrompt) != "" {
		b.WriteString("；额外要求：" + strings.TrimSpace(userPrompt))
	}
	b.WriteString("。画质要求：8K超高清，真实皮肤质感，无面部畸变，无多余手指，光影自然")
	return b.String()
}
