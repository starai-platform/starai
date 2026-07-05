ALTER TABLE member_levels
  ADD COLUMN IF NOT EXISTS referral_reward_type VARCHAR(16) NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS referral_reward_trigger VARCHAR(24) NOT NULL DEFAULT 'first_recharge';

ALTER TABLE member_levels
  DROP CONSTRAINT IF EXISTS member_levels_reward_type_check,
  DROP CONSTRAINT IF EXISTS member_levels_reward_trigger_check;

ALTER TABLE member_levels
  ADD CONSTRAINT member_levels_reward_type_check CHECK (referral_reward_type IN ('fixed','percent')),
  ADD CONSTRAINT member_levels_reward_trigger_check CHECK (referral_reward_trigger IN ('first_recharge','every_recharge'));

ALTER TABLE referral_rewards
  DROP CONSTRAINT IF EXISTS referral_rewards_once_per_referred;

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_rewards_once_per_trigger
  ON referral_rewards(referred_id, trigger_type, trigger_id);
