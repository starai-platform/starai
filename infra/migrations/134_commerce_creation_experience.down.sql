UPDATE workflow_definitions
SET description = '上传商品图与描述，AI 自动识别并出图，多轮对话精准补全，每步可控一键出图。',
    runtime_config = (COALESCE(runtime_config, '{}'::jsonb) - 'default_creative_mode') || jsonb_build_object('default_count', 1),
    updated_at = now()
WHERE code = 'ecommerce_image';

UPDATE workflow_definitions
SET description = '输入商品信息，自动生成营销文案、商品海报与展示短视频。',
    runtime_config = (COALESCE(runtime_config, '{}'::jsonb)
      - 'pipeline_version' - 'default_template_id' - 'default_segment_count'
      - 'default_story_creation_type' - 'default_story_review_required' - 'default_story_subtitle_mode')
      || jsonb_build_object('agent_mode', 'custom_nodes', 'generation_type', 'video'),
    updated_at = now()
WHERE code = 'ecommerce_video';
