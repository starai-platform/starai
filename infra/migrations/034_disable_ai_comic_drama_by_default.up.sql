UPDATE workflow_definitions
SET is_enabled = false, updated_at = now()
WHERE code = 'ai_comic_drama';
