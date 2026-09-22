UPDATE models
SET
  display_name = 'MiniMax Speech 2.8 HD',
  new_api_model = 'speech-2.8-hd',
  new_api_endpoint = '/minimax/v1/t2a_v2',
  description = 'MiniMax Speech 2.8 HD 高保真文本转语音，支持 Voice ID、Emotion、Format、Speed 等参数。',
  tags = '["音频","TTS","MiniMax","Speech 2.8 HD"]'::jsonb
WHERE code = 'audio_minimax_speech_28_hd';

UPDATE models
SET
  display_name = 'MiniMax Music-2.6',
  new_api_model = 'music-2.6',
  description = 'MiniMax Music-2.6 文本生成音乐。输入歌词与歌曲描述，支持纯音乐、歌词优化、采样率、码率和输出格式配置。',
  tags = '["音频","音乐","MiniMax","Music 2.6"]'::jsonb
WHERE code = 'audio_minimax_music_26';
