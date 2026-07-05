-- Content operations: announcements, notifications, daily check-in, api tokens

CREATE TABLE announcements (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(256) NOT NULL,
  content TEXT NOT NULL,
  level VARCHAR(20) NOT NULL DEFAULT 'info',
  is_published BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_announcements_pub ON announcements(is_published, created_at DESC);

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  title VARCHAR(256) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'system',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE daily_checkins (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  checkin_date DATE NOT NULL,
  reward NUMERIC(18,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, checkin_date)
);

CREATE TABLE api_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  name VARCHAR(64) NOT NULL,
  token_hash VARCHAR(128) UNIQUE NOT NULL,
  prefix VARCHAR(16) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

INSERT INTO system_configs (key, value) VALUES
  ('daily_checkin_reward', '5')
ON CONFLICT (key) DO NOTHING;

INSERT INTO announcements (title, content, level, is_published) VALUES
  ('欢迎使用 StarAI', 'StarAI 多模型聚合平台已上线，支持对话、图片生成、智能体工作流与灵感广场。充值算力即可调用全部模型。', 'info', true);
