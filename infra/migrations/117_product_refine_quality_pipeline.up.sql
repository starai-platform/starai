UPDATE workflow_definitions
SET runtime_config = COALESCE(runtime_config, '{}'::jsonb) || jsonb_build_object(
  'default_review_mode', COALESCE(runtime_config->>'default_review_mode', 'standard'),
  'product_category_rules', COALESCE(runtime_config->'product_category_rules', jsonb_build_object(
    'apparel', '核对版型、领口、袖口、门襟、裁片、缝线、纽扣和拉链；穿着褶皱不得改变结构。',
    'bag', '核对包型、提手与包身连接、肩带、拉链、扣件、口袋、边油和五金数量；手持或背负时受力真实。',
    'jewelry', '核对链节、镶嵌、爪位、耳针、搭扣和宝石数量；佩戴时不得穿入皮肤、断链或复制部件。',
    'cosmetics', '核对瓶型、泵头、瓶盖、标签、文字、液位和透明材质；手持时不得改写标签或穿入包装。',
    'bottle', '核对瓶口、瓶盖、泵头、标签、刻度、液位、透明度和反射；不得新增开口或扭曲文字。',
    'electronics', '核对屏幕、按键、镜头、接口、开孔、边框和标识的位置与数量；使用时不得变形。',
    'home', '核对轮廓、拼接、支撑、五金、纹理方向和落地受力；不得悬浮、断裂或错误连接。',
    'food', '核对包装形状、封口、标签、文字、数量和内容物；不得虚构认证、功效或净含量。'
  ))
)
WHERE code = 'product_refine';
