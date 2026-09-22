-- Return before the public edge timeout and retry one fast transient gateway failure.
UPDATE model_routes r
SET timeout_seconds = LEAST(r.timeout_seconds, 90),
    max_retries = CASE WHEN r.max_retries = 0 THEN 1 ELSE r.max_retries END,
    updated_at = now()
FROM models m
WHERE m.id = r.model_id
  AND m.request_mode IN ('chat_completions', 'responses');
