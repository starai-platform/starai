-- Config-driven video models: Sora-2, SD2.0, VEO3.1

UPDATE models SET
  display_name = 'Sora-2 视频',
  new_api_model = 'sora-2',
  new_api_endpoint = '/v1/video/generations',
  request_mode = 'video',
  category = 'video',
  description = '单参考图视频生成，支持时长与画幅方向',
  tags = '["视频","Sora"]',
  input_schema = '{
    "type":"object",
    "properties":{
      "count":{"type":"integer","title":"生成数量","enum":[1,2,3,5],"default":1,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true},
      "duration":{"type":"string","title":"视频时长","enum":["4s","8s","12s"],"default":"4s","x-order":2,"x-widget":"option_menu","x-icon":"clock"},
      "orientation":{"type":"string","title":"画面方向","enum":["portrait","landscape"],"enumLabels":{"portrait":"竖屏","landscape":"横屏"},"default":"portrait","x-order":3,"x-widget":"option_menu","x-icon":"ratio"}
    }
  }'::jsonb,
  default_params = '{"count":1,"duration":"4s","orientation":"portrait"}'::jsonb,
  price_rule = '{"billing_type":"per_second","unit_price":0.08}'::jsonb,
  runtime_rule = '{
    "video":{
      "upload_profile":"single_ref",
      "max_reference_images":1,
      "min_reference_images":0,
      "prompt_hint":"上传 1 张参考图锁定画风；画幅建议与参考图一致。高需求渠道可能价格较高，请留意预估费用。",
      "prompt_required":true,
      "show_channel":true
    },
    "upstream":{
      "include":["count","duration","orientation","reference_images"],
      "map":{"count":"n","orientation":"aspect_ratio"}
    }
  }'::jsonb,
  sort_order = 10
WHERE code = 'video_demo_v1';

INSERT INTO models (code, display_name, new_api_model, new_api_endpoint, request_mode, category, description, tags, input_schema, default_params, price_rule, runtime_rule, sort_order) VALUES
  ('video_sd2_0', 'SD2.0 视频', 'sd-video-2.0', '/v1/video/generations', 'video', 'video',
   '多参考图一致风格视频，支持速度/时长/比例/分辨率',
   '["视频","SD2.0"]',
   '{
     "type":"object",
     "properties":{
       "count":{"type":"integer","title":"生成数量","enum":[1,2,3,5],"default":1,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true},
       "speed":{"type":"string","title":"速度版本","enum":["fast","standard"],"enumLabels":{"fast":"快速","standard":"标准"},"default":"fast","x-order":2,"x-widget":"option_menu","x-icon":"sparkles"},
       "duration":{"type":"string","title":"视频时长","enum":["auto","4s","8s"],"enumLabels":{"auto":"自动"},"default":"auto","x-order":3,"x-widget":"option_menu","x-icon":"clock","x-omit-auto":true},
       "aspect_ratio":{"type":"string","title":"画质宽高比","enum":["adaptive","16:9","9:16","1:1"],"enumLabels":{"adaptive":"自适应"},"default":"adaptive","x-order":4,"x-widget":"option_menu","x-icon":"ratio","x-omit-auto":true},
       "resolution":{"type":"string","title":"分辨率","enum":["480p","720p","1080p"],"default":"480p","x-order":5,"x-widget":"option_menu","x-icon":"target"}
     }
   }',
   '{"count":1,"speed":"fast","duration":"auto","aspect_ratio":"adaptive","resolution":"480p"}',
   '{"billing_type":"per_second","unit_price":0.06}',
   '{
     "video":{
       "upload_profile":"multi_ref",
       "min_reference_images":1,
       "max_reference_images":9,
       "prompt_hint":"上传 1~9 张参考图 + 描述词，生成风格一致的视频。Prompt 必填，参考图至少 1 张。图片: JPEG/PNG/WebP，单张 ≤ 30MB。",
       "prompt_required":true,
       "show_channel":true
     },
     "upstream":{
       "include":["count","speed","duration","aspect_ratio","resolution","reference_images"],
       "map":{"count":"n"}
     }
   }',
   11),
  ('video_veo3_1', 'VEO3.1 视频', 'veo-3.1', '/v1/video/generations', 'video', 'video',
   '首尾帧 + 参考图，支持生成模式/比例/提示词优化/超分',
   '["视频","VEO"]',
   '{
     "type":"object",
     "properties":{
       "count":{"type":"integer","title":"生成数量","enum":[1,2,3],"default":1,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true},
       "generation_mode":{"type":"string","title":"生成模式","enum":["fast","standard","high"],"enumLabels":{"fast":"快速","standard":"标准","high":"高资质"},"default":"standard","x-order":2,"x-widget":"option_menu","x-icon":"sparkles"},
       "aspect_ratio":{"type":"string","title":"视频比例","enum":["9:16","16:9","1:1"],"default":"9:16","x-order":3,"x-widget":"option_menu","x-icon":"ratio"},
       "prompt_enhance":{"type":"boolean","title":"提示词优化","default":true,"x-order":4,"x-widget":"boolean_toggle","x-icon":"wand"},
       "upscale":{"type":"boolean","title":"视频超分","default":false,"x-order":5,"x-widget":"boolean_toggle","x-icon":"4k"}
     }
   }',
   '{"count":1,"generation_mode":"standard","aspect_ratio":"9:16","prompt_enhance":true,"upscale":false}',
   '{"billing_type":"per_second","unit_price":0.1}',
   '{
     "video":{
       "upload_profile":"frame_pair",
       "frames":{
         "first":{"key":"first_frame","label":"首帧","max":1},
         "last":{"key":"last_frame","label":"尾帧","max":1}
       },
       "reference_images":{"key":"reference_images","max":4},
       "max_total_images":6,
       "count_toward_total":true,
       "prompt_hint":"提示词建议：主体+动作+场景+运镜。上传参考图锁定人物与画风；首帧图开启图生视频；首尾帧两张图精准控制起始与结束。",
       "prompt_required":true,
       "show_channel":true
     },
     "upstream":{
       "include":["count","generation_mode","aspect_ratio","prompt_enhance","upscale","first_frame","last_frame","reference_images"],
       "map":{"count":"n","prompt_enhance":"prompt_optimizer","upscale":"super_resolution"}
     }
   }',
   12)
ON CONFLICT (code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  new_api_model = EXCLUDED.new_api_model,
  new_api_endpoint = EXCLUDED.new_api_endpoint,
  request_mode = EXCLUDED.request_mode,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  tags = EXCLUDED.tags,
  input_schema = EXCLUDED.input_schema,
  default_params = EXCLUDED.default_params,
  price_rule = EXCLUDED.price_rule,
  runtime_rule = EXCLUDED.runtime_rule,
  sort_order = EXCLUDED.sort_order;
