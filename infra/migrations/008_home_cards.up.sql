-- Configurable home cards for Multi-model collaboration landing panel.

CREATE TABLE IF NOT EXISTS home_cards (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(64) UNIQUE NOT NULL,
  title VARCHAR(128) NOT NULL,
  description TEXT,
  icon_url TEXT,
  icon_emoji VARCHAR(16),
  theme VARCHAR(32) NOT NULL DEFAULT 'gray',
  sort_order INT NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO home_cards (key, title, description, icon_emoji, theme, sort_order, is_enabled) VALUES
  ('multi_view', '多元视角', '同时调用多个顶级模型，获得不同思路与答案', '🌐', 'amber', 1, true),
  ('smart_fuse', '智能融合', 'AI 自动对比，生成最优综合答案', '✨', 'purple', 2, true),
  ('parallel_speed', '并行加速', '多模型同时运算，大幅缩短等待时间', '⚡', 'blue', 3, true),
  ('quality_guard', '质量保障', '交叉验证，减少幻觉和错误', '🛡️', 'pink', 4, true)
ON CONFLICT (key) DO NOTHING;

