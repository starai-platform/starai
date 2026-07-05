DELETE FROM system_configs WHERE key IN (
  'oauth_google_enabled', 'oauth_google_client_id', 'oauth_google_client_secret',
  'oauth_github_enabled', 'oauth_github_client_id', 'oauth_github_client_secret',
  'site_base_url', 'signup_bonus'
);
