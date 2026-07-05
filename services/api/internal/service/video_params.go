package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ValidateVideoParams checks upload slots + input_schema enums/required fields.
func ValidateVideoParams(model *ModelFull, params map[string]interface{}) error {
	cfg := parseVideoRuntimeConfig(model.RuntimeRule)
	if err := validateVideoUpload(cfg, params); err != nil {
		return err
	}
	return validateSchemaParams(model.InputSchema, params)
}

// BuildUpstreamVideoPayload maps platform params to NEW API request body.
func BuildUpstreamVideoPayload(model *ModelFull, params map[string]interface{}) map[string]interface{} {
	upCfg := parseUpstreamConfig(model.RuntimeRule)
	modelName := model.NewAPIModel
	if modelName == "" {
		modelName = model.Code
	}
	out := map[string]interface{}{"model": modelName}
	if prompt, ok := params["prompt"].(string); ok {
		out["prompt"] = prompt
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
		out[upKey] = normalizeUpstreamValue(val)
	}
	return out
}

func parseDurationSeconds(params map[string]interface{}) float64 {
	raw, ok := params["duration"]
	if !ok {
		return 5
	}
	switch v := raw.(type) {
	case float64:
		if v > 0 {
			return v
		}
	case int:
		if v > 0 {
			return float64(v)
		}
	case string:
		s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(v, "s"), "S"))
		if n, err := strconv.ParseFloat(s, 64); err == nil && n > 0 {
			return n
		}
	}
	return 5
}

type videoRuntimeConfig struct {
	UploadProfile      string
	MinReferenceImages int
	MaxReferenceImages int
	MaxTotalImages     int
	CountTowardTotal   bool
	FirstFrameKey      string
	LastFrameKey       string
	ReferenceImagesKey string
	RefSlotMax         int
	PromptRequired     bool
}

type upstreamConfig struct {
	Include []string
	Map     map[string]string
	Static  map[string]interface{}
}

func parseVideoRuntimeConfig(runtimeRule map[string]interface{}) videoRuntimeConfig {
	cfg := videoRuntimeConfig{
		UploadProfile:      "single_ref",
		MinReferenceImages: 0,
		MaxReferenceImages: 1,
		MaxTotalImages:     9,
		CountTowardTotal:   true,
		FirstFrameKey:      "first_frame",
		LastFrameKey:       "last_frame",
		ReferenceImagesKey: "reference_images",
		RefSlotMax:         4,
		PromptRequired:     true,
	}
	if runtimeRule == nil {
		return cfg
	}
	video, _ := runtimeRule["video"].(map[string]interface{})
	if video == nil {
		return cfg
	}
	if s, ok := video["upload_profile"].(string); ok && s != "" {
		cfg.UploadProfile = s
	}
	cfg.MinReferenceImages = intFromAny(video["min_reference_images"], cfg.MinReferenceImages)
	cfg.MaxReferenceImages = intFromAny(video["max_reference_images"], cfg.MaxReferenceImages)
	cfg.MaxTotalImages = intFromAny(video["max_total_images"], cfg.MaxTotalImages)
	if v, ok := video["count_toward_total"].(bool); ok {
		cfg.CountTowardTotal = v
	}
	if v, ok := video["prompt_required"].(bool); ok {
		cfg.PromptRequired = v
	}
	if frames, ok := video["frames"].(map[string]interface{}); ok {
		if first, ok := frames["first"].(map[string]interface{}); ok {
			if k, ok := first["key"].(string); ok && k != "" {
				cfg.FirstFrameKey = k
			}
		}
		if last, ok := frames["last"].(map[string]interface{}); ok {
			if k, ok := last["key"].(string); ok && k != "" {
				cfg.LastFrameKey = k
			}
		}
	}
	if ref, ok := video["reference_images"].(map[string]interface{}); ok {
		if k, ok := ref["key"].(string); ok && k != "" {
			cfg.ReferenceImagesKey = k
		}
		cfg.RefSlotMax = intFromAny(ref["max"], cfg.RefSlotMax)
	}
	if cfg.MaxReferenceImages < 0 {
		cfg.MaxReferenceImages = 0
	}
	if cfg.MaxReferenceImages > 20 {
		cfg.MaxReferenceImages = 20
	}
	return cfg
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

func validateVideoUpload(cfg videoRuntimeConfig, params map[string]interface{}) error {
	refKey := cfg.ReferenceImagesKey
	firstKey := cfg.FirstFrameKey
	lastKey := cfg.LastFrameKey

	refCount := urlFieldCount(params[refKey])
	firstCount := singleURLCount(params[firstKey])
	lastCount := singleURLCount(params[lastKey])
	total := refCount
	if cfg.CountTowardTotal {
		total += firstCount + lastCount
	}

	switch cfg.UploadProfile {
	case "none":
		return nil
	case "multi_ref":
		if refCount < cfg.MinReferenceImages {
			return fmt.Errorf("至少需要 %d 张参考图", cfg.MinReferenceImages)
		}
		if refCount > cfg.MaxReferenceImages {
			return errors.New("参考图数量超过模型限制")
		}
	case "frame_pair":
		if refCount > cfg.RefSlotMax {
			return errors.New("参考图数量超过模型限制")
		}
		if firstCount > 1 || lastCount > 1 {
			return errors.New("首尾帧各只能上传 1 张")
		}
		if cfg.MaxTotalImages > 0 && total > cfg.MaxTotalImages {
			return errors.New("上传图片总数超过模型限制")
		}
	default: // single_ref
		if refCount > cfg.MaxReferenceImages {
			return errors.New("参考图数量超过模型限制")
		}
	}
	return nil
}

func validateSchemaParams(inputSchema map[string]interface{}, params map[string]interface{}) error {
	props, _ := inputSchema["properties"].(map[string]interface{})
	if props == nil {
		return nil
	}
	required, _ := inputSchema["required"].([]interface{})
	for _, r := range required {
		key, _ := r.(string)
		if key == "" {
			continue
		}
		if _, ok := params[key]; !ok {
			return fmt.Errorf("缺少必填参数: %s", key)
		}
	}
	for key, raw := range props {
		prop, _ := raw.(map[string]interface{})
		if prop == nil {
			continue
		}
		val, exists := params[key]
		if !exists {
			continue
		}
		if enum, ok := prop["enum"].([]interface{}); ok && len(enum) > 0 {
			if enumContains(enum, val) {
				continue
			}
			if allowCustom, _ := prop["x-allow-custom"].(bool); allowCustom && validateIntRange(prop, val) {
				continue
			}
			return fmt.Errorf("参数 %s 的值无效", key)
		}
	}
	return nil
}

func validateImageTaskParams(model *ModelFull, params map[string]interface{}) error {
	maxRefs := maxReferenceImages(model)
	if refs, ok := params["reference_images"]; ok {
		if referenceImageCount(refs) > maxRefs {
			return errors.New("参考图数量超过模型限制")
		}
	}
	return validateSchemaParams(model.InputSchema, params)
}

func defaultUpstreamInclude(params map[string]interface{}) []string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "prompt" {
			continue
		}
		keys = append(keys, k)
	}
	return keys
}

func urlFieldCount(v interface{}) int {
	switch arr := v.(type) {
	case []interface{}:
		n := 0
		for _, item := range arr {
			if str, ok := item.(string); ok && strings.TrimSpace(str) != "" {
				n++
			}
		}
		return n
	case []string:
		n := 0
		for _, s := range arr {
			if strings.TrimSpace(s) != "" {
				n++
			}
		}
		return n
	case string:
		if strings.TrimSpace(arr) != "" {
			return 1
		}
	}
	return 0
}

func singleURLCount(v interface{}) int {
	return urlFieldCount(v)
}

func enumContains(enum []interface{}, val interface{}) bool {
	for _, item := range enum {
		if fmt.Sprint(item) == fmt.Sprint(val) {
			return true
		}
	}
	return false
}

func validateIntRange(prop map[string]interface{}, val interface{}) bool {
	n := intFromAny(val, -1)
	if n < 1 {
		return false
	}
	min := intFromAny(prop["minimum"], 1)
	max := intFromAny(prop["maximum"], 50)
	return n >= min && n <= max
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
		if strings.HasSuffix(strings.TrimSpace(v), "s") || strings.HasSuffix(strings.TrimSpace(v), "S") {
			s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(v, "s"), "S"))
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

func intFromAny(v interface{}, fallback int) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		if i, err := strconv.Atoi(n); err == nil {
			return i
		}
	}
	return fallback
}
