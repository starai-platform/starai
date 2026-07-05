-- Agent workflows

CREATE TABLE workflow_definitions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  category VARCHAR(32) NOT NULL DEFAULT 'workflow',
  icon TEXT,
  nodes JSONB NOT NULL DEFAULT '[]',
  input_schema JSONB NOT NULL DEFAULT '{}',
  price_rule JSONB NOT NULL DEFAULT '{}',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_projects (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  workflow_id BIGINT NOT NULL REFERENCES workflow_definitions(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  inputs JSONB NOT NULL DEFAULT '{}',
  outputs JSONB NOT NULL DEFAULT '{}',
  estimated_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  actual_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_projects_user ON workflow_projects(user_id, created_at DESC);

CREATE TABLE workflow_node_runs (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES workflow_projects(id) ON DELETE CASCADE,
  node_id VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB NOT NULL DEFAULT '{}',
  cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  error TEXT,
  seq INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_node_runs_project ON workflow_node_runs(project_id, seq);

INSERT INTO workflow_definitions (code, name, description, icon, nodes, input_schema, price_rule, sort_order) VALUES
  ('ecommerce_video', '电商带货短视频', '输入商品信息，自动生成营销文案、商品海报与展示短视频。',
   '🛍️',
   '[
     {"id":"copy","type":"llm","name":"营销文案","model_code":"chat_demo_v1","prompt_template":"为电商产品『{{product}}』撰写一句不超过30字、富有吸引力的营销文案。","cost":0.03},
     {"id":"poster","type":"image","name":"商品海报","model_code":"image_fast_v1","prompt_template":"高级电商商品海报，产品：{{product}}，文案：{{copy}}，柔和打光，简洁背景","cost":0.12},
     {"id":"video","type":"video","name":"展示短视频","model_code":"video_demo_v1","prompt_template":"商品展示短视频，产品：{{product}}","cost":0.30}
   ]',
   '{"type":"object","properties":{"product":{"type":"string","title":"商品描述","placeholder":"如：北欧风陶瓷马克杯"}}}',
   '{"billing_type":"per_request","unit_price":0.45}',
   1);
