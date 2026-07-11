DROP TABLE IF EXISTS content_safety_events;
DELETE FROM system_configs WHERE key IN ('content_safety_enabled', 'content_safety_blocked_terms');
