package service

import (
	"errors"
	"strings"
)

// ValidateAudioParams checks input_schema enums/required fields for audio tasks.
func ValidateAudioParams(model *ModelFull, params map[string]interface{}) error {
	return validateSchemaParams(model.InputSchema, params)
}

// BuildUpstreamAudioPayload maps platform params to NEW API request body.
func BuildUpstreamAudioPayload(model *ModelFull, params map[string]interface{}) map[string]interface{} {
	upCfg := parseUpstreamConfig(model.RuntimeRule)
	modelName := model.NewAPIModel
	if modelName == "" {
		modelName = model.Code
	}
	out := map[string]interface{}{}
	setPayloadValue(out, mappedUpstreamKey(upCfg, "model", "model"), modelName)
	if prompt, ok := params["prompt"].(string); ok {
		setPayloadValue(out, mappedUpstreamKey(upCfg, "prompt", "prompt"), prompt)
	}
	if text, ok := params["input"].(string); ok && out["prompt"] == nil && out["text"] == nil {
		setPayloadValue(out, mappedUpstreamKey(upCfg, "input", "input"), text)
	}
	for k, v := range model.NewAPIExtraParams {
		if k == "connection" {
			continue
		}
		out[k] = v
	}
	if upCfg.Static != nil {
		for k, v := range upCfg.Static {
			out[k] = v
		}
	}
	include := upCfg.Include
	if len(include) == 0 {
		include = defaultUpstreamInclude(params)
	}
	for _, key := range include {
		val, ok := params[key]
		if !ok || val == nil {
			continue
		}
		upKey := key
		if upCfg.Map != nil {
			if mapped, ok := upCfg.Map[key]; ok && mapped != "" {
				upKey = mapped
			}
		}
		if omitAutoValue(val) {
			continue
		}
		setPayloadValue(out, upKey, normalizeUpstreamValue(val))
	}
	return out
}

func validateAudioTaskParams(model *ModelFull, params map[string]interface{}) error {
	prompt := strings.TrimSpace(audioStringValue(params["prompt"]))
	if parseAudioRuntimeConfig(model.RuntimeRule)["prompt_required"] != false {
		if prompt == "" {
			return errors.New("请填写文本内容")
		}
	}
	modelName := strings.ToLower(strings.TrimSpace(model.NewAPIModel))
	endpoint := strings.ToLower(strings.TrimSpace(model.NewAPIEndpoint))
	lyrics := strings.TrimSpace(audioStringValue(params["lyrics"]))
	if lyrics == "" && mappedUpstreamKey(parseUpstreamConfig(model.RuntimeRule), "prompt", "prompt") == "lyrics" {
		// Some music APIs name the primary user textarea "prompt" locally but
		// map it to lyrics upstream. Validate the canonical value we will send.
		lyrics = prompt
	}
	musicPrompt := strings.TrimSpace(audioStringValue(params["music_prompt"]))
	if strings.Contains(modelName, "fun-music") {
		if prompt == "" && lyrics == "" {
			return errors.New("音乐描述和歌词至少填写一项")
		}
	}
	if strings.Contains(endpoint, "music_generation") && (strings.HasPrefix(modelName, "music-3.0") || strings.HasPrefix(modelName, "music-2.6")) {
		instrumental := audioBoolValue(params["is_instrumental"])
		optimizer := audioBoolValue(params["lyrics_optimizer"])
		if instrumental && musicPrompt == "" {
			return errors.New("纯音乐模式必须填写音乐描述")
		}
		if !instrumental && lyrics == "" && !optimizer {
			return errors.New("非纯音乐模式必须填写歌词，或开启歌词优化")
		}
		if !instrumental && lyrics == "" && optimizer && musicPrompt == "" {
			return errors.New("自动生成歌词时必须填写音乐描述")
		}
	}
	return ValidateAudioParams(model, params)
}

func audioBoolValue(value interface{}) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
	case float64:
		return typed != 0
	case int:
		return typed != 0
	default:
		return false
	}
}

func audioStringValue(value interface{}) string {
	text, _ := value.(string)
	return text
}

func parseAudioRuntimeConfig(runtimeRule map[string]interface{}) map[string]interface{} {
	if runtimeRule == nil {
		return map[string]interface{}{}
	}
	audio, _ := runtimeRule["audio"].(map[string]interface{})
	if audio == nil {
		return map[string]interface{}{}
	}
	return audio
}
