-- Restore the original input contract and theme without overwriting an admin's model binding.
UPDATE workflow_definitions wf
SET input_schema=jsonb_set(
      jsonb_set(COALESCE(wf.input_schema,'{}'::jsonb),'{required}',CASE
        WHEN COALESCE(wf.input_schema->'required','[]'::jsonb) ? 'max_cost' THEN COALESCE(wf.input_schema->'required','[]'::jsonb)
        ELSE COALESCE(wf.input_schema->'required','[]'::jsonb) || '["max_cost"]'::jsonb
      END),
      '{properties}',COALESCE(wf.input_schema->'properties','{}'::jsonb) || '{"max_cost":{"type":"number","exclusiveMinimum":0,"maximum":1000}}'::jsonb
    ),
    display_config=jsonb_set(COALESCE(wf.display_config,'{}'::jsonb),'{theme}','"orange"'::jsonb),
    updated_at=now()
WHERE wf.code='product_refine';
