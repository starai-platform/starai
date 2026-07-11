package middleware

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/starai/api/internal/util"
)

type RateLimiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration, error)
}

type RateIdentity func(*gin.Context) string

func ClientIPIdentity(c *gin.Context) string {
	return c.ClientIP()
}

func UserIdentity(c *gin.Context) string {
	if id := c.GetInt64("user_id"); id > 0 {
		return strconv.FormatInt(id, 10)
	}
	return ClientIPIdentity(c)
}

func RateLimit(limiter RateLimiter, prefix string, limit int, window time.Duration, identity RateIdentity) gin.HandlerFunc {
	return func(c *gin.Context) {
		if limiter == nil || limit <= 0 {
			c.Next()
			return
		}
		key := "unknown"
		if identity != nil {
			key = strings.TrimSpace(identity(c))
		}
		if key == "" {
			key = "unknown"
		}
		allowed, retryAfter, err := limiter.Allow(c.Request.Context(), fmt.Sprintf("%s:%s", prefix, key), limit, window)
		if err != nil {
			c.Next() // Redis 故障时放行，避免限流组件影响正常业务。
			return
		}
		if !allowed {
			RecordRateLimited()
			seconds := int(retryAfter.Seconds())
			if seconds < 1 {
				seconds = 1
			}
			c.Header("Retry-After", strconv.Itoa(seconds))
			util.Fail(c, 429, 429, "请求过于频繁，请稍后再试")
			c.Abort()
			return
		}
		c.Next()
	}
}
