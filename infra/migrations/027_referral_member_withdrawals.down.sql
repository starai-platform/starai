DROP TABLE IF EXISTS withdrawal_requests;
DROP TABLE IF EXISTS cash_transactions;
DROP TABLE IF EXISTS referral_rewards;
DROP INDEX IF EXISTS idx_users_member_level;
DROP INDEX IF EXISTS idx_users_referrer;
DROP INDEX IF EXISTS idx_users_referral_code;
ALTER TABLE users
  DROP COLUMN IF EXISTS member_level_id,
  DROP COLUMN IF EXISTS referrer_id,
  DROP COLUMN IF EXISTS referral_code;
DROP TABLE IF EXISTS member_levels;
