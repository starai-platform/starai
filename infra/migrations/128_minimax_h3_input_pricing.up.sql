-- Align persisted MiniMax-H3 video rates; H3-Max images are billed from the first image by platform policy.
UPDATE models
SET price_rule = price_rule || jsonb_build_object(
      'input_materials_billable', true,
      'input_video_rates_per_second', COALESCE(
        price_rule->'input_video_rates_per_second',
        '{"768p":0.5,"2k":0.8}'::jsonb
      )
    ),
    updated_at = now()
WHERE LOWER(new_api_model) = 'minimax-h3'
  AND price_rule->>'strategy' = 'minimax_h3_seconds';

UPDATE models
SET price_rule = price_rule || '{
      "input_materials_billable":true,
      "input_video_rates_per_second":{"480p":0.37,"768p":0.97},
      "free_reference_images":0,
      "excess_image_price":0.5
    }'::jsonb,
    updated_at = now()
WHERE LOWER(new_api_model) = 'minimax-h3-max'
  AND price_rule->>'strategy' = 'minimax_h3_seconds';
