DROP INDEX IF EXISTS idx_comic_drama_projects_user_archived;
ALTER TABLE comic_drama_projects DROP COLUMN IF EXISTS archived_at;
