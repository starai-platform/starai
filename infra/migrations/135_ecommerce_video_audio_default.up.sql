UPDATE workflow_definitions
SET runtime_config = COALESCE(runtime_config, '{}'::jsonb)
      || jsonb_build_object('default_story_use_audio_model', true),
    updated_at = now()
WHERE code = 'ecommerce_video';
