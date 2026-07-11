package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type fakeLimiter struct {
	allowed bool
	err     error
}

func (f fakeLimiter) Allow(context.Context, string, int, time.Duration) (bool, time.Duration, error) {
	return f.allowed, 12 * time.Second, f.err
}

func TestRateLimitRejectsWithRetryAfter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/", RateLimit(fakeLimiter{allowed: false}, "test", 1, time.Minute, ClientIPIdentity), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status=%d, want %d", w.Code, http.StatusTooManyRequests)
	}
	if got := w.Header().Get("Retry-After"); got != "12" {
		t.Fatalf("Retry-After=%q, want 12", got)
	}
}
