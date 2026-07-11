package middleware

import (
	"fmt"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

var httpRequests atomic.Uint64
var httpErrors atomic.Uint64
var httpInFlight atomic.Int64
var httpDurationMS atomic.Uint64
var rateLimitedRequests atomic.Uint64
var paymentWebhookRejected atomic.Uint64
var contentSafetyBlocked atomic.Uint64

func Metrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		httpRequests.Add(1)
		httpInFlight.Add(1)
		defer func() {
			httpInFlight.Add(-1)
			httpDurationMS.Add(uint64(time.Since(started).Milliseconds()))
			if c.Writer.Status() >= 500 {
				httpErrors.Add(1)
			}
		}()
		c.Next()
	}
}

func RecordRateLimited() {
	rateLimitedRequests.Add(1)
}

func RecordPaymentWebhookRejected() {
	paymentWebhookRejected.Add(1)
}

func RecordContentSafetyBlocked() {
	contentSafetyBlocked.Add(1)
}

func PrometheusText(workerHeartbeatAgeSeconds int64) string {
	return fmt.Sprintf(`# HELP starai_http_requests_total Total HTTP requests.
# TYPE starai_http_requests_total counter
starai_http_requests_total %d
# HELP starai_http_errors_total Total HTTP responses with status 500 or above.
# TYPE starai_http_errors_total counter
starai_http_errors_total %d
# HELP starai_http_in_flight Current in-flight HTTP requests.
# TYPE starai_http_in_flight gauge
starai_http_in_flight %d
# HELP starai_http_request_duration_ms_total Cumulative HTTP request duration in milliseconds.
# TYPE starai_http_request_duration_ms_total counter
starai_http_request_duration_ms_total %d
# HELP starai_rate_limited_requests_total Total requests rejected by rate limiting.
# TYPE starai_rate_limited_requests_total counter
starai_rate_limited_requests_total %d
# HELP starai_payment_webhook_rejected_total Total rejected external payment callbacks.
# TYPE starai_payment_webhook_rejected_total counter
starai_payment_webhook_rejected_total %d
# HELP starai_content_safety_blocked_total Total user requests blocked by platform content safety rules.
# TYPE starai_content_safety_blocked_total counter
starai_content_safety_blocked_total %d
# HELP starai_worker_heartbeat_age_seconds Seconds since the latest worker heartbeat, or -1 when unavailable.
# TYPE starai_worker_heartbeat_age_seconds gauge
starai_worker_heartbeat_age_seconds %d
`, httpRequests.Load(), httpErrors.Load(), httpInFlight.Load(), httpDurationMS.Load(), rateLimitedRequests.Load(), paymentWebhookRejected.Load(), contentSafetyBlocked.Load(), workerHeartbeatAgeSeconds)
}
