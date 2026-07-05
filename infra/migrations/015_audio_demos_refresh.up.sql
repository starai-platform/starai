-- Refresh audio demo models (idempotent upsert for admin CRUD / frontend QA)



INSERT INTO models (code, display_name, new_api_model, new_api_endpoint, request_mode, category, description, tags, input_schema, default_params, price_rule, runtime_rule, is_enabled, sort_order) VALUES

  ('audio_hailuo_clone', '海螺 语音克隆 2.8', 'hailuo-speech-2.8', '/v1/audio/speech', 'audio', 'audio',

   'MiniMax 海螺语音克隆模型。支持上传音频复刻专属音色，提供 HD 高清与 Turbo 极速两种合成质量，可调语速、音调、情感与音效。',

   '["音频","语音克隆","MiniMax"]',

   '{"type":"object","properties":{"count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-allow-custom":true,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true},"speed":{"type":"string","title":"语速","enum":["0.8x","1.0x","1.2x","1.5x"],"default":"1.0x","x-order":2,"x-widget":"option_menu","x-icon":"speed"},"pitch":{"type":"string","title":"音调","enum":["low","standard","high"],"enumLabels":{"low":"偏低","standard":"标准","high":"偏高"},"default":"standard","x-order":3,"x-widget":"option_menu","x-icon":"pitch"},"emotion":{"type":"string","title":"情感","enum":["auto","neutral","happy","sad"],"enumLabels":{"auto":"自动","neutral":"中性","happy":"愉悦","sad":"悲伤"},"default":"auto","x-order":4,"x-widget":"option_menu","x-icon":"emotion"},"sound_effect":{"type":"string","title":"音效","enum":["none","reverb","echo"],"enumLabels":{"none":"无","reverb":"混响","echo":"回声"},"default":"none","x-order":5,"x-widget":"option_menu","x-icon":"sparkles"},"quality":{"type":"string","title":"合成质量","enum":["turbo","hd"],"enumLabels":{"turbo":"极速 Turbo","hd":"HD 高清"},"default":"turbo","x-order":6,"x-widget":"option_menu","x-icon":"compass","x-highlight":true}}}'::jsonb,

   '{"count":1,"speed":"1.0x","pitch":"standard","emotion":"auto","sound_effect":"none","quality":"turbo"}'::jsonb,

   '{"billing_type":"per_token","input_price":0.000002,"output_price":0.000004}'::jsonb,

   '{"audio":{"input_layout":"single","prompt_hint":"输入想要朗读的文本内容，选择你的专属克隆音色，一键生成语音","prompt_required":true,"billing_hint":"per_token","show_channel":true,"count_options":[1,3,5,10,30,50],"count_allow_custom":true,"count_max":50},"upstream":{"include":["count","speed","pitch","emotion","sound_effect","quality","reference_audio"],"map":{"count":"n","quality":"model_variant"}}}'::jsonb,

   true, 20),

  ('audio_doubao_tts', '豆包 语音合成 2.0', 'doubao-tts-2.0', '/v1/audio/speech', 'audio', 'audio',

   '字节跳动豆包语音合成 2.0。数百种音色、多种情感，支持长文本合成（最高 10 万字），输出 MP3/WAV/PCM。',

   '["音频","TTS","豆包"]',

   '{"type":"object","properties":{"count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-allow-custom":true,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true},"speed":{"type":"string","title":"语速","enum":["0.8x","1.0x","1.2x","1.5x"],"default":"1.0x","x-order":2,"x-widget":"option_menu","x-icon":"speed"},"voice_mode":{"type":"string","title":"音色模式","enum":["auto","custom"],"enumLabels":{"auto":"自动","custom":"指定音色"},"default":"auto","x-order":3,"x-widget":"option_menu","x-icon":"mode","x-omit-auto":true},"format":{"type":"string","title":"输出格式","enum":["mp3","wav","pcm"],"enumLabels":{"mp3":"MP3","wav":"WAV","pcm":"PCM"},"default":"mp3","x-order":4,"x-widget":"option_menu","x-icon":"format"}}}'::jsonb,

   '{"count":1,"speed":"1.0x","voice_mode":"auto","format":"mp3"}'::jsonb,

   '{"billing_type":"per_token","input_price":0.0000015,"output_price":0.000003}'::jsonb,

   '{"audio":{"input_layout":"single","prompt_hint":"输入文本内容，选择音色即可生成语音","prompt_required":true,"billing_hint":"per_token","show_channel":true,"count_options":[1,3,5,10,30,50],"count_allow_custom":true,"count_max":50},"upstream":{"include":["count","speed","voice_mode","format"],"map":{"count":"n","format":"response_format"}}}'::jsonb,

   true, 21),

  ('audio_gemini_tts', 'Gemini-3.1-TTS', 'gemini-3.1-tts', '/v1/audio/speech', 'audio', 'audio',

   'Google Gemini 3.1 Flash TTS。30 种音色、24 种语言，可用自然语言描述情绪起伏与递进。',

   '["音频","TTS","Gemini"]',

   '{"type":"object","properties":{"count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-allow-custom":true,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true}}}'::jsonb,

   '{"count":1}'::jsonb,

   '{"billing_type":"per_token","input_price":0.000002,"output_price":0.000005}'::jsonb,

   '{"audio":{"input_layout":"single","prompt_hint":"输入内容，感受真正的 AI 配音（可用自然语言描述任何情绪波动与递进）","prompt_required":true,"billing_hint":"per_token","show_channel":true,"count_options":[1,3,5,10,30,50],"count_allow_custom":true,"count_max":50},"upstream":{"include":["count"],"map":{"count":"n"}}}'::jsonb,

   true, 22),

  ('audio_suno', 'Suno 音乐生成 4.5', 'suno-v4.5', '/v1/audio/music', 'audio', 'audio',

   'Suno V4.5 歌词生曲。支持歌曲/纯音乐模式，最长约 4 分钟，含歌词与卡拉 OK 字幕输出。',

   '["音频","音乐","Suno"]',

   '{"type":"object","properties":{"count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-allow-custom":true,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true},"model_version":{"type":"string","title":"模型版本","enum":["v4.5","v4","v3.5"],"enumLabels":{"v4.5":"V4.5 最新 (推荐)","v4":"V4","v3.5":"V3.5"},"default":"v4.5","x-order":2,"x-widget":"option_menu","x-icon":"compass","x-highlight":true},"mode":{"type":"string","title":"生成模式","enum":["song","instrumental"],"enumLabels":{"song":"歌曲模式","instrumental":"纯音乐"},"default":"song","x-order":3,"x-widget":"option_menu","x-icon":"mode"},"channel":{"type":"string","title":"声道","enum":["auto","stereo","mono"],"enumLabels":{"auto":"自动","stereo":"立体声","mono":"单声道"},"default":"auto","x-order":4,"x-widget":"option_menu","x-icon":"compass","x-omit-auto":true},"sample_rate":{"type":"string","title":"采样率","enum":["44100","48000"],"enumLabels":{"44100":"44100 Hz (CD 品质)","48000":"48000 Hz"},"default":"44100","x-order":5,"x-widget":"option_menu","x-icon":"audio"},"bitrate":{"type":"string","title":"比特率","enum":["128","192","320"],"enumLabels":{"128":"128 kbps","192":"192 kbps (推荐)","320":"320 kbps"},"default":"192","x-order":6,"x-widget":"option_menu","x-icon":"bitrate"}}}'::jsonb,

   '{"count":1,"model_version":"v4.5","mode":"song","channel":"auto","sample_rate":"44100","bitrate":"192"}'::jsonb,

   '{"billing_type":"per_request","unit_price":0.55}'::jsonb,

   '{"audio":{"input_layout":"dual","prompt_hint":"请输入完整歌词，也可以点击左下方按钮用 AI 生成歌词","secondary_prompt_hint":"音乐的描述，用于指定风格、情绪和场景。例如：流行音乐、难过，适合在下雨的晚上","secondary_prompt_key":"style_prompt","prompt_required":true,"billing_hint":"estimated","show_channel":true,"show_upload":true,"count_options":[1,3,5,10,30,50],"count_allow_custom":true,"count_max":50},"upstream":{"include":["count","model_version","mode","channel","sample_rate","bitrate","style_prompt","reference_audio"],"map":{"count":"n","model_version":"model","style_prompt":"tags"}}}'::jsonb,

   true, 23)

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

  sort_order = EXCLUDED.sort_order,

  updated_at = now();


