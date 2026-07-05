DROP TABLE IF EXISTS api_tokens;
DROP TABLE IF EXISTS daily_checkins;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS announcements;
DELETE FROM system_configs WHERE key='daily_checkin_reward';
