-- Rename the old audio-only placement marker to the global toolbar placement.
-- Frontend code still accepts "audio_top" for backwards compatibility.
UPDATE models
SET input_schema = jsonb_set(
  input_schema,
  '{properties}',
  (
    SELECT jsonb_object_agg(
      key,
      CASE
        WHEN value->>'x-placement' = 'audio_top'
          THEN jsonb_set(value, '{x-placement}', '"top"'::jsonb, true)
        ELSE value
      END
    )
    FROM jsonb_each(input_schema->'properties')
  ),
  true
)
WHERE input_schema ? 'properties'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(input_schema->'properties') AS props(key, value)
    WHERE value->>'x-placement' = 'audio_top'
  );
