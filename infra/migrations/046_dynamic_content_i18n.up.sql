CREATE TABLE content_translation_sources (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(32) NOT NULL,
  entity_key VARCHAR(128) NOT NULL,
  field_path VARCHAR(512) NOT NULL,
  source_locale VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
  source_text TEXT NOT NULL,
  source_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_key, field_path)
);

CREATE INDEX idx_content_translation_sources_entity
  ON content_translation_sources(entity_type, entity_key);

CREATE TABLE content_translations (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES content_translation_sources(id) ON DELETE CASCADE,
  locale VARCHAR(16) NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  source_hash VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  translation_source VARCHAR(20) NOT NULL DEFAULT 'ai',
  error_message TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_id, locale),
  CHECK (status IN ('pending','translated','reviewed','failed')),
  CHECK (translation_source IN ('ai','manual','imported'))
);

CREATE INDEX idx_content_translations_locale_status
  ON content_translations(locale, status, updated_at);

INSERT INTO system_configs (key, value) VALUES
  ('i18n_source_locale', '"zh-CN"'),
  ('i18n_target_locales', '["en-US","ja-JP","ko-KR","vi-VN"]'),
  ('i18n_auto_translate_enabled', 'false'),
  ('i18n_translation_model_code', '""')
ON CONFLICT (key) DO NOTHING;
