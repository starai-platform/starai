UPDATE workflow_definitions
SET display_config = jsonb_set(
      COALESCE(display_config, '{}'::jsonb),
      '{steps}',
      '[
        {"icon":"📝","title":"内容包与脚本","subtitle":"一句话生成标题、发布文案、标签、封面文字、口播、字幕方案和完整脚本"},
        {"icon":"🎞️","title":"资产与分镜","subtitle":"拆解稳定角色、场景、道具资产和结构化分镜"},
        {"icon":"🎨","title":"逐镜生成","subtitle":"逐镜引用定稿资产，生成关键帧、视频片段与配音"},
        {"icon":"🎬","title":"剪辑与字幕","subtitle":"自动拼接片段、合成配音并烧录单语或双语字幕"}
      ]'::jsonb,
      true
    ),
    runtime_config = COALESCE(runtime_config, '{}'::jsonb) || '{"default_story_subtitle_mode":"auto"}'::jsonb,
    updated_at = now()
WHERE code = 'video_creation';
