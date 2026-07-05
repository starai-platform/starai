package main

import "testing"

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
