UPDATE workflow_definitions
SET display_config = jsonb_set(
      COALESCE(display_config, '{}'::jsonb),
      '{steps}',
      '[
        {"icon":"📝","title":"脚本创作","subtitle":"根据视频类型与发布平台生成完整脚本"},
        {"icon":"🎞️","title":"分镜确认","subtitle":"拆解结构化分镜，确认后再生成媒体"},
        {"icon":"🎨","title":"逐镜生成","subtitle":"生成关键帧、视频片段与多角色配音"},
        {"icon":"🎬","title":"合成成片","subtitle":"自动拼接片段并合成配音"}
      ]'::jsonb,
      true
    ),
    runtime_config = COALESCE(runtime_config, '{}'::jsonb) - 'default_story_subtitle_mode',
    updated_at = now()
WHERE code = 'video_creation';
