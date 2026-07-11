# 运行指标与告警

API 服务提供两个只读端点：

- `GET /health`：API 存活状态、Worker 心跳状态和心跳延迟。
- `GET /metrics`：Prometheus 文本格式运行指标。

当前指标：

- `starai_http_requests_total`
- `starai_http_errors_total`
- `starai_http_in_flight`
- `starai_http_request_duration_ms_total`
- `starai_rate_limited_requests_total`
- `starai_payment_webhook_rejected_total`
- `starai_content_safety_blocked_total`
- `starai_worker_heartbeat_age_seconds`

建议的基础告警：

```yaml
groups:
  - name: starai
    rules:
      - alert: StarAIWorkerHeartbeatStale
        expr: starai_worker_heartbeat_age_seconds < 0 or starai_worker_heartbeat_age_seconds > 120
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: StarAI Worker 心跳异常

      - alert: StarAIHTTPErrorRateHigh
        expr: rate(starai_http_errors_total[5m]) / clamp_min(rate(starai_http_requests_total[5m]), 0.001) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: StarAI API 5xx 比例超过 5%

      - alert: StarAIRateLimitSpike
        expr: increase(starai_rate_limited_requests_total[10m]) > 100
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: StarAI 限流命中数异常上升

      - alert: StarAIPaymentWebhookRejected
        expr: increase(starai_payment_webhook_rejected_total[10m]) > 5
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: StarAI 支付回调连续验签或业务校验失败

      - alert: StarAIContentSafetySpike
        expr: increase(starai_content_safety_blocked_total[10m]) > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: StarAI 内容安全拦截量异常升高
```

`/health` 始终以 API 自身是否可响应作为 HTTP 健康检查依据。Worker 心跳异常通过响应中的 `worker_status` 和指标单独告警，避免 Worker 短暂重启导致 API、Web 和 Admin 被连锁重启。
