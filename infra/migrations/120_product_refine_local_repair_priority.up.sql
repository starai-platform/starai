UPDATE workflow_definitions
SET runtime_config = jsonb_set(
  COALESCE(runtime_config, '{}'::jsonb),
  '{product_operation_rules,local_repair}',
  to_jsonb('仅重绘用户圈选的问题区域，修复接缝、穿透、粘连、断裂、重复边缘和错误遮挡；除用户明确要求保留的内容外，移除圈内红圈、箭头或文字标注，圈外像素、构图和尺寸保持不变。'::text),
  true
)
WHERE code = 'product_refine';
