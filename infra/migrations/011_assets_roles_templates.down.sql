DROP TABLE IF EXISTS role_templates;

ALTER TABLE prompt_roles
  DROP COLUMN IF EXISTS icon_url;

ALTER TABLE assets
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS asset_type;

