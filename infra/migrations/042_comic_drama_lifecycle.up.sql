ALTER TABLE comic_drama_projects
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_comic_drama_projects_user_archived
  ON comic_drama_projects(user_id, archived_at, updated_at DESC);
