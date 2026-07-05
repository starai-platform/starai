-- Referral rewards, configurable member levels, and cash withdrawals.

CREATE TABLE IF NOT EXISTS member_levels (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(64) NOT NULL,
  referral_reward_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  referral_reward_account VARCHAR(16) NOT NULL DEFAULT 'compute',
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT member_levels_reward_account_check CHECK (referral_reward_account IN ('compute','cash'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_levels_single_default
  ON member_levels (is_default)
  WHERE is_default = true;

INSERT INTO member_levels (code, name, referral_reward_amount, referral_reward_account, is_default, sort_order)
VALUES ('normal', '普通会员', 0, 'compute', true, 0)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS referrer_id BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS member_level_id BIGINT REFERENCES member_levels(id);

UPDATE users
SET referral_code = lpad(((100000 + (id % 900000))::int)::text, 6, '0')
WHERE referral_code IS NULL;

UPDATE users
SET member_level_id = (SELECT id FROM member_levels WHERE code = COALESCE(NULLIF(users.user_level, ''), 'normal') LIMIT 1)
WHERE member_level_id IS NULL
  AND EXISTS (SELECT 1 FROM member_levels WHERE code = COALESCE(NULLIF(users.user_level, ''), 'normal'));

UPDATE users
SET member_level_id = (SELECT id FROM member_levels WHERE is_default = true LIMIT 1),
    user_level = 'normal'
WHERE member_level_id IS NULL;

ALTER TABLE users
  ALTER COLUMN referral_code SET NOT NULL,
  ALTER COLUMN member_level_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referrer ON users(referrer_id);
CREATE INDEX IF NOT EXISTS idx_users_member_level ON users(member_level_id);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL REFERENCES users(id),
  referred_id BIGINT NOT NULL REFERENCES users(id),
  member_level_id BIGINT REFERENCES member_levels(id),
  reward_account VARCHAR(16) NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  trigger_type VARCHAR(32) NOT NULL,
  trigger_id VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'paid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referral_rewards_account_check CHECK (reward_account IN ('compute','cash')),
  CONSTRAINT referral_rewards_once_per_referred UNIQUE (referred_id)
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer_time ON referral_rewards(referrer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  type VARCHAR(32) NOT NULL,
  direction VARCHAR(8) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  balance_after NUMERIC(18,2) NOT NULL,
  ref_type VARCHAR(32),
  ref_id VARCHAR(64),
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_transactions_direction_check CHECK (direction IN ('in','out'))
);
CREATE INDEX IF NOT EXISTS idx_cash_tx_user_time ON cash_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  method VARCHAR(20) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  account_info JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by BIGINT REFERENCES admin_users(id),
  reviewed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT withdrawal_method_check CHECK (method IN ('bank','wechat','alipay','paypal')),
  CONSTRAINT withdrawal_status_check CHECK (status IN ('pending','approved','rejected','paid','cancelled')),
  CONSTRAINT withdrawal_amount_positive CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_time ON withdrawal_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_time ON withdrawal_requests(status, created_at DESC);
