-- Add an isolated V2 entry while reusing the existing video canvas executor.
-- V2 only enables when a video model can receive a keyframe plus asset references.
WITH base AS (
  SELECT * FROM workflow_definitions WHERE code = 'video_creation'
), video_model AS (
  SELECT code
  FROM models
  WHERE is_enabled
    AND category = 'video'
    AND request_mode = 'video'
    AND runtime_rule #>> '{video,upload_profile}' IN ('multi_ref', 'veo_reference', 'omni_reference', 'seedance_2', 'aliyun_happyhorse_reference')
    AND COALESCE(NULLIF(runtime_rule #>> '{video,max_reference_images}', '')::int, NULLIF(runtime_rule #>> '{video,reference_images,max}', '')::int, 0) >= 2
  ORDER BY sort_order, id
  LIMIT 1
)
INSERT INTO workflow_definitions (
  code, name, description, category, icon, nodes, input_schema, price_rule,
  display_config, runtime_config, is_enabled, sort_order
)
SELECT
  'video_creation_v2',
  '视频创作 V2',
  '生成前锁定人物、场景和道具，逐镜强制引用对应资产生成关键帧与视频，验收仅作有限兜底。',
  base.category,
  base.icon,
  base.nodes,
  base.input_schema,
  base.price_rule,
  jsonb_set(
    COALESCE(base.display_config, '{}'::jsonb),
    '{canvas_templates}',
    '[{"id":"story-short-video-v2","name":"视频创作 V2","description":"生成前锁定人物、场景和道具，逐镜强制引用资产后生成成片","template_id":"story-short-video-v2"}]'::jsonb,
    true
  ),
  COALESCE(base.runtime_config, '{}'::jsonb)
    || jsonb_build_object(
      'preset_code', 'video_creation_v2',
      'pipeline_version', 2,
      'video_model_code', video_model.code,
      'default_story_review_required', true
    ),
  base.is_enabled AND video_model.code IS NOT NULL,
  18
FROM base
LEFT JOIN video_model ON true
ON CONFLICT (code) DO NOTHING;
