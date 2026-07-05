-- Sora 等视频任务常需 20–40 分钟，将轮询超时从 15 分钟提高到 60 分钟。
UPDATE models
SET runtime_rule = jsonb_set(
  runtime_rule,
  '{upstream,poll_timeout_sec}',
  '3600'::jsonb,
  true
)
WHERE request_mode = 'video'
  AND runtime_rule->'upstream'->>'async' = 'true'
  AND COALESCE((runtime_rule->'upstream'->>'poll_timeout_sec')::int, 900) <= 900;
