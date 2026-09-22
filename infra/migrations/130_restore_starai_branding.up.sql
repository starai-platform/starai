UPDATE system_configs
SET value = to_jsonb(regexp_replace(value #>> '{}', 'nova[[:space:]]*ai', 'StarAI', 'gi')),
    updated_at = now()
WHERE key IN (
  'site_name',
  'site_copyright',
  'home_meta_title',
  'site_description',
  'admin_site_description',
  'site_api_tagline',
  'paypal_brand_name'
)
  AND jsonb_typeof(value) = 'string'
  AND (value #>> '{}') ~* 'nova[[:space:]]*ai';
