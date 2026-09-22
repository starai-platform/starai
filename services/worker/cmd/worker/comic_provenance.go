package main

import (
	"crypto/sha256"
	"fmt"
	"strings"
)

// The model only chooses boundaries. Text is sliced from the immutable source,
// never copied from the model's rewritten description. Offsets are UTF-8 bytes.
func bindComicSource(plan, inputs map[string]interface{}) error {
	source := ""
	for _, value := range []interface{}{inputs["source_script"], inputs["script"], plan["script"]} {
		if raw, ok := value.(string); ok && strings.TrimSpace(raw) != "" {
			source = raw
			break
		}
	}
	if source == "" {
		return nil
	}
	shots := comicCollection(plan["storyboards"])
	if len(shots) == 0 {
		return nil
	}
	offsets := make([]int, len(shots))
	cursor := 0
	for i, raw := range shots {
		shot := mapAnyOr(raw, nil)
		quote, _ := shot["source_quote"].(string)
		if strings.TrimSpace(quote) == "" {
			return fmt.Errorf("分镜%d缺少原文定位 source_quote，请重新规划", i+1)
		}
		pos := strings.Index(source[cursor:], quote)
		if pos < 0 {
			return fmt.Errorf("分镜%d的原文引用不存在或顺序错误，已阻止无来源生成", i+1)
		}
		pos += cursor
		offsets[i] = pos
		cursor = pos + len(quote)
	}
	offsets[0] = 0
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(source)))
	kind := "generated_script"
	if stringAny(inputs["source_script"]) != "" || stringAny(inputs["script"]) != "" {
		kind = "user_script"
	}
	for i, raw := range shots {
		end := len(source)
		if i+1 < len(shots) {
			end = offsets[i+1]
		}
		mapAnyOr(raw, nil)["source"] = map[string]interface{}{"kind": kind, "hash": hash, "start_byte": offsets[i], "end_byte": end, "text": source[offsets[i]:end], "verified": true}
	}
	plan["source_snapshot"] = map[string]interface{}{"kind": kind, "hash": hash, "text": source}
	return nil
}

func comicVideoInputSignature(inputs, shot, config map[string]interface{}, frameURL string) string {
	payload := map[string]interface{}{
		"version": 1, "shot": shot, "frame": frameURL,
		"references": referenceImageURLs(inputs), "assets": comicAssetVersions(inputs),
		"style": inputs["comic_style"], "aspect": comicRequestedAspectRatio(inputs, config),
		"resolution":     firstNonEmpty(stringAny(inputs["quality"]), stringAny(config["quality"])),
		"audio_strategy": comicAudioStrategy(inputs, config),
	}
	return fmt.Sprintf("%x", sha256.Sum256(mustJSON(payload)))
}

func comicAssetVersions(inputs map[string]interface{}) []map[string]interface{} {
	var out []map[string]interface{}
	for _, raw := range comicCollection(inputs["comic_assets"]) {
		asset := mapAnyOr(raw, nil)
		out = append(out, map[string]interface{}{"code": firstNonEmpty(stringAny(asset["asset_code"]), stringAny(asset["code"])), "version": asset["version"], "visual_prompt": asset["visual_prompt"], "references": comicAssetReferenceURLs(map[string]interface{}{"comic_assets": []interface{}{asset}})})
	}
	return out
}

func comicVideoInputsChanged(items, frames []interface{}, shots []map[string]interface{}, inputs, config map[string]interface{}) bool {
	byID, framesByID := comicItemsByID(items), comicItemsByID(frames)
	for _, shot := range shots {
		id := stringAny(shot["id"])
		item := byID[id]
		if previous := stringAny(item["input_signature"]); previous != "" && previous != comicVideoInputSignature(comicShotInputs(inputs, shot), shot, config, stringAny(framesByID[id]["image_url"])) {
			return true
		}
	}
	return false
}

func archiveComicStage(outputs map[string]interface{}, kind string, items []interface{}) {
	history := comicCollection(outputs["media_history"])
	seen := map[string]bool{}
	for _, raw := range history {
		seen[string(mustJSON(raw))] = true
	}
	for _, raw := range items {
		item := mapAnyOr(raw, nil)
		if stringAny(item["image_url"]) == "" && stringAny(item["video_url"]) == "" {
			continue
		}
		entry := map[string]interface{}{"kind": kind, "reason": "before_regeneration", "item": copyMap(item)}
		key := string(mustJSON(entry))
		if !seen[key] {
			history = append(history, entry)
			seen[key] = true
		}
	}
	outputs["media_history"] = history
}
