package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/starai/api/internal/runtime"
)

func TestOpenAPIPlatformErrorAvoidsMisleading502(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		err        *runtime.PlatformError
		wantStatus int
	}{
		{&runtime.PlatformError{Code: "MODEL_BAD_REQUEST", Message: "bad request", StatusCode: 400}, http.StatusBadRequest},
		{&runtime.PlatformError{Code: "MODEL_GATEWAY_ERROR", Message: "gateway", StatusCode: 502}, http.StatusServiceUnavailable},
		{&runtime.PlatformError{Code: "MODEL_TIMEOUT", Message: "timeout"}, http.StatusServiceUnavailable},
	}
	for _, tt := range tests {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		openAPIPlatformError(ctx, tt.err)
		if recorder.Code != tt.wantStatus {
			t.Fatalf("%s: status = %d, want %d", tt.err.Code, recorder.Code, tt.wantStatus)
		}
		if tt.wantStatus == http.StatusServiceUnavailable && recorder.Header().Get("Retry-After") == "" {
			t.Fatalf("%s: missing Retry-After", tt.err.Code)
		}
	}
}
