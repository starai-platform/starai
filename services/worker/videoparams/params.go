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
	out := map[string]interface{}{}
	setPayloadValue(out, mappedUpstreamKey(upCfg, "model", "model"), modelName)
	if prompt, ok := params["prompt"].(string); ok {
		setPayloadValue(out, mappedUpstreamKey(upCfg, "prompt", "prompt"), prompt)
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
	uploadProfile := videoUploadProfile(runtimeRule)
	if uploadProfile == "frame_pair" || uploadProfile == "veo_frame_pair" {
		include = appendMissing(include, "first_frame", "last_frame", "reference_images")
	}
	for _, key := range include {
		val, ok := params[key]
		if !ok || val == nil {
			continue
		}
		if key == "duration" {
			val = normalizeVideoDuration(val)
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
		if key == "duration" && upKey == "duration" {
			out["_preserve_video_params"] = true
		}
	}
	out = ApplyUpstreamTransforms(out, runtimeRule, params)
	if strings.EqualFold(upCfg.Adapter, "volcengine_seedance_2") {
		out = buildVolcengineSeedancePayload(out, params)
	}
	if strings.EqualFold(upCfg.Adapter, "minimax_h3_v2") {
		out = buildMiniMaxH3Payload(out, params)
	}
	if strings.EqualFold(upCfg.Adapter, "veo_reference_v1") {
		out = buildVeoReferencePayload(out, params)
	}
	if strings.EqualFold(upCfg.Adapter, "veo_frame_pair_v1") {
		out = buildVeoFramePairPayload(out, params)
	}
	if strings.EqualFold(upCfg.Adapter, "omni_reference_v1") {
		out = buildOmniReferencePayload(out, params)
	}
	if strings.EqualFold(upCfg.Adapter, "aliyun_qwen_image_v3") {
		out = buildAliyunQwenImagePayload(modelName, params)
	}
	if strings.EqualFold(upCfg.Adapter, "aliyun_video_generation") {
		out = buildAliyunVideoPayload(modelName, params)
	}
	if strings.EqualFold(upCfg.Adapter, "sync_lipsync") {
		// Sync accepts visual/audio inputs, not a video-generation prompt or duration.
		out = map[string]interface{}{"model": modelName, "input": params["input"]}
		if options, ok := params["options"].(map[string]interface{}); ok {
			out["options"] = options
		}
	}
	if strings.EqualFold(upCfg.Adapter, "wavespeed_lipsync") {
		out = map[string]interface{}{}
		if inputs, ok := params["input"].([]interface{}); ok {
			for _, input := range inputs {
				if item, ok := input.(map[string]interface{}); ok {
					if kind, _ := item["type"].(string); kind == "video" || kind == "audio" {
						out[kind] = item["url"]
					}
				}
			}
		}
	}
	modelLower := strings.ToLower(modelName)
	if instruction, ok := params["instruction"]; ok && (strings.Contains(modelLower, "qwen-audio") || strings.Contains(modelLower, "cosyvoice")) && !omitAutoValue(instruction) {
		setPayloadValue(out, "input.instruction", instruction)
	}
	if uploadProfile == "frame_pair" || uploadProfile == "veo_frame_pair" || uploadProfile == "veo_reference" || uploadProfile == "omni_reference" {
		out["_video_upload_profile"] = uploadProfile
	}
	return SanitizeUpstreamPayload(out, "")
}

func buildAliyunQwenImagePayload(model string, params map[string]interface{}) map[string]interface{} {
	content := make([]interface{}, 0, 4)
	for _, image := range mediaURLList(params["reference_images"]) {
		content = append(content, map[string]interface{}{"image": image})
	}
	content = append(content, map[string]interface{}{"text": strings.TrimSpace(fmt.Sprint(params["prompt"]))})
	parameters := map[string]interface{}{}
	for _, key := range []string{"prompt_extend", "prompt_extend_mode", "enable_thinking", "negative_prompt", "seed", "watermark"} {
		if value, ok := params[key]; ok && !omitAutoValue(value) {
			parameters[key] = value
		}
	}
	// Qwen Image reference-image editing only supports direct prompt extension.
	if len(content) > 1 && parameters["prompt_extend_mode"] == "agent" {
		parameters["prompt_extend_mode"] = "direct"
	}
	if count := intValue(firstNonNil(params["n"], params["count"])); count > 0 {
		parameters["n"] = count
	}
	if size := strings.TrimSpace(fmt.Sprint(params["size"])); size != "" && size != "<nil>" && !strings.EqualFold(size, "auto") {
		parameters["size"] = strings.ReplaceAll(strings.ToLower(size), "x", "*")
	}
	return map[string]interface{}{
		"model": model,
		"input": map[string]interface{}{"messages": []interface{}{
			map[string]interface{}{"role": "user", "content": content},
		}},
		"parameters": parameters,
	}
}

func buildAliyunVideoPayload(model string, params map[string]interface{}) map[string]interface{} {
	modelLower := strings.ToLower(model)
	input := map[string]interface{}{}
	if prompt := strings.TrimSpace(fmt.Sprint(params["prompt"])); prompt != "" && prompt != "<nil>" {
		input["prompt"] = prompt
	}
	media := make([]interface{}, 0, 12)
	add := func(kind string, raw interface{}, max int) {
		items := mediaURLList(raw)
		if max > 0 && len(items) > max {
			items = items[:max]
		}
		for _, item := range items {
			media = append(media, map[string]interface{}{"type": kind, "url": item})
		}
	}
	add("first_frame", params["first_frame"], 1)
	add("last_frame", params["last_frame"], 1)
	if strings.Contains(modelLower, "happyhorse") && strings.Contains(modelLower, "i2v") {
		if len(media) == 0 {
			add("first_frame", params["reference_images"], 1)
		}
	} else {
		maxImages := 10
		if strings.Contains(modelLower, "happyhorse") && strings.Contains(modelLower, "r2v") {
			maxImages = 9
		}
		if strings.Contains(modelLower, "happyhorse") && strings.Contains(modelLower, "video-edit") {
			maxImages = 5
		}
		add("reference_image", params["reference_images"], maxImages)
	}
	if strings.Contains(modelLower, "happyhorse") && strings.Contains(modelLower, "video-edit") {
		add("video", params["reference_videos"], 1)
	} else {
		add("reference_video", params["reference_videos"], 5)
	}
	add("reference_audio", params["reference_audios"], 5)
	if len(media) > 0 {
		input["media"] = media
	}
	parameters := map[string]interface{}{}
	for _, key := range []string{"resolution", "ratio", "duration", "prompt_extend", "audio", "audio_setting", "watermark", "seed"} {
		if value, ok := params[key]; ok && !omitAutoValue(value) {
			parameters[key] = value
		}
	}
	return map[string]interface{}{"model": model, "input": input, "parameters": parameters}
}

func firstNonNil(values ...interface{}) interface{} {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func intValue(value interface{}) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		n, _ := typed.Int64()
		return int(n)
	default:
		n, _ := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
		return n
	}
}

// SanitizeUpstreamPayload removes platform-only fields and normalizes common video API shapes.
// endpoint hint: e.g. "/v1/videos" enables Sora-style image_url promotion.
func SanitizeUpstreamPayload(out map[string]interface{}, endpoint string) map[string]interface{} {
	delete(out, "connection")
	preserveVideoParams, _ := out["_preserve_video_params"].(bool)
	uploadProfile := strings.ToLower(strings.TrimSpace(fmt.Sprint(out["_video_upload_profile"])))
	normalizedEndpoint := strings.ToLower(strings.TrimSpace(endpoint))
	if strings.Contains(normalizedEndpoint, "/v2/video_generation") ||
		strings.Contains(normalizedEndpoint, "/contents/generations/tasks") {
		preserveVideoParams = true
	}
	if endpoint != "" {
		delete(out, "_preserve_video_params")
		delete(out, "_video_upload_profile")
	}
	platformOnly := []string{
		"n", "count", "asset_ids", "reference_asset_ids", "file_asset_ids",
		"role_prompt", "channel_key", "fallback_enabled", "web_search", "timeout_sec", "asset_context",
		"negative_prompt", "style", "selling_points", "user_intent", "asset_notes",
		"language", "language_label", "language_name", "generation_language", "generation_language_label", "generation_language_name",
		"_skip_billing", "_workflow_project", "_billing_label",
	}
	if !preserveVideoParams {
		platformOnly = append(platformOnly, "duration")
	}
	for _, k := range platformOnly {
		delete(out, k)
	}
	normalizeAspectRatioField(out)
	if endpoint == "" || strings.Contains(endpoint, "/v1/videos") {
		if uploadProfile == "frame_pair" || uploadProfile == "veo_frame_pair" || uploadProfile == "veo_reference" || uploadProfile == "omni_reference" || isVeoVideoModel(out["model"]) {
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
	Adapter string
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
	if adapter, ok := up["adapter"].(string); ok {
		cfg.Adapter = strings.TrimSpace(adapter)
	}
	return cfg
}

func buildVolcengineSeedancePayload(out, params map[string]interface{}) map[string]interface{} {
	content := make([]interface{}, 0, 16)
	seenMedia := map[string]bool{}
	if duration, ok := out["duration"]; ok {
		out["duration"] = normalizeVideoDuration(duration)
	}
	mode := strings.TrimSpace(fmt.Sprint(params["generation_mode"]))
	prompt := strings.TrimSpace(fmt.Sprint(params["prompt"]))
	draftTaskID := strings.TrimSpace(fmt.Sprint(params["draft_task_id"]))
	if mode == "draft_task" && draftTaskID != "" {
		content = append(content, map[string]interface{}{
			"type":       "draft_task",
			"draft_task": map[string]interface{}{"id": draftTaskID},
		})
	} else {
		if prompt != "" {
			content = append(content, map[string]interface{}{"type": "text", "text": prompt})
		}
		addImage := func(raw interface{}, role string) {
			for _, mediaURL := range mediaURLList(raw) {
				if !isValidSeedanceMediaReference(mediaURL) || seenMedia[mediaURL] {
					continue
				}
				seenMedia[mediaURL] = true
				item := map[string]interface{}{
					"type":      "image_url",
					"image_url": map[string]interface{}{"url": mediaURL},
				}
				if role != "" {
					item["role"] = role
				}
				content = append(content, item)
			}
		}
		if mode == "first_frame" || mode == "first_last" {
			addImage(params["first_frame"], "first_frame")
		}
		if mode == "first_last" {
			addImage(params["last_frame"], "last_frame")
		}
		useImages := mode == "image" || mode == "image_audio" || mode == "image_video" || mode == "image_video_audio"
		useVideos := mode == "video" || mode == "video_audio" || mode == "image_video" || mode == "image_video_audio"
		useAudios := mode == "image_audio" || mode == "video_audio" || mode == "image_video_audio"
		portraitAssetID := strings.TrimSpace(fmt.Sprint(params["portrait_asset_id"]))
		if portraitAssetID == "<nil>" {
			portraitAssetID = ""
		}
		if portraitAssetID != "" && (useImages || useVideos) {
			if !strings.HasPrefix(portraitAssetID, "asset://") {
				portraitAssetID = "asset://" + portraitAssetID
			}
			seenMedia[portraitAssetID] = true
			if strings.EqualFold(strings.TrimSpace(fmt.Sprint(params["portrait_asset_type"])), "video") {
				content = append(content, map[string]interface{}{
					"type": "video_url", "video_url": map[string]interface{}{"url": portraitAssetID}, "role": "reference_video",
				})
			} else {
				content = append(content, map[string]interface{}{
					"type": "image_url", "image_url": map[string]interface{}{"url": portraitAssetID}, "role": "reference_image",
				})
			}
		}
		if useImages {
			for _, mediaURL := range mediaURLList(params["reference_images"]) {
				if !isValidSeedanceMediaReference(mediaURL) || seenMedia[mediaURL] {
					continue
				}
				seenMedia[mediaURL] = true
				content = append(content, map[string]interface{}{
					"type": "image_url", "image_url": map[string]interface{}{"url": mediaURL}, "role": "reference_image",
				})
			}
		}
		if useVideos {
			for _, mediaURL := range mediaURLList(params["reference_videos"]) {
				if !isValidSeedanceMediaReference(mediaURL) || seenMedia[mediaURL] {
					continue
				}
				seenMedia[mediaURL] = true
				content = append(content, map[string]interface{}{
					"type": "video_url", "video_url": map[string]interface{}{"url": mediaURL}, "role": "reference_video",
				})
			}
		}
		if useAudios {
			for _, mediaURL := range mediaURLList(params["reference_audios"]) {
				if !isValidSeedanceMediaReference(mediaURL) || seenMedia[mediaURL] {
					continue
				}
				seenMedia[mediaURL] = true
				content = append(content, map[string]interface{}{
					"type": "audio_url", "audio_url": map[string]interface{}{"url": mediaURL}, "role": "reference_audio",
				})
			}
		}
	}
	delete(out, "prompt")
	for _, key := range []string{
		"generation_mode", "draft_task_id", "first_frame", "last_frame",
		"portrait_asset_id", "portrait_asset_type",
		"reference_images", "reference_videos", "reference_audios",
	} {
		delete(out, key)
	}
	out["content"] = content
	out["_preserve_video_params"] = true
	return out
}

func isValidSeedanceMediaReference(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(value, "http://") ||
		strings.HasPrefix(value, "https://") ||
		strings.HasPrefix(value, "data:") ||
		strings.HasPrefix(value, "asset://")
}

func buildMiniMaxH3Payload(out, params map[string]interface{}) map[string]interface{} {
	prompt := strings.TrimSpace(fmt.Sprint(params["prompt"]))
	if prompt == "<nil>" {
		prompt = ""
	}
	content := []interface{}{
		map[string]interface{}{"type": "text", "text": prompt},
	}
	seen := map[string]bool{}
	addMedia := func(kind, role string, raw interface{}, max int) {
		count := 0
		for _, mediaURL := range mediaURLList(raw) {
			if count >= max || !isValidMiniMaxH3MediaReference(mediaURL) || seen[mediaURL] {
				continue
			}
			seen[mediaURL] = true
			item := map[string]interface{}{
				"type":        kind + "_url",
				kind + "_url": map[string]interface{}{"url": mediaURL},
				"role":        role,
			}
			content = append(content, item)
			count++
		}
	}

	mode := strings.ToLower(strings.TrimSpace(fmt.Sprint(params["generation_mode"])))
	switch mode {
	case "first_frame":
		addMedia("image", "first_frame", params["first_frame"], 1)
		out["ratio"] = "adaptive"
	case "last_frame":
		addMedia("image", "last_frame", params["last_frame"], 1)
		out["ratio"] = "adaptive"
	case "first_last":
		addMedia("image", "first_frame", params["first_frame"], 1)
		addMedia("image", "last_frame", params["last_frame"], 1)
		out["ratio"] = "adaptive"
	case "reference":
		addMedia("image", "reference_image", params["reference_images"], 9)
		addMedia("video", "reference_video", params["reference_videos"], 3)
		addMedia("audio", "reference_audio", params["reference_audios"], 3)
	default:
		if strings.EqualFold(strings.TrimSpace(fmt.Sprint(out["ratio"])), "adaptive") || strings.TrimSpace(fmt.Sprint(out["ratio"])) == "" {
			out["ratio"] = "16:9"
		}
	}

	if strings.TrimSpace(fmt.Sprint(out["resolution"])) == "" || fmt.Sprint(out["resolution"]) == "<nil>" {
		out["resolution"] = "2K"
	}
	if _, ok := out["duration"]; !ok {
		out["duration"] = float64(5)
	}
	for _, key := range []string{
		"prompt", "generation_mode", "first_frame", "last_frame",
		"reference_images", "reference_videos", "reference_audios",
		"reference_video_duration_seconds",
	} {
		delete(out, key)
	}
	out["content"] = content
	out["_preserve_video_params"] = true
	return out
}

func buildVeoReferencePayload(out, params map[string]interface{}) map[string]interface{} {
	applyCanonicalVideoSize(out, params)
	mode := strings.ToLower(strings.TrimSpace(fmt.Sprint(params["generation_mode"])))
	delete(out, "generation_mode")
	delete(out, "first_frame")
	delete(out, "last_frame")
	delete(out, "image")
	delete(out, "image_url")

	if mode == "reference" {
		images := mediaURLList(params["reference_images"])
		if len(images) > 3 {
			images = images[:3]
		}
		if len(images) > 0 {
			out["images"] = images
		} else {
			delete(out, "images")
		}
	} else {
		// 文生模式不能携带用户先前在参考图模式上传后残留的图片。
		delete(out, "images")
		delete(out, "reference_images")
	}
	delete(out, "reference_images")
	return out
}

func buildVeoFramePairPayload(out, params map[string]interface{}) map[string]interface{} {
	applyCanonicalVideoSize(out, params)
	images := make([]string, 0, 2)
	if first := firstMediaURL(params["first_frame"]); first != "" {
		images = append(images, first)
	}
	if last := firstMediaURL(params["last_frame"]); last != "" {
		images = append(images, last)
	}
	if len(images) > 0 {
		out["images"] = images
	} else {
		delete(out, "images")
	}
	for _, key := range []string{
		"generation_mode", "duration", "first_frame", "last_frame",
		"reference_images", "image", "image_url",
	} {
		delete(out, key)
	}
	return out
}

func buildOmniReferencePayload(out, params map[string]interface{}) map[string]interface{} {
	applyCanonicalVideoSize(out, params)
	mode := strings.ToLower(strings.TrimSpace(fmt.Sprint(params["generation_mode"])))
	for _, key := range []string{"generation_mode", "duration", "first_frame", "last_frame", "image", "image_url"} {
		delete(out, key)
	}
	if mode == "reference" {
		images := mediaURLList(params["reference_images"])
		if len(images) > 7 {
			images = images[:7]
		}
		if len(images) > 0 {
			out["images"] = images
		} else {
			delete(out, "images")
		}
	} else {
		delete(out, "images")
	}
	delete(out, "reference_images")
	return out
}

func applyCanonicalVideoSize(out, params map[string]interface{}) {
	var selected interface{}
	for _, key := range []string{"size", "aspect_ratio", "orientation", "ratio"} {
		if value, ok := params[key]; ok && strings.TrimSpace(fmt.Sprint(value)) != "" {
			selected = value
			break
		}
	}
	if selected == nil {
		for _, key := range []string{"size", "aspect_ratio", "orientation", "ratio"} {
			if value, ok := out[key]; ok && strings.TrimSpace(fmt.Sprint(value)) != "" {
				selected = value
				break
			}
		}
	}
	value := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(fmt.Sprint(selected)), " ", ""))
	switch value {
	case "portrait", "vertical", "9:16":
		value = "720x1280"
	case "landscape", "horizontal", "16:9":
		value = "1280x720"
	}
	if parts := strings.Split(value, "x"); len(parts) != 2 {
		value = "1280x720"
	} else if width, widthErr := strconv.Atoi(parts[0]); widthErr != nil || width <= 0 {
		value = "1280x720"
	} else if height, heightErr := strconv.Atoi(parts[1]); heightErr != nil || height <= 0 {
		value = "1280x720"
	}
	out["size"] = value
	delete(out, "aspect_ratio")
	delete(out, "orientation")
	delete(out, "ratio")
}

func videoUploadProfile(runtimeRule map[string]interface{}) string {
	video, _ := runtimeRule["video"].(map[string]interface{})
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(video["upload_profile"])))
}

func appendMissing(values []string, keys ...string) []string {
	seen := make(map[string]bool, len(values)+len(keys))
	for _, value := range values {
		seen[value] = true
	}
	for _, key := range keys {
		if !seen[key] {
			values = append(values, key)
			seen[key] = true
		}
	}
	return values
}

func isValidMiniMaxH3MediaReference(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(value, "http://") ||
		strings.HasPrefix(value, "https://") ||
		strings.HasPrefix(value, "data:") ||
		strings.HasPrefix(value, "mm_file://")
}

func normalizeVideoDuration(raw interface{}) interface{} {
	switch value := raw.(type) {
	case int, int32, int64, float32, float64:
		return value
	}
	text := strings.ToLower(strings.TrimSpace(fmt.Sprint(raw)))
	text = strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(text, "秒"), "s"))
	if text == "" {
		return raw
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return raw
	}
	if math.Trunc(value) == value {
		return int(value)
	}
	return value
}

func mappedUpstreamKey(upCfg upstreamConfig, key string, fallback string) string {
	if upCfg.Map != nil {
		if mapped, ok := upCfg.Map[key]; ok && mapped != "" {
			return mapped
		}
	}
	return fallback
}

func setPayloadValue(out map[string]interface{}, key string, val interface{}) {
	key = strings.TrimSpace(key)
	if key == "" {
		return
	}
	parts := strings.Split(key, ".")
	if len(parts) == 1 {
		out[key] = val
		return
	}
	cur := out
	for _, part := range parts[:len(parts)-1] {
		part = strings.TrimSpace(part)
		if part == "" {
			return
		}
		next, _ := cur[part].(map[string]interface{})
		if next == nil {
			next = map[string]interface{}{}
			cur[part] = next
		}
		cur = next
	}
	last := strings.TrimSpace(parts[len(parts)-1])
	if last != "" {
		cur[last] = val
	}
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
