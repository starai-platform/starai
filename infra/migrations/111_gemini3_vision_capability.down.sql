UPDATE models
SET runtime_rule = runtime_rule #- '{capabilities,vision}',
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
