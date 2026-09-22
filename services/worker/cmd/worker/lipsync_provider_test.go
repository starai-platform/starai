package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWaveSpeedLipSyncPolling(t *testing.T) {
	for _, status := range []string{"completed", "failed", "timeout", "deleted"} {
		t.Run(status, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer private-key" || r.URL.Path != "/api/v3/predictions/job-123/result" {
					t.Errorf("wrong polling request")
				}
				fmt.Fprintf(w, `{"code":200,"data":{"id":"job-123","status":%q,"outputs":["https://media.example/result.mp4"],"error":"provider failure"}}`, status)
			}))
			defer server.Close()
			_, id := parseUpstreamMedia([]byte(`{"code":200,"data":{"id":"job-123","status":"created","outputs":[]}}`))
			if id != "job-123" {
				t.Fatal("task ID not extracted")
			}
			items, _, err := pollUpstreamTask(context.Background(), nil, connectionConfig{BaseURL: server.URL, APIKey: "private-key", AuthType: "bearer"}, pollConfig{Path: "/api/v3/predictions/{id}/result", Timeout: time.Second, Interval: time.Millisecond}, id, "")
			if status == "completed" {
				if err != nil || len(items) != 1 || items[0].URL != "https://media.example/result.mp4" {
					t.Fatalf("result not parsed: %v %v", items, err)
				}
			} else if err == nil {
				t.Fatal("terminal failure accepted as success")
			}
		})
	}
}
