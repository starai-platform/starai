-- Resend email provider for verification codes

INSERT INTO system_configs (key, value) VALUES
  ('email_provider', '"smtp"'::jsonb),
  ('resend_api_key', '""'::jsonb),
  ('resend_from', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;
