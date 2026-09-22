UPDATE workflow_definitions
SET runtime_config = jsonb_set(
      runtime_config - 'analysis_model_before_hy3_fix',
      '{analysis_model_code}',
      to_jsonb(runtime_config->>'analysis_model_before_hy3_fix'),
      true
    ),
    updated_at = now()
WHERE code = 'ecommerce_image'
  AND runtime_config ? 'analysis_model_before_hy3_fix';
