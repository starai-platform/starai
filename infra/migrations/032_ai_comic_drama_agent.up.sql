INSERT INTO workflow_definitions (
  code, name, description, icon, category, nodes, input_schema, price_rule, display_config, runtime_config, is_enabled, sort_order
) VALUES (
  'ai_comic_drama',
  'AI 漫剧 - S2.0（功能开发中...）',
  '输入故事创意与风格参考，AI 自动完成剧本、角色、分镜、关键帧、分段视频和最终合成。',
  '🎨',
  'video',
  '[
    {"id":"comic_plan","type":"llm","name":"AI漫剧规划","model_code":"chat_demo_v1","prompt_template":"","cost":0},
    {"id":"keyframes","type":"image","name":"关键帧生成","model_code":"image_fast_v1","prompt_template":"","cost":0},
    {"id":"video_segments","type":"video","name":"分段视频生成","model_code":"video_demo_v1","prompt_template":"","cost":0},
    {"id":"compose","type":"video","name":"视频合成","model_code":"","prompt_template":"","cost":0}
  ]',
  '{"type":"object","properties":{"prompt":{"type":"string","title":"漫剧创意","placeholder":"例如：赛博城市里的少年侦探追查失控 AI，电影感，节奏紧凑"}}}',
  '{"billing_type":"per_request","unit_price":0}',
  '{
    "theme": "comic",
    "hero_tags": ["超级智能体", "AI漫剧", "一键成片"],
    "feature_tags": ["多图深度融合", "全流程可控", "多主体适配", "自动合成"],
    "steps": [
      {"icon":"🔍","title":"意图分析","subtitle":"理解故事方向、角色关系和风格参考","tags":["创意阶段"]},
      {"icon":"📑","title":"剧本与分镜","subtitle":"生成大纲、分场剧本和可执行分镜","tags":["编剧阶段"]},
      {"icon":"🖼️","title":"关键帧生成","subtitle":"按分镜生成统一画风的关键帧","tags":["制作阶段"]},
      {"icon":"🎬","title":"视频合成","subtitle":"生成分段视频并合成为单个成片","tags":["一键成片"]}
    ],
    "input": {"image_label":"风格参考图","placeholder":"描述你想生成的 AI 漫剧内容、角色、画风和剧情节奏...","modes":["逐步确认","智能托管"]},
    "help":"输入故事创意，可上传风格参考图。逐步确认模式会在分镜规划后暂停，智能托管会自动完成关键帧、分段视频和最终合成。"
  }',
  '{
    "agent_mode": "comic_drama",
    "generation_type": "video",
    "preset_code": "ai_comic_drama",
    "analysis_model_code": "chat_demo_v1",
    "dialogue_model_codes": ["chat_demo_v1"],
    "image_model_code": "image_fast_v1",
    "video_model_code": "video_demo_v1",
    "generation_model_code": "video_demo_v1",
    "style_reference_mode": "image_reference",
    "duration_mode": "standard",
    "storyboard_grid": 6,
    "max_retry": 2,
    "asset_consistency_score": 80,
    "logic_score": 50,
    "output_mode": "composed_video",
    "default_count": 1,
    "candidate_count": 1,
    "creative_scenes": ["ai_comic_drama"],
    "input_capabilities": {
      "allow_text_only": true,
      "support_reference_image": true,
      "support_multiple_references": true,
      "support_first_last_frame": false
    },
    "flow_options": {
      "enable_step_confirm": true,
      "enable_autopilot": true,
      "allow_prompt_edit": true
    }
  }',
  false,
  30
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  nodes = EXCLUDED.nodes,
  input_schema = EXCLUDED.input_schema,
  price_rule = EXCLUDED.price_rule,
  display_config = EXCLUDED.display_config,
  runtime_config = EXCLUDED.runtime_config,
  is_enabled = EXCLUDED.is_enabled,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
