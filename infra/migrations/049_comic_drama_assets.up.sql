-- Structured comic assets are additive. Existing workflow output JSON remains readable.
CREATE TABLE IF NOT EXISTS comic_drama_assets (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) UNIQUE NOT NULL,
  project_id BIGINT NOT NULL REFERENCES comic_drama_projects(id) ON DELETE CASCADE,
  asset_type VARCHAR(24) NOT NULL CHECK (asset_type IN ('character','prop','location')),
  asset_code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visual_prompt TEXT NOT NULL DEFAULT '',
  reference_asset_ids JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  version INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, asset_type, asset_code)
);
CREATE INDEX IF NOT EXISTS idx_comic_drama_assets_project_type
  ON comic_drama_assets(project_id, asset_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS comic_drama_storyboards (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES comic_drama_projects(id) ON DELETE CASCADE,
  workflow_project_id BIGINT REFERENCES workflow_projects(id) ON DELETE SET NULL,
  shot_id VARCHAR(64) NOT NULL,
  seq INT NOT NULL,
  title VARCHAR(256) NOT NULL DEFAULT '',
  duration_sec NUMERIC(8,2) NOT NULL DEFAULT 5,
  character_codes JSONB NOT NULL DEFAULT '[]',
  prop_codes JSONB NOT NULL DEFAULT '[]',
  location_code VARCHAR(64) NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workflow_project_id, shot_id)
);
CREATE INDEX IF NOT EXISTS idx_comic_drama_storyboards_project_seq
  ON comic_drama_storyboards(project_id, workflow_project_id, seq);
