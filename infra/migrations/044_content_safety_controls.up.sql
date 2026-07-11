INSERT INTO system_configs (key, value) VALUES
  ('content_safety_enabled', 'false'),
  ('content_safety_blocked_terms', '[]')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS content_safety_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  source VARCHAR(32) NOT NULL,
  matched_term_digest VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_safety_events_time
  ON content_safety_events(created_at DESC);
