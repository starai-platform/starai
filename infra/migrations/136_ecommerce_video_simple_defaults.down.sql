UPDATE workflow_definitions
SET runtime_config = COALESCE(runtime_config, '{}'::jsonb) || jsonb_build_object(
      'default_segment_count', 3,
      'default_story_use_audio_model', true,
      'default_story_subtitle_mode', 'auto'
    ),
    updated_at = now()
WHERE code = 'ecommerce_video';
