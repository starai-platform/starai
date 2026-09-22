UPDATE model_routes r
SET timeout_seconds = CASE WHEN r.timeout_seconds = 90 THEN 120 ELSE r.timeout_seconds END,
    max_retries = CASE WHEN r.max_retries = 1 THEN 0 ELSE r.max_retries END,
    updated_at = now()
FROM models m
WHERE m.id = r.model_id
  AND m.request_mode IN ('chat_completions', 'responses');
