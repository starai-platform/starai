UPDATE workflow_definitions
SET is_enabled = true, updated_at = now()
WHERE code = 'ai_comic_drama';
