-- Align untouched gateway presets with DYUBatch Studio's 6-second default.
-- The old preset used schema.default=4 and default_params.duration=5.
-- Preserve synchronized/custom defaults, capabilities, routes and prices.
UPDATE models
SET input_schema = jsonb_set(input_schema, '{properties,duration,default}', '6'::jsonb),
    default_params = jsonb_set(default_params, '{duration}', '6'::jsonb),
    updated_at = now()
WHERE runtime_rule#>>'{upstream,adapter}' = 'zex_video'
  AND (new_api_model IN ('seedance-2.0', 'seedance-2.0-mini', 'minimax-h3', 'minimax-h3-max')
    OR runtime_rule->>'template_key' IN ('zex_seedance_2_0', 'zex_seedance_2_0_mini', 'zex_minimax_h3', 'zex_minimax_h3_max'))
  AND input_schema#>'{properties,duration,enum}' = '[4,5,6,7,8,9,10,11,12,13,14,15]'::jsonb
  AND input_schema#>'{properties,duration,default}' = '4'::jsonb
  AND default_params->'duration' = '5'::jsonb;
