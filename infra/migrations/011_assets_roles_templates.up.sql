-- Asset metadata expansion + role icons + role templates.

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'image',   -- image / video / doc
  ADD COLUMN IF NOT EXISTS asset_type VARCHAR(16) NOT NULL DEFAULT 'role'; -- role / scene / prop

ALTER TABLE prompt_roles
  ADD COLUMN IF NOT EXISTS icon_url TEXT;

CREATE TABLE IF NOT EXISTS role_templates (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  icon_url TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO role_templates (code, name, description, system_prompt, icon_url, is_enabled, sort_order) VALUES
  ('writer_master', '全能写作大师', '擅长各类写作：文章、报告、邮件、脚本等', '你是一位全能写作大师。请根据用户需求输出结构清晰、表达准确、符合目标读者的内容。', NULL, true, 1),
  ('copy_planner', '文案策划大师', '擅长营销文案、活动策划、品牌表达', '你是一位资深文案策划大师。请输出可执行的方案、吸引人的标题与卖点，并给出多版本可选。', NULL, true, 2),
  ('biz_strategy', '商业策略顾问', '擅长商业分析、增长策略、竞争与落地方案', '你是一位商业策略顾问。请用数据与结构化思维给出分析框架、结论与可落地的行动清单。', NULL, true, 3)
ON CONFLICT (code) DO NOTHING;

