-- Fix MiniMax Speech 2.8 HD payload shape for Yunwu /minimax/v1/t2a_v2.
UPDATE models
SET
  new_api_endpoint = '/minimax/v1/t2a_v2',
  input_schema = jsonb_set(
    jsonb_set(
      jsonb_set(
        input_schema,
        '{properties,voice_id}',
        '{"type":"string","title":"Voice ID","enum":["male-qn-qingse","female-shaonv","female-yujie","male-qn-jingying","male-qn-badao"],"enumLabels":{"male-qn-qingse":"男声 · 青涩","female-shaonv":"女声 · 少女","female-yujie":"女声 · 御姐","male-qn-jingying":"男声 · 精英","male-qn-badao":"男声 · 霸道"},"default":"male-qn-qingse","x-order":2,"x-widget":"option_menu","x-icon":"voice","x-placement":"top","x-highlight":true}'::jsonb,
        true
      ),
      '{properties,speed}',
      '{"type":"number","title":"语速","enum":[0.8,1,1.15,1.2,1.5],"enumLabels":{"0.8":"0.8x","1":"1.0x","1.15":"1.15x","1.2":"1.2x","1.5":"1.5x"},"default":1.15,"x-order":3,"x-widget":"option_menu","x-icon":"speed"}'::jsonb,
      true
    ),
    '{properties,format}',
    '{"type":"string","title":"输出格式","enum":["mp3","wav","flac","pcm"],"enumLabels":{"mp3":"MP3","wav":"WAV","flac":"FLAC","pcm":"PCM"},"default":"mp3","x-order":5,"x-widget":"option_menu","x-icon":"format","x-placement":"top"}'::jsonb,
    true
  ),
  default_params = '{"count":1,"voice_id":"male-qn-qingse","emotion":"auto","speed":1.15,"format":"mp3"}'::jsonb,
  price_rule = '{"billing_type":"per_token","currency":"¥","input_price_per_m":2,"output_price_per_m":4}'::jsonb,
  runtime_rule = '{
    "audio":{"input_layout":"single","prompt_hint":"输入要朗读的文本，选择 Voice ID 和情绪后生成高保真语音。","prompt_required":true,"billing_hint":"per_token","show_channel":false,"count_options":[1,3,5,10,30,50],"count_allow_custom":true,"count_max":50},
    "upstream":{"include":["voice_id","emotion","speed","format"],"map":{"prompt":"text","voice_id":"voice_setting.voice_id","speed":"voice_setting.speed","format":"audio_setting.format"},"static":{"stream":false}}
  }'::jsonb
WHERE code = 'audio_minimax_speech_28_hd';
