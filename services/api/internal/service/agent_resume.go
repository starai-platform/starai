package service

import (
	"context"
	"fmt"
	"strings"
)

type comicRemainingWork struct {
	Assets     int  `json:"assets"`
	Plan       bool `json:"plan"`
	Images     int  `json:"images"`
	Videos     int  `json:"videos"`
	Narrations int  `json:"narrations"`
}

func comicResumeItems(raw interface{}) []interface{} {
	if items, ok := raw.([]interface{}); ok {
		return items
	}
	if items, ok := raw.([]map[string]interface{}); ok {
		out := make([]interface{}, len(items))
		for i := range items {
			out[i] = items[i]
		}
		return out
	}
	return nil
}

// Match the Worker's ID-based reuse checks (not raw array lengths, which can
// include duplicates or failed items). Missing checkpoints are never success.
func remainingComicWork(inputs, outputs, runtimeCfg map[string]interface{}) comicRemainingWork {
	if stringValue(outputs["final_video_url"]) != "" && stringValue(outputs["current_step"]) == "result" {
		return comicRemainingWork{}
	}
	plan, ok := outputs["comic_drama"].(map[string]interface{})
	shots := comicResumeItems(plan["storyboards"])
	audio := normalizeComicAudioStrategy(firstAgentString(stringValue(inputs["audio_strategy"]), stringValue(runtimeCfg["audio_strategy"])), firstAgentString(stringValue(inputs["narration_model_code"]), stringValue(runtimeCfg["narration_model_code"]))) != "video_native"
	if !ok || len(shots) == 0 {
		grid := positiveAgentInt(intFromAgentAny(firstAgentNonNil(inputs["storyboard_grid"], runtimeCfg["storyboard_grid"])), 6)
		work := comicRemainingWork{Plan: true, Assets: grid * 3, Images: grid, Videos: grid}
		if audio {
			work.Narrations = grid
		}
		return work
	}
	index := func(key string) map[string]map[string]interface{} {
		result := map[string]map[string]interface{}{}
		for _, raw := range comicResumeItems(outputs[key]) {
			if item, ok := raw.(map[string]interface{}); ok {
				result[stringValue(item["id"])] = item
			}
		}
		return result
	}
	images, videos, voices := index("keyframes"), index("segments"), index("narrations")
	missing := func(item map[string]interface{}, key string) bool {
		return stringValue(item[key]) == "" || stringValue(item["status"]) == "failed"
	}
	work := comicRemainingWork{}
	for i, raw := range shots {
		shot, _ := raw.(map[string]interface{})
		id := firstAgentString(stringValue(shot["id"]), fmt.Sprintf("S%02d", i+1))
		if missing(images[id], "image_url") {
			work.Images++
		}
		if missing(videos[id], "video_url") {
			work.Videos++
		}
		if audio && (stringValue(shot["dialogue"]) != "" || stringValue(shot["narration"]) != "") && missing(voices[id], "audio_url") {
			work.Narrations++
		}
	}
	used := map[string]bool{}
	for _, raw := range shots {
		shot, _ := raw.(map[string]interface{})
		for _, key := range []string{"character_codes", "prop_codes"} {
			for _, code := range agentStringSlice(shot[key], nil) {
				used[code] = true
			}
		}
		if code := stringValue(shot["location_code"]); code != "" {
			used[code] = true
		}
	}
	for _, raw := range append(comicResumeItems(inputs["comic_assets"]), comicResumeItems(outputs["consistency_assets"])...) {
		asset, _ := raw.(map[string]interface{})
		metadata, _ := asset["metadata"].(map[string]interface{})
		if len(agentStringSlice(metadata["reference_urls"], nil)) > 0 || len(agentStringSlice(metadata["reference_images"], nil)) > 0 {
			delete(used, firstAgentString(stringValue(asset["asset_code"]), stringValue(asset["code"])))
		}
	}
	work.Assets = len(used)
	return work
}

func (s *AgentService) validateComicRemainingModels(ctx context.Context, inputs map[string]interface{}, work comicRemainingWork) error {
	checks := [][2]string{}
	if work.Images+work.Assets > 0 {
		checks = append(checks, [2]string{stringValue(inputs["image_model_code"]), "image"})
	}
	if work.Videos > 0 {
		checks = append(checks, [2]string{stringValue(inputs["video_model_code"]), "video"})
	}
	if work.Narrations > 0 {
		checks = append(checks, [2]string{stringValue(inputs["narration_model_code"]), "audio"})
	}
	if work.Plan {
		codes := agentStringSlice(inputs["dialogue_model_codes"], nil)
		if len(codes) == 0 {
			return fmt.Errorf("剩余规划阶段缺少对话模型")
		}
		for _, code := range codes {
			checks = append(checks, [2]string{code, "chat"})
		}
	}
	for _, check := range checks {
		code, category := check[0], check[1]
		var exists bool
		if strings.TrimSpace(code) == "" {
			return fmt.Errorf("剩余 %s 阶段未配置模型", category)
		}
		if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM models WHERE code=$1 AND category=$2 AND is_enabled=true)`, code, category).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("剩余 %s 阶段的模型不可用：%s；已完成素材保留", category, code)
		}
	}
	return nil
}

// Resolve the same missing-code defaults as the Worker, without replacing any
// existing selection or modifying completed checkpoints.
func fillComicResumeModelDefaults(inputs, runtimeCfg map[string]interface{}) {
	for _, key := range []string{"image_model_code", "video_model_code", "narration_model_code"} {
		if stringValue(inputs[key]) == "" {
			code := stringValue(runtimeCfg[key])
			if code == "" && key != "narration_model_code" {
				code = stringValue(runtimeCfg["generation_model_code"])
			}
			inputs[key] = code
		}
	}
	if len(agentStringSlice(inputs["dialogue_model_codes"], nil)) == 0 {
		codes := agentStringSlice(runtimeCfg["dialogue_model_codes"], nil)
		if len(codes) == 0 {
			if code := stringValue(runtimeCfg["analysis_model_code"]); code != "" {
				codes = []string{code}
			}
		}
		inputs["dialogue_model_codes"] = codes
	}
}

func (s *AgentService) estimateComicRemainingCost(ctx context.Context, runtimeCfg, inputs map[string]interface{}, work comicRemainingWork) float64 {
	attempts := float64(min(5, max(0, intFromAgentAny(firstAgentNonNil(inputs["max_retry"], runtimeCfg["max_retry"])))) + 1)
	total := 0.0
	if work.Plan {
		codes := agentStringSlice(inputs["dialogue_model_codes"], nil)
		code := stringValue(runtimeCfg["analysis_model_code"])
		if len(codes) > 0 {
			code = codes[0]
		}
		total += s.estimateModelCostByCode(ctx, code, inputs, 1200, 2500)
	}
	if work.Images+work.Assets > 0 {
		total += attempts * s.estimateModelCostByCode(ctx, stringValue(inputs["image_model_code"]), map[string]interface{}{"n": work.Images + work.Assets}, 0, 0)
	}
	if work.Videos > 0 {
		duration := comicSegmentDurationSeconds(inputs, runtimeCfg)
		params := map[string]interface{}{"count": 1, "n": 1, "duration": duration, "duration_sec": duration, "resolution": normalizeComicVideoResolution(firstAgentString(stringValue(inputs["quality"]), stringValue(runtimeCfg["quality"]))), "generation_mode": "image", "reference_images": []string{"comic-keyframe"}}
		total += attempts * float64(work.Videos) * s.estimateModelCostByCode(ctx, stringValue(inputs["video_model_code"]), params, 0, 0)
	}
	if work.Narrations > 0 {
		total += float64(work.Narrations) * s.estimateModelCostByCode(ctx, stringValue(inputs["narration_model_code"]), map[string]interface{}{"count": 1}, 0, 200)
	}
	if code := stringValue(runtimeCfg["quality_model_code"]); code != "" {
		total += attempts * float64(work.Images+work.Videos+work.Assets) * s.estimateModelCostByCode(ctx, code, inputs, 6000, 500)
	}
	return total
}
