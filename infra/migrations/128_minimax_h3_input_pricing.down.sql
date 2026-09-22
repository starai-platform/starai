UPDATE models
SET price_rule = price_rule - 'input_video_rates_per_second',
    updated_at = now()
WHERE LOWER(new_api_model) = 'minimax-h3'
  AND price_rule->>'strategy' = 'minimax_h3_seconds';

UPDATE models
SET price_rule = (price_rule - 'input_video_rates_per_second') || '{
      "input_materials_billable":false,
      "free_reference_images":5,
      "excess_image_price":0
    }'::jsonb,
    updated_at = now()
WHERE LOWER(new_api_model) = 'minimax-h3-max'
  AND price_rule->>'strategy' = 'minimax_h3_seconds';
