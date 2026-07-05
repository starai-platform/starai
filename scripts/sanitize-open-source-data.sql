-- Explicit open-source sanitization script.
-- Run manually before exporting a public demo database/settings pack.
-- It removes known local/demo business data and replaces real domains, emails and keys.

BEGIN;

UPDATE system_configs
SET value = '""'::jsonb
WHERE key IN (
  'site_logo',
  'site_favicon',
  'smtp_host',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'resend_api_key',
  'resend_from',
  'storage_access_key',
  'storage_secret_key',
  'storage_public_url'
);

UPDATE system_configs
SET value = '"http://localhost:3000"'::jsonb
WHERE key = 'site_base_url';

UPDATE system_configs
SET value = '"smtp"'::jsonb
WHERE key = 'email_provider';

DELETE FROM announcements
WHERE title = '每日签到领算力';

UPDATE models
SET
  icon_url = '/assets/default-app-icon.svg',
  new_api_extra_params = jsonb_set(
    COALESCE(new_api_extra_params, '{}'::jsonb),
    '{connection}',
    '{"base_url":"http://mock-new-api:3002","api_key":"","protocol":"openai_compatible","auth_type":"none","api_key_header":"Authorization"}'::jsonb,
    true
  )
WHERE COALESCE(icon_url, '') <> ''
   OR COALESCE(new_api_extra_params, '{}'::jsonb) ? 'connection';

UPDATE role_templates
SET icon_url = '/assets/default-app-icon.svg'
WHERE COALESCE(icon_url, '') <> '';

UPDATE prompt_roles
SET icon_url = '/assets/default-app-icon.svg'
WHERE COALESCE(icon_url, '') <> '';

DO $$
DECLARE
  table_name text;
  ordered_tables text[] := ARRAY[
    'task_assets',
    'gallery_likes',
    'gallery_items',
    'works',
    'assets',
    'ai_call_logs',
    'tasks',
    'conversations',
    'workflow_projects',
    'prompt_roles',
    'notifications',
    'daily_checkins',
    'balance_freezes',
    'cash_transactions',
    'wallet_transactions',
    'orders',
    'api_tokens',
    'referral_rewards',
    'member_withdrawals',
    'withdrawal_requests',
    'referral_relations',
    'admin_operation_logs'
  ];
BEGIN
  FOREACH table_name IN ARRAY ordered_tables LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I', table_name);
    END IF;
  END LOOP;
END $$;

UPDATE recharge_cards
SET used_by = NULL, used_at = NULL, status = 'unused'
WHERE used_by IS NOT NULL OR status <> 'unused';

UPDATE users
SET referrer_id = NULL
WHERE referrer_id IS NOT NULL;

DELETE FROM auth_identities
WHERE identifier <> 'demo@starai.local';

DELETE FROM wallets
WHERE user_id NOT IN (SELECT user_id FROM auth_identities WHERE identifier = 'demo@starai.local');

DELETE FROM users
WHERE id NOT IN (SELECT user_id FROM auth_identities WHERE identifier = 'demo@starai.local');

UPDATE recharge_card_batches
SET created_by = (SELECT id FROM admin_users WHERE email = 'admin@starai.local' LIMIT 1)
WHERE created_by IS NOT NULL
  AND EXISTS (SELECT 1 FROM admin_users WHERE email = 'admin@starai.local');

DELETE FROM admin_users
WHERE email <> 'admin@starai.local';

COMMIT;
