DELETE FROM workflow_definitions WHERE code IN ('ecommerce_image', 'general_image');
ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS display_config;
