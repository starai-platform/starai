-- OAuth login (Google/GitHub) + member system configs

INSERT INTO system_configs (key, value) VALUES
  ('oauth_google_enabled', 'false'::jsonb),
  ('oauth_google_client_id', '""'::jsonb),
  ('oauth_google_client_secret', '""'::jsonb),
  ('oauth_github_enabled', 'false'::jsonb),
  ('oauth_github_client_id', '""'::jsonb),
  ('oauth_github_client_secret', '""'::jsonb),
  ('site_base_url', '"http://localhost:3000"'::jsonb),
  ('signup_bonus', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;
