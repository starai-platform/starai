package handler

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/starai/api/internal/service"
)

// Normalize deliverable nouns before checking verbs: writing a video prompt is
// not making a video. Keep a separate later "再生成视频" clause executable.
func creativeAgentMediaRequest(text string) bool {
	if creativeAgentGenerationProhibited(text) {
		return false
	}
	if creativeAgentContentImageWorkflowCue(text) {
		return true
	}
	if creativeAgentSpeechRequest(text) {
		return true
	}
	text = creativeAgentWithoutTextOnlyImages(text)
	text = regexp.MustCompile(`(?i)(?:短视频|视频|短剧|图片|图像|图)(?:生成)?\s*(?:的)?\s*(提示词|prompt|文案|脚本)|生成(?:视频|图片|图)(?:的)?提示词`).ReplaceAllString(text, "文字稿")
	return regexp.MustCompile(`(生成|制作|做成|合成|转成|画).{0,40}(视频|短视频|短剧|成片|图片|图像|图|海报|插画|配音|音乐|歌曲)`).MatchString(text)
}

func creativeAgentContentImageWorkflowCue(text string) bool {
	if creativeAgentDocumentImageRequest(text) {
		return true
	}
	text = strings.ToLower(strings.TrimSpace(text))
	if regexp.MustCompile(`(?:不要|不用|无需|不需要)\s*(?:生成)?(?:配图|图片)|纯文字|只(?:要|写)(?:正文|文案|文字)`).MatchString(text) {
		return false
	}
	content := `(?:图文(?:内容|帖子|笔记|方案)?|配图|轮播图|卡片图)`
	return regexp.MustCompile(`(?:生成|制作|创作|产出|做|整理成|写|撰写).{0,32}` + content + `|` + content + `.{0,20}(?:生成|制作|创作|产出|做一套|撰写)`).MatchString(text)
}

func creativeAgentDocumentImageRequest(text string) bool {
	if creativeAgentGenerationProhibited(text) || regexp.MustCompile(`只(?:要|写)(?:正文|文案|文字)|纯文字|(?:写|优化|修改|提供).{0,10}提示词|^(?:为什么|怎么|如何|解释|读取)`).MatchString(text) {
		return false
	}
	action := regexp.MustCompile(`(?i)生成|制作|做成|做出|绘制|画成|转成|转为|整理成`).MatchString(text)
	educational := regexp.MustCompile(`教辅|教学.{0,8}(?:图|册)|学习笔记|手绘笔记|知识卡|绘本|绘画册|图文画册|图文绘画册`).MatchString(text)
	document := regexp.MustCompile(`(?i)(?:文档|word|pdf|docx|附件).{0,45}(?:图片|图页|插图|配图|图文|画册)`).MatchString(text)
	visualBrief := educational && regexp.MustCompile(`图片|图页|图文画册|绘画册|知识卡`).MatchString(text) && regexp.MustCompile(`输出|排版|绘制|生成|制作`).MatchString(text)
	return action && (educational || document) || visualBrief
}

func creativeAgentWithoutTextOnlyImages(text string) string {
	if regexp.MustCompile(`(?:不要|不用|无需|不需要)\s*(?:生成)?(?:配图|图片)|纯文字|只(?:要|写)(?:正文|文案|文字)`).MatchString(text) {
		text = regexp.MustCompile(`(?:不要|不用|无需|不需要)\s*(?:生成)?(?:配图|图片)`).ReplaceAllString(text, "")
		text = strings.ReplaceAll(text, "图文", "文字")
	}
	return text
}

func creativeAgentImageRequest(text string) bool {
	if creativeAgentGenerationProhibited(text) || creativeAgentContentImageWorkflowCue(text) {
		return false
	}
	text = creativeAgentWithoutTextOnlyImages(text)
	text = regexp.MustCompile(`(?i)(?:图片|图像|图)(?:生成)?\s*(?:的)?\s*(?:提示词|prompt|文案|脚本)|生成(?:图片|图)(?:的)?提示词`).ReplaceAllString(text, "文字稿")
	return regexp.MustCompile(`(?:生成|制作|做成|画|出).{0,32}(?:图片|图像|图|海报|插画)`).MatchString(text)
}

func creativeAgentVideoRequest(text string) bool {
	if creativeAgentGenerationProhibited(text) {
		return false
	}
	text = regexp.MustCompile(`(?i)(?:视频|短视频|短剧)(?:生成)?\s*(?:的)?\s*(?:提示词|prompt|文案|脚本)|生成(?:视频|短视频|短剧)(?:的)?提示词`).ReplaceAllString(text, "文字稿")
	return regexp.MustCompile(`(?:生成|制作|做成|合成|转成|拍).{0,40}(?:视频|短视频|短剧|成片)`).MatchString(text)
}

func creativeAgentSpeechRequest(text string) bool {
	return !creativeAgentGenerationProhibited(text) && regexp.MustCompile(`(?:转换成|转成|生成|制作|合成|朗读|读出|转为).{0,35}(?:音频|语音|配音)|(?:朗读|配音).{0,20}(?:文案|正文|这段|这份)`).MatchString(text)
}

func creativeAgentGenerationProhibited(text string) bool {
	return regexp.MustCompile(`^(取消|停止)|(?:先别|不要|不用|暂不|不需要)(再|继续|自动|立即|直接|现在|马上|帮我|去|先|\s)*(生成|制作|执行)`).MatchString(strings.TrimSpace(text))
}

func creativeAgentPromptDraftRequest(text string) bool {
	return regexp.MustCompile(`(?i)提示词|\bprompt\b`).MatchString(text) && !creativeAgentMediaRequest(text)
}

func creativeAgentWritingRequest(text string) bool {
	return creativeAgentPromptDraftRequest(text) || regexp.MustCompile(`(?i)(写|创作|编|改|润色|完善|整理|生成|导出).{0,30}(合同|协议|文档|条款|报告|简历|word|pdf|docx|文案|脚本|故事|歌词|文章|推文|笔记|文字内容|资料|信息)|(?:合同|协议|文档|条款|报告|简历|文案|脚本|故事|歌词|文章|文字内容|资料|信息).{0,12}(改|润色|完善|整理)`).MatchString(text)
}

func creativeAgentResearchOnly(text string) bool {
	return !creativeAgentMediaRequest(text) && regexp.MustCompile(`搜索|联网|热搜|榜单|检索|提取.{0,20}(文案|内容)`).MatchString(text)
}

func creativeAgentClarificationQuestion(text string) bool {
	return regexp.MustCompile(`^(这是什么|为什么|为何|怎么回事|什么意思|解释|说明|不对|有问题|具体.*(参数|不支持)|我不是.*(提交|说过|告诉))`).MatchString(strings.TrimSpace(text))
}

func creativeAgentTextOnly(text string) bool {
	// These are conservative safety guards; semantic understanding stays with
	// the planner. Mentioning a medium is not authorization to generate it.
	text = strings.TrimSpace(text)
	if creativeAgentGenerationProhibited(text) {
		return true
	}
	if creativeAgentContentImageWorkflowCue(text) {
		return false
	}
	if creativeAgentPromptDraftRequest(text) || creativeAgentClarificationQuestion(text) || regexp.MustCompile(`^(你这.*(啥|什么)|你.*整理.*(啥|什么))`).MatchString(text) {
		return true
	}
	// "生成视频文案" produces text; "根据文案生成视频" produces media.
	if creativeAgentMediaRequest(text) {
		return false
	}
	return regexp.MustCompile(`(?i)合同|协议|文档|条款|报告|简历|\bword\b|\bpdf\b|\bdocx\b|文案|脚本|歌词|文章|推文|笔记|纯文字|文字内容|资料|信息|写.{0,8}故事|解释|这是什么|什么意思|怎么回事|先别|先讨论`).MatchString(text)
}

func guardCreativeAgentIntent(plan map[string]interface{}, text string) map[string]interface{} {
	intent := strings.ToLower(strings.TrimSpace(stringAny(plan["intent"])))
	if intent == "text" || (creativeAgentTextOnly(text) && intent != "chat" && intent != "clarify") {
		reply := stringAny(plan["reply"])
		if reply == "" && creativeAgentPromptDraftRequest(text) {
			reply = creativeAgentArtifactCandidate(plan)
		}
		if reply == "" {
			reply = "我先和你确认需求或解释当前内容，不会创建生成任务。"
		}
		// Preserve the validated delta: changing the route must not discard edits.
		plan = copyStringMap(plan)
		plan["intent"], plan["reply"], plan["prompt"] = "chat", reply, ""
		plan["params"], plan["needs_confirm"] = map[string]interface{}{}, false
		plan["workflow_code"] = ""
		return plan
	}
	plan["needs_confirm"] = intent == "image" || intent == "video" || intent == "workflow" || intent == "speech" || intent == "music"
	return plan
}

func (h *Handler) prepareCreativeAgentPlan(ctx context.Context, plan map[string]interface{}, text, videoCode string) map[string]interface{} {
	plan = guardCreativeAgentIntent(plan, text)
	intent := stringAny(plan["intent"])
	if intent != "video" && intent != "workflow" {
		return plan
	}
	if videoCode == "" {
		videoCode = stringAny(h.creativeAgentRuntimeConfig(ctx)["video_model_code"])
	}
	model, err := h.models.GetFullByCode(ctx, videoCode)
	if err != nil || model == nil || !model.IsEnabled || model.RequestMode != "video" {
		return map[string]interface{}{"intent": "clarify", "reply": "请先选择已启用的视频模型，再确认生成计划。"}
	}
	return prepareCreativeAgentVideoPlan(plan, text, model)
}

func prepareCreativeAgentVideoPlan(plan map[string]interface{}, text string, model *service.ModelFull) map[string]interface{} {
	params, _ := plan["params"].(map[string]interface{})
	params = copyStringMap(params)
	// Explicit latest-user duration wins over a stale planner/default value.
	minimum, maximum, ok := creativeAgentRequestedDuration(nil, text)
	if !ok {
		minimum, maximum, ok = creativeAgentRequestedDuration(params, "")
	}
	if !ok {
		return map[string]interface{}{"intent": "clarify", "reply": "希望成品视频总共多少秒？确认目标时长后，我会按所选模型的能力规划分段。"}
	}
	target := (minimum + maximum) / 2
	count, seconds, err := service.AgentVideoLayout(model, target)
	if err != nil {
		return map[string]interface{}{"intent": "clarify", "reply": err.Error()}
	}
	params["target_duration_sec"], params["duration"] = target, seconds
	params["video_model_code"] = model.Code
	var invalidField, invalidReason string
	params, invalidField, invalidReason = creativeAgentVideoModelParams(model, params)
	if invalidReason != "" {
		return map[string]interface{}{"intent": "clarify", "reply": invalidReason, "needs_confirm": false, "invalid_field": invalidField}
	}
	plan["model_code"], plan["needs_confirm"] = model.Code, true
	if count > 1 || seconds != target || stringAny(plan["intent"]) == "workflow" || creativeAgentWorkflowCue(text) {
		requestedWorkflow := stringAny(plan["workflow_code"])
		plan["intent"], plan["workflow_code"] = "workflow", "video_creation"
		if requestedWorkflow == "one_click_viral_remake" || requestedWorkflow == "viral_remake" {
			plan["workflow_code"] = requestedWorkflow
		}
		if strings.Contains(text, "复刻") || strings.Contains(text, "反推") {
			plan["workflow_code"] = "one_click_viral_remake"
		}
		params["storyboard_grid"], params["segment_duration_sec"], params["_mode"] = count, seconds, "auto"
		plan["reply"] = fmt.Sprintf("待确认：使用 %s 生成 %d 段素材（每段 %d 秒），对齐后合成为 %d 秒成品。确认后才开始生成。", model.Code, count, seconds, target)
		if count == 1 && seconds > target {
			plan["reply"] = fmt.Sprintf("已按 %d 秒成品规划。所选模型单次生成 %d 秒，将生成素材后裁剪到 %d 秒，保留你的目标时长。请核对内容方案后确认。", target, seconds, target)
		}
	} else {
		plan["intent"], plan["workflow_code"] = "video", ""
		plan["reply"] = fmt.Sprintf("待确认：使用 %s 生成一段 %d 秒视频。确认后才开始生成。", model.Code, target)
	}
	plan["params"] = params
	if field, issue := creativeVideoParameterIssue(model, params); issue != "" {
		return map[string]interface{}{"intent": "clarify", "reply": issue, "needs_confirm": false, "invalid_field": field}
	}
	return plan
}

func creativeVideoParameterIssue(model *service.ModelFull, params map[string]interface{}) (string, string) {
	properties, _ := model.InputSchema["properties"].(map[string]interface{})
	for _, field := range []struct {
		slot, label string
		keys        []string
	}{
		{"quality", "画质", []string{"resolution", "quality"}},
		{"aspect_ratio", "画幅", []string{"ratio", "aspect_ratio"}},
	} {
		value := stringAny(params[field.slot])
		if value == "" {
			continue
		}
		for _, key := range field.keys {
			spec, _ := properties[key].(map[string]interface{})
			options := []string{}
			switch items := spec["enum"].(type) {
			case []interface{}:
				for _, item := range items {
					options = append(options, fmt.Sprint(item))
				}
			case []string:
				options = items
			}
			if len(options) == 0 {
				continue
			}
			matched := false
			for _, option := range options {
				if normalizeCreativeSlotValue(field.slot, option) == value {
					matched = true
					break
				}
			}
			if !matched {
				return field.slot, fmt.Sprintf("所选模型 %s 不支持当前%s %s，可选：%s。请修改%s或更换模型后确认，其他需求已保留。", model.Code, field.label, value, strings.Join(options, "、"), field.label)
			}
			break
		}
	}
	return "", ""
}

// Recheck capabilities at execution so a changed model/schema cannot silently
// replace the duration or segment count the user just confirmed.
func validateCreativeVideoExecution(model *service.ModelFull, params map[string]interface{}, workflow bool) error {
	normalized, _, issue := creativeAgentVideoModelParams(model, params)
	if issue != "" {
		return fmt.Errorf("%s", issue)
	}
	for _, key := range []string{"size", "resolution", "quality", "ratio", "aspect_ratio", "orientation"} {
		if fmt.Sprint(normalized[key]) != fmt.Sprint(params[key]) {
			return fmt.Errorf("视频模型参数映射已变化，请重新规划并确认后执行")
		}
	}
	if _, issue := creativeVideoParameterIssue(model, params); issue != "" {
		return fmt.Errorf("%s", issue)
	}
	target := creativeAgentPositiveInt(params["target_duration_sec"])
	count, seconds, err := service.AgentVideoLayout(model, target)
	if err != nil {
		return err
	}
	if workflow {
		if creativeAgentPositiveInt(params["storyboard_grid"]) != count || creativeAgentPositiveInt(params["segment_duration_sec"]) != seconds {
			return fmt.Errorf("视频模型能力或分段方案已变化，请重新规划并确认后执行")
		}
	} else if count != 1 || seconds != target || creativeAgentPositiveInt(params["duration"]) != seconds {
		return fmt.Errorf("目标时长需要分段或裁剪，请先确认成片工作流，不能直接改用模型默认时长")
	}
	return nil
}

func creativeAgentVideoModelParams(model *service.ModelFull, params map[string]interface{}) (map[string]interface{}, string, string) {
	out := copyStringMap(params)
	quality := normalizeCreativeSlotValue("quality", stringAny(params["quality"]))
	qualityText, _ := quality.(string)
	ratio := stringAny(params["aspect_ratio"])
	properties, _ := model.InputSchema["properties"].(map[string]interface{})

	qualityCapability := false
	for _, key := range []string{"resolution", "quality"} {
		options := creativeAgentModelEnum(properties, key)
		if len(options) == 0 {
			continue
		}
		qualityCapability = true
		if qualityText == "" {
			continue
		}
		matched := ""
		for _, option := range options {
			if normalizeCreativeSlotValue("quality", option) == qualityText {
				matched = option
				break
			}
		}
		if matched == "" {
			return out, "quality", fmt.Sprintf("所选模型 %s 不支持当前画质 %s，可选：%s。请修改画质或更换模型后确认，其他需求已保留。", model.Code, qualityText, strings.Join(options, "、"))
		}
		out[key] = matched
		break
	}

	ratioCapability := false
	for _, key := range []string{"ratio", "aspect_ratio", "orientation"} {
		options := creativeAgentModelEnum(properties, key)
		if len(options) == 0 {
			continue
		}
		ratioCapability = true
		if ratio == "" {
			continue
		}
		for _, option := range options {
			if normalizeCreativeSlotValue("aspect_ratio", option) == ratio {
				out[key] = option
				break
			}
		}
	}

	sizes := creativeAgentModelEnum(properties, "size")
	if len(sizes) > 0 && (ratio != "" || qualityText != "") {
		qualityCapability, ratioCapability = true, true
		wantedRatio := ratio
		defaultSize := stringAny(model.DefaultParams["size"])
		if wantedRatio == "" {
			if width, height, ok := creativeAgentVideoDimensions(defaultSize); ok {
				wantedRatio = creativeAgentDimensionRatio(width, height)
			}
		}
		wantedShort := map[string]int{"480p": 480, "720p": 720, "1k": 720, "1080p": 1080, "2k": 1440, "4k": 2160}[qualityText]
		defaultShort := 0
		if width, height, ok := creativeAgentVideoDimensions(defaultSize); ok {
			defaultShort = min(width, height)
		}
		selected := ""
		for _, option := range sizes {
			width, height, ok := creativeAgentVideoDimensions(option)
			if !ok || (wantedRatio != "" && creativeAgentDimensionRatio(width, height) != wantedRatio) || (wantedShort > 0 && min(width, height) != wantedShort) {
				continue
			}
			if selected == "" || (wantedShort == 0 && min(width, height) == defaultShort) {
				selected = option
			}
		}
		if selected == "" {
			field, label, value := "aspect_ratio", "画幅", ratio
			if qualityText != "" {
				field, label, value = "quality", "画质", qualityText
			}
			return out, field, fmt.Sprintf("所选模型 %s 不支持当前%s %s，可选尺寸：%s。请修改%s或更换模型后确认，其他需求已保留。", model.Code, label, value, strings.Join(sizes, "、"), label)
		}
		out["size"] = selected
	}
	if qualityText != "" && !qualityCapability {
		return out, "quality", fmt.Sprintf("所选模型 %s 没有可确认的画质参数，请使用模型默认画质或更换模型。", model.Code)
	}
	if ratio != "" && !ratioCapability {
		return out, "aspect_ratio", fmt.Sprintf("所选模型 %s 没有可确认的画幅参数，请使用模型默认画幅或更换模型。", model.Code)
	}
	return out, "", ""
}

func creativeAgentImageModelParams(model *service.ModelFull, params map[string]interface{}) (map[string]interface{}, string, string) {
	out := copyStringMap(params)
	quality := stringAny(normalizeCreativeSlotValue("quality", stringAny(params["quality"])))
	if quality == "" {
		return out, "", ""
	}
	tier := map[string]string{"1k": "1K", "2k": "2K", "4k": "4K"}[quality]
	defaultTier := strings.ToUpper(strings.TrimSpace(stringAny(model.DefaultParams["quality"])))
	if tier == "" || (defaultTier != "1K" && defaultTier != "2K" && defaultTier != "4K") {
		return out, "quality", fmt.Sprintf("所选图片模型 %s 不能按 %s 精确确认清晰度；请改用 1K、2K、4K 或模型默认画质。", model.Code, quality)
	}
	image, _ := model.RuntimeRule["image"].(map[string]interface{})
	if supported := stringSliceAny(image["supported_sizes"]); len(supported) > 0 {
		allowed := false
		for _, value := range supported {
			if strings.EqualFold(value, tier) {
				allowed = true
				break
			}
		}
		if !allowed {
			return out, "quality", fmt.Sprintf("所选图片模型 %s 不支持 %s，可选：%s。", model.Code, tier, strings.Join(supported, "、"))
		}
	}
	out["quality"], out["image_size"] = tier, tier
	return out, "", ""
}

func stringSliceAny(value interface{}) []string {
	result := []string{}
	switch items := value.(type) {
	case []interface{}:
		for _, item := range items {
			if text := strings.TrimSpace(stringAny(item)); text != "" {
				result = append(result, text)
			}
		}
	case []string:
		result = append(result, items...)
	}
	return result
}

func creativeAgentModelEnum(properties map[string]interface{}, key string) []string {
	property, _ := properties[key].(map[string]interface{})
	values := []string{}
	switch items := property["enum"].(type) {
	case []interface{}:
		for _, item := range items {
			values = append(values, fmt.Sprint(item))
		}
	case []string:
		values = append(values, items...)
	}
	return values
}

func creativeAgentVideoDimensions(value string) (int, int, bool) {
	parts := strings.FieldsFunc(strings.ToLower(strings.TrimSpace(value)), func(r rune) bool { return r == 'x' || r == '×' || r == '*' })
	if len(parts) != 2 {
		return 0, 0, false
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	return width, height, widthErr == nil && heightErr == nil && width > 0 && height > 0
}

func creativeAgentDimensionRatio(width, height int) string {
	switch {
	case width*16 == height*9:
		return "9:16"
	case width*9 == height*16:
		return "16:9"
	case width == height:
		return "1:1"
	case width*3 == height*4:
		return "4:3"
	case width*4 == height*3:
		return "3:4"
	default:
		return ""
	}
}

func creativeAgentVoiceForGender(model *service.ModelFull, gender string) (string, string, bool) {
	properties, _ := model.InputSchema["properties"].(map[string]interface{})
	for _, key := range []string{"voice", "voice_id"} {
		property, _ := properties[key].(map[string]interface{})
		if property == nil {
			continue
		}
		preferred, _ := property["x-agent-default-by-gender"].(map[string]interface{})
		if value := stringAny(preferred[gender]); value != "" {
			return key, value, true
		}
		labels, _ := property["enumLabels"].(map[string]interface{})
		genders, _ := property["x-option-genders"].(map[string]interface{})
		for _, value := range creativeAgentModelEnum(properties, key) {
			hint := strings.ToLower(value + " " + stringAny(labels[value]))
			optionGender := strings.ToLower(stringAny(genders[value]))
			maleHint := (strings.Contains(hint, "male") && !strings.Contains(hint, "female")) || strings.Contains(hint, "男")
			femaleHint := strings.Contains(hint, "female") || strings.Contains(hint, "女")
			if optionGender == gender || (gender == "male" && maleHint) || (gender == "female" && femaleHint) {
				return key, value, true
			}
		}
	}
	return "", "", false
}

func creativeAgentMusicNeedsStyle(model *service.ModelFull) bool {
	audio, _ := model.RuntimeRule["audio"].(map[string]interface{})
	return stringAny(audio["input_layout"]) == "dual"
}

func creativeAgentAudioSupportsReference(model *service.ModelFull) bool {
	upstream, _ := model.RuntimeRule["upstream"].(map[string]interface{})
	switch include := upstream["include"].(type) {
	case []interface{}:
		for _, item := range include {
			if key := stringAny(item); key == "reference_audio" || key == "reference_audios" {
				return true
			}
		}
	case []string:
		for _, key := range include {
			if key == "reference_audio" || key == "reference_audios" {
				return true
			}
		}
	}
	return false
}

func prepareCreativeMusicExecution(model *service.ModelFull, prompt string, params map[string]interface{}) (string, map[string]interface{}) {
	out := copyStringMap(params)
	audio, _ := model.RuntimeRule["audio"].(map[string]interface{})
	secondaryKey := strings.TrimSpace(stringAny(audio["secondary_prompt_key"]))
	style := strings.TrimSpace(stringAny(out["music_prompt"]))
	instrumental := out["is_instrumental"] == true
	properties, _ := model.InputSchema["properties"].(map[string]interface{})
	if options := creativeAgentModelEnum(properties, "mode"); len(options) > 0 {
		wanted := "song"
		if instrumental {
			wanted = "instrumental"
		}
		for _, option := range options {
			if strings.EqualFold(option, wanted) {
				out["mode"] = option
				break
			}
		}
	}
	if secondaryKey == "lyrics" {
		if instrumental {
			delete(out, "lyrics")
		} else if strings.TrimSpace(prompt) != "" {
			out["lyrics"] = prompt
		}
		if style != "" {
			prompt = style
		}
	} else if secondaryKey != "" && secondaryKey != "music_prompt" && style != "" {
		out[secondaryKey] = style
	}
	if instrumental && secondaryKey == "music_prompt" && audio["prompt_required"] == false {
		prompt = ""
	}
	return prompt, out
}

func applyCreativeVideoReferenceMode(model *service.ModelFull, params map[string]interface{}, imageCount, videoCount, audioCount int) error {
	if imageCount+videoCount+audioCount == 0 {
		return nil
	}
	video, _ := model.RuntimeRule["video"].(map[string]interface{})
	profile := strings.ToLower(strings.TrimSpace(stringAny(video["upload_profile"])))
	modeKey := strings.TrimSpace(stringAny(video["mode_param"]))
	if modeKey == "" {
		modeKey = "generation_mode"
	}
	switch profile {
	case "veo_reference", "omni_reference":
		if videoCount+audioCount > 0 {
			return fmt.Errorf("所选视频模型当前只支持图片参考，不能可靠使用参考视频或音频；请更换模型或移除不支持的素材")
		}
		params[modeKey] = "reference"
	case "seedance_2":
		parts := []string{}
		if imageCount > 0 {
			parts = append(parts, "image")
		}
		if videoCount > 0 {
			parts = append(parts, "video")
		}
		if audioCount > 0 {
			parts = append(parts, "audio")
		}
		params[modeKey] = strings.Join(parts, "_")
	case "aliyun_multimodal":
		params[modeKey] = "reference"
	case "none", "aliyun_happyhorse_text":
		return fmt.Errorf("所选视频模型不支持参考素材，请更换模型或移除素材")
	default:
		properties, _ := model.InputSchema["properties"].(map[string]interface{})
		for _, option := range creativeAgentModelEnum(properties, modeKey) {
			if strings.EqualFold(option, "reference") {
				params[modeKey] = option
				return nil
			}
		}
		if videoCount+audioCount > 0 {
			return fmt.Errorf("所选视频模型没有可确认的参考视频或音频模式，请更换模型或移除素材")
		}
	}
	return nil
}
