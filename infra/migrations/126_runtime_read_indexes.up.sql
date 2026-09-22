CREATE INDEX IF NOT EXISTS idx_assets_user_created_public
  ON assets(user_id, created_at DESC, public_id DESC);

CREATE INDEX IF NOT EXISTS idx_task_events_latest_progress
  ON task_events(task_id, created_at DESC, id DESC)
  WHERE event_type = 'progress';
