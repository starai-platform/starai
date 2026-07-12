package main

import (
	"encoding/base64"
	"encoding/hex"
	"testing"
	"time"
)

func TestParseUpstreamMediaKeepsTaskIDWhenMediaExists(t *testing.T) {
	body := []byte(`{
		"code": "success",
		"data": {
			"id": 4219436,
			"task_id": "task_8bSnSQRDipvCCp1iqew8z1H8y0mbFqoD",
			"status": "SUCCESS",
			"result_url": "https://otuapi.com/v1/videos/task_ijlim0lsyqb6Svhqgh1VkAQf1ys1nUne/content"
		}
	}`)

	items, upstreamID := parseUpstreamMedia(body)
	if upstreamID != "task_8bSnSQRDipvCCp1iqew8z1H8y0mbFqoD" {
		t.Fatalf("upstreamID = %q", upstreamID)
	}
	if len(items) != 1 || items[0].URL != "https://otuapi.com/v1/videos/task_ijlim0lsyqb6Svhqgh1VkAQf1ys1nUne/content" {
		t.Fatalf("items = %#v", items)
	}
}

func TestParseUpstreamMediaReadsBase64Audio(t *testing.T) {
	audio := base64.StdEncoding.EncodeToString([]byte("ID3\x04audio-audio-audio-audio-audio-audio-audio-audio"))
	body := []byte(`{
		"data": {
			"audio": "` + audio + `",
			"format": "mp3"
		}
	}`)

	items, upstreamID := parseUpstreamMedia(body)
	if upstreamID != "" {
		t.Fatalf("upstreamID = %q", upstreamID)
	}
	if len(items) != 1 {
		t.Fatalf("items = %#v", items)
	}
	if items[0].B64JSON != audio {
		t.Fatalf("audio base64 = %q", items[0].B64JSON)
	}
	if items[0].MimeType != "mp3" {
		t.Fatalf("mime/format = %q", items[0].MimeType)
	}
}

func TestParseUpstreamMediaReadsHexAudio(t *testing.T) {
	audio := hex.EncodeToString([]byte("ID3\x04audio-audio-audio-audio-audio-audio-audio-audio"))
	body := []byte(`{
		"data": {
			"audio": "` + audio + `",
			"format": "mp3"
		}
	}`)

	items, _ := parseUpstreamMedia(body)
	if len(items) != 1 {
		t.Fatalf("items = %#v", items)
	}
	if items[0].B64JSON != audio {
		t.Fatalf("audio hex = %q", items[0].B64JSON)
	}
	data, contentType, err := decodeEncodedMedia(items[0].B64JSON, items[0].MimeType, "audio")
	if err != nil {
		t.Fatal(err)
	}
	if string(data[:3]) != "ID3" {
		t.Fatalf("decoded head = %q", string(data[:3]))
	}
	if contentType != "audio/mpeg" {
		t.Fatalf("contentType = %q", contentType)
	}
	dataURL := normalizeAudioResultURL(items[0].B64JSON, items[0].MimeType)
	if dataURL == "" {
		t.Fatal("data url fallback is empty")
	}
	if got, want := dataURL[:22], "data:audio/mpeg;base64"; got != want {
		t.Fatalf("data url prefix = %q, want %q", got, want)
	}
}

func TestParseUpstreamMediaReadsHexAudioFromDataString(t *testing.T) {
	audio := hex.EncodeToString([]byte("ID3\x04music-music-music-music-music-music-music"))
	body := []byte(`{"data":"` + audio + `","format":"mp3"}`)

	items, _ := parseUpstreamMedia(body)
	if len(items) != 1 || items[0].B64JSON != audio {
		t.Fatalf("items = %#v", items)
	}
}

func TestParseUpstreamMediaReadsHexAudioFromAudioFile(t *testing.T) {
	audio := hex.EncodeToString([]byte("ID3\x04music-music-music-music-music-music-music"))
	body := []byte(`{"data":{"audio_file":"` + audio + `","audio_format":"mp3"}}`)

	items, _ := parseUpstreamMedia(body)
	if len(items) != 1 || items[0].B64JSON != audio || items[0].MimeType != "mp3" {
		t.Fatalf("items = %#v", items)
	}
}

func TestParseUpstreamMediaReadsNestedAudioResult(t *testing.T) {
	audio := hex.EncodeToString([]byte("ID3\x04music-music-music-music-music-music-music"))
	body := []byte(`{"data":{"audio_result":{"audio":"` + audio + `","format":"mp3"}}}`)

	items, _ := parseUpstreamMedia(body)
	if len(items) != 1 || items[0].B64JSON != audio {
		t.Fatalf("items = %#v", items)
	}
}

func TestParseUpstreamMediaReadsRawMP3Audio(t *testing.T) {
	body := append([]byte("ID3\x04\x00\x00\x00\x00\x00\x21TXXX=AIGC"), []byte("audio-audio-audio-audio-audio")...)

	items, upstreamID := parseUpstreamMedia(body)
	if upstreamID != "" {
		t.Fatalf("upstreamID = %q", upstreamID)
	}
	if len(items) != 1 {
		t.Fatalf("items = %#v", items)
	}
	if items[0].MimeType != "audio/mpeg" {
		t.Fatalf("mime = %q", items[0].MimeType)
	}
	data, contentType, err := decodeEncodedMedia(items[0].B64JSON, items[0].MimeType, "audio")
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "audio/mpeg" {
		t.Fatalf("contentType = %q", contentType)
	}
	if string(data[:3]) != "ID3" {
		t.Fatalf("decoded head = %q", string(data[:3]))
	}
}

func TestJoinBaseEndpointNormalizesMissingSlash(t *testing.T) {
	got := joinBaseEndpoint("https://api.minimaxi.com/", "v1/music_generation")
	if got != "https://api.minimaxi.com/v1/music_generation" {
		t.Fatalf("url = %q", got)
	}
}

func TestUpstreamRequestTimeoutSupportsAudioAndOverride(t *testing.T) {
	if got := upstreamRequestTimeout(nil, true); got != 15*time.Minute {
		t.Fatalf("audio timeout = %s", got)
	}
	got := upstreamRequestTimeout(map[string]interface{}{
		"upstream": map[string]interface{}{"request_timeout_sec": float64(900)},
	}, true)
	if got != 15*time.Minute {
		t.Fatalf("override timeout = %s", got)
	}
}

func TestFirstSuccessMediaURLAcceptsSameOriginContentFromFailReason(t *testing.T) {
	raw := map[string]interface{}{
		"status":      "SUCCESS",
		"fail_reason": "https://otuapi.com/v1/videos/task_content/content",
	}
	conn := connectionConfig{BaseURL: "https://otuapi.com"}

	got := firstSuccessMediaURL(raw, "task_original", conn)
	if got != "https://otuapi.com/v1/videos/task_original/content" {
		t.Fatalf("media url = %q", got)
	}
}

func TestBuildMediaDownloadCandidatesPreferOriginalTaskID(t *testing.T) {
	conn := connectionConfig{BaseURL: "https://otuapi.com"}
	got := buildMediaDownloadCandidates(conn, "https://otuapi.com/v1/videos/task_wrong/content", "task_original")

	want := []string{
		"https://otuapi.com/v1/videos/task_original/content",
		"https://otuapi.com/v1/videos/task_wrong/content",
	}
	if len(got) != len(want) {
		t.Fatalf("candidates = %#v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("candidate[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestShouldNotMirrorPublicCDNMediaURL(t *testing.T) {
	conn := connectionConfig{BaseURL: "https://otuapi.com"}

	if shouldMirrorMediaURL("https://oss-us.file-download.life/2026/06/13/video.mp4", conn) {
		t.Fatal("public CDN mp4 should be used directly instead of mirrored through /content")
	}
	if !shouldMirrorMediaURL("https://otuapi.com/v1/videos/task_original/content", conn) {
		t.Fatal("same-origin /content url should be mirrored")
	}
}

func TestHardDownload404(t *testing.T) {
	body := []byte(`{"error":{"message":"Task not found","type":"invalid_request_error"}}`)
	if !isHardDownload404(404, body) {
		t.Fatal("Task not found 404 should switch candidates without retrying")
	}
	if isHardDownload404(404, []byte(`{"error":{"message":"not ready"}}`)) {
		t.Fatal("generic 404 can still be transient")
	}
}

func TestParsePollConfigCorrectsLegacySoraVideosPath(t *testing.T) {
	cfg := parsePollConfig(map[string]interface{}{
		"upstream": map[string]interface{}{
			"poll_path": "/v1/video/generations/{id}",
		},
	}, "/v1/videos")

	if cfg.Path != "/v1/videos/{id}" {
		t.Fatalf("poll path = %q", cfg.Path)
	}
}

func TestUpstreamErrorMessageHumanizesUnsafePrompt(t *testing.T) {
	body := []byte(`{"code":"upstream_error","message":"The provided prompt is considered unsafe and it cannot be used to generate content."}`)

	got := upstreamErrorMessage(body)
	if got != "生成内容未通过安全审核，请修改提示词或参考图后重试" {
		t.Fatalf("message = %q", got)
	}
}

func TestUpstreamErrorMessageReadsBaseResp(t *testing.T) {
	body := []byte(`{"data":null,"trace_id":"x","base_resp":{"status_code":1008,"status_msg":"insufficient balance"}}`)

	got := upstreamErrorMessage(body)
	want := "上游模型账户余额不足，请检查或更换可用渠道"
	if got != want {
		t.Fatalf("message = %q, want %q", got, want)
	}
}
