-- Multi-model collaboration pseudo model + default preset mapping.

INSERT INTO models (code, display_name, new_api_model, new_api_endpoint, request_mode, category, description, tags, input_schema, default_params, price_rule, sort_order, is_enabled)
VALUES (
  'multi_collab_chat',
  '多模型协作 · 智能对话',
  'gpt-4o-mini',
  '/v1/chat/completions',
  'chat_completions',
  'chat',
  '同时调用多个模型并融合答案（支持渠道预设：成功率/速度/价格优先）',
  '["多模型","协作","对话"]',
  '{"type":"object","properties":{"temperature":{"type":"number","title":"温度","default":0.7,"minimum":0,"maximum":2}}}',
  '{"temperature":0.7}',
  '{"billing_type":"per_request","unit_price":0.05}',
  0,
  true
)
ON CONFLICT (code) DO NOTHING;

-- Default: try demo chat model first.
UPDATE model_channel_presets
SET model_codes = '["chat_demo_v1"]'
WHERE key IN ('success_first','speed_first','price_first') AND (model_codes = '[]'::jsonb OR model_codes IS NULL);

