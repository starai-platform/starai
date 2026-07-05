-- Add a video model + enrich image model schema so the workbench renders type-specific inputs.

UPDATE models SET
  input_schema = '{"type":"object","properties":{"size":{"type":"string","title":"尺寸","enum":["1024x1024","1792x1024","1024x1792"],"default":"1024x1024"},"n":{"type":"integer","title":"数量","enum":[1,2,4],"default":1},"style":{"type":"string","title":"风格","enum":["自然","鲜明","写实","插画"],"default":"自然"}}}'
WHERE code = 'image_fast_v1';

INSERT INTO models (code, display_name, new_api_model, new_api_endpoint, request_mode, category, description, tags, input_schema, default_params, price_rule, sort_order) VALUES
  ('video_demo_v1', '极速生视频', 'sora-demo', '/v1/video/generations', 'video', 'video',
   '文本生成短视频，支持时长与画幅设置', '["视频","生成"]',
   '{"type":"object","properties":{"duration":{"type":"integer","title":"时长(秒)","enum":[5,10],"default":5},"aspect_ratio":{"type":"string","title":"画幅","enum":["16:9","9:16","1:1"],"default":"16:9"}}}',
   '{"duration":5,"aspect_ratio":"16:9"}',
   '{"billing_type":"per_second","unit_price":0.06}',
   3)
ON CONFLICT (code) DO NOTHING;
