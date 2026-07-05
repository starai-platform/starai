-- Video models typically return an upstream task id; enable async polling on all video models.
UPDATE models SET runtime_rule = jsonb_set(
  runtime_rule,
  '{upstream}',
  COALESCE(runtime_rule->'upstream', '{}'::jsonb) || '{
    "async": true,
    "poll_path": "/v1/video/generations/{id}",
    "poll_interval_sec": 5,
    "poll_timeout_sec": 900
  }'::jsonb,
  true
)
WHERE request_mode = 'video';

-- Sora-2: single reference image maps to upstream "image" field.
UPDATE models SET runtime_rule = jsonb_set(
  runtime_rule,
  '{upstream,map}',
  COALESCE(runtime_rule->'upstream'->'map', '{}'::jsonb) || '{"reference_images":"image"}'::jsonb,
  true
)
WHERE code = 'video_demo_v1';
