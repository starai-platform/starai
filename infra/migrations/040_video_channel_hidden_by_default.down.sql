UPDATE models
SET runtime_rule = jsonb_set(
  COALESCE(runtime_rule, '{}'::jsonb),
  '{video,show_channel}',
  'true'::jsonb,
  true
)
WHERE category = 'video';
