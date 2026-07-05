UPDATE models
SET runtime_rule = jsonb_set(
  runtime_rule,
  '{upstream,poll_timeout_sec}',
  '900'::jsonb,
  true
)
WHERE request_mode = 'video'
  AND runtime_rule->'upstream'->>'async' = 'true';
