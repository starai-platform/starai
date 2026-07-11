UPDATE workflow_definitions
SET display_config = COALESCE(display_config, '{}'::jsonb) - 'timeline',
    updated_at = now()
WHERE code = 'ai_comic_drama';
