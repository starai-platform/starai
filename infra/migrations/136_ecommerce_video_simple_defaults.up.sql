-- Keep the one-click entry inexpensive and predictable. Users can opt into
-- more segments, narration and subtitles from the compact toolbar.
UPDATE workflow_definitions
SET runtime_config = COALESCE(runtime_config, '{}'::jsonb) || jsonb_build_object(
      'default_segment_count', 1,
      'default_story_use_audio_model', false,
      'default_story_subtitle_mode', 'none'
    ),
    updated_at = now()
WHERE code = 'ecommerce_video';
