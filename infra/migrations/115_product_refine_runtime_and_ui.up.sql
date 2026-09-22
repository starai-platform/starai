-- Product refine follow-up. Migration 114 is immutable after being applied.
WITH preferred_edit_model AS (
  SELECT COALESCE((
    SELECT m.code
    FROM models m
    WHERE m.is_enabled=true
      AND m.request_mode='images'
      AND m.runtime_rule#>>'{upstream,adapter}'='openai_images'
      AND COALESCE(m.runtime_rule#>>'{upstream,edit_endpoint}','')<>''
    ORDER BY m.sort_order,m.id
    LIMIT 1
  ),'') AS code
)
UPDATE workflow_definitions wf
SET input_schema=jsonb_set(
      jsonb_set(COALESCE(wf.input_schema,'{}'::jsonb),'{required}',COALESCE((
        SELECT jsonb_agg(value ORDER BY ordinality)
        FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(wf.input_schema->'required')='array' THEN wf.input_schema->'required' ELSE '[]'::jsonb END) WITH ORDINALITY item(value,ordinality)
        WHERE value<>'max_cost'
      ),'[]'::jsonb)),
      '{properties}',COALESCE(wf.input_schema->'properties','{}'::jsonb)-'max_cost'
    ),
    display_config=jsonb_set(COALESCE(wf.display_config,'{}'::jsonb),'{theme}','"cyan"'::jsonb),
    runtime_config=CASE WHEN preferred_edit_model.code=''
      THEN wf.runtime_config
      ELSE jsonb_set(COALESCE(wf.runtime_config,'{}'::jsonb),'{generation_model_code}',to_jsonb(preferred_edit_model.code))
    END,
    updated_at=now()
FROM preferred_edit_model
WHERE wf.code='product_refine';
