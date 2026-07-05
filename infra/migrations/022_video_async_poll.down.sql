UPDATE models SET runtime_rule = jsonb_set(
  runtime_rule,
  '{upstream}',
  '{"include":["count","duration","orientation","reference_images"],"map":{"count":"n","orientation":"aspect_ratio"}}'::jsonb,
  true
)
WHERE request_mode = 'video' AND code = 'video_demo_v1';
