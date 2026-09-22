-- Preserve the configured workflow fee and mark GPT Image 2 OpenAI-compatible
-- image routes as edit-capable so product masks use /v1/images/edits.
UPDATE models
SET runtime_rule=jsonb_set(
      COALESCE(runtime_rule,'{}'::jsonb),
      '{upstream}',
      COALESCE(runtime_rule->'upstream','{}'::jsonb) || '{"adapter":"openai_images","edit_endpoint":"/v1/images/edits"}'::jsonb
    ),
    updated_at=now()
WHERE code='gpt-image-2'
  AND request_mode='images';

UPDATE model_routes route
SET runtime_rule=jsonb_set(
      COALESCE(route.runtime_rule,'{}'::jsonb),
      '{upstream}',
      COALESCE(route.runtime_rule->'upstream','{}'::jsonb) || '{"adapter":"openai_images","edit_endpoint":"/v1/images/edits"}'::jsonb
    ),
    updated_at=now()
FROM models model
WHERE route.model_id=model.id
  AND model.code='gpt-image-2'
  AND model.request_mode='images'
  AND route.upstream_model LIKE 'gpt-image-2%'
  AND lower(route.endpoint) LIKE '%/images/generations';

UPDATE workflow_definitions
SET price_rule=jsonb_build_object(
      'billing_type','model_actual',
      'unit_price',GREATEST(0,COALESCE((price_rule->>'unit_price')::numeric,0))
    ),
    updated_at=now()
WHERE code='product_refine';
