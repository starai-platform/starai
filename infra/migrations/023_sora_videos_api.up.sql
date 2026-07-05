-- Align Sora-2 with upstream API: POST/GET /v1/videos (see Apifox sora创建).
UPDATE models SET
  new_api_model = 'sora-2-12s',
  new_api_endpoint = '/v1/videos',
  input_schema = '{
    "type":"object",
    "properties":{
      "duration":{"type":"string","title":"视频时长","enum":["12s"],"default":"12s","x-order":1,"x-widget":"option_menu","x-icon":"clock"},
      "orientation":{"type":"string","title":"画面方向","enum":["portrait","landscape"],"enumLabels":{"portrait":"竖屏 9:16","landscape":"横屏 16:9"},"default":"portrait","x-order":2,"x-widget":"option_menu","x-icon":"ratio"}
    }
  }'::jsonb,
  default_params = '{"duration":"12s","orientation":"portrait"}'::jsonb,
  runtime_rule = '{
    "video":{
      "upload_profile":"single_ref",
      "max_reference_images":1,
      "min_reference_images":0,
      "prompt_hint":"图生视频请上传 1 张参考图；画幅由「画面方向」决定。参考图需为上游可访问的 URL。",
      "prompt_required":true,
      "show_channel":true,
      "count_options":[1]
    },
    "upstream":{
      "async":true,
      "poll_path":"/v1/videos/{id}",
      "poll_interval_sec":5,
      "poll_timeout_sec":900,
      "include":["duration","orientation","reference_images"],
      "map":{"orientation":"aspect_ratio","reference_images":"image_url"},
      "value_map":{"aspect_ratio":{"portrait":"9:16","landscape":"16:9"}},
      "model_template":"sora-2-{duration}s",
      "strip_params":["duration","count","n"]
    }
  }'::jsonb
WHERE code = 'video_demo_v1';
