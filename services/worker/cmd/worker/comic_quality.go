package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func applyComicVisionContent(ctx context.Context, body map[string]interface{}, protocol, mode, system, user string, images []string) {
	switch normalizeWorkerLLMProtocol(protocol) {
	case "gemini":
		parts := []map[string]interface{}{{"text": user}}
		for _, ref := range images {
			parts = append(parts, geminiImagePart(ref))
		}
		body["contents"] = []map[string]interface{}{{"role": "user", "parts": parts}}
	case "claude":
		parts := []map[string]interface{}{{"type": "text", "text": user}}
		for _, ref := range images {
			source := map[string]interface{}{"type": "url", "url": ref}
			if strings.HasPrefix(ref, "data:image/") {
				header, data, ok := strings.Cut(ref, ",")
				if !ok {
					continue
				}
				source = map[string]interface{}{"type": "base64", "media_type": strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64"), "data": data}
			}
			parts = append(parts, map[string]interface{}{"type": "image", "source": source})
		}
		body["messages"] = []map[string]interface{}{{"role": "user", "content": parts}}
	default:
		parts := []map[string]interface{}{{"type": "text", "text": user}}
		key := "messages"
		if mode == "responses" {
			key = "input"
			parts[0]["type"] = "input_text"
		}
		for _, ref := range images {
			part := map[string]interface{}{"type": "image_url", "image_url": map[string]string{"url": ref}}
			if mode == "responses" {
				part = map[string]interface{}{"type": "input_image", "image_url": ref}
			}
			parts = append(parts, part)
		}
		body[key] = []map[string]interface{}{{"role": "system", "content": system}, {"role": "user", "content": parts}}
	}
}

func comicQualityDecision(result map[string]interface{}, threshold int) (bool, string) {
	checked, ok := result["checked"].(bool)
	if !ok || !checked {
		return false, "视觉检查无法确认，请人工检查该镜头"
	}
	score, exists := result["asset_consistency"]
	if !exists || floatAny(score) < 0 || floatAny(score) > 100 {
		return false, "视觉检查返回了无效分数"
	}
	uncertain, hasCertainty := result["uncertain"].(bool)
	if !hasCertainty || uncertain || intAny(score) < threshold {
		return false, firstNonEmpty(stringAny(result["reason"]), "人物或素材一致性未达标")
	}
	return true, ""
}

func reviewComicImage(ctx context.Context, pool *pgxpool.Pool, baseURL, token string, runtimeCfg, inputs map[string]interface{}, imageURL, prompt string, extraSamples ...string) (map[string]interface{}, float64, string) {
	code := stringAny(runtimeCfg["quality_model_code"])
	scores := comicPassScores(runtimeCfg, inputs)
	if code == "" {
		return scores, 0, ""
	}
	model, message := loadAgentAnalysisModel(ctx, pool, code)
	if message != "" {
		scores["status"] = "check_failed"
		return scores, 0, "视觉验收模型不可用：" + message
	}
	refs := referenceImageURLs(inputs)
	refs = append(refs, imageURL)
	refs = append(refs, extraSamples...)
	system := "你是影视资产连续性审核员。前面的图片是参考资产，最后一张是待验收镜头。按素材绑定和镜头描述逐一核对主体身份、脸型发型、服装、道具和场景。切镜角度变化不等于换人；不要求未出场角色出现。checked 表示是否已看清图片并完成比较，不代表合格；发现明确不一致时 checked 仍必须为 true，合格与否由分数决定。只有无法辨认或图片无法读取时才使用 checked=false 或 uncertain=true，不能猜测通过。只输出JSON：{\"checked\":true,\"asset_consistency\":0到100,\"uncertain\":false,\"reason\":\"具体问题或通过理由\"}。"
	if stringAny(inputs["_asset_type"]) == "location" {
		system += "当前验收对象是供后续复用的 LOCATION 纯场景空镜资产。只要待验收图中出现人物、脸、人体、手、服装、人物倒影、人像照片、主持人、剪影或模特，就必须判定不合格，asset_consistency 不得高于20，并在 reason 中明确指出人物污染；不要因为场景本身符合描述而放行。"
	}
	if len(extraSamples) > 0 {
		system += fmt.Sprintf("本次最后%d张图片是同一视频按时间顺序抽取的画面，请同时检查它们之间的人物身份是否漂移。", 1+len(extraSamples))
	}
	result, err := executeWorkerLLMWithRoutes(ctx, pool, baseURL, token, fmt.Sprintf("quality_%d", time.Now().UnixNano()), model, system, stringAny(inputs["_reference_bindings"])+"\n"+prompt, 0.1, 90*time.Second, refs...)
	if err != nil {
		scores["status"] = "check_failed"
		return scores, 0, "视觉验收失败：" + err.Error()
	}
	pt, ct, cr, cw := chatUsageTokenDetails(result.ResponseBody)
	cost := estimateModelCostByCodeWorker(ctx, pool, code, result.RequestBody, pt, ct, cr, cw)
	review := parseJSONish(extractLLMText(result.ResponseBody))
	passed, reason := comicQualityDecision(review, intAny(scores["threshold_asset"]))
	for key, value := range review {
		scores[key] = value
	}
	scores["model_code"] = code
	scores["status"] = "passed"
	if !passed {
		scores["status"] = "needs_review"
	}
	return scores, cost, reason
}

func comicNeedsQualityReview(items []interface{}, runtimeCfg map[string]interface{}) bool {
	if stringAny(runtimeCfg["quality_model_code"]) == "" {
		return false
	}
	for _, raw := range items {
		if stringAny(mapAnyOr(mapAnyOr(raw, nil)["scores"], nil)["status"]) != "passed" {
			return true
		}
	}
	return false
}

func comicVideoSamples(ctx context.Context, url string) ([]string, error) {
	data, _, err := downloadAuthenticatedMedia(ctx, connectionConfig{}, url, 500<<20)
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "comic-review-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	source := filepath.Join(dir, "video.mp4")
	if err := os.WriteFile(source, data, 0600); err != nil {
		return nil, err
	}
	duration, err := probeComicAudioDuration(ctx, source)
	if err != nil || duration <= 0 {
		return nil, fmt.Errorf("无法读取视频时长")
	}
	var samples []string
	for i, ratio := range []float64{0.15, 0.5, 0.85} {
		target := filepath.Join(dir, fmt.Sprintf("sample%d.jpg", i))
		if err := runFFmpeg(ctx, "-y", "-ss", fmt.Sprintf("%.3f", duration*ratio), "-i", source, "-frames:v", "1", "-vf", "scale=768:-2", target); err != nil {
			return nil, err
		}
		frame, err := os.ReadFile(target)
		if err != nil {
			return nil, err
		}
		samples = append(samples, "data:image/jpeg;base64,"+base64.StdEncoding.EncodeToString(frame))
	}
	return samples, nil
}
