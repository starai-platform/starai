-- Store upstream provider task id for async image/video/audio jobs.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS upstream_task_id VARCHAR(128);
CREATE INDEX IF NOT EXISTS idx_tasks_upstream_task_id ON tasks(upstream_task_id) WHERE upstream_task_id IS NOT NULL;
