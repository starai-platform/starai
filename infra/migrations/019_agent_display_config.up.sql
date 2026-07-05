-- Agent display config: rich presentation metadata (theme / hero tags / step cards / input hints)

ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS display_config JSONB NOT NULL DEFAULT '{}';

-- Backfill an example display config for the existing demo workflow.
UPDATE workflow_definitions SET category='video', display_config='{
  "theme": "rose",
  "hero_tags": ["AI智能体", "多轮对话", "每步可控"],
  "feature_tags": ["上传商品·规划镜头", "多轮脚本·精准补全", "参考图·首帧可控", "每步可控·一键出片"],
  "steps": [
    {"icon": "🔍", "title": "商品智能分析", "subtitle": "上传商品图，AI 自动识别卖点", "tags": ["图片识别", "亮点提取", "多轮补全", "信息确认"]},
    {"icon": "🎬", "title": "视频脚本规划", "subtitle": "AI 按商品特点推荐分镜方案", "tags": ["卖点推荐", "分镜设计", "平台适配", "节奏控制"]},
    {"icon": "🖼️", "title": "参考图与首帧控制", "subtitle": "指定参考图，掌控画面首尾帧", "tags": ["首帧控制", "风格统一", "参考图"]},
    {"icon": "📦", "title": "批量生成与复盘", "subtitle": "并发出片，质量自检，不满意一键重做", "tags": ["批量并发", "质量自检", "一键重做"]}
  ],
  "input": {"image_label": "商品图", "placeholder": "输入商品名称、卖点、目标平台、视频意图，例如：iPhone 15 Pro Max 256G 沙漠色，做小红书 15 秒产品展示视频，要镜头围绕产品旋转", "modes": ["逐步确认", "智能托管"]}
}' WHERE code='ecommerce_video';

INSERT INTO workflow_definitions (code, name, description, icon, category, nodes, input_schema, price_rule, display_config, sort_order) VALUES
  ('ecommerce_image', '电商一键出图', '上传商品图与描述，AI 自动识别并出图，多轮对话精准补全，每步可控一键出图。',
   '🛒', 'image',
   '[
     {"id":"analyze","type":"llm","name":"商品智能分析","model_code":"chat_demo_v1","prompt_template":"分析电商商品『{{product}}』的核心卖点与适合的出图风格。","cost":0.03},
     {"id":"poster","type":"image","name":"商品出图","model_code":"image_fast_v1","prompt_template":"高级电商商品主图，产品：{{product}}，干净背景，柔和打光","cost":0.12}
   ]',
   '{"type":"object","properties":{"product":{"type":"string","title":"商品信息","placeholder":"输入商品名称和详细信息，例如：XXX品牌玻尿酸精华液，30ml，主打三重保湿，敏感肌可用..."}}}',
   '{"billing_type":"per_request","unit_price":0.15}',
   '{
     "theme": "amber",
     "hero_tags": ["AI智能体", "多轮对话", "每步可控"],
     "feature_tags": ["上传商品·AI自动识别", "多轮对话·精准补全", "智能推荐·自由选择", "每步可控·一键出图"],
     "steps": [
       {"icon": "🔍", "title": "商品智能分析", "subtitle": "上传图片+描述，AI 自动识别卖点", "tags": ["图片识别", "亮点提取", "多轮补全", "信息确认"]},
       {"icon": "🧩", "title": "出图需求智能推荐", "subtitle": "AI 按需求推荐主图/详情图/场景图", "tags": ["类型推荐", "自由勾选", "数量可调"]},
       {"icon": "🎨", "title": "风格方案逐张可控", "subtitle": "选风格、定方案，每张图都可调整", "tags": ["风格预览", "逐张可控", "随时调整"]},
       {"icon": "📦", "title": "批量生成审阅微调", "subtitle": "并发出图，质量自检，不满意一键重做", "tags": ["批量并发", "审阅微调", "一键重做"]}
     ],
     "input": {"image_label": "商品图", "placeholder": "输入商品名称和详细信息，例如：XXX品牌玻尿酸精华液，30ml，主打三重保湿，敏感肌可用...", "modes": ["逐步确认", "智能托管"]}
   }',
   2),
  ('general_image', '通用一键生图', '描述你想生成的图片，AI 智能分析需求并推荐方案，多轮对话逐张可控。',
   '🖼️', 'image',
   '[
     {"id":"analyze","type":"llm","name":"需求智能分析","model_code":"chat_demo_v1","prompt_template":"分析图片需求『{{prompt}}』并补全画面细节描述。","cost":0.03},
     {"id":"image","type":"image","name":"图片生成","model_code":"image_fast_v1","prompt_template":"{{prompt}}","cost":0.12}
   ]',
   '{"type":"object","properties":{"prompt":{"type":"string","title":"图片描述","placeholder":"描述你想生成的图片，如：人物写真、产品展示图、海报设计、艺术创作..."}}}',
   '{"billing_type":"per_request","unit_price":0.15}',
   '{
     "theme": "violet",
     "hero_tags": ["AI智能体", "多轮对话", "每步可控"],
     "feature_tags": ["上传图片·AI自动识别", "多轮对话·精准补全", "智能推荐·自由选择", "每步可控·一键出图"],
     "steps": [
       {"icon": "🔍", "title": "需求智能分析", "subtitle": "上传/描述，AI 自动补全画面细节", "tags": ["需求识别", "细节补全", "信息确认"]},
       {"icon": "🧩", "title": "出图需求智能推荐", "subtitle": "根据内容类型智能推荐最合适的方案", "tags": ["类型推荐", "自由勾选", "数量可调", "全自动覆盖"]},
       {"icon": "🎨", "title": "风格方案逐张可控", "subtitle": "选风格、定方案，每张可单独调整", "tags": ["风格预览", "逐张可控", "随时调整"]},
       {"icon": "📦", "title": "批量生成审阅微调", "subtitle": "并发出图，质量自检，一键重做", "tags": ["批量并发", "审阅微调", "一键重做"]}
     ],
     "input": {"image_label": "参考图", "placeholder": "描述你想生成的图片，如：人物写真、产品展示图、海报设计、艺术创作...", "modes": ["逐步确认", "智能托管"]}
   }',
   3)
ON CONFLICT (code) DO NOTHING;
