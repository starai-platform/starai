UPDATE workflow_definitions
SET display_config = jsonb_set(
      COALESCE(display_config, '{}'::jsonb),
      '{timeline}',
      '[
        "意图分析",
        "创意方向",
        "创作大纲",
        "小说创作",
        "剧本转换",
        "主体创建",
        "分镜规划",
        "主体匹配",
        "分镜脚本",
        "关键帧",
        "生成视频",
        "视频合成"
      ]'::jsonb,
      true
    ),
    updated_at = now()
WHERE code = 'ai_comic_drama';
