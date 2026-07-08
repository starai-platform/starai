-- Add MiniMax Speech 2.8 HD audio model with JSON-driven Voice ID / Emotion controls.
INSERT INTO models (
  code, display_name, new_api_model, new_api_endpoint, request_mode, category,
  description, tags, input_schema, default_params, price_rule, runtime_rule, is_enabled, sort_order
) VALUES (
  'audio_minimax_speech_28_hd',
  'MiniMax Speech 2.8 HD',
  'speech-2.8-hd',
  '/minimax/v1/t2a_v2',
  'audio',
  'audio',
  'MiniMax Speech 2.8 HD 高保真文本转语音，支持 Voice ID、Emotion、Format、Speed 等参数。',
  '["音频","TTS","MiniMax","Speech 2.8 HD"]',
  '{
    "type":"object",
    "properties":{
      "count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-allow-custom":true,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true},
      "voice_id":{"type":"string","title":"Voice ID","enum":["male-qn-qingse","female-shaonv","female-yujie","male-qn-jingying","male-qn-badao"],"enumLabels":{"male-qn-qingse":"男声 · 青涩","female-shaonv":"女声 · 少女","female-yujie":"女声 · 御姐","male-qn-jingying":"男声 · 精英","male-qn-badao":"男声 · 霸道"},"default":"male-qn-qingse","x-order":2,"x-widget":"option_menu","x-icon":"voice","x-placement":"top","x-highlight":true},
      "speed":{"type":"number","title":"语速","enum":[0.8,1,1.15,1.2,1.5],"enumLabels":{"0.8":"0.8x","1":"1.0x","1.15":"1.15x","1.2":"1.2x","1.5":"1.5x"},"default":1.15,"x-order":3,"x-widget":"option_menu","x-icon":"speed"},
      "emotion":{"type":"string","title":"Emotion","enum":["auto","happy","sad","angry","fearful","disgusted","surprised","calm","neutral"],"enumLabels":{"auto":"自动","happy":"开心","sad":"悲伤","angry":"愤怒","fearful":"恐惧","disgusted":"厌恶","surprised":"惊讶","calm":"平静","neutral":"中性"},"default":"auto","x-order":4,"x-widget":"option_menu","x-icon":"emotion","x-omit-auto":true},
      "format":{"type":"string","title":"输出格式","enum":["mp3","wav","flac","pcm"],"enumLabels":{"mp3":"MP3","wav":"WAV","flac":"FLAC","pcm":"PCM"},"default":"mp3","x-order":5,"x-widget":"option_menu","x-icon":"format","x-placement":"top"}
    }
  }'::jsonb,
  '{"count":1,"voice_id":"male-qn-qingse","emotion":"auto","speed":1.15,"format":"mp3"}'::jsonb,
  '{"billing_type":"per_token","currency":"¥","input_price_per_m":2,"output_price_per_m":4}'::jsonb,
  '{
    "audio":{"input_layout":"single","prompt_hint":"输入要朗读的文本，选择 Voice ID 和情绪后生成高保真语音。","prompt_required":true,"billing_hint":"per_token","show_channel":false,"count_options":[1,3,5,10,30,50],"count_allow_custom":true,"count_max":50},
    "upstream":{"include":["voice_id","emotion","speed","format"],"map":{"prompt":"text","voice_id":"voice_setting.voice_id","speed":"voice_setting.speed","format":"audio_setting.format"},"static":{"stream":false}}
  }'::jsonb,
  true,
  75
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
