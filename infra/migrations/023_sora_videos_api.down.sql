-- Revert to pre-Sora-API alignment defaults (012 + 022 shape).
UPDATE models SET
  new_api_model = 'sora-2',
  new_api_endpoint = '/v1/video/generations',
  input_schema = '{
    "type":"object",
    "properties":{
      "count":{"type":"integer","title":"生成数量","enum":[1,2,3,5],"default":1,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true},
      "duration":{"type":"string","title":"视频时长","enum":["4s","8s","12s"],"default":"4s","x-order":2,"x-widget":"option_menu","x-icon":"clock"},
      "orientation":{"type":"string","title":"画面方向","enum":["portrait","landscape"],"enumLabels":{"portrait":"竖屏","landscape":"横屏"},"default":"portrait","x-order":3,"x-widget":"option_menu","x-icon":"ratio"}
    }
  }'::jsonb,
  default_params = '{"count":1,"duration":"4s","orientation":"portrait"}'::jsonb,
  runtime_rule = '{
    "video":{"upload_profile":"single_ref","max_reference_images":1,"min_reference_images":0,"prompt_required":true,"show_channel":true},
    "upstream":{"async":true,"poll_path":"/v1/video/generations/{id}","poll_interval_sec":5,"poll_timeout_sec":900,"include":["count","duration","orientation","reference_images"],"map":{"count":"n","orientation":"aspect_ratio","reference_images":"image"}}
  }'::jsonb
WHERE code = 'video_demo_v1';
