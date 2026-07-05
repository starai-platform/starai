package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestExtractBearer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name   string
		header string
		query  string
		want   string
	}{
		{
			name:   "standard bearer",
			header: "Bearer sk-starai-test",
			want:   "sk-starai-test",
		},
		{
			name:   "case insensitive bearer with extra spaces",
			header: "  bearer   sk-starai-test  ",
			want:   "sk-starai-test",
		},
		{
			name:  "token query fallback",
			query: "?token=sk-starai-query",
			want:  "sk-starai-query",
		},
		{
			name:  "api key query fallback",
			query: "?api_key=sk-starai-query",
			want:  "sk-starai-query",
		},
		{
			name: "empty",
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			req := httptest.NewRequest(http.MethodGet, "/v1/chat/completions"+tt.query, nil)
			if tt.header != "" {
				req.Header.Set("Authorization", tt.header)
			}
			c.Request = req

			if got := extractBearer(c); got != tt.want {
				t.Fatalf("extractBearer()=%q, want %q", got, tt.want)
			}
		})
	}
}
