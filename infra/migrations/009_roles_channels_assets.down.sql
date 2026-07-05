ALTER TABLE assets
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS tags;

DROP TABLE IF EXISTS model_channel_presets;
DROP TABLE IF EXISTS prompt_roles;

