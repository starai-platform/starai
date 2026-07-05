DELETE FROM system_configs WHERE key IN (
  'email_provider', 'resend_api_key', 'resend_from'
);
