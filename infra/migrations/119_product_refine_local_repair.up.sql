UPDATE workflow_definitions
SET runtime_config = jsonb_set(
  COALESCE(runtime_config, '{}'::jsonb),
  '{product_operation_rules}',
  jsonb_build_object(
    'local_repair', '仅重绘用户圈选的问题区域，修复接缝、穿透、粘连、断裂、重复边缘和错误遮挡；移除圈内红圈、箭头或文字标注，圈外像素、构图和尺寸保持不变。'
  ) || COALESCE(runtime_config->'product_operation_rules', '{}'::jsonb),
  true
)
WHERE code = 'product_refine';
