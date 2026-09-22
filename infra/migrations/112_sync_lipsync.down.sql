-- Keep models referenced by historical tasks; disable instead of deleting history.
UPDATE models SET is_enabled=false, updated_at=now() WHERE code='video_sync_lipsync';
