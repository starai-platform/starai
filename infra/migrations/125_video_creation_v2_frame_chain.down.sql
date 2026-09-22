WITH base AS (
  SELECT is_enabled FROM workflow_definitions WHERE code = 'video_creation'
), reference_model AS (
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
UPDATE workflow_definitions AS workflow
SET description = '生成前锁定人物、场景和道具，逐镜强制引用对应资产生成关键帧与视频，验收仅作有限兜底。',
    display_config = jsonb_set(
      COALESCE(workflow.display_config, '{}'::jsonb),
      '{canvas_templates}',
      '[{"id":"story-short-video-v2","name":"视频创作 V2","description":"生成前锁定人物、场景和道具，逐镜强制引用资产后生成成片","template_id":"story-short-video-v2"}]'::jsonb,
      true
    ),
    runtime_config = COALESCE(workflow.runtime_config, '{}'::jsonb)
      || jsonb_build_object('video_model_code', reference_model.code, 'pipeline_version', 2),
    is_enabled = base.is_enabled AND reference_model.code IS NOT NULL,
    updated_at = now()
FROM base
LEFT JOIN reference_model ON true
WHERE workflow.code = 'video_creation_v2';
