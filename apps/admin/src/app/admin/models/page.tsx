"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi, adminUploadFile } from "@/lib/api";
import { UpstreamIncludeEditor } from "@/components/UpstreamIncludeEditor";
import { AdminPagination } from "@/components/AdminPagination";

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

const REQUEST_MODES = ["chat_completions", "responses", "images", "video", "audio", "custom"];
const PAGE_SIZE = 10;

function ModelLogo({ model }: { model: Pick<AdminModel, "display_name" | "icon_url" | "code"> }) {
  const [failed, setFailed] = useState(false);
  const initial = (model.display_name || model.code || "M").slice(0, 1).toUpperCase();
  if (model.icon_url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={model.icon_url} alt={model.display_name} onError={() => setFailed(true)} className="h-9 w-9 rounded-xl object-cover ring-1 ring-gray-100" />;
  }
  return <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-950 text-xs font-semibold text-white">{initial}</div>;
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
];

const lobeLogoUrls = (file: string) => [
  `https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/light/${file}`,
  `https://unpkg.com/@lobehub/icons-static-png@1.91.0/light/${file}`,
];
const lobeLogoUrl = (file: string) => lobeLogoUrls(file)[0];

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

const IMAGE_ENDPOINT_PRESETS = [
  {
    key: "openai_images",
    label: "OpenAI / NEW API 图片生成",
    endpoint: "/v1/images/generations",
    model: "gpt-image-1",
    description: "适合兼容 OpenAI Images 的上游，支持 n/count 批量生成。",
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
    setErr("");
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
    setErr("");
    setShowForm(true);
  };

  const safeParseJson = (text: string, fallback: any) => {
    try {
      return JSON.parse(text || "{}");
    } catch {
      return fallback;
    }
  };

  const getCaps = (runtimeRuleText: string) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const caps = (rr?.capabilities ?? {}) as Record<string, any>;
    return {
      rr,
      web_search: !!caps.web_search,
      deep_think: !!caps.deep_think,
    };
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
      base_url: String(c.base_url ?? ""),
      api_key: String(c.api_key ?? ""),
      auth_type: String(c.auth_type ?? "bearer"),
      api_key_header: String(c.api_key_header ?? "Authorization"),
      protocol: String(c.protocol ?? "openai_compatible"),
    };
  };

  const setConnection = (extraText: string, patch: Record<string, unknown>) => {
    const extra = safeParseJson(extraText, {});
    const prev = (extra?.connection ?? {}) as Record<string, unknown>;
    return JSON.stringify({ ...extra, connection: { ...prev, ...patch } }, null, 2);
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
    const raw = image.max_reference_images;
    const parsed = raw === undefined || raw === null || raw === "" ? 4 : Number(raw);
    return {
      rr,
      max_reference_images: Math.max(0, Math.min(20, Number.isFinite(parsed) ? parsed : 4)),
    };
  };

  const setImageMaxRefs = (runtimeRuleText: string, n: number) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const max = Math.max(0, Math.min(20, Number.isFinite(n) ? n : 4));
    return JSON.stringify(
      {
        ...rr,
        image: { ...(rr?.image ?? {}), max_reference_images: max },
        capabilities: { ...(rr?.capabilities ?? {}), web_search: false, deep_think: false },
      },
      null,
      2
    );
  };

  const isBananaImageForm = (state: FormState = form) =>
    state.category === "image" &&
    state.request_mode === "images" &&
    state.new_api_endpoint === "/v1/videos" &&
    state.new_api_model.startsWith("nano_banana");

  const setImageRule = (
    runtimeRuleText: string,
    patch: { max_reference_images?: number; poll_path?: string; poll_interval_sec?: number; poll_timeout_sec?: number }
  ) => {
    const rr = safeParseJson(runtimeRuleText, {});
    const image = (rr?.image ?? {}) as Record<string, any>;
    const upstream = (rr?.upstream ?? {}) as Record<string, any>;
    const nextImage = { ...image };
    if (patch.max_reference_images !== undefined) {
      nextImage.max_reference_images = Math.max(0, Math.min(20, Number(patch.max_reference_images) || 0));
    }
    const nextUpstream = { ...upstream };
    if (patch.poll_path !== undefined) nextUpstream.poll_path = patch.poll_path;
    if (patch.poll_interval_sec !== undefined) nextUpstream.poll_interval_sec = patch.poll_interval_sec;
    if (patch.poll_timeout_sec !== undefined) nextUpstream.poll_timeout_sec = patch.poll_timeout_sec;
    return JSON.stringify(
      {
        ...rr,
        image: nextImage,
        upstream: nextUpstream,
        capabilities: { ...(rr?.capabilities ?? {}), web_search: false, deep_think: false },
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

  const applyImageEndpointPreset = (prev: FormState, presetKey: string): FormState => {
    const preset = IMAGE_ENDPOINT_PRESETS.find((x) => x.key === presetKey) || IMAGE_ENDPOINT_PRESETS[0];
    const isBanana = preset.key === "banana_async";
    const modelName = isBanana
      ? (BANANA_MODELS.includes(prev.new_api_model) ? prev.new_api_model : preset.model)
      : (prev.new_api_model && !prev.new_api_model.startsWith("nano_banana") ? prev.new_api_model : preset.model);
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
          quality: "auto",
          max_reference_images: isBanana ? 5 : getImageRule(prev.runtime_rule).max_reference_images,
        },
        null,
        2
      ),
      runtime_rule: setImageRule(clearModelCaps(prev.runtime_rule), {
        max_reference_images: isBanana ? 5 : getImageRule(prev.runtime_rule).max_reference_images,
        poll_path: isBanana ? "/v1/videos/{id}" : undefined,
        poll_interval_sec: isBanana ? 5 : undefined,
        poll_timeout_sec: isBanana ? 3600 : undefined,
      }),
      price_rule: JSON.stringify({ billing_type: "per_image", currency: "¥", unit_price: 0.01 }, null, 2),
    };
  };

  const VIDEO_PROFILES = [
    { value: "single_ref", label: "单参考图 (Sora 类)" },
    { value: "multi_ref", label: "多参考图 1~N (SD 类)" },
    { value: "frame_pair", label: "首尾帧 + 参考图 (VEO 类)" },
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
      prompt_hint: video.prompt_hint || "",
      show_channel: video.show_channel !== false,
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
          prompt_required: true,
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
        },
        upstream: { include, map: mapObj },
        capabilities: { ...(rr?.capabilities ?? {}), web_search: false, deep_think: false },
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
          prompt_required: true,
          billing_hint: next.billing_hint,
          show_channel: next.show_channel,
          show_web_search: next.show_web_search,
          show_upload: next.show_upload,
          count_options: next.count_options?.length ? next.count_options : [1, 3, 5, 10, 30, 50],
          count_allow_custom: next.count_allow_custom,
          count_max: Math.max(1, next.count_max || 50),
        },
        upstream: { include, map: mapObj },
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
    new_api_endpoint: ENDPOINT_BY_MODE.audio,
    runtime_rule: setAudioRule(clearModelCaps(prev.runtime_rule), {
      input_layout: "single",
      billing_hint: "per_token",
      count_options: [1, 3, 5, 10, 30, 50],
      count_allow_custom: true,
      count_max: 50,
      prompt_hint: "输入文本内容，选择音色即可生成语音",
      upstream_include: ["count", "speed", "format"],
      upstream_map: JSON.stringify({ count: "n", format: "response_format" }, null, 2),
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
          format: {
            type: "string",
            title: "输出格式",
            enum: ["mp3", "wav"],
            enumLabels: { mp3: "MP3", wav: "WAV" },
            default: "mp3",
            "x-order": 3,
            "x-widget": "option_menu",
            "x-icon": "format",
          },
        },
      },
      null,
      2
    ),
    default_params: JSON.stringify({ count: 1, speed: "1.0x", format: "mp3" }, null, 2),
    price_rule: JSON.stringify({ billing_type: "per_token", input_price: 0.000002, output_price: 0.000004 }, null, 2),
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

  const applyImageStandard = (prev: FormState): FormState => ({
    ...applyImageEndpointPreset(prev, prev.new_api_endpoint === "/v1/videos" ? "banana_async" : "openai_images"),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    let inputSchema: unknown, defaultParams: unknown, extraParams: unknown, priceRule: unknown, runtimeRule: unknown;
    try {
      inputSchema = JSON.parse(form.input_schema || "{}");
      defaultParams = JSON.parse(form.default_params || "{}");
      extraParams = JSON.parse(form.new_api_extra_params || "{}");
      priceRule = JSON.parse(form.price_rule || "{}");
      runtimeRule = JSON.parse(form.runtime_rule || "{}");
    } catch {
      setErr("JSON 字段格式有误，请检查 input_schema / default_params / new_api_extra_params / price_rule / runtime_rule");
      return;
    }
    const isMultiCollabForm = form.category === "multi_collab";
    const defaultChannelKey = getDefaultChannelKey(form.default_params);
    const connection = getConnection(form.new_api_extra_params);
    if (!isMultiCollabForm && !connection.base_url.trim()) {
      setErr("模型接入配置的 Base URL 为必填");
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
    const payload = {
      code: form.code,
      display_name: form.display_name,
      icon_url: form.icon_url,
      new_api_model: isMultiCollabForm ? form.code || "multi_collab" : form.new_api_model,
      new_api_endpoint: isMultiCollabForm ? "" : form.new_api_endpoint,
      request_mode: isMultiCollabForm ? "chat_completions" : form.request_mode,
      category: form.category,
      description: form.description,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      input_schema: inputSchema,
      default_params: isMultiCollabForm ? { ...(defaultParams as Record<string, unknown>), channel_key: defaultChannelKey } : defaultParams,
      new_api_extra_params: isMultiCollabForm ? {} : extraParams,
      price_rule: priceRule,
      runtime_rule:
        form.category === "image"
          ? {
              ...(runtimeRule as Record<string, unknown>),
              image: {
                ...(((runtimeRule as Record<string, any>)?.image ?? {}) as Record<string, unknown>),
                max_reference_images: getImageRule(form.runtime_rule).max_reference_images,
              },
              capabilities: {
                ...(((runtimeRule as Record<string, any>)?.capabilities ?? {}) as Record<string, unknown>),
                web_search: false,
                deep_think: false,
              },
            }
          : form.category === "video"
            ? JSON.parse(setVideoRule(form.runtime_rule, getVideoRule(form.runtime_rule)))
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
    await adminApi(`/models/${m.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        code: m.code,
        display_name: m.display_name,
        icon_url: m.icon_url || "",
        new_api_model: m.new_api_model,
        request_mode: m.request_mode,
        category: m.category,
        description: m.description || "",
        tags: m.tags || [],
        runtime_rule: m.runtime_rule || {},
        input_schema: m.input_schema || {},
        default_params: m.default_params || {},
        new_api_extra_params: m.new_api_extra_params || {},
        price_rule: m.price_rule || {},
        is_enabled: !m.is_enabled,
        sort_order: m.sort_order,
        new_api_endpoint: m.new_api_endpoint,
      }),
    });
    load();
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
    <div>
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

  return (
    <div>
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

      {showForm && (
        <form onSubmit={submit} className="bg-white rounded-2xl p-6 border mb-6 grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
              {field(
                "接入协议",
                <select
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  value={getConnection(form.new_api_extra_params).protocol}
                  onChange={(e) => setForm((prev) => ({ ...prev, new_api_extra_params: setConnection(prev.new_api_extra_params, { protocol: e.target.value }) }))}
                >
                  <option value="openai_compatible">OpenAI / NEW API 兼容</option>
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
                "Base URL（必选）",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  placeholder="例如：https://api.openai.com 或 https://xxx/v1 前缀"
                  value={getConnection(form.new_api_extra_params).base_url}
                  required
                  onChange={(e) => setForm((prev) => ({ ...prev, new_api_extra_params: setConnection(prev.new_api_extra_params, { base_url: e.target.value }) }))}
                />
              )}
              {field(
                "API Key（必选）",
                <input
                  className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                  placeholder="仅后台保存；生产建议后续改为加密存储"
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
            </div>
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
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={lobeLogoUrl(logo.file)}
                            alt=""
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              const img = e.currentTarget;
                              const fallback = lobeLogoUrls(logo.file)[1];
                              if (img.src !== fallback) img.src = fallback;
                            }}
                          />
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
                  const next = {
                    ...prev,
                    request_mode: e.target.value,
                    new_api_endpoint: ENDPOINT_BY_MODE[e.target.value] ?? prev.new_api_endpoint,
                  };
                  return e.target.value === "images"
                    ? applyImageStandard(next)
                    : e.target.value === "video"
                      ? applyVideoStandard(next)
                      : next;
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
                  if (e.target.value === "multi_collab") return applyMultiCollabStandard(prev);
                  if (e.target.value === "image") return applyImageStandard(prev);
                  if (e.target.value === "video") return applyVideoStandard(prev);
                  if (e.target.value === "audio") return applyAudioStandard(prev);
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
                  value={isBananaImageForm() ? "banana_async" : form.new_api_endpoint === "/v1/images/generations" ? "openai_images" : "custom"}
                  onChange={(e) => {
                    if (e.target.value === "custom") return;
                    setForm((prev) => applyImageEndpointPreset(prev, e.target.value));
                  }}
                >
                  {IMAGE_ENDPOINT_PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">自定义 Endpoint</option>
                </select>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  value={form.new_api_endpoint}
                  placeholder="/v1/images/generations 或 /v1/videos"
                  onChange={(e) => setForm({ ...form, new_api_endpoint: e.target.value })}
                />
                <div className="text-[11px] text-gray-400">
                  {isBananaImageForm()
                    ? "香蕉图片接口固定使用 /v1/videos，系统会自动创建任务、轮询进度，并按图片结果展示。"
                    : "普通图片接口通常使用 /v1/images/generations。"}
                </div>
              </div>
            ) : (
              <input
                className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
                value={form.new_api_endpoint}
                onChange={(e) => setForm({ ...form, new_api_endpoint: e.target.value })}
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
                    不懂 JSON 也可以在这里完成配置。选择香蕉接口后，系统会自动使用 /v1/videos 创建任务、轮询结果，并把结果按图片展示。
                  </div>
                </div>
                {isBananaImageForm() && (
                  <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs text-emerald-700">
                    已启用香蕉 API 兼容
                  </div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500">接口类型</label>
                  <select
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={isBananaImageForm() ? "banana_async" : "openai_images"}
                    onChange={(e) => setForm((prev) => applyImageEndpointPreset(prev, e.target.value))}
                  >
                    {IMAGE_ENDPOINT_PRESETS.map((preset) => (
                      <option key={preset.key} value={preset.key}>{preset.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">上游模型</label>
                  {isBananaImageForm() ? (
                    <select
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={form.new_api_model}
                      onChange={(e) => setForm((prev) => ({ ...prev, new_api_model: e.target.value }))}
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
                  <label className="text-xs text-gray-500">每张扣费</label>
                  <input
                    type="number"
                    min={0}
                    step="0.0001"
                    className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                    value={Number((safeParseJson(form.price_rule, {}) as any).unit_price ?? 0)}
                    onChange={(e) => {
                      const price = Math.max(0, Number(e.target.value) || 0);
                      setForm((prev) => ({
                        ...prev,
                        price_rule: JSON.stringify({ ...(safeParseJson(prev.price_rule, {}) || {}), billing_type: "per_image", currency: "¥", unit_price: price }, null, 2),
                      }));
                    }}
                  />
                </div>
              </div>
              {isBananaImageForm() && (
                <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-6 text-gray-600">
                  Base URL 填 <code className="rounded bg-white px-1 py-0.5">https://otuapi.com</code>，Endpoint 固定为 <code className="rounded bg-white px-1 py-0.5">/v1/videos</code>。用户选择批量生成时，系统会按数量创建多个上游任务并合并结果。
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
                        const n = Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0));
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
              </div>
            ) : form.category === "video" ? (
              <div className="space-y-4">
                <div className="text-xs text-gray-500">
                  视频模型通过 runtime_rule.video 驱动前台上传区与参数条；input_schema 定义底部可选参数（x-widget / x-order）。
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">上传形态 upload_profile</label>
                    <select
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={getVideoRule(form.runtime_rule).upload_profile}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setVideoRule(prev.runtime_rule, { upload_profile: e.target.value }),
                        }))
                      }
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
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={getVideoRule(form.runtime_rule).count_options.join(",")}
                      onChange={(e) => {
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
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">自定义数量上限</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={getVideoRule(form.runtime_rule).count_max}
                      onChange={(e) => {
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
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setAudioRule(prev.runtime_rule, {
                            billing_hint: e.target.value as "per_token" | "estimated",
                          }),
                        }))
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">生成数量选项（逗号分隔）</label>
                    <input
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={getAudioRule(form.runtime_rule).count_options.join(",")}
                      onChange={(e) => {
                        const opts = e.target.value
                          .split(/[,，\s]+/)
                          .map((s) => parseInt(s.trim(), 10))
                          .filter((n) => Number.isFinite(n) && n >= 1);
                        const uniq = [...new Set(opts.length ? opts : [1, 3, 5, 10, 30, 50])].sort((a, b) => a - b);
                        const rule = getAudioRule(form.runtime_rule);
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setAudioRule(prev.runtime_rule, { count_options: uniq }),
                          input_schema: syncCountSchema(
                            prev.input_schema,
                            uniq,
                            rule.count_allow_custom,
                            rule.count_max
                          ),
                        }));
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">自定义数量上限</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      className="w-full mt-1 px-3 py-2 rounded-lg border text-sm bg-white"
                      value={getAudioRule(form.runtime_rule).count_max}
                      onChange={(e) => {
                        const max = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 50));
                        const rule = getAudioRule(form.runtime_rule);
                        setForm((prev) => ({
                          ...prev,
                          runtime_rule: setAudioRule(prev.runtime_rule, { count_max: max }),
                          input_schema: syncCountSchema(
                            prev.input_schema,
                            rule.count_options,
                            rule.count_allow_custom,
                            max
                          ),
                        }));
                      }}
                    />
                  </div>
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
                </div>
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
          {err && <p className="col-span-2 text-sm text-red-500">{err}</p>}
          <button type="submit" className="col-span-2 py-2 bg-primary rounded-xl text-dark font-semibold">
            {form.id ? "保存修改" : "创建"}
          </button>
        </form>
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
              <tr key={m.id}>
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
                <td className="px-4 py-3 space-x-3 whitespace-nowrap">
                  <button onClick={() => openEdit(m)} className="text-xs text-secondary hover:underline">
                    编辑
                  </button>
                  <button onClick={() => toggleEnabled(m)} className="text-xs text-gray-500 hover:underline">
                    {m.is_enabled ? "禁用" : "启用"}
                  </button>
                  <button onClick={() => remove(m)} className="text-xs text-red-500 hover:underline">
                    删除
                  </button>
                </td>
              </tr>
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
