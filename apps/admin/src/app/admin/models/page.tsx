"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { adminApi, adminUploadFile } from "@/lib/api";
import { UpstreamIncludeEditor } from "@/components/UpstreamIncludeEditor";
import { AdminPagination } from "@/components/AdminPagination";
import { ModelRoutesEditor } from "@/components/ModelRoutesEditor";
import { imageInterfaceType, withImageInterfaceType } from "@/lib/image-interface";

interface AdminModel {
  id: number;
  code: string;
  display_name: string;
  icon_url?: string;
  new_api_model: string;
  new_api_endpoint: string;
  request_mode: string;
  category: string;
  description?: string;
  tags: string[];
  runtime_rule?: Record<string, any>;
  input_schema: Record<string, unknown>;
  default_params: Record<string, unknown>;
  price_rule: Record<string, unknown>;
  new_api_extra_params?: Record<string, any>;
  is_enabled: boolean;
  sort_order: number;
}

interface ChannelPreset {
  id: number;
  key: string;
  name: string;
  description?: string;
  strategy: string;
  is_fallback_enabled: boolean;
  model_codes: string[];
  is_enabled: boolean;
  sort_order: number;
}

interface ModelConnectionTest {
  ok: boolean;
  message: string;
  status_code?: number;
  latency_ms: number;
}

interface UpstreamModel {
  id: string;
  object?: string;
  owned_by?: string;
  created?: number;
}

const REQUEST_MODES = ["chat_completions", "responses", "images", "video", "audio", "custom"];
const PAGE_SIZE = 10;
const IMAGE_QUALITY_TIERS = ["1K", "2K", "4K"] as const;
const OPENAI_IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
const QWEN_IMAGE_SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536", "1792x1024", "1024x1792", "2048x1536", "1536x2048", "2048x2048"] as const;
type SeedanceVariant = "standard" | "fast" | "mini";
type MiniMaxH3Variant = "standard" | "max";
const MINIMAX_H3_TEMPLATE_KEY = "minimax_h3_v2";
const MINIMAX_H3_MAX_TEMPLATE_KEY = "minimax_h3_max_v2";
const VEO_REFERENCE_TEMPLATE_KEY = "veo_reference_v1";
const VEO_FRAME_PAIR_TEMPLATE_KEY = "veo_frame_pair_v1";
const OMNI_REFERENCE_TEMPLATE_KEY = "omni_reference_v1";
const ALIYUN_QWEN_IMAGE_TEMPLATE_KEY = "aliyun_qwen_image_v3";
const ALIYUN_HAPPYHORSE_TEMPLATE_KEY = "aliyun_happyhorse";
type HappyHorseProfile = "text" | "first_frame" | "reference" | "edit";
const ALIYUN_WAN3_TEMPLATE_KEY = "aliyun_wan3_video";
const ALIYUN_LEGACY_BASE_URL = "https://dashscope.aliyuncs.com";

function canonicalTemplateVideoSize(value: unknown, fallback = "1280x720") {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (/^\d+x\d+$/.test(raw)) return raw;
  if (["portrait", "vertical", "9:16"].includes(raw)) return "720x1280";
  if (["landscape", "horizontal", "16:9"].includes(raw)) return "1280x720";
  return fallback;
}

const buildMiniMaxH3PriceRule = (variant: MiniMaxH3Variant = "standard") => ({
  billing_type: "dynamic",
  strategy: "minimax_h3_seconds",
  currency: "CNY",
  points_per_cny: 1,
  platform_multiplier: 1,
  default_resolution: variant === "max" ? "768P" : "2K",
  default_input_video_seconds: 4,
  rates_per_second: variant === "max"
    ? { "480p": 0.33, "768p": 0.5 }
    : { "768p": 0.5, "2k": 0.8 },
  input_video_rates_per_second: variant === "max"
    ? { "480p": 0.37, "768p": 0.97 }
    : { "768p": 0.5, "2k": 0.8 },
  input_materials_billable: true,
  free_reference_images: variant === "max" ? 0 : 5,
  excess_image_price: variant === "max" ? 0.5 : 0.2,
  fallback_cost: variant === "max" ? 2.5 : 4,
});

const MODEL_BILLING_TYPES = ["per_request", "per_second", "per_token", "per_image", "dynamic"] as const;
type ModelBillingType = (typeof MODEL_BILLING_TYPES)[number];

function switchedPriceRule(current: Record<string, any>, billingType: ModelBillingType, dynamicDefault?: Record<string, any>) {
  const currency = current.currency || "¥";
  if (billingType === "dynamic") return { ...(dynamicDefault || { fallback_cost: Number(current.fallback_cost ?? 1) || 1 }), billing_type: "dynamic", currency };
  if (billingType === "per_token") {
    return {
      billing_type: billingType,
      currency,
      input_price_per_m: Number(current.input_price_per_m ?? 1) || 1,
      output_price_per_m: Number(current.output_price_per_m ?? 1) || 1,
    };
  }
  return { billing_type: billingType, currency, unit_price: Math.max(0, Number(current.unit_price ?? 1) || 0) };
}

const SEEDANCE_TOKENS_PER_SECOND: Record<string, number> = {
  "480p": 10044,
  "720p": 21600,
  "1080p": 48600,
};

const SEEDANCE_VARIANTS: Record<
  SeedanceVariant,
  {
    label: string;
    templateKey: string;
    model: string;
    resolutions: string[];
    allowDraftTask: boolean;
    rates: Record<string, { without_video: number; with_video: number }>;
    fallbackCost: number;
  }
> = {
  standard: {
    label: "Standard",
    templateKey: "volcengine_seedance_2_standard",
    model: "doubao-seedance-2-0-260128",
    resolutions: ["480p", "720p", "1080p"],
    allowDraftTask: true,
    rates: {
      "480p": { without_video: 46, with_video: 28 },
      "720p": { without_video: 46, with_video: 28 },
      "1080p": { without_video: 51, with_video: 31 },
    },
    fallbackCost: 4.97,
  },
  fast: {
    label: "Fast",
    templateKey: "volcengine_seedance_2_fast",
    model: "doubao-seedance-2-0-fast-260128",
    resolutions: ["480p", "720p"],
    allowDraftTask: true,
    rates: {
      "480p": { without_video: 37, with_video: 22 },
      "720p": { without_video: 37, with_video: 22 },
    },
    fallbackCost: 4,
  },
  mini: {
    label: "Mini",
    templateKey: "volcengine_seedance_2_mini",
    model: "doubao-seedance-2-0-mini-260615",
    resolutions: ["480p", "720p"],
    allowDraftTask: false,
    rates: {
      "480p": { without_video: 23, with_video: 14 },
      "720p": { without_video: 23, with_video: 14 },
    },
    fallbackCost: 2.48,
  },
};

const getSeedanceVariantConfig = (variant: SeedanceVariant) => SEEDANCE_VARIANTS[variant];

const getSeedanceVariantByTemplateKey = (templateKey: string): SeedanceVariant | undefined =>
  (Object.keys(SEEDANCE_VARIANTS) as SeedanceVariant[]).find(
    (variant) => SEEDANCE_VARIANTS[variant].templateKey === templateKey
  );

const inferSeedanceVariant = (
  modelName: string,
  runtimeRule?: Record<string, any>,
  templateKey?: string
): SeedanceVariant => {
  const persisted = String(runtimeRule?.video?.seedance_variant ?? runtimeRule?.upstream?.variant ?? "").toLowerCase();
  const text = `${templateKey ?? ""} ${modelName ?? ""} ${persisted}`.toLowerCase();
  if (text.includes("mini")) return "mini";
  if (text.includes("fast")) return "fast";
  return "standard";
};

const buildSeedancePriceRule = (variant: SeedanceVariant) => {
  const config = getSeedanceVariantConfig(variant);
  return {
    billing_type: "dynamic",
    strategy: "seedance_2_tokens",
    currency: "¥",
    points_per_cny: 1,
    platform_multiplier: 1,
    default_resolution: "720p",
    default_input_video_seconds: 4,
    video_min_token_multiplier: 1.8,
    tokens_per_second: Object.fromEntries(
      config.resolutions.map((resolution) => [resolution, SEEDANCE_TOKENS_PER_SECOND[resolution]])
    ),
    rates_per_m_tokens: Object.fromEntries(
      config.resolutions.map((resolution) => [resolution, config.rates[resolution]])
    ),
    fallback_cost: config.fallbackCost,
  };
};

const normalizeImageQuality = (value: unknown) => {
  const text = String(value ?? "").trim().toUpperCase();
  return IMAGE_QUALITY_TIERS.includes(text as (typeof IMAGE_QUALITY_TIERS)[number]) ? text : "1K";
};

const normalizeOpenAIImageQuality = (value: unknown) => {
  const text = String(value ?? "").trim().toLowerCase();
  return OPENAI_IMAGE_QUALITIES.includes(text as (typeof OPENAI_IMAGE_QUALITIES)[number]) ? text : "auto";
};

const inferImageQualityFromModel = (modelName: string) => {
  const text = modelName.toLowerCase();
  if (text.includes("4k")) return "4K";
  if (text.includes("2k")) return "2K";
  return "1K";
};

function ModelLogo({ model }: { model: Pick<AdminModel, "display_name" | "icon_url" | "code"> }) {
  const [failed, setFailed] = useState(false);
  const initial = (model.display_name || model.code || "M").slice(0, 1).toUpperCase();
  if (model.icon_url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={model.icon_url} alt={model.display_name} onError={() => setFailed(true)} className="h-9 w-9 rounded-xl object-cover ring-1 ring-gray-100" />;
  }
  return <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-950 text-xs font-semibold text-white">{initial}</div>;
}

function ConnectionTestIcon({ loading = false }: { loading?: boolean }) {
  if (loading) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 animate-spin fill-none stroke-current" strokeWidth="2">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
      <path d="M8 11V5m8 6V5M6 8h12v3a6 6 0 0 1-6 6v3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 5V3m5 2V3" strokeLinecap="round" />
    </svg>
  );
}

function SeedancePriceInput({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-xs text-gray-500">
      {label}
      <input
        type="number"
        min={0}
        step={step}
        className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
      />
    </label>
  );
}

const BRAND_WORDS: Record<string, string> = {
  gpt: "GPT",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  claude: "Claude",
  gemini: "Gemini",
  glm: "GLM",
  qwen: "Qwen",
  llama: "Llama",
  grok: "Grok",
  kimi: "Kimi",
  minimax: "MiniMax",
  doubao: "Doubao",
  hunyuan: "Hunyuan",
  suno: "Suno",
  sora: "Sora",
  veo: "Veo",
  flux: "FLUX",
  dalle: "DALL·E",
  midjourney: "Midjourney",
  mj: "MJ",
  tts: "TTS",
  ai: "AI",
};

type LobeLogoOption = {
  slug: string;
  label: string;
  file: string;
  keywords: string[];
};

const LOBE_LOGOS: LobeLogoOption[] = [
  { slug: "openai", label: "OpenAI", file: "openai.png", keywords: ["gpt", "gpt-image", "chatgpt", "dall-e", "sora"] },
  { slug: "claude", label: "Claude", file: "claude-color.png", keywords: ["anthropic", "opus", "sonnet", "haiku"] },
  { slug: "anthropic", label: "Anthropic", file: "anthropic.png", keywords: ["claude"] },
  { slug: "deepseek", label: "DeepSeek", file: "deepseek-color.png", keywords: ["deepseek", "r1", "v3"] },
  { slug: "gemini", label: "Gemini", file: "gemini-color.png", keywords: ["google", "gemini", "veo"] },
  { slug: "google", label: "Google", file: "google-color.png", keywords: ["gemini", "veo", "imagen"] },
  { slug: "qwen", label: "Qwen", file: "qwen-color.png", keywords: ["通义", "千问", "alibaba"] },
  { slug: "alibabacloud", label: "Alibaba Cloud", file: "alibabacloud-color.png", keywords: ["阿里云", "aliyun", "通义"] },
  { slug: "zhipu", label: "Zhipu", file: "zhipu-color.png", keywords: ["智谱", "glm"] },
  { slug: "bytedance", label: "ByteDance", file: "bytedance-color.png", keywords: ["字节", "豆包", "doubao"] },
  { slug: "meta", label: "Meta", file: "meta-color.png", keywords: ["llama"] },
  { slug: "mistral", label: "Mistral", file: "mistral-color.png", keywords: ["mixtral"] },
  { slug: "perplexity", label: "Perplexity", file: "perplexity-color.png", keywords: ["sonar"] },
  { slug: "cohere", label: "Cohere", file: "cohere-color.png", keywords: ["command"] },
  { slug: "grok", label: "Grok", file: "grok.png", keywords: ["xai", "x.ai"] },
  { slug: "moonshot", label: "Moonshot", file: "moonshot.png", keywords: ["kimi", "月之暗面"] },
  { slug: "hunyuan", label: "Hunyuan", file: "hunyuan-color.png", keywords: ["腾讯", "tencent"] },
  { slug: "minimax", label: "MiniMax", file: "minimax-color.png", keywords: ["abab"] },
  { slug: "stability", label: "Stability", file: "stability-color.png", keywords: ["stable diffusion", "sd"] },
  { slug: "midjourney", label: "Midjourney", file: "midjourney.png", keywords: ["mj"] },
  { slug: "suno", label: "Suno", file: "suno.png", keywords: ["music", "audio"] },
  { slug: "elevenlabs", label: "ElevenLabs", file: "elevenlabs.png", keywords: ["tts", "voice"] },
  { slug: "microsoft", label: "Microsoft", file: "microsoft-color.png", keywords: ["azure"] },
  { slug: "azure", label: "Azure", file: "azure-color.png", keywords: ["microsoft"] },
  { slug: "bedrock", label: "Bedrock", file: "bedrock-color.png", keywords: ["aws", "amazon"] },
  { slug: "aws", label: "AWS", file: "aws-color.png", keywords: ["amazon", "bedrock"] },
  { slug: "nvidia", label: "NVIDIA", file: "nvidia-color.png", keywords: ["nemotron"] },
  { slug: "groq", label: "Groq", file: "groq.png", keywords: ["llama", "mixtral"] },
  { slug: "openrouter", label: "OpenRouter", file: "openrouter.png", keywords: ["router", "provider"] },
  { slug: "ollama", label: "Ollama", file: "ollama.png", keywords: ["local", "llama", "qwen"] },
  { slug: "huggingface", label: "Hugging Face", file: "huggingface-color.png", keywords: ["hf", "transformers"] },
  { slug: "siliconcloud", label: "SiliconCloud", file: "siliconcloud-color.png", keywords: ["siliconflow", "硅基流动"] },
  { slug: "deepinfra", label: "Deep Infra", file: "deepinfra-color.png", keywords: ["inference"] },
  { slug: "fireworks", label: "Fireworks AI", file: "fireworks-color.png", keywords: [] },
  { slug: "together", label: "Together AI", file: "together-color.png", keywords: [] },
  { slug: "replicate", label: "Replicate", file: "replicate.png", keywords: [] },
  { slug: "novita", label: "Novita AI", file: "novita-color.png", keywords: [] },
  { slug: "sambanova", label: "SambaNova", file: "sambanova-color.png", keywords: [] },
  { slug: "cerebras", label: "Cerebras", file: "cerebras-color.png", keywords: [] },
  { slug: "yi", label: "01.AI / Yi", file: "yi.png", keywords: ["01ai", "零一万物"] },
  { slug: "baichuan", label: "Baichuan", file: "baichuan-color.png", keywords: ["百川"] },
  { slug: "baidu", label: "Baidu / ERNIE", file: "baidu-color.png", keywords: ["文心", "ernie", "百度"] },
  { slug: "stepfun", label: "StepFun", file: "stepfun-color.png", keywords: ["step", "阶跃星辰"] },
  { slug: "internlm", label: "InternLM", file: "internlm-color.png", keywords: ["书生"] },
  { slug: "kling", label: "Kling", file: "kling-color.png", keywords: ["可灵", "video"] },
  { slug: "runway", label: "Runway", file: "runway.png", keywords: ["gen-3", "gen-4", "video"] },
  { slug: "pika", label: "Pika", file: "pika.png", keywords: ["video"] },
  { slug: "vidu", label: "Vidu", file: "vidu-color.png", keywords: ["video", "生数"] },
  { slug: "luma", label: "Luma", file: "luma-color.png", keywords: ["dream machine", "video"] },
  { slug: "ideogram", label: "Ideogram", file: "ideogram.png", keywords: ["image", "text"] },
  { slug: "flux", label: "FLUX", file: "flux.png", keywords: ["black forest labs", "image"] },
  { slug: "recraft", label: "Recraft", file: "recraft.png", keywords: ["image"] },
  { slug: "fal", label: "fal.ai", file: "fal-color.png", keywords: ["image", "video"] },
  { slug: "vertexai", label: "Vertex AI", file: "vertexai.png", keywords: ["google", "gemini"] },
  { slug: "cloudflare", label: "Cloudflare Workers AI", file: "cloudflare-color.png", keywords: ["workers ai"] },
  { slug: "newapi", label: "New API", file: "newapi-color.png", keywords: ["new-api", "代理"] },
  { slug: "aihubmix", label: "AiHubMix", file: "aihubmix-color.png", keywords: ["聚合", "proxy"] },
  { slug: "cometapi", label: "CometAPI", file: "cometapi-color.png", keywords: ["聚合", "proxy"] },
  { slug: "vllm", label: "vLLM", file: "vllm-color.png", keywords: ["self-hosted", "local"] },
  { slug: "lmstudio", label: "LM Studio", file: "lmstudio.png", keywords: ["local"] },
  { slug: "manus", label: "Manus", file: "manus.png", keywords: ["agent"] },
  { slug: "dify", label: "Dify", file: "dify-color.png", keywords: ["workflow", "agent"] },
  { slug: "langchain", label: "LangChain", file: "langchain-color.png", keywords: ["agent", "framework"] },
  { slug: "mcp", label: "MCP", file: "mcp.png", keywords: ["model context protocol", "tool"] },
];

const lobeLogoUrls = (file: string) => [
  `https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/${file}`,
  `https://unpkg.com/@lobehub/icons-static-png@1.91.0/light/${file}`,
];
const lobeLogoUrl = (file: string) => lobeLogoUrls(file)[0];

function LobeLogoImage({ logo, className = "h-6 w-6" }: { logo: LobeLogoOption; className?: string }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={`${className} flex items-center justify-center rounded-md bg-gray-100 text-[10px] font-semibold text-gray-500`}>{logo.label.slice(0, 1)}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={lobeLogoUrls(logo.file)[sourceIndex]}
      alt=""
      className={`${className} object-contain`}
      onError={() => {
        if (sourceIndex < lobeLogoUrls(logo.file).length - 1) setSourceIndex((index) => index + 1);
        else setFailed(true);
      }}
    />
  );
}

/** gpt-5.5 -> "GPT 5.5", gpt-image-2 -> "GPT Image 2", deepseek-v4-pro -> "DeepSeek V4 Pro" */
function suggestDisplayName(model: string): string {
  return model
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((t) => {
      const lower = t.toLowerCase();
      if (BRAND_WORDS[lower]) return BRAND_WORDS[lower];
      if (/^v\d/i.test(t)) return "V" + t.slice(1);
      if (/\d/.test(t)) return t;
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join(" ");
}

/** gpt-5.5 -> gpt-5-5 (legal model code) */
function suggestCode(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface BatchRow {
  model: string;
  code: string;
  name: string;
  codeTouched: boolean;
  nameTouched: boolean;
}

const emptyBatchRow = (): BatchRow => ({ model: "", code: "", name: "", codeTouched: false, nameTouched: false });
const CATEGORIES = ["chat", "multi_collab", "image", "video", "audio"];
const ENDPOINT_BY_MODE: Record<string, string> = {
  chat_completions: "/v1/chat/completions",
  responses: "/v1/responses",
  images: "/v1/images/generations",
  video: "/v1/video/generations",
  audio: "/v1/audio/speech",
  custom: "",
};

const endpointAfterRequestModeChange = (currentEndpoint: string, currentMode: string, nextMode: string) => {
  const endpoint = currentEndpoint.trim();
  const currentDefault = ENDPOINT_BY_MODE[currentMode] || "";
  return !endpoint || endpoint === currentDefault ? (ENDPOINT_BY_MODE[nextMode] || endpoint) : currentEndpoint;
};
const CHAT_ENDPOINT_BY_PROTOCOL: Record<string, string> = {
  openai_compatible: "/v1/chat/completions",
  claude: "/v1/messages",
  gemini: "/v1beta/models/{model}:generateContent",
};

const IMAGE_ENDPOINT_PRESETS = [
  {
    key: ALIYUN_QWEN_IMAGE_TEMPLATE_KEY,
    label: "阿里云百炼 · Qwen-Image 3.0 / Pro",
    endpoint: "/api/v1/services/aigc/multimodal-generation/generation",
    model: "qwen-image-3.0-pro",
    description: "千问图片 3.0 原生同步接口，支持文生图与 1-3 张参考图编辑。",
  },
  {
    key: "openai_images",
    label: "OpenAI / NEW API Images（标准兼容）",
    endpoint: "/v1/images/generations",
    model: "gpt-image-1",
    description: "无参考图走 Generations JSON；有参考图自动走 Edits multipart，quality 仅发送标准值。",
  },
  {
    key: "otuapi_images",
    label: "章鱼哥 Image 生成（同步）",
    endpoint: "/v1/images/generations",
    model: "gpt-image-1",
    description: "保留原图片向导的 1K / 2K / 4K、aspect_ratio 与分档模型路由格式。",
  },
  {
    key: "otuapi_images_async",
    label: "章鱼哥 GPT Image 2（异步）",
    endpoint: "/v1/videos",
    model: "gpt-image-2",
    description: "通过 /v1/videos 创建图片任务，自动轮询并按图片展示结果。",
  },
  {
    key: "banana_async",
    label: "香蕉 Nano Banana 异步图片",
    endpoint: "/v1/videos",
    model: "nano_banana_2",
    description: "章鱼哥 otuapi 香蕉接口，图片生成复用 /v1/videos，平台自动轮询并按图片结果展示。",
  },
];

const BANANA_MODELS = ["nano_banana_2", "nano_banana_pro-1K", "nano_banana_pro-2K", "nano_banana_pro-4K"];

function singleResultAudioSchema(schema: Record<string, unknown>) {
  const properties = { ...((schema?.properties as Record<string, unknown> | undefined) ?? {}) };
  delete properties.count;
  delete properties.n;
  return { ...schema, properties };
}

function singleResultAudioParams(params: Record<string, unknown>) {
  const next = { ...params };
  delete next.count;
  delete next.n;
  return next;
}

interface FormState {
  id: number | null;
  code: string;
  display_name: string;
  icon_url: string;
  new_api_model: string;
  new_api_endpoint: string;
  request_mode: string;
  category: string;
  description: string;
  tags: string;
  sort_order: number;
  is_enabled: boolean;
  input_schema: string;
  default_params: string;
  price_rule: string;
  new_api_extra_params: string;
  runtime_rule: string;
}

interface GenerationLanguageRow {
  code: string;
  short: string;
  name: string;
  prompt_label: string;
  enabled: boolean;
  sort_order: number;
}

const DEFAULT_GENERATION_LANGUAGES: GenerationLanguageRow[] = [
  { code: "zh-CN", short: "ZH", name: "中文（简体）", prompt_label: "Simplified Chinese", enabled: true, sort_order: 10 },
  { code: "en-US", short: "EN", name: "English", prompt_label: "English", enabled: true, sort_order: 20 },
  { code: "ja-JP", short: "JA", name: "日本語", prompt_label: "Japanese", enabled: true, sort_order: 30 },
  { code: "ko-KR", short: "KO", name: "한국어", prompt_label: "Korean", enabled: true, sort_order: 40 },
];

const emptyForm: FormState = {
  id: null,
  code: "",
  display_name: "",
  icon_url: "",
  new_api_model: "",
  new_api_endpoint: "/v1/chat/completions",
  request_mode: "chat_completions",
  category: "chat",
  description: "",
  tags: "",
  sort_order: 0,
  is_enabled: true,
  input_schema: "{}",
  default_params: "{}",
  new_api_extra_params: JSON.stringify(
    {
      connection: {
        protocol: "openai_compatible",
        base_url: "",
        api_key: "",
        auth_type: "bearer",
        api_key_header: "Authorization",
      },
    },
    null,
    2
  ),
  price_rule:
    '{"billing_type":"per_token","currency":"¥","input_price_per_m":2,"output_price_per_m":8,"cache_read_price_per_m":0.2}',
  runtime_rule: '{"capabilities":{"web_search":false,"deep_think":false}}',
};

export default function ModelsPage() {
  const [models, setModels] = useState<AdminModel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formMount, setFormMount] = useState<HTMLElement | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([emptyBatchRow()]);
  const [err, setErr] = useState("");
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [logoSearch, setLogoSearch] = useState("");
  const [logoUploading, setLogoUploading] = useState("");
  const [channelPresets, setChannelPresets] = useState<ChannelPreset[]>([]);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [languageRows, setLanguageRows] = useState<GenerationLanguageRow[]>(DEFAULT_GENERATION_LANGUAGES);
  const [languageErr, setLanguageErr] = useState("");
  const [languageSaving, setLanguageSaving] = useState(false);
  const [audioTemplateKey, setAudioTemplateKey] = useState("");
  const [videoTemplateKey, setVideoTemplateKey] = useState("");
  const [testingModelId, setTestingModelId] = useState<number | null>(null);
  const [connectionTests, setConnectionTests] = useState<Record<number, ModelConnectionTest>>({});
  const [upstreamModels, setUpstreamModels] = useState<UpstreamModel[]>([]);
  const [upstreamModelsLoading, setUpstreamModelsLoading] = useState(false);
  const [upstreamModelsError, setUpstreamModelsError] = useState("");

  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = () => adminApi<AdminModel[]>("/models").then(setModels);
  const loadChannelPresets = () => adminApi<{ items: ChannelPreset[] }>("/channel-presets").then((r) => setChannelPresets(r.items || []));
  const normalizeLanguageRows = (items: unknown): GenerationLanguageRow[] => {
    const list = Array.isArray(items) && items.length ? items : DEFAULT_GENERATION_LANGUAGES;
    const rows = list
      .map((item: any) => ({
        code: String(item?.code || "").trim(),
        short: String(item?.short || "").trim().toUpperCase(),
        name: String(item?.name || "").trim(),
        prompt_label: String(item?.prompt_label || item?.name || "").trim(),
        enabled: item?.enabled !== false,
        sort_order: Number(item?.sort_order ?? 0) || 0,
      }))
      .filter((item) => item.code && item.short && item.name);
    return rows.length ? rows.sort((a, b) => a.sort_order - b.sort_order) : DEFAULT_GENERATION_LANGUAGES;
  };
  const loadLanguages = async () => {
    setLanguageErr("");
    const cfg = await adminApi<Record<string, unknown>>("/system-configs");
    setLanguageRows(normalizeLanguageRows(cfg.generation_languages));
  };
  const openLanguageManager = async () => {
    setLanguageOpen(true);
    try {
      await loadLanguages();
    } catch (e) {
      setLanguageErr(e instanceof Error ? e.message : "读取语言配置失败");
    }
  };
  const updateLanguageRow = (idx: number, patch: Partial<GenerationLanguageRow>) => {
    setLanguageRows((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };
  const saveLanguages = async () => {
    setLanguageErr("");
    const rows = normalizeLanguageRows(languageRows).map((row, idx) => ({
      ...row,
      short: row.short.toUpperCase(),
      sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : (idx + 1) * 10,
    }));
    if (!rows.length) {
      setLanguageErr("至少保留一个语言");
      return;
    }
    const codes = rows.map((row) => row.code.toLowerCase());
    if (new Set(codes).size !== codes.length) {
      setLanguageErr("语言代码不能重复");
      return;
    }
    setLanguageSaving(true);
    try {
      await adminApi("/system-configs", {
        method: "PATCH",
        body: JSON.stringify({ generation_languages: rows }),
      });
      setLanguageRows(rows);
      setLanguageOpen(false);
    } catch (e) {
      setLanguageErr(e instanceof Error ? e.message : "保存语言配置失败");
    } finally {
      setLanguageSaving(false);
    }
  };
  useEffect(() => {
    load();
    loadChannelPresets();
  }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setBatchRows([emptyBatchRow()]);
    setAudioTemplateKey("");
    setVideoTemplateKey("");
    setErr("");
    setUpstreamModels([]);
    setUpstreamModelsError("");
    setShowForm(true);
  };

  const updateBatchRow = (idx: number, patch: Partial<BatchRow>) => {
    setBatchRows((rows) =>
      rows.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        if (patch.model !== undefined) {
          if (!next.codeTouched) next.code = suggestCode(patch.model);
          if (!next.nameTouched) next.name = suggestDisplayName(patch.model);
        }
        return next;
      })
    );
  };

  const openEdit = (m: AdminModel) => {
    setForm({
      id: m.id,
      code: m.code,
      display_name: m.display_name,
      icon_url: m.icon_url || "",
      new_api_model: m.new_api_model,
      new_api_endpoint: m.new_api_endpoint,
      request_mode: m.request_mode,
      category: m.category,
      description: m.description || "",
      tags: (m.tags || []).join(", "),
      sort_order: m.sort_order,
      is_enabled: m.is_enabled,
      input_schema: JSON.stringify(m.input_schema ?? {}, null, 2),
      default_params: JSON.stringify(m.default_params ?? {}, null, 2),
      new_api_extra_params: JSON.stringify(m.new_api_extra_params ?? {}, null, 2),
      price_rule: JSON.stringify(m.price_rule ?? {}, null, 2),
      runtime_rule: JSON.stringify(m.runtime_rule ?? {}, null, 2),
    });
    if (m.new_api_endpoint === "/minimax/v1/t2a_v2") {
      setAudioTemplateKey("yunwu_minimax_speech");
    } else if (m.new_api_endpoint === "/v1/t2a_v2") {
      setAudioTemplateKey("minimax_official_speech");
    } else if (m.new_api_endpoint === "/v1/music_generation") {
      setAudioTemplateKey("minimax_official_music");
    } else if (m.new_api_endpoint === "/api/v1/services/audio/tts/SpeechSynthesizer") {
      setAudioTemplateKey(m.new_api_model.startsWith("cosyvoice") ? "aliyun_cosyvoice" : "aliyun_qwen_audio_tts");
    } else if (m.new_api_endpoint === "/api/v1/services/audio/music/generation") {
      setAudioTemplateKey("aliyun_fun_music");
    } else {
      setAudioTemplateKey("");
    }
    if ((m.runtime_rule as any)?.upstream?.adapter === "volcengine_seedance_2") {
      const variant = inferSeedanceVariant(m.new_api_model, m.runtime_rule);
      setVideoTemplateKey(getSeedanceVariantConfig(variant).templateKey);
    } else if ((m.runtime_rule as any)?.upstream?.adapter === "minimax_h3_v2") {
      setVideoTemplateKey(m.new_api_model === "MiniMax-H3-Max" ? MINIMAX_H3_MAX_TEMPLATE_KEY : MINIMAX_H3_TEMPLATE_KEY);
    } else if ((m.runtime_rule as any)?.upstream?.adapter === "veo_reference_v1") {
      setVideoTemplateKey(VEO_REFERENCE_TEMPLATE_KEY);
    } else if ((m.runtime_rule as any)?.upstream?.adapter === "veo_frame_pair_v1") {
      setVideoTemplateKey(VEO_FRAME_PAIR_TEMPLATE_KEY);
    } else if ((m.runtime_rule as any)?.upstream?.adapter === "omni_reference_v1") {
      setVideoTemplateKey(OMNI_REFERENCE_TEMPLATE_KEY);
    } else if ((m.runtime_rule as any)?.upstream?.adapter === "aliyun_video_generation") {
      setVideoTemplateKey(m.new_api_model === "wan3.0-video" ? ALIYUN_WAN3_TEMPLATE_KEY : ALIYUN_HAPPYHORSE_TEMPLATE_KEY);
    } else {
      setVideoTemplateKey("");
    }
    setErr("");
    setUpstreamModels([]);
    setUpstreamModelsError("");
    setShowForm(true);
  };

  const safeParseJson = (text: string, fallback: any) => {
    try {
      return JSON.parse(text || "{}");
    } catch {
      return fallback;
    }
  };

  const getSeedancePriceRule = (priceRuleText: string, variant: SeedanceVariant) => {
    const defaults = buildSeedancePriceRule(variant);
    const config = getSeedanceVariantConfig(variant);
    const current = safeParseJson(priceRuleText, {}) as Record<string, any>;
    const currentTokens = (current.tokens_per_second ?? {}) as Record<string, unknown>;
    const currentRates = (current.rates_per_m_tokens ?? {}) as Record<string, any>;
    return {
      ...defaults,
      ...current,
      default_resolution: config.resolutions.includes(String(current.default_resolution))
        ? current.default_resolution
        : defaults.default_resolution,
      tokens_per_second: Object.fromEntries(
        config.resolutions.map((resolution) => [
          resolution,
          currentTokens[resolution] ?? defaults.tokens_per_second[resolution],
        ])
      ),
      rates_per_m_tokens: Object.fromEntries(
        config.resolutions.map((resolution) => [
          resolution,
          {
            ...defaults.rates_per_m_tokens[resolution],
            ...((currentRates[resolution] ?? {}) as Record<string, unknown>),
          },
        ])
      ),
    } as Record<string, any>;
  };

  const updateSeedancePriceRule = (
    priceRuleText: string,
    variant: SeedanceVariant,
    updater: (rule: Record<string, any>) => Record<string, any>
  ) => JSON.stringify(updater(getSeedancePriceRule(priceRuleText, variant)), null, 2);

  const getCaps = (runtimeRuleText: string) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const caps = (rr?.capabilities ?? {}) as Record<string, any>;
    return {
      rr,
      web_search: !!caps.web_search,
      deep_think: !!caps.deep_think,
      vision: typeof caps.vision === "boolean" ? caps.vision : typeof caps.image_input === "boolean" ? caps.image_input : caps.multimodal === true,
      video_analysis: typeof caps.video_analysis === "boolean" ? caps.video_analysis : typeof caps.video_input === "boolean" ? caps.video_input : caps.video_understanding === true,
      audio_analysis: typeof caps.audio_analysis === "boolean" ? caps.audio_analysis : typeof caps.audio_input === "boolean" ? caps.audio_input : caps.audio_understanding === true,
    };
  };

  const getReasoning = (runtimeRuleText: string) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const reasoning = (rr?.reasoning ?? {}) as Record<string, any>;
    return {
      rr,
      reasoning,
      mode: String(reasoning.mode ?? ""),
      default_enabled: reasoning.default_enabled === true,
      default_budget: Number(reasoning.default_budget ?? 0),
      max_budget: Number(reasoning.max_budget ?? 0),
    };
  };

  const setReasoning = (runtimeRuleText: string, patch: Record<string, unknown>) => {
    const rr = safeParseJson(runtimeRuleText, {});
    return JSON.stringify({ ...rr, reasoning: { ...((rr?.reasoning ?? {}) as Record<string, any>), ...patch } }, null, 2);
  };

  const clearModelCaps = (runtimeRuleText: string) => {
    const rr = safeParseJson(runtimeRuleText, {});
    return JSON.stringify(
      { ...rr, capabilities: { ...(rr?.capabilities ?? {}), web_search: false, deep_think: false } },
      null,
      2
    );
  };

  const getConnection = (extraText: string) => {
    const extra = safeParseJson(extraText, {});
    const c = (extra?.connection ?? {}) as Record<string, any>;
    return {
      extra,
      provider: String(c.provider ?? ""),
      base_url: String(c.base_url ?? ""),
      api_key: String(c.api_key ?? ""),
      auth_type: String(c.auth_type ?? "bearer"),
      api_key_header: String(c.api_key_header ?? "Authorization"),
      models_endpoint: String(c.models_endpoint ?? "/v1/models"),
      anthropic_version: String(c.anthropic_version ?? "2023-06-01"),
      protocol: String(c.protocol === "new_api" ? "openai_compatible" : c.protocol ?? "openai_compatible"),
    };
  };

  const setConnection = (extraText: string, patch: Record<string, unknown>) => {
    const extra = safeParseJson(extraText, {});
    const prev = (extra?.connection ?? {}) as Record<string, unknown>;
    return JSON.stringify({ ...extra, connection: { ...prev, ...patch } }, null, 2);
  };

  const aliyunWorkspaceBaseURL = (extraText: string) => {
    const current = getConnection(extraText).base_url.trim();
    return current === ALIYUN_LEGACY_BASE_URL ? "" : current;
  };

  const applyNvidiaIntegratePreset = (prev: FormState): FormState => {
    const runtime = safeParseJson(prev.runtime_rule, {}) as Record<string, any>;
    return {
      ...prev,
      category: "chat",
      request_mode: "chat_completions",
      new_api_model: prev.new_api_model || "nvidia/nemotron-3-ultra-550b-a55b",
      new_api_endpoint: "/v1/chat/completions",
      default_params: JSON.stringify({ ...(safeParseJson(prev.default_params, {}) || {}), temperature: 1, top_p: 0.95, max_tokens: 16384 }, null, 2),
      new_api_extra_params: setConnection(prev.new_api_extra_params, {
        provider: "nvidia",
        protocol: "openai_compatible",
        base_url: "https://integrate.api.nvidia.com/v1",
        auth_type: "bearer",
        api_key_header: "Authorization",
        models_endpoint: "/v1/models",
      }),
      runtime_rule: JSON.stringify({
        ...runtime,
        capabilities: { ...(runtime.capabilities || {}), deep_think: true },
        reasoning: { mode: "nvidia_chat_template", default_enabled: false, default_budget: 16384, max_budget: 16384 },
      }, null, 2),
    };
  };

  const listUpstreamModels = async () => {
    setUpstreamModelsLoading(true);
    setUpstreamModelsError("");
    try {
      const payload = form.id
        ? { model_id: form.id }
        : { new_api_extra_params: safeParseJson(form.new_api_extra_params, {}) };
      const result = await adminApi<{ items: UpstreamModel[] }>("/models/upstream-models", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUpstreamModels(result.items || []);
      if (!result.items?.length) setUpstreamModelsError("上游返回成功，但没有可用模型");
    } catch (error) {
      setUpstreamModelsError(error instanceof Error ? error.message : "获取上游模型列表失败");
      setUpstreamModels([]);
    } finally {
      setUpstreamModelsLoading(false);
    }
  };

  const selectUpstreamModel = (model: UpstreamModel) => {
    if (!model.id) return;
    if (form.id) {
      setForm((prev) => ({ ...prev, new_api_model: model.id }));
      return;
    }
    const emptyIndex = batchRows.findIndex((row) => !row.model.trim());
    if (emptyIndex >= 0) {
      updateBatchRow(emptyIndex, { model: model.id });
    } else {
      setBatchRows((rows) => [
        ...rows,
        { model: model.id, code: suggestCode(model.id), name: suggestDisplayName(model.id), codeTouched: false, nameTouched: false },
      ]);
    }
  };

  const getDefaultChannelKey = (defaultParamsText: string) => {
    const defaults = safeParseJson(defaultParamsText, {});
    return String(defaults.channel_key ?? "");
  };

  const setDefaultChannelKey = (defaultParamsText: string, key: string) => {
    const defaults = safeParseJson(defaultParamsText, {});
    return JSON.stringify({ ...defaults, channel_key: key }, null, 2);
  };

  const applyMultiCollabStandard = (prev: FormState): FormState => ({
    ...prev,
    category: "multi_collab",
    request_mode: "chat_completions",
    new_api_model: prev.new_api_model || "multi_collab",
    new_api_endpoint: "",
    input_schema: "{}",
    new_api_extra_params: "{}",
    price_rule: JSON.stringify({ billing_type: "per_token", currency: "¥", input_price_per_m: 0, output_price_per_m: 0 }, null, 2),
    runtime_rule: JSON.stringify(
      { ...safeParseJson(prev.runtime_rule, {}), capabilities: { web_search: false, deep_think: false } },
      null,
      2
    ),
  });

  const getImageRule = (runtimeRuleText: string) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const image = (rr?.image ?? {}) as Record<string, any>;
    const isOpenAIImages = rr?.upstream?.adapter === "openai_images";
    const raw = image.max_reference_images;
    const parsed = raw === undefined || raw === null || raw === "" ? 4 : Number(raw);
    return {
      rr,
      max_reference_images: Math.max(0, Math.min(20, Number.isFinite(parsed) ? parsed : 4)),
      default_quality: isOpenAIImages ? normalizeOpenAIImageQuality(image.default_quality) : normalizeImageQuality(image.default_quality),
      default_size: String(image.default_size || "auto"),
      supported_qualities: (Array.isArray(image.supported_qualities) ? image.supported_qualities : OPENAI_IMAGE_QUALITIES)
        .map(normalizeOpenAIImageQuality)
        .filter((quality: string, index: number, values: string[]) => values.indexOf(quality) === index),
      supported_size_tiers: (Array.isArray(image.supported_size_tiers) ? image.supported_size_tiers : IMAGE_QUALITY_TIERS)
        .map(normalizeImageQuality)
        .filter((tier: string, index: number, values: string[]) => values.indexOf(tier) === index),
      model_by_size: (image.model_by_size || {}) as Record<string, string>,
    };
  };

  const setImageMaxRefs = (runtimeRuleText: string, n: number) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const max = Math.max(0, Math.min(20, Number.isFinite(n) ? n : 4));
    return JSON.stringify(
      {
        ...rr,
        image: { ...(rr?.image ?? {}), max_reference_images: max, reference_images: { ...((rr?.image?.reference_images ?? {}) as Record<string, any>), key: "reference_images", max } },
        capabilities: { ...(rr?.capabilities ?? {}), reference_images: max > 0, web_search: false, deep_think: false },
      },
      null,
      2
    );
  };

  const isBananaImageForm = (state: FormState = form) =>
    state.category === "image" &&
    state.request_mode === "images" &&
    imageInterfaceType(safeParseJson(state.runtime_rule, {}), state.new_api_endpoint, state.new_api_model) === "banana_async";

  const isAliyunQwenImageForm = (state: FormState = form) =>
    state.category === "image" &&
    safeParseJson(state.runtime_rule, {})?.upstream?.adapter === "aliyun_qwen_image_v3";

  const isOpenAIImagesForm = (state: FormState = form) =>
    state.category === "image" &&
    safeParseJson(state.runtime_rule, {})?.upstream?.adapter === "openai_images";

  const imagePresetKey = (state: FormState = form) => {
    const key = imageInterfaceType(safeParseJson(state.runtime_rule, {}), state.new_api_endpoint, state.new_api_model);
    return IMAGE_ENDPOINT_PRESETS.some((preset) => preset.key === key) ? key : "custom";
  };

  const setImageRule = (
    runtimeRuleText: string,
    patch: { adapter?: string; max_reference_images?: number; default_quality?: string; supported_size_tiers?: readonly string[]; model_by_size?: Record<string, string>; poll_path?: string | null; poll_interval_sec?: number | null; poll_timeout_sec?: number | null }
  ) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const image = (rr?.image ?? {}) as Record<string, any>;
    const upstream = (rr?.upstream ?? {}) as Record<string, any>;
    const nextImage = { ...image };
    const useOpenAIQuality = (patch.adapter ?? upstream.adapter) === "openai_images";
    if (patch.max_reference_images !== undefined) {
      const max = Math.max(0, Math.min(20, Number(patch.max_reference_images) || 0));
      nextImage.max_reference_images = max;
      nextImage.reference_images = { ...((nextImage.reference_images ?? {}) as Record<string, any>), key: "reference_images", max };
    }
    if (patch.default_quality !== undefined) {
      nextImage.default_quality = useOpenAIQuality ? normalizeOpenAIImageQuality(patch.default_quality) : normalizeImageQuality(patch.default_quality);
    }
    if (patch.supported_size_tiers !== undefined) {
      nextImage.supported_size_tiers = patch.supported_size_tiers.map(normalizeImageQuality);
    }
    if (patch.model_by_size !== undefined) {
      nextImage.model_by_size = patch.model_by_size;
    }
    const nextUpstream = { ...upstream };
    if (patch.adapter !== undefined) nextUpstream.adapter = patch.adapter;
    if (patch.poll_path === null) delete nextUpstream.poll_path;
    else if (patch.poll_path !== undefined) nextUpstream.poll_path = patch.poll_path;
    if (patch.poll_interval_sec === null) delete nextUpstream.poll_interval_sec;
    else if (patch.poll_interval_sec !== undefined) nextUpstream.poll_interval_sec = patch.poll_interval_sec;
    if (patch.poll_timeout_sec === null) delete nextUpstream.poll_timeout_sec;
    else if (patch.poll_timeout_sec !== undefined) nextUpstream.poll_timeout_sec = patch.poll_timeout_sec;
    return JSON.stringify(
      {
        ...rr,
        image: nextImage,
        upstream: nextUpstream,
        capabilities: { ...(rr?.capabilities ?? {}), reference_images: Number(nextImage.max_reference_images || 0) > 0, web_search: false, deep_think: false },
      },
      null,
      2
    );
  };

  const imageAspectSchema = (values: string[]) =>
    JSON.stringify(
      {
        type: "object",
        properties: {
          aspect_ratio: {
            type: "string",
            title: "图片比例",
            enum: values,
            default: "auto",
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "ratio",
          },
        },
      },
      null,
      2
    );

  const openAIImageSchema = () => {
    const schema = safeParseJson(imageAspectSchema(["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"]), {});
    return JSON.stringify({
      ...schema,
      properties: {
        ...(schema.properties || {}),
        quality: { type: "string", title: "生成质量", enum: OPENAI_IMAGE_QUALITIES, default: "auto", "x-order": 2 },
      },
    }, null, 2);
  };

  const applyImageEndpointPreset = (prev: FormState, presetKey: string): FormState => {
    if (presetKey !== "custom" && !IMAGE_ENDPOINT_PRESETS.some((preset) => preset.key === presetKey)) return prev;
    const next = presetKey === "custom" ? prev : buildImageEndpointPreset(prev, presetKey);
    return { ...next, runtime_rule: withImageInterfaceType(safeParseJson(next.runtime_rule, {}), presetKey) };
  };

  const buildImageEndpointPreset = (prev: FormState, presetKey: string): FormState => {
    const preset = IMAGE_ENDPOINT_PRESETS.find((x) => x.key === presetKey)!;
    if (preset.key === ALIYUN_QWEN_IMAGE_TEMPLATE_KEY) {
      return applyAliyunQwenImageV3(prev);
    }
    if (preset.key === "openai_images") {
      const modelName = prev.new_api_model && !prev.new_api_model.startsWith("nano_banana") ? prev.new_api_model : preset.model;
      const rr = safeParseJson(clearModelCaps(prev.runtime_rule), {});
      const upstream = { ...(rr.upstream || {}) } as Record<string, any>;
      delete upstream.poll_path;
      delete upstream.poll_interval_sec;
      delete upstream.poll_timeout_sec;
      return {
        ...prev,
        category: "image",
        request_mode: "images",
        new_api_endpoint: preset.endpoint,
        new_api_model: modelName,
        input_schema: openAIImageSchema(),
        default_params: JSON.stringify({ aspect_ratio: "auto", quality: "auto", max_reference_images: 4 }, null, 2),
        runtime_rule: JSON.stringify({
          ...rr,
          image: { max_reference_images: 4, reference_images: { key: "reference_images", max: 4 }, default_quality: "auto", supported_qualities: OPENAI_IMAGE_QUALITIES },
          upstream: { ...upstream, adapter: "openai_images", edit_endpoint: "/v1/images/edits" },
          capabilities: { ...(rr.capabilities || {}), reference_images: true, web_search: false, deep_think: false },
        }, null, 2),
        price_rule: JSON.stringify({ billing_type: "per_image", currency: "¥", unit_price: 0.01 }, null, 2),
      };
    }
    const isBanana = preset.key === "banana_async";
    const isAsync = isBanana || preset.key === "otuapi_images_async";
    const modelName = isBanana
      ? (BANANA_MODELS.includes(prev.new_api_model) ? prev.new_api_model : preset.model)
      : isAsync ? (prev.new_api_model.startsWith("gpt-image-2") ? prev.new_api_model : preset.model)
      : (prev.new_api_model && !prev.new_api_model.startsWith("nano_banana") ? prev.new_api_model : preset.model);
    const defaultQuality = inferImageQualityFromModel(modelName);
    const modelBySize: Record<string, string> = isBanana
      ? { "1K": "nano_banana_pro-1K", "2K": "nano_banana_pro-2K", "4K": "nano_banana_pro-4K" }
      : modelName.toLowerCase().startsWith("gpt-image-2")
        ? { "1K": "gpt-image-2", "2K": "gpt-image-2-2K", "4K": "gpt-image-2-4K" }
        : { "1K": modelName };
    return {
      ...prev,
      category: "image",
      request_mode: "images",
      new_api_endpoint: preset.endpoint,
      new_api_model: modelName,
      input_schema: imageAspectSchema(isBanana ? ["auto", "1:1", "9:16", "16:9"] : ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"]),
      default_params: JSON.stringify(
        {
          aspect_ratio: "auto",
          quality: defaultQuality,
          max_reference_images: isBanana ? 5 : getImageRule(prev.runtime_rule).max_reference_images,
        },
        null,
        2
      ),
      runtime_rule: setImageRule(clearModelCaps(prev.runtime_rule), {
        adapter: isBanana ? "otuapi_banana_image" : "otuapi_image",
        max_reference_images: isBanana ? 5 : getImageRule(prev.runtime_rule).max_reference_images,
        default_quality: defaultQuality,
        supported_size_tiers: IMAGE_QUALITY_TIERS,
        model_by_size: modelBySize,
        poll_path: isAsync ? "/v1/videos/{id}" : null,
        poll_interval_sec: isAsync ? 5 : null,
        poll_timeout_sec: isAsync ? 3600 : null,
      }),
      price_rule: JSON.stringify({ billing_type: "per_image", currency: "¥", unit_price: 0.01, unit_price_by_size: { "1K": 0.01, "2K": 0.01, "4K": 0.01 } }, null, 2),
    };
  };

  const applyAliyunQwenImageV3 = (prev: FormState): FormState => ({
    ...prev,
    category: "image",
    request_mode: "images",
    new_api_model: ["qwen-image-3.0", "qwen-image-3.0-pro"].includes(prev.new_api_model)
      ? prev.new_api_model
      : "qwen-image-3.0-pro",
    new_api_endpoint: "/api/v1/services/aigc/multimodal-generation/generation",
    new_api_extra_params: setConnection(prev.new_api_extra_params, {
      provider: "aliyun",
      protocol: "custom_http",
      base_url: aliyunWorkspaceBaseURL(prev.new_api_extra_params),
      auth_type: "bearer",
      api_key_header: "Authorization",
      models_endpoint: "",
    }),
    input_schema: JSON.stringify({
      type: "object",
      properties: {
        prompt_extend: { type: "boolean", title: "智能改写", default: true, "x-order": 1, "x-widget": "boolean_toggle", "x-icon": "sparkles", "x-highlight": true },
        prompt_extend_mode: { type: "string", title: "改写模式", enum: ["direct", "agent"], enumLabels: { direct: "直接增强", agent: "智能体增强" }, default: "direct", "x-order": 2, "x-widget": "option_menu", "x-icon": "wand" },
        enable_thinking: { type: "boolean", title: "思考模式", default: true, "x-order": 3, "x-widget": "boolean_toggle", "x-icon": "sparkles" },
        watermark: { type: "boolean", title: "水印", default: false, "x-order": 4, "x-widget": "boolean_toggle", "x-icon": "target" },
      },
    }, null, 2),
    default_params: JSON.stringify({ count: 1, size: "auto", prompt_extend: true, prompt_extend_mode: "direct", enable_thinking: true, watermark: false, max_reference_images: 3 }, null, 2),
    runtime_rule: JSON.stringify({
      image: { max_reference_images: 3, default_size: "auto", supported_sizes: QWEN_IMAGE_SIZES, count_options: [1, 2, 3, 4, 5, 6], count_max: 6 },
      upstream: { adapter: "aliyun_qwen_image_v3", map: { prompt: "input.prompt" }, request_timeout_sec: 300 },
      capabilities: { web_search: false, deep_think: false },
    }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_image", currency: "¥", unit_price: 0.01 }, null, 2),
  });

  const VIDEO_PROFILES = [
    { value: "single_ref", label: "单参考图 (Sora 类)" },
    { value: "multi_ref", label: "多参考图 1~N (SD 类)" },
    { value: "frame_pair", label: "首尾帧 + 参考图 (VEO 类)" },
    { value: "veo_frame_pair", label: "VEO 首尾帧 1~2 张（无参考图）" },
    { value: "veo_reference", label: "参考图 1~3 张 (VEO 类，文生 / 参考图)" },
    { value: "omni_reference", label: "Omni 参考图 1~7 张 (文生 / 参考图)" },
    { value: "seedance_2", label: "Seedance 2.0 多模态组合" },
    { value: "minimax_h3", label: "MiniMax-H3 V2 多模态组合" },
    { value: "aliyun_multimodal", label: "阿里云 Wan 3.0 多模态组合" },
    { value: "aliyun_happyhorse_text", label: "HappyHorse 文生视频" },
    { value: "aliyun_happyhorse_first_frame", label: "HappyHorse 首帧生视频" },
    { value: "aliyun_happyhorse_reference", label: "HappyHorse 参考生视频" },
    { value: "aliyun_happyhorse_edit", label: "HappyHorse 视频编辑" },
    { value: "none", label: "不上传图片" },
  ];

  const getVideoRule = (runtimeRuleText: string) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const video = (rr?.video ?? {}) as Record<string, any>;
    const ref = (video.reference_images ?? {}) as Record<string, any>;
    return {
      rr,
      upload_profile: video.upload_profile || "single_ref",
      min_reference_images: Number(video.min_reference_images ?? 0),
      max_reference_images: Number(video.max_reference_images ?? 1),
      max_total_images: Number(video.max_total_images ?? 9),
      ref_slot_max: Number(ref.max ?? 4),
      ref_video_max: Number(((video.reference_videos ?? {}) as Record<string, any>).max ?? 3),
      ref_audio_max: Number(((video.reference_audios ?? {}) as Record<string, any>).max ?? 3),
      mode_param: String(video.mode_param || "generation_mode"),
      prompt_hint: video.prompt_hint || "",
      prompt_required: video.prompt_required !== false,
      show_channel: video.show_channel === true,
      show_web_search: video.show_web_search === true,
      count_options: Array.isArray(video.count_options)
        ? video.count_options.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n >= 1)
        : [1, 3, 5, 10, 30, 50],
      count_allow_custom: video.count_allow_custom !== false,
      count_max: Number(video.count_max ?? 50) || 50,
      upstream_include: Array.isArray((rr?.upstream as any)?.include)
        ? ((rr?.upstream as any).include as string[])
        : [],
      upstream_map: JSON.stringify((rr?.upstream as any)?.map ?? {}, null, 2),
    };
  };

  const syncCountSchema = (
    inputSchemaText: string,
    countOptions: number[],
    allowCustom: boolean,
    countMax: number
  ) => {
    const schema = safeParseJson(inputSchemaText, { type: "object", properties: {} }) as Record<string, any>;
    const props = (schema.properties ?? {}) as Record<string, any>;
    if (!props.count) {
      props.count = {
        type: "integer",
        title: "生成数量",
        default: countOptions[0] ?? 1,
        "x-order": 1,
        "x-widget": "option_menu",
        "x-icon": "layers",
        "x-highlight": true,
      };
    }
    props.count.enum = countOptions.length ? countOptions : [1, 3, 5, 10, 30, 50];
    props.count["x-allow-custom"] = allowCustom;
    props.count.minimum = 1;
    props.count.maximum = Math.max(1, countMax);
    schema.properties = props;
    return JSON.stringify(schema, null, 2);
  };

  const setVideoRule = (runtimeRuleText: string, patch: Partial<ReturnType<typeof getVideoRule>>) => {
    const cur = getVideoRule(runtimeRuleText);
    const next = { ...cur, ...patch };
    const include = Array.isArray(next.upstream_include)
      ? next.upstream_include.map((s) => String(s).trim()).filter(Boolean)
      : String(next.upstream_include || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    let mapObj: Record<string, string> = {};
    try {
      mapObj = JSON.parse(next.upstream_map || "{}");
    } catch {
      mapObj = {};
    }
    const rr = safeParseJson(runtimeRuleText, {});
    return JSON.stringify(
      {
        ...rr,
        video: {
          upload_profile: next.upload_profile,
          min_reference_images: next.min_reference_images,
          max_reference_images: next.max_reference_images,
          max_total_images: next.max_total_images,
          count_toward_total: true,
          prompt_hint: next.prompt_hint,
          prompt_required: next.prompt_required,
          show_channel: next.show_channel,
          show_web_search: next.show_web_search,
          count_options: next.count_options?.length ? next.count_options : [1, 3, 5, 10, 30, 50],
          count_allow_custom: next.count_allow_custom,
          count_max: Math.max(1, next.count_max || 50),
          frames: {
            first: { key: "first_frame", label: "首帧", max: 1 },
            last: { key: "last_frame", label: "尾帧", max: 1 },
          },
          reference_images: { key: "reference_images", max: next.ref_slot_max },
          reference_videos: { key: "reference_videos", max: next.ref_video_max },
          reference_audios: { key: "reference_audios", max: next.ref_audio_max },
          mode_param: next.mode_param,
        },
        upstream: { ...(((rr?.upstream as Record<string, unknown>) ?? {}) as Record<string, unknown>), include, map: mapObj },
        capabilities: { ...(rr?.capabilities ?? {}), web_search: false, deep_think: false },
      },
      null,
      2
    );
  };

  const withAudioUpstreamPatch = (runtimeRuleText: string, upstreamPatch: Record<string, unknown>) => {
    const rr = safeParseJson(runtimeRuleText, {});
    return JSON.stringify(
      {
        ...rr,
        upstream: {
          ...(((rr?.upstream as Record<string, unknown>) ?? {}) as Record<string, unknown>),
          ...upstreamPatch,
        },
      },
      null,
      2
    );
  };

  const getAudioRule = (runtimeRuleText: string) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const audio = (rr?.audio ?? {}) as Record<string, any>;
    return {
      rr,
      input_layout: audio.input_layout || "single",
      prompt_hint: audio.prompt_hint || "",
      secondary_prompt_hint: audio.secondary_prompt_hint || "",
      secondary_prompt_key: audio.secondary_prompt_key || "style_prompt",
      billing_hint: audio.billing_hint === "estimated" ? "estimated" : "per_token",
      show_channel: audio.show_channel !== false,
      show_web_search: audio.show_web_search === true,
      show_upload: audio.show_upload === true,
      prompt_required: audio.prompt_required !== false,
      count_options: Array.isArray(audio.count_options)
        ? audio.count_options.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n >= 1)
        : [1, 3, 5, 10, 30, 50],
      count_allow_custom: audio.count_allow_custom !== false,
      count_max: Number(audio.count_max ?? 50) || 50,
      upstream_include: Array.isArray((rr?.upstream as any)?.include)
        ? ((rr?.upstream as any).include as string[])
        : [],
      upstream_map: JSON.stringify((rr?.upstream as any)?.map ?? {}, null, 2),
    };
  };

  const setAudioRule = (runtimeRuleText: string, patch: Partial<ReturnType<typeof getAudioRule>>) => {
    const cur = getAudioRule(runtimeRuleText);
    const next = { ...cur, ...patch };
    const include = Array.isArray(next.upstream_include)
      ? next.upstream_include.map((s) => String(s).trim()).filter(Boolean)
      : String(next.upstream_include || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    let mapObj: Record<string, string> = {};
    try {
      mapObj = JSON.parse(next.upstream_map || "{}");
    } catch {
      mapObj = {};
    }
    const rr = safeParseJson(runtimeRuleText, {});
    return JSON.stringify(
      {
        ...rr,
        audio: {
          input_layout: next.input_layout,
          prompt_hint: next.prompt_hint,
          secondary_prompt_hint: next.secondary_prompt_hint,
          secondary_prompt_key: next.secondary_prompt_key,
          prompt_required: next.prompt_required,
          billing_hint: next.billing_hint,
          show_channel: next.show_channel,
          show_web_search: next.show_web_search,
          show_upload: next.show_upload,
          count_options: next.count_options?.length ? next.count_options : [1, 3, 5, 10, 30, 50],
          count_allow_custom: next.count_allow_custom,
          count_max: Math.max(1, next.count_max || 50),
        },
        upstream: {
          ...(((rr?.upstream as Record<string, unknown>) ?? {}) as Record<string, unknown>),
          include,
          map: mapObj,
        },
        capabilities: { ...(rr?.capabilities ?? {}), web_search: false, deep_think: false },
      },
      null,
      2
    );
  };

  const applyAudioStandard = (prev: FormState): FormState => ({
    ...prev,
    category: "audio",
    request_mode: "audio",
    new_api_model: "speech-2.8-hd",
    new_api_endpoint: ENDPOINT_BY_MODE.audio,
    runtime_rule: setAudioRule(clearModelCaps(prev.runtime_rule), {
      input_layout: "single",
      billing_hint: "per_token",
      count_options: [1, 3, 5, 10, 30, 50],
      count_allow_custom: true,
      count_max: 50,
      prompt_hint: "输入文本内容，选择音色即可生成语音",
      upstream_include: ["voice_id", "emotion", "speed", "format"],
      upstream_map: JSON.stringify(
        {
          prompt: "input",
          voice_id: "voice",
          format: "response_format",
          emotion: "metadata.emotion",
        },
        null,
        2
      ),
    }),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          count: {
            type: "integer",
            title: "生成数量",
            enum: [1, 3, 5, 10, 30, 50],
            default: 1,
            minimum: 1,
            maximum: 50,
            "x-allow-custom": true,
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "layers",
            "x-highlight": true,
          },
          voice_id: {
            type: "string",
            title: "Voice ID",
            enum: ["Chinese (Mandarin)_Warm_Bestie", "Chinese (Mandarin)_Gentleman", "Chinese (Mandarin)_Cute_Spirit", "English_expressive_narrator"],
            enumLabels: {
              "Chinese (Mandarin)_Warm_Bestie": "中文女声 · 温柔闺蜜",
              "Chinese (Mandarin)_Gentleman": "中文男声 · 绅士",
              "Chinese (Mandarin)_Cute_Spirit": "中文女声 · 活泼",
              English_expressive_narrator: "English · Expressive Narrator",
            },
            default: "Chinese (Mandarin)_Warm_Bestie",
            "x-order": 2,
            "x-widget": "option_menu",
            "x-icon": "voice",
            "x-placement": "top",
            "x-highlight": true,
          },
          speed: {
            type: "number",
            title: "语速",
            enum: [0.8, 1, 1.2, 1.5],
            enumLabels: { "0.8": "0.8x", "1": "1.0x", "1.2": "1.2x", "1.5": "1.5x" },
            default: 1,
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "speed",
          },
          emotion: {
            type: "string",
            title: "Emotion",
            enum: ["auto", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "neutral"],
            enumLabels: {
              auto: "自动",
              happy: "开心",
              sad: "悲伤",
              angry: "愤怒",
              fearful: "恐惧",
              disgusted: "厌恶",
              surprised: "惊讶",
              calm: "平静",
              neutral: "中性",
            },
            default: "auto",
            "x-order": 4,
            "x-widget": "option_menu",
            "x-icon": "emotion",
            "x-omit-auto": true,
          },
          format: {
            type: "string",
            title: "输出格式",
            enum: ["mp3", "flac", "pcm"],
            enumLabels: { mp3: "MP3", flac: "FLAC", pcm: "PCM" },
            default: "mp3",
            "x-order": 5,
            "x-widget": "option_menu",
            "x-icon": "format",
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify({ voice_id: "Chinese (Mandarin)_Warm_Bestie", emotion: "auto", speed: 1, format: "mp3" }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_token", currency: "¥", input_price_per_m: 2, output_price_per_m: 4 }, null, 2),
  });

  const applyAudioYunwuMinimaxSpeechStandard = (prev: FormState): FormState => ({
    ...prev,
    category: "audio",
    request_mode: "audio",
    new_api_model: "speech-2.8-hd",
    new_api_endpoint: "/minimax/v1/t2a_v2",
    runtime_rule: withAudioUpstreamPatch(
      setAudioRule(clearModelCaps(prev.runtime_rule), {
        input_layout: "single",
        billing_hint: "per_token",
        count_options: [1, 3, 5, 10, 30, 50],
        count_allow_custom: true,
        count_max: 50,
        prompt_hint: "输入要朗读的文本，选择 Voice ID 和情绪后生成高保真语音。",
        upstream_include: ["voice_id", "emotion", "speed", "format"],
        upstream_map: JSON.stringify(
          {
            prompt: "text",
            voice_id: "voice_setting.voice_id",
            emotion: "voice_setting.emotion",
            speed: "voice_setting.speed",
            format: "audio_setting.format",
          },
          null,
          2
        ),
      }),
      { static: { stream: false }, request_timeout_sec: 900 }
    ),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          count: {
            type: "integer",
            title: "生成数量",
            enum: [1, 3, 5, 10, 30, 50],
            default: 1,
            minimum: 1,
            maximum: 50,
            "x-allow-custom": true,
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "layers",
            "x-highlight": true,
          },
          voice_id: {
            type: "string",
            title: "Voice ID",
            enum: ["male-qn-qingse", "female-shaonv", "female-yujie", "male-qn-jingying", "male-qn-badao"],
            enumLabels: {
              "male-qn-qingse": "男声 · 青涩",
              "female-shaonv": "女声 · 少女",
              "female-yujie": "女声 · 御姐",
              "male-qn-jingying": "男声 · 精英",
              "male-qn-badao": "男声 · 霸道",
            },
            default: "male-qn-qingse",
            "x-order": 2,
            "x-widget": "option_menu",
            "x-icon": "voice",
            "x-placement": "top",
            "x-highlight": true,
          },
          speed: {
            type: "number",
            title: "语速",
            enum: [0.8, 1, 1.15, 1.2, 1.5],
            enumLabels: { "0.8": "0.8x", "1": "1.0x", "1.15": "1.15x", "1.2": "1.2x", "1.5": "1.5x" },
            default: 1.15,
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "speed",
          },
          emotion: {
            type: "string",
            title: "Emotion",
            enum: ["auto", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "neutral"],
            enumLabels: {
              auto: "自动",
              happy: "开心",
              sad: "悲伤",
              angry: "愤怒",
              fearful: "恐惧",
              disgusted: "厌恶",
              surprised: "惊讶",
              calm: "平静",
              neutral: "中性",
            },
            default: "auto",
            "x-order": 4,
            "x-widget": "option_menu",
            "x-icon": "emotion",
            "x-omit-auto": true,
          },
          format: {
            type: "string",
            title: "输出格式",
            enum: ["mp3", "wav", "flac", "pcm"],
            enumLabels: { mp3: "MP3", wav: "WAV", flac: "FLAC", pcm: "PCM" },
            default: "mp3",
            "x-order": 5,
            "x-widget": "option_menu",
            "x-icon": "format",
            "x-placement": "top",
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify({ count: 1, voice_id: "male-qn-qingse", emotion: "auto", speed: 1.15, format: "mp3" }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_token", currency: "¥", input_price_per_m: 2, output_price_per_m: 4 }, null, 2),
  });

  const applyAudioMinimaxOfficialSpeechStandard = (prev: FormState): FormState => {
    const next = applyAudioYunwuMinimaxSpeechStandard(prev);
    return {
      ...next,
      new_api_model: "speech-2.8-hd",
      new_api_endpoint: "/v1/t2a_v2",
      new_api_extra_params: setConnection(next.new_api_extra_params, {
        base_url: "https://api.minimax.cn",
        auth_type: "bearer",
        api_key_header: "Authorization",
      }),
      runtime_rule: withAudioUpstreamPatch(
        setAudioRule(next.runtime_rule, {
          upstream_include: ["model_version", "voice_id", "speed", "vol", "pitch", "emotion", "language_boost", "format", "sample_rate", "bitrate", "channel", "output_format", "subtitle_enable", "subtitle_type", "aigc_watermark"],
          upstream_map: JSON.stringify({
            prompt: "text",
            model_version: "model",
            voice_id: "voice_setting.voice_id",
            speed: "voice_setting.speed",
            vol: "voice_setting.vol",
            pitch: "voice_setting.pitch",
            emotion: "voice_setting.emotion",
            language_boost: "language_boost",
            format: "audio_setting.format",
            sample_rate: "audio_setting.sample_rate",
            bitrate: "audio_setting.bitrate",
            channel: "audio_setting.channel",
          }, null, 2),
        }),
        { static: { stream: false }, request_timeout_sec: 900 }
      ),
      input_schema: JSON.stringify({
        type: "object",
        properties: {
          model_version: { type: "string", title: "模型版本", enum: ["speech-2.8-hd", "speech-2.8-turbo"], enumLabels: { "speech-2.8-hd": "Speech 2.8 HD", "speech-2.8-turbo": "Speech 2.8 Turbo" }, default: "speech-2.8-hd", "x-order": 1, "x-widget": "option_menu", "x-icon": "compass", "x-placement": "top", "x-highlight": true },
          voice_id: { type: "string", title: "Voice ID", enum: ["male-qn-qingse", "female-shaonv", "female-yujie", "male-qn-jingying", "male-qn-badao", "Chinese (Mandarin)_Warm_Bestie", "Chinese (Mandarin)_Gentleman", "English_Graceful_Lady", "English_Insightful_Speaker"], default: "male-qn-qingse", "x-order": 2, "x-widget": "option_menu", "x-icon": "voice", "x-placement": "top", "x-highlight": true },
          speed: { type: "number", title: "语速", enum: [0.5, 0.8, 1, 1.2, 1.5, 2], default: 1, "x-order": 3, "x-widget": "option_menu", "x-icon": "speed" },
          vol: { type: "number", title: "音量", enum: [0.5, 1, 2, 5, 10], default: 1, "x-order": 4, "x-widget": "option_menu", "x-icon": "audio" },
          pitch: { type: "integer", title: "语调", enum: [-12, -6, 0, 6, 12], default: 0, "x-order": 5, "x-widget": "option_menu", "x-icon": "pitch" },
          emotion: { type: "string", title: "情绪", enum: ["auto", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm"], enumLabels: { auto: "自动", happy: "开心", sad: "悲伤", angry: "愤怒", fearful: "恐惧", disgusted: "厌恶", surprised: "惊讶", calm: "中性" }, default: "auto", "x-order": 6, "x-widget": "option_menu", "x-icon": "emotion", "x-omit-auto": true },
          language_boost: { type: "string", title: "语言增强", enum: ["auto", "Chinese", "Chinese,Yue", "English", "Japanese", "Korean", "Vietnamese", "Spanish", "French", "German"], enumLabels: { auto: "自动识别", Chinese: "中文", "Chinese,Yue": "粤语", English: "英语", Japanese: "日语", Korean: "韩语", Vietnamese: "越南语", Spanish: "西班牙语", French: "法语", German: "德语" }, default: "auto", "x-order": 7, "x-widget": "option_menu", "x-icon": "language" },
          format: { type: "string", title: "音频格式", enum: ["mp3", "wav", "flac", "pcm"], default: "mp3", "x-order": 8, "x-widget": "option_menu", "x-icon": "format", "x-placement": "top" },
          sample_rate: { type: "integer", title: "采样率", enum: [16000, 24000, 32000, 44100], default: 32000, "x-order": 9, "x-widget": "option_menu", "x-icon": "audio" },
          bitrate: { type: "integer", title: "码率", enum: [32000, 64000, 128000, 256000], default: 128000, "x-order": 10, "x-widget": "option_menu", "x-icon": "bitrate" },
          channel: { type: "integer", title: "声道", enum: [1, 2], enumLabels: { "1": "单声道", "2": "双声道" }, default: 1, "x-order": 11, "x-widget": "option_menu", "x-icon": "audio" },
          output_format: { type: "string", title: "返回格式", enum: ["hex", "url"], default: "hex", "x-order": 12, "x-widget": "option_menu", "x-icon": "format" },
          subtitle_enable: { type: "boolean", title: "生成字幕", default: false, "x-order": 13, "x-widget": "boolean_toggle", "x-icon": "subtitle" },
          subtitle_type: { type: "string", title: "字幕粒度", enum: ["sentence", "word"], enumLabels: { sentence: "句级", word: "词级" }, default: "sentence", "x-order": 14, "x-widget": "option_menu", "x-icon": "subtitle" },
          aigc_watermark: { type: "boolean", title: "AIGC 水印", default: false, "x-order": 15, "x-widget": "boolean_toggle", "x-icon": "audio" },
        },
      }, null, 2),
      default_params: JSON.stringify({ model_version: "speech-2.8-hd", voice_id: "male-qn-qingse", speed: 1, vol: 1, pitch: 0, emotion: "auto", language_boost: "auto", format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1, output_format: "hex", subtitle_enable: false, subtitle_type: "sentence", aigc_watermark: false }, null, 2),
    };
  };

  const applyAudioMinimaxOfficialTtsStandard = (prev: FormState): FormState => ({
    ...prev,
    category: "audio",
    request_mode: "audio",
    new_api_model: "hailuo-speech-2.8",
    new_api_endpoint: "/v1/audio/speech",
    runtime_rule: setAudioRule(clearModelCaps(prev.runtime_rule), {
      input_layout: "single",
      billing_hint: "per_token",
      count_options: [1, 3, 5, 10, 30, 50],
      count_allow_custom: true,
      count_max: 50,
      prompt_hint: "输入想要朗读的文本内容，选择你的专属克隆音色，一键生成语音",
      show_upload: true,
      upstream_include: ["count", "speed", "pitch", "emotion", "sound_effect", "quality", "reference_audio"],
      upstream_map: JSON.stringify({ count: "n", quality: "model_variant" }, null, 2),
    }),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          count: {
            type: "integer",
            title: "生成数量",
            enum: [1, 3, 5, 10, 30, 50],
            default: 1,
            minimum: 1,
            maximum: 50,
            "x-allow-custom": true,
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "layers",
            "x-highlight": true,
          },
          speed: {
            type: "string",
            title: "语速",
            enum: ["0.8x", "1.0x", "1.2x", "1.5x"],
            default: "1.0x",
            "x-order": 2,
            "x-widget": "option_menu",
            "x-icon": "speed",
          },
          pitch: {
            type: "string",
            title: "音调",
            enum: ["low", "standard", "high"],
            enumLabels: { low: "偏低", standard: "标准", high: "偏高" },
            default: "standard",
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "pitch",
          },
          emotion: {
            type: "string",
            title: "情感",
            enum: ["auto", "neutral", "happy", "sad"],
            enumLabels: { auto: "自动", neutral: "中性", happy: "愉悦", sad: "悲伤" },
            default: "auto",
            "x-order": 4,
            "x-widget": "option_menu",
            "x-icon": "emotion",
          },
          sound_effect: {
            type: "string",
            title: "音效",
            enum: ["none", "reverb", "echo"],
            enumLabels: { none: "无", reverb: "混响", echo: "回声" },
            default: "none",
            "x-order": 5,
            "x-widget": "option_menu",
            "x-icon": "sparkles",
          },
          quality: {
            type: "string",
            title: "合成质量",
            enum: ["turbo", "hd"],
            enumLabels: { turbo: "极速 Turbo", hd: "HD 高清" },
            default: "turbo",
            "x-order": 6,
            "x-widget": "option_menu",
            "x-icon": "compass",
            "x-highlight": true,
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify({ count: 1, speed: "1.0x", pitch: "standard", emotion: "auto", sound_effect: "none", quality: "turbo" }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_token", input_price: 0.000002, output_price: 0.000004 }, null, 2),
  });

  const applyAudioMusicSpeechStandard = (prev: FormState): FormState => ({
    ...prev,
    category: "audio",
    request_mode: "audio",
    new_api_model: "music-2.6",
    new_api_endpoint: "/v1/audio/speech",
    runtime_rule: withAudioUpstreamPatch(
      setAudioRule(clearModelCaps(prev.runtime_rule), {
        input_layout: "dual",
        billing_hint: "estimated",
        count_options: [1],
        count_allow_custom: false,
        count_max: 1,
        prompt_hint: "请输入完整歌词，支持 [Verse]、[Chorus]、[Bridge]、[Outro] 等结构标签。",
        secondary_prompt_hint: "音乐描述：风格、情绪、场景。例如：Mandopop, Festive, Upbeat",
        secondary_prompt_key: "music_prompt",
        show_upload: false,
        upstream_include: ["music_prompt", "format", "sample_rate", "bitrate"],
        upstream_map: JSON.stringify(
          {
            prompt: "metadata.lyrics",
            music_prompt: "input",
            format: "response_format",
            sample_rate: "metadata.sample_rate",
            bitrate: "metadata.bitrate",
          },
          null,
          2
        ),
      }),
      { request_timeout_sec: 900 }
    ),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          format: {
            type: "string",
            title: "音频格式",
            enum: ["mp3", "wav", "pcm"],
            enumLabels: { mp3: "MP3", wav: "WAV", pcm: "PCM" },
            default: "mp3",
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "format",
            "x-placement": "top",
          },
          sample_rate: {
            type: "number",
            title: "采样率",
            enum: [44100],
            enumLabels: { "44100": "44100 Hz" },
            default: 44100,
            "x-order": 2,
            "x-widget": "option_menu",
            "x-icon": "audio",
          },
          bitrate: {
            type: "number",
            title: "码率",
            enum: [128000, 256000],
            enumLabels: { "128000": "128 kbps", "256000": "256 kbps" },
            default: 256000,
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "bitrate",
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify({ format: "mp3", sample_rate: 44100, bitrate: 256000 }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_request", currency: "¥", unit_price: 1 }, null, 2),
  });

  const applyAudioMinimaxOfficialMusicStandard = (prev: FormState): FormState => ({
    ...prev,
    category: "audio",
    request_mode: "audio",
    new_api_model: "music-3.0",
    new_api_endpoint: "/v1/music_generation",
    new_api_extra_params: setConnection(prev.new_api_extra_params, {
      base_url: "https://api.minimax.cn",
      auth_type: "bearer",
      api_key_header: "Authorization",
    }),
    runtime_rule: withAudioUpstreamPatch(
      setAudioRule(clearModelCaps(prev.runtime_rule), {
        input_layout: "dual",
        billing_hint: "estimated",
        count_options: [1],
        count_allow_custom: false,
        count_max: 1,
        prompt_hint: "请输入歌词，支持 [Verse]、[Chorus]、[Bridge]、[Outro] 等结构标签。纯音乐模式可留空。",
        secondary_prompt_hint: "音乐描述：风格、情绪、场景。例如：独立民谣, 忧郁, 内省, 咖啡馆",
        secondary_prompt_key: "music_prompt",
        prompt_required: false,
        show_upload: false,
        upstream_include: ["model_version", "music_prompt", "output_format", "format", "sample_rate", "bitrate", "is_instrumental", "lyrics_optimizer", "aigc_watermark"],
        upstream_map: JSON.stringify(
          {
            prompt: "lyrics",
            music_prompt: "prompt",
            model_version: "model",
            format: "audio_setting.format",
            sample_rate: "audio_setting.sample_rate",
            bitrate: "audio_setting.bitrate",
            is_instrumental: "is_instrumental",
            lyrics_optimizer: "lyrics_optimizer",
            aigc_watermark: "aigc_watermark",
          },
          null,
          2
        ),
      }),
      { static: { stream: false }, request_timeout_sec: 900 }
    ),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          model_version: {
            type: "string",
            title: "模型版本",
            enum: ["music-3.0", "music-2.6"],
            enumLabels: { "music-3.0": "Music-3.0（推荐）", "music-2.6": "Music-2.6（兼容）" },
            default: "music-3.0",
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "compass",
            "x-placement": "top",
            "x-highlight": true,
          },
          output_format: {
            type: "string",
            title: "返回格式",
            enum: ["hex", "url"],
            enumLabels: { hex: "Hex 数据", url: "临时 URL" },
            default: "hex",
            "x-order": 2,
            "x-widget": "option_menu",
            "x-icon": "format",
          },
          format: {
            type: "string",
            title: "音频格式",
            enum: ["mp3", "wav", "pcm"],
            enumLabels: { mp3: "MP3", wav: "WAV", pcm: "PCM" },
            default: "mp3",
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "format",
            "x-placement": "top",
          },
          sample_rate: {
            type: "number",
            title: "采样率",
            enum: [16000, 24000, 32000, 44100],
            enumLabels: { "16000": "16000 Hz", "24000": "24000 Hz", "32000": "32000 Hz", "44100": "44100 Hz" },
            default: 44100,
            "x-order": 4,
            "x-widget": "option_menu",
            "x-icon": "audio",
          },
          bitrate: {
            type: "number",
            title: "码率",
            enum: [32000, 64000, 128000, 256000],
            enumLabels: { "32000": "32 kbps", "64000": "64 kbps", "128000": "128 kbps", "256000": "256 kbps" },
            default: 256000,
            "x-order": 5,
            "x-widget": "option_menu",
            "x-icon": "bitrate",
          },
          is_instrumental: {
            type: "boolean",
            title: "纯音乐",
            default: false,
            "x-order": 6,
            "x-widget": "boolean_toggle",
            "x-icon": "mode",
          },
          lyrics_optimizer: {
            type: "boolean",
            title: "歌词优化",
            default: false,
            "x-order": 7,
            "x-widget": "boolean_toggle",
            "x-icon": "sparkles",
          },
          aigc_watermark: {
            type: "boolean",
            title: "AIGC 水印",
            default: false,
            "x-order": 8,
            "x-widget": "boolean_toggle",
            "x-icon": "audio",
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify(
      {
        model_version: "music-3.0",
        output_format: "hex",
        format: "mp3",
        sample_rate: 44100,
        bitrate: 256000,
        is_instrumental: false,
        lyrics_optimizer: false,
        aigc_watermark: false,
      },
      null,
      2
    ),
    price_rule: JSON.stringify({ billing_type: "per_request", currency: "¥", unit_price: 1 }, null, 2),
  });

  const aliyunAudioConnection = (extra: string) => setConnection(extra, {
    provider: "aliyun",
    protocol: "custom_http",
    base_url: aliyunWorkspaceBaseURL(extra),
    auth_type: "bearer",
    api_key_header: "Authorization",
    models_endpoint: "",
  });

  const applyAliyunTTS = (prev: FormState, family: "qwen" | "cosyvoice"): FormState => {
    const qwen = family === "qwen";
    const voice = qwen ? "longanhuan_v3.6" : "longanyang";
    const voices = qwen
      ? ["longanfengyue", "longanyuanfei", "longanlingxi", "longanxiaoxin", "longanhuan_v3.6", "longjielidou_v3.6", "longpaopao_v3.6", "longhuohuo_v3.6", "longchuanshu_v3.6", "loongmary", "loongeva_v3.6", "loongjohn"]
      : ["longanyang", "longanhuan_v3", "longanhuan", "longhuhu_v3", "longpaopao_v3", "longjielidou_v3", "longjiaxin_v3", "longanyue_v3", "longshange_v3", "loongabby_v3", "loongandy_v3"];
    const voiceLabels = qwen
      ? { longanfengyue: "女声 · 龙安风悦", longanyuanfei: "女声 · 龙安元妃", longanlingxi: "女声 · 龙安灵希", longanxiaoxin: "女声 · 龙安小昕", "longanhuan_v3.6": "女声 · 龙安欢", "longjielidou_v3.6": "男童 · 龙杰力豆", "longpaopao_v3.6": "女童 · 龙泡泡", "longhuohuo_v3.6": "男童 · 龙火火", "longchuanshu_v3.6": "男声 · 龙川叔", loongmary: "女声 · Mary", "loongeva_v3.6": "女声 · Eva", loongjohn: "男声 · John" }
      : { longanyang: "龙安洋", longanhuan_v3: "龙安欢 V3", longanhuan: "龙安欢", longhuhu_v3: "龙呼呼", longpaopao_v3: "龙泡泡", longjielidou_v3: "龙杰力豆", longjiaxin_v3: "龙嘉欣", longanyue_v3: "龙安粤", longshange_v3: "龙陕哥", loongabby_v3: "Abby", loongandy_v3: "Andy" };
    return {
      ...prev,
      category: "audio",
      request_mode: "audio",
      new_api_model: qwen ? "qwen-audio-3.0-tts-flash" : "cosyvoice-v3-flash",
      new_api_endpoint: "/api/v1/services/audio/tts/SpeechSynthesizer",
      new_api_extra_params: aliyunAudioConnection(prev.new_api_extra_params),
      runtime_rule: setAudioRule(clearModelCaps(prev.runtime_rule), {
        input_layout: "single", billing_hint: "per_token", prompt_hint: "输入需要合成的文本，选择音色、格式和采样率",
        show_channel: false, show_web_search: false, show_upload: false,
        count_options: [1], count_allow_custom: false, count_max: 1,
        upstream_include: ["voice", "format", "sample_rate", "instruction"],
        upstream_map: JSON.stringify({ prompt: "input.text", voice: "input.voice", format: "input.format", sample_rate: "input.sample_rate", instruction: "input.instruction" }, null, 2),
      }),
      input_schema: JSON.stringify({
        type: "object",
        properties: {
          voice: { type: "string", title: "音色", enum: voices, enumLabels: voiceLabels, ...(qwen ? { "x-option-genders": { longanfengyue: "female", longanyuanfei: "female", longanlingxi: "female", longanxiaoxin: "female", "longanhuan_v3.6": "female", "longjielidou_v3.6": "male", "longpaopao_v3.6": "female", "longhuohuo_v3.6": "male", "longchuanshu_v3.6": "male", loongmary: "female", "loongeva_v3.6": "female", loongjohn: "male" }, "x-agent-default-by-gender": { male: "longchuanshu_v3.6", female: "longanhuan_v3.6" } } : {}), default: voice, "x-order": 1, "x-widget": "option_menu", "x-icon": "voice", "x-placement": "top", "x-highlight": true },
          format: { type: "string", title: "输出格式", enum: ["wav", "mp3", "pcm"], enumLabels: { wav: "WAV", mp3: "MP3", pcm: "PCM" }, default: "wav", "x-order": 2, "x-widget": "option_menu", "x-icon": "format" },
          sample_rate: { type: "integer", title: "采样率", enum: [16000, 22050, 24000, 48000], enumLabels: { "16000": "16 kHz", "22050": "22.05 kHz", "24000": "24 kHz", "48000": "48 kHz" }, default: 24000, "x-order": 3, "x-widget": "option_menu", "x-icon": "audio" },
          instruction: { type: "string", title: "表达指令", description: "可选：用中文或英文描述语速、情绪、方言或角色风格", "x-order": 4 },
        },
      }, null, 2),
      default_params: JSON.stringify({ voice, format: "wav", sample_rate: 24000 }, null, 2),
      price_rule: JSON.stringify({ billing_type: "per_token", currency: "¥", input_price_per_m: 2, output_price_per_m: 4 }, null, 2),
    };
  };

  const applyAliyunFunMusic = (prev: FormState): FormState => ({
    ...prev,
    category: "audio",
    request_mode: "audio",
    new_api_model: "fun-music-v1",
    new_api_endpoint: "/api/v1/services/audio/music/generation",
    new_api_extra_params: aliyunAudioConnection(prev.new_api_extra_params),
    runtime_rule: withAudioUpstreamPatch(
      setAudioRule(clearModelCaps(prev.runtime_rule), {
        input_layout: "dual", billing_hint: "estimated",
        prompt_hint: "描述音乐风格、场景、情绪和乐器偏好",
        secondary_prompt_hint: "可选：输入自定义歌词。填写后将优先按歌词生成",
        secondary_prompt_key: "lyrics", show_channel: false, show_web_search: false, show_upload: false, prompt_required: false,
        count_options: [1], count_allow_custom: false, count_max: 1,
        upstream_include: ["lyrics", "gender", "is_instrumental", "format", "enable_aigc_watermark"],
        upstream_map: JSON.stringify({ prompt: "input.prompt", lyrics: "input.lyrics", gender: "input.gender", is_instrumental: "input.is_instrumental", format: "input.format", enable_aigc_watermark: "input.enable_aigc_watermark" }, null, 2),
      }),
      { request_timeout_sec: 900 }
    ),
    input_schema: JSON.stringify({
      type: "object",
      properties: {
        gender: { type: "string", title: "演唱声线", enum: ["female", "male"], enumLabels: { female: "女声", male: "男声" }, default: "female", "x-order": 1, "x-widget": "option_menu", "x-icon": "voice", "x-placement": "top", "x-highlight": true },
        is_instrumental: { type: "boolean", title: "纯音乐", default: false, "x-order": 2, "x-widget": "boolean_toggle", "x-icon": "mode" },
        format: { type: "string", title: "输出格式", enum: ["mp3", "wav"], enumLabels: { mp3: "MP3", wav: "WAV" }, default: "mp3", "x-order": 3, "x-widget": "option_menu", "x-icon": "format" },
        enable_aigc_watermark: { type: "boolean", title: "AIGC 水印", default: false, "x-order": 4, "x-widget": "boolean_toggle", "x-icon": "audio" },
      },
    }, null, 2),
    default_params: JSON.stringify({ gender: "female", is_instrumental: false, format: "mp3", enable_aigc_watermark: false }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_request", currency: "¥", unit_price: 1 }, null, 2),
  });

  const applyVideoStandard = (prev: FormState): FormState => ({
    ...prev,
    category: "video",
    request_mode: "video",
    new_api_endpoint: ENDPOINT_BY_MODE.video,
    runtime_rule: setVideoRule(clearModelCaps(prev.runtime_rule), {
      upload_profile: "single_ref",
      max_reference_images: 1,
      min_reference_images: 0,
      count_options: [1, 3, 5, 10, 30, 50],
      count_allow_custom: true,
      count_max: 50,
      upstream_include: ["count", "duration", "orientation", "reference_images"],
      upstream_map: JSON.stringify({ count: "n", orientation: "aspect_ratio" }, null, 2),
    }),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          count: {
            type: "integer",
            title: "生成数量",
            enum: [1, 3, 5, 10, 30, 50],
            default: 1,
            minimum: 1,
            maximum: 50,
            "x-allow-custom": true,
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "layers",
            "x-highlight": true,
          },
          duration: { type: "string", title: "视频时长", enum: ["4s", "8s", "12s"], default: "4s", "x-order": 2, "x-widget": "option_menu", "x-icon": "clock" },
          orientation: { type: "string", title: "画面方向", enum: ["portrait", "landscape"], enumLabels: { portrait: "竖屏", landscape: "横屏" }, default: "portrait", "x-order": 3, "x-widget": "option_menu", "x-icon": "ratio" },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify({ count: 1, duration: "4s", orientation: "portrait" }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_second", unit_price: 0.08 }, null, 2),
  });

  const aliyunVideoConnection = (extra: string) => setConnection(extra, {
    provider: "aliyun",
    protocol: "custom_http",
    base_url: aliyunWorkspaceBaseURL(extra),
    auth_type: "bearer",
    api_key_header: "Authorization",
    models_endpoint: "",
    headers: { "X-DashScope-Async": "enable" },
  });

  const applyAliyunHappyHorse = (prev: FormState, profile: HappyHorseProfile): FormState => ({
    ...prev,
    category: "video",
    request_mode: "video",
    new_api_model: profile === "first_frame" ? "happyhorse-1.1-i2v" : profile === "reference" ? "happyhorse-1.1-r2v" : profile === "edit" ? "happyhorse-1.0-video-edit" : "happyhorse-1.1-t2v",
    new_api_endpoint: "/api/v1/services/aigc/video-generation/video-synthesis",
    new_api_extra_params: aliyunVideoConnection(prev.new_api_extra_params),
    input_schema: JSON.stringify({
      type: "object",
      properties: {
        resolution: { type: "string", title: "分辨率", enum: profile === "edit" ? ["720P", "1080P"] : ["480P", "720P", "1080P"], default: "1080P", "x-order": 1, "x-widget": "option_menu", "x-icon": "4k", "x-highlight": true },
        ...((profile === "text" || profile === "reference") ? { ratio: { type: "string", title: "画面比例", enum: ["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"], default: "16:9", "x-order": 2, "x-widget": "option_menu", "x-icon": "ratio" } } : {}),
        ...(profile !== "edit" ? { duration: { type: "integer", title: "视频时长", enum: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], default: 5, "x-order": 3, "x-widget": "option_menu", "x-icon": "clock" } } : {}),
        ...(profile === "edit" ? { audio_setting: { type: "string", title: "声音设置", enum: ["auto", "origin"], enumLabels: { auto: "自动", origin: "保留原声" }, default: "auto", "x-order": 3, "x-widget": "option_menu", "x-icon": "music" } } : {}),
        watermark: { type: "boolean", title: "水印", default: true, "x-order": 4, "x-widget": "boolean_toggle", "x-icon": "target" },
      },
    }, null, 2),
    default_params: JSON.stringify({ resolution: "1080P", ...((profile === "text" || profile === "reference") ? { ratio: "16:9" } : {}), ...(profile !== "edit" ? { duration: 5 } : { audio_setting: "auto" }), watermark: true }, null, 2),
    runtime_rule: JSON.stringify({
      video: {
        upload_profile: `aliyun_happyhorse_${profile}`,
        min_reference_images: profile === "reference" ? 1 : 0,
        max_reference_images: profile === "first_frame" ? 1 : profile === "reference" ? 9 : profile === "edit" ? 5 : 0,
        prompt_required: profile !== "first_frame",
        prompt_hint: profile === "first_frame" ? "上传首帧图片，可补充描述人物动作、镜头运动和视频效果" : profile === "reference" ? "上传 1～9 张参考图，并在提示词中用 [Image 1] 指代" : profile === "edit" ? "上传一个待编辑视频，可选 0～5 张参考图，并描述编辑指令" : "描述画面内容、主体动作、镜头运动和视觉风格",
        show_channel: false,
        show_web_search: false,
        count_options: [1], count_allow_custom: false, count_max: 1,
        frames: { first: { key: "first_frame", label: "首帧", max: 1 } },
        reference_images: { key: "reference_images", max: profile === "reference" ? 9 : profile === "edit" ? 5 : 0 },
        reference_videos: { key: "reference_videos", max: profile === "edit" ? 1 : 0 },
      },
      upstream: { adapter: "aliyun_video_generation", poll_path: "/api/v1/tasks/{id}", poll_interval_sec: 15, poll_timeout_sec: 1800, request_timeout_sec: 120 },
      capabilities: { web_search: false, deep_think: false },
    }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_second", currency: "¥", unit_price: 0.1 }, null, 2),
  });

  const applyAliyunWan3Video = (prev: FormState): FormState => ({
    ...prev,
    category: "video",
    request_mode: "video",
    new_api_model: "wan3.0-video",
    new_api_endpoint: "/api/v1/services/aigc/video-generation/video-synthesis",
    new_api_extra_params: aliyunVideoConnection(prev.new_api_extra_params),
    input_schema: JSON.stringify({
      type: "object",
      properties: {
        generation_mode: { type: "string", title: "生成模式", enum: ["text", "first_frame", "first_last", "reference"], enumLabels: { text: "文生视频", first_frame: "首帧生视频", first_last: "首尾帧", reference: "多模态参考" }, default: "text", "x-order": 1, "x-widget": "option_menu", "x-icon": "sparkles", "x-highlight": true },
        resolution: { type: "string", title: "分辨率", enum: ["480P", "720P", "1080P"], default: "1080P", "x-order": 2, "x-widget": "option_menu", "x-icon": "4k" },
        ratio: { type: "string", title: "画面比例", enum: ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"], enumLabels: { adaptive: "自适应", "16:9": "16:9", "4:3": "4:3", "1:1": "1:1", "3:4": "3:4", "9:16": "9:16" }, default: "adaptive", "x-order": 3, "x-widget": "option_menu", "x-icon": "ratio" },
        duration: { type: "integer", title: "视频时长", enum: [-1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30], enumLabels: { "-1": "智能时长" }, default: -1, "x-order": 4, "x-widget": "option_menu", "x-icon": "clock" },
        audio: { type: "boolean", title: "生成音频", default: true, "x-order": 5, "x-widget": "boolean_toggle", "x-icon": "music" },
        prompt_extend: { type: "boolean", title: "智能改写", default: true, "x-order": 6, "x-widget": "boolean_toggle", "x-icon": "wand" },
      },
    }, null, 2),
    default_params: JSON.stringify({ generation_mode: "text", resolution: "1080P", ratio: "adaptive", duration: -1, audio: true, prompt_extend: true }, null, 2),
    runtime_rule: JSON.stringify({
      video: {
        upload_profile: "aliyun_multimodal", min_reference_images: 0, max_reference_images: 10, max_total_images: 20, prompt_required: true,
        prompt_hint: "描述目标视频，可结合首尾帧或图片、视频、音频参考素材",
        show_channel: false, show_web_search: false, count_options: [1], count_allow_custom: false, count_max: 1,
        frames: { first: { key: "first_frame", label: "首帧", max: 1 }, last: { key: "last_frame", label: "尾帧", max: 1 } },
        reference_images: { key: "reference_images", max: 10 }, reference_videos: { key: "reference_videos", max: 5 }, reference_audios: { key: "reference_audios", max: 5 }, mode_param: "generation_mode",
      },
      upstream: { adapter: "aliyun_video_generation", poll_path: "/api/v1/tasks/{id}", poll_interval_sec: 15, poll_timeout_sec: 1800, request_timeout_sec: 120 },
      capabilities: { web_search: false, deep_think: false },
    }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_second", currency: "¥", unit_price: 0.1 }, null, 2),
  });

  const applyVeoReferenceV1 = (prev: FormState): FormState => ({
    ...prev,
    category: "video",
    request_mode: "video",
    new_api_model: String(prev.new_api_model || "").toLowerCase().includes("veo")
      ? prev.new_api_model
      : "veo_3_1-fast",
    new_api_endpoint: "/v1/videos",
    new_api_extra_params: setConnection(prev.new_api_extra_params, {
      protocol: "openai_compatible",
      auth_type: "bearer",
      base_url: "https://zexapi.com",
      api_key_header: "Authorization",
    }),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          generation_mode: {
            type: "string",
            title: "生成模式",
            enum: ["text", "reference"],
            enumLabels: { text: "文生视频", reference: "参考图生视频" },
            default: "text",
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "sparkles",
            "x-highlight": true,
          },
          duration: {
            type: "integer",
            title: "视频时长",
            enum: [8],
            enumLabels: { "8": "8s" },
            default: 8,
            "x-order": 2,
            "x-widget": "option_menu",
            "x-icon": "clock",
          },
          size: {
            type: "string",
            title: "视频尺寸",
            enum: ["1280x720", "720x1280", "1920x1080", "1080x1920"],
            enumLabels: {
              "1280x720": "横屏 720P",
              "720x1280": "竖屏 720P",
              "1920x1080": "横屏 1080P",
              "1080x1920": "竖屏 1080P",
            },
            default: "1280x720",
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "ratio",
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify(
      {
        generation_mode: "text",
        duration: 8,
        size: "1280x720",
      },
      null,
      2
    ),
    runtime_rule: JSON.stringify(
      {
        video: {
          upload_profile: "veo_reference",
          min_reference_images: 0,
          max_reference_images: 3,
          max_total_images: 3,
          count_toward_total: true,
          prompt_required: true,
          prompt_hint: "描述目标视频；参考图模式支持上传或从资产库引入 1～3 张图片",
          show_channel: false,
          show_web_search: false,
          count_options: [1],
          count_allow_custom: false,
          count_max: 1,
          mode_param: "generation_mode",
          reference_images: { key: "reference_images", max: 3 },
        },
        upstream: {
          adapter: "veo_reference_v1",
          include: ["generation_mode", "size", "reference_images"],
          map: {},
          poll_path: "/v1/videos/{id}",
          poll_interval_sec: 10,
          poll_timeout_sec: 7200,
          request_timeout_sec: 120,
        },
        capabilities: { web_search: false, deep_think: false },
      },
      null,
      2
    ),
    price_rule: JSON.stringify({ billing_type: "per_request", currency: "¥", unit_price: 1 }, null, 2),
  });

  const applyVeoFramePairV1 = (prev: FormState): FormState => ({
    ...prev,
    category: "video",
    request_mode: "video",
    // fast-fl is frequently unavailable on the distributor; use the documented
    // standard first/last-frame slug and let administrators opt into other -fl tiers.
    new_api_model: "veo_3_1-fl",
    new_api_endpoint: "/v1/videos",
    new_api_extra_params: setConnection(prev.new_api_extra_params, {
      protocol: "openai_compatible",
      auth_type: "bearer",
      base_url: "https://zexapi.com",
      api_key_header: "Authorization",
    }),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          size: {
            type: "string",
            title: "视频尺寸",
            enum: ["1280x720", "720x1280", "1920x1080", "1080x1920"],
            enumLabels: {
              "1280x720": "横屏 720P",
              "720x1280": "竖屏 720P",
              "1920x1080": "横屏 1080P",
              "1080x1920": "竖屏 1080P",
            },
            default: "1280x720",
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "ratio",
            "x-highlight": true,
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify({ size: "1280x720" }, null, 2),
    runtime_rule: JSON.stringify(
      {
        video: {
          upload_profile: "veo_frame_pair",
          min_reference_images: 0,
          max_reference_images: 0,
          max_total_images: 2,
          count_toward_total: true,
          prompt_required: true,
          prompt_hint: "上传 1 张首帧，或同时上传首帧和尾帧；本模板不支持参考图",
          show_channel: false,
          show_web_search: false,
          count_options: [1],
          count_allow_custom: false,
          count_max: 1,
          frames: {
            first: { key: "first_frame", label: "首帧", max: 1 },
            last: { key: "last_frame", label: "尾帧（可选）", max: 1 },
          },
          reference_images: { key: "reference_images", max: 0 },
        },
        upstream: {
          adapter: "veo_frame_pair_v1",
          include: ["size", "first_frame", "last_frame"],
          map: {},
          poll_path: "/v1/videos/{id}",
          poll_interval_sec: 10,
          poll_timeout_sec: 7200,
          request_timeout_sec: 120,
        },
        capabilities: { web_search: false, deep_think: false },
      },
      null,
      2
    ),
    price_rule: JSON.stringify({ billing_type: "per_request", currency: "¥", unit_price: 1 }, null, 2),
  });

  const applyOmniReferenceV1 = (prev: FormState): FormState => ({
    ...prev,
    category: "video",
    request_mode: "video",
    new_api_model: String(prev.new_api_model || "").toLowerCase().includes("omni")
      ? prev.new_api_model
      : "omni_flash-10s",
    new_api_endpoint: "/v1/videos",
    new_api_extra_params: setConnection(prev.new_api_extra_params, {
      protocol: "openai_compatible",
      auth_type: "bearer",
      base_url: "https://zexapi.com",
      api_key_header: "Authorization",
    }),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          generation_mode: {
            type: "string",
            title: "生成模式",
            enum: ["text", "reference"],
            enumLabels: { text: "文生视频", reference: "参考图生视频" },
            default: "text",
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "sparkles",
            "x-highlight": true,
          },
          duration: {
            type: "integer",
            title: "视频时长",
            enum: [10],
            enumLabels: { "10": "10s（模型固定）" },
            default: 10,
            "x-order": 2,
            "x-widget": "option_menu",
            "x-icon": "clock",
          },
          size: {
            type: "string",
            title: "视频尺寸",
            enum: ["1280x720", "720x1280"],
            enumLabels: { "1280x720": "横屏 720P", "720x1280": "竖屏 720P" },
            default: "1280x720",
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "ratio",
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify(
      { generation_mode: "text", duration: 10, size: "1280x720" },
      null,
      2
    ),
    runtime_rule: JSON.stringify(
      {
        video: {
          upload_profile: "omni_reference",
          min_reference_images: 0,
          max_reference_images: 7,
          max_total_images: 7,
          count_toward_total: true,
          prompt_required: true,
          prompt_hint: "描述目标视频；参考图模式支持上传或从资产库引入 1～7 张图片（当前不支持首尾帧）",
          show_channel: false,
          show_web_search: false,
          count_options: [1],
          count_allow_custom: false,
          count_max: 1,
          mode_param: "generation_mode",
          reference_images: { key: "reference_images", max: 7 },
        },
        upstream: {
          adapter: "omni_reference_v1",
          include: ["generation_mode", "size", "reference_images"],
          map: {},
          poll_path: "/v1/videos/{id}",
          poll_interval_sec: 10,
          poll_timeout_sec: 7200,
          request_timeout_sec: 120,
        },
        capabilities: { web_search: false, deep_think: false },
      },
      null,
      2
    ),
    price_rule: JSON.stringify({ billing_type: "per_request", currency: "¥", unit_price: 1 }, null, 2),
  });

  const applyVolcengineSeedance2 = (prev: FormState, variant: SeedanceVariant): FormState => {
    const config = getSeedanceVariantConfig(variant);
    const generationModes = [
      "text",
      "image",
      "video",
      "image_audio",
      "image_video",
      "video_audio",
      "image_video_audio",
      ...(config.allowDraftTask ? ["draft_task"] : []),
    ];
    const generationModeLabels: Record<string, string> = {
      text: "纯文本",
      image: "图片 + 文本（可选）",
      video: "视频 + 文本（可选）",
      image_audio: "图片 + 音频 + 文本（可选）",
      image_video: "图片 + 视频 + 文本（可选）",
      video_audio: "视频 + 音频 + 文本（可选）",
      image_video_audio: "图片 + 视频 + 音频 + 文本（可选）",
      ...(config.allowDraftTask ? { draft_task: "样片任务 ID" } : {}),
    };
    const upstreamInclude = [
      "generation_mode",
      "generate_audio",
      "duration",
      "ratio",
      "resolution",
      "watermark",
      "return_last_frame",
      "priority",
      "reference_images",
      "reference_videos",
      "reference_audios",
      "portrait_asset_id",
      "portrait_asset_type",
      ...(config.allowDraftTask ? ["draft_task_id"] : []),
    ];

    return {
      ...prev,
      category: "video",
      request_mode: "video",
      new_api_model: config.model,
      new_api_endpoint: "/contents/generations/tasks",
      new_api_extra_params: setConnection(prev.new_api_extra_params, {
        protocol: "new_api",
        auth_type: "bearer",
        base_url: "https://ark.cn-beijing.volces.com/api/v3",
        api_key_header: "Authorization",
      }),
      input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          generation_mode: {
            type: "string",
            title: "素材组合",
            enum: generationModes,
            enumLabels: generationModeLabels,
            default: "text",
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "sparkles",
            "x-highlight": true,
          },
          generate_audio: {
            type: "boolean",
            title: "同步音频",
            default: true,
            "x-order": 2,
            "x-widget": "boolean_toggle",
            "x-icon": "music",
            "x-placement": "top",
          },
          duration: {
            type: "integer",
            title: "视频时长",
            enum: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, -1],
            enumLabels: { "4": "4s", "5": "5s", "6": "6s", "7": "7s", "8": "8s", "9": "9s", "10": "10s", "11": "11s", "12": "12s", "13": "13s", "14": "14s", "15": "15s", "-1": "智能时长" },
            default: 5,
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "clock",
          },
          ratio: {
            type: "string",
            title: "画面比例",
            enum: ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
            enumLabels: { adaptive: "智能适配" },
            default: "adaptive",
            "x-order": 4,
            "x-widget": "option_menu",
            "x-icon": "ratio",
          },
          resolution: {
            type: "string",
            title: "分辨率",
            enum: config.resolutions,
            default: "720p",
            "x-order": 5,
            "x-widget": "option_menu",
            "x-icon": "4k",
          },
          watermark: {
            type: "boolean",
            title: "AI 水印",
            default: false,
            "x-order": 6,
            "x-widget": "boolean_toggle",
            "x-icon": "sparkles",
          },
          return_last_frame: {
            type: "boolean",
            title: "返回尾帧",
            default: false,
            "x-order": 7,
            "x-widget": "boolean_toggle",
            "x-icon": "target",
          },
          priority: {
            type: "integer",
            title: "任务优先级",
            enum: [0, 3, 5, 9],
            enumLabels: { "0": "普通", "3": "较高", "5": "高", "9": "最高" },
            default: 0,
            "x-order": 8,
            "x-widget": "option_menu",
            "x-icon": "target",
            "x-placement": "top",
          },
        },
      },
      null,
      2
    ),
      default_params: JSON.stringify(
      {
        generation_mode: "text",
        generate_audio: true,
        duration: 5,
        ratio: "adaptive",
        resolution: "720p",
        watermark: false,
        return_last_frame: false,
        priority: 0,
        portrait_asset_id: "",
        portrait_asset_type: "image",
        ...(config.allowDraftTask ? { draft_task_id: "" } : {}),
      },
      null,
      2
    ),
      runtime_rule: JSON.stringify(
      {
        video: {
          upload_profile: "seedance_2",
          seedance_variant: variant,
          min_reference_images: 0,
          max_reference_images: 9,
          max_total_images: 9,
          count_toward_total: true,
          prompt_hint: "描述目标视频；在素材组合模式下可留空，并可用“图片1 / 视频1 / 音频1”引用素材",
          prompt_required: false,
          show_channel: false,
          show_web_search: false,
          count_options: [1],
          count_allow_custom: false,
          count_max: 1,
          mode_param: "generation_mode",
          reference_images: { key: "reference_images", max: 9 },
          reference_videos: { key: "reference_videos", max: 3 },
          reference_audios: { key: "reference_audios", max: 3 },
        },
        upstream: {
          adapter: "volcengine_seedance_2",
          variant,
          include: upstreamInclude,
          map: {},
          poll_path: "/contents/generations/tasks/{id}",
          poll_interval_sec: 10,
          poll_timeout_sec: 7200,
          request_timeout_sec: 120,
        },
        capabilities: { web_search: false, deep_think: false },
      },
      null,
      2
    ),
      price_rule: JSON.stringify(buildSeedancePriceRule(variant), null, 2),
    };
  };

  const applyMiniMaxH3V2 = (prev: FormState, variant: MiniMaxH3Variant = "standard"): FormState => {
    const isMax = variant === "max";
    const resolutions = isMax ? ["480P", "768P"] : ["768P", "2K"];
    const generationModes = isMax
      ? ["text", "first_frame", "last_frame", "first_last"]
      : ["text", "first_frame", "last_frame", "first_last", "reference"];
    const durations = Array.from({ length: isMax ? 11 : 12 }, (_, index) => index + (isMax ? 5 : 4));
    return ({
    ...prev,
    category: "video",
    request_mode: "video",
    new_api_model: isMax ? "MiniMax-H3-Max" : "MiniMax-H3",
    new_api_endpoint: "/v2/video_generation",
    new_api_extra_params: setConnection(prev.new_api_extra_params, {
      protocol: "new_api",
      auth_type: "bearer",
      base_url: "https://api.minimax.cn",
      api_key_header: "Authorization",
    }),
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          generation_mode: {
            type: "string",
            title: "素材组合",
            enum: generationModes,
            enumLabels: {
              text: "纯文本",
              first_frame: "首帧 + 文本",
              last_frame: "尾帧 + 文本",
              first_last: "首尾帧 + 文本",
              ...(!isMax ? { reference: "多模态参考" } : {}),
            },
            default: "text",
            "x-order": 1,
            "x-widget": "option_menu",
            "x-icon": "sparkles",
            "x-highlight": true,
          },
          duration: {
            type: "integer",
            title: "视频时长",
            enum: durations,
            enumLabels: {
              "4": "4s", "5": "5s", "6": "6s", "7": "7s", "8": "8s", "9": "9s",
              "10": "10s", "11": "11s", "12": "12s", "13": "13s", "14": "14s", "15": "15s",
            },
            default: 5,
            "x-order": 2,
            "x-widget": "option_menu",
            "x-icon": "clock",
          },
          ratio: {
            type: "string",
            title: "画面比例",
            enum: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
            enumLabels: { adaptive: "智能适配" },
            default: "16:9",
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "ratio",
          },
          resolution: {
            type: "string",
            title: "视频分辨率",
            enum: resolutions,
            default: isMax ? "768P" : "2K",
            "x-order": 4,
            "x-widget": "option_menu",
            "x-icon": "4k",
          },
          aigc_watermark: {
            type: "boolean",
            title: "AI 水印",
            default: false,
            "x-order": 5,
            "x-widget": "boolean_toggle",
            "x-icon": "sparkles",
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify(
      {
        generation_mode: "text",
        duration: 5,
        ratio: "16:9",
        resolution: isMax ? "768P" : "2K",
        aigc_watermark: false,
      },
      null,
      2
    ),
    runtime_rule: JSON.stringify(
      {
        video: {
          upload_profile: "minimax_h3",
          min_reference_images: 0,
          max_reference_images: isMax ? 0 : 9,
          max_total_images: isMax ? 2 : 9,
          count_toward_total: true,
          prompt_required: true,
          prompt_hint: isMax
            ? "描述目标视频；支持纯文本、首帧、尾帧或首尾帧快速生成"
            : "描述目标视频；支持首帧、尾帧、首尾帧或图片/视频/音频多模态参考",
          show_channel: false,
          show_web_search: false,
          count_options: [1],
          count_allow_custom: false,
          count_max: 1,
          mode_param: "generation_mode",
          frames: {
            first: { key: "first_frame" },
            last: { key: "last_frame" },
          },
          reference_images: { key: "reference_images", max: isMax ? 0 : 9 },
          reference_videos: { key: "reference_videos", max: isMax ? 0 : 3, max_total_duration: 15 },
          reference_audios: { key: "reference_audios", max: isMax ? 0 : 3, max_total_duration: 15 },
        },
        upstream: {
          adapter: "minimax_h3_v2",
          include: [
            "generation_mode",
            "duration",
            "ratio",
            "resolution",
            "aigc_watermark",
            "first_frame",
            "last_frame",
            "reference_images",
            "reference_videos",
            "reference_audios",
          ],
          map: {},
          poll_path: "/v2/query/video_generation/{id}",
          poll_interval_sec: 10,
          poll_timeout_sec: 7200,
          request_timeout_sec: 120,
        },
        capabilities: { web_search: false, deep_think: false },
      },
      null,
      2
    ),
    price_rule: JSON.stringify(buildMiniMaxH3PriceRule(variant), null, 2),
  });
  };

  const applyImageStandard = (prev: FormState): FormState => ({
    ...applyImageEndpointPreset(prev, prev.new_api_endpoint === "/v1/videos" ? "banana_async" : "openai_images"),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    let inputSchema: unknown, defaultParams: unknown, extraParams: unknown, priceRule: unknown, runtimeRule: unknown;
    const parseJsonField = (label: string, text: string) => {
      try {
        return JSON.parse(text?.trim() || "{}");
      } catch (err) {
        const message = err instanceof Error ? err.message : "invalid JSON";
        throw new Error(`${label} JSON 格式有误：${message}`);
      }
    };
    try {
      inputSchema = parseJsonField("input_schema", form.input_schema);
      defaultParams = parseJsonField("default_params", form.default_params);
      extraParams = parseJsonField("new_api_extra_params", form.new_api_extra_params);
      priceRule = parseJsonField("price_rule", form.price_rule);
      runtimeRule = parseJsonField("runtime_rule", form.runtime_rule);
    } catch {
      setErr("JSON 字段格式有误，请检查 input_schema / default_params / new_api_extra_params / price_rule / runtime_rule");
      return;
    }
    const parsedRuntimeRule = runtimeRule as Record<string, any>;
    const parsedPriceRule = priceRule as Record<string, any>;
    const parsedInputSchema = inputSchema as Record<string, any>;
    if (parsedRuntimeRule?.capabilities?.deep_think === true && parsedRuntimeRule?.reasoning?.mode) {
      const reasoning = parsedRuntimeRule.reasoning as Record<string, any>;
      const defaultBudget = Number(reasoning.default_budget ?? 0);
      const maxBudget = Number(reasoning.max_budget ?? 0);
      const isPositiveInt = (value: number) => Number.isInteger(value) && value > 0;
      if (reasoning.default_budget !== undefined && !isPositiveInt(defaultBudget)) {
        setErr("思考参数配置的默认预算（default_budget）必须是正整数");
        return;
      }
      if (reasoning.max_budget !== undefined && !isPositiveInt(maxBudget)) {
        setErr("思考参数配置的最大预算（max_budget）必须是正整数");
        return;
      }
      if (isPositiveInt(defaultBudget) && isPositiveInt(maxBudget) && defaultBudget > maxBudget) {
        setErr("思考参数配置的默认预算不能大于最大预算");
        return;
      }
    }
    const effectiveEndpoint = form.new_api_endpoint.trim();
    const isSeedance2 =
      form.category === "video" &&
      parsedRuntimeRule?.upstream?.adapter !== "aliyun_video_generation" &&
      (parsedRuntimeRule?.upstream?.adapter === "volcengine_seedance_2" ||
        parsedRuntimeRule?.video?.upload_profile === "seedance_2");
    if (isSeedance2) {
      const variant = inferSeedanceVariant(form.new_api_model, parsedRuntimeRule, videoTemplateKey);
      const config = getSeedanceVariantConfig(variant);
      const schemaResolutions = Array.isArray(parsedInputSchema?.properties?.resolution?.enum)
        ? parsedInputSchema.properties.resolution.enum.map(String)
        : [];
      const unsupportedResolution = schemaResolutions.find((resolution: string) => !config.resolutions.includes(resolution));
      if (unsupportedResolution) {
        setErr(`Seedance 2.0 ${config.label} 不支持 ${unsupportedResolution}，请重新应用对应标准模板`);
        return;
      }
      if (parsedPriceRule.billing_type === "dynamic" && parsedPriceRule.strategy === "seedance_2_tokens") {
        const defaultResolution = String(parsedPriceRule.default_resolution || "");
        if (!config.resolutions.includes(defaultResolution)) {
          setErr(`Seedance 2.0 ${config.label} 默认分辨率必须是 ${config.resolutions.join(" / ")}`);
          return;
        }
        const invalidResolution = config.resolutions.find((resolution) => {
          const tokens = Number(parsedPriceRule.tokens_per_second?.[resolution] ?? 0);
          const withoutVideo = Number(parsedPriceRule.rates_per_m_tokens?.[resolution]?.without_video ?? 0);
          const withVideo = Number(parsedPriceRule.rates_per_m_tokens?.[resolution]?.with_video ?? 0);
          return tokens <= 0 || withoutVideo <= 0 || withVideo <= 0;
        });
        if (invalidResolution) {
          setErr(`Seedance 2.0 ${config.label} 的 ${invalidResolution} Token/秒及两档价格必须大于 0`);
          return;
        }
      }
      const generationModes = Array.isArray(parsedInputSchema?.properties?.generation_mode?.enum)
        ? parsedInputSchema.properties.generation_mode.enum.map(String)
        : [];
      if (!config.allowDraftTask && generationModes.includes("draft_task")) {
        setErr("Seedance 2.0 Mini 不支持样片任务 ID，请重新应用 Mini 标准模板");
        return;
      }
    }
    const isMiniMaxH3 =
      form.category === "video" &&
      (parsedRuntimeRule?.upstream?.adapter === "minimax_h3_v2" ||
        parsedRuntimeRule?.video?.upload_profile === "minimax_h3");
    if (isMiniMaxH3) {
      const miniMaxModel = String(form.new_api_model || "").trim();
      const isMax = miniMaxModel === "MiniMax-H3-Max";
      if (miniMaxModel !== "MiniMax-H3" && !isMax) {
        setErr("MiniMax V2 官方模板的模型 ID 必须是 MiniMax-H3 或 MiniMax-H3-Max");
        return;
      }
      const resolutions = Array.isArray(parsedInputSchema?.properties?.resolution?.enum)
        ? parsedInputSchema.properties.resolution.enum.map(String)
        : [];
      const supportedResolutions = isMax ? ["480P", "768P"] : ["768P", "2K"];
      if (resolutions.length !== supportedResolutions.length || resolutions.some((resolution: string) => !supportedResolutions.includes(resolution.toUpperCase()))) {
        setErr(`${miniMaxModel} 分辨率必须是 ${supportedResolutions.join(" / ")}，请重新应用标准模板`);
        return;
      }
      const modes = Array.isArray(parsedInputSchema?.properties?.generation_mode?.enum)
        ? parsedInputSchema.properties.generation_mode.enum.map(String)
        : [];
      const requiredModes = isMax ? ["text", "first_frame", "last_frame", "first_last"] : ["text", "first_frame", "last_frame", "first_last", "reference"];
      if (modes.length !== requiredModes.length || requiredModes.some((mode) => !modes.includes(mode))) {
        setErr(`${miniMaxModel} 素材组合不完整或包含不支持的模式，请重新应用标准模板`);
        return;
      }
      if (parsedPriceRule.billing_type === "dynamic" && parsedPriceRule.strategy === "minimax_h3_seconds") {
        const invalidRate = supportedResolutions.find((resolution) => Number(parsedPriceRule.rates_per_second?.[resolution.toLowerCase()] ?? 0) <= 0);
        const invalidInputRate = supportedResolutions.find((resolution) => Number(parsedPriceRule.input_video_rates_per_second?.[resolution.toLowerCase()] ?? 0) <= 0);
        if (invalidRate || invalidInputRate || Number(parsedPriceRule.free_reference_images ?? -1) < 0 || Number(parsedPriceRule.excess_image_price ?? 0) <= 0) {
          setErr(`${miniMaxModel} 的分辨率秒价及输入素材价格必须有效`);
          return;
        }
      }
    }
    const isVeoReference =
      form.category === "video" &&
      (parsedRuntimeRule?.upstream?.adapter === "veo_reference_v1" ||
        parsedRuntimeRule?.video?.upload_profile === "veo_reference");
    if (isVeoReference) {
      const props = (parsedInputSchema.properties ?? {}) as Record<string, any>;
      const legacySizeDefault = props.size?.default ?? props.aspect_ratio?.default ?? props.orientation?.default ?? props.ratio?.default
        ?? (defaultParams as Record<string, unknown>)?.size ?? (defaultParams as Record<string, unknown>)?.aspect_ratio
        ?? (defaultParams as Record<string, unknown>)?.orientation ?? (defaultParams as Record<string, unknown>)?.ratio;
      delete props.aspect_ratio;
      delete props.orientation;
      delete props.ratio;
      const currentMode = (props.generation_mode ?? {}) as Record<string, any>;
      const currentModeDefault = ["text", "reference"].includes(String(currentMode.default))
        ? String(currentMode.default)
        : "text";
      props.generation_mode = {
        ...currentMode,
        type: "string",
        title: "生成模式",
        enum: ["text", "reference"],
        enumLabels: { ...(currentMode.enumLabels || {}), text: "文生视频", reference: "参考图生视频" },
        default: currentModeDefault,
        "x-order": Number(currentMode["x-order"] ?? 1),
        "x-widget": "option_menu",
        "x-icon": "sparkles",
        "x-highlight": true,
      };
      const veoReferenceSize = canonicalTemplateVideoSize(legacySizeDefault);
      props.size = {
        ...(props.size || {}),
        type: "string",
        title: "视频尺寸",
        enum: ["1280x720", "720x1280", "1920x1080", "1080x1920"],
        enumLabels: {
          "1280x720": "横屏 720P",
          "720x1280": "竖屏 720P",
          "1920x1080": "横屏 1080P",
          "1080x1920": "竖屏 1080P",
        },
        default: ["1280x720", "720x1280", "1920x1080", "1080x1920"].includes(veoReferenceSize)
          ? veoReferenceSize
          : "1280x720",
        "x-order": 3,
        "x-widget": "option_menu",
        "x-icon": "ratio",
      };
      props.duration = {
        ...(props.duration || {}),
        type: "integer",
        title: "视频时长",
        enum: [8],
        enumLabels: { ...((props.duration || {}).enumLabels || {}), "8": "8s" },
        default: 8,
        "x-order": 2,
        "x-widget": "option_menu",
        "x-icon": "clock",
      };
      parsedInputSchema.properties = props;
      inputSchema = parsedInputSchema;
      const cleanDefaults = { ...((defaultParams as Record<string, unknown>) || {}) };
      delete cleanDefaults.aspect_ratio;
      delete cleanDefaults.orientation;
      delete cleanDefaults.ratio;
      defaultParams = {
        ...cleanDefaults,
        generation_mode: currentModeDefault,
        duration: 8,
        size: canonicalTemplateVideoSize(cleanDefaults.size ?? props.size.default ?? legacySizeDefault),
      };
      const currentVideo = (parsedRuntimeRule.video ?? {}) as Record<string, any>;
      const currentUpstream = (parsedRuntimeRule.upstream ?? {}) as Record<string, any>;
      const include = Array.from(
        new Set([
          ...(Array.isArray(currentUpstream.include) ? currentUpstream.include.map(String).filter((key) => !["aspect_ratio", "orientation", "ratio"].includes(key)) : []),
          "generation_mode",
          "size",
          "reference_images",
        ])
      );
      parsedRuntimeRule.video = {
        ...currentVideo,
        upload_profile: "veo_reference",
        min_reference_images: 0,
        max_reference_images: 3,
        max_total_images: 3,
        mode_param: "generation_mode",
        reference_images: { ...(currentVideo.reference_images || {}), key: "reference_images", max: 3 },
      };
      parsedRuntimeRule.upstream = {
        ...currentUpstream,
        adapter: "veo_reference_v1",
        include,
        map: {},
        poll_path: "/v1/videos/{id}",
        poll_interval_sec: Number(currentUpstream.poll_interval_sec || 10),
        poll_timeout_sec: Number(currentUpstream.poll_timeout_sec || 7200),
        request_timeout_sec: Number(currentUpstream.request_timeout_sec || 120),
      };
      runtimeRule = parsedRuntimeRule;
    }
    const isVeoFramePair =
      form.category === "video" &&
      (parsedRuntimeRule?.upstream?.adapter === "veo_frame_pair_v1" ||
        parsedRuntimeRule?.video?.upload_profile === "veo_frame_pair");
    if (isVeoFramePair) {
      if (!String(form.new_api_model || "").toLowerCase().includes("-fl")) {
        setErr("VEO 首尾帧模板必须使用带 -fl 的模型，例如 veo_3_1-fl");
        return;
      }
      const props = (parsedInputSchema.properties ?? {}) as Record<string, any>;
      const legacySizeDefault = props.size?.default ?? props.aspect_ratio?.default ?? props.orientation?.default ?? props.ratio?.default
        ?? (defaultParams as Record<string, unknown>)?.size ?? (defaultParams as Record<string, unknown>)?.aspect_ratio
        ?? (defaultParams as Record<string, unknown>)?.orientation ?? (defaultParams as Record<string, unknown>)?.ratio;
      delete props.generation_mode;
      delete props.duration;
      delete props.aspect_ratio;
      delete props.orientation;
      delete props.ratio;
      props.size = {
        ...(props.size || {}),
        type: "string",
        title: "视频尺寸",
        enum: ["1280x720", "720x1280", "1920x1080", "1080x1920"],
        enumLabels: {
          "1280x720": "横屏 720P",
          "720x1280": "竖屏 720P",
          "1920x1080": "横屏 1080P",
          "1080x1920": "竖屏 1080P",
        },
        default: ["1280x720", "720x1280", "1920x1080", "1080x1920"].includes(canonicalTemplateVideoSize(legacySizeDefault))
          ? canonicalTemplateVideoSize(legacySizeDefault)
          : "1280x720",
        "x-order": 1,
        "x-widget": "option_menu",
        "x-icon": "ratio",
        "x-highlight": true,
      };
      parsedInputSchema.properties = props;
      inputSchema = parsedInputSchema;
      const cleanDefaults = { ...((defaultParams as Record<string, unknown>) || {}) };
      delete cleanDefaults.generation_mode;
      delete cleanDefaults.duration;
      delete cleanDefaults.aspect_ratio;
      delete cleanDefaults.orientation;
      delete cleanDefaults.ratio;
      defaultParams = {
        ...cleanDefaults,
        size: ["1280x720", "720x1280", "1920x1080", "1080x1920"].includes(canonicalTemplateVideoSize(cleanDefaults.size ?? legacySizeDefault))
          ? canonicalTemplateVideoSize(cleanDefaults.size ?? legacySizeDefault)
          : "1280x720",
      };
      const currentVideo = (parsedRuntimeRule.video ?? {}) as Record<string, any>;
      const currentUpstream = (parsedRuntimeRule.upstream ?? {}) as Record<string, any>;
      parsedRuntimeRule.video = {
        ...currentVideo,
        upload_profile: "veo_frame_pair",
        min_reference_images: 0,
        max_reference_images: 0,
        max_total_images: 2,
        frames: {
          first: { key: "first_frame", label: "首帧", max: 1 },
          last: { key: "last_frame", label: "尾帧（可选）", max: 1 },
        },
        reference_images: { key: "reference_images", max: 0 },
      };
      parsedRuntimeRule.upstream = {
        ...currentUpstream,
        adapter: "veo_frame_pair_v1",
        include: ["size", "first_frame", "last_frame"],
        map: {},
        poll_path: "/v1/videos/{id}",
        poll_interval_sec: Number(currentUpstream.poll_interval_sec || 10),
        poll_timeout_sec: Number(currentUpstream.poll_timeout_sec || 7200),
        request_timeout_sec: Number(currentUpstream.request_timeout_sec || 120),
      };
      runtimeRule = parsedRuntimeRule;
    }
    const isOmniReference =
      form.category === "video" &&
      (parsedRuntimeRule?.upstream?.adapter === "omni_reference_v1" ||
        parsedRuntimeRule?.video?.upload_profile === "omni_reference");
    if (isOmniReference) {
      const props = (parsedInputSchema.properties ?? {}) as Record<string, any>;
      const legacySizeDefault = props.size?.default ?? props.aspect_ratio?.default ?? props.orientation?.default ?? props.ratio?.default
        ?? (defaultParams as Record<string, unknown>)?.size ?? (defaultParams as Record<string, unknown>)?.aspect_ratio
        ?? (defaultParams as Record<string, unknown>)?.orientation ?? (defaultParams as Record<string, unknown>)?.ratio;
      delete props.aspect_ratio;
      delete props.orientation;
      delete props.ratio;
      const currentMode = (props.generation_mode ?? {}) as Record<string, any>;
      const currentModeDefault = ["text", "reference"].includes(String(currentMode.default))
        ? String(currentMode.default)
        : "text";
      props.generation_mode = {
        ...currentMode,
        type: "string",
        title: "生成模式",
        enum: ["text", "reference"],
        enumLabels: { ...(currentMode.enumLabels || {}), text: "文生视频", reference: "参考图生视频" },
        default: currentModeDefault,
        "x-order": 1,
        "x-widget": "option_menu",
        "x-icon": "sparkles",
        "x-highlight": true,
      };
      props.duration = {
        ...(props.duration || {}),
        type: "integer",
        title: "视频时长",
        enum: [10],
        enumLabels: { "10": "10s（模型固定）" },
        default: 10,
        "x-order": 2,
        "x-widget": "option_menu",
        "x-icon": "clock",
      };
      props.size = {
        ...(props.size || {}),
        type: "string",
        title: "视频尺寸",
        enum: ["1280x720", "720x1280"],
        enumLabels: { "1280x720": "横屏 720P", "720x1280": "竖屏 720P" },
        default: ["1280x720", "720x1280"].includes(canonicalTemplateVideoSize(legacySizeDefault)) ? canonicalTemplateVideoSize(legacySizeDefault) : "1280x720",
        "x-order": 3,
        "x-widget": "option_menu",
        "x-icon": "ratio",
      };
      parsedInputSchema.properties = props;
      inputSchema = parsedInputSchema;
      const cleanDefaults = { ...((defaultParams as Record<string, unknown>) || {}) };
      delete cleanDefaults.aspect_ratio;
      delete cleanDefaults.orientation;
      delete cleanDefaults.ratio;
      defaultParams = {
        ...cleanDefaults,
        generation_mode: currentModeDefault,
        duration: 10,
        size: ["1280x720", "720x1280"].includes(canonicalTemplateVideoSize(cleanDefaults.size ?? legacySizeDefault))
          ? canonicalTemplateVideoSize(cleanDefaults.size ?? legacySizeDefault)
          : "1280x720",
      };
      const currentVideo = (parsedRuntimeRule.video ?? {}) as Record<string, any>;
      const currentUpstream = (parsedRuntimeRule.upstream ?? {}) as Record<string, any>;
      parsedRuntimeRule.video = {
        ...currentVideo,
        upload_profile: "omni_reference",
        min_reference_images: 0,
        max_reference_images: 7,
        max_total_images: 7,
        mode_param: "generation_mode",
        reference_images: { ...(currentVideo.reference_images || {}), key: "reference_images", max: 7 },
      };
      parsedRuntimeRule.upstream = {
        ...currentUpstream,
        adapter: "omni_reference_v1",
        include: ["generation_mode", "size", "reference_images"],
        map: {},
        poll_path: "/v1/videos/{id}",
        poll_interval_sec: Number(currentUpstream.poll_interval_sec || 10),
        poll_timeout_sec: Number(currentUpstream.poll_timeout_sec || 7200),
        request_timeout_sec: Number(currentUpstream.request_timeout_sec || 120),
      };
      runtimeRule = parsedRuntimeRule;
    }
    if (isSeedance2 || isMiniMaxH3 || isVeoReference || isOmniReference) {
      const modeParam = String(parsedRuntimeRule?.video?.mode_param || "generation_mode");
      const modeSchema = parsedInputSchema?.properties?.[modeParam] as Record<string, any> | undefined;
      const schemaDefault = modeSchema?.default;
      const modeOptions = Array.isArray(modeSchema?.enum) ? modeSchema.enum.map(String) : [];
      if (schemaDefault !== undefined && schemaDefault !== null && !modeOptions.includes(String(schemaDefault))) {
        setErr(`素材组合默认值 ${String(schemaDefault)} 不在可选项中，请检查 input_schema`);
        return;
      }
      if (schemaDefault !== undefined && schemaDefault !== null) {
        defaultParams = {
          ...((defaultParams as Record<string, unknown>) || {}),
          [modeParam]: schemaDefault,
        };
      }
    }
    const isMultiCollabForm = form.category === "multi_collab";
    const defaultChannelKey = getDefaultChannelKey(form.default_params);
    const connection = getConnection(form.new_api_extra_params);
    if (!isMultiCollabForm && !connection.base_url.trim()) {
      setErr("模型接入配置的 Base URL 为必填");
      return;
    }
    if (!isMultiCollabForm && connection.provider === "aliyun" && !/^https:\/\/[^/{}]+\.maas\.aliyuncs\.com\/?$/i.test(connection.base_url.trim())) {
      setErr("阿里云百炼模型必须填写带 WorkspaceId 的地域 Endpoint，例如 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com");
      return;
    }
    if (!isMultiCollabForm && connection.auth_type !== "none" && !connection.api_key.trim()) {
      setErr("模型接入配置的 API Key 为必填");
      return;
    }
    if (isMultiCollabForm && !defaultChannelKey) {
      setErr("多模型协作请默认选择一个渠道预设");
      return;
    }
    const imageMaxReferences = getImageRule(form.runtime_rule).max_reference_images;
    const payload = {
      code: form.code,
      display_name: form.display_name,
      icon_url: form.icon_url,
      new_api_model: isMultiCollabForm ? form.code || "multi_collab" : form.new_api_model,
      new_api_endpoint: isMultiCollabForm ? "" : effectiveEndpoint,
      request_mode: isMultiCollabForm ? "chat_completions" : form.request_mode,
      category: form.category,
      description: form.description,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      input_schema: form.category === "audio" ? singleResultAudioSchema(inputSchema as Record<string, unknown>) : inputSchema,
      default_params: isMultiCollabForm
        ? { ...(defaultParams as Record<string, unknown>), channel_key: defaultChannelKey }
        : form.category === "audio"
          ? singleResultAudioParams(defaultParams as Record<string, unknown>)
          : defaultParams,
      new_api_extra_params: isMultiCollabForm ? {} : extraParams,
      price_rule: priceRule,
      runtime_rule:
        form.category === "image"
          ? {
              ...(runtimeRule as Record<string, unknown>),
              image: isAliyunQwenImageForm()
                ? {
                    ...(((runtimeRule as Record<string, any>)?.image ?? {}) as Record<string, unknown>),
                    max_reference_images: imageMaxReferences,
                    reference_images: {
                      ...(((runtimeRule as Record<string, any>)?.image?.reference_images ?? {}) as Record<string, unknown>),
                      key: "reference_images",
                      max: imageMaxReferences,
                    },
                    default_size: getImageRule(form.runtime_rule).default_size,
                    default_quality: undefined,
                  }
                : {
                    ...(((runtimeRule as Record<string, any>)?.image ?? {}) as Record<string, unknown>),
                    max_reference_images: getImageRule(form.runtime_rule).max_reference_images,
                    default_quality: getImageRule(form.runtime_rule).default_quality,
                  },
              capabilities: {
                ...(((runtimeRule as Record<string, any>)?.capabilities ?? {}) as Record<string, unknown>),
                web_search: false,
                deep_think: false,
              },
            }
          : form.category === "video"
            ? JSON.parse(
                setVideoRule(
                  JSON.stringify(runtimeRule),
                  getVideoRule(JSON.stringify(runtimeRule))
                )
              )
            : form.category === "audio"
              ? JSON.parse(setAudioRule(form.runtime_rule, getAudioRule(form.runtime_rule)))
              : runtimeRule,
      is_enabled: form.is_enabled,
      sort_order: Number(form.sort_order) || 0,
    };
    if (form.id || isMultiCollabForm) {
      try {
        if (form.id) {
          await adminApi(`/models/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        } else {
          await adminApi("/models", { method: "POST", body: JSON.stringify(payload) });
        }
        setShowForm(false);
        load();
      } catch (e2) {
        setErr(e2 instanceof Error ? e2.message : "保存失败");
      }
      return;
    }

    // Batch create: one model per row, sharing connection / endpoint / pricing etc.
    const rows = batchRows
      .map((r) => ({ ...r, model: r.model.trim(), code: r.code.trim(), name: r.name.trim() }))
      .filter((r) => r.model || r.code || r.name);
    if (rows.length === 0) {
      setErr("请至少填写一个接入模型");
      return;
    }
    for (const r of rows) {
      if (!r.model || !r.code || !r.name) {
        setErr("每行的上游模型名 / 模型编码 / 展示名称均为必填");
        return;
      }
    }
    const codes = rows.map((r) => r.code);
    if (new Set(codes).size !== codes.length) {
      setErr("模型编码重复，请检查批量行");
      return;
    }
    const existingCodes = new Set(models.map((m) => m.code));
    const duplicatedExisting = rows.filter((r) => existingCodes.has(r.code)).map((r) => r.code);
    if (duplicatedExisting.length > 0) {
      setErr(`模型编码已存在：${duplicatedExisting.join("、")}。请换一个编码，或点击已有模型进入编辑。`);
      return;
    }

    const failures: { row: BatchRow; message: string }[] = [];
    const succeeded: string[] = [];
    for (const row of rows) {
      try {
        await adminApi("/models", {
          method: "POST",
          body: JSON.stringify({ ...payload, code: row.code, display_name: row.name, new_api_model: row.model }),
        });
        succeeded.push(row.code);
      } catch (e2) {
        failures.push({ row, message: e2 instanceof Error ? e2.message : "创建失败" });
      }
    }
    load();
    if (failures.length === 0) {
      setShowForm(false);
      return;
    }
    // Keep only failed rows in the form so they can be fixed and resubmitted.
    setBatchRows(failures.map((f) => f.row));
    setErr(
      `${succeeded.length ? `已创建：${succeeded.join("、")}；` : ""}失败：${failures
        .map((f) => `${f.row.code}（${f.message}）`)
        .join("、")}`
    );
  };

  const toggleEnabled = async (m: AdminModel) => {
    try {
      setErr("");
      await adminApi(`/models/${m.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_enabled: !m.is_enabled }),
      });
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "切换模型状态失败");
    }
  };

  const testConnection = async (m: AdminModel) => {
    if (testingModelId !== null) return;
    setTestingModelId(m.id);
    setConnectionTests((current) => {
      const next = { ...current };
      delete next[m.id];
      return next;
    });
    try {
      const result = await adminApi<ModelConnectionTest>(`/models/${m.id}/test-connection`, { method: "POST" });
      setConnectionTests((current) => ({ ...current, [m.id]: result }));
    } catch (error) {
      setConnectionTests((current) => ({
        ...current,
        [m.id]: {
          ok: false,
          message: error instanceof Error ? error.message : "测试连接失败",
          latency_ms: 0,
        },
      }));
    } finally {
      setTestingModelId(null);
    }
  };

  const remove = async (m: AdminModel) => {
    if (
      !confirm(
        `确认删除模型「${m.display_name}」？\n\n删除后前台将不再展示该模型；历史对话/任务/作品记录会保留，但不再关联此模型。`
      )
    ) {
      return;
    }
    try {
      await adminApi(`/models/${m.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return models.filter((m) => {
      if (filterCategory && m.category !== filterCategory) return false;
      if (filterStatus === "enabled" && !m.is_enabled) return false;
      if (filterStatus === "disabled" && m.is_enabled) return false;
      if (kw && !m.code.toLowerCase().includes(kw) && !m.display_name.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [models, filterCategory, filterStatus, search]);
  const paginated = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [filterCategory, filterStatus, search]);

  const filteredLogos = useMemo(() => {
    const kw = logoSearch.trim().toLowerCase();
    if (!kw) return LOBE_LOGOS;
    return LOBE_LOGOS.filter((logo) =>
      [logo.slug, logo.label, ...logo.keywords].some((text) => text.toLowerCase().includes(kw))
    );
  }, [logoSearch]);

  const enabledChannelPresets = useMemo(
    () => channelPresets.filter((p) => p.is_enabled).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [channelPresets]
  );

  const field = (label: string, node: React.ReactNode) => (
    <div className="flex flex-col">
      <label className="text-xs text-gray-500">{label}</label>
      {node}
    </div>
  );

  const uploadLogo = async (file: File) => {
    const url = await adminUploadFile(file);
    setForm((prev) => ({ ...prev, icon_url: url }));
  };

  const chooseLobeLogo = async (logo: LobeLogoOption) => {
    setLogoUploading(logo.slug);
    setErr("");
    try {
      const url = lobeLogoUrl(logo.file);
      const imported = await adminApi<{ url: string }>("/upload/import-image", {
        method: "POST",
        body: JSON.stringify({ url, urls: lobeLogoUrls(logo.file), filename: logo.file }),
      });
      setForm((prev) => ({ ...prev, icon_url: imported.url }));
      setLogoPickerOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "选择 Lobe 图标失败，请稍后重试");
    } finally {
      setLogoUploading("");
    }
  };

  const currentPriceRule = safeParseJson(form.price_rule, {}) as Record<string, any>;
  const currentRuntimeRule = safeParseJson(form.runtime_rule, {}) as Record<string, any>;
  const seedanceVariant = inferSeedanceVariant(form.new_api_model, currentRuntimeRule, videoTemplateKey);
  const seedanceVariantConfig = getSeedanceVariantConfig(seedanceVariant);
  const seedancePriceRule = getSeedancePriceRule(form.price_rule, seedanceVariant);
  const isSeedanceVideoForm =
    form.category === "video" &&
    (videoTemplateKey.startsWith("volcengine_seedance_2_") ||
      getVideoRule(form.runtime_rule).upload_profile === "seedance_2" ||
      currentRuntimeRule?.upstream?.adapter === "volcengine_seedance_2");
  const isSeedanceDynamicPrice =
    isSeedanceVideoForm &&
    currentPriceRule.billing_type === "dynamic" && currentPriceRule.strategy === "seedance_2_tokens";
  const miniMaxH3Variant: MiniMaxH3Variant = form.new_api_model === "MiniMax-H3-Max" ? "max" : "standard";
  const isMiniMaxH3VideoForm =
    form.category === "video" &&
    (videoTemplateKey === MINIMAX_H3_TEMPLATE_KEY ||
      videoTemplateKey === MINIMAX_H3_MAX_TEMPLATE_KEY ||
      getVideoRule(form.runtime_rule).upload_profile === "minimax_h3" ||
      currentRuntimeRule?.upstream?.adapter === "minimax_h3_v2");
  const minimaxH3PriceRule = {
    ...buildMiniMaxH3PriceRule(miniMaxH3Variant),
    ...currentPriceRule,
    rates_per_second: {
      ...buildMiniMaxH3PriceRule(miniMaxH3Variant).rates_per_second,
      ...(currentPriceRule.rates_per_second || {}),
    },
    input_video_rates_per_second: {
      ...buildMiniMaxH3PriceRule(miniMaxH3Variant).input_video_rates_per_second,
      ...(currentPriceRule.input_video_rates_per_second || {}),
    },
  } as Record<string, any>;
  const isMiniMaxH3DynamicPrice =
    isMiniMaxH3VideoForm &&
    currentPriceRule.billing_type === "dynamic" && currentPriceRule.strategy === "minimax_h3_seconds";
  const videoBillingType = MODEL_BILLING_TYPES.includes(currentPriceRule.billing_type as ModelBillingType)
    ? currentPriceRule.billing_type as ModelBillingType
    : "per_request";
  const setVideoBillingType = (billingType: ModelBillingType) => {
    const dynamicDefault = isSeedanceVideoForm
      ? buildSeedancePriceRule(seedanceVariant)
      : isMiniMaxH3VideoForm
        ? buildMiniMaxH3PriceRule(miniMaxH3Variant)
        : undefined;
    setForm((prev) => ({
      ...prev,
      price_rule: JSON.stringify(switchedPriceRule(safeParseJson(prev.price_rule, {}) as Record<string, any>, billingType, dynamicDefault), null, 2),
    }));
  };
  const setVideoPriceValue = (key: string, value: number | string) => setForm((prev) => ({
    ...prev,
    price_rule: JSON.stringify({ ...(safeParseJson(prev.price_rule, {}) as Record<string, any>), [key]: value }, null, 2),
  }));
  const setMiniMaxH3PriceValue = (key: string, value: string | number) => {
    setForm((prev) => {
      const current = safeParseJson(prev.price_rule, {}) as Record<string, any>;
      return {
        ...prev,
        price_rule: JSON.stringify({
          ...buildMiniMaxH3PriceRule(miniMaxH3Variant),
          ...current,
          [key]: value,
          rates_per_second: {
            ...buildMiniMaxH3PriceRule(miniMaxH3Variant).rates_per_second,
            ...(current.rates_per_second || {}),
          },
        }, null, 2),
      };
    });
  };
  const setMiniMaxH3Rate = (resolution: string, value: number, rateKey = "rates_per_second") => {
    setForm((prev) => {
      const current = safeParseJson(prev.price_rule, {}) as Record<string, any>;
      return {
        ...prev,
        price_rule: JSON.stringify({
          ...buildMiniMaxH3PriceRule(miniMaxH3Variant),
          ...current,
          [rateKey]: {
            ...(buildMiniMaxH3PriceRule(miniMaxH3Variant) as Record<string, any>)[rateKey],
            ...(current[rateKey] || {}),
            [resolution]: value,
          },
        }, null, 2),
      };
    });
  };
  const setSeedanceScalar = (key: string, value: string | number) => {
    setForm((prev) => ({
      ...prev,
      price_rule: updateSeedancePriceRule(prev.price_rule, seedanceVariant, (rule) => ({ ...rule, [key]: value })),
    }));
  };
  const setSeedanceResolutionPrice = (
    resolution: string,
    field: "tokens_per_second" | "without_video" | "with_video",
    value: number
  ) => {
    setForm((prev) => ({
      ...prev,
      price_rule: updateSeedancePriceRule(prev.price_rule, seedanceVariant, (rule) => {
        if (field === "tokens_per_second") {
          return {
            ...rule,
            tokens_per_second: { ...rule.tokens_per_second, [resolution]: value },
          };
        }
        return {
          ...rule,
          rates_per_m_tokens: {
            ...rule.rates_per_m_tokens,
            [resolution]: {
              ...rule.rates_per_m_tokens[resolution],
              [field]: value,
            },
          },
        };
      }),
    }));
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">模型管理</h1>
        <div className="flex items-center gap-2">
          <button onClick={openLanguageManager} className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 font-semibold text-sm hover:bg-gray-50">
            语言管理
          </button>
          <button onClick={openCreate} className="px-4 py-2 rounded-xl bg-primary text-dark font-semibold text-sm">
            新增模型
          </button>
        </div>
      </div>

      {languageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setLanguageOpen(false)}>
          <div className="w-full max-w-4xl rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">生成语言管理</h2>
                <p className="mt-1 text-xs text-gray-500">工具栏显示简称，下拉显示完整名称；AI 提示词语言名会传入图片/视频生成链路。</p>
              </div>
              <button type="button" onClick={() => setLanguageOpen(false)} className="rounded-xl px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">
                关闭
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">语言代码</th>
                    <th className="px-3 py-2 text-left">工具栏简称</th>
                    <th className="px-3 py-2 text-left">下拉全称</th>
                    <th className="px-3 py-2 text-left">AI 提示词语言名</th>
                    <th className="px-3 py-2 text-left">排序</th>
                    <th className="px-3 py-2 text-left">启用</th>
                    <th className="px-3 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {languageRows.map((row, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">
                        <input className="w-28 rounded-lg border px-2 py-1.5 text-sm" value={row.code} onChange={(e) => updateLanguageRow(idx, { code: e.target.value })} placeholder="zh-CN" />
                      </td>
                      <td className="px-3 py-2">
                        <input className="w-20 rounded-lg border px-2 py-1.5 text-sm uppercase" value={row.short} onChange={(e) => updateLanguageRow(idx, { short: e.target.value.toUpperCase() })} placeholder="ZH" />
                      </td>
                      <td className="px-3 py-2">
                        <input className="w-36 rounded-lg border px-2 py-1.5 text-sm" value={row.name} onChange={(e) => updateLanguageRow(idx, { name: e.target.value })} placeholder="中文（简体）" />
                      </td>
                      <td className="px-3 py-2">
                        <input className="w-40 rounded-lg border px-2 py-1.5 text-sm" value={row.prompt_label} onChange={(e) => updateLanguageRow(idx, { prompt_label: e.target.value })} placeholder="Simplified Chinese" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" className="w-20 rounded-lg border px-2 py-1.5 text-sm" value={row.sort_order} onChange={(e) => updateLanguageRow(idx, { sort_order: Number(e.target.value) || 0 })} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={row.enabled} onChange={(e) => updateLanguageRow(idx, { enabled: e.target.checked })} />
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => setLanguageRows((rows) => rows.filter((_, i) => i !== idx))}>
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {languageErr && <p className="mt-3 text-sm text-red-500">{languageErr}</p>}
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                onClick={() => setLanguageRows((rows) => [...rows, { code: "", short: "", name: "", prompt_label: "", enabled: true, sort_order: (rows.length + 1) * 10 }])}
              >
                新增语言
              </button>
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50" onClick={() => setLanguageRows(DEFAULT_GENERATION_LANGUAGES)}>
                  恢复默认
                </button>
                <button type="button" disabled={languageSaving} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-dark disabled:opacity-50" onClick={saveLanguages}>
                  {languageSaving ? "保存中..." : "保存语言"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && !form.id && (
        <div ref={setFormMount} className="mb-5 overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm" />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          placeholder="搜索编码 / 名称"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm w-56"
        />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="px-3 py-2 rounded-lg border text-sm">
          <option value="">全部分类</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-3 py-2 rounded-lg border text-sm">
          <option value="">全部状态</option>
          <option value="enabled">启用</option>
          <option value="disabled">禁用</option>
        </select>
        <span className="text-xs text-gray-400">共 {filtered.length} 个</span>
      </div>

      {showForm && formMount && createPortal(
        <form onSubmit={submit} className="bg-white rounded-2xl p-6 grid grid-cols-2 gap-4">
          <div className="col-span-2 flex items-center justify-between">
            <h2 className="font-semibold">{form.id ? "编辑模型" : "新增模型"}</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-400 hover:text-gray-600">
              取消
            </button>
          </div>
          {form.category !== "multi_collab" && (
          <div className="col-span-2 bg-blue-50/60 border border-blue-100 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">模型接入配置</div>
                <div className="text-xs text-gray-500 mt-1">
                  填写兼容 OpenAI / NEW API 的接入地址与密钥；同一接入方（如 OpenAI）可在下方一次批量添加多个模型，共用这份配置。
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-white border border-blue-100 text-xs text-blue-700 hover:bg-blue-50"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    new_api_extra_params: JSON.stringify(
                      {
                        ...safeParseJson(prev.new_api_extra_params, {}),
                        connection: {
                          protocol: "openai_compatible",
                          base_url: "https://api.example.com",
                          api_key: "",
                          auth_type: "bearer",
                          api_key_header: "Authorization",
                        },
                      },
                      null,
                      2
                    ),
                  }))
                }
              >
                填入模板
              </button>
            </div>
            <div className="flex flex-wrap justify-end items-center gap-2 -mt-1 mb-1">
              <label className="text-xs text-gray-500 flex items-center gap-2">
                接入服务商预设
                <select
                  className="px-2 py-1.5 rounded-lg border border-blue-100 bg-white text-xs text-gray-700"
                  value={
                    getConnection(form.new_api_extra_params).provider === "nvidia" ||
                    getConnection(form.new_api_extra_params).base_url === "https://integrate.api.nvidia.com/v1"
                      ? "nvidia_integrate"
                      : "custom"
                  }
                  onChange={(e) => {
                    if (e.target.value === "nvidia_integrate") {
                      setForm((prev) => applyNvidiaIntegratePreset(prev));
                    }
                  }}
                >
                  <option value="custom">通用 / 自定义</option>
                  <option value="nvidia_integrate">NVIDIA Integrate（OpenAI 兼容）</option>
                </select>
              </label>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-700"
                onClick={() => setForm((prev) => applyNvidiaIntegratePreset(prev))}
              >
                NVIDIA Integrate 预设
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {field(
                "接入协议",
                <select
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  value={getConnection(form.new_api_extra_params).protocol}
                  onChange={(e) => {
                    const protocol = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      new_api_endpoint:
                        prev.request_mode === "chat_completions" &&
                        ["/v1/chat/completions", "/v1/messages", "/v1beta/models/{model}:generateContent", ""].includes(prev.new_api_endpoint)
                          ? CHAT_ENDPOINT_BY_PROTOCOL[protocol] || prev.new_api_endpoint
                          : prev.new_api_endpoint,
                      new_api_extra_params: setConnection(prev.new_api_extra_params, {
                        protocol,
                        models_endpoint: protocol === "gemini" ? "/v1beta/models" : "/v1/models",
                      }),
                    }));
                  }}
                >
                  <option value="openai_compatible">OpenAI / NVIDIA / NEW API 兼容</option>
                  <option value="claude">原生 Claude Messages</option>
                  <option value="gemini">原生 Gemini</option>
                  <option value="custom_http">自定义 HTTP（先按兼容格式解析响应）</option>
                </select>
              )}
              {field(
                "鉴权方式",
                <select
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  value={getConnection(form.new_api_extra_params).auth_type}
                  onChange={(e) => setForm((prev) => ({ ...prev, new_api_extra_params: setConnection(prev.new_api_extra_params, { auth_type: e.target.value }) }))}
                >
                  <option value="bearer">Bearer Token</option>
                  <option value="api_key_header">自定义 Header</option>
                  <option value="none">不鉴权</option>
                </select>
              )}
              {field(
                "渠道标识（可选）",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  placeholder="例如：openai-official / proxy-a"
                  value={getConnection(form.new_api_extra_params).provider}
                  onChange={(e) => setForm((prev) => ({ ...prev, new_api_extra_params: setConnection(prev.new_api_extra_params, { provider: e.target.value }) }))}
                />
              )}
              {field(
                "Base URL（必选）",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  placeholder={getConnection(form.new_api_extra_params).provider === "aliyun" ? "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com" : "例如：https://api.openai.com 或 https://xxx/v1 前缀"}
                  value={getConnection(form.new_api_extra_params).base_url}
                  required
                  onChange={(e) => setForm((prev) => ({ ...prev, new_api_extra_params: setConnection(prev.new_api_extra_params, { base_url: e.target.value }) }))}
                />
              )}
              {getConnection(form.new_api_extra_params).provider === "aliyun" && (
                <div className="-mt-2 text-[11px] leading-5 text-amber-700">
                  请填写与模型和 API Key 同地域的阿里云百炼 Workspace Endpoint，并将示例中的 WorkspaceId 替换为真实业务空间 ID。
                </div>
              )}
              {field(
                "API Key（必选）",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  placeholder="仅后台保存；线路密钥会加密入库"
                  value={getConnection(form.new_api_extra_params).api_key}
                  required={getConnection(form.new_api_extra_params).auth_type !== "none"}
                  onChange={(e) => setForm((prev) => ({ ...prev, new_api_extra_params: setConnection(prev.new_api_extra_params, { api_key: e.target.value }) }))}
                />
              )}
              {getConnection(form.new_api_extra_params).auth_type === "api_key_header" && field(
                "Header 名称",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  placeholder="例如：x-api-key"
                  value={getConnection(form.new_api_extra_params).api_key_header}
                  onChange={(e) => setForm((prev) => ({ ...prev, new_api_extra_params: setConnection(prev.new_api_extra_params, { api_key_header: e.target.value }) }))}
                />
              )}
              {getConnection(form.new_api_extra_params).protocol === "claude" && field(
                "Anthropic API 版本",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  placeholder="2023-06-01"
                  value={getConnection(form.new_api_extra_params).anthropic_version}
                  onChange={(e) => setForm((prev) => ({ ...prev, new_api_extra_params: setConnection(prev.new_api_extra_params, { anthropic_version: e.target.value }) }))}
                />
              )}
              {field(
                "模型列表 Endpoint（可选）",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  placeholder="默认：/v1/models"
                  value={getConnection(form.new_api_extra_params).models_endpoint}
                  onChange={(e) => setForm((prev) => ({ ...prev, new_api_extra_params: setConnection(prev.new_api_extra_params, { models_endpoint: e.target.value }) }))}
                />
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                disabled={upstreamModelsLoading}
                onClick={listUpstreamModels}
              >
                {upstreamModelsLoading ? "获取中…" : "获取上游模型列表"}
              </button>
              <span className="text-[11px] text-gray-400">
                优先请求 GET {getConnection(form.new_api_extra_params).protocol === "gemini" ? "/v1beta/models" : "/v1/models"}，不会产生聊天调用费用
              </span>
            </div>
            {upstreamModelsError && <p className="mt-2 text-xs text-red-600">{upstreamModelsError}</p>}
            {upstreamModels.length > 0 && (
              <div className="mt-3 rounded-xl border border-blue-100 bg-white p-3">
                <div className="mb-2 text-xs font-medium text-gray-600">上游可用模型（点击填入）</div>
                <div className="flex max-h-36 flex-wrap gap-2 overflow-auto">
                  {upstreamModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                      onClick={() => selectUpstreamModel(model)}
                      title={model.owned_by ? `owned_by: ${model.owned_by}` : model.id}
                    >
                      {model.id}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
          {form.id || form.category === "multi_collab" ? (
            <>
              {field(
                "模型编码",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm disabled:bg-gray-50"
                  value={form.code}
                  disabled={!!form.id}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  required
                />
              )}
              {field(
                "展示名称",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  required
                />
              )}
            </>
          ) : (
            <div className="col-span-2 bg-gray-50 border rounded-2xl p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">接入模型（可批量）</div>
                  <div className="text-xs text-gray-500 mt-1">
                    每行一个模型：填上游模型名后会自动生成编码与展示名（如 gpt-5.5 → GPT 5.5），可手动修改；提交时将逐个创建为独立模型。
                  </div>
                </div>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-white border text-xs text-gray-700 hover:bg-gray-100 shrink-0"
                  onClick={() => setBatchRows((rows) => [...rows, emptyBatchRow()])}
                >
                  + 添加一行
                </button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 text-[11px] text-gray-400 px-1">
                  <span>上游模型名（NEW API 模型名）</span>
                  <span>模型编码</span>
                  <span>展示名称</span>
                  <span />
                </div>
                {batchRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 items-center">
                    <input
                      className="px-3 py-2 rounded-lg border text-sm bg-white"
                      placeholder="例如：gpt-5.5"
                      value={row.model}
                      onChange={(e) => updateBatchRow(idx, { model: e.target.value })}
                    />
                    <input
                      className="px-3 py-2 rounded-lg border text-sm bg-white"
                      placeholder="自动生成，可改"
                      value={row.code}
                      onChange={(e) => updateBatchRow(idx, { code: e.target.value, codeTouched: true })}
                    />
                    <input
                      className="px-3 py-2 rounded-lg border text-sm bg-white"
                      placeholder="自动生成，可改"
                      value={row.name}
                      onChange={(e) => updateBatchRow(idx, { name: e.target.value, nameTouched: true })}
                    />
                    <button
                      type="button"
                      className="h-8 w-8 rounded-lg border bg-white text-gray-400 hover:text-red-500 disabled:opacity-30"
                      disabled={batchRows.length <= 1}
                      onClick={() => setBatchRows((rows) => rows.filter((_, i) => i !== idx))}
                      title="删除该行"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="col-span-2">
            <label className="text-xs text-gray-500">LOGO</label>
            <div className="mt-1 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center">
                  {form.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.icon_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-gray-400">无</span>
                  )}
                </div>
                <label className="px-3 py-2 rounded-lg border text-sm cursor-pointer hover:bg-gray-50">
                  上传
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadLogo(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setLogoPickerOpen((v) => !v)}
                  className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-50"
                >
                  {logoPickerOpen ? "收起图标库" : "选择 Lobe 图标"}
                </button>
                <input
                  className="flex-1 px-3 py-2 rounded-lg border text-sm"
                  placeholder="或粘贴图片 URL"
                  value={form.icon_url}
                  onChange={(e) => setForm({ ...form, icon_url: e.target.value })}
                />
              </div>
              {logoPickerOpen && (
                <div className="rounded-2xl border bg-gray-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Lobe Icons 图标库</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        选择后会自动下载 PNG 并上传到本系统，最终保存系统内图片地址。
                      </div>
                    </div>
                    <input
                      className="px-3 py-2 rounded-xl border text-sm w-full sm:w-[260px] bg-white"
                      placeholder="搜索：OpenAI / Claude / Qwen..."
                      value={logoSearch}
                      onChange={(e) => setLogoSearch(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 max-h-[260px] overflow-y-auto pr-1">
                    {filteredLogos.map((logo) => (
                      <button
                        key={logo.slug}
                        type="button"
                        disabled={!!logoUploading}
                        onClick={() => chooseLobeLogo(logo)}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border text-left hover:border-primary hover:bg-primary/5 disabled:opacity-60"
                      >
                        <span className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                          <LobeLogoImage logo={logo} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-gray-800 truncate">{logo.label}</span>
                          <span className="block text-[10px] text-gray-400 truncate">
                            {logoUploading === logo.slug ? "上传中..." : logo.slug}
                          </span>
                        </span>
                      </button>
                    ))}
                    {filteredLogos.length === 0 && (
                      <div className="col-span-full text-center text-sm text-gray-400 py-6">没有匹配的图标</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          {form.category === "multi_collab" && (
            <div className="col-span-2 bg-amber-50/70 border border-amber-100 rounded-2xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">默认渠道预设</div>
                  <div className="text-xs text-gray-500 mt-1">
                    多模型协作是前台入口，不需要填写上游接入地址。这里仅选择默认使用的渠道预设；参与模型列表请到「渠道预设」页面维护。
                  </div>
                </div>
                <div className="text-xs text-amber-700 bg-white/70 border border-amber-100 rounded-xl px-3 py-2">
                  {getDefaultChannelKey(form.default_params) || "未选择"}
                </div>
              </div>
              {enabledChannelPresets.length === 0 ? (
                <div className="rounded-xl bg-white border border-amber-100 px-4 py-6 text-sm text-gray-500 text-center">
                  暂无启用的渠道预设，请先到「渠道预设」页面创建并启用。
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {enabledChannelPresets.map((preset) => {
                    const selected = getDefaultChannelKey(form.default_params) === preset.key;
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, default_params: setDefaultChannelKey(prev.default_params, preset.key) }))}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                          selected ? "bg-white border-primary/40 ring-2 ring-primary/10" : "bg-white/80 border-amber-100 hover:border-amber-200"
                        }`}
                      >
                        <span className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 text-xs font-bold text-amber-700">
                          {preset.model_codes?.length || 0}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-gray-900 truncate">{preset.name}</span>
                          <span className="block text-[11px] text-gray-400 truncate">{preset.key} · {preset.strategy}</span>
                        </span>
                        <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[11px] ${selected ? "bg-primary border-primary text-dark" : "border-gray-200 text-transparent"}`}>
                          ✓
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-4 text-[11px] text-gray-400">
                保存位置：default_params.channel_key。该配置只在“分类 = 多模型协作”时生效。
              </div>
            </div>
          )}
          {form.category !== "multi_collab" && form.id
            ? field(
                "NEW API 模型名",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
                  value={form.new_api_model}
                  onChange={(e) => setForm({ ...form, new_api_model: e.target.value })}
                />
              )
            : null}
          {form.category !== "multi_collab" && field(
            "请求模式",
            <select
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              value={form.request_mode}
              onChange={(e) =>
                setForm((prev) => {
                  setAudioTemplateKey("");
                  setVideoTemplateKey("");
                  return {
                    ...prev,
                    request_mode: e.target.value,
                    new_api_endpoint: endpointAfterRequestModeChange(prev.new_api_endpoint, prev.request_mode, e.target.value),
                  };
                })
              }
            >
              {REQUEST_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {field(
            "分类",
            <select
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              value={form.category}
              onChange={(e) =>
                setForm((prev) => {
                  setAudioTemplateKey("");
                  setVideoTemplateKey("");
                  if (e.target.value === "multi_collab") return applyMultiCollabStandard(prev);
                  if (e.target.value === "image") return applyImageStandard(prev);
                  if (e.target.value === "video") return applyVideoStandard(prev);
                  if (e.target.value === "audio") {
                    setAudioTemplateKey("openai_audio_speech");
                    return applyAudioStandard(prev);
                  }
                  return { ...prev, category: e.target.value };
                })
              }
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {form.category !== "multi_collab" && field(
            "NEW API Endpoint",
            form.category === "image" ? (
              <div className="space-y-2">
                <select
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  value={imagePresetKey()}
                  onChange={(e) => setForm((prev) => applyImageEndpointPreset(prev, e.target.value))}
                >
                  {IMAGE_ENDPOINT_PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">自定义（保留当前配置）</option>
                </select>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  value={form.new_api_endpoint}
                  placeholder="/v1/images/generations 或 /v1/videos"
                  onChange={(e) => setForm((prev) => ({
                    ...prev,
                    new_api_endpoint: e.target.value,
                    runtime_rule: withImageInterfaceType(safeParseJson(prev.runtime_rule, {}), imagePresetKey(prev)),
                  }))}
                />
                <div className="text-[11px] text-gray-400">
                  {isBananaImageForm()
                    ? "香蕉图片接口默认使用 /v1/videos；地址可修改，异步接口请同时检查轮询路径。"
                    : isOpenAIImagesForm()
                      ? "无参考图使用 /v1/images/generations；上传参考图后自动使用 /v1/images/edits。"
                      : "Endpoint 可自由修改，不会改变已选接口类型。异步接口请同时检查轮询路径。"}
                </div>
              </div>
            ) : (
              <input
                className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
                value={form.new_api_endpoint}
                onChange={(e) => {
                  if (form.category === "audio") setAudioTemplateKey("");
                  if (form.category === "video") setVideoTemplateKey("");
                  setForm({ ...form, new_api_endpoint: e.target.value });
                }}
              />
            )
          )}
          {field(
            "标签（逗号分隔）",
            <input
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          )}
          {field(
            "排序",
            <input
              type="number"
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
            />
          )}
          <div className="col-span-2">
            {field(
              "描述",
              <input
                className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            )}
          </div>
          {form.category === "image" && (
            <div className="col-span-2 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-gray-900">图片接入向导</div>
                  <div className="mt-1 text-xs leading-6 text-gray-500">
                    选择接口类型可填入默认配置，Endpoint 可以单独修改。选择自定义会保留当前配置，可继续调整参数与轮询路径。
                  </div>
                </div>
                {(isBananaImageForm() || isOpenAIImagesForm()) && (
                  <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs text-emerald-700">
                    {isOpenAIImagesForm() ? "已启用标准 OpenAI Images 兼容" : "已启用香蕉 API 兼容"}
                  </div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500">接口类型</label>
                  <select
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={imagePresetKey()}
                    onChange={(e) => setForm((prev) => applyImageEndpointPreset(prev, e.target.value))}
                  >
                    {IMAGE_ENDPOINT_PRESETS.map((preset) => (
                      <option key={preset.key} value={preset.key}>{preset.label}</option>
                    ))}
                    <option value="custom">自定义（保留当前配置）</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">上游模型</label>
                  {isAliyunQwenImageForm() ? (
                    <select
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={form.new_api_model}
                      onChange={(e) => setForm((prev) => ({ ...prev, new_api_model: e.target.value }))}
                    >
                      <option value="qwen-image-3.0-pro">qwen-image-3.0-pro</option>
                      <option value="qwen-image-3.0">qwen-image-3.0</option>
                    </select>
                  ) : isBananaImageForm() ? (
                    <select
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={form.new_api_model}
                      onChange={(e) =>
                        setForm((prev) => {
                          const modelName = e.target.value;
                          const defaultQuality = inferImageQualityFromModel(modelName);
                          return {
                            ...prev,
                            new_api_model: modelName,
                            runtime_rule: setImageRule(prev.runtime_rule, {
                              default_quality: defaultQuality,
                              supported_size_tiers: IMAGE_QUALITY_TIERS,
                              model_by_size: { "1K": "nano_banana_pro-1K", "2K": "nano_banana_pro-2K", "4K": "nano_banana_pro-4K" },
                            }),
                            default_params: JSON.stringify(
                              { ...(safeParseJson(prev.default_params, {}) || {}), quality: defaultQuality },
                              null,
                              2
                            ),
                          };
                        })
                      }
                    >
                      {BANANA_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={form.new_api_model}
                      onChange={(e) => setForm((prev) => ({ ...prev, new_api_model: e.target.value }))}
                      placeholder="例如 gpt-image-1"
                    />
                  )}
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500">异步轮询路径（可选）</label>
                  <input
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={String(safeParseJson(form.runtime_rule, {})?.upstream?.poll_path || "")}
                    placeholder="例如 /v1/videos/{id}"
                    onChange={(e) => setForm((prev) => ({ ...prev, runtime_rule: setImageRule(prev.runtime_rule, { poll_path: e.target.value || null }) }))}
                  />
                  <div className="mt-1 text-[11px] text-gray-500">返回任务 ID 后自动轮询；留空时默认使用 Endpoint + /&#123;id&#125;。其他自定义映射可在下方 runtime_rule 中修改。</div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">最多参考图</label>
                  <input
                    type="number"
                    min={0}
                    max={isBananaImageForm() ? 5 : 20}
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={getImageRule(form.runtime_rule).max_reference_images}
                    onChange={(e) =>
                      setForm((prev) => {
                        const maxLimit = isBananaImageForm(prev) ? 5 : 20;
                        const n = Math.max(0, Math.min(maxLimit, parseInt(e.target.value, 10) || 0));
                        return {
                          ...prev,
                          runtime_rule: setImageMaxRefs(prev.runtime_rule, n),
                          default_params: JSON.stringify({ ...(safeParseJson(prev.default_params, {}) || {}), max_reference_images: n }, null, 2),
                        };
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">{isAliyunQwenImageForm() ? "默认输出尺寸" : "默认质量"}</label>
                  <select
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={isAliyunQwenImageForm() ? getImageRule(form.runtime_rule).default_size : getImageRule(form.runtime_rule).default_quality}
                    onChange={(e) =>
                      setForm((prev) => {
                        if (isAliyunQwenImageForm(prev)) {
                          const rr = safeParseJson(prev.runtime_rule, {});
                          return { ...prev, runtime_rule: JSON.stringify({ ...rr, image: { ...(rr.image || {}), default_size: e.target.value } }, null, 2), default_params: JSON.stringify({ ...(safeParseJson(prev.default_params, {}) || {}), size: e.target.value }, null, 2) };
                        }
                        const quality = isOpenAIImagesForm(prev) ? normalizeOpenAIImageQuality(e.target.value) : normalizeImageQuality(e.target.value);
                        return { ...prev, runtime_rule: setImageRule(prev.runtime_rule, { default_quality: quality }), default_params: JSON.stringify({ ...(safeParseJson(prev.default_params, {}) || {}), quality }, null, 2) };
                      })
                    }
                  >
                    {(isAliyunQwenImageForm() ? QWEN_IMAGE_SIZES : isOpenAIImagesForm() ? getImageRule(form.runtime_rule).supported_qualities : getImageRule(form.runtime_rule).supported_size_tiers).map((tier) => (
                      <option key={tier} value={tier}>{tier === "auto" ? "自动推荐（官方默认）" : tier}</option>
                    ))}
                  </select>
                  <div className="text-[11px] text-gray-400 mt-1">{isAliyunQwenImageForm() ? "比例与分辨率合并为官方 size 参数；自动推荐时不向上游发送 size。" : isOpenAIImagesForm() ? "标准接口只允许 auto、low、medium、high；其他值会安全回退为 auto。" : "前台工作台图片质量工具栏会默认选中该值。"}</div>
                </div>
                {!isAliyunQwenImageForm() && !isOpenAIImagesForm() && (
                  <div className="col-span-2 overflow-x-auto rounded-xl border border-emerald-100 bg-white">
                    <table className="w-full min-w-[720px] text-xs">
                      <thead className="bg-emerald-50 text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left">前台档位</th>
                          <th className="px-3 py-2 text-left">上游模型 ID</th>
                          <th className="px-3 py-2 text-left">用户售价 / 张</th>
                        </tr>
                      </thead>
                      <tbody>
                        {IMAGE_QUALITY_TIERS.map((tier) => {
                          const imageRule = getImageRule(form.runtime_rule);
                          const enabled = imageRule.supported_size_tiers.includes(tier);
                          const prices = ((safeParseJson(form.price_rule, {}) as Record<string, any>).unit_price_by_size || {}) as Record<string, number>;
                          return (
                            <tr key={tier} className="border-t border-emerald-100">
                              <td className="px-3 py-2">
                                <label className="flex items-center gap-2 font-semibold text-gray-800">
                                  <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={(event) => setForm((prev) => {
                                      const current = getImageRule(prev.runtime_rule);
                                      let tiers = event.target.checked
                                        ? [...current.supported_size_tiers, tier]
                                        : current.supported_size_tiers.filter((item: string) => item !== tier);
                                      if (!tiers.length) tiers = ["1K"];
                                      const defaultQuality = tiers.includes(current.default_quality) ? current.default_quality : tiers[0];
                                      return {
                                        ...prev,
                                        runtime_rule: setImageRule(prev.runtime_rule, { supported_size_tiers: tiers, default_quality: defaultQuality }),
                                        default_params: JSON.stringify({ ...(safeParseJson(prev.default_params, {}) || {}), quality: defaultQuality }, null, 2),
                                      };
                                    })}
                                  />
                                  {tier}{tier === "1K" ? "（默认/标准）" : ""}
                                </label>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className="w-full rounded-lg border px-2 py-1.5"
                                  value={String(imageRule.model_by_size[tier] || "")}
                                  placeholder={tier === "1K" ? form.new_api_model || "上游默认模型" : `例如 ${form.new_api_model}-${tier}`}
                                  onChange={(event) => setForm((prev) => {
                                    const current = getImageRule(prev.runtime_rule);
                                    return { ...prev, runtime_rule: setImageRule(prev.runtime_rule, { model_by_size: { ...current.model_by_size, [tier]: event.target.value.trim() } }) };
                                  })}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.0001"
                                  className="w-full rounded-lg border px-2 py-1.5"
                                  value={Number(prices[tier] ?? (safeParseJson(form.price_rule, {}) as any).unit_price ?? 0)}
                                  onChange={(event) => {
                                    const price = Math.max(0, Number(event.target.value) || 0);
                                    setForm((prev) => {
                                      const current = safeParseJson(prev.price_rule, {}) as Record<string, any>;
                                      return {
                                        ...prev,
                                        price_rule: JSON.stringify({
                                          ...current,
                                          billing_type: "per_image",
                                          currency: current.currency || "¥",
                                          unit_price: tier === "1K" ? price : Number(current.unit_price ?? price),
                                          unit_price_by_size: { ...(current.unit_price_by_size || {}), [tier]: price },
                                        }, null, 2),
                                      };
                                    });
                                  }}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="border-t border-emerald-100 px-3 py-2 text-[11px] text-gray-500">
                      前台只展示一个平台模型；用户选择档位后，系统按上游模型 ID 路由，并按该行售价扣费。未填写的上游 ID 回退到主模型。
                    </div>
                  </div>
                )}
                {(isAliyunQwenImageForm() || isOpenAIImagesForm()) && (
                  <div>
                    <label className="text-xs text-gray-500">每张扣费</label>
                    <input
                      type="number"
                      min={0}
                      step="0.0001"
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={Number((safeParseJson(form.price_rule, {}) as any).unit_price ?? 0)}
                      onChange={(event) => setForm((prev) => ({ ...prev, price_rule: JSON.stringify({ ...(safeParseJson(prev.price_rule, {}) || {}), billing_type: "per_image", unit_price: Math.max(0, Number(event.target.value) || 0) }, null, 2) }))}
                    />
                  </div>
                )}
              </div>
              {isBananaImageForm() && (
                <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-6 text-gray-600">
                  Base URL 填 <code className="rounded bg-white px-1 py-0.5">https://otuapi.com</code>，默认 Endpoint 为 <code className="rounded bg-white px-1 py-0.5">/v1/videos</code>。用户选择批量生成时，系统会按数量创建多个上游任务并合并结果。
                </div>
              )}
              {isOpenAIImagesForm() && (
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-6 text-gray-600">
                  无参考图时按 OpenAI Images Generations JSON 请求；上传参考图后自动切换到 <code className="rounded bg-white px-1 py-0.5">/v1/images/edits</code>，以 <code className="rounded bg-white px-1 py-0.5">image / image[]</code> multipart 文件上传。不会透传 <code className="rounded bg-white px-1 py-0.5">aspect_ratio / image_size / 1K / 2K / 4K</code> 等章鱼哥参数。
                </div>
              )}
            </div>
          )}
          <div className="col-span-2 bg-gray-50 border rounded-2xl p-4">
            <div className="text-sm font-semibold text-gray-900 mb-2">能力开关（用于前台展示）</div>
            {form.category === "image" ? (
              <div>
                <div className="text-xs text-gray-500">
                  图片模型不展示“联网搜索 / 深度思考”，已按图片生成标准使用：生成数量、图片比例、图质量。
                </div>
                <div className="mt-4 max-w-xs">
                  <label className="text-xs text-gray-500">最多上传参考图</label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={getImageRule(form.runtime_rule).max_reference_images}
                    onChange={(e) =>
                      setForm((prev) => {
                        const maxLimit = 20;
                        const n = Math.max(0, Math.min(maxLimit, parseInt(e.target.value, 10) || 0));
                        return {
                          ...prev,
                          runtime_rule: setImageMaxRefs(prev.runtime_rule, n),
                          default_params: JSON.stringify(
                            { ...(safeParseJson(prev.default_params, {}) || {}), max_reference_images: n },
                            null,
                            2
                          ),
                        };
                      })
                    }
                  />
                  <div className="text-[11px] text-gray-400 mt-1">前台图片输入区会按该数量限制参考图上传。</div>
                </div>
                <div className="mt-4 max-w-xs">
                  <label className="text-xs text-gray-500">{isAliyunQwenImageForm() ? "默认输出尺寸" : "默认质量"}</label>
                  <select
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={isAliyunQwenImageForm() ? getImageRule(form.runtime_rule).default_size : getImageRule(form.runtime_rule).default_quality}
                    onChange={(e) =>
                      setForm((prev) => {
                        if (isAliyunQwenImageForm(prev)) {
                          const rr = safeParseJson(prev.runtime_rule, {});
                          return { ...prev, runtime_rule: JSON.stringify({ ...rr, image: { ...(rr.image || {}), default_size: e.target.value } }, null, 2), default_params: JSON.stringify({ ...(safeParseJson(prev.default_params, {}) || {}), size: e.target.value }, null, 2) };
                        }
                        const quality = isOpenAIImagesForm(prev) ? normalizeOpenAIImageQuality(e.target.value) : normalizeImageQuality(e.target.value);
                        return { ...prev, runtime_rule: setImageRule(prev.runtime_rule, { default_quality: quality }), default_params: JSON.stringify({ ...(safeParseJson(prev.default_params, {}) || {}), quality }, null, 2) };
                      })
                    }
                  >
                    {(isAliyunQwenImageForm() ? QWEN_IMAGE_SIZES : isOpenAIImagesForm() ? getImageRule(form.runtime_rule).supported_qualities : getImageRule(form.runtime_rule).supported_size_tiers).map((tier) => (
                      <option key={tier} value={tier}>{tier === "auto" ? "自动推荐（官方默认）" : tier}</option>
                    ))}
                  </select>
                  <div className="text-[11px] text-gray-400 mt-1">{isAliyunQwenImageForm() ? "官方允许 512×512 到 2048×2048 范围内的 size，预设均在有效范围内。" : "也可直接在高级 JSON 里配置 runtime_rule.image.default_quality。"}</div>
                </div>
              </div>
            ) : form.category === "video" ? (
              <div className="space-y-4">
                <div className="text-xs text-gray-500">
                  视频模型通过 runtime_rule.video 驱动前台上传区与参数条；input_schema 定义底部可选参数（x-widget / x-order）。
                </div>
                <div className="rounded-xl border border-cyan-100 bg-cyan-50/60 p-4">
                  <label className="text-xs text-gray-500">上游接口模板</label>
                  <div className="mt-1 flex gap-2">
                    <select
                      className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-sm"
                      value={videoTemplateKey}
                      onChange={(e) => {
                        const value = e.target.value;
                        setVideoTemplateKey(value);
                        const variant = getSeedanceVariantByTemplateKey(value);
                        if (variant) {
                          setForm((prev) => applyVolcengineSeedance2(prev, variant));
                        } else if (value === MINIMAX_H3_TEMPLATE_KEY) {
                          setForm((prev) => applyMiniMaxH3V2(prev));
                        } else if (value === MINIMAX_H3_MAX_TEMPLATE_KEY) {
                          setForm((prev) => applyMiniMaxH3V2(prev, "max"));
                        } else if (value === VEO_REFERENCE_TEMPLATE_KEY) {
                          setForm((prev) => applyVeoReferenceV1(prev));
                        } else if (value === VEO_FRAME_PAIR_TEMPLATE_KEY) {
                          setForm((prev) => applyVeoFramePairV1(prev));
                        } else if (value === OMNI_REFERENCE_TEMPLATE_KEY) {
                          setForm((prev) => applyOmniReferenceV1(prev));
                        } else if (value === ALIYUN_HAPPYHORSE_TEMPLATE_KEY) {
                          setForm((prev) => applyAliyunHappyHorse(prev, "text"));
                        } else if (value === ALIYUN_WAN3_TEMPLATE_KEY) {
                          setForm((prev) => applyAliyunWan3Video(prev));
                        }
                      }}
                    >
                      <option value="">通用视频接口 / 自定义配置</option>
                      <option value={VEO_FRAME_PAIR_TEMPLATE_KEY}>章鱼哥 · VEO 首尾帧（无参考图）</option>
                      <option value={VEO_REFERENCE_TEMPLATE_KEY}>第三方 OpenAI 兼容 · 参考图（VEO 类）</option>
                      <option value={OMNI_REFERENCE_TEMPLATE_KEY}>章鱼哥 · Omni 文生 / 参考图</option>
                      <option value={SEEDANCE_VARIANTS.standard.templateKey}>火山方舟 · Doubao Seedance 2.0 Standard</option>
                      <option value={SEEDANCE_VARIANTS.fast.templateKey}>火山方舟 · Doubao Seedance 2.0 Fast</option>
                      <option value={SEEDANCE_VARIANTS.mini.templateKey}>火山方舟 · Doubao Seedance 2.0 Mini</option>
                      <option value={MINIMAX_H3_TEMPLATE_KEY}>MiniMax 官方 · MiniMax-H3 V2</option>
                      <option value={MINIMAX_H3_MAX_TEMPLATE_KEY}>MiniMax 官方 · MiniMax-H3-Max V2</option>
                      <option value={ALIYUN_HAPPYHORSE_TEMPLATE_KEY}>阿里云百炼 · HappyHorse 全场景</option>
                      <option value={ALIYUN_WAN3_TEMPLATE_KEY}>阿里云百炼 · Wan 3.0 全能视频</option>
                    </select>
                    {(getSeedanceVariantByTemplateKey(videoTemplateKey) ||
                      videoTemplateKey === MINIMAX_H3_TEMPLATE_KEY ||
                      videoTemplateKey === MINIMAX_H3_MAX_TEMPLATE_KEY ||
                      videoTemplateKey === VEO_FRAME_PAIR_TEMPLATE_KEY ||
                      videoTemplateKey === VEO_REFERENCE_TEMPLATE_KEY ||
                      videoTemplateKey === OMNI_REFERENCE_TEMPLATE_KEY ||
                      videoTemplateKey === ALIYUN_HAPPYHORSE_TEMPLATE_KEY ||
                      videoTemplateKey === ALIYUN_WAN3_TEMPLATE_KEY) && (
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-cyan-200 bg-white px-3 py-2 text-xs font-medium text-cyan-700 hover:bg-cyan-50"
                        onClick={() => {
                          const variant = getSeedanceVariantByTemplateKey(videoTemplateKey);
                          if (variant) {
                            setForm((prev) => applyVolcengineSeedance2(prev, variant));
                          } else if (videoTemplateKey === MINIMAX_H3_TEMPLATE_KEY) {
                            setForm((prev) => applyMiniMaxH3V2(prev));
                          } else if (videoTemplateKey === MINIMAX_H3_MAX_TEMPLATE_KEY) {
                            setForm((prev) => applyMiniMaxH3V2(prev, "max"));
                          } else if (videoTemplateKey === VEO_REFERENCE_TEMPLATE_KEY) {
                            setForm((prev) => applyVeoReferenceV1(prev));
                          } else if (videoTemplateKey === VEO_FRAME_PAIR_TEMPLATE_KEY) {
                            setForm((prev) => applyVeoFramePairV1(prev));
                          } else if (videoTemplateKey === OMNI_REFERENCE_TEMPLATE_KEY) {
                            setForm((prev) => applyOmniReferenceV1(prev));
                          } else if (videoTemplateKey === ALIYUN_HAPPYHORSE_TEMPLATE_KEY) {
                            const profile = String(getVideoRule(form.runtime_rule).upload_profile).replace("aliyun_happyhorse_", "") as HappyHorseProfile;
                            setForm((prev) => applyAliyunHappyHorse(prev, ["text", "first_frame", "reference", "edit"].includes(profile) ? profile : "text"));
                          } else if (videoTemplateKey === ALIYUN_WAN3_TEMPLATE_KEY) {
                            setForm((prev) => applyAliyunWan3Video(prev));
                          }
                        }}
                      >
                        重新应用模板
                      </button>
                    )}
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-gray-500">
                    VEO 首尾帧模板默认使用当前更通用的 veo_3_1-fl，只接收 1 张首帧或“首帧 + 尾帧”，不提供参考图槽位；VEO 参考图模板则固定显示 8 秒，支持文生和 1～3 张参考图。Omni 模板固定 10 秒 720P，支持文生和 1～7 张参考图。三者的 JSON 图片都会自动映射到 images，固定时长不发送上游。Seedance 三个模板会分别写入官方模型 ID、分辨率和 Token 价格。MiniMax-H3 支持 768P/2K、4～15 秒及五种素材组合；H3-Max 支持 480P/768P、5～15 秒及文生/首尾帧模式。API Key 仍需管理员填写。
                  </div>
                </div>
                <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="min-w-[210px] flex-1 text-xs text-gray-500">
                      用户售价计费方式
                      <select
                        className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                        value={videoBillingType}
                        onChange={(e) => setVideoBillingType(e.target.value as ModelBillingType)}
                      >
                        <option value="per_request">按次</option>
                        <option value="per_second">按秒</option>
                        <option value="per_token">按 Token</option>
                        <option value="per_image">按生成结果</option>
                        <option value="dynamic">动态规则</option>
                      </select>
                    </label>
                    {(["per_request", "per_second", "per_image"] as ModelBillingType[]).includes(videoBillingType) && (
                      <SeedancePriceInput
                        label={videoBillingType === "per_request" ? "每次算力" : videoBillingType === "per_second" ? "每秒算力" : "每个结果算力"}
                        value={Number(currentPriceRule.unit_price ?? 1)}
                        step={0.01}
                        onChange={(value) => setVideoPriceValue("unit_price", value)}
                      />
                    )}
                    {videoBillingType === "per_token" && (
                      <>
                        <SeedancePriceInput label="输入算力 / 1M Token" value={Number(currentPriceRule.input_price_per_m ?? 1)} step={0.01} onChange={(value) => setVideoPriceValue("input_price_per_m", value)} />
                        <SeedancePriceInput label="输出算力 / 1M Token" value={Number(currentPriceRule.output_price_per_m ?? 1)} step={0.01} onChange={(value) => setVideoPriceValue("output_price_per_m", value)} />
                      </>
                    )}
                    {videoBillingType === "dynamic" && !isSeedanceDynamicPrice && !isMiniMaxH3DynamicPrice && (
                      <SeedancePriceInput label="动态估价兜底算力" value={Number(currentPriceRule.fallback_cost ?? 1)} step={0.01} onChange={(value) => setVideoPriceValue("fallback_cost", value)} />
                    )}
                    <label className="w-28 text-xs text-gray-500">
                      币种
                      <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm" value={String(currentPriceRule.currency || "POINT")} onChange={(e) => setVideoPriceValue("currency", e.target.value)} />
                    </label>
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-gray-500">
                    这里控制向用户扣费的模型价格规则；上游成本仍在“上游线路”的成本计费方式中独立配置。
                    {(isSeedanceVideoForm || isMiniMaxH3VideoForm) && videoBillingType !== "dynamic" && " 可随时切回动态规则以按官方用量精确计费。"}
                  </div>
                </div>
                {isSeedanceDynamicPrice && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        Seedance 2.0 {seedanceVariantConfig.label} 动态计费
                      </div>
                      <div className="mt-1 text-[11px] leading-5 text-gray-500">
                        任务完成后优先按上游真实视频 Token 结算；预估阶段使用输出时长、分辨率及参考视频时长计算。
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
                      <label className="text-xs text-gray-500">
                        默认分辨率
                        <select
                          className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-sm"
                          value={String(seedancePriceRule.default_resolution || "720p")}
                          onChange={(e) => setSeedanceScalar("default_resolution", e.target.value)}
                        >
                          {seedanceVariantConfig.resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                        </select>
                      </label>
                      <SeedancePriceInput label="算力点/元" value={Number(seedancePriceRule.points_per_cny ?? 1)} step={0.01} onChange={(value) => setSeedanceScalar("points_per_cny", value)} />
                      <SeedancePriceInput label="平台倍率" value={Number(seedancePriceRule.platform_multiplier ?? 1)} step={0.01} onChange={(value) => setSeedanceScalar("platform_multiplier", value)} />
                      <SeedancePriceInput label="默认输入视频秒数" value={Number(seedancePriceRule.default_input_video_seconds ?? 4)} step={0.1} onChange={(value) => setSeedanceScalar("default_input_video_seconds", value)} />
                      <SeedancePriceInput label="估价兜底算力" value={Number(seedancePriceRule.fallback_cost ?? 0)} step={0.01} onChange={(value) => setSeedanceScalar("fallback_cost", value)} />
                    </div>
                    <div className="mt-4 overflow-x-auto rounded-xl border border-amber-100 bg-white">
                      <table className="w-full min-w-[680px] text-xs">
                        <thead className="bg-amber-50 text-gray-500">
                          <tr>
                            <th className="px-3 py-2 text-left">分辨率</th>
                            <th className="px-3 py-2 text-left">输出 Token/秒</th>
                            <th className="px-3 py-2 text-left">不含视频输入（元/1M Tokens）</th>
                            <th className="px-3 py-2 text-left">含视频输入（元/1M Tokens）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {seedanceVariantConfig.resolutions.map((resolution) => (
                            <tr key={resolution} className="border-t border-amber-100">
                              <td className="px-3 py-2 font-semibold text-gray-800">{resolution}</td>
                              <td className="px-3 py-2">
                                <input type="number" min={0} step={1} className="w-full rounded-lg border px-2 py-1.5" value={Number(seedancePriceRule.tokens_per_second?.[resolution] ?? 0)} onChange={(e) => setSeedanceResolutionPrice(resolution, "tokens_per_second", Math.max(0, Number(e.target.value) || 0))} />
                              </td>
                              <td className="px-3 py-2">
                                <input type="number" min={0} step={0.01} className="w-full rounded-lg border px-2 py-1.5" value={Number(seedancePriceRule.rates_per_m_tokens?.[resolution]?.without_video ?? 0)} onChange={(e) => setSeedanceResolutionPrice(resolution, "without_video", Math.max(0, Number(e.target.value) || 0))} />
                              </td>
                              <td className="px-3 py-2">
                                <input type="number" min={0} step={0.01} className="w-full rounded-lg border px-2 py-1.5" value={Number(seedancePriceRule.rates_per_m_tokens?.[resolution]?.with_video ?? 0)} onChange={(e) => setSeedanceResolutionPrice(resolution, "with_video", Math.max(0, Number(e.target.value) || 0))} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 text-[11px] text-gray-500">
                      “含视频输入”不是 28 算力/秒；默认值 28 表示每百万输出 Token 的上游价格。平台最终换算为算力点并乘以平台倍率。
                    </div>
                  </div>
                )}
                {isMiniMaxH3DynamicPrice && (
                  <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{form.new_api_model} V2 动态计费</div>
                      <div className="mt-1 text-[11px] leading-5 text-gray-500">
                        {miniMaxH3Variant === "max"
                          ? "H3-Max 的输出视频、输入视频分别按分辨率和秒数计费；图片从第 1 张起按张计费，音频免费。"
                          : "H3 的输出视频、输入视频分别按分辨率和秒数计费；图片前 5 张免费，超出部分按张计费，音频免费。"}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                      {(miniMaxH3Variant === "max" ? ["480p", "768p"] : ["768p", "2k"]).map((resolution) => (
                        <SeedancePriceInput key={`output-${resolution}`} label={`${resolution.toUpperCase()} 输出（元/秒）`} value={Number(minimaxH3PriceRule.rates_per_second?.[resolution] ?? 0)} step={0.01} onChange={(value) => setMiniMaxH3Rate(resolution, value)} />
                      ))}
                      {(miniMaxH3Variant === "max" ? ["480p", "768p"] : ["768p", "2k"]).map((resolution) => (
                        <SeedancePriceInput key={`input-${resolution}`} label={`${resolution.toUpperCase()} 输入视频（元/秒）`} value={Number(minimaxH3PriceRule.input_video_rates_per_second?.[resolution] ?? 0)} step={0.01} onChange={(value) => setMiniMaxH3Rate(resolution, value, "input_video_rates_per_second")} />
                      ))}
                      <SeedancePriceInput label="免费参考图片数" value={Number(minimaxH3PriceRule.free_reference_images ?? (miniMaxH3Variant === "max" ? 0 : 5))} step={1} onChange={(value) => setMiniMaxH3PriceValue("free_reference_images", value)} />
                      <SeedancePriceInput label="超额图片（元/张）" value={Number(minimaxH3PriceRule.excess_image_price ?? (miniMaxH3Variant === "max" ? 0.5 : 0.2))} step={0.01} onChange={(value) => setMiniMaxH3PriceValue("excess_image_price", value)} />
                      <SeedancePriceInput label="默认参考视频秒数" value={Number(minimaxH3PriceRule.default_input_video_seconds ?? 4)} step={0.1} onChange={(value) => setMiniMaxH3PriceValue("default_input_video_seconds", value)} />
                      <SeedancePriceInput label="算力点/元" value={Number(minimaxH3PriceRule.points_per_cny ?? 1)} step={0.01} onChange={(value) => setMiniMaxH3PriceValue("points_per_cny", value)} />
                      <SeedancePriceInput label="平台倍率" value={Number(minimaxH3PriceRule.platform_multiplier ?? 1)} step={0.01} onChange={(value) => setMiniMaxH3PriceValue("platform_multiplier", value)} />
                      <SeedancePriceInput label="估价兜底算力" value={Number(minimaxH3PriceRule.fallback_cost ?? (miniMaxH3Variant === "max" ? 2.5 : 4))} step={0.01} onChange={(value) => setMiniMaxH3PriceValue("fallback_cost", value)} />
                    </div>
                    <div className="mt-3 text-[11px] leading-5 text-gray-500">
                      任务完成后优先使用上游返回的实际输出秒数、输入视频秒数和输入图片数量结算；上游未返回 usage 时才使用提交参数估算。
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">上传形态 upload_profile</label>
                    <select
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={getVideoRule(form.runtime_rule).upload_profile}
                      onChange={(e) => {
                        const profile = e.target.value;
                        if (profile === "veo_reference") {
                          setVideoTemplateKey(VEO_REFERENCE_TEMPLATE_KEY);
                          setForm((prev) => applyVeoReferenceV1(prev));
                          return;
                        }
                        if (profile === "veo_frame_pair") {
                          setVideoTemplateKey(VEO_FRAME_PAIR_TEMPLATE_KEY);
                          setForm((prev) => applyVeoFramePairV1(prev));
                          return;
                        }
                        if (profile === "omni_reference") {
                          setVideoTemplateKey(OMNI_REFERENCE_TEMPLATE_KEY);
                          setForm((prev) => applyOmniReferenceV1(prev));
                          return;
                        }
                        if (profile.startsWith("aliyun_happyhorse_")) {
                          const happyHorseProfile = profile.replace("aliyun_happyhorse_", "") as HappyHorseProfile;
                          setVideoTemplateKey(ALIYUN_HAPPYHORSE_TEMPLATE_KEY);
                          setForm((prev) => applyAliyunHappyHorse(prev, happyHorseProfile));
                          return;
                        }
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setVideoRule(prev.runtime_rule, { upload_profile: profile }),
                        }));
                      }}
                    >
                      {VIDEO_PROFILES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">参考图最少 / 最多</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        type="number"
                        min={0}
                        max={20}
                        className="w-full px-3 py-2 rounded-lg border text-sm bg-white"
                        value={getVideoRule(form.runtime_rule).min_reference_images}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            runtime_rule: setVideoRule(prev.runtime_rule, {
                              min_reference_images: parseInt(e.target.value, 10) || 0,
                            }),
                          }))
                        }
                      />
                      <input
                        type="number"
                        min={0}
                        max={20}
                        className="w-full px-3 py-2 rounded-lg border text-sm bg-white"
                        value={getVideoRule(form.runtime_rule).max_reference_images}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            runtime_rule: setVideoRule(prev.runtime_rule, {
                              max_reference_images: parseInt(e.target.value, 10) || 0,
                            }),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">首尾帧模式：参考图槽位 / 总图上限</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        type="number"
                        min={0}
                        max={20}
                        className="w-full px-3 py-2 rounded-lg border text-sm bg-white"
                        value={getVideoRule(form.runtime_rule).ref_slot_max}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            runtime_rule: setVideoRule(prev.runtime_rule, {
                              ref_slot_max: parseInt(e.target.value, 10) || 0,
                            }),
                          }))
                        }
                      />
                      <input
                        type="number"
                        min={0}
                        max={20}
                        className="w-full px-3 py-2 rounded-lg border text-sm bg-white"
                        value={getVideoRule(form.runtime_rule).max_total_images}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            runtime_rule: setVideoRule(prev.runtime_rule, {
                              max_total_images: parseInt(e.target.value, 10) || 0,
                            }),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">前台提示词 placeholder</label>
                    <textarea
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white h-20"
                      value={getVideoRule(form.runtime_rule).prompt_hint}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setVideoRule(prev.runtime_rule, { prompt_hint: e.target.value }),
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-6 px-1">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={getVideoRule(form.runtime_rule).show_channel}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setVideoRule(prev.runtime_rule, { show_channel: e.target.checked }),
                        }))
                      }
                    />
                    前台显示「选择渠道」
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={getVideoRule(form.runtime_rule).show_web_search}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setVideoRule(prev.runtime_rule, { show_web_search: e.target.checked }),
                        }))
                      }
                    />
                    前台显示「联网搜索」
                  </label>
                  <span className="text-[11px] text-gray-400">未勾选则不显示；视频模型不展示「时长 30s」选项</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">生成数量选项（逗号分隔，如 1,3,5,10,30,50）</label>
                    <input
                      key={`video-count-options-${getVideoRule(form.runtime_rule).count_options.join(",")}`}
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      defaultValue={getVideoRule(form.runtime_rule).count_options.join(",")}
                      onBlur={(e) => {
                        const opts = e.target.value
                          .split(/[,，\s]+/)
                          .map((s) => parseInt(s.trim(), 10))
                          .filter((n) => Number.isFinite(n) && n >= 1);
                        const uniq = [...new Set(opts.length ? opts : [1, 3, 5, 10, 30, 50])].sort((a, b) => a - b);
                        const rule = getVideoRule(form.runtime_rule);
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setVideoRule(prev.runtime_rule, { count_options: uniq }),
                          input_schema: syncCountSchema(
                            prev.input_schema,
                            uniq,
                            rule.count_allow_custom,
                            rule.count_max
                          ),
                        }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) e.currentTarget.blur();
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">自定义数量上限</label>
                    <input
                      key={`video-count-max-${getVideoRule(form.runtime_rule).count_max}`}
                      type="number"
                      min={1}
                      max={200}
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      defaultValue={getVideoRule(form.runtime_rule).count_max}
                      onBlur={(e) => {
                        const max = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 50));
                        const rule = getVideoRule(form.runtime_rule);
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setVideoRule(prev.runtime_rule, { count_max: max }),
                          input_schema: syncCountSchema(
                            prev.input_schema,
                            rule.count_options,
                            rule.count_allow_custom,
                            max
                          ),
                        }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) e.currentTarget.blur();
                      }}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 px-1">
                  <input
                    type="checkbox"
                    checked={getVideoRule(form.runtime_rule).count_allow_custom}
                    onChange={(e) => {
                      const rule = getVideoRule(form.runtime_rule);
                      setForm((prev) => ({
                        ...prev,
                        runtime_rule: setVideoRule(prev.runtime_rule, { count_allow_custom: e.target.checked }),
                        input_schema: syncCountSchema(
                          prev.input_schema,
                          rule.count_options,
                          e.target.checked,
                          rule.count_max
                        ),
                      }));
                    }}
                  />
                  允许前台自定义生成数量
                </label>
                <div>
                  <label className="text-xs text-gray-500">upstream.include（传给上游的 params 键）</label>
                  <UpstreamIncludeEditor
                    inputSchemaText={form.input_schema}
                    value={getVideoRule(form.runtime_rule).upstream_include}
                    onChange={(keys) =>
                      setForm((prev) => ({
                        ...prev,
                        runtime_rule: setVideoRule(prev.runtime_rule, { upstream_include: keys }),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">upstream.map（平台键 → 上游键 JSON）</label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-xs font-mono h-24 bg-white"
                    value={getVideoRule(form.runtime_rule).upstream_map}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        runtime_rule: setVideoRule(prev.runtime_rule, { upstream_map: e.target.value }),
                      }))
                    }
                  />
                </div>
              </div>
            ) : form.category === "audio" ? (
              <div className="space-y-4">
                <div className="text-xs text-gray-500">
                  音频模型通过 runtime_rule.audio 驱动输入区布局与计费展示；input_schema 定义底部参数条（x-widget / x-order / x-icon）。
                </div>
                <div>
                  <label className="text-xs text-gray-500">上游接口模板</label>
                  <select
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={audioTemplateKey}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAudioTemplateKey(value);
                      if (!value) return;
                      setForm((prev) => {
                        switch (value) {
                          case "yunwu_minimax_speech":
                            return applyAudioYunwuMinimaxSpeechStandard(prev);
                          case "minimax_official_speech":
                            return applyAudioMinimaxOfficialSpeechStandard(prev);
                          case "minimax_official_tts":
                            return applyAudioMinimaxOfficialTtsStandard(prev);
                          case "openai_audio_speech":
                            return applyAudioStandard(prev);
                          case "minimax_official_music":
                            return applyAudioMinimaxOfficialMusicStandard(prev);
                          case "openai_audio_music":
                            return applyAudioMusicSpeechStandard(prev);
                          case "aliyun_qwen_audio_tts":
                            return applyAliyunTTS(prev, "qwen");
                          case "aliyun_cosyvoice":
                            return applyAliyunTTS(prev, "cosyvoice");
                          case "aliyun_fun_music":
                            return applyAliyunFunMusic(prev);
                          default:
                            return prev;
                        }
                      });
                    }}
                  >
                    <option value="">选择模板后自动填充配置...</option>
                    <option disabled>单文本框（TTS / 克隆）</option>
                    <option value="yunwu_minimax_speech">云雾 API MiniMax Speech 2.8 HD（/minimax/v1/t2a_v2）</option>
                    <option value="minimax_official_speech">MiniMax 官方 Speech 2.8（api.minimax.cn/v1/t2a_v2）</option>
                    <option value="minimax_official_tts">MiniMax / 海螺旧版兼容网关（/v1/audio/speech）</option>
                    <option value="openai_audio_speech">第三方 OpenAI 兼容 Speech（/v1/audio/speech，input/voice/metadata）</option>
                    <option value="aliyun_qwen_audio_tts">阿里云百炼 · Qwen-Audio-TTS</option>
                    <option value="aliyun_cosyvoice">阿里云百炼 · CosyVoice</option>
                    <option disabled>双文本框（音乐生成）</option>
                    <option value="minimax_official_music">MiniMax 官方 Music-3.0 / 2.6（api.minimax.cn/v1/music_generation）</option>
                    <option value="openai_audio_music">第三方 OpenAI 兼容 Music（/v1/audio/speech，metadata.lyrics）</option>
                    <option value="aliyun_fun_music">阿里云百炼 · Fun-Music</option>
                  </select>
                  <div className="text-[11px] text-gray-400 mt-1">
                    模板会覆盖 endpoint、input_schema、default_params、runtime_rule；连接密钥仍在 new_api_extra_params.connection 中单独配置。
                  </div>
                  {audioTemplateKey === "minimax_official_music" && (
                    <div className="text-[11px] text-amber-600 mt-1">
                      MiniMax 官方自 2026-08-20 起不再向新用户开放付费音乐 API，免费模型也已停服；此模板仅适用于已有音乐 API 权限的账号。
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">输入布局 input_layout</label>
                    <select
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={getAudioRule(form.runtime_rule).input_layout}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setAudioRule(prev.runtime_rule, { input_layout: e.target.value }),
                        }))
                      }
                    >
                      <option value="single">单文本框（TTS / 克隆）</option>
                      <option value="dual">双文本框（歌词 + 风格，如 Suno）</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">右上角计费展示</label>
                    <select
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={getAudioRule(form.runtime_rule).billing_hint}
                      onChange={(e) =>
                        setForm((prev) => {
                          const billingHint = e.target.value as "per_token" | "estimated";
                          const price = safeParseJson(prev.price_rule, {}) || {};
                          const inputPrice = Number(price.input_price ?? 0);
                          const outputPrice = Number(price.output_price ?? 0);
                          const nextPrice =
                            billingHint === "estimated"
                              ? {
                                  ...price,
                                  billing_type: "per_request",
                                  currency: price.currency || "¥",
                                  unit_price: Number(price.unit_price ?? 0.01) || 0.01,
                                }
                              : {
                                  ...price,
                                  billing_type: "per_token",
                                  currency: price.currency || "¥",
                                  input_price_per_m: Number(price.input_price_per_m ?? (inputPrice > 0 ? inputPrice * 1_000_000 : 2)) || 0,
                                  output_price_per_m: Number(price.output_price_per_m ?? (outputPrice > 0 ? outputPrice * 1_000_000 : 4)) || 0,
                                };
                          delete (nextPrice as Record<string, unknown>).input_price;
                          delete (nextPrice as Record<string, unknown>).output_price;
                          return {
                            ...prev,
                            runtime_rule: setAudioRule(prev.runtime_rule, {
                              billing_hint: billingHint,
                            }),
                            price_rule: JSON.stringify(nextPrice, null, 2),
                          };
                        })
                      }
                    >
                      <option value="per_token">按token计费</option>
                      <option value="estimated">预计 ⚡ x.xx/次</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">主文本 placeholder</label>
                    <textarea
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white h-20"
                      value={getAudioRule(form.runtime_rule).prompt_hint}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setAudioRule(prev.runtime_rule, { prompt_hint: e.target.value }),
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">副文本 placeholder（dual 布局）</label>
                    <textarea
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white h-20"
                      value={getAudioRule(form.runtime_rule).secondary_prompt_hint}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setAudioRule(prev.runtime_rule, { secondary_prompt_hint: e.target.value }),
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-6 px-1">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={getAudioRule(form.runtime_rule).show_channel}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setAudioRule(prev.runtime_rule, { show_channel: e.target.checked }),
                        }))
                      }
                    />
                    前台显示「选择渠道」
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={getAudioRule(form.runtime_rule).show_web_search}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setAudioRule(prev.runtime_rule, { show_web_search: e.target.checked }),
                        }))
                      }
                    />
                    前台显示「联网搜索」
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={getAudioRule(form.runtime_rule).show_upload}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setAudioRule(prev.runtime_rule, { show_upload: e.target.checked }),
                        }))
                      }
                    />
                    前台显示「上传参考音频」
                  </label>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  音频模型固定为单结果生成，不向前台提供批量数量选项。
                </div>
                <div>
                  <label className="text-xs text-gray-500">upstream.include</label>
                  <UpstreamIncludeEditor
                    inputSchemaText={form.input_schema}
                    value={getAudioRule(form.runtime_rule).upstream_include}
                    onChange={(keys) =>
                      setForm((prev) => ({
                        ...prev,
                        runtime_rule: setAudioRule(prev.runtime_rule, { upstream_include: keys }),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">upstream.map（JSON）</label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-xs font-mono h-24 bg-white"
                    value={getAudioRule(form.runtime_rule).upstream_map}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        runtime_rule: setAudioRule(prev.runtime_rule, { upstream_map: e.target.value }),
                      }))
                    }
                  />
                </div>
              </div>
            ) : form.category === "multi_collab" ? (
              <div className="text-xs text-gray-500 leading-relaxed">
                多模型协作入口不需要配置“联网搜索 / 深度思考”等单模型能力。默认渠道由上方选择，保存后写入 default_params.channel_key。
              </div>
            ) : (
              <>
                <div className="text-xs text-gray-500 mb-3">保存到 runtime_rule.capabilities</div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={getCaps(form.runtime_rule).web_search}
                      onChange={(e) => {
                        const { rr, deep_think } = getCaps(form.runtime_rule);
                        const next = { ...rr, capabilities: { ...(rr?.capabilities ?? {}), web_search: e.target.checked, deep_think } };
                        setForm((prev) => ({ ...prev, runtime_rule: JSON.stringify(next, null, 2) }));
                      }}
                    />
                    联网搜索
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={getCaps(form.runtime_rule).deep_think}
                      onChange={(e) => {
                        const { rr, web_search } = getCaps(form.runtime_rule);
                        const next = { ...rr, capabilities: { ...(rr?.capabilities ?? {}), web_search, deep_think: e.target.checked } };
                        setForm((prev) => ({ ...prev, runtime_rule: JSON.stringify(next, null, 2) }));
                      }}
                    />
                    深度思考
                  </label>
                  {form.category === "chat" && <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={getCaps(form.runtime_rule).vision}
                      onChange={(e) => {
                        const { rr } = getCaps(form.runtime_rule);
                        const next = {
                          ...rr,
                          capabilities: {
                            ...(rr?.capabilities ?? {}),
                            vision: e.target.checked,
                            ...(!e.target.checked ? { multimodal: false, image_input: false } : {}),
                          },
                        };
                        setForm((prev) => ({ ...prev, runtime_rule: JSON.stringify(next, null, 2) }));
                      }}
                    />
                    图片理解（可接收参考图）
                  </label>}
                  {form.category === "chat" && <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={getCaps(form.runtime_rule).video_analysis}
                      onChange={(e) => {
                        const { rr } = getCaps(form.runtime_rule);
                        const next = { ...rr, capabilities: { ...(rr?.capabilities ?? {}), video_analysis: e.target.checked } };
                        setForm((prev) => ({ ...prev, runtime_rule: JSON.stringify(next, null, 2) }));
                      }}
                    />
                    视频理解（可接收原始视频）
                  </label>}
                  {form.category === "chat" && <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={getCaps(form.runtime_rule).audio_analysis}
                      onChange={(e) => {
                        const { rr } = getCaps(form.runtime_rule);
                        const next = { ...rr, capabilities: { ...(rr?.capabilities ?? {}), audio_analysis: e.target.checked } };
                        setForm((prev) => ({ ...prev, runtime_rule: JSON.stringify(next, null, 2) }));
                      }}
                    />
                    音频理解（可接收参考音频）
                  </label>}
                  {getCaps(form.runtime_rule).deep_think && (
                    <div className="w-full rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                      <div className="text-xs text-gray-600 mb-2">思考参数映射（保存到 runtime_rule.reasoning）</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1 text-xs text-gray-500">
                          映射模式
                          <select
                            className="px-2 py-1.5 rounded-lg border bg-white text-xs text-gray-700"
                            value={getReasoning(form.runtime_rule).mode}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, runtime_rule: setReasoning(prev.runtime_rule, { mode: e.target.value }) }))
                            }
                          >
                            <option value="">自动识别（按上游模型与协议）</option>
                            <option value="unsupported">不支持思考开关</option>
                            <option value="always_on">固定思考（不可切换）</option>
                            <option value="thinking_type">GLM / DeepSeek · thinking.type</option>
                            <option value="glm_thinking">GLM thinking（兼容已有配置）</option>
                            <option value="reasoning_effort">OpenAI 兼容 · reasoning_effort</option>
                            <option value="claude_budget">Claude · 思考预算</option>
                            <option value="claude_adaptive">Claude · 自适应思考</option>
                            <option value="gemini_level">Gemini 原生 · 思考等级</option>
                            <option value="gemini_budget">Gemini 原生 · 思考预算</option>
                            <option value="enable_thinking">Qwen / DashScope · enable_thinking</option>
                            <option value="nvidia_chat_template">NVIDIA chat_template_kwargs</option>
                            <option value="custom">自定义开关参数（JSON）</option>
                          </select>
                        </label>
                        <label className="flex items-end gap-2 text-xs text-gray-500 pb-1.5">
                          <input
                            type="checkbox"
                            checked={getReasoning(form.runtime_rule).default_enabled}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, runtime_rule: setReasoning(prev.runtime_rule, { default_enabled: e.target.checked }) }))
                            }
                          />
                          默认开启思考
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-gray-500">
                          默认预算（default_budget）
                          <input
                            type="number"
                            min={1}
                            className="px-2 py-1.5 rounded-lg border bg-white text-xs text-gray-700"
                            value={getReasoning(form.runtime_rule).default_budget || ""}
                            placeholder="如 16384"
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, runtime_rule: setReasoning(prev.runtime_rule, { default_budget: Number(e.target.value) }) }))
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-gray-500">
                          最大预算（max_budget）
                          <input
                            type="number"
                            min={1}
                            className="px-2 py-1.5 rounded-lg border bg-white text-xs text-gray-700"
                            value={getReasoning(form.runtime_rule).max_budget || ""}
                            placeholder="如 16384"
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, runtime_rule: setReasoning(prev.runtime_rule, { max_budget: Number(e.target.value) }) }))
                            }
                          />
                        </label>
                      </div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {([['on_effort', '开启强度（如 high）'], ['off_effort', '关闭时强度（如 none / low）']] as const).map(([key, label]) => <label key={key} className="flex flex-col gap-1 text-xs text-gray-500">{label}<input className="rounded-lg border bg-white px-2 py-1.5" value={String(getReasoning(form.runtime_rule).reasoning[key] || '')} onChange={(e) => setForm((prev) => ({ ...prev, runtime_rule: setReasoning(prev.runtime_rule, { [key]: e.target.value }) }))} /></label>)}
                        {getReasoning(form.runtime_rule).mode === 'custom' && (['on_params', 'off_params'] as const).map((key) => <label key={key} className="flex flex-col gap-1 text-xs text-gray-500">{key === 'on_params' ? '开启参数 JSON' : '关闭参数 JSON'}<textarea key={`${form.code}-${key}`} className="rounded-lg border bg-white px-2 py-1.5 font-mono" rows={4} defaultValue={JSON.stringify(getReasoning(form.runtime_rule).reasoning[key] || {}, null, 2)} onBlur={(e) => { try { const value = JSON.parse(e.target.value); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); setForm((prev) => ({ ...prev, runtime_rule: setReasoning(prev.runtime_rule, { [key]: value }) })); e.currentTarget.setCustomValidity(''); } catch { e.currentTarget.setCustomValidity('请输入有效 JSON 对象'); e.currentTarget.reportValidity(); } }} /></label>)}
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-gray-400">
                        按实际线路协议转换参数；线路 runtime_rule.reasoning 可覆盖这里的设置。强度值必须符合该模型文档，不能关闭思考的模型请将关闭强度设为 low。自定义映射需同时提供不同的开启和关闭参数；关闭代表完全关闭时，可在运行规则 JSON 中设置 can_disable=true。
                      </p>
                    </div>
                  )}
                  {form.category === "video" && ([
                    ["video_upscale", "支持视频超分 / 高清增强"],
                    ["video_redraw", "支持视频转视频 / 风格转绘"],
                    ["subtitle_remove", "支持硬字幕移除 / 画面修复"],
                  ] as const).map(([capability, label]) => (
                    <label key={capability} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={(safeParseJson(form.runtime_rule, {}) as Record<string, any>)?.capabilities?.[capability] === true}
                        onChange={(e) => {
                          const rr = safeParseJson(form.runtime_rule, {}) as Record<string, any>;
                          const next = {
                            ...rr,
                            capabilities: {
                              ...(rr?.capabilities ?? {}),
                              [capability]: e.target.checked,
                            },
                          };
                          setForm((prev) => ({ ...prev, runtime_rule: JSON.stringify(next, null, 2) }));
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {form.category === "video" && (
                  <p className="mt-3 text-[11px] leading-5 text-gray-400">
                    能力开关只用于工作流筛选和配置提示，不会让普通文生视频接口自动获得对应能力。请确保上游真实支持，并在 upstream.include / map 中映射 operation、video_url / reference_videos 及各工作流参数。
                  </p>
                )}
              </>
            )}
          </div>
          {form.category !== "multi_collab" && (
            <details className="col-span-2 rounded-2xl border bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-gray-800">
                高级 JSON 配置（一般不用打开）
              </summary>
              <div className="mt-4 grid grid-cols-2 gap-4">
          {field(
            "price_rule (JSON)",
            <>
              <textarea
                className="w-full mt-1 px-3 py-2 rounded-lg border text-xs font-mono h-24"
                value={form.price_rule}
                onChange={(e) => setForm({ ...form, price_rule: e.target.value })}
              />
              <div className="mt-1 text-[11px] text-gray-400 leading-relaxed">
                按 token 计费可直接填「每 1M Tokens」价格：
                <code className="block mt-0.5 text-gray-500">
                  {`{"billing_type":"per_token","currency":"¥","input_price_per_m":12.75,"output_price_per_m":63.75,"cache_read_price_per_m":1.275,"surcharge_per_m":1}`}
                </code>
                可选字段：cache_write_price_per_m（缓存写入）、surcharge_per_m（平台附加费，每 1M tokens 在真实费用上加收，如填 1 表示每百万 token 加收 1）。也兼容旧的 per-token 字段（input_price / output_price，单 token 价格）。
              </div>
            </>
          )}
          {field(
            "new_api_extra_params (JSON)",
            <textarea
              className="w-full mt-1 px-3 py-2 rounded-lg border text-xs font-mono h-24"
              value={form.new_api_extra_params}
              onChange={(e) => setForm({ ...form, new_api_extra_params: e.target.value })}
            />
          )}
          {field(
            "runtime_rule (JSON)",
            <textarea
              className="w-full mt-1 px-3 py-2 rounded-lg border text-xs font-mono h-24"
              value={form.runtime_rule}
              onChange={(e) => setForm({ ...form, runtime_rule: e.target.value })}
            />
          )}
          {field(
            "default_params (JSON)",
            <textarea
              className="w-full mt-1 px-3 py-2 rounded-lg border text-xs font-mono h-24"
              value={form.default_params}
              onChange={(e) => setForm({ ...form, default_params: e.target.value })}
            />
          )}
          <div className="col-span-2">
            {field(
              "input_schema (JSON)",
              <textarea
                className="w-full mt-1 px-3 py-2 rounded-lg border text-xs font-mono h-32"
                value={form.input_schema}
                onChange={(e) => setForm({ ...form, input_schema: e.target.value })}
              />
            )}
          </div>
              </div>
            </details>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_enabled}
              onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
            />
            启用
          </label>
          {form.id !== null && form.id > 0 && form.category !== "multi_collab" && (
            <ModelRoutesEditor
              modelId={form.id}
              upstreamModel={form.new_api_model}
              endpoint={form.new_api_endpoint}
              requestMode={form.request_mode}
              modelBillingType={String((safeParseJson(form.price_rule, {}) as Record<string, unknown>).billing_type || "per_token")}
              onPrimaryBillingTypeChange={(billingType) => {
                setForm((current) => ({
                  ...current,
                  price_rule: JSON.stringify(switchedPriceRule(
                    safeParseJson(current.price_rule, {}) as Record<string, any>,
                    billingType as ModelBillingType
                  ), null, 2),
                }));
              }}
              onPrimaryConnectionChange={(connection) => {
                setForm((current) => ({
                  ...current,
                  new_api_model: connection.upstreamModel,
                  new_api_endpoint: connection.endpoint,
                  new_api_extra_params: setConnection(current.new_api_extra_params, {
                    provider: connection.provider,
                    protocol: connection.protocol === "openai" ? "openai_compatible" : connection.protocol,
                    base_url: connection.baseUrl,
                    ...(connection.apiKey !== undefined ? { api_key: connection.apiKey } : {}),
                    auth_type: connection.authType,
                    api_key_header: connection.apiKeyHeader,
                  }),
                }));
                void load();
              }}
            />
          )}
          {err && <p className="col-span-2 text-sm text-red-500">{err}</p>}
          <button type="submit" className="col-span-2 py-2 bg-primary rounded-xl text-dark font-semibold">
            {form.id ? "保存修改" : "创建"}
          </button>
        </form>,
        formMount
      )}

      <div className="bg-white rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-4 py-3">图标</th>
              <th className="text-left px-4 py-3">编码</th>
              <th className="text-left px-4 py-3">名称</th>
              <th className="text-left px-4 py-3">分类</th>
              <th className="text-left px-4 py-3">请求模式</th>
              <th className="text-left px-4 py-3">排序</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {paginated.map((m) => (
              <Fragment key={m.id}>
              <tr>
                <td className="px-4 py-3"><ModelLogo model={m} /></td>
                <td className="px-4 py-3 font-mono text-xs">{m.code}</td>
                <td className="px-4 py-3">{m.display_name}</td>
                <td className="px-4 py-3">{m.category}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{m.request_mode}</td>
                <td className="px-4 py-3">{m.sort_order}</td>
                <td className="px-4 py-3">
                  <span className={m.is_enabled ? "text-green-600" : "text-gray-400"}>
                    {m.is_enabled ? "启用" : "禁用"}
                  </span>
                </td>
                <td className="min-w-[260px] px-4 py-3">
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => testConnection(m)}
                      disabled={testingModelId !== null}
                      title={testingModelId === m.id ? "正在测试连接" : "测试连接"}
                      aria-label={`测试 ${m.display_name} 的模型连接`}
                      className={[
                        "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition",
                        testingModelId === m.id
                          ? "border-blue-200 bg-blue-50 text-blue-600"
                          : connectionTests[m.id]?.ok
                            ? "border-green-200 bg-green-50 text-green-600 hover:bg-green-100"
                            : connectionTests[m.id]
                              ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                              : "border-gray-200 bg-white text-gray-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600",
                        testingModelId !== null && testingModelId !== m.id ? "cursor-not-allowed opacity-40" : "",
                      ].join(" ")}
                    >
                      <ConnectionTestIcon loading={testingModelId === m.id} />
                    </button>
                    <button onClick={() => openEdit(m)} className="text-xs text-secondary hover:underline">
                      编辑
                    </button>
                    <button onClick={() => toggleEnabled(m)} className="text-xs text-gray-500 hover:underline">
                      {m.is_enabled ? "禁用" : "启用"}
                    </button>
                    <button onClick={() => remove(m)} className="text-xs text-red-500 hover:underline">
                      删除
                    </button>
                  </div>
                  {testingModelId === m.id && <p className="mt-1.5 text-[11px] text-blue-600">正在验证地址、鉴权与模型路由…</p>}
                  {testingModelId !== m.id && connectionTests[m.id] && (
                    <p
                      className={connectionTests[m.id].ok ? "mt-1.5 max-w-[300px] whitespace-normal text-[11px] leading-4 text-green-600" : "mt-1.5 max-w-[300px] whitespace-normal text-[11px] leading-4 text-red-600"}
                      title={connectionTests[m.id].message}
                    >
                      {connectionTests[m.id].ok ? "连接正常" : "连接失败"} · {connectionTests[m.id].message}
                      {connectionTests[m.id].latency_ms > 0 ? `（${connectionTests[m.id].latency_ms}ms）` : ""}
                    </p>
                  )}
                </td>
              </tr>
              {showForm && form.id === m.id && (
                <tr>
                  <td ref={setFormMount} colSpan={8} className="p-0 align-top" />
                </tr>
              )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-10">
                  没有符合条件的模型
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AdminPagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </div>
  );
}
