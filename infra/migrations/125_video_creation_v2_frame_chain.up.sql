-- Correct V2 to keep finalized assets in keyframe generation and chain video clips by frames.
WITH base AS (
  SELECT is_enabled FROM workflow_definitions WHERE code = 'video_creation'
), frame_model AS (
  SELECT code
  FROM models
  WHERE is_enabled
    AND category = 'video'
    AND request_mode = 'video'
    AND runtime_rule #>> '{video,upload_profile}' IN ('frame_pair', 'veo_frame_pair')
    AND COALESCE(NULLIF(runtime_rule #>> '{video,max_total_images}', '')::int, 0) >= 2
  ORDER BY sort_order, id
  LIMIT 1
)
UPDATE workflow_definitions AS workflow
SET description = '定稿资产只生成关键帧；首段从关键帧开始，后续片段以上一段实际尾帧为首帧、当前关键帧为尾帧顺序生成。',
    display_config = jsonb_set(
      COALESCE(workflow.display_config, '{}'::jsonb),
      '{canvas_templates}',
      '[{"id":"story-short-video-v2","name":"视频创作 V2","description":"资产锁定关键帧，视频按上一段尾帧到当前关键帧顺序生成","template_id":"story-short-video-v2"}]'::jsonb,
      true
    ),
    runtime_config = COALESCE(workflow.runtime_config, '{}'::jsonb)
      || jsonb_build_object('video_model_code', frame_model.code, 'pipeline_version', 2),
    is_enabled = base.is_enabled AND frame_model.code IS NOT NULL,
    updated_at = now()
FROM base
LEFT JOIN frame_model ON true
WHERE workflow.code = 'video_creation_v2';
