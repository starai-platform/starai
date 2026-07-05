-- Public API documentation bound to platform-connected models.

CREATE TABLE api_docs (
  id BIGSERIAL PRIMARY KEY,
  model_id BIGINT NOT NULL UNIQUE REFERENCES models(id) ON DELETE CASCADE,
  slug VARCHAR(96) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  summary TEXT,
  protocol VARCHAR(48) NOT NULL DEFAULT 'openai-compatible',
  base_url TEXT NOT NULL DEFAULT 'https://api.your-starai-domain.com',
  endpoint TEXT NOT NULL,
  auth_header TEXT NOT NULL DEFAULT 'Authorization: Bearer <API_KEY>',
  sdk TEXT,
  content JSONB NOT NULL DEFAULT '{}',
  is_published BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_docs_pub ON api_docs(is_published, sort_order, id);

INSERT INTO api_docs (model_id, slug, title, summary, protocol, endpoint, sdk, content, sort_order)
SELECT
  id,
  code,
  display_name,
  COALESCE(description, ''),
  CASE
    WHEN request_mode IN ('chat_completions', 'responses') THEN 'openai-compatible'
    WHEN request_mode = 'images' THEN 'openai-compatible-image'
    WHEN request_mode = 'video' THEN 'new-api-compatible-video'
    WHEN request_mode = 'audio' THEN 'openai-compatible-audio'
    ELSE 'custom-compatible'
  END,
  CASE
    WHEN request_mode = 'chat_completions' THEN '/v1/chat/completions'
    WHEN request_mode = 'responses' THEN '/v1/responses'
    WHEN request_mode = 'images' THEN '/v1/images/generations'
    WHEN request_mode = 'video' THEN '/v1/video/generations'
    WHEN request_mode = 'audio' THEN '/v1/audio/speech'
    ELSE COALESCE(NULLIF(new_api_endpoint, ''), '/v1/chat/completions')
  END,
  CASE
    WHEN request_mode IN ('chat_completions', 'responses') THEN 'openai (Node/Python), curl'
    WHEN request_mode = 'audio' THEN 'openai audio SDK / curl'
    ELSE 'curl'
  END,
  jsonb_build_object(
    'features', tags,
    'request_example', jsonb_build_object(
      'model', code,
      'messages', jsonb_build_array(
        jsonb_build_object('role', 'user', 'content', '你好，请介绍你的能力')
      )
    ),
    'response_example', jsonb_build_object(
      'id', 'chatcmpl_xxx',
      'object', 'chat.completion',
      'choices', jsonb_build_array(
        jsonb_build_object('message', jsonb_build_object('role', 'assistant', 'content', '这是模型响应内容'))
      )
    ),
    'notes', jsonb_build_array('本平台模型参数以后台模型管理配置为准', '兼容 OpenAI 风格 Authorization Bearer 鉴权')
  ),
  sort_order
FROM models
ON CONFLICT (model_id) DO NOTHING;
