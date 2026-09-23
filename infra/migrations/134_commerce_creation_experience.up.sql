-- Commerce defaults favor fast creative results; explicit user locks still switch
-- the worker to precise preservation. Reuse the existing V2 video canvas.
UPDATE workflow_definitions
SET description = '一句话或一张图即可生成成套电商视觉；默认自由创作，需要时可切换精准还原。',
    runtime_config = COALESCE(runtime_config, '{}'::jsonb) || jsonb_build_object(
      'default_creative_mode', 'free',
      'default_count', 3,
      'candidate_count', 3,
      'require_image', false
    ),
    display_config = COALESCE(display_config, '{}'::jsonb) || '{
      "theme":"cyan",
      "hero_tags":["一句话出图","自由创作","可继续修改"],
      "feature_tags":["无需提示词经验","真实或虚拟素材","部分失败可续传"],
      "steps":[
        {"icon":"✨","title":"理解并补全","subtitle":"保留明确要求，其余创意由 AI 自动完成"},
        {"icon":"🖼️","title":"成套出图","subtitle":"按需求生成主图、场景、海报或详情视觉"},
        {"icon":"💬","title":"说话就能改","subtitle":"更高级、换背景或只改一张都可继续生成"}
      ]
    }'::jsonb,
    updated_at = now()
WHERE code = 'ecommerce_image';

WITH v2 AS (
  SELECT runtime_config, is_enabled
  FROM workflow_definitions
  WHERE code = 'video_creation_v2'
)
UPDATE workflow_definitions AS commerce
SET description = '一句话或一组素材，自动完成带货脚本、分镜、关键帧、视频片段、配音字幕与成片。',
    runtime_config = COALESCE(v2.runtime_config, '{}'::jsonb) || jsonb_build_object(
      'agent_mode', 'infinite_canvas',
      'preset_code', 'ecommerce_video',
      'pipeline_version', 2,
      'default_template_id', 'story-short-video-v2',
      'default_segment_count', 3,
      'default_story_creation_type', 'product',
      'default_story_review_required', false,
      'default_story_subtitle_mode', 'auto'
    ),
    display_config = '{
      "theme":"blue",
      "hero_tags":["一句话成片","自动脚本分镜","字幕配音封面"],
      "feature_tags":["直接生成","逐镜修改","失败可续传"],
      "canvas_templates":[{"id":"story-short-video-v2","name":"电商带货短视频","description":"自动完成脚本、商品分镜、片段、配音字幕与成片","template_id":"story-short-video-v2"}],
      "steps":[
        {"icon":"📝","title":"自动脚本","subtitle":"补全钩子、卖点、口播和行动引导"},
        {"icon":"🎞️","title":"商品分镜","subtitle":"默认直接生成，也可逐镜查看和修改"},
        {"icon":"🎨","title":"逐镜制作","subtitle":"生成关键帧、视频片段与配音"},
        {"icon":"🎬","title":"交付成片","subtitle":"合成视频、字幕、封面和发布内容"}
      ]
    }'::jsonb,
    is_enabled = commerce.is_enabled AND v2.is_enabled,
    updated_at = now()
FROM v2
WHERE commerce.code = 'ecommerce_video';
