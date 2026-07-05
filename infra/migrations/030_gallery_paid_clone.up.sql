ALTER TABLE gallery_items
  ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price NUMERIC(18,6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_gallery_user_work ON gallery_items(user_id, work_id);
