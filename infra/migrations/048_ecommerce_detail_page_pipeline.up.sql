-- Upgrade the legacy ecommerce image agent to the runtime-driven pipeline.
-- Keep administrator-selected model codes when they already exist.
UPDATE workflow_definitions
SET runtime_config = runtime_config || jsonb_build_object(
      'agent_mode', 'simple_pipeline',
      'generation_type', 'image',
      'preset_code', 'ecommerce_image',
      'analysis_model_code', COALESCE(NULLIF(runtime_config->>'analysis_model_code', ''), nodes->0->>'model_code', 'chat_demo_v1'),
      'generation_model_code', COALESCE(NULLIF(runtime_config->>'generation_model_code', ''), nodes->1->>'model_code', 'image_fast_v1'),
      'candidate_count', COALESCE((runtime_config->>'candidate_count')::int, 3),
      'default_count', COALESCE((runtime_config->>'default_count')::int, 1),
      'creative_scenes', COALESCE(runtime_config->'creative_scenes', '["main_image","detail_image","scene_image","marketing_poster"]'::jsonb),
      'output_scenes', COALESCE(runtime_config->'output_scenes', '["main_image","detail_image","scene_image","marketing_poster"]'::jsonb),
      'input_capabilities', COALESCE(runtime_config->'input_capabilities', '{"allow_text_only":true,"require_reference_image":false,"support_multiple_references":true}'::jsonb),
      'flow_options', COALESCE(runtime_config->'flow_options', '{"enable_step_confirm":true,"enable_autopilot":true,"allow_prompt_edit":true}'::jsonb)
    ),
    display_config = jsonb_set(
      display_config,
      '{steps}',
      '[
        {"icon":"🔍","title":"商品与卖点分析","subtitle":"识别商品、已确认参数和可用卖点","tags":["商品识别","事实校验","卖点提取"]},
        {"icon":"🧩","title":"详情页模块规划","subtitle":"按首屏、卖点、细节、场景和规格拆分模块","tags":["4-8个模块","结构化策划","防止杜撰"]},
        {"icon":"🎨","title":"模块图逐张生成","subtitle":"每个模块使用独立提示词并保持商品一致","tags":["商品一致性","独立提示词","文字留白"]},
        {"icon":"📦","title":"详情长图合成","subtitle":"模块图安全生成后自动按顺序拼接成长图","tags":["自动拼接","模块图保留","失败可降级"]}
      ]'::jsonb,
      true
    ),
    updated_at = now()
WHERE code = 'ecommerce_image'
  AND COALESCE(runtime_config->>'agent_mode', 'custom_nodes') = 'custom_nodes';
