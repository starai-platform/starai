package middleware

import (
	"strings"
	"testing"
	"time"
)

func TestPrometheusTextIncludesCoreMetrics(t *testing.T) {
	text := PrometheusText(15)
	for _, name := range []string{"starai_http_requests_total", "starai_http_errors_total", "starai_payment_webhook_rejected_total", "starai_content_safety_blocked_total", "starai_creative_agent_plan_requests_total", "starai_creative_agent_contract_failures_total", "starai_creative_agent_clarifications_total", "starai_creative_agent_submissions_total", "starai_creative_agent_workflow_routes_total", "starai_creative_agent_workflow_route_rejected_total", "starai_creative_agent_route_decisions_total", "starai_creative_agent_route_changes_total", "starai_creative_agent_route_low_confidence_total", "starai_creative_agent_workflow_submissions_total", "starai_creative_agent_workflow_execution_rejected_total", "starai_worker_heartbeat_age_seconds 15"} {
		if !strings.Contains(text, name) {
			t.Fatalf("metrics output missing %q", name)
		}
	}
}

func TestCreativeAgentStageHistogram(t *testing.T) {
	RecordCreativeAgentStage("planner", 1500*time.Millisecond, true)
	RecordCreativeAgentTTFT(750 * time.Millisecond)
	text := PrometheusText(0)
	for _, value := range []string{
		`starai_creative_agent_stage_duration_ms_bucket{stage="planner",le="3000"}`,
		`starai_creative_agent_stage_duration_ms_count{stage="planner"}`,
		`starai_creative_agent_stage_errors_total{stage="planner"}`,
		`starai_creative_agent_ttft_ms_bucket{le="1000"}`,
		`starai_creative_agent_ttft_ms_count`,
	} {
		if !strings.Contains(text, value) {
			t.Fatalf("metrics output missing %q", value)
		}
	}
}
