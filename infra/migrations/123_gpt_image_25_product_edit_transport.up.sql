-- zexapi's GPT Image 2.5 edit route expects repeated multipart fields named
-- "image". Keep the default OpenAI image[] behavior for every other route,
-- especially the existing GPT Image 2 route.
UPDATE model_routes route
SET runtime_rule=jsonb_set(
      COALESCE(route.runtime_rule,'{}'::jsonb),
      '{upstream}',
      COALESCE(route.runtime_rule->'upstream','{}'::jsonb) || '{"multipart_image_field":"image"}'::jsonb
    ),
    updated_at=now()
FROM models model
WHERE route.model_id=model.id
  AND model.request_mode='images'
  AND lower(trim(trailing '/' FROM route.base_url))='https://zexapi.com'
  AND lower(route.upstream_model) LIKE 'gpt-image-2.5%';
