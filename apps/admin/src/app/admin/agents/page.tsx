"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, Check, Code2, Image as ImageIcon, Layers, Pencil, Plus, Settings2, Sparkles, Trash2, Video, X } from "lucide-react";
import { adminApi } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

type GenerationType = "image" | "video";
type WorkflowNode = { id: string; name: string; type: string; model_code: string; prompt_template?: string; cost: number };
type RuntimeConfig = {
  agent_mode?: "simple_pipeline" | "custom_nodes";
  analysis_model_code?: string;
  generation_model_code?: string;
  generation_type?: GenerationType;
  preset_code?: string;
  require_image?: boolean;
  default_count?: number;
  candidate_count?: number;
  creative_scenes?: string[];
  output_scenes?: string[];
  input_capabilities?: Record<string, boolean>;
  flow_options?: Record<string, boolean>;
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
};
type AdminModel = { code: string; display_name: string; request_mode: string; category: string; is_enabled: boolean };
type FormState = {
  isEdit: boolean;
  code: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  is_enabled: boolean;
  generation_type: GenerationType;
  analysis_model_code: string;
  generation_model_code: string;
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
  preset_override?: Partial<PresetBundle>;
};

const PAGE_SIZE = 10;
type SceneDef = { code: string; label: string; desc: string; locked?: boolean };
type PresetBundle = {
  display_config: Record<string, unknown>;
  runtime_config: RuntimeConfig;
  input_schema: Record<string, unknown>;
  nodes: WorkflowNode[];
  price_rule: Record<string, unknown>;
};

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

const TYPE_PRESETS = {
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
} as const;

const defaultScenes = (type: GenerationType) => (type === "video" ? ["product_video"] : ["main_image"]);
const sceneDefs = (type: GenerationType) => (type === "video" ? VIDEO_SCENES : IMAGE_SCENES);
const presetCode = (type: GenerationType) => (type === "video" ? "ecommerce_video" : "ecommerce_image");

const defaultNodes = (analysis = "", generation = "", type: GenerationType = "image"): WorkflowNode[] => [
  { id: "analysis", type: "llm", name: "需求分析", model_code: analysis, prompt_template: "", cost: 0 },
  { id: "generate", type, name: "生成结果", model_code: generation, prompt_template: "", cost: 0 },
];

const defaultSchema = (count = 1) => ({
  type: "object",
  properties: {
    prompt: { type: "string", title: "需求描述", placeholder: "简单描述你想要的效果" },
    count: { type: "integer", title: "生成数量", default: count, minimum: 1, maximum: 50, enum: [1, 3, 5, 10, 20, 50], "x-widget": "option_menu", "x-icon": "layers", "x-highlight": true },
  },
});

function displayConfig(form: FormState) {
  const preset = TYPE_PRESETS[form.generation_type];
  return {
    theme: preset.theme,
    hero_tags: preset.heroTags,
    feature_tags: preset.featureTags,
    steps: [
      { icon: "🔎", title: "需求智能分析", subtitle: "AI 根据输入和参考图理解目标效果", tags: ["需求识别", "素材分析"] },
      { icon: "✅", title: "方案确认", subtitle: "确认或修改生成方案", tags: ["逐步确认", "可编辑"] },
      { icon: form.generation_type === "video" ? "🎬" : "🖼️", title: form.generation_type === "video" ? "视频生成" : "图片生成", subtitle: "调用选择的生成模型输出结果", tags: ["异步生成", "进度跟踪"] },
    ],
    input: { image_label: preset.imageLabel, placeholder: form.placeholder || preset.placeholder, modes: ["逐步确认", "智能托管"] },
    help: form.help || preset.help,
  };
}

function runtimeConfig(form: FormState): RuntimeConfig {
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
    input_schema: defaultSchema(form.default_count),
    nodes: defaultNodes(form.analysis_model_code, form.generation_model_code, form.generation_type),
    price_rule: { billing_type: "per_request", unit_price: Number(form.unit_price) || 0 },
  };
}

function mergedPresetBundle(form: FormState): PresetBundle {
  return { ...presetBundle(form), ...(form.preset_override || {}) };
}

function makeEmptyForm(): FormState {
  const preset = TYPE_PRESETS.image;
  return {
    isEdit: false,
    code: "",
    name: "",
    description: preset.description,
    icon: preset.icon,
    sort_order: 0,
    is_enabled: true,
    generation_type: "image",
    analysis_model_code: "",
    generation_model_code: "",
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
  };
}

function normalizeScenes(items: unknown, type: GenerationType): string[] {
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

  const chatModels = useMemo(() => models.filter((m) => m.is_enabled && ["chat_completions", "responses"].includes(m.request_mode)), [models]);
  const imageModels = useMemo(() => models.filter((m) => m.is_enabled && m.request_mode === "images"), [models]);
  const videoModels = useMemo(() => models.filter((m) => m.is_enabled && m.request_mode === "video"), [models]);
  const generationModels = form.generation_type === "video" ? videoModels : imageModels;
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

  const openCreate = () => {
    setForm(makeEmptyForm());
    setErr("");
    setShowForm(true);
  };

  const openEdit = (w: Workflow) => {
    const runtime = w.runtime_config || {};
    const type = typeFromRuntime(runtime, w.category);
    const preset = TYPE_PRESETS[type];
    const inputCaps = runtime.input_capabilities || {};
    const flow = runtime.flow_options || {};
    const display = w.display_config || {};
    const input = (display.input || {}) as Record<string, any>;
    setForm({
      ...makeEmptyForm(),
      isEdit: true,
      code: w.code,
      name: w.name,
      description: w.description || preset.description,
      icon: w.icon || preset.icon,
      is_enabled: w.is_enabled,
      generation_type: type,
      analysis_model_code: runtime.analysis_model_code || "",
      generation_model_code: runtime.generation_model_code || "",
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
      preset_override: undefined,
    });
    setErr("");
    setShowForm(true);
  };

  const openJson = () => {
    setJsonDraft(JSON.stringify(mergedPresetBundle(form), null, 2));
    setJsonErr("");
    setJsonOpen(true);
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as Partial<PresetBundle>;
      const allowed = ["display_config", "runtime_config", "input_schema", "nodes", "price_rule"];
      const override: Partial<PresetBundle> = {};
      for (const key of allowed) {
        if (key in parsed) (override as any)[key] = (parsed as any)[key];
      }
      setForm((prev) => ({ ...prev, preset_override: override }));
      setJsonOpen(false);
    } catch (e) {
      setJsonErr(e instanceof Error ? e.message : "JSON 格式错误");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!form.analysis_model_code || !form.generation_model_code) {
      setErr("请选择分析模型和生成模型");
      return;
    }
    const bundle = mergedPresetBundle(form);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
      icon: form.icon,
      category: form.generation_type,
      sort_order: Number(form.sort_order) || 0,
      is_enabled: form.is_enabled,
      agent_mode: "simple_pipeline",
      analysis_model_code: form.analysis_model_code,
      generation_model_code: form.generation_model_code,
      generation_type: form.generation_type,
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
      input_schema: bundle.input_schema,
      price_rule: bundle.price_rule,
      display_config: bundle.display_config,
      runtime_config: { ...bundle.runtime_config, creative_scenes: normalizeScenes((bundle.runtime_config as any)?.creative_scenes || form.creative_scenes, form.generation_type), output_scenes: undefined },
    };
    try {
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

      {showForm && (
        <form onSubmit={submit} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div>
              <h2 className="font-semibold text-gray-950">{form.isEdit ? "编辑智能体" : "新增智能体"}</h2>
              <p className="mt-0.5 text-xs text-gray-400">常规配置只需选择类型和勾选场景，JSON 预设用于高级备用。</p>
            </div>
            <button type="button" onClick={() => setShowForm(false)} className="h-9 rounded-xl px-3 text-sm text-gray-400 hover:text-gray-700">取消</button>
          </div>

          <div className="grid gap-6 p-6 xl:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              <section className="rounded-2xl border border-gray-100 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900"><Sparkles size={16} />选择智能体类型</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {(["image", "video"] as GenerationType[]).map((type) => {
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
              </section>

              <section className="grid gap-4 rounded-2xl border border-gray-100 p-4 md:grid-cols-2">
                <div className="md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-900"><Bot size={16} />基础信息</div>
                <Field label="编码"><input className="admin-input" value={form.code} disabled={form.isEdit} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></Field>
                <Field label="名称"><input className="admin-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
                <Field label="图标"><input className="admin-input" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></Field>
                <Field label="状态"><label className="flex h-10 items-center gap-2 rounded-xl border border-gray-100 px-3 text-sm"><input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} />启用智能体</label></Field>
                <Field label="描述" wide><input className="admin-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
              </section>

              <section className="grid gap-4 rounded-2xl border border-gray-100 p-4 md:grid-cols-2">
                <div className="md:col-span-2 flex items-center gap-2 text-sm font-semibold text-gray-900"><Settings2 size={16} />模型与计费</div>
                <Field label="分析大模型"><select className="admin-input" value={form.analysis_model_code} onChange={(e) => setForm({ ...form, analysis_model_code: e.target.value })}><option value="">请选择分析模型</option>{chatModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select></Field>
                <Field label={form.generation_type === "video" ? "视频生成模型" : "图片生成模型"}><select className="admin-input" value={form.generation_model_code} onChange={(e) => setForm({ ...form, generation_model_code: e.target.value })}><option value="">请选择生成模型</option>{generationModels.map((m) => <option key={m.code} value={m.code}>{m.display_name} / {m.code}</option>)}</select></Field>
                <Field label="默认生成数量"><input type="number" min={1} max={50} className="admin-input" value={form.default_count} onChange={(e) => setForm({ ...form, default_count: Math.max(1, Number(e.target.value) || 1) })} /></Field>
                <Field label="AI方案数量"><input type="number" min={1} max={5} className="admin-input" value={form.candidate_count} onChange={(e) => setForm({ ...form, candidate_count: Math.min(5, Math.max(1, Number(e.target.value) || 3)) })} /></Field>
                <Field label="工作流收费"><input type="number" min={0} step="0.01" className="admin-input" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) || 0 })} /></Field>
              </section>

              <section className="rounded-2xl border border-gray-100 p-4">
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
              </section>

              <section className="rounded-2xl border border-gray-100 p-4">
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
              </section>

              <section className="grid gap-4 rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Pencil size={16} />前台文案</div>
                <Field label="输入框提示" wide><input className="admin-input" value={form.placeholder} onChange={(e) => setForm({ ...form, placeholder: e.target.value })} /></Field>
                <Field label="玩法说明" wide><textarea className="admin-input min-h-20 py-2" value={form.help} onChange={(e) => setForm({ ...form, help: e.target.value })} /></Field>
              </section>

              <section className="rounded-2xl border border-gray-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Code2 size={16} />智能体高级 JSON 设置</div>
                    <p className="mt-1 text-xs leading-5 text-gray-400">
                      当前智能体的完整预设配置，包含 AI 分析方案、前台展示、输入参数和提交到图片/视频生成模型的运行配置。默认由系统按类型和场景生成，管理员可微调。
                    </p>
                  </div>
                  <button type="button" onClick={openJson} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-100 px-3 text-sm text-gray-600 hover:bg-gray-50">
                    <Code2 size={15} />查看/编辑当前智能体 JSON
                  </button>
                </div>
                {form.preset_override && (
                  <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    已应用自定义 JSON。保存当前智能体后，该高级配置会随本智能体生效。
                  </div>
                )}
              </section>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-gray-100 bg-gray-950 p-5 text-white shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-2xl">{form.icon || activePreset.icon}</div>
                  <div><div className="text-sm text-white/50">前台预览</div><div className="font-semibold">{form.name || activePreset.label}</div></div>
                </div>
                <p className="mt-4 text-sm leading-6 text-white/70">{form.description || activePreset.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">{activePreset.featureTags.map((tag) => <span key={tag} className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-white/80">{tag}</span>)}</div>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-white p-5">
                <div className="mb-3 text-sm font-semibold text-gray-900">配置摘要</div>
                <Summary icon={form.generation_type === "video" ? <Video size={15} /> : <ImageIcon size={15} />} label="生成类型" value={activePreset.label} />
                <Summary icon={<Sparkles size={15} />} label="场景" value={normalizeScenes(form.creative_scenes, form.generation_type).map((code) => sceneDefs(form.generation_type).find((x) => x.code === code)?.label || code).join(" / ")} />
                <Summary icon={<Check size={15} />} label="方案数量" value={`${form.candidate_count} 条`} />
                <Summary icon={<Bot size={15} />} label="模式" value={[form.enable_step_confirm && "逐步确认", form.enable_autopilot && "智能托管"].filter(Boolean).join(" / ") || "仅手动"} />
              </div>
              {err && <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">{err}</div>}
              <button type="submit" className="h-11 w-full rounded-xl bg-primary font-semibold text-dark shadow-sm">{form.isEdit ? "保存修改" : "创建智能体"}</button>
            </aside>
          </div>
        </form>
      )}

      <div className="grid gap-4">
        {paginatedItems.map((w) => {
          const runtime = w.runtime_config || {};
          const type = typeFromRuntime(runtime, w.category);
          const preset = TYPE_PRESETS[type];
          return (
            <div key={w.code} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xl">{w.icon || preset.icon}</span>
                    <h2 className="font-semibold text-gray-950">{w.name}</h2>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-mono text-gray-500">{w.code}</span>
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600">{preset.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${w.is_enabled ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>{w.is_enabled ? "已启用" : "已停用"}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-500">{w.description || preset.description}</p>
                  <p className="mt-2 text-xs text-gray-400">分析模型：{runtime.analysis_model_code || "-"} · 生成模型：{runtime.generation_model_code || "-"} · 类型：{preset.label}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => openEdit(w)} className="rounded-lg border border-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">编辑</button>
                  <button onClick={() => toggle(w.code, !w.is_enabled)} className="rounded-lg border border-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">{w.is_enabled ? "停用" : "启用"}</button>
                  <button onClick={() => remove(w)} className="rounded-lg border border-red-100 px-3 py-2 text-sm text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
                </div>
              </div>
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
              <div><div className="font-semibold text-gray-950">当前智能体高级 JSON</div><div className="mt-0.5 text-xs text-gray-400">只作用于正在新增/编辑的这个智能体。应用后，再点击保存智能体才会写入生效。</div></div>
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
