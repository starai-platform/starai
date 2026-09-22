package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func validateChatMedia(images, videos []string, audioRefs ...[]string) error {
	total := 0
	media := map[string][]string{"image": images, "video": videos}
	for _, refs := range audioRefs {
		media["audio"] = append(media["audio"], refs...)
	}
	for kind, refs := range media {
		for _, ref := range refs {
			if strings.HasPrefix(ref, "data:") {
				header, payload, ok := strings.Cut(ref, ",")
				if !ok || !strings.HasPrefix(header, "data:"+kind+"/") || !strings.HasSuffix(header, ";base64") || len(payload) > 28<<20 {
					return errors.New("媒体数据格式无效或超过20MB")
				}
				data, err := base64.StdEncoding.DecodeString(payload)
				total += len(data)
				if err != nil || len(data) == 0 || total > 20<<20 || !strings.HasPrefix(chatMediaMIME(data, kind), kind+"/") {
					return errors.New("媒体内容无效或总大小超过20MB")
				}
				continue
			}
			u, err := url.Parse(ref)
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
				return errors.New("媒体地址无效，请重新上传")
			}
			ip := net.ParseIP(u.Hostname())
			if strings.EqualFold(u.Hostname(), "localhost") || (ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast())) {
				return errors.New("模型无法访问本地媒体地址，请重新上传素材")
			}
		}
	}
	return nil
}

func chatMediaMIME(data []byte, kind string) string {
	detected := http.DetectContentType(data)
	if kind != "audio" {
		return detected
	}
	if detected == "audio/wave" || detected == "audio/x-wav" {
		return "audio/wav"
	}
	if bytes.HasPrefix(data, []byte("fLaC")) {
		return "audio/flac"
	}
	if bytes.HasPrefix(data, []byte("OggS")) {
		return "audio/ogg"
	}
	if detected == "video/mp4" || len(data) >= 12 && string(data[4:8]) == "ftyp" && strings.HasPrefix(string(data[8:12]), "M4A") {
		return "audio/m4a"
	}
	if detected == "video/webm" {
		return "audio/webm"
	}
	if len(data) >= 4 && data[0] == 0xff && data[1]&0xe0 == 0xe0 && data[1]&0x06 != 0 && data[2]&0xf0 != 0xf0 && data[2]&0x0c != 0x0c {
		return "audio/mpeg"
	}
	return detected
}

func inlineChatAudio(ctx context.Context, refs []string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if err := validateChatMedia(nil, nil, refs); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(refs))
	total := 0
	for _, ref := range refs {
		if strings.HasPrefix(ref, "data:") {
			_, payload, _ := strings.Cut(ref, ",")
			data, _ := base64.StdEncoding.DecodeString(payload)
			total += len(data)
			if total > 20<<20 {
				return nil, errors.New("参考音频总大小超过20MB")
			}
			out = append(out, "data:"+chatMediaMIME(data, "audio")+";base64,"+payload)
			continue
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, ref, nil)
		if err != nil {
			return nil, err
		}
		response, err := safeImportHTTPClient().Do(request)
		if err != nil {
			return nil, errors.New("参考音频读取失败，请重新上传音频")
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, int64((20<<20)-total+1)))
		response.Body.Close()
		total += len(data)
		if readErr != nil || response.StatusCode != http.StatusOK || len(data) == 0 || total > 20<<20 {
			return nil, errors.New("参考音频读取失败或总大小超过20MB")
		}
		mediaType := chatMediaMIME(data, "audio")
		if !strings.HasPrefix(mediaType, "audio/") {
			return nil, errors.New("参考音频格式无法识别，请使用MP3、WAV、M4A、FLAC、OGG或WebM")
		}
		out = append(out, "data:"+mediaType+";base64,"+base64.StdEncoding.EncodeToString(data))
	}
	return out, nil
}
