"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bot, Check, Code2, Image as ImageIcon, Layers, Loader2, Pencil, Plus, Settings2, Sparkles, Trash2, Upload, Video, X } from "lucide-react";
import { adminApi, adminUploadFile } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";
import { AgentPolicyEditor } from "./AgentPolicyEditor";

type GenerationType = "image" | "video" | "video_upscale" | "video_redraw" | "subtitle_remove" | "comic_drama" | "novel_workshop" | "photo_studio" | "virtual_try_on" | "creative_agent";
type WorkflowNode = { id: string; name: string; type: string; model_code: string; prompt_template?: string; cost: number };
type RuntimeConfig = {
  agent_mode?: "simple_pipeline" | "custom_nodes" | "comic_drama" | "novel_workshop" | "photo_studio" | "virtual_try_on" | "infinite_canvas" | "video_upscale" | "video_redraw" | "subtitle_remove" | "creative_chat" | "product_refine";
  system_workspace?: boolean;
  quality_model_code?: string;
  image_concurrency?: number;
  video_concurrency?: number;
  prompt_enhance_model_code?: string;
  analysis_model_code?: string;
  fallback_model_code?: string;
  generation_model_code?: string;
  generation_type?: GenerationType | "chat" | "mixed";
  preset_code?: string;
  require_image?: boolean;
  default_count?: number;
  candidate_count?: number;
  batch_size?: number;
  creative_scenes?: string[];
  output_scenes?: string[];
  input_capabilities?: Record<string, boolean>;
  flow_options?: Record<string, boolean>;
  roles?: { id: string; name: string; avatar: string; description: string; node?: string }[];
  dialogue_model_codes?: string[];
  image_model_code?: string;
  video_model_code?: string;
  speech_model_code?: string;
  music_model_code?: string;
  narration_model_code?: string;
  audio_model_code?: string;
  default_segment_count?: number;
  default_segment_duration?: number;
  default_story_review_required?: boolean;
  audio_strategy?: "video_native" | "tts_only" | "hybrid";
  style_reference_mode?: string;
  duration_mode?: string;
  storyboard_grid?: number;
  max_retry?: number;
  asset_consistency_score?: number;
  logic_score?: number;
  orientation?: string;
  quality?: string;
  output_mode?: string;
  supported_resolutions?: string[];
  default_target_resolution?: string;
  preserve_audio?: boolean;
  default_enhancement_mode?: string;
  max_input_duration_sec?: number;
  max_input_size_mb?: number;
  upscale_operation?: string;
  upscale_prompt?: string;
  default_style_strength?: number;
  preserve_motion?: boolean;
  preserve_identity?: boolean;
  redraw_operation?: string;
  redraw_prompt?: string;
  default_subtitle_mode?: string;
  default_subtitle_region?: string;
  protect_watermark?: boolean;
  subtitle_remove_operation?: string;
  subtitle_remove_prompt?: string;
  default_review_mode?: "standard" | "strict";
  product_category_rules?: Record<string, string>;
  product_operation_rules?: Record<string, string>;
};
type Workflow = {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  category: string;
  nodes: WorkflowNode[];
  input_schema: Record<string, unknown>;
  price_rule: { unit_price?: number; billing_type?: string };
  display_config?: Record<string, any>;
  runtime_config?: RuntimeConfig;
  is_enabled: boolean;
  sort_order: number;
};
type AdminModel = {
  code: string;
  display_name: string;
  request_mode: string;
  category: string;
  is_enabled: boolean;
  runtime_rule?: Record<string, any>;
  input_schema?: Record<string, any>;
};
type CanvasTemplateAdmin = { id: string; name: string; description: string; template_id: string; document?: Record<string, unknown> };
type FormState = {
  isEdit: boolean;
  system_workspace: boolean;
  code: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  is_enabled: boolean;
  generation_type: GenerationType;
  quality_model_code: string;
  image_concurrency: number;
  video_concurrency: number;
  prompt_enhance_model_code: string;
  analysis_model_code: string;
  fallback_model_code: string;
  generation_model_code: string;
  image_model_code: string;
  video_model_code: string;
  speech_model_code: string;
  music_model_code: string;
  narration_model_code: string;
  default_segment_count: number;
  default_segment_duration: number;
  default_story_review_required: boolean;
  audio_strategy: "video_native" | "tts_only" | "hybrid";
  dialogue_model_codes: string;
  style_reference_mode: string;
  duration_mode: string;
  storyboard_grid: number;
  max_retry: number;
  asset_consistency_score: number;
  logic_score: number;
  orientation: string;
  quality: string;
  supported_resolutions: string[];
  default_target_resolution: string;
  preserve_audio: boolean;
  default_enhancement_mode: string;
  max_input_duration_sec: number;
  max_input_size_mb: number;
  upscale_operation: string;
  upscale_prompt: string;
  default_style_strength: number;
  preserve_motion: boolean;
  preserve_identity: boolean;
  redraw_operation: string;
  redraw_prompt: string;
  default_subtitle_mode: string;
  default_subtitle_region: string;
  protect_watermark: boolean;
  subtitle_remove_operation: string;
  subtitle_remove_prompt: string;
  require_image: boolean;
  allow_text_only: boolean;
  support_reference_image: boolean;
  support_multiple_references: boolean;
  support_first_last_frame: boolean;
  enable_step_confirm: boolean;
  enable_autopilot: boolean;
  allow_prompt_edit: boolean;
  default_count: number;
  candidate_count: number;
  creative_scenes: string[];
  unit_price: number;
  placeholder: string;
  help: string;
  canvas_templates: CanvasTemplateAdmin[];
  default_product_review_mode: "standard" | "strict";
  product_category_rules_json: string;
  product_operation_rules_json: string;
  preset_override?: Partial<PresetBundle>;
};

const PAGE_SIZE = 10;
const DEFAULT_PRODUCT_CATEGORY_RULES: Record<string, string> = {
  footwear: "核对鞋型、鞋头、鞋舌、鞋口、后跟、鞋底、贴条、鞋带和标识；穿着时逐侧检查脚踝接合、遮挡和受力。",
  apparel: "核对版型、领口、袖口、门襟、裁片、缝线、纽扣和拉链；穿着褶皱不得改变结构。",
  bag: "核对包型、提手与包身连接、肩带、拉链、扣件、口袋、边油和五金数量；手持或背负时受力真实。",
  watch: "核对表盘、指针、刻度、表冠、表耳、表带节数和扣具；佩戴时表带弯曲和皮肤接触真实。",
  eyewear: "核对镜框、镜片、鼻托、铰链和镜腿连接；佩戴时左右落点、透视、反射和遮挡合理。",
  jewelry: "核对链节、镶嵌、爪位、耳针、搭扣和宝石数量；佩戴时不得穿入皮肤、断链或复制部件。",
  cosmetics: "核对瓶型、泵头、瓶盖、标签、文字、液位和透明材质；手持时不得改写标签或穿入包装。",
  bottle: "核对瓶口、瓶盖、泵头、标签、刻度、液位、透明度和反射；不得新增开口或扭曲文字。",
  electronics: "核对屏幕、按键、镜头、接口、开孔、边框和标识的位置与数量；使用时不得变形。",
  appliance: "核对机身比例、面板、旋钮、出风口、门盖、电源结构和标签；摆放时落地、开合与尺度真实。",
  furniture: "核对外形比例、拼接、支撑、腿脚、五金、面料和纹理；透视、落地受力和空间尺度真实。",
  home: "核对轮廓、拼接、支撑、五金、纹理方向和落地受力；不得悬浮、断裂或错误连接。",
  kitchenware: "核对器型、口沿、把手、盖体、刃口、刻度和材质反射；握持、开合和受力真实。",
  food: "核对包装形状、封口、标签、文字、数量和内容物；不得虚构认证、功效或净含量。",
  beverage: "核对容器、瓶盖或拉环、标签、液位、气泡和冷凝；不得虚构口味、配方、酒精度或容量。",
  toy: "核对角色造型、零件数量、关节、涂装、贴纸和配件；不得缺件、复制、错接或改变比例。",
  sports: "核对器材轮廓、握把、绑带、连接点、纹理和品牌位置；使用姿势、接触和受力真实。",
  automotive: "核对外壳、安装孔位、接口、纹路、反光件和配件；安装展示的部位、尺度和连接真实。",
  pet: "核对包装或用品结构、扣具、织带、开口和尺寸；佩戴时松紧、毛发遮挡和受力合理。",
  stationery: "核对外形、笔尖或装订、按键、刻度、印刷和配件；书写或手持时比例与握持真实。",
  baby: "核对结构、锁扣、绑带、护栏、轮组、刻度和配件；保持安全结构，不虚构认证和功能。",
  health: "核对结构、显示、按键、接口、绑带和包装文字；不得虚构医疗功效、认证或不可见参数。",
  other: "核对商品轮廓、结构连接、部件数量、材质、颜色、文字与标识；交互时接触、遮挡和受力真实。",
};

const DEFAULT_PRODUCT_OPERATION_RULES: Record<string, string> = {
  auto_showcase: "自动选择最符合商品实际类型和参考素材的主流电商展示方式；保持商品身份与关键卖点，补全自然构图、光影、接触和留白。",
  local_repair: "仅重绘用户圈选的问题区域，修复接缝、穿透、粘连、断裂、重复边缘和错误遮挡；除用户明确要求保留的内容外，移除圈内红圈、箭头或文字标注，圈外像素、构图和尺寸保持不变。",
  wear: "适用于可穿戴商品；人体部位、尺码比例、穿戴位置、遮挡、接触和受力符合真实使用方式。",
  hold_use: "适用于手持或操作展示；握持点、操作方向、尺度和受力真实，不遮住核心卖点。",
  background: "保持商品本身和拍摄角度，主要修改背景、承托面、光影及必要反射。",
  detail: "优先从已有清晰像素裁切或轻度精修材质与工艺特写，不补造不可见细节。",
  custom: "执行用户明确要求，对未说明的商品真实性、构图、光影和交互细节使用通用品控规则补全。",
};

function parseProductRuleMap(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, rule]) => key.trim() && typeof rule === "string" && rule.trim()).map(([key, rule]) => [key.trim(), String(rule).trim()]));
  } catch {
    return {};
  }
}
type SceneDef = { code: string; label: string; desc: string; locked?: boolean };
type PresetBundle = {
  display_config: Record<string, unknown>;
  runtime_config: RuntimeConfig;
  input_schema: Record<string, unknown>;
  nodes: WorkflowNode[];
  price_rule: Record<string, unknown>;
};

function isImageIcon(value?: string) {
  return /^(https?:\/\/|\/|data:image\/|blob:)/i.test(value?.trim() || "");
}

function AgentIconValue({ value, fallback, alt = "" }: { value?: string; fallback: string; alt?: string }) {
  const icon = value?.trim() || fallback;
  if (isImageIcon(icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt={alt} className="h-full w-full object-cover" />;
  }
  return <>{icon}</>;
}

const IMAGE_SCENES: SceneDef[] = [
  { code: "main_image", label: "商品主图", desc: "白底或高级简洁背景，主体清晰，适合列表和首图。", locked: true },
  { code: "detail_image", label: "商品详情图", desc: "突出材质、结构、规格和卖点，适合详情页模块。" },
  { code: "scene_image", label: "场景图", desc: "放入真实使用环境，强化质感、尺寸和购买欲。" },
  { code: "marketing_poster", label: "营销海报", desc: "活动氛围、广告构图和品牌视觉，适合推广素材。" },
];
const VIDEO_SCENES: SceneDef[] = [
  { code: "product_video", label: "商品视频", desc: "商品展示短视频，强调运镜、卖点节奏和商业质感。", locked: true },
  { code: "image_to_video", label: "图生视频", desc: "用首帧或参考图扩展成动态视频，保持主体一致。" },
];

const COMIC_SCENES: SceneDef[] = [
  { code: "ai_comic_drama", label: "AI漫剧", desc: "剧本、分镜、关键帧、分段视频与最终合成。", locked: true },
];

const TYPE_PRESETS = {
  creative_agent: {
    label: "通用智能体",
    icon: "✦",
    theme: "amber",
    description: "通过聊天理解创作意图，自动选择图片或视频链路。",
    placeholder: "描述想法、脚本或上传参考素材",
    help: "直接描述需求，Agent 会先分析任务类型，再调用后台指定的图片或视频模型。",
    imageLabel: "参考素材",
    heroTags: ["Agent 模式", "图片生成", "视频生成"],
    featureTags: ["意图识别", "自动选模型", "生成前确认"],
    defaults: { require_image: false, allow_text_only: true, support_reference_image: true, support_multiple_references: true, support_first_last_frame: false },
  },
  image: {
    label: "电商图片",
    icon: "🖼️",
    theme: "amber",
    description: "适合商品主图、详情图、场景图和营销海报。",
    placeholder: "例如：莫来石商品主图，白底高级质感，突出材质纹理",
    help: "上传商品图或参考图，选择出图场景，输入简短需求。系统会自动分析并生成可执行方案。",
    imageLabel: "商品图",
    heroTags: ["电商图片", "AI智能体", "智能托管"],
    featureTags: ["主图", "详情图", "场景图", "营销海报"],
    defaults: { require_image: true, allow_text_only: false, support_reference_image: true, support_multiple_references: true, support_first_last_frame: false },
  },
  video: {
    label: "电商视频",
    icon: "🎬",
    theme: "rose",
    description: "适合商品展示短视频和图生视频。",
    placeholder: "例如：生成 5 秒商品展示短视频，镜头缓慢推进，突出材质",
    help: "上传商品图、首帧或参考图，选择视频场景，系统会规划镜头运动、卖点节奏和视频提示词。",
    imageLabel: "商品图/首帧",
    heroTags: ["电商视频", "镜头规划", "智能托管"],
    featureTags: ["商品视频", "图生视频", "运镜", "短视频素材"],
    defaults: { require_image: true, allow_text_only: false, support_reference_image: true, support_multiple_references: true, support_first_last_frame: true },
  },
  video_upscale: {
    label: "一键视频高清",
    icon: "✨",
    theme: "cyan",
    description: "上传低清视频，通过 AI 超分增强输出 720P、1K 或 2K 高清视频。",
    placeholder: "可选：补充降噪、人物细节或画面增强要求",
    help: "上传源视频或从资产库选择视频，选择目标清晰度后运行。系统会保留原始内容、时长和构图，并按后台配置的超分模型实际计费。",
    imageLabel: "源视频",
    heroTags: ["AI超分", "视频高清", "画质增强"],
    featureTags: ["720P", "1K", "2K", "保留原音"],
    defaults: { require_image: false, allow_text_only: false, support_reference_image: false, support_multiple_references: false, support_first_last_frame: false },
  },
  video_redraw: {
    label: "一键转绘",
    icon: "🪄",
    theme: "violet",
    description: "上传视频并选择目标画风，通过视频转视频模型保持动作与人物一致性完成风格转绘。",
    placeholder: "描述目标画风，例如：日系动漫、厚涂插画、赛博朋克电影感",
    help: "上传源视频，可补充风格参考图和画风描述。系统调用后台指定的视频转视频模型，按模型实际费用结算。",
    imageLabel: "源视频",
    heroTags: ["视频转绘", "风格迁移", "动作保持"],
    featureTags: ["人物一致", "运动一致", "风格参考", "保留原音"],
    defaults: { require_image: false, allow_text_only: false, support_reference_image: true, support_multiple_references: false, support_first_last_frame: false },
  },
  subtitle_remove: {
    label: "一键去字幕",
    icon: "🧹",
    theme: "emerald",
    description: "自动识别独立字幕轨或烧录硬字幕，并输出清理后的完整视频。",
    placeholder: "可选：说明字幕位置、需要保护的水印或画面区域",
    help: "自动模式优先无损移除独立字幕轨；没有字幕轨时调用后台配置的 AI 修复模型清除画面硬字幕。",
    imageLabel: "源视频",
    heroTags: ["自动识别", "软字幕无损", "硬字幕修复"],
    featureTags: ["字幕区域", "保护水印", "保留原音", "结果预览"],
    defaults: { require_image: false, allow_text_only: false, support_reference_image: false, support_multiple_references: false, support_first_last_frame: false },
  },
  comic_drama: {
    label: "AI漫剧",
    icon: "🎨",
    theme: "comic",
    description: "输入故事创意与风格参考，AI 自动完成剧本、角色、分镜、关键帧、分段视频和最终合成。",
    placeholder: "例如：赛博城市里的少年侦探追查失控 AI，电影感，节奏紧凑",
    help: "输入故事创意，可上传风格参考图。逐步确认模式会在分镜规划后暂停，智能托管会自动完成关键帧、分段视频和最终合成。",
    imageLabel: "风格参考图",
    heroTags: ["超级智能体", "AI漫剧", "一键成片"],
    featureTags: ["剧本规划", "角色一致", "关键帧", "视频合成"],
    defaults: { require_image: false, allow_text_only: true, support_reference_image: true, support_multiple_references: true, support_first_last_frame: false },
  },
  novel_workshop: {
    label: "AI小说工坊",
    icon: "📖",
    theme: "indigo",
    description: "一句话创意，让AI帮你写完一整本书。多位AI编辑协同作战，大纲逐章确认、设定全程追踪、写完自动润色审校。",
    placeholder: "例如：写一本关于未来世界的科幻小说，主角是AI研究员...",
    help: "输入故事创意，选择题材、字数和文风。系统自动规划故事结构、生成章节、润色文笔并完成审校。逐步确认模式会在大纲确认后暂停，智能托管会自动完成全部章节创作。",
    imageLabel: "资产",
    heroTags: ["文学创作", "AI编辑部", "多角色协同"],
    featureTags: ["设定永不崩", "文风统一", "全程对话可控", "整本打包下载"],
    defaults: { require_image: false, allow_text_only: true, support_reference_image: false, support_multiple_references: false, support_first_last_frame: false },
  },
  photo_studio: {
    label: "AI写真馆",
    icon: "📸",
    theme: "fuchsia",
    description: "上传一张照片，选择写真类型与风格倾向，AI 摄影团队几分钟产出一整套杂志级写真。",
    placeholder: "可选：补充服装、场景、动作或氛围要求，例如穿白色连衣裙、回眸微笑",
    help: "上传一张清晰的本人正面照片，选择写真类型（写真/职业照/证件照）和风格倾向，挑选出图模型与张数。造型师会先给出拍摄方案，逐步确认模式下可修改方案后再开拍，智能托管则自动完成拍摄与精修。",
    imageLabel: "本人照片",
    heroTags: ["AI写真", "风格百变", "人像保真"],
    featureTags: ["38种主流风格", "写真/职业照/证件照", "影棚级光影", "几分钟出片"],
    defaults: { require_image: true, allow_text_only: false, support_reference_image: true, support_multiple_references: false, support_first_last_frame: false },
  },
  virtual_try_on: {
    label: "AI试衣间",
    icon: "👗",
    theme: "rose",
    description: "上传人物照片和服装商品图，使用多参考图模型生成自然的视觉试穿效果。",
    placeholder: "可选：补充穿着要求，例如外套敞开，保留原来的裤装",
    help: "分别上传人物照片和服装商品图，选择服装类型、模型、清晰度与张数。系统会固定人物图和服装图的参考顺序，保留人物身份并替换目标服装。",
    imageLabel: "人物与服装",
    heroTags: ["双图试穿", "人物保真", "服装还原"],
    featureTags: ["Nano Banana", "GPT Image 2", "Gemini", "结果可下载"],
    defaults: { require_image: true, allow_text_only: false, support_reference_image: true, support_multiple_references: true, support_first_last_frame: false },
  },
} as const;

const isVideoUtilityType = (type: GenerationType) => ["video_upscale", "video_redraw", "subtitle_remove"].includes(type);
const isTryOnImageModel = (model: AdminModel) => {
  const imageRule = model.runtime_rule?.image || {};
  if (Number(imageRule.max_reference_images || model.runtime_rule?.max_reference_images || 0) >= 2) return true;
  const searchable = `${model.code} ${model.display_name} ${JSON.stringify(model.runtime_rule || {})}`.toLowerCase();
  return searchable.includes("nano_banana") || searchable.includes("nano banana") || searchable.includes("gpt-image-2") || searchable.includes("gemini");
};
const defaultScenes = (type: GenerationType) => (type === "creative_agent" || isVideoUtilityType(type) ? [] : type === "comic_drama" ? ["ai_comic_drama"] : type === "video" ? ["product_video"] : ["main_image"]);
const sceneDefs = (type: GenerationType) => (type === "creative_agent" || isVideoUtilityType(type) ? [] : type === "comic_drama" ? COMIC_SCENES : type === "video" ? VIDEO_SCENES : IMAGE_SCENES);
const presetCode = (type: GenerationType) => (type === "creative_agent" ? "general_creative_agent" : isVideoUtilityType(type) ? type : type === "comic_drama" ? "ai_comic_drama" : type === "novel_workshop" ? "novel_workshop" : type === "photo_studio" ? "photo_studio" : type === "virtual_try_on" ? "virtual_try_on" : type === "video" ? "ecommerce_video" : "ecommerce_image");
const DEFAULT_CANVAS_TEMPLATES: CanvasTemplateAdmin[] = [
  { id: "text-image", name: "文字生图片", description: "文本提示词连接图片生成节点", template_id: "text-image" },
  { id: "image-image", name: "图片生图片", description: "参考图片连接图片生成节点", template_id: "image-image" },
  { id: "text-image-mix", name: "文案与配图", description: "文字与参考图片共同生成新图片", template_id: "text-image-mix" },
  { id: "content-image-post", name: "内容创作", description: "文字内容与图片混合创作，适配公众号、小红书和今日头条", template_id: "content-image-post" },
  { id: "multi-image", name: "多图对比", description: "多个参考素材连接双图片生成节点", template_id: "multi-image" },
  { id: "text-video", name: "文字生视频", description: "文本提示词连接视频生成节点", template_id: "text-video" },
  { id: "image-video", name: "图片生视频", description: "首帧或参考图片连接视频生成节点", template_id: "image-video" },
  { id: "ecommerce-visual-pack", name: "电商视觉套图", description: "商品信息与参考图同时生成主图和详情海报", template_id: "ecommerce-visual-pack" },
  { id: "social-campaign", name: "社媒图文视频", description: "一份营销文案同时生成社媒配图和短视频", template_id: "social-campaign" },
  { id: "product-showcase-video", name: "商品展示视频", description: "商品图先生成关键视觉，再延展为展示视频", template_id: "product-showcase-video" },
  { id: "brand-visual-kit", name: "品牌视觉套件", description: "品牌需求并行生成标志创意和视觉海报", template_id: "brand-visual-kit" },
  { id: "photo-restoration", name: "老照片修复", description: "参考照片经过修复、上色与高清增强生成新图", template_id: "photo-restoration" },
  { id: "story-short-video", name: "视频创作", description: "创作需求生成视频脚本、分镜、关键帧、视频片段与完整成片", template_id: "story-short-video" },
  { id: "viral-remake", name: "爆款复刻", description: "多模态拆解爆款参考，生成多关键帧、多片段并合成为原创短视频", template_id: "viral-remake" },
  { id: "one-click-viral-remake", name: "一键爆款复刻", description: "导入 TikTok 视频和商品素材，一键拆解并生成原创带货短视频", template_id: "one-click-viral-remake" },
];

const defaultNodes = (analysis = "", generation = "", type: GenerationType = "image", imageModel = "", videoModel = ""): WorkflowNode[] => {
  if (type === "creative_agent") {
    return [
      { id: "plan", type: "llm", name: "意图分析", model_code: analysis, prompt_template: "", cost: 0 },
      { id: "image", type: "image", name: "图片生成", model_code: imageModel, prompt_template: "", cost: 0 },
      { id: "video", type: "video", name: "视频生成", model_code: videoModel, prompt_template: "", cost: 0 },
    ];
  }
  if (type === "video_upscale") {
    return [{ id: "upscale", type: "video", name: "AI 视频高清", model_code: generation, prompt_template: "", cost: 0 }];
  }
  if (type === "video_redraw") {
    return [{ id: "redraw", type: "video", name: "AI 视频转绘", model_code: generation, prompt_template: "", cost: 0 }];
  }
  if (type === "subtitle_remove") {
    return [{ id: "subtitle_remove", type: "video", name: "AI 视频去字幕", model_code: generation, prompt_template: "", cost: 0 }];
  }
  if (type === "comic_drama") {
    return [
      { id: "comic_plan", type: "llm", name: "AI漫剧规划", model_code: analysis, prompt_template: "", cost: 0 },
      { id: "keyframes", type: "image", name: "关键帧生成", model_code: imageModel, prompt_template: "", cost: 0 },
      { id: "video_segments", type: "video", name: "分段视频生成", model_code: videoModel || generation, prompt_template: "", cost: 0 },
      { id: "compose", type: "video", name: "视频合成", model_code: "", prompt_template: "", cost: 0 },
    ];
  }
  if (type === "novel_workshop") {
    return [
      { id: "planning", type: "llm", name: "故事策划", model_code: analysis || generation, prompt_template: "", cost: 0.1 },
      { id: "writing", type: "llm", name: "章节创作", model_code: generation, prompt_template: "", cost: 0.05 },
      { id: "polishing", type: "llm", name: "润色审校", model_code: generation, prompt_template: "", cost: 0.03 },
      { id: "archiving", type: "llm", name: "档案更新", model_code: generation, prompt_template: "", cost: 0.02 },
    ];
  }
  if (type === "photo_studio") {
    return [
      { id: "styling", type: "llm", name: "写真造型设计", model_code: analysis || generation, prompt_template: "", cost: 0.02 },
      { id: "generate", type: "image", name: "写真拍摄生成", model_code: generation, prompt_template: "", cost: 0 },
    ];
  }
  if (type === "virtual_try_on") {
    return [{ id: "try_on", type: "image", name: "AI试穿生成", model_code: generation, prompt_template: "", cost: 0 }];
  }
  return [
    { id: "analysis", type: "llm", name: "需求分析", model_code: analysis, prompt_template: "", cost: 0 },
    { id: "generate", type, name: "生成结果", model_code: generation, prompt_template: "", cost: 0 },
  ];
};

const defaultSchema = (count = 1, type: GenerationType = "image", form?: FormState) => type === "video_upscale" ? ({
  type: "object",
  required: ["video_url", "target_resolution"],
  properties: {
    video_url: { type: "string", title: "源视频" },
    target_resolution: { type: "string", title: "目标清晰度", enum: form?.supported_resolutions || ["720P", "1K", "2K"], default: form?.default_target_resolution || "720P" },
    preserve_audio: { type: "boolean", title: "保留原音", default: form?.preserve_audio !== false },
    enhancement_mode: { type: "string", title: "增强模式", enum: ["balanced", "detail", "denoise"], default: form?.default_enhancement_mode || "balanced" },
  },
}) : type === "video_redraw" ? ({
  type: "object",
  required: ["video_url"],
  properties: {
    video_url: { type: "string", title: "源视频" },
    prompt: { type: "string", title: "转绘要求" },
    style_strength: { type: "number", title: "风格强度", minimum: 0, maximum: 1, default: form?.default_style_strength ?? 0.65 },
    preserve_motion: { type: "boolean", title: "保留动作", default: form?.preserve_motion !== false },
    preserve_identity: { type: "boolean", title: "保留人物身份", default: form?.preserve_identity !== false },
    preserve_audio: { type: "boolean", title: "保留原音", default: form?.preserve_audio !== false },
  },
}) : type === "subtitle_remove" ? ({
  type: "object",
  required: ["video_url"],
  properties: {
    video_url: { type: "string", title: "源视频" },
    subtitle_mode: { type: "string", title: "字幕类型", enum: ["auto", "soft_track", "hardcoded_ai"], default: form?.default_subtitle_mode || "auto" },
    subtitle_region: { type: "string", title: "字幕区域", enum: ["bottom_15", "bottom_25", "bottom_35", "full"], default: form?.default_subtitle_region || "bottom_25" },
    protect_watermark: { type: "boolean", title: "保护水印", default: form?.protect_watermark !== false },
  },
}) : type === "novel_workshop" ? ({
  type: "object",
  properties: {
    prompt: { type: "string", title: "故事创意", placeholder: "例如：写一本关于未来世界的科幻小说，主角是AI研究员...", "x-widget": "textarea" },
    genre: { type: "string", title: "题材类型", enum: ["玄幻", "都市", "言情", "悬疑", "科幻", "历史", "武侠", "游戏", "现实"], default: "玄幻", "x-widget": "option_menu" },
    word_count_target: { type: "string", title: "目标篇幅", enum: ["短篇·3万字内", "中篇·约15万字", "长篇·50万字以上"], default: "中篇·约15万字", "x-widget": "option_menu" },
    style: { type: "string", title: "文风", enum: ["轻松幽默", "严肃正经", "诗意唯美", "节奏紧凑"], default: "轻松幽默", "x-widget": "option_menu" },
    language: { type: "string", title: "生成语言", default: "zh-CN" },
  },
}) : type === "photo_studio" ? ({
  type: "object",
  required: ["image_url", "photo_type"],
  properties: {
    image_url: { type: "string", title: "本人照片" },
    photo_type: { type: "string", title: "写真类型", enum: ["写真", "职业照", "证件照"], default: "写真", "x-widget": "option_menu" },
    style: { type: "string", title: "风格倾向", enum: ["影棚质感", "杂志大片", "黑白艺术", "韩系简约", "日系清新", "港风胶片", "法式复古", "美式复古", "国风古装", "旗袍风情", "新中式", "森系文艺", "咖啡馆日常", "都市夜景", "海边度假", "校园青春", "轻奢名媛", "甜美少女", "酷飒街头", "运动活力", "赛博霓虹", "暗调情绪", "户外自然", "婚纱浪漫", "雪景冬日", "商务精英", "纯白极简", "毕业季", "古典油画", "二次元动漫", "敦煌飞天", "民族风", "金秋落叶", "樱花春景", "Y2K千禧", "多巴胺糖果", "欧式宫廷", "沙漠戈壁"], default: "影棚质感", "x-widget": "option_menu" },
    id_background: { type: "string", title: "证件照底色", enum: ["白色", "蓝色", "红色"], default: "白色", "x-widget": "option_menu" },
    count: { type: "integer", title: "生成张数", enum: [1, 2, 4, 6, 8], default: count || 1, "x-widget": "option_menu" },
    prompt: { type: "string", title: "额外要求", placeholder: "可选：补充服装、场景、动作或氛围要求", "x-widget": "textarea" },
    aspect_ratio: { type: "string", title: "画面比例", default: "3:4" },
  },
}) : type === "virtual_try_on" ? ({
  type: "object",
  required: ["person_image_url", "person_asset_id", "garment_image_url", "garment_asset_id", "consent_confirmed"],
  properties: {
    person_image_url: { type: "string", title: "人物照片" },
    person_asset_id: { type: "string", title: "人物素材ID" },
    garment_image_url: { type: "string", title: "服装图片" },
    garment_asset_id: { type: "string", title: "服装素材ID" },
    garment_category: { type: "string", title: "服装类型", enum: ["auto", "tops", "bottoms", "one-pieces"], default: "auto" },
    garment_photo_type: { type: "string", title: "商品图类型", enum: ["auto", "flat-lay", "model"], default: "auto" },
    count: { type: "integer", title: "生成张数", enum: [1, 2, 4], default: count || 1 },
    image_size: { type: "string", title: "清晰度", enum: ["1K", "2K"], default: "1K" },
    aspect_ratio: { type: "string", title: "画面比例", default: "3:4" },
    prompt: { type: "string", title: "穿着要求" },
    consent_confirmed: { type: "boolean", title: "人物照片授权确认" },
  },
}) : ({
  type: "object",
  properties: {
    prompt: { type: "string", title: "需求描述", placeholder: "简单描述你想要的效果" },
    count: { type: "integer", title: "生成数量", default: count, minimum: 1, maximum: 50, enum: [1, 3, 5, 10, 20, 50], "x-widget": "option_menu", "x-icon": "layers", "x-highlight": true },
  },
});

function displayConfig(form: FormState) {
  const preset = TYPE_PRESETS[form.generation_type];
  const steps = form.generation_type === "video_upscale"
    ? [
        { icon: "🎬", title: "上传源视频", subtitle: "上传文件或从资产库引用已有视频", tags: ["格式校验", "时长检查"] },
        { icon: "✨", title: "AI 超分增强", subtitle: "降噪、去压缩瑕疵并恢复自然细节", tags: ["模型计费", "实时进度"] },
        { icon: "📥", title: "高清结果", subtitle: "在线预览并下载高清成片", tags: ["720P", "1K", "2K"] },
      ]
    : form.generation_type === "video_redraw"
    ? [
        { icon: "🎬", title: "导入源视频", subtitle: "上传视频并校验格式、时长和文件大小", tags: ["资产库", "安全校验"] },
        { icon: "🎨", title: "风格转绘", subtitle: "保留动作与人物一致性，重绘画面风格", tags: ["参考图", "强度可调"] },
        { icon: "📥", title: "转绘成片", subtitle: "在线预览、下载并自动保存到作品", tags: ["真实计费", "失败可追踪"] },
      ]
    : form.generation_type === "subtitle_remove"
    ? [
        { icon: "🔎", title: "识别字幕类型", subtitle: "自动区分独立字幕轨和画面硬字幕", tags: ["本地检测", "不误删水印"] },
        { icon: "🧹", title: "移除与修复", subtitle: "字幕轨无损移除，硬字幕调用 AI 修复", tags: ["区域可选", "自动回退"] },
        { icon: "📥", title: "无字幕成片", subtitle: "保留原始音视频并输出可下载结果", tags: ["实际路径提示", "费用透明"] },
      ]
    : form.generation_type === "comic_drama"
    ? [
        { icon: "📝", title: "剧本与资产规划", subtitle: "生成剧本、角色、道具、场景和分镜", tags: ["主备模型", "资产引用"] },
        { icon: "🖼️", title: "关键帧生成", subtitle: "按分镜生成角色与画风一致的关键帧", tags: ["角色一致", "失败重试"] },
        { icon: "🎬", title: "分段视频生成", subtitle: "关键帧驱动各分镜视频片段", tags: ["时长适配", "进度跟踪"] },
        { icon: "🎞️", title: "视频合成", subtitle: "合并全部分镜并生成最终漫剧成片", tags: ["顺序合成", "作品入库"] },
      ]
    : form.generation_type === "novel_workshop"
    ? [
        { icon: "📝", title: "故事策划", subtitle: "总编确定选题、人物设定、卷章大纲", tags: ["创意分析", "角色设定", "大纲规划"] },
        { icon: "📖", title: "逐章开写", subtitle: "章节写手按大纲和设定档案逐章写作", tags: ["分章节", "情节展开", "边写边审"] },
        { icon: "✍️", title: "润色审校", subtitle: "文学润色师优化文笔，审校员把关设定一致性", tags: ["风格统一", "语言打磨", "台账校验"] },
        { icon: "✅", title: "成书交付", subtitle: "档案员更新台账，整本导出Word/TXT文档", tags: ["质量把关", "格式整理", "打包下载"] },
      ]
    : form.generation_type === "photo_studio"
    ? [
        { icon: "🪞", title: "上传照片", subtitle: "上传一张清晰的本人正面照片", tags: ["人像识别", "特征提取"] },
        { icon: "💄", title: "造型设计", subtitle: "造型师按写真类型与风格倾向定制拍摄方案", tags: ["妆造方案", "场景布光"] },
        { icon: "📸", title: "写真拍摄", subtitle: "摄影师按方案批量出片，人像特征全程保留", tags: ["多张连拍", "风格一致"] },
        { icon: "✨", title: "精修交付", subtitle: "修图师打磨质感，整套写真一键下载", tags: ["自然精修", "打包下载"] },
      ]
    : form.generation_type === "virtual_try_on"
    ? [
        { icon: "🧍", title: "上传人物照", subtitle: "上传清晰的单人半身或全身照片", tags: ["授权确认", "人物保真"] },
        { icon: "👗", title: "上传服装图", subtitle: "使用清晰的单件平铺图或商品图", tags: ["服装识别", "细节提取"] },
        { icon: "✨", title: "AI智能试穿", subtitle: "多参考图模型替换目标服装区域", tags: ["双图生成", "区域控制"] },
        { icon: "📥", title: "结果交付", subtitle: "在线查看并下载试穿结果", tags: ["历史记录", "结果下载"] },
      ]
    : [
        { icon: "🔎", title: "需求智能分析", subtitle: "AI 根据输入和参考图理解目标效果", tags: ["需求识别", "素材分析"] },
        { icon: "✅", title: "方案确认", subtitle: "确认或修改生成方案", tags: ["逐步确认", "可编辑"] },
        { icon: form.generation_type === "video" ? "🎬" : "🖼️", title: form.generation_type === "video" ? "视频生成" : "图片生成", subtitle: "调用选择的生成模型输出结果", tags: ["异步生成", "进度跟踪"] },
      ];
  return {
    theme: preset.theme,
    hero_tags: preset.heroTags,
    feature_tags: preset.featureTags,
    steps,
    input: { image_label: preset.imageLabel, placeholder: form.placeholder || preset.placeholder, modes: ["逐步确认", "智能托管"] },
    help: form.help || preset.help,
  };
}

function runtimeConfig(form: FormState): RuntimeConfig {
  if (form.code === "product_refine") {
    return { agent_mode: "product_refine", preset_code: "product_refine", generation_type: "image", analysis_model_code: form.analysis_model_code, generation_model_code: form.generation_model_code, quality_model_code: form.quality_model_code, default_count: 1, default_review_mode: form.default_product_review_mode, product_category_rules: parseProductRuleMap(form.product_category_rules_json), product_operation_rules: parseProductRuleMap(form.product_operation_rules_json), input_capabilities: { allow_text_only: false, support_reference_image: true, support_multiple_references: true }, flow_options: { enable_autopilot: true, enable_step_confirm: false, allow_prompt_edit: false } };
  }
  if (form.generation_type === "video_upscale") {
    return {
      agent_mode: "video_upscale",
      generation_model_code: form.generation_model_code,
      generation_type: "video",
      preset_code: "video_upscale",
      default_count: 1,
      supported_resolutions: form.supported_resolutions,
      default_target_resolution: form.default_target_resolution,
      preserve_audio: form.preserve_audio,
      default_enhancement_mode: form.default_enhancement_mode,
      max_input_duration_sec: form.max_input_duration_sec,
      max_input_size_mb: form.max_input_size_mb,
      upscale_operation: form.upscale_operation || "upscale",
      upscale_prompt: form.upscale_prompt,
      input_capabilities: { allow_text_only: false, support_reference_image: false, support_multiple_references: false, support_first_last_frame: false },
      flow_options: { enable_step_confirm: false, enable_autopilot: true, allow_prompt_edit: true },
    };
  }
  if (form.generation_type === "video_redraw") {
    return {
      agent_mode: "video_redraw",
      generation_model_code: form.generation_model_code,
      generation_type: "video",
      preset_code: "video_redraw",
      default_count: 1,
      default_style_strength: form.default_style_strength,
      preserve_motion: form.preserve_motion,
      preserve_identity: form.preserve_identity,
      preserve_audio: form.preserve_audio,
      max_input_duration_sec: form.max_input_duration_sec,
      max_input_size_mb: form.max_input_size_mb,
      redraw_operation: form.redraw_operation || "video_redraw",
      redraw_prompt: form.redraw_prompt,
      input_capabilities: { allow_text_only: false, support_reference_image: true, support_multiple_references: false, support_first_last_frame: false },
      flow_options: { enable_step_confirm: false, enable_autopilot: true, allow_prompt_edit: true },
    };
  }
  if (form.generation_type === "subtitle_remove") {
    return {
      agent_mode: "subtitle_remove",
      generation_model_code: form.generation_model_code,
      generation_type: "video",
      preset_code: "subtitle_remove",
      default_count: 1,
      default_subtitle_mode: form.default_subtitle_mode,
      default_subtitle_region: form.default_subtitle_region,
      protect_watermark: form.protect_watermark,
      preserve_audio: form.preserve_audio,
      max_input_duration_sec: form.max_input_duration_sec,
      max_input_size_mb: form.max_input_size_mb,
      subtitle_remove_operation: form.subtitle_remove_operation || "subtitle_remove",
      subtitle_remove_prompt: form.subtitle_remove_prompt,
      input_capabilities: { allow_text_only: false, support_reference_image: false, support_multiple_references: false, support_first_last_frame: false },
      flow_options: { enable_step_confirm: false, enable_autopilot: true, allow_prompt_edit: true },
    };
  }
  if (form.generation_type === "comic_drama") {
    const dialogue = form.dialogue_model_codes.split(",").map((item) => item.trim()).filter(Boolean);
    return {
      agent_mode: "comic_drama",
      quality_model_code: form.quality_model_code,
      image_concurrency: form.image_concurrency,
      video_concurrency: form.video_concurrency,
      analysis_model_code: form.analysis_model_code,
      generation_model_code: form.video_model_code || form.generation_model_code,
      generation_type: "video",
      preset_code: "ai_comic_drama",
      require_image: form.require_image,
      default_count: 1,
      candidate_count: 1,
      creative_scenes: ["ai_comic_drama"],
      dialogue_model_codes: dialogue.length ? dialogue : [form.analysis_model_code].filter(Boolean),
      image_model_code: form.image_model_code,
      video_model_code: form.video_model_code || form.generation_model_code,
      narration_model_code: form.narration_model_code,
      audio_strategy: form.audio_strategy,
      style_reference_mode: form.style_reference_mode,
      duration_mode: form.duration_mode,
      storyboard_grid: form.storyboard_grid,
      max_retry: form.max_retry,
      asset_consistency_score: form.asset_consistency_score,
      logic_score: form.logic_score,
      orientation: form.orientation,
      quality: form.quality,
      output_mode: "composed_video",
      input_capabilities: {
        allow_text_only: form.allow_text_only,
        support_reference_image: form.support_reference_image,
        support_multiple_references: form.support_multiple_references,
        support_first_last_frame: false,
      },
      flow_options: {
        enable_step_confirm: form.enable_step_confirm,
        enable_autopilot: form.enable_autopilot,
        allow_prompt_edit: form.allow_prompt_edit,
      },
    };
  }
  if (form.generation_type === "novel_workshop") {
    return {
      agent_mode: "novel_workshop",
      quality_model_code: form.quality_model_code,
      image_concurrency: form.image_concurrency,
      video_concurrency: form.video_concurrency,
      analysis_model_code: form.analysis_model_code,
      generation_model_code: form.generation_model_code,
      generation_type: "chat",
      preset_code: "novel_workshop",
      default_count: 1,
      candidate_count: 1,
      creative_scenes: ["novel_creation"],
      batch_size: 10,
      input_capabilities: {
        allow_text_only: true,
        support_reference_image: false,
        support_multiple_references: false,
        support_first_last_frame: false,
      },
      flow_options: {
        enable_step_confirm: form.enable_step_confirm,
        enable_autopilot: form.enable_autopilot,
        allow_prompt_edit: form.allow_prompt_edit,
      },
    };
  }
  if (form.generation_type === "photo_studio") {
    return {
      agent_mode: "photo_studio",
      quality_model_code: form.quality_model_code,
      image_concurrency: form.image_concurrency,
      video_concurrency: form.video_concurrency,
      analysis_model_code: form.analysis_model_code,
      generation_model_code: form.generation_model_code,
      generation_type: "image",
      preset_code: "photo_studio",
      require_image: true,
      default_count: form.default_count || 1,
      candidate_count: 1,
      creative_scenes: ["main_image"],
      roles: [
        { id: "photo_director", name: "摄影总监", avatar: "/assets/photo-studio/photo-director.png", description: "统筹整场拍摄，把控写真类型、风格与出片质量", node: "styling" },
        { id: "stylist", name: "造型师", avatar: "/assets/photo-studio/stylist.png", description: "根据照片与风格倾向设计妆造、服装与拍摄方案", node: "styling" },
        { id: "photographer", name: "摄影师", avatar: "/assets/photo-studio/photographer.png", description: "按拍摄方案出片，影棚级布光与构图", node: "generate" },
        { id: "retoucher", name: "修图师", avatar: "/assets/photo-studio/retoucher.png", description: "保留人像特征的精修质感，皮肤与光影自然通透", node: "generate" },
      ],
      input_capabilities: {
        allow_text_only: false,
        support_reference_image: true,
        support_multiple_references: false,
        support_first_last_frame: false,
      },
      flow_options: {
        enable_step_confirm: form.enable_step_confirm,
        enable_autopilot: form.enable_autopilot,
        allow_prompt_edit: form.allow_prompt_edit,
      },
    };
  }
  if (form.generation_type === "virtual_try_on") {
    return {
      agent_mode: "virtual_try_on",
      generation_model_code: form.generation_model_code,
      generation_type: "image",
      preset_code: "virtual_try_on",
      require_image: true,
      default_count: form.default_count || 1,
      candidate_count: 1,
      creative_scenes: ["main_image"],
      roles: [
        { id: "stylist", name: "穿搭顾问", avatar: "/assets/photo-studio/stylist.png", description: "理解服装类型和穿着要求", node: "try_on" },
        { id: "garment", name: "服装分析师", avatar: "/assets/photo-studio/photo-director.png", description: "识别版型、颜色、纹理与细节", node: "try_on" },
        { id: "tryon", name: "试衣摄影师", avatar: "/assets/photo-studio/photographer.png", description: "调用多参考图模型完成试穿", node: "try_on" },
        { id: "quality", name: "质检师", avatar: "/assets/photo-studio/retoucher.png", description: "检查人物和服装一致性", node: "try_on" },
      ],
      input_capabilities: { allow_text_only: false, support_reference_image: true, support_multiple_references: true, support_first_last_frame: false },
      flow_options: { enable_step_confirm: false, enable_autopilot: true, allow_prompt_edit: true },
    };
  }
  if (form.generation_type === "creative_agent") {
    return {
      agent_mode: "creative_chat",
      quality_model_code: form.quality_model_code,
      image_concurrency: form.image_concurrency,
      video_concurrency: form.video_concurrency,
      analysis_model_code: form.analysis_model_code,
      fallback_model_code: form.fallback_model_code,
      image_model_code: form.image_model_code,
      video_model_code: form.video_model_code,
      speech_model_code: form.speech_model_code,
      music_model_code: form.music_model_code,
      generation_model_code: form.image_model_code,
      generation_type: "mixed",
      preset_code: "general_creative_agent",
      require_image: false,
      default_count: 1,
      candidate_count: 1,
      input_capabilities: { allow_text_only: true, support_reference_image: true, support_reference_video: true, support_reference_audio: true, support_multiple_references: true },
      flow_options: { enable_step_confirm: true, enable_autopilot: true, allow_prompt_edit: true },
    };
  }
  return {
    agent_mode: "simple_pipeline",
    analysis_model_code: form.analysis_model_code,
    generation_model_code: form.generation_model_code,
    generation_type: form.generation_type,
    preset_code: presetCode(form.generation_type),
    require_image: form.require_image,
    default_count: form.default_count,
    candidate_count: form.candidate_count,
    creative_scenes: normalizeScenes(form.creative_scenes, form.generation_type),
    input_capabilities: {
      allow_text_only: form.allow_text_only,
      support_reference_image: form.support_reference_image,
      support_multiple_references: form.support_multiple_references,
      support_first_last_frame: form.support_first_last_frame,
    },
    flow_options: {
      enable_step_confirm: form.enable_step_confirm,
      enable_autopilot: form.enable_autopilot,
      allow_prompt_edit: form.allow_prompt_edit,
    },
  };
}

function presetBundle(form: FormState): PresetBundle {
  return {
    display_config: displayConfig(form),
    runtime_config: runtimeConfig(form),
    input_schema: defaultSchema(form.default_count, form.generation_type, form),
    nodes: defaultNodes(
      form.analysis_model_code,
      form.generation_model_code,
      form.generation_type,
      form.image_model_code,
      form.video_model_code
    ),
    price_rule: form.generation_type === "creative_agent" ? { billing_type: "model_actual", unit_price: 0 } : { billing_type: "per_request", unit_price: Number(form.unit_price) || 0 },
  };
}

function mergedPresetBundle(form: FormState): PresetBundle {
  return { ...presetBundle(form), ...(form.preset_override || {}) };
}

function makeEmptyForm(): FormState {
  const preset = TYPE_PRESETS.image;
  return {
    isEdit: false,
    system_workspace: false,
    code: "",
    name: "",
    description: preset.description,
    icon: preset.icon,
    sort_order: 0,
    is_enabled: true,
    generation_type: "image",
    quality_model_code: "",
    image_concurrency: 3,
    video_concurrency: 2,
    prompt_enhance_model_code: "",
    analysis_model_code: "",
    fallback_model_code: "",
    generation_model_code: "",
    image_model_code: "image_fast_v1",
    video_model_code: "video_demo_v1",
    speech_model_code: "",
    music_model_code: "",
    narration_model_code: "",
    default_segment_count: 4,
    default_segment_duration: 8,
    default_story_review_required: true,
    audio_strategy: "video_native",
    dialogue_model_codes: "chat_demo_v1",
    style_reference_mode: "image_reference",
    duration_mode: "standard",
    storyboard_grid: 6,
    max_retry: 2,
    asset_consistency_score: 80,
    logic_score: 50,
    orientation: "landscape",
    quality: "480P",
    supported_resolutions: ["720P", "1K", "2K"],
    default_target_resolution: "720P",
    preserve_audio: true,
    default_enhancement_mode: "balanced",
    max_input_duration_sec: 300,
    max_input_size_mb: 500,
    upscale_operation: "upscale",
    upscale_prompt: "Enhance the source video to the requested resolution. Preserve the original content, timing, composition, identity, motion and audio. Reduce compression artifacts and noise, recover natural detail, and avoid changing the scene.",
    default_style_strength: 0.65,
    preserve_motion: true,
    preserve_identity: true,
    redraw_operation: "video_redraw",
    redraw_prompt: "Redraw the source video in the requested visual style while preserving timing, motion, composition, subject identity and scene continuity. Avoid flicker and temporal inconsistency.",
    default_subtitle_mode: "auto",
    default_subtitle_region: "bottom_25",
    protect_watermark: true,
    subtitle_remove_operation: "subtitle_remove",
    subtitle_remove_prompt: "Remove burned-in subtitles from the selected region and naturally reconstruct the background. Preserve people, products, logos, watermarks outside the subtitle region, motion, timing and audio.",
    ...preset.defaults,
    enable_step_confirm: true,
    enable_autopilot: true,
    allow_prompt_edit: true,
    default_count: 1,
    candidate_count: 3,
    creative_scenes: defaultScenes("image"),
    unit_price: 0.1,
    placeholder: preset.placeholder,
    help: preset.help,
    canvas_templates: DEFAULT_CANVAS_TEMPLATES.map((item) => ({ ...item })),
    default_product_review_mode: "standard",
    product_category_rules_json: JSON.stringify(DEFAULT_PRODUCT_CATEGORY_RULES, null, 2),
    product_operation_rules_json: JSON.stringify(DEFAULT_PRODUCT_OPERATION_RULES, null, 2),
  };
}

function normalizeScenes(items: unknown, type: GenerationType): string[] {
  if (type === "creative_agent" || isVideoUtilityType(type)) return [];
  const fallback = type === "video" ? "product_video" : "main_image";
  const allowed = new Set(sceneDefs(type).map((item) => item.code));
  const raw = Array.isArray(items) ? items.map(String) : [];
  const out = Array.from(new Set(raw.filter((item) => allowed.has(item))));
  if (!out.includes(fallback)) out.unshift(fallback);
  return out;
}

function readBool(map: Record<string, any> | undefined, key: string, fallback: boolean) {
  return typeof map?.[key] === "boolean" ? map[key] : fallback;
}

function typeFromRuntime(runtime: RuntimeConfig, category: string): GenerationType {
  if (runtime.agent_mode === "creative_chat" || runtime.preset_code === "general_creative_agent" || runtime.generation_type === "mixed") return "creative_agent";
  if (runtime.agent_mode === "video_upscale" || runtime.preset_code === "video_upscale") return "video_upscale";
  if (runtime.agent_mode === "video_redraw" || runtime.preset_code === "video_redraw") return "video_redraw";
  if (runtime.agent_mode === "subtitle_remove" || runtime.preset_code === "subtitle_remove") return "subtitle_remove";
  if (runtime.agent_mode === "comic_drama" || runtime.preset_code === "ai_comic_drama") return "comic_drama";
  if (runtime.agent_mode === "novel_workshop" || runtime.preset_code === "novel_workshop") return "novel_workshop";
  if (runtime.agent_mode === "photo_studio" || runtime.preset_code === "photo_studio") return "photo_studio";
  if (runtime.agent_mode === "virtual_try_on" || runtime.preset_code === "virtual_try_on") return "virtual_try_on";
  if (runtime.generation_type === "video" || category === "video" || runtime.preset_code === "product_showcase_video" || runtime.preset_code === "image_to_video") return "video";
  return "image";
}

export default function AgentsAdminPage() {
  const [items, setItems] = useState<Workflow[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(makeEmptyForm());
  const [err, setErr] = useState("");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonErr, setJsonErr] = useState("");
  const [page, setPage] = useState(1);
  const [iconUploading, setIconUploading] = useState(false);

  const chatModels = useMemo(
    () => models.filter((m) => m.is_enabled && m.category === "chat" && ["chat_completions", "responses"].includes(m.request_mode)),
    [models]
  );
  const imageModels = useMemo(
    () => models.filter((m) => m.is_enabled && m.category === "image"),
    [models]
  );
  const videoModels = useMemo(
    () => models.filter((m) => m.is_enabled && m.category === "video"),
    [models]
  );
  const audioModels = useMemo(
    () => models.filter((m) => {
      if (!m.is_enabled || m.category !== "audio") return false;
      const adapter = String(m.runtime_rule?.upstream?.adapter || "").toLowerCase();
      const searchable = `${m.code} ${m.display_name} ${adapter}`.toLowerCase();
      const properties = (m.input_schema?.properties || {}) as Record<string, unknown>;
      if (searchable.includes("music") || searchable.includes("suno") || "lyrics" in properties) return false;
      return true;
    }),
    [models]
  );
  const musicModels = useMemo(
    () => models.filter((m) => {
      if (!m.is_enabled || m.category !== "audio") return false;
      const audio = (m.runtime_rule?.audio || {}) as Record<string, unknown>;
      return audio.input_layout === "dual" || /(music|suno|音乐|歌曲)/i.test(`${m.code} ${m.display_name}`);
    }),
    [models]
  );
  const generationModels = form.generation_type === "video" || isVideoUtilityType(form.generation_type)
    ? videoModels
    : form.generation_type === "virtual_try_on"
      ? imageModels.filter((model) => isTryOnImageModel(model) || model.code === form.generation_model_code)
      : imageModels;
  const activePreset = TYPE_PRESETS[form.generation_type];
  const paginatedItems = useMemo(() => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [items, page]);

  const load = () => adminApi<{ items: Workflow[] }>("/agents").then((r) => setItems(r.items || []));
  useEffect(() => {
    load();
    adminApi<AdminModel[]>("/models").then((r) => setModels(r || []));
  }, []);

  const setType = (type: GenerationType) => {
    const preset = TYPE_PRESETS[type];
    setForm((prev) => ({
      ...prev,
      generation_type: type,
      generation_model_code: prev.generation_type === type ? prev.generation_model_code : "",
      description: prev.description === TYPE_PRESETS[prev.generation_type].description ? preset.description : prev.description,
      icon: prev.icon === TYPE_PRESETS[prev.generation_type].icon ? preset.icon : prev.icon,
      placeholder: preset.placeholder,
      help: preset.help,
      creative_scenes: normalizeScenes(prev.generation_type === type ? prev.creative_scenes : defaultScenes(type), type),
      ...preset.defaults,
      preset_override: undefined,
    }));
  };

  const selectedDialogueModels = useMemo(
    () => form.dialogue_model_codes.split(",").map((item) => item.trim()).filter(Boolean),
    [form.dialogue_model_codes]
  );
  const setDialogueModels = (codes: string[]) => {
    const available = new Set(chatModels.map((model) => model.code));
    const normalized = Array.from(new Set(codes.map((code) => code.trim()).filter((code) => code && available.has(code))));
    setForm((prev) => ({ ...prev, dialogue_model_codes: normalized.join(",") }));
  };
  const setDialoguePrimary = (code: string) => {
    setDialogueModels(code ? [code, ...selectedDialogueModels.filter((item) => item !== code)] : []);
  };
  const toggleDialogueFallback = (code: string, checked: boolean) => {
    const primary = selectedDialogueModels[0] || "";
    const fallbacks = selectedDialogueModels.slice(1).filter((item) => item !== code);
    setDialogueModels([primary, ...(checked ? [...fallbacks, code] : fallbacks)].filter(Boolean));
  };

  const openCreate = () => {
    setForm(makeEmptyForm());
    setErr("");
    setShowForm(true);
  };

  const openEdit = (w: Workflow) => {
    const runtime = w.runtime_config || {};
    const type = typeFromRuntime(runtime, w.category);
    const preset = TYPE_PRESETS[type];
    const systemWorkspace = runtime.system_workspace === true || runtime.agent_mode === "infinite_canvas";
    const inputCaps = runtime.input_capabilities || {};
    const flow = runtime.flow_options || {};
    const display = w.display_config || {};
    const input = (display.input || {}) as Record<string, any>;
    setForm({
      ...makeEmptyForm(),
      isEdit: true,
      system_workspace: systemWorkspace,
      code: w.code,
      name: w.name,
      description: w.description || preset.description,
      icon: w.icon || preset.icon,
      sort_order: Number(w.sort_order || 0),
      is_enabled: w.is_enabled,
      generation_type: type,
      quality_model_code: runtime.quality_model_code || "",
      image_concurrency: Number(runtime.image_concurrency || 3),
      video_concurrency: Number(runtime.video_concurrency || 2),
      prompt_enhance_model_code: runtime.prompt_enhance_model_code || "",
      analysis_model_code: runtime.analysis_model_code || "",
      fallback_model_code: runtime.fallback_model_code || "",
      generation_model_code: runtime.generation_model_code || "",
      image_model_code: runtime.image_model_code || (systemWorkspace ? "" : "image_fast_v1"),
      video_model_code: runtime.video_model_code || runtime.generation_model_code || (systemWorkspace ? "" : "video_demo_v1"),
      speech_model_code: runtime.speech_model_code || "",
      music_model_code: runtime.music_model_code || "",
      narration_model_code: runtime.audio_model_code || runtime.narration_model_code || "",
      default_segment_count: Number(runtime.default_segment_count || 4),
      default_segment_duration: Number(runtime.default_segment_duration || 8),
      default_story_review_required: runtime.default_story_review_required !== false,
      audio_strategy: runtime.audio_strategy === "video_native" || runtime.audio_strategy === "tts_only" || runtime.audio_strategy === "hybrid"
        ? runtime.audio_strategy
        : runtime.narration_model_code ? "hybrid" : "video_native",
      dialogue_model_codes: Array.isArray(runtime.dialogue_model_codes) ? runtime.dialogue_model_codes.join(",") : runtime.analysis_model_code || "chat_demo_v1",
      style_reference_mode: runtime.style_reference_mode || "image_reference",
      duration_mode: runtime.duration_mode || "standard",
      storyboard_grid: Number(runtime.storyboard_grid || 6),
      max_retry: Number(runtime.max_retry || 2),
      asset_consistency_score: Number(runtime.asset_consistency_score || 80),
      logic_score: Number(runtime.logic_score || 50),
      orientation: runtime.orientation || "landscape",
      quality: runtime.quality || "480P",
      supported_resolutions: Array.isArray(runtime.supported_resolutions) && runtime.supported_resolutions.length ? runtime.supported_resolutions : ["720P", "1K", "2K"],
      default_target_resolution: runtime.default_target_resolution || "720P",
      preserve_audio: runtime.preserve_audio !== false,
      default_enhancement_mode: runtime.default_enhancement_mode || "balanced",
      max_input_duration_sec: Number(runtime.max_input_duration_sec || 300),
      max_input_size_mb: Number(runtime.max_input_size_mb || 500),
      upscale_operation: runtime.upscale_operation || "upscale",
      upscale_prompt: runtime.upscale_prompt || "Enhance the source video to the requested resolution. Preserve the original content, timing, composition, identity, motion and audio. Reduce compression artifacts and noise, recover natural detail, and avoid changing the scene.",
      default_style_strength: Number(runtime.default_style_strength ?? 0.65),
      preserve_motion: runtime.preserve_motion !== false,
      preserve_identity: runtime.preserve_identity !== false,
      redraw_operation: runtime.redraw_operation || "video_redraw",
      redraw_prompt: runtime.redraw_prompt || "Redraw the source video in the requested visual style while preserving timing, motion, composition, subject identity and scene continuity. Avoid flicker and temporal inconsistency.",
      default_subtitle_mode: runtime.default_subtitle_mode || "auto",
      default_subtitle_region: runtime.default_subtitle_region || "bottom_25",
      protect_watermark: runtime.protect_watermark !== false,
      subtitle_remove_operation: runtime.subtitle_remove_operation || "subtitle_remove",
      subtitle_remove_prompt: runtime.subtitle_remove_prompt || "Remove burned-in subtitles from the selected region and naturally reconstruct the background. Preserve people, products, logos, watermarks outside the subtitle region, motion, timing and audio.",
      require_image: runtime.require_image !== false,
      allow_text_only: readBool(inputCaps, "allow_text_only", preset.defaults.allow_text_only),
      support_reference_image: readBool(inputCaps, "support_reference_image", preset.defaults.support_reference_image),
      support_multiple_references: readBool(inputCaps, "support_multiple_references", preset.defaults.support_multiple_references),
      support_first_last_frame: readBool(inputCaps, "support_first_last_frame", preset.defaults.support_first_last_frame),
      enable_step_confirm: readBool(flow, "enable_step_confirm", true),
      enable_autopilot: readBool(flow, "enable_autopilot", true),
      allow_prompt_edit: readBool(flow, "allow_prompt_edit", true),
      default_count: Number(runtime.default_count || 1),
      candidate_count: Number(runtime.candidate_count || 3),
      creative_scenes: normalizeScenes(runtime.creative_scenes || runtime.output_scenes, type),
      unit_price: Number(w.price_rule?.unit_price || 0),
      placeholder: String(input.placeholder || preset.placeholder),
      help: String(display.help || preset.help),
      canvas_templates: Array.isArray(display.canvas_templates)
        ? display.canvas_templates.map((item: any, index: number) => ({
            id: String(item?.id || `template-${index + 1}`),
            name: String(item?.name || `模板 ${index + 1}`),
            description: String(item?.description || ""),
            template_id: String(item?.template_id || item?.id || "text-image"),
            ...(item?.document && typeof item.document === "object" ? { document: item.document } : {}),
          }))
        : DEFAULT_CANVAS_TEMPLATES.map((item) => ({ ...item })),
      default_product_review_mode: runtime.default_review_mode === "strict" ? "strict" : "standard",
      product_category_rules_json: JSON.stringify(runtime.product_category_rules || DEFAULT_PRODUCT_CATEGORY_RULES, null, 2),
      product_operation_rules_json: JSON.stringify(runtime.product_operation_rules || DEFAULT_PRODUCT_OPERATION_RULES, null, 2),
      preset_override: runtime.system_workspace === true || runtime.agent_mode === "infinite_canvas" || runtime.agent_mode === "novel_workshop"
        ? {
            display_config: w.display_config || {},
            runtime_config: runtime,
            input_schema: w.input_schema || {},
            nodes: w.nodes || [],
            price_rule: w.price_rule || {},
          }
        : undefined,
    });
    setErr("");
    setShowForm(true);
    window.setTimeout(() => {
      document.getElementById(`agent-edit-panel-${w.code}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const openJson = () => {
    const bundle = mergedPresetBundle(form);
    const value = form.system_workspace
      ? { ...bundle, display_config: { ...bundle.display_config, canvas_templates: form.canvas_templates } }
      : bundle;
    setJsonDraft(JSON.stringify(value, null, 2));
    setJsonErr("");
    setJsonOpen(true);
  };

  const uploadAgentIcon = async (file?: File) => {
    if (!file) return;
    setIconUploading(true);
    setErr("");
    try {
      const url = await adminUploadFile(file);
      setForm((prev) => ({ ...prev, icon: url }));
    } catch (error) {
      setErr(error instanceof Error ? error.message : "图标上传失败");
    } finally {
      setIconUploading(false);
    }
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as Partial<PresetBundle>;
      const allowed = ["display_config", "runtime_config", "input_schema", "nodes", "price_rule"];
      const override: Partial<PresetBundle> = {};
      for (const key of allowed) {
        if (key in parsed) (override as any)[key] = (parsed as any)[key];
      }
      setForm((prev) => ({
        ...prev,
        preset_override: override,
        ...(prev.system_workspace && Array.isArray((parsed.display_config as any)?.canvas_templates)
          ? {
              canvas_templates: (parsed.display_config as any).canvas_templates.map((item: any, index: number) => ({
                id: String(item?.id || `template-${index + 1}`),
                name: String(item?.name || `模板 ${index + 1}`),
                description: String(item?.description || ""),
                template_id: String(item?.template_id || item?.id || "text-image"),
                ...(item?.document && typeof item.document === "object" ? { document: item.document } : {}),
              })),
            }
          : {}),
      }));
      setJsonOpen(false);
    } catch (e) {
      setJsonErr(e instanceof Error ? e.message : "JSON 格式错误");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!form.system_workspace && form.generation_type === "comic_drama" && (!form.analysis_model_code || !form.image_model_code || !form.video_model_code)) {
      setErr("请选择分析模型、图片模型和视频模型");
      return;
    }
    if (!form.system_workspace && form.generation_type === "comic_drama" && form.audio_strategy !== "video_native" && !form.narration_model_code) {
      setErr("当前配音策略需要选择一个对白与旁白配音模型");
      return;
    }
    if (!form.system_workspace && (form.generation_type === "video_upscale" || form.generation_type === "video_redraw") && !form.generation_model_code) {
      setErr(form.generation_type === "video_upscale" ? "请选择支持视频转视频/超分的模型" : "请选择支持视频转视频/风格转绘的模型");
      return;
    }
    if (!form.system_workspace && form.generation_type === "subtitle_remove" && form.default_subtitle_mode === "hardcoded_ai" && !form.generation_model_code) {
      setErr("硬字幕 AI 修复模式必须选择去字幕/视频修复模型");
      return;
    }
    if (!form.system_workspace && form.generation_type === "creative_agent" && (!form.analysis_model_code || !form.image_model_code || !form.video_model_code || !form.speech_model_code || !form.music_model_code)) {
      setErr("通用智能体需要选择主聊天、图片、视频、语音和音乐模型");
      return;
    }
    if (!form.system_workspace && form.generation_type !== "creative_agent" && form.generation_type !== "comic_drama" && form.generation_type !== "virtual_try_on" && !isVideoUtilityType(form.generation_type) && (!form.analysis_model_code || !form.generation_model_code)) {
      setErr("请选择分析模型和生成模型");
      return;
    }
    if (!form.system_workspace && form.generation_type === "virtual_try_on" && !form.generation_model_code) {
      setErr("请选择支持双参考图的图片模型");
      return;
    }
    const originalBundle = mergedPresetBundle(form);
    const bundle = form.system_workspace
      ? {
          ...originalBundle,
          display_config: {
            ...originalBundle.display_config,
            canvas_templates: form.canvas_templates.map((item) => ({
              id: item.id.trim(),
              name: item.name.trim(),
              description: item.description.trim(),
              template_id: item.template_id,
              ...(item.document ? { document: item.document } : {}),
            })).filter((item) => item.id && item.name),
          },
        }
      : originalBundle;
    const imageCountSchema = bundle.input_schema.image_count;
    const inputSchema = form.code === "content_image_post"
      ? {
          ...bundle.input_schema,
          image_count: {
            ...(typeof imageCountSchema === "object" && imageCountSchema !== null ? imageCountSchema : {}),
            default: Number(form.default_count) || 4,
          },
        }
      : bundle.input_schema;
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
      icon: form.icon.trim(),
      category: form.generation_type === "creative_agent" ? "chat" : form.generation_type === "comic_drama" || isVideoUtilityType(form.generation_type) ? "video" : form.generation_type === "photo_studio" || form.generation_type === "virtual_try_on" ? "workflow" : form.generation_type,
      sort_order: Number(form.sort_order) || 0,
      is_enabled: form.is_enabled,
      agent_mode: form.system_workspace
        ? form.code === "content_image_post" ? "simple_pipeline" : "infinite_canvas"
        : form.generation_type === "creative_agent" ? "creative_chat" : form.generation_type === "comic_drama" ? "comic_drama" : form.generation_type === "novel_workshop" ? "novel_workshop" : form.generation_type === "photo_studio" ? "photo_studio" : form.generation_type === "virtual_try_on" ? "virtual_try_on" : isVideoUtilityType(form.generation_type) ? form.generation_type : "simple_pipeline",
      quality_model_code: form.quality_model_code,
      image_concurrency: form.image_concurrency,
      video_concurrency: form.video_concurrency,
      analysis_model_code: form.analysis_model_code,
      generation_model_code: form.generation_type === "comic_drama" ? form.video_model_code : form.generation_type === "creative_agent" ? form.image_model_code : form.generation_model_code,
      generation_type: form.generation_type === "comic_drama" || isVideoUtilityType(form.generation_type) ? "video" : form.generation_type === "photo_studio" || form.generation_type === "virtual_try_on" ? "image" : form.generation_type,
      preset_code: presetCode(form.generation_type),
      require_image: form.require_image,
      default_count: Number(form.default_count) || 1,
      candidate_count: Number(form.candidate_count) || 3,
      creative_scenes: normalizeScenes(form.creative_scenes, form.generation_type),
      allow_text_only: form.allow_text_only,
      support_reference_image: form.support_reference_image,
      support_multiple_references: form.support_multiple_references,
      support_first_last_frame: form.support_first_last_frame,
      enable_step_confirm: form.enable_step_confirm,
      enable_autopilot: form.enable_autopilot,
      allow_prompt_edit: form.allow_prompt_edit,
      nodes: bundle.nodes,
      input_schema: inputSchema,
      price_rule: form.generation_type === "creative_agent" || form.generation_type === "novel_workshop" || form.generation_type === "photo_studio" || form.generation_type === "virtual_try_on"
        ? { billing_type: "model_actual", unit_price: form.generation_type === "creative_agent" ? 0 : Number(form.unit_price) || 0 }
        : bundle.price_rule,
      display_config: bundle.display_config,
      runtime_config: form.system_workspace
        ? {
          ...bundle.runtime_config,
          prompt_enhance_model_code: form.prompt_enhance_model_code,
          quality_model_code: form.quality_model_code,
          image_concurrency: form.image_concurrency,
          video_concurrency: form.video_concurrency,
          agent_mode: form.code === "content_image_post" ? "simple_pipeline" : "infinite_canvas",
          system_workspace: true,
          ...(["one_click_viral_remake", "viral_remake", "video_remake", "video_creation", "video_creation_v2"].includes(form.code) ? {
            analysis_model_code: form.analysis_model_code,
            image_model_code: form.image_model_code,
            video_model_code: form.video_model_code,
          } : {}),
          ...(form.code === "content_image_post" ? {
            analysis_model_code: form.analysis_model_code,
            generation_model_code: form.generation_model_code,
            default_count: Number(form.default_count) || 4,
          } : {}),
          ...(["video_creation", "video_creation_v2"].includes(form.code) ? {
            audio_model_code: form.narration_model_code,
            default_segment_count: form.default_segment_count,
            default_segment_duration: form.default_segment_duration,
            default_story_review_required: form.default_story_review_required,
          } : {}),
        }
        : form.generation_type === "comic_drama"
        ? bundle.runtime_config
        : form.generation_type === "novel_workshop"
        ? { ...bundle.runtime_config, analysis_model_code: form.analysis_model_code, generation_model_code: form.generation_model_code }
        : form.generation_type === "photo_studio"
        ? { ...bundle.runtime_config, analysis_model_code: form.analysis_model_code, generation_model_code: form.generation_model_code, default_count: Number(form.default_count) || 1 }
        : form.generation_type === "virtual_try_on"
        ? { ...bundle.runtime_config, generation_model_code: form.generation_model_code, default_count: Number(form.default_count) || 1 }
         : form.generation_type === "creative_agent"
         ? { ...bundle.runtime_config, agent_mode: "creative_chat", generation_type: "mixed", preset_code: "general_creative_agent", analysis_model_code: form.analysis_model_code, fallback_model_code: form.fallback_model_code, image_model_code: form.image_model_code, video_model_code: form.video_model_code, speech_model_code: form.speech_model_code, music_model_code: form.music_model_code, generation_model_code: form.image_model_code }
         : { ...bundle.runtime_config, creative_scenes: normalizeScenes((bundle.runtime_config as any)?.creative_scenes || form.creative_scenes, form.generation_type), output_scenes: undefined },
    };
    try {
      if (form.code === "product_refine") {
        payload.runtime_config = runtimeConfig(form);
        payload.price_rule = { billing_type: "model_actual", unit_price: Math.max(0, Number(form.unit_price) || 0) };
      }
      await adminApi(form.isEdit ? `/agents/${form.code}` : "/agents", {
        method: form.isEdit ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      setShowForm(false);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "保存失败");
    }
  };

  const toggle = async (code: string, enabled: boolean) => {
    await adminApi(`/agents/${code}`, { method: "PATCH", body: JSON.stringify({ is_enabled: enabled }) });
    load();
  };

  const remove = async (w: Workflow) => {
    if (!confirm(`确认删除智能体「${w.name}」？`)) return;
    await adminApi(`/agents/${w.code}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">智能体管理</h1>
          <p className="mt-1 text-sm text-gray-500">通过类型、模型和场景勾选创建智能体，复杂预设可在 JSON 弹窗中备用调整。</p>
        </div>
        <button onClick={openCreate} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-dark shadow-sm">
          <Plus size={16} />新增智能体
        </button>
      </div>

      {showForm && (() => {
        const editor = (
        <form onSubmit={submit} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div>
              <h2 className="font-semibold text-gray-950">{form.system_workspace ? "管理工作流" : form.isEdit ? "编辑智能体" : "新增智能体"}</h2>
              <p className="mt-0.5 text-xs text-gray-400">{form.system_workspace ? "管理工作流展示、默认模型和画布模板。" : "常规配置只需选择类型和勾选场景，JSON 预设用于高级备用。"}</p>
            </div>
            <button type="button" onClick={() => setShowForm(false)} className="h-9 rounded-xl px-3 text-sm text-gray-400 hover:text-gray-700">取消</button>
          </div>

          <div className="grid gap-6 p-6 xl:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              {!form.system_workspace && <section className="rounded-2xl border border-gray-100 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900"><Sparkles size={16} />选择智能体类型</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {(["image", "video", "video_upscale", "video_redraw", "subtitle_remove", "comic_drama", "novel_workshop", "photo_studio", "virtual_try_on"] as GenerationType[]).map((type) => {
                    const preset = TYPE_PRESETS[type];
                    const active = form.generation_type === type;
                    return (
                      <button
                        type="button"
                        key={type}
                        onClick={() => setType(type)}
                        className={`rounded-2xl border p-4 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-gray-100 bg-gray-50 hover:border-gray-200 hover:bg-white"}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{preset.icon}</span>
                            <span className="font-semibold text-gray-900">{preset.label}</span>
                          </div>
                          {active && <Check size={16} className="text-primary" />}
                        </div>
                        <p className="mt-2 text-xs leading-5 text-gray-500">{preset.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>}

              <section className="grid gap-4 rounded-2xl border border-gray-100 p-4 md:grid-cols-2">
                <div className="md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-900"><Bot size={16} />基础信息</div>
                <Field label="编码"><input className="admin-input" value={form.code} disabled={form.isEdit} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></Field>
                <Field label="名称"><input className="admin-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
                <Field label={form.system_workspace ? "工作流图标" : "智能体图标"} wide>
                  <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gray-900 text-2xl text-white shadow-sm">
                      <AgentIconValue value={form.icon} fallback={activePreset.icon} alt={form.name || activePreset.label} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-2">
                        <label className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-dark transition active:scale-[.98] ${iconUploading ? "pointer-events-none opacity-60" : ""}`}>
                          {iconUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                          {iconUploading ? "上传中" : "上传图片"}
                          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={iconUploading} onChange={(e) => { void uploadAgentIcon(e.target.files?.[0]); e.currentTarget.value = ""; }} />
                        </label>
                        <button type="button" onClick={() => setForm((prev) => ({ ...prev, icon: activePreset.icon }))} className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-600 transition hover:bg-gray-50 active:scale-[.98]">恢复默认</button>
                      </div>
                      {!isImageIcon(form.icon) && <input aria-label="字符图标" maxLength={8} className="admin-input mt-2 max-w-32 bg-white text-center text-lg" value={form.icon} onChange={(e) => setForm((prev) => ({ ...prev, icon: e.target.value }))} />}
                      <p className="mt-2 text-[11px] leading-5 text-gray-500">推荐 200×200 像素、1:1 方图，PNG 或 WebP，建议控制在 1MB 内。不上传时使用当前类型的默认图标。</p>
                    </div>
                  </div>
                </Field>
                <Field label="状态"><label className="flex h-10 items-center gap-2 rounded-xl border border-gray-100 px-3 text-sm"><input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} />启用{form.system_workspace ? "工作流" : "智能体"}</label></Field>
                <Field label="描述" wide><input className="admin-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                <Field label="排序"><input type="number" className="admin-input" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })} /></Field>
              </section>

              {(form.system_workspace || form.generation_type === "comic_drama") && <section className="grid gap-3 rounded-2xl border border-cyan-100 p-4 md:grid-cols-3">
                <Field label="视觉一致性验收模型"><select className="admin-input" value={form.quality_model_code} onChange={e => setForm({ ...form, quality_model_code: e.target.value })}><option value="">未配置（明确标记未检查）</option>{chatModels.map(m => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select><p className="mt-1 text-xs text-gray-500">请选择支持图片理解的模型。验收使用真实图片并按模型计费。</p></Field>
                <Field label="图片并发上限"><input className="admin-input" type="number" min={1} max={6} value={form.image_concurrency} onChange={e => setForm({ ...form, image_concurrency: Math.max(1, Math.min(6, Number(e.target.value) || 3)) })} /></Field>
                <Field label="视频并发上限"><input className="admin-input" type="number" min={1} max={4} value={form.video_concurrency} onChange={e => setForm({ ...form, video_concurrency: Math.max(1, Math.min(4, Number(e.target.value) || 2)) })} /></Field>
              </section>}

              {form.system_workspace && (
                <section className="rounded-2xl border border-cyan-100 bg-cyan-50/50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-cyan-800"><Layers size={16} />无限画布模板管理</div>
                  <Field label="提示词增强模型"><select className="admin-input" value={form.prompt_enhance_model_code} onChange={e => setForm({ ...form, prompt_enhance_model_code: e.target.value })}><option value="">使用工作流分析模型 / Agent 主聊天模型</option>{chatModels.map(m => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select></Field>
                  <p className="mt-2 text-xs leading-5 text-cyan-700">
                    可直接管理前台“导入画布”中的模板。内置类型会由前端创建标准节点；完整自定义节点画布仍可通过下方高级 JSON 的 document 配置。
                  </p>
                  {["content_image_post", "one_click_viral_remake", "viral_remake", "video_remake", "video_creation", "video_creation_v2"].includes(form.code) && <div className="mt-4 grid gap-3 rounded-xl border border-cyan-100 bg-white p-3 md:grid-cols-4">
                    <Field label={form.code === "content_image_post" ? "默认内容分析模型" : "默认分析与改写模型"}>
                      <select className="admin-input" value={form.analysis_model_code} onChange={(e) => setForm({ ...form, analysis_model_code: e.target.value })}>
                        <option value="">自动选择</option>
                        {chatModels.filter((model) => !/multi.?collab|多模型协作/i.test(`${model.code} ${model.display_name}`)).map((model) => <option key={model.code} value={model.code}>{model.display_name} / {model.code}</option>)}
                      </select>
                    </Field>
                    <Field label={form.code === "content_image_post" ? "默认配图模型" : "默认关键帧图片模型"}>
                      <select className="admin-input" value={form.code === "content_image_post" ? form.generation_model_code : form.image_model_code} onChange={(e) => setForm(form.code === "content_image_post" ? { ...form, generation_model_code: e.target.value } : { ...form, image_model_code: e.target.value })}>
                        <option value="">自动选择</option>
                        {imageModels.map((model) => <option key={model.code} value={model.code}>{model.display_name} / {model.code}</option>)}
                      </select>
                    </Field>
                    {form.code !== "content_image_post" && <Field label="默认视频片段模型">
                      <select className="admin-input" value={form.video_model_code} onChange={(e) => setForm({ ...form, video_model_code: e.target.value })}>
                        <option value="">自动选择</option>
                        {videoModels.map((model) => <option key={model.code} value={model.code}>{model.display_name} / {model.code}</option>)}
                      </select>
                    </Field>}
                    {form.code === "content_image_post" && <Field label="默认配图数量">
                      <select className="admin-input" value={form.default_count} onChange={(e) => setForm({ ...form, default_count: Number(e.target.value) })}>
                        {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 张配图</option>)}
                      </select>
                    </Field>}
                    {["video_creation", "video_creation_v2"].includes(form.code) && <Field label="默认配音模型">
                      <select className="admin-input" value={form.narration_model_code} onChange={(e) => setForm({ ...form, narration_model_code: e.target.value })}>
                        <option value="">自动选择</option>
                        {audioModels.map((model) => <option key={model.code} value={model.code}>{model.display_name} / {model.code}</option>)}
                      </select>
                    </Field>}
                    {["video_creation", "video_creation_v2"].includes(form.code) && <>
                      <Field label="默认视频片段数">
                        <select className="admin-input" value={form.default_segment_count} onChange={(e) => setForm({ ...form, default_segment_count: Number(e.target.value) })}>
                          {[1, 2, 3, 4, 6, 8].map((count) => <option key={count} value={count}>{count} 个片段</option>)}
                        </select>
                      </Field>
                      <Field label="默认模型单段素材时长（秒）"><input type="number" min={1} max={600} step={0.5} className="admin-input" value={form.default_segment_duration} onChange={(e) => setForm({ ...form, default_segment_duration: Math.max(1, Number(e.target.value) || 8) })} /><p className="mt-1 text-xs text-gray-500">成片总时长由用户设定；系统按该素材时长自动计算片段数并裁切末段。</p></Field>
                      <Field label="默认确认方式"><label className="flex h-10 items-center gap-2 rounded-xl border border-gray-100 px-3 text-sm"><input type="checkbox" checked={form.default_story_review_required} onChange={(e) => setForm({ ...form, default_story_review_required: e.target.checked })} />生成媒体前确认分镜</label></Field>
                    </>}
                    <p className="text-[11px] leading-5 text-cyan-700 md:col-span-4">这里设置新建画布的默认模型；前台仍可在每次任务中选择其他已启用模型。未声明所需能力的模型仍可选择，但上游不支持对应输入时生成会失败。</p>
                  </div>}
                  <div className="mt-4 space-y-3">
                    {form.canvas_templates.map((template, index) => (
                      <div key={`${template.id}-${index}`} className="grid gap-2 rounded-xl border border-cyan-100 bg-white p-3 md:grid-cols-[150px_1fr_170px_auto]">
                        <input value={template.name} onChange={(e) => setForm((prev) => ({ ...prev, canvas_templates: prev.canvas_templates.map((item, itemIndex) => itemIndex === index ? { ...item, name: e.target.value } : item) }))} placeholder="模板名称" className="admin-input" />
                        <input value={template.description} onChange={(e) => setForm((prev) => ({ ...prev, canvas_templates: prev.canvas_templates.map((item, itemIndex) => itemIndex === index ? { ...item, description: e.target.value } : item) }))} placeholder="模板说明" className="admin-input" />
                        <select value={template.template_id} onChange={(e) => setForm((prev) => ({ ...prev, canvas_templates: prev.canvas_templates.map((item, itemIndex) => itemIndex === index ? { ...item, template_id: e.target.value } : item) }))} className="admin-input">
                          {DEFAULT_CANVAS_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <button type="button" onClick={() => setForm((prev) => ({ ...prev, canvas_templates: prev.canvas_templates.filter((_, itemIndex) => itemIndex !== index) }))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-100 text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setForm((prev) => ({
                      ...prev,
                      canvas_templates: [...prev.canvas_templates, {
                        id: `template-${Date.now()}`,
                        name: `新模板 ${prev.canvas_templates.length + 1}`,
                        description: "",
                        template_id: "text-image",
                      }],
                    }))} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-cyan-200 bg-white px-3 text-xs font-medium text-cyan-700 hover:bg-cyan-50"><Plus size={14} />新增模板</button>
                  </div>
                </section>
              )}

              {form.isEdit && form.code === "general_creative_agent" && <AgentPolicyEditor />}
              {!form.system_workspace && <section className="grid gap-4 rounded-2xl border border-gray-100 p-4 md:grid-cols-2">
                <div className="md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-900"><Settings2 size={16} />模型与计费</div>
                {form.code === "product_refine" && <Field label="商品细节验收模型（必填）"><select className="admin-input" value={form.quality_model_code} onChange={e => setForm({ ...form, quality_model_code: e.target.value })}><option value="">请选择可读图的模型</option>{chatModels.map(m => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select><p className="mt-1 text-xs text-gray-500">编辑模型必须使用支持多图和蒙版的 OpenAI Images 线路；其他线路不会降级成整图重绘。</p></Field>}
                {form.code === "product_refine" && <Field label="默认验收强度"><select className="admin-input" value={form.default_product_review_mode} onChange={e => setForm({ ...form, default_product_review_mode: e.target.value === "strict" ? "strict" : "standard" })}><option value="standard">标准 · 定位后验收</option><option value="strict">严格 · 再做一次独立复核</option></select><p className="mt-1 text-xs text-gray-500">用户仍可在高级设置中按任务切换。</p></Field>}
                {form.code === "product_refine" && <div className="md:col-span-2"><Field label="商品品类专项规则（JSON）"><textarea className="admin-input min-h-52 font-mono text-xs leading-5" value={form.product_category_rules_json} onChange={e => setForm({ ...form, product_category_rules_json: e.target.value })} /><p className="mt-1 text-xs text-gray-500">键为商品类别，值为该品类必须执行的结构与交互验收规则。JSON 无效时不会写入规则。</p></Field></div>}
                {form.code === "product_refine" && <div className="md:col-span-2"><Field label="商品展示方式补充规则（JSON）"><textarea className="admin-input min-h-44 font-mono text-xs leading-5" value={form.product_operation_rules_json} onChange={e => setForm({ ...form, product_operation_rules_json: e.target.value })} /><p className="mt-1 text-xs text-gray-500">键为 auto_showcase、local_repair、wear、hold_use、background、detail 或 custom。规则只补充用户未说明的内容，用户明确要求始终优先。</p></Field></div>}
                {!isVideoUtilityType(form.generation_type) && form.generation_type !== "virtual_try_on" && <Field label={form.generation_type === "creative_agent" ? "Agent 主聊天模型" : "分析大模型"}><select className="admin-input" value={form.analysis_model_code} onChange={(e) => setForm({ ...form, analysis_model_code: e.target.value })}><option value="">请选择{form.generation_type === "creative_agent" ? "主聊天" : "分析"}模型</option>{chatModels.filter((m) => !/multi.?collab|多模型协作/i.test(`${m.code} ${m.display_name}`)).map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select>{form.generation_type === "creative_agent" && <p className="mt-1.5 text-[11px] leading-5 text-gray-400">Agent 会使用此模型理解需求、判断图片或视频意图，并生成执行计划。</p>}</Field>}
                {form.generation_type === "creative_agent" ? (
                  <>
                    <Field label="Agent 备用聊天模型"><select className="admin-input" value={form.fallback_model_code} onChange={(e) => setForm({ ...form, fallback_model_code: e.target.value })}><option value="">不自动切换</option>{chatModels.filter((m) => m.code !== form.analysis_model_code && !/multi.?collab|多模型协作/i.test(`${m.code} ${m.display_name}`)).map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select><p className="mt-1.5 text-[11px] leading-5 text-gray-400">主模型在输出正文前被服务商内容审核终止时，只自动切换一次；失败请求不会重复扣费。深度思考请求的备用模型也必须支持思考开关。</p></Field>
                    <Field label="Agent 图片生成模型"><select className="admin-input" value={form.image_model_code} onChange={(e) => setForm({ ...form, image_model_code: e.target.value })}><option value="">请选择图片模型</option>{imageModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select></Field>
                    <Field label="Agent 视频生成模型"><select className="admin-input" value={form.video_model_code} onChange={(e) => setForm({ ...form, video_model_code: e.target.value })}><option value="">请选择视频模型</option>{videoModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select></Field>
                    <Field label="Agent 文本转语音模型"><select className="admin-input" value={form.speech_model_code} onChange={(e) => setForm({ ...form, speech_model_code: e.target.value })}><option value="">请选择语音模型</option>{audioModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select></Field>
                    <Field label="Agent 歌曲音乐模型"><select className="admin-input" value={form.music_model_code} onChange={(e) => setForm({ ...form, music_model_code: e.target.value })}><option value="">请选择音乐模型</option>{musicModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select></Field>
                  </>
                ) : form.generation_type !== "comic_drama" && form.generation_type !== "novel_workshop" && (
                  <Field label={form.code === "product_refine" ? "商品编辑模型" : form.generation_type === "video_upscale" ? "视频超分模型" : form.generation_type === "video_redraw" ? "视频转绘模型" : form.generation_type === "subtitle_remove" ? "硬字幕 AI 修复模型（可选）" : form.generation_type === "video" ? "视频生成模型" : "图片生成模型"}>
                    <select className="admin-input" value={form.generation_model_code} onChange={(e) => setForm({ ...form, generation_model_code: e.target.value })}>
                      <option value="">{form.generation_type === "subtitle_remove" ? "不配置（仅支持独立字幕轨）" : "请选择生成模型"}</option>{generationModels.map((m) => {
                        const rule = m.runtime_rule || {};
                        const capability = form.generation_type === "video_upscale" ? "video_upscale" : form.generation_type === "video_redraw" ? "video_redraw" : form.generation_type === "subtitle_remove" ? "subtitle_remove" : "";
                        const pattern = capability === "video_upscale" ? /upscale|super_resolution|video_enhance/i : capability === "video_redraw" ? /video_redraw|video-to-video|stylize|style_transfer|转绘/i : /subtitle_remove|inpaint|remove_subtitle|去字幕/i;
                        const declared = !capability || rule?.capabilities?.[capability] === true || pattern.test(JSON.stringify(rule));
                        return <option key={m.code} value={m.code}>{m.display_name} / {m.code}{capability && !declared ? `（未声明${form.generation_type === "video_upscale" ? "超分" : form.generation_type === "video_redraw" ? "转绘" : "去字幕"}能力）` : ""}</option>;
                      })}
                    </select>
                    {form.code === "product_refine" && <p className="mt-1.5 text-[11px] leading-5 text-gray-500">可在 GPT Image 2 与 GPT Image 2.5 兼容模型间切换。模型必须配置 OpenAI Images 蒙版编辑线路；前端会读取模型的比例、质量选项和默认参数。</p>}
                    {form.generation_type === "video_upscale" && <p className="mt-1.5 text-[11px] leading-5 text-amber-600">必须选择上游真正支持视频转视频/超分的模型；普通文生视频模型不会自动获得超分能力。请求会携带 operation=upscale、源视频和目标清晰度。</p>}
                    {form.generation_type === "video_redraw" && <p className="mt-1.5 text-[11px] leading-5 text-amber-600">必须选择真正支持 video-to-video/风格迁移的上游模型；系统会发送源视频、可选风格参考图、强度与一致性参数。</p>}
                    {form.generation_type === "subtitle_remove" && <p className="mt-1.5 text-[11px] leading-5 text-amber-600">独立字幕轨由 Worker 使用 FFmpeg 无损移除，不产生模型费用；烧录在画面里的硬字幕必须配置支持局部修复/去字幕的模型。</p>}
                  </Field>
                )}
                {form.generation_type === "comic_drama" && (
                  <>
                    <Field label="关键帧图片模型"><select className="admin-input" value={form.image_model_code} onChange={(e) => setForm({ ...form, image_model_code: e.target.value })}><option value="">请选择图片模型</option>{imageModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select></Field>
                    <Field label="分段视频模型"><select className="admin-input" value={form.video_model_code} onChange={(e) => setForm({ ...form, video_model_code: e.target.value, generation_model_code: e.target.value })}><option value="">请选择视频模型</option>{videoModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select></Field>
                    <Field label="对白与旁白配音模型">
                      <select className="admin-input" value={form.narration_model_code} onChange={(e) => setForm({ ...form, narration_model_code: e.target.value })}>
                        <option value="">请选择语音合成模型</option>
                        {audioModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}
                      </select>
                      <p className="mt-1.5 text-[11px] text-gray-400">只列出语音合成/克隆模型，不显示音乐生成模型。独立配音按每个分镜对白调用并计费。</p>
                    </Field>
                    <Field label="音频与对白策略">
                      <select className="admin-input" value={form.audio_strategy} onChange={(e) => setForm({ ...form, audio_strategy: e.target.value as FormState["audio_strategy"] })}>
                        <option value="hybrid">原生环境音 + 独立 TTS 配音（推荐）</option>
                        <option value="video_native">仅视频模型原生对白/音效</option>
                        <option value="tts_only">仅独立 TTS 配音</option>
                      </select>
                      <p className="mt-1.5 text-[11px] text-gray-400">Seedance 2.0 原生模式会把分镜对白写入视频提示词；混合模式只让视频模型生成环境音，再叠加所选 TTS，避免双重人声。</p>
                    </Field>
                    <Field label="剧本/对白主模型" wide>
                      <select className="admin-input" value={selectedDialogueModels[0] || ""} onChange={(e) => setDialoguePrimary(e.target.value)}>
                        <option value="">跟随分析大模型</option>
                        {chatModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}
                      </select>
                    </Field>
                    <Field label="备用对话模型（按勾选顺序切换）" wide>
                      <div className="grid max-h-44 gap-2 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3 md:grid-cols-2">
                        {chatModels.filter((m) => m.code !== selectedDialogueModels[0]).map((m) => {
                          const checked = selectedDialogueModels.slice(1).includes(m.code);
                          return (
                            <label key={m.code} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${checked ? "border-primary bg-white text-gray-900" : "border-transparent text-gray-500 hover:bg-white"}`}>
                              <input type="checkbox" checked={checked} onChange={(e) => toggleDialogueFallback(m.code, e.target.checked)} />
                              <span className="min-w-0 truncate">{m.display_name} / {m.code}</span>
                            </label>
                          );
                        })}
                        {chatModels.length <= 1 && <p className="text-xs text-gray-400">暂无其他可用对话模型</p>}
                      </div>
                      <p className="mt-1.5 text-[11px] text-gray-400">主模型异常、超时或返回无效内容时，将按这里的顺序自动尝试备用模型。</p>
                    </Field>
                  </>
                )}
                {form.generation_type === "novel_workshop" && (
                  <Field label="生成大模型（用于章节创作）">
                    <select className="admin-input" value={form.generation_model_code} onChange={(e) => setForm({ ...form, generation_model_code: e.target.value })}>
                      <option value="">请选择chat模型</option>
                      {chatModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}
                    </select>
                    <p className="mt-1.5 text-[11px] text-gray-400">用于章节创作、润色审校等所有文本生成环节。建议选择长上下文的chat模型。</p>
                  </Field>
                )}
                {form.generation_type !== "creative_agent" && !isVideoUtilityType(form.generation_type) && <Field label="默认生成数量"><input type="number" min={1} max={50} className="admin-input" value={form.default_count} onChange={(e) => setForm({ ...form, default_count: Math.max(1, Number(e.target.value) || 1) })} /></Field>}
                {form.generation_type !== "creative_agent" && !isVideoUtilityType(form.generation_type) && <Field label="AI方案数量"><input type="number" min={1} max={5} className="admin-input" value={form.candidate_count} onChange={(e) => setForm({ ...form, candidate_count: Math.min(5, Math.max(1, Number(e.target.value) || 3)) })} /></Field>}
                {form.generation_type !== "creative_agent" && <Field label="工作流收费"><input type="number" min={0} step="0.01" className="admin-input" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) || 0 })} /></Field>}
                {form.code === "product_refine" && <p className="self-end text-[11px] leading-5 text-gray-400">预计费用 = 工作流收费 + 生成数量 × 所选图片模型的后台单价；自动修正不重复增加预计费用。</p>}
                {form.generation_type === "creative_agent" && <p className="md:col-span-2 rounded-xl bg-gray-50 px-3 py-2 text-[11px] leading-5 text-gray-500">通用智能体不额外收取固定工作流费用，主聊天分析和最终图片或视频分别按所配置模型的实际计费规则结算。</p>}
                {form.generation_type === "novel_workshop" && <p className="self-end text-[11px] leading-5 text-gray-400">总费用 = 工作流收费 + 大模型用量费；大模型用量费取「上游真实扣费」与「按模型设定的输入/输出/缓存单价计算的费用」中的较低者。创建时按目标篇幅预估冻结，完成/取消/失败按实际用量结算。</p>}
                {isVideoUtilityType(form.generation_type) && <p className="self-end text-[11px] leading-5 text-gray-400">最终冻结金额 = 工作流收费 + 所选模型估算费用；完成后按实际模型任务费用结算。独立字幕轨移除不产生模型费用。</p>}
              </section>}

              {form.generation_type === "video_upscale" && (
                <section className="grid gap-4 rounded-2xl border border-cyan-100 bg-cyan-50/30 p-4 md:grid-cols-2">
                  <div className="md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-900"><Sparkles size={16} />视频高清参数</div>
                  <Field label="允许的目标清晰度" wide>
                    <div className="flex flex-wrap gap-2">
                      {["720P", "1K", "2K"].map((resolution) => {
                        const checked = form.supported_resolutions.includes(resolution);
                        return <label key={resolution} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${checked ? "border-cyan-300 bg-white text-cyan-800" : "border-gray-100 bg-gray-50 text-gray-400"}`}>
                          <input type="checkbox" checked={checked} onChange={(e) => {
                            const next = e.target.checked ? [...form.supported_resolutions, resolution] : form.supported_resolutions.filter((item) => item !== resolution);
                            const normalized = ["720P", "1K", "2K"].filter((item) => next.includes(item));
                            setForm({ ...form, supported_resolutions: normalized, default_target_resolution: normalized.includes(form.default_target_resolution) ? form.default_target_resolution : normalized[0] || "720P" });
                          }} />{resolution}
                        </label>;
                      })}
                    </div>
                  </Field>
                  <Field label="默认目标清晰度"><select className="admin-input" value={form.default_target_resolution} onChange={(e) => setForm({ ...form, default_target_resolution: e.target.value })}>{form.supported_resolutions.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="默认增强模式"><select className="admin-input" value={form.default_enhancement_mode} onChange={(e) => setForm({ ...form, default_enhancement_mode: e.target.value })}><option value="balanced">均衡增强</option><option value="detail">细节优先</option><option value="denoise">降噪优先</option></select></Field>
                  <Field label="最大视频时长（秒）"><input type="number" min={1} max={7200} className="admin-input" value={form.max_input_duration_sec} onChange={(e) => setForm({ ...form, max_input_duration_sec: Math.max(1, Number(e.target.value) || 300) })} /></Field>
                  <Field label="最大文件大小（MB）"><input type="number" min={1} max={10240} className="admin-input" value={form.max_input_size_mb} onChange={(e) => setForm({ ...form, max_input_size_mb: Math.max(1, Number(e.target.value) || 500) })} /></Field>
                  <Field label="音频处理"><label className="flex h-10 items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 text-sm"><input type="checkbox" checked={form.preserve_audio} onChange={(e) => setForm({ ...form, preserve_audio: e.target.checked })} />默认保留源视频声音</label></Field>
                  <Field label="上游操作值"><input className="admin-input" value={form.upscale_operation} onChange={(e) => setForm({ ...form, upscale_operation: e.target.value })} placeholder="upscale" /><p className="mt-1.5 text-[11px] text-gray-400">发送为 operation 参数；如上游使用其他字段名，请在模型 runtime_rule.upstream.map 中映射。</p></Field>
                  <Field label="默认超分指令" wide><textarea className="admin-input min-h-24 py-2" value={form.upscale_prompt} onChange={(e) => setForm({ ...form, upscale_prompt: e.target.value })} /></Field>
                </section>
              )}

              {form.generation_type === "video_redraw" && (
                <section className="grid gap-4 rounded-2xl border border-violet-100 bg-violet-50/30 p-4 md:grid-cols-2">
                  <div className="md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-900"><Sparkles size={16} />视频转绘参数</div>
                  <Field label="默认风格强度">
                    <input type="number" min={0} max={1} step={0.05} className="admin-input" value={form.default_style_strength} onChange={(e) => setForm({ ...form, default_style_strength: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} />
                    <p className="mt-1.5 text-[11px] text-gray-400">0 更接近源视频，1 更接近目标画风；建议 0.55–0.75。</p>
                  </Field>
                  <Field label="默认一致性策略">
                    <div className="flex min-h-10 flex-wrap items-center gap-4 rounded-xl border border-gray-100 bg-white px-3 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={form.preserve_motion} onChange={(e) => setForm({ ...form, preserve_motion: e.target.checked })} />保留动作</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={form.preserve_identity} onChange={(e) => setForm({ ...form, preserve_identity: e.target.checked })} />保留人物</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={form.preserve_audio} onChange={(e) => setForm({ ...form, preserve_audio: e.target.checked })} />保留原音</label>
                    </div>
                  </Field>
                  <Field label="最大视频时长（秒）"><input type="number" min={1} max={7200} className="admin-input" value={form.max_input_duration_sec} onChange={(e) => setForm({ ...form, max_input_duration_sec: Math.max(1, Number(e.target.value) || 300) })} /></Field>
                  <Field label="最大文件大小（MB）"><input type="number" min={1} max={10240} className="admin-input" value={form.max_input_size_mb} onChange={(e) => setForm({ ...form, max_input_size_mb: Math.max(1, Number(e.target.value) || 500) })} /></Field>
                  <Field label="上游操作值"><input className="admin-input" value={form.redraw_operation} onChange={(e) => setForm({ ...form, redraw_operation: e.target.value })} placeholder="video_redraw" /></Field>
                  <Field label="系统转绘指令" wide><textarea className="admin-input min-h-24 py-2" value={form.redraw_prompt} onChange={(e) => setForm({ ...form, redraw_prompt: e.target.value })} /></Field>
                </section>
              )}

              {form.generation_type === "subtitle_remove" && (
                <section className="grid gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/30 p-4 md:grid-cols-2">
                  <div className="md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-900"><Sparkles size={16} />视频去字幕参数</div>
                  <Field label="默认处理模式">
                    <select className="admin-input" value={form.default_subtitle_mode} onChange={(e) => setForm({ ...form, default_subtitle_mode: e.target.value })}>
                      <option value="auto">自动识别（推荐）</option>
                      <option value="soft_track">仅移除独立字幕轨</option>
                      <option value="hardcoded_ai">仅处理画面硬字幕</option>
                    </select>
                  </Field>
                  <Field label="默认字幕区域">
                    <select className="admin-input" value={form.default_subtitle_region} onChange={(e) => setForm({ ...form, default_subtitle_region: e.target.value })}>
                      <option value="bottom_15">底部 15%</option>
                      <option value="bottom_25">底部 25%（推荐）</option>
                      <option value="bottom_35">底部 35%</option>
                      <option value="full">全画面</option>
                    </select>
                  </Field>
                  <Field label="画面保护"><label className="flex h-10 items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 text-sm"><input type="checkbox" checked={form.protect_watermark} onChange={(e) => setForm({ ...form, protect_watermark: e.target.checked })} />默认保护字幕区域外的水印与 Logo</label></Field>
                  <Field label="声音处理"><label className="flex h-10 items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 text-sm"><input type="checkbox" checked={form.preserve_audio} onChange={(e) => setForm({ ...form, preserve_audio: e.target.checked })} />保留源视频声音</label></Field>
                  <Field label="最大视频时长（秒）"><input type="number" min={1} max={7200} className="admin-input" value={form.max_input_duration_sec} onChange={(e) => setForm({ ...form, max_input_duration_sec: Math.max(1, Number(e.target.value) || 300) })} /></Field>
                  <Field label="最大文件大小（MB）"><input type="number" min={1} max={10240} className="admin-input" value={form.max_input_size_mb} onChange={(e) => setForm({ ...form, max_input_size_mb: Math.max(1, Number(e.target.value) || 500) })} /></Field>
                  <Field label="上游操作值"><input className="admin-input" value={form.subtitle_remove_operation} onChange={(e) => setForm({ ...form, subtitle_remove_operation: e.target.value })} placeholder="subtitle_remove" /></Field>
                  <Field label="硬字幕修复指令" wide><textarea className="admin-input min-h-24 py-2" value={form.subtitle_remove_prompt} onChange={(e) => setForm({ ...form, subtitle_remove_prompt: e.target.value })} /></Field>
                  <p className="md:col-span-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs leading-5 text-emerald-700">自动模式会先用 FFprobe 检测独立字幕轨；检测到后由 FFmpeg 无损封装移除。未检测到时才调用 AI 修复模型，不会把硬字幕任务伪装成成功。</p>
                </section>
              )}

              {form.generation_type === "comic_drama" && (
                <section className="grid gap-4 rounded-2xl border border-gray-100 p-4 md:grid-cols-2">
                  <div className="md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-900"><Settings2 size={16} />AI漫剧偏好</div>
                  <Field label="风格参考模式">
                    <select className="admin-input" value={form.style_reference_mode} onChange={(e) => setForm({ ...form, style_reference_mode: e.target.value })}>
                      <option value="image_reference">附带风格参考图</option>
                      <option value="text_only">仅文字描述</option>
                    </select>
                  </Field>
                  <Field label="分镜时长模式">
                    <select className="admin-input" value={form.duration_mode} onChange={(e) => setForm({ ...form, duration_mode: e.target.value })}>
                      <option value="compact">紧凑</option>
                      <option value="standard">常规</option>
                      <option value="long">超长</option>
                    </select>
                  </Field>
                  <Field label="分镜宫格数">
                    <select className="admin-input" value={form.storyboard_grid} onChange={(e) => setForm({ ...form, storyboard_grid: Number(e.target.value) })}>
                      <option value={2}>2宫格</option>
                      <option value={4}>4宫格</option>
                      <option value={6}>6宫格</option>
                      <option value={9}>9宫格</option>
                    </select>
                  </Field>
                  <Field label="最大重试次数"><input type="number" min={0} max={5} className="admin-input" value={form.max_retry} onChange={(e) => setForm({ ...form, max_retry: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} /></Field>
                  <Field label="资产一致性合格分"><input type="number" min={0} max={100} className="admin-input" value={form.asset_consistency_score} onChange={(e) => setForm({ ...form, asset_consistency_score: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></Field>
                  <Field label="画面逻辑合格分"><input type="number" min={0} max={100} className="admin-input" value={form.logic_score} onChange={(e) => setForm({ ...form, logic_score: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></Field>
                  <Field label="默认屏幕方向">
                    <select className="admin-input" value={form.orientation} onChange={(e) => setForm({ ...form, orientation: e.target.value })}>
                      <option value="landscape">横屏</option>
                      <option value="portrait">竖屏</option>
                    </select>
                  </Field>
                  <Field label="默认清晰度">
                    <select className="admin-input" value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })}>
                      <option value="480P">480P</option>
                      <option value="720P">720P</option>
                      <option value="1080P">1080P</option>
                    </select>
                  </Field>
                </section>
              )}

              {!form.system_workspace && form.generation_type !== "creative_agent" && !isVideoUtilityType(form.generation_type) && <section className="rounded-2xl border border-gray-100 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900">{form.generation_type === "video" ? <Video size={16} /> : <ImageIcon size={16} />}{form.generation_type === "video" ? "视频场景" : "出图场景"}</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {sceneDefs(form.generation_type).map((scene) => {
                    const checked = normalizeScenes(form.creative_scenes, form.generation_type).includes(scene.code);
                    return (
                      <label key={scene.code} className={`rounded-xl border px-3 py-3 text-sm transition ${checked ? "border-primary bg-primary/5 text-gray-900" : "border-gray-100 bg-gray-50 text-gray-600 hover:bg-white"} ${scene.locked ? "cursor-default" : "cursor-pointer"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{scene.label}</span>
                          <input type="checkbox" checked={checked} disabled={scene.locked} onChange={(e) => {
                            const current = normalizeScenes(form.creative_scenes, form.generation_type);
                            const next = e.target.checked ? [...current, scene.code] : current.filter((item) => item !== scene.code);
                            setForm({ ...form, creative_scenes: normalizeScenes(next, form.generation_type) });
                          }} />
                        </div>
                        <p className="mt-1 text-xs leading-5 text-gray-400">{scene.desc}</p>
                      </label>
                    );
                  })}
                </div>
              </section>}

              {!form.system_workspace && !isVideoUtilityType(form.generation_type) && <section className="rounded-2xl border border-gray-100 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900"><Layers size={16} />输入能力与流程</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <CheckItem label="允许纯文字提交" checked={form.allow_text_only} onChange={(v) => setForm({ ...form, allow_text_only: v, require_image: v ? false : form.require_image })} />
                  <CheckItem label="必须上传参考图" checked={form.require_image} onChange={(v) => setForm({ ...form, require_image: v, allow_text_only: v ? false : form.allow_text_only, support_reference_image: v ? true : form.support_reference_image })} />
                  <CheckItem label="支持参考图" checked={form.support_reference_image} onChange={(v) => setForm({ ...form, support_reference_image: v })} />
                  <CheckItem label="支持多参考图" checked={form.support_multiple_references} onChange={(v) => setForm({ ...form, support_multiple_references: v, support_reference_image: v ? true : form.support_reference_image })} />
                  <CheckItem label="支持首尾帧" checked={form.support_first_last_frame} onChange={(v) => setForm({ ...form, support_first_last_frame: v })} disabled={form.generation_type !== "video"} />
                  <CheckItem label="逐步确认" checked={form.enable_step_confirm} onChange={(v) => setForm({ ...form, enable_step_confirm: v })} />
                  <CheckItem label="智能托管" checked={form.enable_autopilot} onChange={(v) => setForm({ ...form, enable_autopilot: v })} />
                  <CheckItem label="允许用户编辑提示词" checked={form.allow_prompt_edit} onChange={(v) => setForm({ ...form, allow_prompt_edit: v })} />
                </div>
              </section>}

              {!form.system_workspace && <section className="grid gap-4 rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Pencil size={16} />前台文案</div>
                <Field label="输入框提示" wide><input className="admin-input" value={form.placeholder} onChange={(e) => setForm({ ...form, placeholder: e.target.value })} /></Field>
                <Field label="玩法说明" wide><textarea className="admin-input min-h-20 py-2" value={form.help} onChange={(e) => setForm({ ...form, help: e.target.value })} /></Field>
              </section>}

              <section className="rounded-2xl border border-gray-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Code2 size={16} />{form.system_workspace ? "工作流" : "智能体"}高级 JSON 设置</div>
                    <p className="mt-1 text-xs leading-5 text-gray-400">
                      当前{form.system_workspace ? "工作流" : "智能体"}的完整预设配置，包含 AI 分析方案、前台展示、输入参数和运行配置。默认由系统生成，管理员可按需微调。
                    </p>
                  </div>
                  <button type="button" onClick={openJson} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-100 px-3 text-sm text-gray-600 hover:bg-gray-50">
                    <Code2 size={15} />查看/编辑当前{form.system_workspace ? "工作流" : "智能体"} JSON
                  </button>
                </div>
                {form.preset_override && (
                  <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    已应用自定义 JSON。保存当前{form.system_workspace ? "工作流" : "智能体"}后，该高级配置会随之生效。
                  </div>
                )}
              </section>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-gray-100 bg-gray-950 p-5 text-white shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-white/10 text-2xl"><AgentIconValue value={form.icon} fallback={activePreset.icon} alt={form.name || activePreset.label} /></div>
                  <div><div className="text-sm text-white/50">前台预览</div><div className="font-semibold">{form.name || activePreset.label}</div></div>
                </div>
                <p className="mt-4 text-sm leading-6 text-white/70">{form.description || activePreset.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">{(form.system_workspace ? form.canvas_templates.map((item) => item.name).filter(Boolean).slice(0, 4) : activePreset.featureTags).map((tag) => <span key={tag} className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-white/80">{tag}</span>)}</div>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-white p-5">
                <div className="mb-3 text-sm font-semibold text-gray-900">配置摘要</div>
                {form.system_workspace ? <>
                  <Summary icon={<Layers size={15} />} label="类型" value="无限画布工作流" />
                  <Summary icon={<Sparkles size={15} />} label="模板" value={`${form.canvas_templates.length} 个`} />
                  <Summary icon={<Bot size={15} />} label="分析模型" value={form.analysis_model_code || "自动选择"} />
                  <Summary icon={<ImageIcon size={15} />} label="配图模型" value={(form.code === "content_image_post" ? form.generation_model_code : form.image_model_code) || "自动选择"} />
                </> : <>
                  <Summary icon={form.generation_type === "video" ? <Video size={15} /> : <ImageIcon size={15} />} label="生成类型" value={activePreset.label} />
                  <Summary icon={<Sparkles size={15} />} label="场景" value={normalizeScenes(form.creative_scenes, form.generation_type).map((code) => sceneDefs(form.generation_type).find((x) => x.code === code)?.label || code).join(" / ")} />
                  <Summary icon={<Check size={15} />} label="方案数量" value={`${form.candidate_count} 条`} />
                  <Summary icon={<Bot size={15} />} label="模式" value={[form.enable_step_confirm && "逐步确认", form.enable_autopilot && "智能托管"].filter(Boolean).join(" / ") || "仅手动"} />
                </>}
              </div>
              {err && <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">{err}</div>}
              <button type="submit" className="h-11 w-full rounded-xl bg-primary font-semibold text-dark shadow-sm">{form.system_workspace ? "保存工作流" : form.isEdit ? "保存修改" : "创建智能体"}</button>
            </aside>
          </div>
        </form>
        );
        if (!form.isEdit) return editor;
        if (typeof document === "undefined") return null;
        const target = document.getElementById(`agent-edit-panel-${form.code}`);
        return target ? createPortal(editor, target) : null;
      })()}

      <div className="grid gap-4">
        {paginatedItems.map((w) => {
          const runtime = w.runtime_config || {};
          const type = typeFromRuntime(runtime, w.category);
          const preset = TYPE_PRESETS[type];
          const isSystemWorkspace = runtime.system_workspace === true || runtime.agent_mode === "infinite_canvas";
          return (
            <div key={w.code} className="space-y-3">
              <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-900 text-xl text-white"><AgentIconValue value={w.icon} fallback={preset.icon} alt={w.name} /></span>
                    <h2 className="font-semibold text-gray-950">{w.name}</h2>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-mono text-gray-500">{w.code}</span>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600">{preset.label}</span>
                    {isSystemWorkspace && <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700">系统工作台</span>}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${w.is_enabled ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>{w.is_enabled ? "已启用" : "已停用"}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-500">{w.description || preset.description}</p>
                  <p className="mt-2 text-xs text-gray-400">
                    {isSystemWorkspace
                      ? w.code === "content_image_post"
                        ? "可管理默认内容分析、配图模型、配图数量和画布模板；Agent 调用方式保持不变。"
                        : "节点内可选择后台已启用的分析、图片、视频模型；画布历史独立保存。"
                      : `分析模型：${runtime.analysis_model_code || "-"} · 生成模型：${runtime.generation_model_code || "-"} · 类型：${preset.label}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => openEdit(w)} className="rounded-lg border border-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">{isSystemWorkspace ? "管理配置" : "编辑"}</button>
                  <button onClick={() => toggle(w.code, !w.is_enabled)} className="rounded-lg border border-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">{w.is_enabled ? "停用" : "启用"}</button>
                  {!isSystemWorkspace && <button onClick={() => remove(w)} className="rounded-lg border border-red-100 px-3 py-2 text-sm text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>}
                </div>
              </div>
              </div>
              <div id={`agent-edit-panel-${w.code}`} className="scroll-mt-6" />
            </div>
          );
        })}
        {items.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center text-gray-400">暂无智能体</div>}
      </div>
      <AdminPagination page={page} total={items.length} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {jsonOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setJsonOpen(false)}>
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div><div className="font-semibold text-gray-950">当前{form.system_workspace ? "工作流" : "智能体"}高级 JSON</div><div className="mt-0.5 text-xs text-gray-400">只作用于正在编辑的这个{form.system_workspace ? "工作流" : "智能体"}。应用后，再点击保存才会写入生效。</div></div>
              <button type="button" onClick={() => setJsonOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-50 text-gray-500"><X size={16} /></button>
            </div>
            <div className="p-5">
              <textarea value={jsonDraft} onChange={(e) => setJsonDraft(e.target.value)} className="h-[56vh] w-full rounded-2xl border border-gray-200 bg-gray-950 p-4 font-mono text-xs leading-5 text-gray-100 outline-none focus:border-primary" spellCheck={false} />
              {jsonErr && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{jsonErr}</div>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setJsonDraft(JSON.stringify(presetBundle(form), null, 2))} className="h-10 rounded-xl border border-gray-100 px-4 text-sm text-gray-600 hover:bg-gray-50">恢复系统预制</button>
                <button type="button" onClick={applyJson} className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-dark">应用到当前智能体</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .admin-input {
          width: 100%;
          min-height: 2.5rem;
          border-radius: 0.75rem;
          border: 1px solid rgb(229 231 235);
          background: white;
          padding: 0 0.75rem;
          font-size: 0.875rem;
          color: rgb(31 41 55);
          outline: none;
        }
        .admin-input:focus {
          border-color: rgb(250 204 21);
          box-shadow: 0 0 0 3px rgb(250 204 21 / 0.16);
        }
        .admin-input:disabled {
          background: rgb(249 250 251);
          color: rgb(156 163 175);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? "md:col-span-2" : ""}>
      <div className="mb-1.5 text-xs font-medium text-gray-500">{label}</div>
      {children}
    </label>
  );
}

function CheckItem({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${disabled ? "border-gray-100 bg-gray-50 text-gray-300" : "border-gray-100 bg-gray-50 text-gray-700"}`}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Summary({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-50 py-2 last:border-0">
      <div className="flex items-center gap-2 text-xs text-gray-400">{icon}{label}</div>
      <div className="max-w-[190px] truncate text-right text-sm text-gray-700">{value}</div>
    </div>
  );
}
