-- Video models should not show the channel selector on the frontend by default.
-- Admins can still enable it per model from runtime_rule.video.show_channel.
UPDATE models
SET runtime_rule = jsonb_set(
  COALESCE(runtime_rule, '{}'::jsonb),
  '{video,show_channel}',
  'false'::jsonb,
  true
)
WHERE category = 'video';
