DELETE FROM models WHERE code = 'video_demo_v1';

UPDATE models SET
  input_schema = '{"type":"object","properties":{"size":{"type":"string","title":"尺寸","enum":["1024x1024","1792x1024","1024x1792"],"default":"1024x1024"},"n":{"type":"integer","title":"数量","default":1,"minimum":1,"maximum":4}}}'
WHERE code = 'image_fast_v1';
