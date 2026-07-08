package service

import "errors"

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
	if parseAudioRuntimeConfig(model.RuntimeRule)["prompt_required"] != false {
		prompt, _ := params["prompt"].(string)
		if prompt == "" {
			return errors.New("请填写文本内容")
		}
	}
	return ValidateAudioParams(model, params)
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
