-- New workflow, preserving existing ecommerce model bindings and behavior.
INSERT INTO workflow_definitions(code,name,description,icon,category,nodes,input_schema,price_rule,display_config,runtime_config,is_enabled,sort_order,created_at,updated_at)
SELECT 'product_refine','商品精修与套图','基于商品原图局部编辑，逐项核对细节；先制作代表图，通过后继续套图。','🔎','workflow','[]'::jsonb,
'{"type":"object","required":["prompt","product_references","count","max_cost"],"properties":{"prompt":{"type":"string"},"count":{"type":"integer","minimum":1,"maximum":6},"max_repairs":{"type":"integer","minimum":0,"maximum":2},"max_cost":{"type":"number","exclusiveMinimum":0,"maximum":1000}}}'::jsonb,
'{"billing_type":"model_actual","unit_price":0}'::jsonb,
'{"theme":"orange","hero_tags":["原图保护","局部编辑","逐项验收"],"input":{"placeholder":"描述必须保留的商品细节和需要改变的画面"}}'::jsonb,
jsonb_build_object('agent_mode','product_refine','preset_code','product_refine','generation_type','image',
'analysis_model_code',COALESCE(runtime_config->>'analysis_model_code',''),
'quality_model_code',COALESCE(NULLIF(runtime_config->>'quality_model_code',''),runtime_config->>'analysis_model_code',''),
'generation_model_code',COALESCE((SELECT m.code FROM models m WHERE m.is_enabled=true AND m.request_mode='images'
  AND ((NOT EXISTS(SELECT 1 FROM model_routes r WHERE r.model_id=m.id) AND m.runtime_rule#>>'{upstream,adapter}'='openai_images')
    OR EXISTS(SELECT 1 FROM model_routes r WHERE r.model_id=m.id AND r.is_enabled=true AND COALESCE(r.runtime_rule#>>'{upstream,adapter}',m.runtime_rule#>>'{upstream,adapter}')='openai_images'))
  ORDER BY (m.code=runtime_config->>'generation_model_code') DESC,m.sort_order,m.id LIMIT 1),''),
'default_count',1,'input_capabilities',jsonb_build_object('require_reference_image',true,'support_multiple_references',true),
'flow_options',jsonb_build_object('enable_autopilot',true,'enable_step_confirm',false)),
true,77,now(),now()
FROM (SELECT COALESCE((SELECT runtime_config FROM workflow_definitions WHERE code='ecommerce_image'),'{}'::jsonb) AS runtime_config) source
ON CONFLICT(code) DO NOTHING;
