-- Inspiration gallery

CREATE TABLE gallery_tags (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  slug VARCHAR(64) UNIQUE NOT NULL,
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE gallery_items (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) UNIQUE NOT NULL,
  work_id BIGINT REFERENCES works(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id),
  model_code VARCHAR(64),
  title VARCHAR(256),
  prompt TEXT,
  cover_url TEXT,
  type VARCHAR(32) NOT NULL DEFAULT 'image',
  tags JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  is_featured BOOLEAN NOT NULL DEFAULT false,
  like_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gallery_status ON gallery_items(status, is_featured DESC, created_at DESC);

CREATE TABLE work_tags (
  work_id BIGINT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES gallery_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (work_id, tag_id)
);

INSERT INTO gallery_tags (name, slug, sort) VALUES
  ('全部', 'all', 0),
  ('插画', 'illustration', 1),
  ('摄影', 'photography', 2),
  ('概念设计', 'concept', 3),
  ('电商', 'ecommerce', 4),
  ('动漫', 'anime', 5);

INSERT INTO gallery_items (public_id, model_code, title, prompt, cover_url, type, tags, status, is_featured) VALUES
  ('gal_demo0001', 'image_fast_v1', '赛博朋克城市夜景', '赛博朋克风格的未来城市夜景，霓虹灯，雨后街道，电影感光影', 'https://picsum.photos/seed/starai1/640/800', 'image', '["concept","illustration"]', 'approved', true),
  ('gal_demo0002', 'image_fast_v1', '治愈系插画少女', '温暖治愈系插画，少女坐在窗边看书，柔和光线，水彩质感', 'https://picsum.photos/seed/starai2/640/720', 'image', '["illustration","anime"]', 'approved', true),
  ('gal_demo0003', 'image_fast_v1', '高级感产品摄影', '极简主义产品摄影，香水瓶，柔光，浅景深，杂志大片', 'https://picsum.photos/seed/starai3/640/640', 'image', '["photography","ecommerce"]', 'approved', false),
  ('gal_demo0004', 'image_fast_v1', '奇幻森林场景', '梦幻奇幻森林，发光蘑菇，薄雾，魔法氛围，概念艺术', 'https://picsum.photos/seed/starai4/640/860', 'image', '["concept"]', 'approved', false);
