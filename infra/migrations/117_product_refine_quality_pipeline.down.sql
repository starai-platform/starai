UPDATE workflow_definitions
SET runtime_config = COALESCE(runtime_config, '{}'::jsonb) - 'default_review_mode' - 'product_category_rules'
WHERE code = 'product_refine';
