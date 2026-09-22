UPDATE workflow_definitions
SET runtime_config = jsonb_set(
  runtime_config - 'product_operation_rules',
  '{product_category_rules}',
  COALESCE(runtime_config->'product_category_rules', '{}'::jsonb)
    - 'footwear' - 'watch' - 'eyewear' - 'appliance' - 'furniture'
    - 'kitchenware' - 'beverage' - 'toy' - 'sports' - 'automotive'
    - 'pet' - 'stationery' - 'baby' - 'health' - 'other',
  true
)
WHERE code = 'product_refine';
