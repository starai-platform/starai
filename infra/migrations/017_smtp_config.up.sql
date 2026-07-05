-- SMTP email (enterprise / QQ / 163) for verification codes

INSERT INTO system_configs (key, value) VALUES
  ('smtp_enabled', 'false'::jsonb),
  ('smtp_host', '""'::jsonb),
  ('smtp_port', '465'::jsonb),
  ('smtp_user', '""'::jsonb),
  ('smtp_pass', '""'::jsonb),
  ('smtp_from', '""'::jsonb),
  ('smtp_ssl', 'true'::jsonb),
  ('email_otp_debug', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
