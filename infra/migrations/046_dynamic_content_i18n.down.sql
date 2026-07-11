DROP TABLE IF EXISTS content_translations;
DROP TABLE IF EXISTS content_translation_sources;

DELETE FROM system_configs WHERE key IN (
  'i18n_source_locale',
  'i18n_target_locales',
  'i18n_auto_translate_enabled',
  'i18n_translation_model_code'
);
