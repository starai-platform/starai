export interface User {
  public_id: string;
  email?: string;
  auth_provider?: 'email' | 'google' | 'github' | string;
  nickname: string;
  avatar_url?: string;
  user_level: string;
  member_level_id?: number;
  member_level?: string;
  referral_code?: string;
  referrer_id?: number;
  referrer_public_id?: string;
  locale: string;
}

export interface Wallet {
  compute_balance: number;
  frozen_compute: number;
  cash_balance: number;
}

export interface WalletTransaction {
  id: number;
  type: string;
  direction: 'in' | 'out';
  amount: number;
  balance_after: number;
  ref_type?: string;
  ref_id?: string;
  remark?: string;
  created_at: string;
}

export interface CashTransaction extends WalletTransaction {}

export interface WithdrawalRequest {
  id: number;
  public_id: string;
  method: 'bank' | 'wechat' | 'alipay' | 'paypal';
  amount: number;
  account_info: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  admin_note?: string;
  reviewed_at?: string;
  paid_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ReferralSummary {
  referral_code: string;
  referrer_id?: number;
  referrer_name?: string;
  direct_count: number;
  reward_compute: number;
  reward_cash: number;
  children?: ReferralChild[];
}

export interface ReferralChild {
  id: number;
  public_id: string;
  nickname: string;
  email: string;
  recharge_amount: number;
  created_at: string;
}

export interface Model {
  id: number;
  code: string;
  display_name: string;
  category: string;
  icon_url?: string;
  description?: string;
  tags: string[];
  runtime_rule?: Record<string, unknown>;
  input_schema: Record<string, unknown>;
  default_params: Record<string, unknown>;
  price_rule: PriceRule;
  is_enabled: boolean;
  sort_order: number;
}

export interface PriceRule {
  billing_type: 'per_token' | 'per_image' | 'per_request' | 'per_second' | 'dynamic';
  unit_price?: number;
  /** Per-token prices (legacy, tiny decimals). Prefer *_per_m below in admin. */
  input_price?: number;
  output_price?: number;
  cache_read_price?: number;
  cache_write_price?: number;
  /** Admin-friendly prices per 1M tokens (e.g. 12.75 = 楼12.75 / 1M tokens). */
  input_price_per_m?: number;
  output_price_per_m?: number;
  cache_read_price_per_m?: number;
  cache_write_price_per_m?: number;
  /** Platform surcharge per 1M tokens, added on top of real token cost. */
  surcharge_per_m?: number;
  /** Display currency symbol, e.g. "楼". Defaults to compute-credit display. */
  currency?: string;
}

export interface Conversation {
  public_id: string;
  title?: string;
  model_code?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

export interface Task {
  task_no: string;
  upstream_task_id?: string;
  type: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  estimated_cost: number;
  actual_cost: number;
  error_code?: string;
  error_message?: string;
  created_at: string;
  finished_at?: string;
}

export interface Work {
  public_id: string;
  type: string;
  title?: string;
  prompt?: string;
  thumbnail_url?: string;
  metadata: Record<string, unknown>;
  expires_at?: string;
  created_at: string;
}

export interface SystemConfig {
  site_name: string;
  site_logo?: string;
  site_favicon?: string;
  site_description?: string;
  admin_site_description?: string;
  site_api_tagline?: string;
  site_copyright?: string;
  home_meta_title?: string;
  home_meta_description?: string;
  terms_title?: string;
  terms_content?: string;
  privacy_title?: string;
  privacy_content?: string;
  image_captcha_enabled?: boolean;
  customer_service_enabled?: boolean;
  customer_service_title?: string;
  customer_service_name?: string;
  customer_service_subtitle?: string;
  customer_service_floating_image?: string;
  customer_service_avatar?: string;
  customer_service_qr_url?: string;
  customer_service_qr_tip?: string;
  customer_service_phone?: string;
  customer_service_wechat?: string;
  customer_service_hours?: string;
  generation_languages?: GenerationLanguage[];
  ui_languages?: UILanguage[];
  ui_translation_overrides?: UITranslationOverride[];
  payment_enabled: boolean;
  card_recharge_enabled: boolean;
  payment_provider?: "disabled" | "mock" | "generic" | "stripe" | "paypal";
  payment_currency?: string;
  default_locale: string;
  work_retention_days: number;
  daily_checkin_enabled?: boolean;
  daily_checkin_reward?: number;
  gallery_audit_required?: boolean;
  payment_compute_rate?: number;
}

export interface GenerationLanguage {
  code: string;
  short: string;
  name: string;
  prompt_label?: string;
  enabled?: boolean;
  sort_order?: number;
}

export interface UILanguage {
  code: string;
  short: string;
  name: string;
  flag: string;
  flag_url?: string;
  enabled?: boolean;
  sort_order?: number;
}

export interface UITranslationOverride {
  locale: string;
  key: string;
  value: string;
  enabled?: boolean;
}

export const UI_TRANSLATION_KEYS = [
  "agent.aiRecommended",
  "agent.analysisHint",
  "agent.autopilot",
  "agent.confirmGenerate",
  "agent.confirmPlan",
  "agent.errorNeedInput",
  "agent.errorNeedReference",
  "agent.help",
  "agent.helpDefault",
  "agent.inputPlaceholder",
  "agent.plan",
  "agent.scene",
  "agent.scene.detail_image",
  "agent.scene.image_to_video",
  "agent.scene.main_image",
  "agent.scene.marketing_poster",
  "agent.scene.product_video",
  "agent.scene.scene_image",
  "agent.sceneDesc",
  "agent.stepAnalyzeDesc",
  "agent.stepAnalyzeTitle",
  "agent.stepConfirm",
  "agent.stepConfirmDesc",
  "agent.stepConfirmTitle",
  "agent.stepGenerateDesc",
  "agent.stepImageTitle",
  "agent.stepVideoTitle",
  "agent.uploadFailed",
  "announcement.empty",
  "announcement.ok",
  "announcement.title",
  "apiDocs.backWorkspace",
  "apiDocs.baseUrl",
  "apiDocs.manageKeys",
  "apiDocs.modelPricing",
  "apiDocs.noDocs",
  "apiDocs.search",
  "asset.all",
  "asset.assetType",
  "asset.cancelSelection",
  "asset.chooseLocalFile",
  "asset.confirmSelection",
  "asset.currentReferenceImageOnly",
  "asset.deleteAsset",
  "asset.descLabel",
  "asset.descPlaceholder",
  "asset.doc",
  "asset.freeGalleryOnly",
  "asset.image",
  "asset.library",
  "asset.maxReferenceImages",
  "asset.myAssets",
  "asset.nameLabel",
  "asset.namePlaceholder",
  "asset.noAssets",
  "asset.prop",
  "asset.reselect",
  "asset.role",
  "asset.scene",
  "asset.searchAssets",
  "asset.searchGallery",
  "asset.selectFromLibrary",
  "asset.selectReferenceFromLibrary",
  "asset.selectThisAsset",
  "asset.selectedAssetCount",
  "asset.selectedAssets",
  "asset.selectedCount",
  "asset.selectedReferences",
  "asset.singleReferenceHint",
  "asset.supportedFileDesc",
  "asset.temporaryNotice",
  "asset.upload",
  "asset.uploadAndSave",
  "asset.uploadAsset",
  "asset.uploadAttachment",
  "asset.uploadDocAsset",
  "asset.uploadFailed",
  "asset.uploadImage",
  "asset.uploadImageAsset",
  "asset.uploadVideoAsset",
  "asset.uploadedAttachments",
  "asset.uploadedCompleteSelectManually",
  "asset.video",
  "category.api",
  "category.multiCollab",
  "category.workflow",
  "channel.answer",
  "channel.answerModels",
  "channel.dispatch",
  "channel.fallback",
  "channel.price_first.desc",
  "channel.price_first.name",
  "channel.speed_first.desc",
  "channel.speed_first.name",
  "channel.success_first.desc",
  "channel.success_first.name",
  "channel.summary",
  "channel.summaryModels",
  "channel.unconfigured",
  "common.all",
  "common.announcement",
  "common.asset",
  "common.audio",
  "common.cancel",
  "common.close",
  "common.compute",
  "common.confirm",
  "common.copy",
  "common.create",
  "common.delete",
  "common.description",
  "common.document",
  "common.download",
  "common.edit",
  "common.empty",
  "common.free",
  "common.gotIt",
  "common.history",
  "common.image",
  "common.language",
  "common.loading",
  "common.logout",
  "common.more",
  "common.name",
  "common.newTask",
  "common.noAgents",
  "common.noModels",
  "common.notLoggedIn",
  "common.online",
  "common.paid",
  "common.preview",
  "common.recharge",
  "common.reference",
  "common.remove",
  "common.retry",
  "common.save",
  "common.saving",
  "common.search",
  "common.searchAgents",
  "common.searchModels",
  "common.select",
  "common.selectModel",
  "common.selected",
  "common.theme.dark",
  "common.theme.light",
  "common.theme.toDark",
  "common.theme.toLight",
  "common.upload",
  "common.uploading",
  "common.video",
  "gallery.all",
  "gallery.desc",
  "gallery.empty",
  "gallery.featured",
  "gallery.free",
  "gallery.paid",
  "gallery.searchPlaceholder",
  "gallery.tag.all",
  "gallery.tag.anime",
  "gallery.tag.concept",
  "gallery.tag.ecommerce",
  "gallery.tag.illustration",
  "gallery.tag.photography",
  "gallery.title",
  "generation.language",
  "generation.languageDesc",
  "imageToolbar.allRatios",
  "imageToolbar.commonRatios",
  "imageToolbar.count",
  "imageToolbar.countDesc",
  "imageToolbar.customCount",
  "imageToolbar.quality",
  "imageToolbar.qualityDesc",
  "imageToolbar.ratio",
  "imageToolbar.ratioDesc",
  "landing.apiDocs",
  "landing.badge",
  "landing.capability.agent.desc",
  "landing.capability.agent.title",
  "landing.capability.api.desc",
  "landing.capability.api.title",
  "landing.capability.chat.desc",
  "landing.capability.chat.title",
  "landing.capability.media.desc",
  "landing.capability.media.title",
  "landing.cta",
  "landing.ctaDesc",
  "landing.desc",
  "landing.feature.apiKey.desc",
  "landing.feature.apiKey.title",
  "landing.feature.gallery.desc",
  "landing.feature.gallery.title",
  "landing.feature.referral.desc",
  "landing.feature.referral.title",
  "landing.flow.step1.desc",
  "landing.flow.step1.title",
  "landing.flow.step2.desc",
  "landing.flow.step2.title",
  "landing.flow.step3.desc",
  "landing.flow.step3.title",
  "landing.freeStart",
  "landing.gallery",
  "landing.hero.phrase1",
  "landing.hero.phrase2",
  "landing.hero.phrase3",
  "landing.hero.phrase4",
  "landing.liveWorkspace",
  "landing.login",
  "landing.section.capability",
  "landing.section.capabilityDesc",
  "landing.section.flow",
  "landing.section.flowDesc",
  "landing.section.gallery",
  "landing.start",
  "landing.stat.api",
  "landing.stat.models",
  "landing.stat.wallet",
  "landing.stat.workflow",
  "landing.titlePrefix",
  "landing.titleSuffix",
  "landing.tryNow",
  "landing.viewAll",
  "landing.workspace.card1",
  "landing.workspace.card2",
  "landing.workspace.card3",
  "landing.workspace.card4",
  "landing.workspace.done",
  "login.accountTab",
  "login.agreePrefix",
  "login.and",
  "login.captcha",
  "login.confirmPassword",
  "login.desc",
  "login.email",
  "login.emailCode",
  "login.emailTab",
  "login.finish",
  "login.firstHint",
  "login.getCode",
  "login.later",
  "login.loading",
  "login.login",
  "login.newPassword",
  "login.oauth",
  "login.password",
  "login.privacy",
  "login.referral",
  "login.refresh",
  "login.setPassword",
  "login.setPasswordDesc",
  "login.setPasswordDescNew",
  "login.submit",
  "login.terms",
  "login.title",
  "login.verifying",
  "menu.apiDocsDesc",
  "menu.cash",
  "menu.defaultMember",
  "menu.galleryDesc",
  "menu.pricingDesc",
  "menu.quickEntry",
  "menu.recharge",
  "menu.referralCode",
  "menu.settingsDesc",
  "menu.walletDesc",
  "menu.worksDesc",
  "model.referenceUnsupported",
  "nav.agents",
  "nav.all",
  "nav.apiDocs",
  "nav.audio",
  "nav.chat",
  "nav.gallery",
  "nav.image",
  "nav.mine",
  "nav.models",
  "nav.openApiDocs",
  "nav.openApiDocsDesc",
  "nav.pageNav",
  "nav.pricing",
  "nav.searchAgents",
  "nav.searchModels",
  "nav.settings",
  "nav.short.gallery",
  "nav.short.pricing",
  "nav.short.settings",
  "nav.short.wallet",
  "nav.short.works",
  "nav.short.workspace",
  "nav.video",
  "nav.wallet",
  "nav.works",
  "nav.workspace",
  "notifications.empty",
  "notifications.emptyDesc",
  "notifications.loginHint",
  "notifications.markAll",
  "notifications.title",
  "referral.code",
  "referral.copied",
  "referral.copyFailed",
  "referral.copyLink",
  "referral.desc",
  "referral.loginRequired",
  "referral.oneClickPromote",
  "referral.oneClickRecommend",
  "role.create",
  "role.creating",
  "role.manage",
  "role.manageDesc",
  "role.select",
  "settings.accountId",
  "settings.nickname",
  "settings.password",
  "settings.profile",
  "settings.saveFailed",
  "settings.saved",
  "settings.title",
  "status.failed",
  "status.pending",
  "status.running",
  "status.succeeded",
  "status.waitingConfirm",
  "translation.importSuccess",
  "translation.saveFailed",
  "translation.saveSuccess",
  "translation.saving",
  "unit.image",
  "unit.video",
  "video.duration",
  "video.durationDesc",
  "video.firstFrame",
  "video.lastFrame",
  "video.maxReferenceImages",
  "video.option.orientation.landscape",
  "video.option.orientation.portrait",
  "video.orientation",
  "video.orientationDesc",
  "video.referenceImage",
  "workspace.defaultModelDesc",
  "workspace.feature.fusion.desc",
  "workspace.feature.fusion.title",
  "workspace.feature.multiView.desc",
  "workspace.feature.multiView.title",
  "workspace.feature.parallel.desc",
  "workspace.feature.parallel.title",
  "workspace.feature.quality.desc",
  "workspace.feature.quality.title",
  "workspace.generating",
  "workspace.generationFailed",
  "workspace.generationProgress",
  "workspace.generationResult",
  "workspace.imageLoadFailed",
  "workspace.placeholder.audio",
  "workspace.placeholder.chat",
  "workspace.placeholder.image",
  "workspace.placeholder.video",
  "workspace.quickStart",
  "workspace.shiftEnter",
  "workspace.stepAnalysis",
  "workspace.stepDone",
  "workspace.stepImageGenerating",
  "workspace.stepStart",
  "workspace.stepVideoGenerating",
  "workspace.submitHint",
  "workspace.tokenBilling",
  "workspace.viewPricing",
  "workspace.waitImageInput",
  "workspace.waitVideoInput"
] as const;

export const UI_TRANSLATION_ZH_LABELS: Record<string, string> = {
  "agent.aiRecommended": "AI 推荐",
  "agent.analysisHint": "输入需求并上传参考图后开始，AI 会先生成方案。",
  "agent.autopilot": "智能托管",
  "agent.confirmGenerate": "确认并生成",
  "agent.confirmPlan": "请确认生成方案",
  "agent.errorNeedInput": "请输入需求或上传参考图",
  "agent.errorNeedReference": "请先上传参考图",
  "agent.help": "玩法说明",
  "agent.helpDefault": "上传商品图或参考图，输入简短需求。逐步确认会在方案阶段暂停，智能托管会自动完成分析和生成。",
  "agent.inputPlaceholder": "输入商品名称和详细信息，例如：XXX品牌玻尿酸精华液，30ml，主打三重保湿，敏感肌可用...",
  "agent.plan": "方案",
  "agent.scene": "创作场景",
  "agent.scene.detail_image": "Product detail image",
  "agent.scene.image_to_video": "Image-to-video",
  "agent.scene.main_image": "Main product image",
  "agent.scene.marketing_poster": "Marketing poster",
  "agent.scene.product_video": "Product video",
  "agent.scene.scene_image": "Lifestyle scene",
  "agent.sceneDesc": "选择本次智能体的生成方向",
  "agent.stepAnalyzeDesc": "AI 根据输入和参考图理解目标效果",
  "agent.stepAnalyzeTitle": "需求智能分析",
  "agent.stepConfirm": "逐步确认",
  "agent.stepConfirmDesc": "确认或修改生成方案",
  "agent.stepConfirmTitle": "方案确认",
  "agent.stepGenerateDesc": "调用选择的生成模型输出结果",
  "agent.stepImageTitle": "图片生成",
  "agent.stepVideoTitle": "视频生成",
  "agent.uploadFailed": "商品图上传失败：",
  "announcement.empty": "暂无公告",
  "announcement.ok": "我知道了",
  "announcement.title": "平台公告",
  "apiDocs.backWorkspace": "返回工作台",
  "apiDocs.baseUrl": "BASE URL",
  "apiDocs.manageKeys": "管理 API Key",
  "apiDocs.modelPricing": "模型价格",
  "apiDocs.noDocs": "暂无 API 文档",
  "apiDocs.search": "搜索文档 / 模型",
  "asset.all": "All",
  "asset.assetType": "Asset type",
  "asset.cancelSelection": "Deselect",
  "asset.chooseLocalFile": "Choose local {kind}",
  "asset.confirmSelection": "Confirm selection",
  "asset.currentReferenceImageOnly": "You are choosing reference images, so only image assets can be uploaded.",
  "asset.deleteAsset": "Delete asset",
  "asset.descLabel": "Description (optional, up to 200 chars)",
  "asset.descPlaceholder": "Useful for recall and search",
  "asset.doc": "Document",
  "asset.freeGalleryOnly": "Only free gallery items can be selected here as references. Use paid items from the Gallery page.",
  "asset.image": "Image",
  "asset.library": "Asset library",
  "asset.maxReferenceImages": "Select up to {max} reference images",
  "asset.myAssets": "My assets",
  "asset.nameLabel": "Name (up to 50 chars)",
  "asset.namePlaceholder": "Example: Product hero image",
  "asset.noAssets": "No assets yet",
  "asset.prop": "Prop",
  "asset.reselect": "Choose again",
  "asset.role": "Role",
  "asset.scene": "Scene",
  "asset.searchAssets": "Search asset names...",
  "asset.searchGallery": "Search gallery titles...",
  "asset.selectFromLibrary": "Choose assets",
  "asset.selectReferenceFromLibrary": "Choose reference images from assets",
  "asset.selectThisAsset": "Select this asset",
  "asset.selectedAssetCount": "Selected {count}",
  "asset.selectedAssets": "Selected assets",
  "asset.selectedCount": "Selected {count}/{max}",
  "asset.selectedReferences": "Selected references",
  "asset.singleReferenceHint": "Single-image mode. Selecting a new image will replace the current one.",
  "asset.supportedFileDesc": "Single file <= 20MB. Supports images, videos, PDF, Word, Excel, PPT, TXT, Markdown, and more.",
  "asset.temporaryNotice": "Attachment assets (images, audio, video, documents) are kept for 30 days. Text assets are not affected.",
  "asset.upload": "Upload",
  "asset.uploadAndSave": "Upload and save",
  "asset.uploadAsset": "Upload asset",
  "asset.uploadAttachment": "Upload attachment",
  "asset.uploadDocAsset": "Upload document asset",
  "asset.uploadFailed": "Upload failed",
  "asset.uploadImage": "Upload image",
  "asset.uploadImageAsset": "Upload image asset",
  "asset.uploadVideoAsset": "Upload video asset",
  "asset.uploadedAttachments": "Uploaded {count}/10 attachments",
  "asset.uploadedCompleteSelectManually": "Uploaded. Select it from the asset library to use it.",
  "asset.video": "Video",
  "category.api": "API",
  "category.multiCollab": "多模型协作",
  "category.workflow": "工作流",
  "channel.answer": "Answer",
  "channel.answerModels": "Answer models",
  "channel.dispatch": "Smart routing",
  "channel.fallback": "Auto fallback",
  "channel.price_first.desc": "Prioritize the lowest cost channel",
  "channel.price_first.name": "Price first",
  "channel.speed_first.desc": "Prioritize the fastest response channel",
  "channel.speed_first.name": "Speed first",
  "channel.success_first.desc": "Prioritize the highest success rate channel",
  "channel.success_first.name": "Success first",
  "channel.summary": "Summary",
  "channel.summaryModels": "Summary model",
  "channel.unconfigured": "Not configured",
  "common.all": "All",
  "common.announcement": "公告",
  "common.asset": "Asset",
  "common.audio": "Audio",
  "common.cancel": "取消",
  "common.close": "关闭",
  "common.compute": "算力",
  "common.confirm": "确认",
  "common.copy": "复制",
  "common.create": "Create",
  "common.delete": "删除",
  "common.description": "Description",
  "common.document": "Document",
  "common.download": "下载",
  "common.edit": "Edit",
  "common.empty": "暂无数据",
  "common.free": "Free",
  "common.gotIt": "知道了",
  "common.history": "历史",
  "common.image": "Image",
  "common.language": "语言",
  "common.loading": "加载中...",
  "common.logout": "退出登录",
  "common.more": "更多",
  "common.name": "Name",
  "common.newTask": "新任务",
  "common.noAgents": "暂无智能体",
  "common.noModels": "暂无模型",
  "common.notLoggedIn": "未登录",
  "common.online": "在线",
  "common.paid": "Paid",
  "common.preview": "预览",
  "common.recharge": "充值",
  "common.reference": "参考图",
  "common.remove": "移除",
  "common.retry": "重试",
  "common.save": "保存",
  "common.saving": "保存中...",
  "common.search": "Search",
  "common.searchAgents": "搜索智能体功能...",
  "common.searchModels": "搜索模型...",
  "common.select": "Select",
  "common.selectModel": "选择模型",
  "common.selected": "Selected",
  "common.theme.dark": "深色模式",
  "common.theme.light": "浅色模式",
  "common.theme.toDark": "切换到深色",
  "common.theme.toLight": "切换到浅色",
  "common.upload": "Upload",
  "common.uploading": "上传中",
  "common.video": "Video",
  "gallery.all": "All",
  "gallery.desc": "Discover reusable works and creation parameters",
  "gallery.empty": "No gallery works yet",
  "gallery.featured": "Featured",
  "gallery.free": "Free",
  "gallery.paid": "Paid",
  "gallery.searchPlaceholder": "Search gallery works...",
  "gallery.tag.all": "All",
  "gallery.tag.anime": "Anime",
  "gallery.tag.concept": "Concept design",
  "gallery.tag.ecommerce": "E-commerce",
  "gallery.tag.illustration": "Illustration",
  "gallery.tag.photography": "Photography",
  "gallery.title": "Gallery",
  "generation.language": "语言",
  "generation.languageDesc": "选择生成内容语言",
  "imageToolbar.allRatios": "全部比例",
  "imageToolbar.commonRatios": "常用比例",
  "imageToolbar.count": "生成数量",
  "imageToolbar.countDesc": "选择本次生成数量",
  "imageToolbar.customCount": "自定义数量",
  "imageToolbar.quality": "质量",
  "imageToolbar.qualityDesc": "选择输出清晰度",
  "imageToolbar.ratio": "比例",
  "imageToolbar.ratioDesc": "选择画面比例",
  "landing.apiDocs": "API 文档",
  "landing.badge": "多模型聚合、API 与智能体工作流",
  "landing.capability.agent.desc": "后台勾选配置，前台按场景一键生成。",
  "landing.capability.agent.title": "智能体流程",
  "landing.capability.api.desc": "用 API Key 接入平台的多模型能力。",
  "landing.capability.api.title": "开放 API",
  "landing.capability.chat.desc": "多模型对话、角色模板和联网搜索。",
  "landing.capability.chat.title": "智能对话",
  "landing.capability.media.desc": "支持比例、质量、语言和参考图参数。",
  "landing.capability.media.title": "图片与视频",
  "landing.cta": "开始构建你的 AI 工作流",
  "landing.ctaDesc": "使用统一账户、统一算力和 API Key，快速接入多模型能力。",
  "landing.desc": "{site} 将大模型、图片视频生成、API 和智能体整合到一个工作台。",
  "landing.feature.apiKey.desc": "在我的页面创建密钥，快速接入模型能力。",
  "landing.feature.apiKey.title": "开放 API Key",
  "landing.feature.gallery.desc": "展示优秀作品，支持复用和付费使用。",
  "landing.feature.gallery.title": "灵感广场",
  "landing.feature.referral.desc": "分享推荐链接，绑定上下级关系。",
  "landing.feature.referral.title": "推荐奖励体系",
  "landing.flow.step1.desc": "简单描述目标，上传参考图或文档。",
  "landing.flow.step1.title": "输入需求与素材",
  "landing.flow.step2.desc": "按模型能力选择数量、比例、质量和语言。",
  "landing.flow.step2.title": "选择模型参数",
  "landing.flow.step3.desc": "结果可预览、下载、发布到灵感广场或 API 复用。",
  "landing.flow.step3.title": "获取结果与复用",
  "landing.freeStart": "免费开始",
  "landing.gallery": "灵感广场",
  "landing.hero.phrase1": "智能对话",
  "landing.hero.phrase2": "商品主图生成",
  "landing.hero.phrase3": "视频创作",
  "landing.hero.phrase4": "API 接入",
  "landing.liveWorkspace": "实时工作台",
  "landing.login": "登录",
  "landing.section.capability": "一站式 AI 能力",
  "landing.section.capabilityDesc": "从对话到图片视频生成，从 API 到智能体流程，保持统一的操作体验。",
  "landing.section.flow": "从需求到结果",
  "landing.section.flowDesc": "上传素材、选择模型或智能体，系统会按参数与计费规则完成生成。",
  "landing.section.gallery": "灵感作品展示",
  "landing.start": "开始使用",
  "landing.stat.api": "API 调用",
  "landing.stat.models": "接入模型",
  "landing.stat.wallet": "统一钱包",
  "landing.stat.workflow": "智能体流程",
  "landing.titlePrefix": "用 AI 完成",
  "landing.titleSuffix": "{value}",
  "landing.tryNow": "立即体验",
  "landing.viewAll": "查看全部",
  "landing.workspace.card1": "需求分析",
  "landing.workspace.card2": "生成预览",
  "landing.workspace.card3": "API 调用",
  "landing.workspace.card4": "作品管理",
  "landing.workspace.done": "从需求到结果，统一管理。",
  "login.accountTab": "账号密码",
  "login.agreePrefix": "我已阅读并同意",
  "login.and": "和",
  "login.captcha": "图形验证码",
  "login.confirmPassword": "确认密码",
  "login.desc": "使用邮箱验证码或账号密码登录",
  "login.email": "邮箱",
  "login.emailCode": "邮箱验证码",
  "login.emailTab": "邮箱验证",
  "login.finish": "完成设置",
  "login.firstHint": "首次使用将自动创建账号",
  "login.getCode": "获取验证码",
  "login.later": "稍后再说",
  "login.loading": "处理中...",
  "login.login": "登录",
  "login.newPassword": "新密码（至少 6 位）",
  "login.oauth": "第三方登录",
  "login.password": "密码",
  "login.privacy": "隐私政策",
  "login.referral": "推荐码（选填）",
  "login.refresh": "刷新",
  "login.setPassword": "设置登录密码",
  "login.setPasswordDesc": "请设置一个新的登录密码",
  "login.setPasswordDescNew": "设置后可使用邮箱和密码登录",
  "login.submit": "登录 / 注册",
  "login.terms": "服务协议",
  "login.title": "登录 {site}",
  "login.verifying": "验证中...",
  "menu.apiDocsDesc": "开发者接入说明",
  "menu.cash": "现金",
  "menu.defaultMember": "普通会员",
  "menu.galleryDesc": "浏览和发布灵感作品",
  "menu.pricingDesc": "查看模型价格和计费规则",
  "menu.quickEntry": "快捷入口",
  "menu.recharge": "充值",
  "menu.referralCode": "推荐码",
  "menu.settingsDesc": "管理账号资料和 API Key",
  "menu.walletDesc": "查看算力余额和现金账户",
  "menu.worksDesc": "查看生成记录和作品",
  "model.referenceUnsupported": "当前模型不支持参考图上传",
  "nav.agents": "智能体",
  "nav.all": "全部",
  "nav.apiDocs": "API 文档",
  "nav.audio": "音频",
  "nav.chat": "聊天",
  "nav.gallery": "灵感广场",
  "nav.image": "图片",
  "nav.mine": "我的",
  "nav.models": "大模型",
  "nav.openApiDocs": "开放 API 文档",
  "nav.openApiDocsDesc": "查看平台已接入模型的兼容调用文档",
  "nav.pageNav": "页面导航",
  "nav.pricing": "价格查询",
  "nav.searchAgents": "搜索智能体功能...",
  "nav.searchModels": "搜索模型...",
  "nav.settings": "设置",
  "nav.short.gallery": "灵感",
  "nav.short.pricing": "价格",
  "nav.short.settings": "设置",
  "nav.short.wallet": "钱包",
  "nav.short.works": "作品",
  "nav.short.workspace": "工作",
  "nav.video": "视频",
  "nav.wallet": "钱包",
  "nav.works": "我的作品",
  "nav.workspace": "工作台",
  "notifications.empty": "暂无通知",
  "notifications.emptyDesc": "有新消息会在这里提醒你",
  "notifications.loginHint": "登录后查看通知",
  "notifications.markAll": "全部已读",
  "notifications.title": "通知",
  "referral.code": "Referral code",
  "referral.copied": "Copied",
  "referral.copyFailed": "Copy failed. Please copy the referral link manually.",
  "referral.copyLink": "Copy referral link",
  "referral.desc": "Copy your referral link. New users who open it will have your referral code filled automatically.",
  "referral.loginRequired": "Log in to get your referral link",
  "referral.oneClickPromote": "Promote",
  "referral.oneClickRecommend": "Refer now",
  "role.create": "Create role",
  "role.creating": "Creating...",
  "role.manage": "Role management",
  "role.manageDesc": "Manage your role templates and system prompts",
  "role.select": "Select role",
  "settings.accountId": "账号 ID",
  "settings.nickname": "昵称",
  "settings.password": "修改密码",
  "settings.profile": "个人资料",
  "settings.saveFailed": "保存失败",
  "settings.saved": "已保存",
  "settings.title": "设置",
  "status.failed": "失败",
  "status.pending": "排队中",
  "status.running": "执行中",
  "status.succeeded": "已完成",
  "status.waitingConfirm": "待确认",
  "translation.importSuccess": "Imported {count} entries. Save to apply.",
  "translation.saveFailed": "Save failed: {message}",
  "translation.saveSuccess": "Saved successfully. {count} entries saved.",
  "translation.saving": "Saving...",
  "unit.image": "张",
  "unit.video": "个",
  "video.duration": "Duration",
  "video.durationDesc": "Choose the video duration",
  "video.firstFrame": "First frame",
  "video.lastFrame": "Last frame",
  "video.maxReferenceImages": "Upload up to {max} reference images",
  "video.option.orientation.landscape": "Landscape",
  "video.option.orientation.portrait": "Portrait",
  "video.orientation": "Orientation",
  "video.orientationDesc": "Choose landscape or portrait",
  "video.referenceImage": "Reference image",
  "workspace.defaultModelDesc": "选择模型，开始创作。",
  "workspace.feature.fusion.desc": "AI 自动对比，生成最优综合答案",
  "workspace.feature.fusion.title": "智能融合",
  "workspace.feature.multiView.desc": "同时调用多个模型，获得不同思路与答案",
  "workspace.feature.multiView.title": "多元视角",
  "workspace.feature.parallel.desc": "多模型同时运算，大幅缩短等待时间",
  "workspace.feature.parallel.title": "并行加速",
  "workspace.feature.quality.desc": "交叉验证，减少幻觉和错误",
  "workspace.feature.quality.title": "质量保障",
  "workspace.generating": "生成中...",
  "workspace.generationFailed": "生成失败",
  "workspace.generationProgress": "生成进度",
  "workspace.generationResult": "生成结果",
  "workspace.imageLoadFailed": "图片加载失败",
  "workspace.placeholder.audio": "输入音频生成需求...",
  "workspace.placeholder.chat": "输入消息，按 Enter 发送...",
  "workspace.placeholder.image": "描述你想要生成的图片...",
  "workspace.placeholder.video": "描述你想要生成的视频...",
  "workspace.quickStart": "快速开始",
  "workspace.shiftEnter": "Shift+Enter 换行",
  "workspace.stepAnalysis": "AI 分析中",
  "workspace.stepDone": "已完成",
  "workspace.stepImageGenerating": "图片生成中",
  "workspace.stepStart": "开始",
  "workspace.stepVideoGenerating": "视频生成中",
  "workspace.submitHint": "选择参数并提交任务。",
  "workspace.tokenBilling": "Token 计费",
  "workspace.viewPricing": "查看价格",
  "workspace.waitImageInput": "输入需求并上传参考图后开始，AI 会生成图片。",
  "workspace.waitVideoInput": "输入需求并上传参考素材后开始，AI 会生成视频。"
};

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminDashboard {
  total_users: number;
  new_users_today: number;
  total_tasks: number;
  tasks_today: number;
  succeeded_tasks: number;
  total_revenue: number;
  online_revenue: number;
  card_recharge_amount: number;
  total_consumption: number;
  consumption_today: number;
  failed_tasks: number;
  active_models: number;
  api_tokens: number;
  api_calls: number;
  api_calls_today: number;
  api_cost: number;
  available_cards: number;
  used_cards: number;
  total_card_face_value: number;
  wallet_balance_total: number;
  published_works: number;
  published_announcements: number;
  referred_users: number;
  active_referrers: number;
  referral_reward_compute: number;
  referral_reward_cash: number;
}

export interface CardBatch {
  id: number;
  name: string;
  type: string;
  value: number;
  quantity: number;
  created_at: string;
}

export interface Order {
  order_no: string;
  channel: string;
  amount: number;
  compute_credited: number;
  status: string;
  paid_at?: string;
  created_at: string;
  user_public_id?: string;
  nickname?: string;
}

export interface RechargeRecord {
  id: number;
  type: string;
  amount: number;
  remark?: string;
  created_at: string;
}

export interface Announcement {
  id: number;
  title: string;
  content: string;
  level: 'info' | 'success' | 'warning';
  is_published: boolean;
  is_forced?: boolean;
  starts_at?: string;
  ends_at?: string;
  created_at: string;
}

export interface Notification {
  id: number;
  title: string;
  content: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export interface CheckinStatus {
  enabled: boolean;
  checked_today: boolean;
  reward: number;
  total_checkins: number;
}

export interface ApiToken {
  id: number;
  name: string;
  prefix: string;
  status: string;
  last_used_at?: string;
  created_at: string;
}

export interface GalleryTag {
  name: string;
  slug: string;
}

export interface GalleryItem {
  public_id: string;
  model_code?: string;
  title?: string;
  prompt?: string;
  cover_url?: string;
  media_url?: string;
  thumbnail_url?: string;
  type: string;
  tags: string[];
  status: string;
  is_featured: boolean;
  is_paid?: boolean;
  price?: number;
  like_count: number;
  created_at: string;
}

export interface WorkflowNode {
  id: string;
  type: 'llm' | 'image' | 'video';
  name: string;
  model_code: string;
  prompt_template: string;
  cost: number;
}

export interface Agent {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  category: string;
  nodes: WorkflowNode[];
  input_schema: Record<string, unknown>;
  price_rule: PriceRule;
  is_enabled: boolean;
}

export interface NodeRun {
  node_id: string;
  name: string;
  type: string;
  status: string;
  output: Record<string, unknown>;
  cost: number;
  duration_ms: number;
  error?: string;
}

export interface WorkflowProject {
  public_id: string;
  workflow_code: string;
  workflow_name: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  estimated_cost: number;
  actual_cost: number;
  error_message?: string;
  node_runs: NodeRun[];
  created_at: string;
}

export interface OperationLog {
  id: number;
  admin_email: string;
  action: string;
  target_type?: string;
  target_id?: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export * from "./videoModel";
export * from "./audioModel";
