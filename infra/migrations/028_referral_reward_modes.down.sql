DROP INDEX IF EXISTS idx_referral_rewards_once_per_trigger;
ALTER TABLE referral_rewards
  ADD CONSTRAINT referral_rewards_once_per_referred UNIQUE (referred_id);

ALTER TABLE member_levels
  DROP CONSTRAINT IF EXISTS member_levels_reward_trigger_check,
  DROP CONSTRAINT IF EXISTS member_levels_reward_type_check,
  DROP COLUMN IF EXISTS referral_reward_trigger,
  DROP COLUMN IF EXISTS referral_reward_type;
