UPDATE models
SET
  new_api_endpoint = '/v1/audio/speech',
  runtime_rule = jsonb_set(
    runtime_rule - 'upstream',
    '{upstream}',
    '{"include":["count","voice_id","emotion","speed","format"],"map":{"count":"n"}}'::jsonb,
    true
  )
WHERE code = 'audio_minimax_speech_28_hd';
