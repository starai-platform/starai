package middleware

import (
	"fmt"
	"strings"
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
var creativeAgentPlanRequests atomic.Uint64
var creativeAgentContractFailures atomic.Uint64
var creativeAgentClarifications atomic.Uint64
var creativeAgentSubmissions atomic.Uint64
var creativeAgentWorkflowRoutes atomic.Uint64
var creativeAgentWorkflowRouteRejected atomic.Uint64
var creativeAgentRouteDecisions atomic.Uint64
var creativeAgentRouteChanges atomic.Uint64
var creativeAgentRouteLowConfidence atomic.Uint64
var creativeAgentWorkflowSubmissions atomic.Uint64
var creativeAgentWorkflowExecutionRejected atomic.Uint64

var creativeAgentStageBuckets = [...]uint64{100, 500, 1000, 3000, 10000, 30000, 90000}

type creativeAgentStageMetric struct {
	count      atomic.Uint64
	errors     atomic.Uint64
	durationMS atomic.Uint64
	buckets    [len(creativeAgentStageBuckets)]atomic.Uint64
}

var creativeAgentStages = []string{"context", "catalog", "search", "assets", "planner", "finalize"}
var creativeAgentTTFT creativeAgentStageMetric
var creativeAgentStageMetrics = map[string]*creativeAgentStageMetric{
	"context":  {},
	"catalog":  {},
	"search":   {},
	"assets":   {},
	"planner":  {},
	"finalize": {},
}

func RecordCreativeAgentTTFT(duration time.Duration) {
	recordCreativeAgentHistogram(&creativeAgentTTFT, duration)
}

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

func RecordCreativeAgentPlanRequest() {
	creativeAgentPlanRequests.Add(1)
}

func RecordCreativeAgentContractFailure() {
	creativeAgentContractFailures.Add(1)
}

func RecordCreativeAgentClarification() {
	creativeAgentClarifications.Add(1)
}

func RecordCreativeAgentSubmission() {
	creativeAgentSubmissions.Add(1)
}

func RecordCreativeAgentWorkflowRoute(rejected bool) {
	creativeAgentWorkflowRoutes.Add(1)
	if rejected {
		creativeAgentWorkflowRouteRejected.Add(1)
	}
}

func RecordCreativeAgentRouteDecision(changed, lowConfidence bool) {
	creativeAgentRouteDecisions.Add(1)
	if changed {
		creativeAgentRouteChanges.Add(1)
	}
	if lowConfidence {
		creativeAgentRouteLowConfidence.Add(1)
	}
}

func RecordCreativeAgentWorkflowSubmission() {
	creativeAgentWorkflowSubmissions.Add(1)
}

func RecordCreativeAgentWorkflowExecutionRejected() {
	creativeAgentWorkflowExecutionRejected.Add(1)
}

// RecordCreativeAgentStage records bounded-cardinality stage latency. Histogram
// buckets make p95 available to Prometheus without retaining individual traces.
func RecordCreativeAgentStage(stage string, duration time.Duration, failed bool) {
	metric := creativeAgentStageMetrics[stage]
	if metric == nil {
		return
	}
	recordCreativeAgentHistogram(metric, duration)
	if failed {
		metric.errors.Add(1)
	}
}

func recordCreativeAgentHistogram(metric *creativeAgentStageMetric, duration time.Duration) {
	milliseconds := duration.Milliseconds()
	if milliseconds < 0 {
		milliseconds = 0
	}
	value := uint64(milliseconds)
	metric.count.Add(1)
	metric.durationMS.Add(value)
	for index, upperBound := range creativeAgentStageBuckets {
		if value <= upperBound {
			metric.buckets[index].Add(1)
		}
	}
}

func PrometheusText(workerHeartbeatAgeSeconds int64) string {
	base := fmt.Sprintf(`# HELP starai_http_requests_total Total HTTP requests.
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
# HELP starai_creative_agent_plan_requests_total Total accepted creative Agent planning requests.
# TYPE starai_creative_agent_plan_requests_total counter
starai_creative_agent_plan_requests_total %d
# HELP starai_creative_agent_contract_failures_total Total planner outputs rejected by the structured response contract.
# TYPE starai_creative_agent_contract_failures_total counter
starai_creative_agent_contract_failures_total %d
# HELP starai_creative_agent_clarifications_total Total creative Agent plans that require another user turn.
# TYPE starai_creative_agent_clarifications_total counter
starai_creative_agent_clarifications_total %d
# HELP starai_creative_agent_submissions_total Total confirmed creative Agent media and workflow submissions.
# TYPE starai_creative_agent_submissions_total counter
starai_creative_agent_submissions_total %d
# HELP starai_creative_agent_workflow_routes_total Total planner turns that selected a workflow.
# TYPE starai_creative_agent_workflow_routes_total counter
starai_creative_agent_workflow_routes_total %d
# HELP starai_creative_agent_workflow_route_rejected_total Total workflow selections rejected because the workflow was unavailable.
# TYPE starai_creative_agent_workflow_route_rejected_total counter
starai_creative_agent_workflow_route_rejected_total %d
# HELP starai_creative_agent_route_decisions_total Total creative Agent model or workflow routing decisions.
# TYPE starai_creative_agent_route_decisions_total counter
starai_creative_agent_route_decisions_total %d
# HELP starai_creative_agent_route_changes_total Total creative Agent plans that changed an existing workflow route.
# TYPE starai_creative_agent_route_changes_total counter
starai_creative_agent_route_changes_total %d
# HELP starai_creative_agent_route_low_confidence_total Total creative Agent routing decisions below the confidence threshold.
# TYPE starai_creative_agent_route_low_confidence_total counter
starai_creative_agent_route_low_confidence_total %d
# HELP starai_creative_agent_workflow_submissions_total Total confirmed creative Agent workflow submissions.
# TYPE starai_creative_agent_workflow_submissions_total counter
starai_creative_agent_workflow_submissions_total %d
# HELP starai_creative_agent_workflow_execution_rejected_total Total confirmed workflow submissions rejected after current-definition validation.
# TYPE starai_creative_agent_workflow_execution_rejected_total counter
starai_creative_agent_workflow_execution_rejected_total %d
# HELP starai_worker_heartbeat_age_seconds Seconds since the latest worker heartbeat, or -1 when unavailable.
# TYPE starai_worker_heartbeat_age_seconds gauge
starai_worker_heartbeat_age_seconds %d
`, httpRequests.Load(), httpErrors.Load(), httpInFlight.Load(), httpDurationMS.Load(), rateLimitedRequests.Load(), paymentWebhookRejected.Load(), contentSafetyBlocked.Load(), creativeAgentPlanRequests.Load(), creativeAgentContractFailures.Load(), creativeAgentClarifications.Load(), creativeAgentSubmissions.Load(), creativeAgentWorkflowRoutes.Load(), creativeAgentWorkflowRouteRejected.Load(), creativeAgentRouteDecisions.Load(), creativeAgentRouteChanges.Load(), creativeAgentRouteLowConfidence.Load(), creativeAgentWorkflowSubmissions.Load(), creativeAgentWorkflowExecutionRejected.Load(), workerHeartbeatAgeSeconds)

	var output strings.Builder
	output.WriteString(base)
	output.WriteString("# HELP starai_creative_agent_stage_duration_ms Creative Agent stage duration in milliseconds.\n")
	output.WriteString("# TYPE starai_creative_agent_stage_duration_ms histogram\n")
	for _, stage := range creativeAgentStages {
		metric := creativeAgentStageMetrics[stage]
		for index, upperBound := range creativeAgentStageBuckets {
			fmt.Fprintf(&output, "starai_creative_agent_stage_duration_ms_bucket{stage=%q,le=%q} %d\n", stage, fmt.Sprint(upperBound), metric.buckets[index].Load())
		}
		fmt.Fprintf(&output, "starai_creative_agent_stage_duration_ms_bucket{stage=%q,le=\"+Inf\"} %d\n", stage, metric.count.Load())
		fmt.Fprintf(&output, "starai_creative_agent_stage_duration_ms_sum{stage=%q} %d\n", stage, metric.durationMS.Load())
		fmt.Fprintf(&output, "starai_creative_agent_stage_duration_ms_count{stage=%q} %d\n", stage, metric.count.Load())
	}
	output.WriteString("# HELP starai_creative_agent_stage_errors_total Creative Agent stage failures.\n")
	output.WriteString("# TYPE starai_creative_agent_stage_errors_total counter\n")
	for _, stage := range creativeAgentStages {
		fmt.Fprintf(&output, "starai_creative_agent_stage_errors_total{stage=%q} %d\n", stage, creativeAgentStageMetrics[stage].errors.Load())
	}
	output.WriteString("# HELP starai_creative_agent_ttft_ms Creative Agent time to first model token in milliseconds.\n")
	output.WriteString("# TYPE starai_creative_agent_ttft_ms histogram\n")
	for index, upperBound := range creativeAgentStageBuckets {
		fmt.Fprintf(&output, "starai_creative_agent_ttft_ms_bucket{le=%q} %d\n", fmt.Sprint(upperBound), creativeAgentTTFT.buckets[index].Load())
	}
	fmt.Fprintf(&output, "starai_creative_agent_ttft_ms_bucket{le=\"+Inf\"} %d\n", creativeAgentTTFT.count.Load())
	fmt.Fprintf(&output, "starai_creative_agent_ttft_ms_sum %d\n", creativeAgentTTFT.durationMS.Load())
	fmt.Fprintf(&output, "starai_creative_agent_ttft_ms_count %d\n", creativeAgentTTFT.count.Load())
	return output.String()
}
