DROP INDEX IF EXISTS idx_gallery_user_work;

ALTER TABLE gallery_items
  DROP COLUMN IF EXISTS price,
  DROP COLUMN IF EXISTS is_paid;
