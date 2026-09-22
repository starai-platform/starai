package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

// Read the actual pixels before analysis. A localhost URL in text is not a
// reference image, and external vision providers cannot fetch local storage.
func agentAnalysisReferenceImages(ctx context.Context, inputs map[string]interface{}) ([]string, error) {
	return normalizeLLMImages(ctx, referenceImageURLs(inputs))
}

func normalizeLLMImages(ctx context.Context, refs []string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	refs = append([]string(nil), refs...)
	total := 0
	for i, ref := range refs {
		refs[i] = normalizeReferenceImage(ctx, ref)
		if !strings.HasPrefix(refs[i], "data:image/") {
			return nil, fmt.Errorf("第%d张参考图读取失败，请检查素材是否可访问；已停止无图分析", i+1)
		}
		header, payload, ok := strings.Cut(refs[i], ",")
		if len(payload) > 28<<20 {
			return nil, fmt.Errorf("参考图超过20MB")
		}
		data, err := base64.StdEncoding.DecodeString(payload)
		total += len(data)
		if !ok || !strings.HasSuffix(header, ";base64") || err != nil || len(data) == 0 || total > 20<<20 || !strings.HasPrefix(http.DetectContentType(data), "image/") {
			return nil, fmt.Errorf("参考图数据无效或总大小超过20MB，已停止无图分析")
		}
	}
	return refs, nil
}

func agentAnalysisModelAcceptsImages(model agentAnalysisModel) bool {
	value, _ := workerMediaCapability(model.RuntimeRule, "vision", "image_input", "multimodal")
	return value
}

func workerMediaCapability(rule map[string]interface{}, keys ...string) (bool, bool) {
	caps := mapAnyOr(rule["capabilities"], nil)
	for _, key := range keys {
		if value, ok := caps[key].(bool); ok {
			return value, true
		}
	}
	return false, false
}

func detailSectionCount(inputs map[string]interface{}) int {
	if n := intAny(inputs["detail_section_count"]); n >= 4 && n <= 8 {
		return n
	}
	if n := intAny(inputs["count"]); n >= 4 && n <= 8 {
		return n
	}
	return 5
}

func workerStringList(value interface{}) []string {
	switch v := value.(type) {
	case []string:
		return v
	case string:
		if strings.TrimSpace(v) != "" {
			return []string{v}
		}
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, stringAny(item))
		}
		return out
	}
	return nil
}

func analysisVideoReferences(inputs map[string]interface{}) []string {
	refs := workerStringList(inputs["reference_videos"])
	for _, key := range []string{"video_url", "source_video_url"} {
		if ref := strings.TrimSpace(stringAny(inputs[key])); ref != "" {
			refs = append(refs, ref)
		}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if !seen[ref] {
			seen[ref] = true
			out = append(out, ref)
		}
	}
	return out
}

func applyWorkerVideoContent(ctx context.Context, body map[string]interface{}, protocol string, videos []string) error {
	for _, ref := range videos {
		if objectStore != nil {
			if key := objectStore.ObjectKeyFromURL(ref); key != "" {
				data, err := objectStore.ReadAll(ctx, key, 20<<20)
				if err != nil || len(data) == 0 || len(data) > 20<<20 {
					return fmt.Errorf("视频读取失败或超过20MB")
				}
				kind := http.DetectContentType(data)
				if !strings.HasPrefix(kind, "video/") {
					return fmt.Errorf("无法识别视频格式")
				}
				ref = "data:" + kind + ";base64," + base64.StdEncoding.EncodeToString(data)
			}
		}
		var part map[string]interface{}
		if strings.HasPrefix(ref, "data:video/") {
			header, data, ok := strings.Cut(ref, ",")
			decoded, err := base64.StdEncoding.DecodeString(data)
			if !ok || !strings.HasSuffix(header, ";base64") || err != nil || len(decoded) == 0 || len(decoded) > 20<<20 {
				return fmt.Errorf("视频数据无效或超过20MB")
			}
			part = map[string]interface{}{"inlineData": map[string]interface{}{"mimeType": strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64"), "data": data}}
		} else {
			u, err := url.Parse(ref)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || isPrivateMediaURL(ref) {
				return fmt.Errorf("视频地址无法供模型访问，请重新上传视频")
			}
			kind := mime.TypeByExtension(path.Ext(u.Path))
			if !strings.HasPrefix(kind, "video/") {
				kind = "video/mp4"
			}
			part = map[string]interface{}{"fileData": map[string]interface{}{"mimeType": kind, "fileUri": ref}}
		}
		if normalizeWorkerLLMProtocol(protocol) == "gemini" {
			messages := body["contents"].([]map[string]interface{})
			messages[0]["parts"] = append(messages[0]["parts"].([]map[string]interface{}), part)
		} else {
			messages := body["messages"].([]map[string]interface{})
			last := messages[len(messages)-1]
			last["content"] = append(last["content"].([]map[string]interface{}), map[string]interface{}{"type": "video_url", "video_url": map[string]interface{}{"url": ref}})
		}
	}
	return nil
}

func applyAgentVisionContent(ctx context.Context, body map[string]interface{}, protocol, mode, system, user string, images []string) {
	switch normalizeWorkerLLMProtocol(protocol) {
	case "gemini":
		parts := []map[string]interface{}{{"text": user}}
		for _, ref := range collectBananaReferenceImages(ctx, images) {
			parts = append(parts, geminiImagePart(ref))
		}
		body["contents"] = []map[string]interface{}{{"role": "user", "parts": parts}}
	case "claude":
		parts := []map[string]interface{}{{"type": "text", "text": user}}
		for _, ref := range images {
			header, data, ok := strings.Cut(ref, ",")
			if !ok || !strings.HasPrefix(header, "data:image/") {
				continue
			}
			parts = append(parts, map[string]interface{}{"type": "image", "source": map[string]interface{}{"type": "base64", "media_type": strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64"), "data": data}})
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
