-- Add MiniMax Music-2.6 demo model. Parameters are fully driven by input_schema/runtime_rule.
INSERT INTO models (
  code, display_name, new_api_model, new_api_endpoint, request_mode, category,
  description, tags, input_schema, default_params, price_rule, runtime_rule, is_enabled, sort_order
) VALUES (
  'audio_minimax_music_26',
  'MiniMax Music-2.6',
  'music-2.6',
  '/v1/music_generation',
  'audio',
  'audio',
  'MiniMax Music-2.6 文本生成音乐。输入歌词与歌曲描述，支持纯音乐、歌词优化、采样率、码率和输出格式配置。',
  '["音频","音乐","MiniMax","Music 2.6"]',
  '{
    "type":"object",
    "properties":{
      "model_version":{"type":"string","title":"模型版本","enum":["music-2.6","music-2.6-free"],"enumLabels":{"music-2.6":"Music-2.6","music-2.6-free":"Music-2.6 Free"},"default":"music-2.6","x-order":1,"x-widget":"option_menu","x-icon":"compass","x-placement":"top","x-highlight":true},
      "output_format":{"type":"string","title":"返回格式","enum":["hex","url"],"enumLabels":{"hex":"Hex 数据","url":"临时 URL"},"default":"hex","x-order":2,"x-widget":"option_menu","x-icon":"format"},
      "format":{"type":"string","title":"音频格式","enum":["mp3","wav","flac"],"enumLabels":{"mp3":"MP3","wav":"WAV","flac":"FLAC"},"default":"mp3","x-order":3,"x-widget":"option_menu","x-icon":"format","x-placement":"top"},
      "sample_rate":{"type":"number","title":"采样率","enum":[32000,44100],"enumLabels":{"32000":"32000 Hz","44100":"44100 Hz"},"default":44100,"x-order":4,"x-widget":"option_menu","x-icon":"audio"},
      "bitrate":{"type":"number","title":"码率","enum":[128000,256000,320000],"enumLabels":{"128000":"128 kbps","256000":"256 kbps","320000":"320 kbps"},"default":256000,"x-order":5,"x-widget":"option_menu","x-icon":"bitrate"},
      "is_instrumental":{"type":"boolean","title":"纯音乐","default":false,"x-order":6,"x-widget":"boolean_toggle","x-icon":"mode"},
      "lyrics_optimizer":{"type":"boolean","title":"歌词优化","default":false,"x-order":7,"x-widget":"boolean_toggle","x-icon":"sparkles"},
      "aigc_watermark":{"type":"boolean","title":"AIGC 水印","default":false,"x-order":8,"x-widget":"boolean_toggle","x-icon":"audio"}
    }
  }'::jsonb,
  '{"model_version":"music-2.6","output_format":"hex","format":"mp3","sample_rate":44100,"bitrate":256000,"is_instrumental":false,"lyrics_optimizer":false,"aigc_watermark":false}'::jsonb,
  '{"billing_type":"per_request","currency":"¥","unit_price":1}'::jsonb,
  '{
    "audio":{
      "input_layout":"dual",
      "prompt_hint":"请输入歌词，支持 [Verse]、[Chorus]、[Bridge]、[Outro] 等结构标签。纯音乐模式可留空。",
      "secondary_prompt_hint":"音乐描述：风格、情绪、场景。例如：独立民谣, 忧郁, 内省, 咖啡馆",
      "secondary_prompt_key":"music_prompt",
      "prompt_required":false,
      "billing_hint":"estimated",
      "show_channel":false,
      "show_upload":false,
      "count_options":[1],
      "count_allow_custom":false,
      "count_max":1
    },
    "upstream":{
      "include":["model_version","music_prompt","output_format","format","sample_rate","bitrate","is_instrumental","lyrics_optimizer","aigc_watermark"],
      "map":{
        "prompt":"lyrics",
        "music_prompt":"prompt",
        "model_version":"model",
        "format":"audio_setting.format",
        "sample_rate":"audio_setting.sample_rate",
        "bitrate":"audio_setting.bitrate",
        "is_instrumental":"audio_setting.is_instrumental",
        "lyrics_optimizer":"audio_setting.lyrics_optimizer",
        "aigc_watermark":"audio_setting.aigc_watermark"
      },
      "static":{"stream":false}
    }
  }'::jsonb,
  true,
  80
)
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
  is_enabled = EXCLUDED.is_enabled,
  sort_order = EXCLUDED.sort_order;
