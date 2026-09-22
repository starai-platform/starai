-- Gemini 3 chat models accept image input. Backfill the explicit capability
-- required by image-grounded agent workflows while preserving other flags.
UPDATE models
SET runtime_rule = jsonb_set(COALESCE(runtime_rule, '{}'::jsonb), '{capabilities,vision}', 'true'::jsonb, true),
    updated_at = now()
WHERE category = 'chat'
  AND (
    lower(code) LIKE '%gemini-3%'
    OR lower(code) LIKE '%gemini_3%'
    OR lower(code) LIKE '%gemini.3%'
    OR lower(COALESCE(new_api_model, '')) LIKE '%gemini-3%'
    OR lower(COALESCE(new_api_model, '')) LIKE '%gemini_3%'
    OR lower(COALESCE(new_api_model, '')) LIKE '%gemini.3%'
  );
