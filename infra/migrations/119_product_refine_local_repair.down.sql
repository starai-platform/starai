UPDATE workflow_definitions
SET runtime_config = jsonb_set(
  runtime_config,
  '{product_operation_rules}',
  COALESCE(runtime_config->'product_operation_rules', '{}'::jsonb) - 'local_repair',
  true
)
WHERE code = 'product_refine';
