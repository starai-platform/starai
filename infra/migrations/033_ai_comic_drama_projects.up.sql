CREATE TABLE IF NOT EXISTS comic_drama_styles (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) NOT NULL UNIQUE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  source VARCHAR(20) NOT NULL DEFAULT 'user',
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comic_drama_styles_user_source ON comic_drama_styles(user_id, source, sort_order);

CREATE TABLE IF NOT EXISTS comic_drama_projects (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_code VARCHAR(80) NOT NULL DEFAULT 'ai_comic_drama',
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  style_id BIGINT REFERENCES comic_drama_styles(id) ON DELETE SET NULL,
  style_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  orientation VARCHAR(20) NOT NULL DEFAULT 'landscape',
  quality VARCHAR(20) NOT NULL DEFAULT '480P',
  last_workflow_project_id BIGINT REFERENCES workflow_projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comic_drama_projects_user_created ON comic_drama_projects(user_id, created_at DESC);

INSERT INTO comic_drama_styles (public_id, user_id, name, prompt, cover_url, source, sort_order)
VALUES
  ('cds_kr_comic', NULL, '韩漫唯美', '韩漫人物设定，柔和光影，细腻皮肤，清爽线条，现代都市氛围，角色表情丰富，画面干净统一。', '/assets/comic-styles/kr-comic.svg', 'system', 10),
  ('cds_jp_anime', NULL, '日系动画', '日系动画风格，清晰角色轮廓，明亮色彩，镜头语言自然，场景透视稳定，适合青春冒险剧情。', '/assets/comic-styles/jp-anime.svg', 'system', 20),
  ('cds_cn_ancient', NULL, '纯正国风', '国风漫画质感，古典服饰与东方建筑，水墨层次，柔和色彩，人物气质含蓄，镜头优雅。', '/assets/comic-styles/cn-ancient.svg', 'system', 30),
  ('cds_cyber', NULL, '激燃极光', '高对比赛博漫画风，霓虹光源，强烈速度线，角色姿态夸张，适合热血战斗与悬疑追逐。', '/assets/comic-styles/cyber.svg', 'system', 40),
  ('cds_chibi_3d', NULL, '3D盲盒', '3D Q版盲盒角色风格，圆润材质，可爱比例，玩具质感，适合轻喜剧和治愈短剧。', '/assets/comic-styles/chibi-3d.svg', 'system', 50),
  ('cds_sketch', NULL, '美漫硬朗', '美式漫画线稿，强阴影，高反差，硬朗人物比例，动作张力强，适合英雄、侦探和末世题材。', '/assets/comic-styles/sketch.svg', 'system', 60)
ON CONFLICT (public_id) DO UPDATE SET
  name = EXCLUDED.name,
  prompt = EXCLUDED.prompt,
  cover_url = EXCLUDED.cover_url,
  source = EXCLUDED.source,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO system_configs (key, value, updated_at)
VALUES
  ('comic_drama_default_dialogue_model', '"chat_demo_v1"', now()),
  ('comic_drama_backup_dialogue_models', '["chat_demo_v1"]', now()),
  ('comic_drama_default_image_model', '"image_fast_v1"', now()),
  ('comic_drama_default_video_model', '"video_demo_v1"', now()),
  ('comic_drama_default_style_mode', '"image_reference"', now()),
  ('comic_drama_default_orientation', '"landscape"', now()),
  ('comic_drama_default_quality', '"480P"', now()),
  ('comic_drama_default_storyboard_grid', '6', now()),
  ('comic_drama_default_max_retry', '2', now()),
  ('comic_drama_default_step_confirm', 'true', now())
ON CONFLICT (key) DO NOTHING;
