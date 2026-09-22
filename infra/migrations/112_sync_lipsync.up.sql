-- Disabled until an administrator supplies a Sync route and pricing.
INSERT INTO models (code, display_name, new_api_model, new_api_endpoint, request_mode, category,
  description, input_schema, default_params, runtime_rule, price_rule, is_enabled, sort_order)
VALUES ('video_sync_lipsync', 'Sync 人物口型同步', 'sync-3', '/v2/generate', 'video', 'video',
  '供视频创作与爆款复刻的逐镜对白使用；启用前请配置 Sync 路由密钥及实际价格。',
  '{"type":"object","properties":{"input":{"type":"array"},"duration":{"type":"integer","minimum":1,"maximum":600}},"required":["input","duration"]}'::jsonb,
  '{}'::jsonb,
  '{"lip_sync":{"provider":"sync"},"video":{"upload_profile":"none","prompt_required":false,"count_options":[1],"count_max":1},"upstream":{"adapter":"sync_lipsync","include":["input","options"],"async":true,"poll_path":"/v2/generate/{id}","poll_interval_sec":5,"poll_timeout_sec":1800}}'::jsonb,
  '{"billing_type":"per_second","unit_price":0}'::jsonb, false, 900)
ON CONFLICT (code) DO NOTHING;
