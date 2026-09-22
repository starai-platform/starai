package handler

import (
	"fmt"
	"log"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/starai/api/internal/service"
)

// This adapter repairs LLM proposals, not execution inputs. The strict service
// whitelist remains authoritative; unresolved changes never grant confirmation.
var creativeSlotGuidance = map[string]string{
	"quality":               "视频画质可选 480p、720p、1080p、2K、4K；图片清晰度可选 1K、2K、4K；也可回复“使用默认画质”，具体可用项会按所选模型核对",
	"aspect_ratio":          "画幅可选 9:16（竖屏）、16:9（横屏）、1:1、4:3、3:4",
	"target_duration_sec":   "请填写 1–600 的整数秒数，例如“10秒”；超出范围需调整时长，不会擅自截短",
	"media_type":            "请说明制作图片、视频、配音还是音乐",
	"audio_strategy":        "请说明使用视频原声、独立配音，还是混合音轨",
	"narration_perspective": "请说明自动安排、第一人称、第三人称或角色对白",
	"use_previous_media":    "请明确是否引用上一条生成的素材",
	"is_instrumental":       "请明确制作纯音乐还是带歌词的歌曲",
	"voice_gender":          "请明确使用男声还是女声",
	"speech_rate":           "请指定 0.5～2 倍语速",
	"max_speech_rate":       "请指定允许加速的上限（0.5～2 倍）",
	"prompt":                "请提供文本形式的制作需求（不超过 20000 字）",
	"script":                "请提供完整文案正文（不超过 20000 字）",
	"generation_prompt":     "请提供一个完整的生成提示词（不超过 20000 字）",
	"character":             "请用文字描述角色（不超过 20000 字）",
	"style":                 "请用文字描述风格（不超过 20000 字）",
	"ending":                "请用文字描述结尾（不超过 20000 字）",
	"music_prompt":          "请用文字描述曲风、情绪和场景（不超过 20000 字）",
	"platform":              "请用文字说明发布平台或用途（不超过 20000 字）",
	"image_count":           "图片或教学图页数量可选 1–6 张；更多内容请分批制作",
	"document_page_count":   "文档图片页数可选 1–100 页，或使用自动分页",
	"requirements":          "请将补充要求控制在 20000 字以内",
}

func normalizeCreativeSlotValue(key string, value interface{}) interface{} {
	s, ok := value.(string)
	if !ok {
		if key == "quality" {
			s = fmt.Sprint(value)
		} else {
			return value
		}
	}
	switch key {
	case "quality":
		s = strings.ToLower(strings.TrimSpace(s))
		switch s {
		case "480", "720", "1080":
			return s + "p"
		case "2160", "2160p", "uhd":
			return "4k"
		case "hd":
			return "720p"
		case "fhd", "full hd":
			return "1080p"
		}
		return s
	case "aspect_ratio":
		return strings.NewReplacer("：", ":", "/", ":", "×", ":", "x", ":", " ", "").Replace(strings.ToLower(strings.TrimSpace(s)))
	case "target_duration_sec":
		parts := regexp.MustCompile(`(?i)^\s*(\d+)\s*(?:秒|s|sec|seconds)?\s*$`).FindStringSubmatch(s)
		if len(parts) == 2 {
			if n, err := strconv.Atoi(parts[1]); err == nil {
				return n
			}
		}
	case "media_type", "audio_strategy", "narration_perspective":
		return strings.ToLower(strings.TrimSpace(s))
	case "voice_gender":
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "male", "man", "男", "男性", "男声":
			return "male"
		case "female", "woman", "女", "女性", "女声":
			return "female"
		}
	}
	return value
}

func prepareCreativeSlotUpdates(d *service.AgentDraft, updates, evidence map[string]interface{}, text string) (map[string]interface{}, map[string]interface{}, []string, error) {
	updates, evidence = copyStringMap(updates), copyStringMap(evidence)
	if d.SlotIssues == nil {
		d.SlotIssues = map[string]string{}
	}
	notes := []string{}
	// Retire the obsolete minimum-two error instead of trapping saved drafts.
	if d.SlotIssues["image_count"] == "图文配图数量可选 2–6 张" {
		delete(d.SlotIssues, "image_count")
		if count := creativeAgentRequestedImageCount(stringAny(d.Slots["prompt"])); count > 0 {
			updates["image_count"] = count
		}
	}
	if !creativeAgentTextOnly(text) && (creativeAgentContentImageWorkflowCue(text) || creativeAgentImageRequest(text) || stringAny(d.Slots["media_type"]) == "image" || stringAny(updates["media_type"]) == "image") {
		if count := creativeAgentRequestedImageCount(text); count > 0 {
			updates["image_count"], evidence["image_count"] = count, text
		}
	}
	// Descriptive fields invented by the planner are not upstream parameters.
	// Keep the user's wording while ignoring unrecognized executable fields.
	for key := range updates {
		if _, known := creativeSlotGuidance[key]; known {
			continue
		}
		delete(updates, key)
		delete(evidence, key)
		log.Printf("creative agent: ignored unsupported proposed slot %q", key)
		if strings.TrimSpace(text) != "" && !creativeAgentClarificationQuestion(text) {
			previous := stringAny(d.Slots["requirements"])
			if !strings.Contains(previous, strings.TrimSpace(text)) {
				updates["requirements"] = strings.TrimSpace(previous + "\n" + text)
				evidence["requirements"] = text
			}
		}
	}
	// Exact user constraints win even when the model omits or mistypes them.
	if lo, hi, ok := creativeAgentRequestedDuration(nil, text); ok {
		updates["target_duration_sec"], evidence["target_duration_sec"] = (lo+hi)/2, text
	}
	if invalid := regexp.MustCompile(`(?i)(?:^|[^\d])(-\d+(?:\.\d+)?|\d+\.\d+)\s*(?:秒|s\b)`).FindStringSubmatch(text); len(invalid) > 1 {
		updates["target_duration_sec"], evidence["target_duration_sec"] = invalid[1], text
	}
	if ratio, quote, ok := creativeAgentRequestedAspectRatio(text); ok {
		updates["aspect_ratio"], evidence["aspect_ratio"] = ratio, quote
	}
	if quality := regexp.MustCompile(`(?i)\b(?:\d{3,4}p|[248]k)\b`).FindString(text); quality != "" {
		updates["quality"], evidence["quality"] = quality, quality
	}
	if regexp.MustCompile(`(?:使用|采用|用|按)(?:模型)?默认画质`).MatchString(text) {
		delete(d.Slots, "quality")
		delete(d.Sources, "quality")
		delete(d.SlotIssues, "quality")
		delete(updates, "quality")
		notes = append(notes, "已按你的要求使用模型默认画质。")
	}
	if gender, quote, ok := creativeAgentRequestedVoiceGender(text); ok {
		updates["voice_gender"], evidence["voice_gender"] = gender, quote
	}
	if rate, maxRate, ok := creativeAgentRequestedSpeechRates(text); ok {
		updates["speech_rate"], evidence["speech_rate"] = rate, text
		updates["max_speech_rate"], evidence["max_speech_rate"] = maxRate, text
	}
	if regexp.MustCompile(`纯音乐|无歌词|不要歌词|不需要歌词`).MatchString(text) {
		updates["is_instrumental"], evidence["is_instrumental"] = true, text
	} else if regexp.MustCompile(`带歌词|有人声|演唱|唱一首`).MatchString(text) {
		updates["is_instrumental"], evidence["is_instrumental"] = false, text
	}
	keys := make([]string, 0, len(updates))
	for key := range updates {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := updates[key]
		guidance := creativeSlotGuidance[key]
		quote := stringAny(evidence[key])
		explicit := strings.TrimSpace(quote) != "" && strings.Contains(text, quote)
		if key == "aspect_ratio" {
			// A usage quote such as “官网” is a recommendation basis, not an
			// explicit request for the planner's chosen orientation.
			ratio, _, ok := creativeAgentRequestedAspectRatio(quote)
			if !ok || ratio != normalizeCreativeSlotValue(key, value) {
				explicit = false
				delete(evidence, key)
			}
		}
		qualityMentioned := regexp.MustCompile(`(?i)画质|清晰度|分辨率|高清|超清|\b(?:\d+[pk]|f?hd|uhd)\b`).MatchString(text)
		if key == "quality" && !qualityMentioned {
			// A quote like "做成视频" is not evidence of a quality preference.
			explicit = false
			delete(evidence, key)
		}
		// Null is omission, not permission to erase an established requirement.
		if value == nil {
			delete(updates, key)
			continue
		}
		normalized := normalizeCreativeSlotValue(key, value)
		probe := &service.AgentDraft{}
		err := service.ApplyAgentSlotUpdates(probe, map[string]interface{}{key: normalized}, nil, "")
		if err != nil {
			delete(updates, key)
			if key == "quality" && !qualityMentioned {
				notes = append(notes, "已忽略自动推断的不规范画质，保留已有画质；未设置时使用模型默认值。")
				continue
			}
			d.SlotIssues[key] = guidance
			continue
		}
		// A later inferred default must not silently resolve a user's unsupported request.
		if _, blocked := d.SlotIssues[key]; blocked && !explicit {
			delete(updates, key)
			continue
		}
		delete(d.SlotIssues, key)
		updates[key] = normalized
		if !reflect.DeepEqual(value, normalized) && (explicit || d.Slots[key] == nil) {
			notes = append(notes, fmt.Sprintf("已将参数 %s 规范为 %v。", key, normalized))
		}
	}
	return updates, evidence, notes, nil
}

// Resolve common delivery contexts before model validation and canvas creation.
// Explicit orientation always wins; mixed contexts require a user decision.
func creativeAgentVideoAspectRatio(d *service.AgentDraft) {
	d.Init()
	if d.SlotIssues["aspect_ratio"] != "" {
		return
	}
	ratio := stringAny(d.Slots["aspect_ratio"])
	source := d.Sources["aspect_ratio"]
	if requested, _, ok := creativeAgentRequestedAspectRatio(source.Evidence); ratio != "" && source.Source == "user" && ok && requested == ratio {
		return
	}
	platform := strings.TrimSpace(stringAny(d.Slots["platform"]))
	horizontal := regexp.MustCompile(`(?i)官网|官方网站|网站首页|桌面端|演示大屏|发布会大屏|website|landing\s*page`).MatchString(platform)
	vertical := regexp.MustCompile(`(?i)抖音|tiktok|shorts|reels|手机全屏|移动端全屏`).MatchString(platform)
	ambiguous := horizontal && !vertical && regexp.MustCompile(`(?i)手机|移动|mobile`).MatchString(platform)
	if horizontal != vertical && !ambiguous {
		ratio = "16:9"
		if vertical {
			ratio = "9:16"
		}
		d.SetSlot("aspect_ratio", ratio, "scenario", platform)
		delete(d.SlotIssues, "aspect_ratio")
	} else if horizontal || (platform == "" && source.Source == "inferred") || source.Source == "scenario" {
		delete(d.Slots, "aspect_ratio")
		delete(d.Sources, "aspect_ratio")
	}
}

func creativeAgentRequestedSpeechRates(text string) (float64, float64, bool) {
	if !regexp.MustCompile(`语速|倍速|加速|播放速度`).MatchString(text) {
		return 0, 0, false
	}
	matches := regexp.MustCompile(`(\d+(?:\.\d+)?)\s*倍`).FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return 0, 0, false
	}
	rate, _ := strconv.ParseFloat(matches[0][1], 64)
	maximum := rate
	if len(matches) > 1 && regexp.MustCompile(`可以|允许|最高|最多|上限|必要时`).MatchString(text) {
		maximum, _ = strconv.ParseFloat(matches[len(matches)-1][1], 64)
	}
	return rate, maximum, true
}

func creativeAgentRequestedVoiceGender(text string) (string, string, bool) {
	pattern := regexp.MustCompile(`(?i)(不要|不用|不是|拒绝|取消)?\s*(男声|女声|男性|女性|male|female)`)
	gender, quote := "", ""
	for _, match := range pattern.FindAllStringSubmatch(text, -1) {
		if strings.TrimSpace(match[1]) != "" {
			continue
		}
		quote = strings.TrimSpace(match[2])
		switch strings.ToLower(quote) {
		case "男声", "男性", "male":
			gender = "male"
		case "女声", "女性", "female":
			gender = "female"
		}
	}
	return gender, quote, gender != ""
}

func creativeAgentRequestedAspectRatio(text string) (string, string, bool) {
	pattern := regexp.MustCompile(`(?i)(不要(?:使用|用|做成|生成)?|不是|拒绝|取消)?\s*(9\s*[:：/]\s*16|16\s*[:：/]\s*9|1\s*[:：/]\s*1|4\s*[:：/]\s*3|3\s*[:：/]\s*4|portrait|vertical|landscape|horizontal|竖屏|纵向|横屏|横向)`)
	ratio, quote := "", ""
	for _, match := range pattern.FindAllStringSubmatch(text, -1) {
		if strings.TrimSpace(match[1]) != "" {
			continue
		}
		quote = strings.TrimSpace(match[2])
		switch strings.ToLower(strings.NewReplacer(" ", "", "：", ":", "/", ":").Replace(quote)) {
		case "竖屏", "纵向", "portrait", "vertical", "9:16":
			ratio = "9:16"
		case "横屏", "横向", "landscape", "horizontal", "16:9":
			ratio = "16:9"
		case "1:1":
			ratio = "1:1"
		case "4:3":
			ratio = "4:3"
		case "3:4":
			ratio = "3:4"
		}
	}
	if ratio != "" {
		return ratio, quote, true
	}
	if match := regexp.MustCompile(`(?i)\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b`).FindStringSubmatch(text); len(match) == 3 {
		width, _ := strconv.Atoi(match[1])
		height, _ := strconv.Atoi(match[2])
		if width > 0 && height > width {
			return "9:16", match[0], true
		}
		if height > 0 && width > height {
			return "16:9", match[0], true
		}
	}
	return "", "", false
}
