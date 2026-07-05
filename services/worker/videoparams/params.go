package videoparams

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// BuildUpstreamVideoPayload maps platform task params to NEW API video body.
func BuildUpstreamVideoPayload(
	modelCode, newAPIModel string,
	runtimeRule, extraParams map[string]interface{},
	params map[string]interface{},
) map[string]interface{} {
	upCfg := parseUpstreamConfig(runtimeRule)
	modelName := newAPIModel
	if modelName == "" {
		modelName = modelCode
	}
	out := map[string]interface{}{"model": modelName}
	if prompt, ok := params["prompt"].(string); ok {
		out["prompt"] = prompt
	}
	for k, v := range extraParams {
		// connection 仅用于 Worker 鉴权，绝不能进入上游请求体
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
		for k := range params {
			if k != "prompt" {
				include = append(include, k)
			}
		}
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
		out[upKey] = normalizeUpstreamValue(val)
	}
	out = ApplyUpstreamTransforms(out, runtimeRule, params)
	return SanitizeUpstreamPayload(out, "")
}

// SanitizeUpstreamPayload removes platform-only fields and normalizes common video API shapes.
// endpoint hint: e.g. "/v1/videos" enables Sora-style image_url promotion.
func SanitizeUpstreamPayload(out map[string]interface{}, endpoint string) map[string]interface{} {
	delete(out, "connection")
	for _, k := range []string{
		"n", "count", "duration", "asset_ids", "reference_asset_ids", "file_asset_ids",
		"role_prompt", "channel_key", "fallback_enabled", "web_search", "timeout_sec", "asset_context",
		"negative_prompt", "style", "selling_points", "user_intent", "asset_notes",
		"language", "language_label", "language_name", "generation_language", "generation_language_label", "generation_language_name",
		"_skip_billing", "_workflow_project",
	} {
		delete(out, k)
	}
	normalizeAspectRatioField(out)
	if endpoint == "" || strings.Contains(endpoint, "/v1/videos") {
		if isVeoVideoModel(out["model"]) {
			promoteVeoImages(out)
		} else {
			promoteSoraImageURL(out)
		}
	}
	return out
}

func isVeoVideoModel(v interface{}) bool {
	model := strings.ToLower(strings.TrimSpace(fmt.Sprint(v)))
	return strings.Contains(model, "veo")
}

func normalizeAspectRatioField(out map[string]interface{}) {
	val, ok := out["aspect_ratio"]
	if !ok {
		if o, ok := out["orientation"].(string); ok {
			val = o
			delete(out, "orientation")
		} else {
			return
		}
	}
	switch strings.ToLower(strings.TrimSpace(fmt.Sprint(val))) {
	case "portrait", "vertical", "9:16":
		out["aspect_ratio"] = "9:16"
	case "landscape", "horizontal", "16:9":
		out["aspect_ratio"] = "16:9"
	default:
		out["aspect_ratio"] = strings.TrimSpace(fmt.Sprint(val))
	}
}

func promoteSoraImageURL(out map[string]interface{}) {
	if _, ok := out["image_url"]; ok {
		delete(out, "reference_images")
		delete(out, "image")
		delete(out, "images")
		delete(out, "first_frame")
		delete(out, "last_frame")
		return
	}
	for _, key := range []string{"image", "reference_images", "first_frame"} {
		v, ok := out[key]
		if !ok {
			continue
		}
		if s := firstMediaURL(v); s != "" {
			out["image_url"] = s
		}
		delete(out, key)
		break
	}
	delete(out, "images")
	delete(out, "last_frame")
}

func promoteVeoImages(out map[string]interface{}) {
	var images []string
	add := func(v interface{}) {
		for _, s := range mediaURLList(v) {
			if s != "" {
				images = append(images, s)
			}
		}
	}
	add(out["images"])
	add(out["first_frame"])
	add(out["last_frame"])
	add(out["reference_images"])
	add(out["image_url"])
	add(out["image"])
	if len(images) > 0 {
		out["images"] = images
	}
	delete(out, "first_frame")
	delete(out, "last_frame")
	delete(out, "reference_images")
	delete(out, "image_url")
	delete(out, "image")
}

func firstMediaURL(v interface{}) string {
	list := mediaURLList(v)
	if len(list) > 0 {
		return list[0]
	}
	return ""
}

func mediaURLList(v interface{}) []string {
	switch t := v.(type) {
	case string:
		if s := strings.TrimSpace(t); s != "" {
			return []string{s}
		}
	case []string:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s := strings.TrimSpace(item); s != "" {
				out = append(out, s)
			}
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s := strings.TrimSpace(fmt.Sprint(item)); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// ApplyUpstreamTransforms applies runtime_rule.upstream post-processing:
// value_map (e.g. portrait -> 9:16), model_template (e.g. sora-2-{duration}s), strip_params.
func ApplyUpstreamTransforms(out map[string]interface{}, runtimeRule, params map[string]interface{}) map[string]interface{} {
	up, _ := runtimeRule["upstream"].(map[string]interface{})
	if up == nil {
		normalizeAspectRatioField(out)
		return out
	}
	if vm, ok := up["value_map"].(map[string]interface{}); ok {
		for field, mappingRaw := range vm {
			mapping, _ := mappingRaw.(map[string]interface{})
			if mapping == nil {
				continue
			}
			cur, ok := out[field]
			if !ok {
				continue
			}
			key := strings.TrimSpace(fmt.Sprint(cur))
			if mapped, ok := mapping[key].(string); ok && mapped != "" {
				out[field] = mapped
			}
		}
	}
	if tmpl, ok := up["model_template"].(string); ok && strings.Contains(tmpl, "{duration}") {
		dur := durationDigits(params, out)
		out["model"] = strings.ReplaceAll(tmpl, "{duration}", dur)
	}
	if arr, ok := up["strip_params"].([]interface{}); ok {
		for _, item := range arr {
			if key, ok := item.(string); ok {
				delete(out, key)
			}
		}
	}
	return out
}

func durationDigits(params, out map[string]interface{}) string {
	if d, ok := params["duration"].(string); ok {
		s := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(d), "s"), "S")
		if s != "" {
			return s
		}
	}
	if d, ok := out["duration"].(int); ok && d > 0 {
		return strconv.Itoa(d)
	}
	if d, ok := out["duration"].(float64); ok && d > 0 {
		return strconv.Itoa(int(math.Round(d)))
	}
	return "12"
}

type upstreamConfig struct {
	Include []string
	Map     map[string]string
	Static  map[string]interface{}
}

func parseUpstreamConfig(runtimeRule map[string]interface{}) upstreamConfig {
	cfg := upstreamConfig{Map: map[string]string{}, Static: map[string]interface{}{}}
	if runtimeRule == nil {
		return cfg
	}
	up, _ := runtimeRule["upstream"].(map[string]interface{})
	if up == nil {
		return cfg
	}
	if arr, ok := up["include"].([]interface{}); ok {
		for _, item := range arr {
			if s, ok := item.(string); ok {
				cfg.Include = append(cfg.Include, s)
			}
		}
	}
	if m, ok := up["map"].(map[string]interface{}); ok {
		for k, v := range m {
			if s, ok := v.(string); ok {
				cfg.Map[k] = s
			}
		}
	}
	if st, ok := up["static"].(map[string]interface{}); ok {
		cfg.Static = st
	}
	return cfg
}

func omitAutoValue(val interface{}) bool {
	switch v := val.(type) {
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "auto") || strings.TrimSpace(v) == ""
	}
	return false
}

func normalizeUpstreamValue(val interface{}) interface{} {
	switch v := val.(type) {
	case string:
		trimmed := strings.TrimSpace(v)
		if strings.HasSuffix(trimmed, "s") || strings.HasSuffix(trimmed, "S") {
			s := strings.TrimSuffix(strings.TrimSuffix(trimmed, "s"), "S")
			if n, err := strconv.ParseFloat(s, 64); err == nil {
				return int(math.Round(n))
			}
		}
		return v
	default:
		b, _ := json.Marshal(val)
		var out interface{}
		_ = json.Unmarshal(b, &out)
		return out
	}
}

func ParseRuntimeRuleJSON(raw []byte) map[string]interface{} {
	out := map[string]interface{}{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func ParseExtraParamsJSON(raw []byte) map[string]interface{} {
	out := map[string]interface{}{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func StringFromAny(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}
