-- Video model: configurable batch count presets + custom count

UPDATE models SET
  runtime_rule = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(runtime_rule, '{}'::jsonb),
        '{video,count_options}',
        '[1,3,5,10,30,50]'::jsonb,
        true
      ),
      '{video,count_allow_custom}',
      'true'::jsonb,
      true
    ),
    '{video,count_max}',
    '50'::jsonb,
    true
  ),
  input_schema = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(input_schema, '{"type":"object","properties":{}}'::jsonb),
          '{properties,count,enum}',
          '[1,3,5,10,30,50]'::jsonb,
          true
        ),
        '{properties,count,x-allow-custom}',
        'true'::jsonb,
        true
      ),
      '{properties,count,minimum}',
      '1'::jsonb,
      true
    ),
    '{properties,count,maximum}',
    '50'::jsonb,
    true
  )
WHERE category = 'video';
