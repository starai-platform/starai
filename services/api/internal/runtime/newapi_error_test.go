package runtime

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestNormalizeHTTPErrorClassifiesGatewayAndBadRequest(t *testing.T) {
	tests := []struct {
		status int
		body   string
		code   string
	}{
		{http.StatusBadGateway, `<html><title>502 Bad gateway</title><p>cloudflare ray abc</p></html>`, "MODEL_GATEWAY_ERROR"},
		{http.StatusBadRequest, `{"error":{"message":"unsupported image format"}}`, "MODEL_BAD_REQUEST"},
	}
	for _, tt := range tests {
		resp := &http.Response{StatusCode: tt.status, Body: io.NopCloser(strings.NewReader(tt.body))}
		err, ok := normalizeHTTPError(resp).(*PlatformError)
		if !ok || err.Code != tt.code || err.StatusCode != tt.status || err.Detail == "" {
			t.Fatalf("status %d: %#v", tt.status, err)
		}
	}
}
