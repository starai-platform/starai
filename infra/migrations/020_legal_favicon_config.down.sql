DELETE FROM system_configs WHERE key IN (
  'site_favicon', 'terms_title', 'terms_content', 'privacy_title', 'privacy_content'
);
