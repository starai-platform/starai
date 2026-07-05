-- Roles, channel presets and asset metadata for bottom-input-wrapper.

CREATE TABLE IF NOT EXISTS prompt_roles (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  name VARCHAR(64) NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prompt_roles_user ON prompt_roles(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_channel_presets (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(32) UNIQUE NOT NULL, -- success_first / speed_first / price_first
  name VARCHAR(64) NOT NULL,
  description TEXT,
  strategy VARCHAR(32) NOT NULL DEFAULT 'price_first',
  is_fallback_enabled BOOLEAN NOT NULL DEFAULT true,
  model_codes JSONB NOT NULL DEFAULT '[]', -- an ordered list of model codes to try (optional)
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO model_channel_presets (key, name, description, strategy, is_fallback_enabled, model_codes, is_enabled, sort_order) VALUES
  ('success_first', '成功率优先', '优先选择成功率最高的渠道', 'success_first', true, '[]', true, 1),
  ('speed_first', '速度优先', '优先选择响应速度最快的渠道', 'speed_first', true, '[]', true, 2),
  ('price_first', '价格优先', '优先选择价格最低的渠道', 'price_first', true, '[]', true, 3)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS name VARCHAR(128),
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';

