package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Run independent shots against immutable project assets. Only this collector
// writes checkpoints; provider completion order never changes the edit order.
func comicParallelStage(ctx context.Context, count, limit int, run func(int) ([]map[string]interface{}, float64, string), checkpoint func([]map[string]interface{})) ([]map[string]interface{}, float64, string) {
	type result struct {
		index   int
		items   []map[string]interface{}
		cost    float64
		message string
	}
	limit = max(1, min(limit, count))
	jobs := make(chan int)
	results := make(chan result, limit)
	var workers sync.WaitGroup
	for i := 0; i < limit; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				if ctx.Err() != nil {
					results <- result{index: index, message: ctx.Err().Error()}
					continue
				}
				items, cost, message := run(index)
				results <- result{index, items, cost, message}
			}
		}()
	}
	go func() {
		for i := 0; i < count; i++ {
			jobs <- i
		}
		close(jobs)
		workers.Wait()
		close(results)
	}()
	ordered := make([][]map[string]interface{}, count)
	var total float64
	var messages []string
	flatten := func() []map[string]interface{} {
		var out []map[string]interface{}
		for _, items := range ordered {
			out = append(out, items...)
		}
		return out
	}
	for item := range results {
		ordered[item.index] = item.items
		total += item.cost
		if item.message != "" {
			messages = append(messages, item.message)
		}
		checkpoint(flatten())
	}
	return flatten(), total, strings.Join(messages, "；")
}

func comicShotCodes(shot map[string]interface{}) []string {
	var codes []string
	for _, key := range []string{"character_codes", "prop_codes"} {
		for _, raw := range comicCollection(shot[key]) {
			if code := stringAny(raw); code != "" {
				codes = append(codes, code)
			}
		}
	}
	if code := stringAny(shot["location_code"]); code != "" {
		codes = append(codes, code)
	}
	return codes
}

func comicShotInputs(inputs, shot map[string]interface{}) map[string]interface{} {
	out := copyMap(inputs)
	var selected []interface{}
	var refs, bindings []string
	for _, code := range comicShotCodes(shot) {
		for _, raw := range comicCollection(inputs["comic_assets"]) {
			asset := mapAnyOr(raw, map[string]interface{}{})
			if firstNonEmpty(stringAny(asset["asset_code"]), stringAny(asset["code"])) != code {
				continue
			}
			selected = append(selected, asset)
			for _, url := range comicAssetReferenceURLs(map[string]interface{}{"comic_assets": []interface{}{asset}}) {
				before := len(refs)
				refs = appendUniqueMediaReference(refs, url)
				if len(refs) > before {
					bindings = append(bindings, fmt.Sprintf("参考图%d = %s（%s）", len(refs), code, stringAny(asset["name"])))
				}
			}
		}
	}
	// Unclassified uploads are context only, never an assumed main character.
	if len(refs) == 0 {
		refs = referenceImageURLs(inputs)
	}
	for _, key := range []string{"image", "images", "image_url", "product_image", "reference_image", "reference_images", "first_frame", "last_frame"} {
		delete(out, key)
	}
	out["comic_assets"], out["reference_images"] = selected, refs
	if len(refs) > 0 {
		out["image_url"] = refs[0]
	}
	out["_reference_bindings"] = strings.Join(bindings, "\n")
	return out
}

func prepareComicAssets(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, publicID string, runtimeCfg, inputs, plan map[string]interface{}, existing []interface{}) ([]map[string]interface{}, float64, string) {
	var assets []map[string]interface{}
	used := map[string]bool{}
	for _, raw := range comicCollection(plan["storyboards"]) {
		for _, code := range comicShotCodes(mapAnyOr(raw, nil)) {
			used[code] = true
		}
	}
	for _, kind := range []string{"character", "prop", "location"} {
		for _, raw := range comicCollection(plan[kind+"s"]) {
			asset := copyMap(mapAnyOr(raw, map[string]interface{}{}))
			delete(asset, "metadata") // Only bind actual uploads or saved project assets, never model-invented URLs.
			code := stringAny(asset["code"])
			if !used[code] {
				continue
			}
			delete(used, code)
			asset["asset_code"], asset["asset_type"], asset["id"] = code, kind, code
			definitionInput := map[string]interface{}{"code": code, "type": kind, "visual_prompt": asset["visual_prompt"], "model": firstNonEmpty(stringAny(inputs["image_model_code"]), stringAny(runtimeCfg["image_model_code"]))}
			if kind == "location" {
				// Invalidate legacy auto-generated locations that may contain a second character.
				definitionInput["purity_policy"] = "empty_scene_v1"
			}
			definition := fmt.Sprintf("%x", sha256.Sum256(mustJSON(definitionInput)))
			asset["asset_definition"] = definition
			userRefs := referenceImageURLs(inputs)
			var matched []string
			for _, value := range comicCollection(asset["reference_image_indexes"]) {
				index := intAny(value) - 1
				if index >= 0 && index < len(userRefs) {
					matched = appendUniqueMediaReference(matched, userRefs[index])
				}
			}
			if len(matched) > 0 {
				asset["metadata"] = map[string]interface{}{"reference_urls": matched, "source": "user_reference"}
			}

			for _, saved := range append(comicCollection(inputs["comic_assets"]), existing...) {
				previous := mapAnyOr(saved, nil)
				metadata := mapAnyOr(previous["metadata"], nil)
				if stringAny(previous["status"]) == "failed" || (stringAny(metadata["source"]) == "auto" && stringAny(metadata["asset_definition"]) != definition) {
					continue
				}
				if firstNonEmpty(stringAny(previous["asset_code"]), stringAny(previous["code"])) == code && len(comicAssetReferenceURLs(map[string]interface{}{"comic_assets": []interface{}{previous}})) > 0 {
					asset["metadata"] = previous["metadata"]
				}
			}
			assets = append(assets, asset)
		}
	}
	if len(used) > 0 {
		return nil, 0, "分镜引用了未定义的角色、道具或场景，请修正分镜资产编号"
	}
	imageRuntime := copyMap(runtimeCfg)
	imageRuntime["generation_type"] = "image"
	imageRuntime["generation_model_code"] = firstNonEmpty(stringAny(inputs["image_model_code"]), stringAny(runtimeCfg["image_model_code"]), stringAny(runtimeCfg["generation_model_code"]))
	return comicParallelStage(ctx, len(assets), comicConcurrency(runtimeCfg, "image_concurrency", 3, 6), func(index int) ([]map[string]interface{}, float64, string) {
		asset := assets[index]
		if refs := comicAssetReferenceURLs(map[string]interface{}{"comic_assets": []interface{}{asset}}); len(refs) > 0 {
			metadata := copyMap(mapAnyOr(asset["metadata"], nil))
			if stringAny(runtimeCfg["quality_model_code"]) != "" && stringAny(metadata["source"]) == "auto" && stringAny(metadata["quality_status"]) != "passed" {
				scores, cost, message := reviewComicImage(ctx, pool, baseURL, token, runtimeCfg, inputs, refs[0], stringAny(asset["visual_prompt"]))
				metadata["quality_status"] = scores["status"]
				asset["metadata"] = metadata
				asset["scores"] = scores
				if message != "" {
					asset["status"] = "failed"
					asset["error_message"] = message
				}
				return []map[string]interface{}{asset}, cost, message
			}
			return []map[string]interface{}{asset}, 0, ""
		}
		assetInputs := copyMap(inputs)
		assetInputs["count"], assetInputs["n"] = 1, 1
		assetInputs["_asset_type"] = asset["asset_type"]
		prompt := comicStylePrompt(inputs, "制作供后续镜头反复引用的单一资产定稿图。只表现指定资产；人物展示清晰五官、发型与完整服装，道具展示完整结构，场景不添加未指定人物。无文字、无水印。用户参考仅按其真实内容使用，不能把场景图认作人物。\n"+stringAny(asset["asset_type"])+" "+stringAny(asset["name"])+"\n"+firstNonEmpty(stringAny(asset["visual_prompt"]), stringAny(asset["description"])))
		if stringAny(asset["asset_type"]) == "location" {
			prompt = "LOCATION ASSET / EMPTY SCENE HARD RULE: Generate only the reusable environment. No person, face, body, hand, clothing, human reflection, portrait, presenter, silhouette, or mannequin may appear anywhere in the image.\n场景定稿必须是纯场景空镜，画面内严禁出现人物、脸、人体、手、服装、人物倒影、人像照片、主持人、剪影或模特。\n" + prompt
		}
		retrySetting := firstNonNil(inputs["max_retry"], runtimeCfg["max_retry"])
		maxRetry := intAny(retrySetting)
		if retrySetting == nil && stringAny(inputs["_mode"]) == "auto" {
			maxRetry = 2
		}
		maxRetry = min(5, max(0, maxRetry))
		var results []map[string]interface{}
		var scores map[string]interface{}
		var url, message string
		var total float64
		retryCount := 0
		for attempt := 0; attempt <= maxRetry; attempt++ {
			if attempt > 0 {
				retryCount = attempt
				assetInputs["retry_reason"] = message
			}
			results, message = runAgentMediaTasks(ctx, pool, baseURL, token, p.ProjectID, p.UserID, publicID, imageRuntime, assetInputs, prompt)
			total += sumAgentMediaTaskCost(results)
			url = ""
			if len(results) > 0 {
				url = firstMediaURL(mapAnyOr(results[0]["output"], nil), "image_url", "url", "result_url")
			}
			asset["task"] = firstMapOrNil(results)
			if message == "" && url != "" {
				var reviewCost float64
				scores, reviewCost, message = reviewComicImage(ctx, pool, baseURL, token, runtimeCfg, assetInputs, url, prompt)
				total += reviewCost
				if message == "" {
					break
				}
				if stringAny(scores["status"]) == "check_failed" || !boolAny(scores["checked"]) {
					break
				}
				prompt += "\n上一版未通过资产验收，必须修正：" + message
			}
			if message != "" && !isRetryableComicMediaError(message) {
				break
			}
		}
		asset["scores"] = scores
		asset["retry_count"] = retryCount
		if message != "" || url == "" {
			asset["status"] = "failed"
			asset["error_message"] = firstNonEmpty(message, "模型未返回图片")
			return []map[string]interface{}{asset}, total, "资产定稿失败（" + firstNonEmpty(stringAny(asset["name"]), stringAny(asset["asset_code"])) + "）：" + stringAny(asset["error_message"])
		}
		if stored, err := persistComicKeyframeURL(ctx, pool, baseURL, token, stringAny(imageRuntime["generation_model_code"]), publicID+"_assets", index, url); err == nil && stored != "" {
			url = stored
		}
		asset["metadata"] = map[string]interface{}{"reference_urls": []string{url}, "source": "auto", "quality_status": scores["status"], "asset_definition": asset["asset_definition"]}
		asset["status"] = "succeeded"
		return []map[string]interface{}{asset}, total, ""
	}, func(items []map[string]interface{}) {
		saveComicStageCheckpoint(ctx, pool, p.ProjectID, "consistency_assets", items)
	})
}

func runComicKeyframes(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, publicID string, runtimeCfg, inputs map[string]interface{}, shots []map[string]interface{}, existing []interface{}) ([]map[string]interface{}, float64, string) {
	return comicParallelStage(ctx, len(shots), comicConcurrency(runtimeCfg, "image_concurrency", 3, 6), func(index int) ([]map[string]interface{}, float64, string) {
		local := comicShotInputs(inputs, shots[index])
		local["_shot_index"] = index
		return runComicKeyframeBatch(ctx, pool, baseURL, token, p, publicID, runtimeCfg, local, shots[index:index+1], existing)
	}, func(items []map[string]interface{}) {
		saveComicStageCheckpoint(ctx, pool, p.ProjectID, "keyframes", items)
	})
}

func runComicVideoSegments(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, p WorkflowTaskPayload, publicID string, runtimeCfg, inputs map[string]interface{}, shots []map[string]interface{}, keyframes, existing []interface{}) ([]map[string]interface{}, float64, string) {
	frames := comicItemsByID(keyframes)
	return comicParallelStage(ctx, len(shots), comicConcurrency(runtimeCfg, "video_concurrency", 2, 4), func(index int) ([]map[string]interface{}, float64, string) {
		id := firstNonEmpty(stringAny(shots[index]["id"]), fmt.Sprintf("S%02d", index+1))
		frame := frames[id]
		if stringAny(frame["image_url"]) == "" || stringAny(frame["status"]) == "failed" {
			return nil, 0, "分镜 " + id + " 缺少有效关键帧，已停止视频生成"
		}
		local := comicShotInputs(inputs, shots[index])
		return runComicVideoBatch(ctx, pool, baseURL, token, p, publicID, runtimeCfg, local, shots[index:index+1], []interface{}{frame}, existing)
	}, func(items []map[string]interface{}) {
		saveComicStageCheckpoint(ctx, pool, p.ProjectID, "segments", items)
	})
}

func comicConcurrency(config map[string]interface{}, key string, fallback, ceiling int) int {
	value := intAny(config[key])
	if value <= 0 {
		value = fallback
	}
	return min(value, ceiling)
}

func comicFrameSignature(inputs, shot map[string]interface{}, model string) string {
	return comicFrameSignatureVersion(inputs, shot, model, 2)
}

func comicFrameSignatureVersion(inputs, shot map[string]interface{}, model string, version int) string {
	payload := map[string]interface{}{"shot": shot, "model": model, "references": referenceImageURLs(inputs), "style": inputs["comic_style"], "ratio": firstNonEmpty(stringAny(inputs["aspect_ratio"]), stringAny(inputs["orientation"]))}
	if version >= 2 {
		payload["assets"] = comicAssetVersions(inputs)
		payload["quality"] = inputs["quality"]
	}
	return fmt.Sprintf("%x", sha256.Sum256(mustJSON(payload)))
}

func comicFramesChanged(items []interface{}, shots []map[string]interface{}, inputs, config map[string]interface{}) bool {
	byID := comicItemsByID(items)
	model := firstNonEmpty(stringAny(inputs["image_model_code"]), stringAny(config["image_model_code"]), stringAny(config["generation_model_code"]))
	for _, shot := range shots {
		previous := byID[stringAny(shot["id"])]
		if old := stringAny(previous["input_signature"]); old != "" && old != comicFrameSignatureVersion(comicShotInputs(inputs, shot), shot, model, intAny(previous["input_signature_version"])) {
			return true
		}
	}
	return false
}

func comicVideoReferences(keyframe string, identities []string, rule map[string]interface{}) []string {
	refs := []string{keyframe}
	video := mapAnyOr(rule["video"], nil)
	profile := stringAny(video["upload_profile"])
	limit := 1
	switch profile {
	case "veo_reference":
		limit = 3
	case "omni_reference":
		limit = 8
	case "seedance_2":
		limit = 9
	}
	if declared := intAny(video["max_reference_images"]); declared > 0 && declared < limit {
		limit = declared
	}
	for _, url := range identities {
		if len(refs) >= limit {
			break
		}
		refs = appendUniqueMediaReference(refs, url)
	}
	return refs
}

func comicVideoBindings(inputs map[string]interface{}, refs []string) string {
	lines := []string{"参考图1为本镜头关键帧，保持其中人物身份、服装和构图。"}
	identities := referenceImageURLs(inputs)
	bindings := strings.Split(stringAny(inputs["_reference_bindings"]), "\n")
	for i, ref := range identities {
		if i >= len(bindings) {
			break
		}
		_, label, ok := strings.Cut(bindings[i], " = ")
		if !ok {
			continue
		}
		for j, used := range refs {
			if used == ref {
				lines = append(lines, fmt.Sprintf("参考图%d = %s", j+1, label))
			}
		}
	}
	return strings.Join(lines, "\n")
}

func comicSegmentsChanged(items, frames []interface{}) bool {
	byID := comicItemsByID(frames)
	for _, raw := range items {
		item := mapAnyOr(raw, nil)
		if stringAny(item["reference_image_url"]) != stringAny(byID[stringAny(item["id"])]["image_url"]) {
			return true
		}
	}
	return false
}
