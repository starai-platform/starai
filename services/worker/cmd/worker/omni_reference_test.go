package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/starai/worker/internal/storage"
)

type omniReferenceTransport func(*http.Request) (*http.Response, error)

func (f omniReferenceTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestOmniPublicReferenceURLsAreEmbedded(t *testing.T) {
	previousTransport, previousStore := http.DefaultTransport, objectStore
	t.Cleanup(func() { http.DefaultTransport, objectStore = previousTransport, previousStore })
	objectStore = nil
	png := []byte("\x89PNG\r\n\x1a\nimage")
	requests := 0
	http.DefaultTransport = omniReferenceTransport(func(r *http.Request) (*http.Response, error) {
		requests++
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"image/png"}}, Body: io.NopCloser(bytes.NewReader(png))}, nil
	})
	urls := []string{"https://cdn.example.test/first.png", "https://cdn.example.test/last.png"}
	encoded := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	for _, model := range []string{"omni_flash-10s", "omni_flash-10s-fl"} {
		for _, refs := range []interface{}{urls, []interface{}{urls[0], urls[1]}} {
			payload := map[string]interface{}{"model": model, "size": "720x1280", "images": refs}
			if err := normalizePayloadMedia(context.Background(), payload, "/v1/videos"); err != nil {
				t.Fatal(err)
			}
			if err := validateOmniReferencePayload(payload); err != nil {
				t.Fatalf("readable public references rejected for %s: %v", model, err)
			}
			if !reflect.DeepEqual(payload["images"], []string{encoded, encoded}) || payload["size"] != "720x1280" {
				t.Fatal("Omni image bytes or requested size changed")
			}
		}
	}
	if requests != 8 {
		t.Fatalf("read %d references, want 8", requests)
	}
	for _, model := range []string{"seedance-2.0", "minimax-h3", "veo_3_1-fast"} {
		payload := map[string]interface{}{"model": model, "images": urls}
		if err := normalizePayloadMedia(context.Background(), payload, "/v1/videos"); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(payload["images"], urls) || requests != 8 {
			t.Fatalf("public URL handling changed for %s", model)
		}
	}
}

func TestOmniPublicReferencesUseStorageFallbackAndStillRejectUnreadableImages(t *testing.T) {
	previousTransport, previousStore := http.DefaultTransport, objectStore
	t.Cleanup(func() { http.DefaultTransport, objectStore = previousTransport, previousStore })
	http.DefaultTransport = omniReferenceTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusNotFound, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("missing"))}, nil
	})
	store, err := storage.NewLocal(t.TempDir(), "https://cdn.example.test/uploads")
	if err != nil {
		t.Fatal(err)
	}
	objectStore = store
	png := []byte("\x89PNG\r\n\x1a\nimage")
	source, err := store.Upload(context.Background(), "assets/ref.png", "image/png", bytes.NewReader(png), int64(len(png)))
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]interface{}{"model": "omni_flash-10s", "images": []string{source}}
	if err := normalizePayloadMedia(context.Background(), payload, "/v1/videos"); err != nil {
		t.Fatal(err)
	}
	if err := validateOmniReferencePayload(payload); err != nil {
		t.Fatalf("managed reference fallback failed: %v", err)
	}
	payload["images"] = []string{"https://cdn.example.test/uploads/assets/missing.png"}
	if err := normalizePayloadMedia(context.Background(), payload, "/v1/videos"); err != nil {
		t.Fatal(err)
	}
	if err := validateOmniReferencePayload(payload); err == nil {
		t.Fatal("unreadable reference must still block generation")
	}
}
