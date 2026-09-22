-- Align MiniMax speech/music presets with the current official mainland API.
UPDATE models
SET
  display_name = 'MiniMax Speech 2.8',
  new_api_model = 'speech-2.8-hd',
  new_api_endpoint = '/v1/t2a_v2',
  description = 'MiniMax Speech 2.8 官方语音合成，支持 HD / Turbo、音色、情绪、语言增强、字幕及完整音频输出配置。',
  tags = '["音频","TTS","MiniMax","Speech 2.8"]'::jsonb,
  input_schema = '{
    "type":"object",
    "properties":{
      "model_version":{"type":"string","title":"模型版本","enum":["speech-2.8-hd","speech-2.8-turbo"],"enumLabels":{"speech-2.8-hd":"Speech 2.8 HD","speech-2.8-turbo":"Speech 2.8 Turbo"},"default":"speech-2.8-hd","x-order":1,"x-widget":"option_menu","x-icon":"compass","x-placement":"top","x-highlight":true},
      "voice_id":{"type":"string","title":"Voice ID","enum":["male-qn-qingse","female-shaonv","female-yujie","male-qn-jingying","male-qn-badao","Chinese (Mandarin)_Warm_Bestie","Chinese (Mandarin)_Gentleman","English_Graceful_Lady","English_Insightful_Speaker"],"default":"male-qn-qingse","x-order":2,"x-widget":"option_menu","x-icon":"voice","x-placement":"top","x-highlight":true},
      "speed":{"type":"number","title":"语速","enum":[0.5,0.8,1,1.2,1.5,2],"default":1,"x-order":3,"x-widget":"option_menu","x-icon":"speed"},
      "vol":{"type":"number","title":"音量","enum":[0.5,1,2,5,10],"default":1,"x-order":4,"x-widget":"option_menu","x-icon":"audio"},
      "pitch":{"type":"integer","title":"语调","enum":[-12,-6,0,6,12],"default":0,"x-order":5,"x-widget":"option_menu","x-icon":"pitch"},
      "emotion":{"type":"string","title":"情绪","enum":["auto","happy","sad","angry","fearful","disgusted","surprised","calm"],"enumLabels":{"auto":"自动","happy":"开心","sad":"悲伤","angry":"愤怒","fearful":"恐惧","disgusted":"厌恶","surprised":"惊讶","calm":"中性"},"default":"auto","x-order":6,"x-widget":"option_menu","x-icon":"emotion","x-omit-auto":true},
      "language_boost":{"type":"string","title":"语言增强","enum":["auto","Chinese","Chinese,Yue","English","Japanese","Korean","Vietnamese","Spanish","French","German"],"enumLabels":{"auto":"自动识别","Chinese":"中文","Chinese,Yue":"粤语","English":"英语","Japanese":"日语","Korean":"韩语","Vietnamese":"越南语","Spanish":"西班牙语","French":"法语","German":"德语"},"default":"auto","x-order":7,"x-widget":"option_menu","x-icon":"language"},
      "format":{"type":"string","title":"音频格式","enum":["mp3","wav","flac","pcm"],"default":"mp3","x-order":8,"x-widget":"option_menu","x-icon":"format","x-placement":"top"},
      "sample_rate":{"type":"integer","title":"采样率","enum":[16000,24000,32000,44100],"default":32000,"x-order":9,"x-widget":"option_menu","x-icon":"audio"},
      "bitrate":{"type":"integer","title":"码率","enum":[32000,64000,128000,256000],"default":128000,"x-order":10,"x-widget":"option_menu","x-icon":"bitrate"},
      "channel":{"type":"integer","title":"声道","enum":[1,2],"enumLabels":{"1":"单声道","2":"双声道"},"default":1,"x-order":11,"x-widget":"option_menu","x-icon":"audio"},
      "output_format":{"type":"string","title":"返回格式","enum":["hex","url"],"default":"hex","x-order":12,"x-widget":"option_menu","x-icon":"format"},
      "subtitle_enable":{"type":"boolean","title":"生成字幕","default":false,"x-order":13,"x-widget":"boolean_toggle","x-icon":"subtitle"},
      "subtitle_type":{"type":"string","title":"字幕粒度","enum":["sentence","word"],"enumLabels":{"sentence":"句级","word":"词级"},"default":"sentence","x-order":14,"x-widget":"option_menu","x-icon":"subtitle"},
      "aigc_watermark":{"type":"boolean","title":"AIGC 水印","default":false,"x-order":15,"x-widget":"boolean_toggle","x-icon":"audio"}
    }
  }'::jsonb,
  default_params = '{"model_version":"speech-2.8-hd","voice_id":"male-qn-qingse","speed":1,"vol":1,"pitch":0,"emotion":"auto","language_boost":"auto","format":"mp3","sample_rate":32000,"bitrate":128000,"channel":1,"output_format":"hex","subtitle_enable":false,"subtitle_type":"sentence","aigc_watermark":false}'::jsonb,
  new_api_extra_params = jsonb_set(
    COALESCE(new_api_extra_params, '{}'::jsonb),
    '{connection}',
    COALESCE(new_api_extra_params->'connection', '{}'::jsonb) || '{"base_url":"https://api.minimax.cn","auth_type":"bearer","api_key_header":"Authorization"}'::jsonb,
    true
  ),
  runtime_rule = '{
    "audio":{"input_layout":"single","prompt_hint":"输入要朗读的文本，选择模型、Voice ID 和情绪后生成高保真语音。","prompt_required":true,"billing_hint":"per_token","show_channel":false,"show_upload":false,"count_options":[1],"count_allow_custom":false,"count_max":1},
    "upstream":{"include":["model_version","voice_id","speed","vol","pitch","emotion","language_boost","format","sample_rate","bitrate","channel","output_format","subtitle_enable","subtitle_type","aigc_watermark"],"map":{"prompt":"text","model_version":"model","voice_id":"voice_setting.voice_id","speed":"voice_setting.speed","vol":"voice_setting.vol","pitch":"voice_setting.pitch","emotion":"voice_setting.emotion","language_boost":"language_boost","format":"audio_setting.format","sample_rate":"audio_setting.sample_rate","bitrate":"audio_setting.bitrate","channel":"audio_setting.channel"},"static":{"stream":false},"request_timeout_sec":900}
  }'::jsonb
WHERE code = 'audio_minimax_speech_28_hd';

UPDATE models
SET
  display_name = 'MiniMax Music 3.0 / 2.6',
  new_api_model = 'music-3.0',
  new_api_endpoint = '/v1/music_generation',
  description = 'MiniMax Music 3.0 / 2.6 官方音乐生成。输入音乐描述与歌词，支持纯音乐、歌词优化、采样率、码率和返回格式配置。',
  tags = '["音频","音乐","MiniMax","Music 3.0","Music 2.6"]'::jsonb,
  input_schema = '{
    "type":"object",
    "properties":{
      "model_version":{"type":"string","title":"模型版本","enum":["music-3.0","music-2.6"],"enumLabels":{"music-3.0":"Music-3.0（推荐）","music-2.6":"Music-2.6（兼容）"},"default":"music-3.0","x-order":1,"x-widget":"option_menu","x-icon":"compass","x-placement":"top","x-highlight":true},
      "output_format":{"type":"string","title":"返回格式","enum":["hex","url"],"enumLabels":{"hex":"Hex 数据","url":"临时 URL"},"default":"hex","x-order":2,"x-widget":"option_menu","x-icon":"format"},
      "format":{"type":"string","title":"音频格式","enum":["mp3","wav","pcm"],"enumLabels":{"mp3":"MP3","wav":"WAV","pcm":"PCM"},"default":"mp3","x-order":3,"x-widget":"option_menu","x-icon":"format","x-placement":"top"},
      "sample_rate":{"type":"integer","title":"采样率","enum":[16000,24000,32000,44100],"default":44100,"x-order":4,"x-widget":"option_menu","x-icon":"audio"},
      "bitrate":{"type":"integer","title":"码率","enum":[32000,64000,128000,256000],"default":256000,"x-order":5,"x-widget":"option_menu","x-icon":"bitrate"},
      "is_instrumental":{"type":"boolean","title":"纯音乐","default":false,"x-order":6,"x-widget":"boolean_toggle","x-icon":"mode"},
      "lyrics_optimizer":{"type":"boolean","title":"歌词优化","default":false,"x-order":7,"x-widget":"boolean_toggle","x-icon":"sparkles"},
      "aigc_watermark":{"type":"boolean","title":"AIGC 水印","default":false,"x-order":8,"x-widget":"boolean_toggle","x-icon":"audio"}
    }
  }'::jsonb,
  default_params = '{"model_version":"music-3.0","output_format":"hex","format":"mp3","sample_rate":44100,"bitrate":256000,"is_instrumental":false,"lyrics_optimizer":false,"aigc_watermark":false}'::jsonb,
  new_api_extra_params = jsonb_set(
    COALESCE(new_api_extra_params, '{}'::jsonb),
    '{connection}',
    COALESCE(new_api_extra_params->'connection', '{}'::jsonb) || '{"base_url":"https://api.minimax.cn","auth_type":"bearer","api_key_header":"Authorization"}'::jsonb,
    true
  ),
  runtime_rule = '{
    "audio":{"input_layout":"dual","prompt_hint":"请输入歌词，支持 [Verse]、[Chorus]、[Bridge]、[Outro] 等结构标签。纯音乐模式可留空。","secondary_prompt_hint":"音乐描述：风格、情绪、场景。例如：独立民谣, 忧郁, 内省, 咖啡馆","secondary_prompt_key":"music_prompt","prompt_required":false,"billing_hint":"estimated","show_channel":false,"show_upload":false,"count_options":[1],"count_allow_custom":false,"count_max":1},
    "upstream":{"include":["model_version","music_prompt","output_format","format","sample_rate","bitrate","is_instrumental","lyrics_optimizer","aigc_watermark"],"map":{"prompt":"lyrics","music_prompt":"prompt","model_version":"model","format":"audio_setting.format","sample_rate":"audio_setting.sample_rate","bitrate":"audio_setting.bitrate","is_instrumental":"is_instrumental","lyrics_optimizer":"lyrics_optimizer","aigc_watermark":"aigc_watermark"},"static":{"stream":false},"request_timeout_sec":900}
  }'::jsonb
WHERE code = 'audio_minimax_music_26';
