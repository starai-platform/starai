DELETE FROM system_configs WHERE key IN (
  'smtp_enabled', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_ssl', 'email_otp_debug'
);
