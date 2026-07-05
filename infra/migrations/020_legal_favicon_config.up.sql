-- Legal content and favicon configuration

INSERT INTO system_configs (key, value) VALUES
  ('site_favicon', '""'::jsonb),
  ('terms_title', '"服务协议"'::jsonb),
  ('terms_content', '""'::jsonb),
  ('privacy_title', '"隐私政策"'::jsonb),
  ('privacy_content', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;
