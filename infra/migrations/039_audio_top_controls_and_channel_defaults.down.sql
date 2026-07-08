UPDATE models
SET runtime_rule = jsonb_set(runtime_rule, '{audio,show_channel}', 'true'::jsonb, true)
WHERE category = 'audio'
  AND runtime_rule ? 'audio';
