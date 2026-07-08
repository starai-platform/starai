UPDATE models
SET input_schema = jsonb_set(
  input_schema,
  '{properties}',
  (
    SELECT jsonb_object_agg(
      key,
      CASE
        WHEN value->>'x-placement' = 'top'
          THEN jsonb_set(value, '{x-placement}', '"audio_top"'::jsonb, true)
        ELSE value
      END
    )
    FROM jsonb_each(input_schema->'properties')
  ),
  true
)
WHERE category = 'audio'
  AND input_schema ? 'properties'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(input_schema->'properties') AS props(key, value)
    WHERE value->>'x-placement' = 'top'
  );
