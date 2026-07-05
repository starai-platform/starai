-- StarAI MVP schema

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  nickname VARCHAR(64),
  avatar_url TEXT,
  user_level VARCHAR(32) NOT NULL DEFAULT 'normal',
  locale VARCHAR(16) DEFAULT 'zh-CN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_identities (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  provider VARCHAR(32) NOT NULL,
  identifier VARCHAR(255) NOT NULL,
  credential_hash VARCHAR(255),
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, identifier)
);

CREATE TABLE admin_roles (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(64) UNIQUE NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id BIGINT NOT NULL REFERENCES admin_roles(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  user_id BIGINT PRIMARY KEY REFERENCES users(id),
  compute_balance NUMERIC(18,6) NOT NULL DEFAULT 0,
  cash_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  frozen_compute NUMERIC(18,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  type VARCHAR(32) NOT NULL,
  direction VARCHAR(8) NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  balance_after NUMERIC(18,6) NOT NULL,
  ref_type VARCHAR(32),
  ref_id VARCHAR(64),
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_tx_user_time ON wallet_transactions(user_id, created_at DESC);

CREATE TABLE balance_freezes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  amount NUMERIC(18,6) NOT NULL,
  ref_type VARCHAR(32) NOT NULL,
  ref_id VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'frozen',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);
CREATE INDEX idx_balance_freezes_ref ON balance_freezes(ref_type, ref_id);

CREATE TABLE recharge_card_batches (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'compute',
  value NUMERIC(18,6) NOT NULL,
  quantity INT NOT NULL,
  created_by BIGINT REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recharge_cards (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES recharge_card_batches(id),
  code_hash VARCHAR(128) UNIQUE NOT NULL,
  type VARCHAR(32) NOT NULL,
  value NUMERIC(18,6) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'unused',
  used_by BIGINT REFERENCES users(id),
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recharge_cards_batch ON recharge_cards(batch_id);

CREATE TABLE models (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  new_api_model VARCHAR(128) NOT NULL,
  new_api_endpoint VARCHAR(128) NOT NULL DEFAULT '/v1/chat/completions',
  request_mode VARCHAR(32) NOT NULL,
  category VARCHAR(32) NOT NULL,
  icon_url TEXT,
  description TEXT,
  tags JSONB NOT NULL DEFAULT '[]',
  capabilities JSONB NOT NULL DEFAULT '{}',
  input_schema JSONB NOT NULL DEFAULT '{}',
  default_params JSONB NOT NULL DEFAULT '{}',
  new_api_extra_params JSONB NOT NULL DEFAULT '{}',
  price_rule JSONB NOT NULL DEFAULT '{}',
  runtime_rule JSONB NOT NULL DEFAULT '{}',
  retention_days INT NOT NULL DEFAULT 7,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  model_id BIGINT REFERENCES models(id),
  title VARCHAR(256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);

CREATE TABLE conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  token_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_call_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(64) UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  model_id BIGINT REFERENCES models(id),
  conversation_id BIGINT REFERENCES conversations(id),
  prompt_tokens INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  total_tokens INT DEFAULT 0,
  cost NUMERIC(18,6) DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  error_code VARCHAR(64),
  duration_ms INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_call_logs_user_time ON ai_call_logs(user_id, created_at DESC);

CREATE TABLE tasks (
  id BIGSERIAL PRIMARY KEY,
  task_no VARCHAR(64) UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  model_id BIGINT REFERENCES models(id),
  type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB NOT NULL DEFAULT '{}',
  estimated_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  actual_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  error_code VARCHAR(64),
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_user_time ON tasks(user_id, created_at DESC);
CREATE INDEX idx_tasks_status_time ON tasks(status, created_at);

CREATE TABLE task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  bucket VARCHAR(128) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(128),
  size_bytes BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE works (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  task_id BIGINT REFERENCES tasks(id),
  model_id BIGINT REFERENCES models(id),
  type VARCHAR(32) NOT NULL,
  title VARCHAR(256),
  prompt TEXT,
  asset_id BIGINT REFERENCES assets(id),
  thumbnail_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_works_user_time ON works(user_id, created_at DESC);

CREATE TABLE system_configs (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_operation_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admin_users(id),
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32),
  target_id VARCHAR(64),
  detail JSONB NOT NULL DEFAULT '{}',
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
