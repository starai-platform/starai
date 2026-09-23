UPDATE workflow_definitions
SET runtime_config = COALESCE(runtime_config, '{}'::jsonb) - 'default_story_use_audio_model',
    updated_at = now()
WHERE code = 'ecommerce_video';
