package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const RequestIDKey = "request_id"

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := strings.TrimSpace(c.GetHeader("X-Request-ID"))
		if len(id) == 0 || len(id) > 128 {
			buf := make([]byte, 12)
			if _, err := rand.Read(buf); err == nil {
				id = hex.EncodeToString(buf)
			} else {
				id = "unknown"
			}
		}
		c.Set(RequestIDKey, id)
		c.Header("X-Request-ID", id)
		c.Next()
	}
}

func RequestLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		c.Next()
		log.Printf("http request_id=%s method=%s path=%q status=%d duration_ms=%d client_ip=%s",
			c.GetString(RequestIDKey), c.Request.Method, c.Request.URL.Path, c.Writer.Status(), time.Since(started).Milliseconds(), c.ClientIP())
	}
}
