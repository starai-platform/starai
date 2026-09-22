-- The current hy3 route accepts multimodal payloads but returns no usable
-- product description for ecommerce reference images. Use the verified vision
-- binding while preserving the administrator's previous choice for rollback.
UPDATE workflow_definitions
SET runtime_config = jsonb_set(
      jsonb_set(runtime_config, '{analysis_model_before_hy3_fix}', to_jsonb(runtime_config->>'analysis_model_code'), true),
      '{analysis_model_code}',
      '"glm-4-6v"'::jsonb,
      true
    ),
    updated_at = now()
WHERE code = 'ecommerce_image'
  AND runtime_config->>'analysis_model_code' = 'hy3'
  AND EXISTS (SELECT 1 FROM models WHERE code = 'glm-4-6v' AND is_enabled = true AND category = 'chat');
