DROP INDEX IF EXISTS idx_tasks_upstream_task_id;
ALTER TABLE tasks DROP COLUMN IF EXISTS upstream_task_id;
