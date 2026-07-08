-- Refine audio workbench defaults: hide channel selector and promote key controls to input top area.
UPDATE models
SET
  input_schema = jsonb_set(input_schema, '{properties,format,x-placement}', '"audio_top"'::jsonb, true),
  runtime_rule = jsonb_set(runtime_rule, '{audio,show_channel}', 'false'::jsonb, true)
WHERE code = 'audio_minimax_speech_28_hd';

UPDATE models
SET
  input_schema = jsonb_set(
    jsonb_set(input_schema, '{properties,model_version,x-placement}', '"audio_top"'::jsonb, true),
    '{properties,format,x-placement}', '"audio_top"'::jsonb,
    true
  ),
  runtime_rule = jsonb_set(runtime_rule, '{audio,show_channel}', 'false'::jsonb, true)
WHERE code = 'audio_minimax_music_26';

UPDATE models
SET runtime_rule = jsonb_set(runtime_rule, '{audio,show_channel}', 'false'::jsonb, true)
WHERE category = 'audio'
  AND runtime_rule ? 'audio';
