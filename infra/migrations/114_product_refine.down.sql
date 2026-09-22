-- Preserve project history on rollback; remove only an unused definition.
UPDATE workflow_definitions SET is_enabled=false WHERE code='product_refine';
DELETE FROM workflow_definitions WHERE code='product_refine' AND NOT EXISTS(SELECT 1 FROM workflow_projects WHERE workflow_id=workflow_definitions.id);
