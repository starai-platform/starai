UPDATE model_routes route
SET runtime_rule=jsonb_set(
      COALESCE(route.runtime_rule,'{}'::jsonb),
      '{upstream}',
      COALESCE(route.runtime_rule->'upstream','{}'::jsonb) - 'multipart_image_field'
    ),
    updated_at=now()
FROM models model
WHERE route.model_id=model.id
  AND model.request_mode='images'
  AND lower(trim(trailing '/' FROM route.base_url))='https://zexapi.com'
  AND lower(route.upstream_model) LIKE 'gpt-image-2.5%';
