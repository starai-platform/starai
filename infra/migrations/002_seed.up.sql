-- Seed data for StarAI MVP

INSERT INTO admin_roles (name, permissions) VALUES
  ('super_admin', '["*"]');

-- passwords set by migrate seedCredentials: admin123 / demo123
INSERT INTO admin_users (email, password_hash, role_id) VALUES
  ('admin@starai.local', '$2a$10$placeholder_will_be_updated_by_migrate', 1);

INSERT INTO system_configs (key, value) VALUES
  ('site_name', '"StarAI"'),
  ('payment_enabled', 'false'),
  ('card_recharge_enabled', 'true'),
  ('default_locale', '"zh-CN"'),
  ('work_retention_days', '7'),
  ('daily_checkin_enabled', 'false'),
  ('gallery_audit_required', 'true');

INSERT INTO models (code, display_name, new_api_model, new_api_endpoint, request_mode, category, description, tags, input_schema, default_params, price_rule, sort_order) VALUES
  ('chat_demo_v1', 'StarAI 对话', 'gpt-4o-mini', '/v1/chat/completions', 'chat_completions', 'chat',
   '通用对话模型，支持流式输出', '["对话","通用"]',
   '{"type":"object","properties":{"temperature":{"type":"number","title":"温度","default":0.7,"minimum":0,"maximum":2}}}',
   '{"temperature":0.7}',
   '{"billing_type":"per_token","input_price":0.00001,"output_price":0.00003}',
   1),
  ('image_fast_v1', '极速生图', 'dall-e-3', '/v1/images/generations', 'images', 'image',
   '快速图片生成，支持多种尺寸', '["图片","生成"]',
   '{"type":"object","properties":{"size":{"type":"string","title":"尺寸","enum":["1024x1024","1792x1024","1024x1792"],"default":"1024x1024"},"n":{"type":"integer","title":"数量","default":1,"minimum":1,"maximum":4}}}',
   '{"size":"1024x1024","n":1}',
   '{"billing_type":"per_image","unit_price":0.12}',
   2);

-- Demo user: demo@starai.local / demo123
INSERT INTO users (public_id, nickname, status) VALUES
  ('usr_demo001', '演示用户', 'active');

INSERT INTO auth_identities (user_id, provider, identifier, credential_hash, verified) VALUES
  (1, 'email', 'demo@starai.local', '$2a$10$placeholder_will_be_updated_by_migrate', true);

INSERT INTO wallets (user_id, compute_balance) VALUES (1, 100.000000);

-- Demo recharge card batch
INSERT INTO recharge_card_batches (name, type, value, quantity, created_by) VALUES
  ('MVP Demo Batch', 'compute', 1000.000000, 10, 1);

-- Card: STARAI-DEMO-1000 (hash updated by migrate seedCredentials)
INSERT INTO recharge_cards (batch_id, code_hash, type, value, status) VALUES
  (1, 'placeholder_card_hash', 'compute', 1000.000000, 'unused');
