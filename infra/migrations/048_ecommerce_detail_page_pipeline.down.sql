UPDATE workflow_definitions
SET runtime_config = runtime_config || '{"agent_mode":"custom_nodes"}'::jsonb,
    updated_at = now()
WHERE code = 'ecommerce_image'
  AND runtime_config->>'preset_code' = 'ecommerce_image';
