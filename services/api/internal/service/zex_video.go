package service

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// Validate before freezing funds; native gateway aliases are normalized to the
// same platform slots used by the workbench, canvas and worker.
func validateZexVideoParams(model *ModelFull, cfg videoRuntimeConfig, params map[string]interface{}) error {
	if strings.TrimSpace(stringValue(params["portrait_asset_id"])) != "" || strings.TrimSpace(stringValue(params["draft_task_id"])) != "" {
		return errors.New("章鱼哥网关不支持火山人像资产或样片任务 ID")
	}
	if strings.TrimSpace(stringValue(params["prompt"])) == "" {
		return errors.New("视频生成需要填写提示词")
	}
	for native, platform := range map[string]string{"images": cfg.ReferenceImagesKey, "videos": cfg.ReferenceVideosKey, "audios": cfg.ReferenceAudiosKey} {
		if native == platform {
			continue
		}
		if value, exists := params[native]; exists {
			if _, conflict := params[platform]; conflict {
				return fmt.Errorf("参数 %s 与 %s 不能同时传入", native, platform)
			}
			params[platform] = value
			delete(params, native)
		}
	}
	if flag, exists := params["first_last_frame"]; exists {
		frame, valid := flag.(bool)
		if !valid {
			return errors.New("first_last_frame 必须是布尔值")
		}
		if frame {
			if urlFieldCount(params[cfg.FirstFrameKey])+urlFieldCount(params[cfg.LastFrameKey]) > 0 {
				return errors.New("首尾帧参数不能重复传入")
			}
			images, ok := zexMediaURLs(params[cfg.ReferenceImagesKey])
			if !ok || len(images) < 1 || len(images) > 2 {
				return errors.New("首帧或首尾帧模式需要 1～2 张图片")
			}
			params[cfg.FirstFrameKey] = images[0]
			if len(images) == 2 {
				params[cfg.LastFrameKey] = images[1]
			}
			delete(params, cfg.ReferenceImagesKey)
		}
		delete(params, "first_last_frame")
	}
	counts := map[string]int{}
	for _, key := range []string{cfg.ReferenceImagesKey, cfg.ReferenceVideosKey, cfg.ReferenceAudiosKey, cfg.FirstFrameKey, cfg.LastFrameKey} {
		if value, exists := params[key]; exists {
			items, valid := zexMediaURLs(value)
			if !valid {
				return fmt.Errorf("参考素材 %s 必须使用 URL 数组或首尾帧直链", key)
			}
			for _, item := range items {
				if strings.HasPrefix(item, "data:image/") && key != cfg.ReferenceVideosKey && key != cfg.ReferenceAudiosKey {
					continue
				}
				address, err := url.Parse(item)
				if err != nil || address.Host == "" || (address.Scheme != "https" && address.Scheme != "http") {
					return fmt.Errorf("参考素材 %s 必须填写实际文件直链", key)
				}
				if key == cfg.ReferenceVideosKey || key == cfg.ReferenceAudiosKey {
					host := strings.ToLower(address.Hostname())
					ip := net.ParseIP(host)
					if host == "localhost" || host == "minio" || (ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast())) {
						return fmt.Errorf("参考视频或音频必须使用网关可访问的公网直链，请配置素材存储公网地址")
					}
				}
			}
			counts[key] = len(items)
		}
	}
	i, v, a := counts[cfg.ReferenceImagesKey], counts[cfg.ReferenceVideosKey], counts[cfg.ReferenceAudiosKey]
	f, l := counts[cfg.FirstFrameKey], counts[cfg.LastFrameKey]
	video, _ := model.RuntimeRule["video"].(map[string]interface{})
	if i > cfg.MaxReferenceImages || v > cfg.MaxReferenceVideos || a > cfg.MaxReferenceAudios {
		return errors.New("参考素材数量超过模型限制")
	}
	if maxTotal := intFromAny(video["max_reference_total"], 9); i+v+a+f+l > maxTotal {
		return fmt.Errorf("图片、视频、音频参考素材数量合计最多 %d 项（当前 %d 项）", maxTotal, i+v+a+f+l)
	}
	if f > 1 || l > 1 || (l > 0 && f == 0) || (f+l > 0 && i+v+a > 0) {
		return errors.New("首帧或首尾帧不能与参考素材混用，尾帧必须配合首帧")
	}
	mode := strings.TrimSpace(stringValue(params[cfg.ModeParam]))
	if mode == "" || mode == "text" {
		switch {
		case l > 0:
			mode = "first_last"
		case f > 0:
			mode = "first_frame"
		case i+v+a > 0:
			mode = "reference"
			if cfg.UploadProfile == "seedance_2" {
				var kinds []string
				if i > 0 {
					kinds = append(kinds, "image")
				}
				if v > 0 {
					kinds = append(kinds, "video")
				}
				if a > 0 {
					kinds = append(kinds, "audio")
				}
				mode = strings.Join(kinds, "_")
			}
		default:
			mode = "text"
		}
		params[cfg.ModeParam] = mode
	}
	if (mode == "first_frame" && (f != 1 || l != 0)) || (mode == "first_last" && (f != 1 || l != 1)) || (mode == "reference" && (i+v+a == 0 || f+l > 0)) {
		return errors.New("参考素材与所选生成模式不匹配")
	}
	combination := mode == "image" || mode == "video" || mode == "audio" || mode == "image_audio" || mode == "image_video" || mode == "video_audio" || mode == "image_video_audio"
	if !combination && mode != "text" && mode != "first_frame" && mode != "first_last" && mode != "reference" {
		return errors.New("不支持的 generation_mode 素材组合")
	}
	if combination {
		if f+l > 0 {
			return errors.New("首尾帧不能与参考素材组合混用")
		}
		for kind, count := range map[string]int{"image": i, "video": v, "audio": a} {
			if strings.Contains(mode, kind) != (count > 0) {
				return errors.New("参考素材与所选素材组合不匹配")
			}
		}
	}
	if mode == "reference" && (cfg.UploadProfile == "multi_ref" || cfg.UploadProfile == "single_ref") && (v+a > 0 || i < cfg.MinReferenceImages) {
		return errors.New("当前上传形态仅支持配置数量的参考图片")
	}
	if mode == "reference" && cfg.UploadProfile == "single_ref" && i > 1 {
		return errors.New("单参考图形态最多支持 1 张参考图片")
	}
	if maximum := intFromAny(video["reference_max_duration"], 0); maximum > 0 && (mode == "reference" || combination) && i > 1 && parseDurationSeconds(params) > float64(maximum) {
		return fmt.Errorf("该模型多图参考最长支持 %d 秒", maximum)
	}
	return nil
}

func zexMediaURLs(value interface{}) ([]string, bool) {
	var items []string
	switch raw := value.(type) {
	case string:
		items = []string{raw}
	case []string:
		items = raw
	case []interface{}:
		for _, item := range raw {
			text, valid := item.(string)
			if !valid {
				return nil, false
			}
			items = append(items, text)
		}
	default:
		return nil, false
	}
	for _, item := range items {
		if strings.TrimSpace(item) == "" {
			return nil, false
		}
	}
	return items, true
}
