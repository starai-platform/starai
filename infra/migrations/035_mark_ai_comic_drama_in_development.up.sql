UPDATE workflow_definitions
SET name = 'AI 漫剧 - S2.0（功能开发中...）',
    is_enabled = false,
    updated_at = now()
WHERE code = 'ai_comic_drama';
