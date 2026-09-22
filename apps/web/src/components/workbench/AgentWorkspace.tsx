"use client";

import { pollAsync } from "@/lib/pollAsync";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import dynamic from "next/dynamic";
import { Archive, ArrowUp, Check, Copy, Download, Folder, HelpCircle, History, ImageIcon, Loader2, Mic2, Plus, RefreshCw, Settings2, Star, Trash2, Wand2, X } from "lucide-react";
import { api, apiForLocaleCached, listAssets, uploadAsset } from "@/lib/api";
import type { Model } from "@starai/shared-types";
import {
  buildVideoTaskParams,
  EMPTY_VIDEO_MEDIA,
  parseVideoRuntime,
  schemaDefaultsFromFields,
  type VideoMediaState,
} from "@starai/shared-types";
import { AGENT_THEMES } from "./categoryMeta";
import { ChatTopTools, type BottomBarState } from "./BottomBar";
import { VideoOptionToolbar } from "./video/VideoOptionToolbar";
import { VideoUploadArea } from "./video/VideoUploadArea";
import { MediaMenuOption, MediaOptionMenu } from "./MediaOptionMenu";
import { ImageGenerationToolbar, buildImageGenerationParams } from "./ImageGenerationToolbar";
import { GenerationLanguageMenu, buildLanguageParams, useGenerationLanguages } from "./GenerationLanguageMenu";
import { useI18n } from "@/i18n/I18nProvider";
import { AgentLanding, type AgentDisplayStep } from "./AgentLanding";
import { AgentIcon } from "./AgentIcon";
import { NovelChapterList } from "./NovelChapterList";
import { comicAssetProgress } from "./comicProgress";

const WorkspaceLoading = () => {
  const { ts } = useI18n();
  return <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-400">{ts("正在打开工作区...")}</div>;
};
const VideoUpscaleWorkspace = dynamic(() => import("./VideoUpscaleWorkspace").then((module) => module.VideoUpscaleWorkspace), { loading: WorkspaceLoading });
const NovelWorkshopLanding = dynamic(() => import("./NovelWorkshopLanding").then((module) => module.NovelWorkshopLanding), { loading: WorkspaceLoading });
const ProductRefineWorkspace = dynamic(() => import("./ProductRefineWorkspace").then((module) => module.ProductRefineWorkspace), { loading: WorkspaceLoading });
const PhotoStudioLanding = dynamic(() => import("./PhotoStudioLanding").then((module) => module.PhotoStudioLanding), { loading: WorkspaceLoading });
const PhotoStudioInputBar = dynamic(() => import("./PhotoStudioLanding").then((module) => module.PhotoStudioInputBar), { loading: () => null });
const PhotoStudioTopBar = dynamic(() => import("./PhotoStudioLanding").then((module) => module.PhotoStudioTopBar), { loading: () => null });
const VirtualTryOnLanding = dynamic(() => import("./VirtualTryOnLanding").then((module) => module.VirtualTryOnLanding), { loading: WorkspaceLoading });
const VirtualTryOnInputBar = dynamic(() => import("./VirtualTryOnLanding").then((module) => module.VirtualTryOnInputBar), { loading: () => null });
const VirtualTryOnResult = dynamic(() => import("./VirtualTryOnLanding").then((module) => module.VirtualTryOnResult), { loading: WorkspaceLoading });

type DisplayStep = AgentDisplayStep;
type DisplayConfig = {
  theme?: string;
  hero_tags?: string[];
  feature_tags?: string[];
  steps?: DisplayStep[];
  timeline?: string[];
  input?: { image_label?: string; placeholder?: string; modes?: string[] };
  help?: string;
};
type Workflow = {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
  nodes?: Array<{ id: string; name: string; type: string }>;
  input_schema?: Record<string, unknown>;
  display_config?: DisplayConfig;
  runtime_config?: {
    agent_mode?: string;
    generation_type?: string;
    preset_code?: string;
    analysis_model_code?: string;
    require_image?: boolean;
    default_count?: number;
    generation_model_code?: string;
    creative_scenes?: string[];
    output_scenes?: string[];
    input_capabilities?: Record<string, boolean>;
    flow_options?: Record<string, boolean>;
    style_reference_mode?: string;
    duration_mode?: string;
    storyboard_grid?: number;
    max_retry?: number;
    asset_consistency_score?: number;
    logic_score?: number;
    image_model_code?: string;
    video_model_code?: string;
    dialogue_model_codes?: string[];
    narration_perspective?: string;
    orientation?: string;
    quality?: string;
    supported_resolutions?: string[];
    default_target_resolution?: string;
    preserve_audio?: boolean;
    default_enhancement_mode?: string;
    max_input_duration_sec?: number;
    max_input_size_mb?: number;
    default_style_strength?: number;
    preserve_motion?: boolean;
    preserve_identity?: boolean;
    product_pricing?: { workflow_fee?: number; image_unit_fee?: number };
    default_review_mode?: "standard" | "strict";
    default_subtitle_mode?: string;
    default_subtitle_region?: string;
    protect_watermark?: boolean;
  };
};
type NodeRun = { node_id: string; name: string; type: string; status: string; output: Record<string, any>; error?: string };
type DetailSection = { id?: string; type?: string; title?: string; objective?: string; copy_title?: string; copy_points?: string[]; image_url?: string; status?: string };
type DetailPageOutput = { render_mode?: string; status?: string; compose_status?: string; compose_error?: string; long_image_url?: string; section_count?: number; completed_count?: number; sections?: DetailSection[] };
type MediaTask = { task_no: string; type?: "image" | "video" | "audio"; status: string; progress: number; output?: Record<string, any>; error_message?: string; detail_section?: DetailSection };

function resolvedAgentMediaTasks(project: Project | null): MediaTask[] {
  const stored = (project?.outputs?.media_tasks || []) as MediaTask[];
  const tasks = project?.media_tasks?.length ? project.media_tasks : stored;
  const isDetail = project?.inputs?.creative_scene === "detail_image"
    || project?.outputs?.analysis?.creative_scene === "detail_image"
    || project?.outputs?.detail_page?.render_mode === "typeset_modules";
  if (!isDetail) return tasks;
  const prepared = new Map(stored.map(task => [task.task_no, task]));
  return tasks.map(task => {
    const result = prepared.get(task.task_no);
    return task.status === "succeeded" && result?.status === "succeeded" && result.output?.source_image_url && result.output?.image_url
      ? { ...task, output: result.output }
      : task;
  });
}

type ReferenceImage = { url: string; name: string; public_id?: string };
type AnalysisCandidate = { id: string; title?: string; reason?: string; prompt: string; negative_prompt?: string; params?: Record<string, unknown> };
type Project = {
  public_id: string;
  status: string;
  estimated_cost?: number;
  actual_cost?: number;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  node_runs?: NodeRun[];
  media_tasks?: MediaTask[];
  error_message?: string;
};
type ProjectListItem = {
  public_id: string;
  title?: string;
  workflow_name?: string;
  status: string;
  created_at: string;
};
type ComicStyle = {
  public_id: string;
  name: string;
  prompt: string;
  cover_url: string;
  source: "system" | "user" | string;
};
type ComicProject = {
  public_id: string;
  name: string;
  description: string;
  cover_url: string;
  style?: Record<string, any>;
  style_id?: string;
  orientation: "landscape" | "portrait" | string;
  quality: string;
  workflow_code?: string;
  last_workflow_project_id?: string;
  last_workflow_status?: string;
  created_at: string;
  updated_at?: string;
  archived?: boolean;
  archived_at?: string;
};
type ComicAsset = {
  public_id: string;
  asset_type: "character" | "prop" | "location";
  asset_code: string;
  name: string;
  description: string;
  visual_prompt: string;
  reference_asset_ids?: string[];
  metadata?: Record<string, any>;
  status: string;
  version: number;
};
type LibraryImageAsset = { public_id: string; url: string; name?: string; asset_type?: string; kind?: string };
type ComicLibraryTarget = "references" | "project_cover" | "style_cover";

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: "status.pending",
  running: "status.running",
  waiting_confirm: "status.waitingConfirm",
  succeeded: "status.succeeded",
  failed: "status.failed",
};

const COMIC_NARRATION_MODES = [
  { value: "smart", label: "智能混合", description: "AI 根据分镜自动安排旁白和角色对白" },
  { value: "first_person", label: "第一人称", description: "以主角“我”的视角进行内心独白或讲述" },
  { value: "third_person", label: "第三人称", description: "由画外旁白以角色姓名、他或她讲述故事" },
  { value: "character_dialogue", label: "角色对白", description: "以角色间对白推动剧情，尽量减少画外旁白" },
] as const;

function comicNarrationLabel(value: string) {
  return COMIC_NARRATION_MODES.find((item) => item.value === value)?.label || COMIC_NARRATION_MODES[0].label;
}

const IMAGE_SCENES = [
  { code: "main_image", label: "\u5546\u54c1\u4e3b\u56fe", kind: "image" },
  { code: "auto", label: "AI识别出图类型", kind: "image" },
  { code: "detail_image", label: "\u5546\u54c1\u8be6\u60c5\u56fe", kind: "image" },
  { code: "scene_image", label: "\u573a\u666f\u56fe", kind: "image" },
  { code: "marketing_poster", label: "\u8425\u9500\u6d77\u62a5", kind: "image" },
  { code: "product_video", label: "\u5546\u54c1\u89c6\u9891", kind: "video" },
  { code: "image_to_video", label: "\u56fe\u751f\u89c6\u9891", kind: "video" },
  { code: "ai_comic_drama", label: "AI漫剧", kind: "video" },
] as const;

function textOf(v: unknown) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function modelSupportsImageReference(model?: Model | null) {
  if (!model) return false;
  const capabilities = (model.runtime_rule?.capabilities || {}) as Record<string, any>;
  if (capabilities.image_input === true || capabilities.reference_image === true || capabilities.reference_images === true) return true;
  const imageRuntime = (model.runtime_rule?.image || {}) as Record<string, any>;
  const imageReferences = (imageRuntime.reference_images || {}) as Record<string, any>;
  if (Number(imageRuntime.max_reference_images || imageReferences.max || 0) > 0) return true;
  const runtime = (model.runtime_rule?.video || {}) as Record<string, any>;
  const profile = String(runtime.upload_profile || "").trim();
  if (profile && profile !== "none") return true;
  const props = (model.input_schema?.properties || {}) as Record<string, any>;
  return ["image_url", "reference_image", "reference_images", "first_frame", "images"].some((key) => !!props[key]);
}

function mediaURL(task: MediaTask) {
  const out = task.output || {};
  return textOf(
    out.video_url ||
    out.image_url ||
    out.audio_url ||
    (Array.isArray(out.images) && out.images[0]?.url) ||
    (Array.isArray(out.videos) && out.videos[0]?.url) ||
    (Array.isArray(out.audios) && out.audios[0]?.url)
  );
}

function mediaTaskType(task: MediaTask, fallback: string): "image" | "video" | "audio" {
  if (task.type === "image" || task.type === "video" || task.type === "audio") return task.type;
  const out = task.output || {};
  if (out.audio_url || (Array.isArray(out.audios) && out.audios.length > 0)) return "audio";
  if (out.video_url || (Array.isArray(out.videos) && out.videos.length > 0)) return "video";
  if (out.image_url || (Array.isArray(out.images) && out.images.length > 0)) return "image";
  const url = mediaURL(task);
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(?:[?#]|$)/i.test(url)) return "audio";
  if (/\.(mp4|webm|mov|m4v|avi|mkv)(?:[?#]|$)/i.test(url)) return "video";
  return fallback === "audio" ? "audio" : fallback === "video" ? "video" : "image";
}

// 写真馆照片单元：按任务状态展示生成中/失败/成片，图片加载失败时降级为失败态，避免浏览器破图图标
function PhotoStudioPhotoCell({ task, url, index }: { task: MediaTask; url: string; index: number }) {
  const { ts } = useI18n();
  const [broken, setBroken] = useState(false);
  if (task.status === "succeeded" && url && !broken) {
    return (
      <div className="group relative overflow-hidden rounded-2xl border border-fuchsia-100 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`写真 ${index + 1}`} loading="lazy" decoding="async" onError={() => setBroken(true)} className="aspect-[3/4] w-full object-cover" />
        <a href={url} target="_blank" rel="noreferrer" className="absolute inset-x-2 bottom-2 hidden items-center justify-center rounded-xl bg-black/55 py-1.5 text-xs font-medium text-white group-hover:flex">{ts("查看原图")}</a>
      </div>
    );
  }
  if (task.status === "failed" || broken) {
    return (
      <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-2xl border border-red-100 bg-red-50/60 px-2 text-center text-xs text-red-400 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300">
        <span>{ts("生成失败")}</span>
        {task.error_message ? <span className="line-clamp-2 text-[10px] opacity-80">{textOf(task.error_message)}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl bg-fuchsia-100/60 dark:bg-white/5">
      <Loader2 size={20} className="animate-spin text-fuchsia-400" />
      <span className="text-xs text-fuchsia-500 dark:text-fuchsia-300">{ts("生成中…")}</span>
    </div>
  );
}

function statusProgress(status: string, explicit = 0) {
  if (status === "succeeded") return 100;
  if (status === "failed") return 100;
  if (explicit > 0) return explicit;
  if (status === "waiting_confirm") return 45;
  if (status === "running") return 8;
  if (status === "pending") return 5;
  return 0;
}

function projectStage(project: Project | null, mediaTasks: MediaTask[], generationType: "image" | "video", isComicDrama = false, translate: (source: string) => string = (source) => source) {
  if (!project) return translate("开始");
  if (project.status === "waiting_confirm") return translate("方案确认");
  if (project.status === "succeeded") return translate("已完成");
  if (project.status === "failed") return translate("失败");
  if (isComicDrama) {
    const step = textOf(project.outputs?.current_step);
    if (step === "storyboard_confirm") return translate("分镜规划中...");
    if (step === "video_segments") return translate("分段视频生成中...");
    if (step === "compose") return translate("最终成片合成中...");
    if (step === "result") return translate("成片整理中...");
    if (mediaTasks.some((task) => mediaURL(task) && task.output?.image_url)) return translate("关键帧生成中...");
    return translate("AI漫剧规划中...");
  }
  if (mediaTasks.length > 0 || project.outputs?.media_tasks || project.outputs?.current_step === "generate") return generationType === "video" ? translate("视频生成中...") : translate("图片生成中...");
  return translate("AI分析中...");
}

function analysisCandidates(analysis: Record<string, any>): AnalysisCandidate[] {
  const raw = Array.isArray(analysis?.candidates) ? analysis.candidates : [];
  return raw
    .map((item, idx) => ({
      id: textOf(item?.id || String.fromCharCode(65 + idx)),
      title: textOf(item?.title),
      reason: textOf(item?.reason),
      prompt: textOf(item?.prompt),
      negative_prompt: textOf(item?.negative_prompt),
      params: item?.params && typeof item.params === "object" ? item.params : undefined,
    }))
    .filter((item) => item.prompt);
}

function recommendedCandidateId(analysis: Record<string, any>, candidates: AnalysisCandidate[]) {
  const recommendation = textOf(analysis?.recommendation);
  if (recommendation && candidates.some((item) => item.id === recommendation)) return recommendation;
  return candidates[0]?.id || "";
}

function normalizeCreativeScenes(items: unknown, generationType: "image" | "video") {
  const allowed = new Set<string>(IMAGE_SCENES.filter((item) => item.kind === generationType).map((item) => item.code));
  const values = Array.isArray(items) ? items.map((item) => String(item)).filter((item) => allowed.has(item)) : [];
  const fallback = generationType === "video" ? (values.includes("ai_comic_drama") ? "ai_comic_drama" : "product_video") : "main_image";
  const unique = Array.from(new Set(values));
  if (!unique.includes(fallback)) unique.unshift(fallback);
  return unique.length > 0 ? unique : [fallback];
}

function clientScenePrompt(code: string, label: string, generationType: "image" | "video") {
  if (code === "auto") return "根据用户需求识别商品主图、场景图、详情页或营销海报，再分析商品并优化对应提示词。";
  const rules: Record<string, string> = {
    main_image: "必须生成电商商品主图：商品主体清晰，背景干净或高级简洁，突出材质和卖点，不要做成详情页、场景图或海报。",
    detail_image: "生成有阅读顺序的商品详情页，各模块围绕已确认信息分别展示首屏、设计、可见细节和使用情境；不重复拼图，没有依据时不强凑功能和规格。",
    scene_image: "必须生成电商场景图：把商品放入真实使用场景，保留商品主体一致性，强调生活方式、光影和购买欲。",
    marketing_poster: "必须生成营销海报：强调广告构图、活动氛围、传播冲击力、品牌质感和标题留白，不要生成普通商品主图。",
    product_video: "必须生成商品展示短视频：围绕商品主体做展示、运镜、卖点节奏和商业光影，不要生成无关风景或普通素材。",
    image_to_video: "必须生成图生视频：严格保持参考图主体一致，在此基础上增加合理运动、镜头推进和光影变化，不要改成普通商品视频。",
    ai_comic_drama: "必须生成 AI 漫剧：围绕剧情、角色一致性、分镜节奏、关键帧和最终合成视频进行规划，不要生成普通商品视频。",
  };
  return [
    `当前用户选择的创作场景：${label} (${code})。`,
    rules[code] || `必须严格按照 ${label} 场景生成。`,
    `Generation type: ${generationType}. The selected scene is a hard requirement and must override any generic/default scene.`,
  ].join("\n");
}

export function AgentWorkspace({ code }: { code: string }) {
  const { t, td, ts, locale } = useI18n();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [generationModel, setGenerationModel] = useState<Model | null>(null);
  const [comicImageModels, setComicImageModels] = useState<Model[]>([]);
  const [comicVideoModels, setComicVideoModels] = useState<Model[]>([]);
  const [prompt, setPrompt] = useState("");
  const [comicSourceMode, setComicSourceMode] = useState(false);
  const [commerceBrief, setCommerceBrief] = useState({ channel: "", audience: "", visual: "" });
  const [count, setCount] = useState(1);
  const [detailSectionCount, setDetailSectionCount] = useState(5);
  const [imageRatio, setImageRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");
  const { languages: generationLanguages, selectedCode: languageCode, setSelectedCode: setLanguageCode, selectedLanguage } = useGenerationLanguages();
  const [mode, setMode] = useState<"step" | "auto">("auto");
  const [selectedScene, setSelectedScene] = useState("main_image");
  const [project, setProject] = useState<Project | null>(null);
  const [productImage, setProductImage] = useState<ReferenceImage | null>(null);
  const [videoMedia, setVideoMedia] = useState<VideoMediaState>(EMPTY_VIDEO_MEDIA);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [bottom, setBottom] = useState<BottomBarState>({
    channel_key: "price_first",
    fallback_enabled: true,
    web_search: false,
    timeout_sec: 30,
    asset_ids: [],
    files: [],
  });
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [promptEnhancing, setPromptEnhancing] = useState(false);
  const [confirmPrompt, setConfirmPrompt] = useState("");
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ProjectListItem[]>([]);
  const [novelModelCode, setNovelModelCode] = useState("");
  const pollRef = useRef<(() => void) | null>(null);
  const pollScopeRef = useRef<string | null>(null);
  const commerceParamsProjectRef = useRef("");

  useEffect(() => {
    if (code !== "ecommerce_image" || !project || commerceParamsProjectRef.current === project.public_id) return;
    commerceParamsProjectRef.current = project.public_id;
    const saved = { ...(project.inputs || {}), ...((project.outputs?.confirmation_payload as { params?: Record<string, unknown> } | undefined)?.params || {}) };
    setCount(Number(saved.count || saved.n || 1));
    setImageRatio(String(saved.aspect_ratio || saved.ratio || "1:1"));
    setImageSize(String(saved.image_size || "1K"));
    setDetailSectionCount(Number(saved.detail_section_count || 5));
  }, [code, project]);

  useEffect(() => {
    setProject(null);
    setPrompt("");
    setProductImage(null);
    setVideoMedia(EMPTY_VIDEO_MEDIA);
    setError("");
    setMode("auto");
    setSelectedScene("main_image");
  }, [code]);

  useEffect(() => {
    let active = true;
    apiForLocaleCached<Workflow>(`/api/agents/${code}`, locale)
      .then((wf) => {
        if (!active) return;
        setWorkflow(wf);
        setCount(Math.max(1, Number(wf.runtime_config?.default_count || 1)));
        const modelCode = wf.runtime_config?.generation_model_code;
        if (modelCode) {
          apiForLocaleCached<Model>(`/api/models/${modelCode}`, locale)
            .then((m) => {
              if (!active) return;
              setGenerationModel(m);
              setParams(
                m.category === "video"
                  ? { ...(m.default_params || {}), ...schemaDefaultsFromFields(m.input_schema) }
                  : { ...schemaDefaultsFromFields(m.input_schema), ...(m.default_params || {}) }
              );
              if (typeof m.default_params?.channel_key === "string") {
                setBottom((prev) => ({ ...prev, channel_key: String(m.default_params.channel_key) }));
              }
            })
            .catch(() => { if (active) setGenerationModel(null); });
        } else {
          setGenerationModel(null);
          setParams({});
        }
      })
      .catch(() => { if (active) setWorkflow(null); });
    return () => { active = false; };
  }, [code, locale]);

  useEffect(() => {
    pollScopeRef.current = code;
    return () => {
      pollScopeRef.current = null;
      pollRef.current?.();
    };
  }, [code]);

  const display = workflow?.display_config || {};
  const isComicDrama = workflow?.runtime_config?.agent_mode === "comic_drama" || workflow?.runtime_config?.preset_code === "ai_comic_drama";
  const isNovelWorkshop = workflow?.runtime_config?.agent_mode === "novel_workshop" || workflow?.runtime_config?.preset_code === "novel_workshop" || workflow?.code === "ai_novel_workshop";
  const isPhotoStudio = workflow?.runtime_config?.agent_mode === "photo_studio" || workflow?.runtime_config?.preset_code === "photo_studio" || workflow?.code === "ai_photo_studio";
  const isVirtualTryOn = workflow?.runtime_config?.agent_mode === "virtual_try_on" || workflow?.runtime_config?.preset_code === "virtual_try_on" || workflow?.code === "ai_virtual_tryon";
  const videoUtilityMode = workflow?.runtime_config?.agent_mode || workflow?.runtime_config?.preset_code;
  const isVideoUtility = ["video_upscale", "video_redraw", "subtitle_remove"].includes(videoUtilityMode || "");
  const workflowName = workflow ? td(`agent.${workflow.code}.name`, workflow.name) : "";
  const workflowDescription = workflow ? td(`agent.${workflow.code}.description`, workflow.description || "") : "";
  const inputCaps = workflow?.runtime_config?.input_capabilities || {};
  const flowOptions = workflow?.runtime_config?.flow_options || {};
  const theme = AGENT_THEMES[display.theme || ""] || AGENT_THEMES.amber;
  const isVideoGeneration = generationModel?.category === "video" || workflow?.runtime_config?.generation_type === "video" || workflow?.category === "video";
  const generationType: "image" | "video" = isVideoGeneration ? "video" : "image";
  const fallbackSteps: DisplayStep[] = [
    { icon: "\u{1F50D}", title: t("agent.stepAnalyzeTitle"), subtitle: t("agent.stepAnalyzeDesc") },
    { icon: "\u2705", title: t("agent.stepConfirmTitle"), subtitle: t("agent.stepConfirmDesc") },
    { icon: "\u{1F5BC}", title: generationType === "video" ? t("agent.stepVideoTitle") : t("agent.stepImageTitle"), subtitle: t("agent.stepGenerateDesc") },
  ];
  const steps = display.steps?.length ? display.steps : fallbackSteps;
  const translatedSteps = steps.map((step, idx) => ({
    ...step,
    title: workflow ? td(`agent.${workflow.code}.step.${idx}.title`, step.title) : step.title,
    subtitle: step.subtitle && workflow ? td(`agent.${workflow.code}.step.${idx}.subtitle`, step.subtitle) : step.subtitle,
    tags: workflow ? step.tags?.map((tag) => td(`agent.${workflow.code}.step.${idx}.tag.${tag}`, tag)) : step.tags,
  }));
  const translatedHeroTags = (display.hero_tags || []).map((tag) => workflow ? td(`agent.${workflow.code}.hero.${tag}`, tag) : ts(tag));
  const translatedTimeline = (display.timeline?.length ? display.timeline : (workflow?.nodes || []).map((node) => node.name))
    .map((item) => workflow ? td(`agent.${workflow.code}.timeline.${item}`, item) : item);
  const enableStepConfirm = flowOptions.enable_step_confirm !== false;
  const canUseAutopilot = flowOptions.enable_autopilot !== false;
  const allowPromptEdit = flowOptions.allow_prompt_edit !== false;
  const requireReferenceImage = workflow?.runtime_config?.require_image === true;
  const allowTextOnly = inputCaps.allow_text_only === true;
  const supportReferenceImage = inputCaps.support_reference_image !== false;
  const supportMultipleReferences = inputCaps.support_multiple_references === true;
  const modeLabels = [t("agent.stepConfirm"), t("agent.autopilot")];
  const outputScenes = useMemo(
    () => Array.from(new Set([...(code === "ecommerce_image" && generationType === "image" ? ["auto"] : []), ...normalizeCreativeScenes(workflow?.runtime_config?.creative_scenes || workflow?.runtime_config?.output_scenes, generationType)])),
    [code, workflow?.runtime_config?.creative_scenes, workflow?.runtime_config?.output_scenes, generationType]
  );
  const selectedSceneMeta = IMAGE_SCENES.find((item) => item.code === selectedScene) || IMAGE_SCENES[0];
  const isDetailPageScene = selectedSceneMeta.code === "detail_image" && generationType === "image";
  const usesCompactCommerceInput = code === "ecommerce_image" || code === "ecommerce_video";
  const usesInlineReferenceInput = usesCompactCommerceInput || code === "general_image";
  const videoConfig = parseVideoRuntime(generationModel?.runtime_rule);

  useEffect(() => {
    if (!isComicDrama) {
      setComicImageModels([]);
      setComicVideoModels([]);
      return;
    }
    let active = true;
    Promise.all([
      apiForLocaleCached<Model[]>("/api/models?category=image", locale),
      apiForLocaleCached<Model[]>("/api/models?category=video", locale),
    ])
      .then(([images, videos]) => {
        if (!active) return;
        setComicImageModels((images || []).filter((item) => item.is_enabled !== false));
        setComicVideoModels((videos || []).filter((item) => item.is_enabled !== false));
      })
      .catch(() => {
        if (active) {
          setComicImageModels([]);
          setComicVideoModels([]);
        }
      });
    return () => { active = false; };
  }, [isComicDrama, locale]);
  const [comicSettings, setComicSettings] = useState({
    style_reference_mode: "image_reference",
    duration_mode: "standard",
    storyboard_grid: 6,
    max_retry: 2,
    asset_consistency_score: 80,
    logic_score: 50,
    image_model_code: "",
    video_model_code: "",
    dialogue_model_codes: [] as string[],
    narration_perspective: "smart",
  });
  const [comicProjects, setComicProjects] = useState<ComicProject[]>([]);
	const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [activeComicProject, setActiveComicProject] = useState<ComicProject | null>(null);
  const [comicStyles, setComicStyles] = useState<ComicStyle[]>([]);
  const [comicAssets, setComicAssets] = useState<ComicAsset[]>([]);
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [projectDrawerCollapsed, setProjectDrawerCollapsed] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [styleModalOpen, setStyleModalOpen] = useState(false);
  const [styleAddOpen, setStyleAddOpen] = useState<"manual" | "smart" | null>(null);
  const [styleFilter, setStyleFilter] = useState<"all" | "system" | "mine">("all");
  const [activeComicFeature, setActiveComicFeature] = useState(0);
  const [activeAgentFeature, setActiveAgentFeature] = useState(0);
  const [projectDraft, setProjectDraft] = useState({
    cover_url: "",
    name: "",
    description: "",
    style_id: "",
    orientation: "landscape",
    quality: "480P",
  });
  const [styleDraft, setStyleDraft] = useState({ cover_url: "", name: "", prompt: "" });
  const [comicUploading, setComicUploading] = useState(false);
  const [comicLibraryTarget, setComicLibraryTarget] = useState<ComicLibraryTarget | null>(null);
  const [comicLibraryItems, setComicLibraryItems] = useState<LibraryImageAsset[]>([]);
  const [comicLibrarySelected, setComicLibrarySelected] = useState<ReferenceImage[]>([]);
  const [comicLibraryLoading, setComicLibraryLoading] = useState(false);
  const maxVideoAssetRefs =
    videoConfig.upload_profile === "frame_pair"
      ? videoConfig.reference_images?.max ?? 4
      : videoConfig.max_reference_images ?? 1;
  const selectedComicVideoModel = comicVideoModels.find((item) => item.code === comicSettings.video_model_code) || null;
  const comicVideoSupportsReference = modelSupportsImageReference(selectedComicVideoModel);
  const analysis = useMemo(
    () => project?.outputs?.analysis || project?.node_runs?.find((n) => n.node_id === "analysis")?.output || {},
    [project]
  );
  const allMediaTasks = useMemo(() => resolvedAgentMediaTasks(project), [project]);
  const finalVideoURL = textOf(project?.outputs?.final_video_url);
  const detailPage = (project?.outputs?.detail_page || null) as DetailPageOutput | null;
  const mediaTasks = useMemo(
    () => (isComicDrama && finalVideoURL ? allMediaTasks.filter((task) => !textOf(task.task_no).startsWith("compose_")) : allMediaTasks),
    [allMediaTasks, finalVideoURL, isComicDrama]
  );
  const candidates = useMemo(() => analysisCandidates(analysis), [analysis]);
  const totalProgress = useMemo(() => {
    if (!project) return 0;
    if (allMediaTasks.length) {
      return Math.round(allMediaTasks.reduce((sum, t) => sum + statusProgress(t.status, t.progress), 0) / allMediaTasks.length);
    }
    if (project.outputs?.current_step === "generate") return project.status === "running" ? 8 : 5;
    return statusProgress(project.status);
  }, [project, allMediaTasks]);

  useEffect(() => {
    if (project?.status !== "waiting_confirm") return;
    const nextId = recommendedCandidateId(analysis, candidates);
    const nextCandidate = candidates.find((item) => item.id === nextId);
    const nextPrompt = nextCandidate?.prompt || textOf(analysis.generation_prompt || analysis.summary || analysis.raw_text);
    if (nextId) setSelectedCandidateId(nextId);
    if (nextPrompt) setConfirmPrompt(nextPrompt);
  }, [analysis, candidates, project?.status]);

  useEffect(() => {
    if (project?.status !== "waiting_confirm" || !isPhotoStudio) return;
    const styling = (project.outputs?.styling || {}) as Record<string, any>;
    const nextPrompt = textOf(styling.generation_prompt || styling.summary || styling.base_prompt);
    if (nextPrompt) setConfirmPrompt(nextPrompt);
  }, [project?.status, project?.outputs, isPhotoStudio]);

  useEffect(() => {
    if (!workflow) return;
    const flow = workflow.runtime_config?.flow_options || {};
    if (workflow.runtime_config?.agent_mode === "comic_drama" || workflow.runtime_config?.preset_code === "ai_comic_drama") {
      setComicSettings({
        style_reference_mode: workflow.runtime_config?.style_reference_mode || "image_reference",
        duration_mode: workflow.runtime_config?.duration_mode || "standard",
        storyboard_grid: Number(workflow.runtime_config?.storyboard_grid || 6),
        max_retry: Number(workflow.runtime_config?.max_retry || 2),
        asset_consistency_score: Number(workflow.runtime_config?.asset_consistency_score || 80),
        logic_score: Number(workflow.runtime_config?.logic_score || 50),
        image_model_code: workflow.runtime_config?.image_model_code || "",
        video_model_code: workflow.runtime_config?.video_model_code || workflow.runtime_config?.generation_model_code || "",
        dialogue_model_codes: Array.isArray(workflow.runtime_config?.dialogue_model_codes) ? workflow.runtime_config.dialogue_model_codes : [],
        narration_perspective: workflow.runtime_config?.narration_perspective || "smart",
      });
      setProjectDraft((prev) => ({
        ...prev,
        orientation: prev.orientation === "landscape" ? workflow.runtime_config?.orientation || "landscape" : prev.orientation,
        quality: prev.quality === "480P" ? workflow.runtime_config?.quality || "480P" : prev.quality,
      }));
    }
    if (flow.enable_autopilot !== false) {
      setMode("auto");
    } else if (flow.enable_autopilot === false) {
      setMode("step");
    }
  }, [workflow]);

  const loadComicProjects = async (includeArchived = showArchivedProjects) => {
    try {
      const res = await api<{ items: ComicProject[] }>(`/api/comic-drama/projects${includeArchived ? "?include_archived=true" : ""}`);
      const items = res.items || [];
      setComicProjects(items);
      setActiveComicProject((prev) => prev ? items.find((item) => item.public_id === prev.public_id) || null : null);
    } catch {
      setComicProjects([]);
    }
  };

  useEffect(() => {
    if (!isComicDrama || !activeComicProject?.last_workflow_project_id) return;
    const publicId = activeComicProject.last_workflow_project_id;
    api<Project>(`/api/agent-projects/${publicId}`)
      .then((item) => {
        setProject(item);
        if (item.status === "pending" || item.status === "running") startPolling(publicId);
      })
      .catch(() => setError(t("comic.loadWorkflowFailed")));
    // The selected comic project is the source of truth for restoring its latest workflow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComicDrama, activeComicProject?.last_workflow_project_id]);

  const loadComicStyles = async () => {
    try {
      const res = await api<{ items: ComicStyle[] }>("/api/comic-drama/styles");
      const items = res.items || [];
      setComicStyles(items);
      setProjectDraft((prev) => prev.style_id ? prev : { ...prev, style_id: items[0]?.public_id || "" });
    } catch {
      setComicStyles([]);
    }
  };

  const loadComicAssets = async (projectId = activeComicProject?.public_id) => {
    if (!projectId) {
      setComicAssets([]);
      return;
    }
    try {
      const res = await api<{ items: ComicAsset[] }>(`/api/comic-drama/projects/${projectId}/assets`);
      setComicAssets(res.items || []);
    } catch {
      setComicAssets([]);
    }
  };

  useEffect(() => {
    if (!isComicDrama) return;
    void loadComicAssets(activeComicProject?.public_id);
    // Assets belong to the selected project and are refreshed after workflow completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComicDrama, activeComicProject?.public_id]);

  useEffect(() => {
    if (!isComicDrama) return;
    pollRef.current?.();
    setActiveComicProject(null);
    setProject(null);
    setComicAssets([]);
    setError("");
    if (typeof window !== "undefined") window.localStorage.removeItem(`starai:comic:active:${code}`);
    loadComicProjects();
    loadComicStyles();
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("comicProjectDrawerCollapsed") : null;
    if (stored === "1") setProjectDrawerCollapsed(true);
		// Load once when entering comic mode; the loaders intentionally use the current view state.
		// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, isComicDrama]);

  useEffect(() => {
    if (!isComicDrama) return;
    const featureCount = Math.max(1, translatedSteps.length);
    const timer = window.setInterval(() => {
      if (!document.hidden) setActiveComicFeature((prev) => (prev + 1) % featureCount);
    }, 3600);
    return () => window.clearInterval(timer);
  }, [isComicDrama, translatedSteps.length]);

  useEffect(() => {
    if (isComicDrama || project) return;
    const total = Math.max(1, Math.min(4, translatedSteps.length));
    const timer = window.setInterval(() => {
      if (!document.hidden) setActiveAgentFeature((prev) => (prev + 1) % total);
    }, 3600);
    return () => window.clearInterval(timer);
  }, [isComicDrama, project, translatedSteps.length]);

  const setComicDrawerCollapsed = (value: boolean) => {
    setProjectDrawerCollapsed(value);
    if (typeof window !== "undefined") window.localStorage.setItem("comicProjectDrawerCollapsed", value ? "1" : "0");
  };

  const selectComicProject = (item: ComicProject) => {
    pollRef.current?.();
    setProject(null);
    setError("");
    setActiveComicProject(item);
  };

  useEffect(() => {
    if (!outputScenes.includes(selectedScene)) {
      const fallback = generationType === "video" ? "product_video" : "main_image";
      setSelectedScene(outputScenes.includes(fallback) ? fallback : outputScenes[0] || fallback);
    }
  }, [generationType, outputScenes, selectedScene]);


  const startPolling = (publicId: string) => {
    if (pollScopeRef.current !== code) return;
    pollRef.current?.();
    pollRef.current = pollAsync(async (signal) => {
      try {
        const p = await api<Project>(`/api/agent-projects/${publicId}`, { signal });
        if (signal.aborted) return;
        setProject(p);
        if (p.status === "succeeded" || p.status === "failed" || p.status === "waiting_confirm" || p.status === "canceled") {
          pollRef.current?.();
          window.dispatchEvent(new Event("starai:wallet-changed"));
          if (isComicDrama) void loadComicAssets();
        }
      } catch {
        /* ignore */
      }
    }, 1800);
  };

  const run = async () => {
    if (!workflow || submitting) return;
    const hasVideoMedia = !!(videoMedia.first_frame || videoMedia.last_frame || videoMedia.reference_images.length);
    if (requireReferenceImage && !productImage && !hasVideoMedia) {
      setError(t("agent.errorNeedReference"));
      return;
    }
    if (!allowTextOnly && !prompt.trim() && !productImage && !hasVideoMedia) {
      setError(t("agent.errorNeedInput"));
      return;
    }
    if (isComicDrama && selectedComicVideoModel && !comicVideoSupportsReference) {
      setError(`当前视频模型「${selectedComicVideoModel.display_name || selectedComicVideoModel.code}」不支持关键帧/参考图输入，无法保证角色一致性。请在智能引擎中改用支持图生视频的模型。`);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const selectedAssets = bottom.asset_ids?.length ? { asset_ids: bottom.asset_ids } : {};
      const videoParams = isVideoGeneration && generationModel
        ? buildVideoTaskParams(params, videoMedia, generationModel.runtime_rule)
        : {};
      const imageParams = !isVideoGeneration
        ? buildImageGenerationParams({ count: isDetailPageScene ? detailSectionCount : count, ratio: imageRatio, imageSize })
        : {};
      const languageParams = buildLanguageParams(selectedLanguage);
      const imageURL =
        productImage?.url ||
        videoMedia.reference_images[0]?.url ||
        videoMedia.first_frame?.url ||
        videoMedia.last_frame?.url ||
        "";
      const comicReferenceURLs = [productImage?.url, ...videoMedia.reference_images.map((item) => item.url)].filter((item): item is string => !!item);
      const referenceAssetIds = [
        productImage?.public_id,
        videoMedia.first_frame?.public_id,
        videoMedia.last_frame?.public_id,
        ...videoMedia.reference_images.map((x) => x.public_id),
      ].filter((x): x is string => !!x);
      const scenePrompt = clientScenePrompt(selectedSceneMeta.code, selectedSceneMeta.label, generationType);
      const userPrompt = [prompt.trim(), code === "ecommerce_image" ? [commerceBrief.channel && `发布渠道：${commerceBrief.channel}`, commerceBrief.audience && `目标受众：${commerceBrief.audience}`, commerceBrief.visual && `视觉风格：${commerceBrief.visual}`].filter(Boolean).join("\n") : ""].filter(Boolean).join("\n\n");
      const p = await api<Project>(`/api/agents/${code}/projects`, {
        method: "POST",
        body: JSON.stringify({
          inputs: {
            ...params,
            ...videoParams,
            ...imageParams,
            ...languageParams,
            ...selectedAssets,
            prompt: userPrompt ? scenePrompt + "\n\n用户原始需求：" + userPrompt : scenePrompt,
            user_prompt: userPrompt,
            scene_prompt: scenePrompt,
            creative_scene: selectedSceneMeta.code,
            creative_scene_label: selectedSceneMeta.label,
            detail_section_count: isDetailPageScene || selectedScene === "auto" ? detailSectionCount : undefined,
            generation_language: languageParams.language,
            generation_language_label: languageParams.language_label,
            ...(isComicDrama ? {
              ...comicSettings,
              source_script: comicSourceMode ? prompt : undefined,
              comic_project_id: activeComicProject?.public_id,
              comic_project_name: activeComicProject?.name,
              comic_project_description: activeComicProject?.description,
              comic_style: comicStyles.find((item) => item.public_id === projectDraft.style_id) || activeComicProject?.style,
              orientation: activeComicProject?.orientation || projectDraft.orientation,
              quality: activeComicProject?.quality || projectDraft.quality,
              reference_images: comicReferenceURLs,
              comic_assets: comicAssets,
            } : {}),
            count: Number((videoParams as any).count ?? (imageParams as any).count ?? params.count ?? count),
            n: Number((videoParams as any).count ?? (imageParams as any).n ?? params.count ?? count),
            image_url: imageURL || undefined,
            ...(!isVideoGeneration && imageURL ? { reference_images: code === "ecommerce_image" ? comicReferenceURLs : [imageURL] } : {}),
            reference_asset_ids: referenceAssetIds,
            _mode: !enableStepConfirm || mode === "auto" ? "auto" : "step",
          },
        }),
      });
      setProject(p);
      if (isComicDrama) loadComicProjects();
      startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("启动失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const enhanceCommercePrompt = async () => {
    const original = prompt.trim();
    if (!original || promptEnhancing) return;
    setPromptEnhancing(true);
    setError("");
    try {
      const workflowContext = [
        `当前创作场景硬性要求：\n${clientScenePrompt(selectedSceneMeta.code, selectedSceneMeta.label, generationType)}`,
        (isDetailPageScene || selectedScene === "auto") ? `详情页模块数：${detailSectionCount}` : "",
        commerceBrief.channel ? `发布渠道：${commerceBrief.channel}` : "",
        commerceBrief.audience ? `目标受众：${commerceBrief.audience}` : "",
        commerceBrief.visual ? `视觉风格：${commerceBrief.visual}` : "",
        currentComicReferences().length ? `已上传 ${currentComicReferences().length} 张商品参考图；首图为主体视觉真值。` : "",
        "增强时补齐构图、信息层级、卡片/图标/渐变/装饰及全页统一性要求；不得虚构商品功效、参数、材质、品牌或参考图中不可见的结构。品牌、型号、规格等信息互相冲突时，必须在增强结果中标记需确认，不得擅自选择。",
      ].filter(Boolean).join("\n");
      const result = await api<{ content: string }>("/api/canvases/enhance-prompt", {
        method: "POST",
        body: JSON.stringify({ prompt: original, workflow_code: code, target_kind: selectedSceneMeta.code, workflow_context: workflowContext }),
      });
      const enhanced = textOf(result.content).trim();
      if (enhanced) setPrompt((current) => current.trim() === original ? enhanced : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("提示词增强失败"));
    } finally {
      setPromptEnhancing(false);
    }
  };

  const runNovel = async (inputs: Record<string, any>) => {
    if (!workflow || submitting) return;
    if (typeof inputs.model_code === "string" && inputs.model_code) setNovelModelCode(inputs.model_code);
    setSubmitting(true);
    setError("");
    try {
      const p = await api<Project>(`/api/agents/${code}/projects`, {
        method: "POST",
        body: JSON.stringify({ inputs: { ...inputs, _mode: inputs._mode === "step" ? "step" : "auto" } }),
      });
      setProject(p);
      if (typeof p.inputs?.model_code === "string") setNovelModelCode(p.inputs.model_code);
      startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("启动失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const runPhoto = async (inputs: Record<string, any>) => {
    if (!workflow || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const p = await api<Project>(`/api/agents/${code}/projects`, {
        method: "POST",
        body: JSON.stringify({ inputs: { ...inputs, _mode: inputs._mode === "step" ? "step" : "auto" } }),
      });
      setProject(p);
      startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("启动失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmPhotoPlan = async () => {
    if (!project) return;
    setError("");
    try {
      await api(`/api/agent-projects/${project.public_id}/steps/confirm/confirm`, {
        method: "POST",
        body: JSON.stringify({ payload: { prompt: confirmPrompt } }),
      });
      const updated = await api<Project>(`/api/agent-projects/${project.public_id}`);
      setProject(updated);
      startPolling(project.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("拍摄方案确认失败"));
    }
  };

  const reviseNovel = async (request: { chapterNumber?: number; instruction: string }) => {
    const chapterLabel = request.chapterNumber ? `第${request.chapterNumber}章` : "整本小说大纲";
    const currentChapters = Array.isArray(project?.outputs?.chapters) ? project.outputs.chapters as any[] : [];
    const currentChapter = currentChapters.find((item) => Number(item.chapter_number) === request.chapterNumber);
    const outline = project?.outputs?.planning?.outline;
    await runNovel({
      prompt: `请基于下面的现有小说资料生成一个修改后的新版本。需要修改的部分：${chapterLabel}。修改要求：${request.instruction}\n\n现有大纲：${JSON.stringify(outline || {}).slice(0, 12000)}${currentChapter ? `\n\n原章节正文：${String(currentChapter.polished_content || currentChapter.raw_content || "").slice(0, 12000)}` : ""}`,
      genre: "玄幻",
      word_count_target: "短篇·3万字内",
      style: "轻松幽默",
      language: "zh-CN",
      ...(novelModelCode ? { model_code: novelModelCode } : {}),
    });
  };

  const confirmNovelOutline = async () => {
    if (!project) return;
    setError("");
    try {
      await api(`/api/agent-projects/${project.public_id}/steps/confirm/confirm`, {
        method: "POST",
        body: JSON.stringify({ payload: { outline: project.outputs?.planning?.outline || {} } }),
      });
      const updated = await api<Project>(`/api/agent-projects/${project.public_id}`);
      setProject(updated);
      startPolling(project.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("大纲确认失败"));
    }
  };

  const confirmNovelBatch = async () => {
    if (!project) return;
    setError("");
    try {
      await api(`/api/agent-projects/${project.public_id}/steps/confirm/confirm`, {
        method: "POST",
        body: JSON.stringify({ payload: {} }),
      });
      const updated = await api<Project>(`/api/agent-projects/${project.public_id}`);
      setProject(updated);
      startPolling(project.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("继续创作失败"));
    }
  };

  const confirmStep = async () => {
    if (!project) return;
    setError("");
    try {
      await api(`/api/agent-projects/${project.public_id}/steps/confirm/confirm`, {
        method: "POST",
        body: JSON.stringify({ payload: {
          prompt: confirmPrompt, candidate_id: selectedCandidateId,
          ...(code === "ecommerce_image" ? { params: {
            ...buildImageGenerationParams({ count, ratio: imageRatio, imageSize }),
            detail_section_count: detailSectionCount,
          } } : {}),
        } }),
      });
      const p = await api<Project>(`/api/agent-projects/${project.public_id}`);
      setProject(p);
      startPolling(project.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("方案确认失败，请重试"));
    }
  };

  const enableAutopilot = async () => {
    if (!project) return;
    // The commerce pipeline has just one confirmation step. Commit edits before
    // continuing instead of enabling autopilot with the old recommended prompt.
    if (code === "ecommerce_image" && project.status === "waiting_confirm") {
      await confirmStep();
      return;
    }
    await api(`/api/agent-projects/${project.public_id}/autopilot`, { method: "POST", body: JSON.stringify({ enabled: true }) });
    startPolling(project.public_id);
  };

  const retry = async () => {
    if (!project) return;
    setError("");
    try {
      const failedNode = [...(project.node_runs || [])].reverse().find((node) => node.status === "failed");
      const canRetryNode = failedNode && ["comic_plan", "keyframes", "video_segments", "narrations", "compose", "generate"].includes(failedNode.node_id);
      if (canRetryNode) {
        await api(`/api/agent-projects/${project.public_id}/retry-node`, {
          method: "POST",
          body: JSON.stringify({
            node_id: failedNode.node_id,
            image_model_code: comicSettings.image_model_code,
            video_model_code: comicSettings.video_model_code,
          }),
        });
      } else {
        await api(`/api/agent-projects/${project.public_id}/retry`, { method: "POST" });
      }
      startPolling(project.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("重试失败"));
    }
  };

  const cancelProject = async () => {
    if (!project || !window.confirm(t("comic.confirmCancelWorkflow"))) return;
    await api(`/api/agent-projects/${project.public_id}/cancel`, { method: "POST" });
    const updated = await api<Project>(`/api/agent-projects/${project.public_id}`);
    setProject(updated);
    if (isComicDrama) await loadComicProjects();
  };

  const resetTask = () => {
    pollRef.current?.();
    setProject(null);
    setError("");
    if (isComicDrama) {
      setActiveComicProject(null);
      setComicAssets([]);
    }
  };

  const openHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) {
      api<{ items: ProjectListItem[] }>(`/api/agent-projects?workflow_code=${encodeURIComponent(code)}&page=1&page_size=20`).then((r) => setHistoryItems(r.items || [])).catch(() => setHistoryItems([]));
    }
  };

  const loadHistory = async (id: string) => {
    try {
      setError("");
      const p = await api<Project>(`/api/agent-projects/${id}`);
      setProject(p);
      if (typeof p.inputs?.model_code === "string") setNovelModelCode(p.inputs.model_code);
      setHistoryOpen(false);
      if (p.status === "pending" || p.status === "running" || p.status === "waiting_confirm") startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("历史任务加载失败"));
    }
  };

  const uploadComicImage = async (file?: File | null, target: "project" | "style" = "project") => {
    if (!file) return;
    setComicUploading(true);
    setError("");
    try {
      const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: "scene" });
      if (target === "project") {
        setProjectDraft((prev) => ({ ...prev, cover_url: asset.url }));
      } else {
        setStyleDraft((prev) => ({ ...prev, cover_url: asset.url }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("上传失败"));
    } finally {
      setComicUploading(false);
    }
  };

  const currentComicReferences = () => [productImage, ...videoMedia.reference_images].filter((item): item is ReferenceImage => !!item);

  const setComicReferences = (items: ReferenceImage[]) => {
    const unique = items.filter((item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index).slice(0, 8);
    setProductImage(unique[0] || null);
    setVideoMedia((prev) => ({ ...prev, reference_images: unique.slice(1) }));
  };

  const openComicImageLibrary = async (target: ComicLibraryTarget) => {
    setComicLibraryTarget(target);
    setComicLibrarySelected(target === "references" ? currentComicReferences() : []);
    setComicLibraryLoading(true);
    try {
      const result = await listAssets({ kind: "image", page: 1, page_size: 100 });
      setComicLibraryItems((result.items || []).filter((item) => item.url));
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("资产库加载失败"));
      setComicLibraryItems([]);
    } finally {
      setComicLibraryLoading(false);
    }
  };

  const confirmComicLibrary = () => {
    const item = comicLibrarySelected[0];
    if (comicLibraryTarget === "references") setComicReferences(comicLibrarySelected);
    if (comicLibraryTarget === "project_cover" && item) setProjectDraft((prev) => ({ ...prev, cover_url: item.url }));
    if (comicLibraryTarget === "style_cover" && item) setStyleDraft((prev) => ({ ...prev, cover_url: item.url }));
    setComicLibraryTarget(null);
  };

  const createComicProject = async () => {
    if (!projectDraft.name.trim()) {
      setError(ts("请输入项目名称"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const created = await api<ComicProject>("/api/comic-drama/projects", {
        method: "POST",
        body: JSON.stringify({ ...projectDraft, workflow_code: code }),
      });
      setActiveComicProject(created);
      await loadComicProjects();
      setProjectModalOpen(false);
      setProjectDraft((prev) => ({ ...prev, name: "", description: "", cover_url: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("创建项目失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const updateComicProjectOutput = async (patch: { quality?: string; orientation?: string }) => {
    setProjectDraft((prev) => ({ ...prev, ...patch }));
    if (!activeComicProject) return;
    const previous = activeComicProject;
    const optimistic = { ...activeComicProject, ...patch };
    setActiveComicProject(optimistic);
    setComicProjects((items) => items.map((item) => item.public_id === optimistic.public_id ? optimistic : item));
    try {
      const updated = await api<ComicProject>(`/api/comic-drama/projects/${activeComicProject.public_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: activeComicProject.name,
          description: activeComicProject.description || "",
          cover_url: activeComicProject.cover_url || "",
          style_id: activeComicProject.style_id || "",
          orientation: patch.orientation || activeComicProject.orientation,
          quality: patch.quality || activeComicProject.quality,
        }),
      });
      setActiveComicProject(updated);
      setComicProjects((items) => items.map((item) => item.public_id === updated.public_id ? updated : item));
    } catch (err) {
      setActiveComicProject(previous);
      setComicProjects((items) => items.map((item) => item.public_id === previous.public_id ? previous : item));
      setProjectDraft((prev) => ({
        ...prev,
        quality: previous.quality,
        orientation: previous.orientation,
      }));
      setError(err instanceof Error ? err.message : t("canvas.saveFailed"));
    }
  };

  const createComicStyle = async () => {
    if (!styleDraft.name.trim()) {
      setError(ts("请输入风格名称"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const prompt = styleDraft.prompt.trim() || (styleAddOpen === "smart" ? "根据参考图自动识别画风，并保持角色、场景、色彩、线条和镜头语言一致。" : "");
      const created = await api<ComicStyle>("/api/comic-drama/styles", {
        method: "POST",
        body: JSON.stringify({ ...styleDraft, prompt, mode: styleAddOpen || "manual" }),
      });
      await loadComicStyles();
      setProjectDraft((prev) => ({ ...prev, style_id: created.public_id }));
      setStyleDraft({ cover_url: "", name: "", prompt: "" });
      setStyleAddOpen(null);
      setStyleModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : ts("保存风格失败"));
    } finally {
      setSubmitting(false);
    }
  };

	const runComicAction = async (action: () => Promise<void>, fallback: string) => {
		setError("");
		try {
			await action();
		} catch (err) {
			setError(err instanceof Error ? err.message : fallback);
		}
	};

	const archiveComicProject = async (item: ComicProject) => runComicAction(async () => {
		await api(`/api/comic-drama/projects/${item.public_id}/archive`, { method: "PATCH", body: JSON.stringify({ archived: !item.archived }) });
		if (activeComicProject?.public_id === item.public_id) setActiveComicProject(null);
		await loadComicProjects();
	}, t("comic.archiveFailed"));

	const cloneComicProject = async (item: ComicProject) => runComicAction(async () => {
		const cloned = await api<ComicProject>(`/api/comic-drama/projects/${item.public_id}/clone`, { method: "POST" });
		setShowArchivedProjects(false);
		await loadComicProjects(false);
		setActiveComicProject(cloned);
	}, t("comic.cloneFailed"));

	const deleteComicProject = async (item: ComicProject) => {
		if (!window.confirm(t("comic.confirmDeleteProject", { name: item.name }))) return;
		await runComicAction(async () => {
			await api(`/api/comic-drama/projects/${item.public_id}`, { method: "DELETE" });
			if (activeComicProject?.public_id === item.public_id) setActiveComicProject(null);
			await loadComicProjects();
		}, t("comic.deleteProjectFailed"));
	};

	const deleteComicStyle = async (style: ComicStyle) => {
		if (!window.confirm(t("comic.confirmDeleteStyle", { name: style.name }))) return;
		await runComicAction(async () => {
			await api(`/api/comic-drama/styles/${style.public_id}`, { method: "DELETE" });
			if (projectDraft.style_id === style.public_id) setProjectDraft((prev) => ({ ...prev, style_id: "" }));
			await loadComicStyles();
		}, t("comic.deleteStyleFailed"));
	};

  const handleUpload = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: "role" });
      const item = { url: asset.url, name: asset.name || file.name, public_id: asset.public_id };
      setComicReferences([...currentComicReferences(), item]);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "网络连接失败";
      setError(t("agent.uploadFailed") + message);
    } finally {
      setUploading(false);
    }
  };

  const handleComicUploads = async (files?: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const remaining = Math.max(0, 8 - currentComicReferences().length);
      const uploaded: ReferenceImage[] = [];
      for (const file of Array.from(files).slice(0, remaining)) {
        const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: "role" });
        uploaded.push({ url: asset.url, name: asset.name || file.name, public_id: asset.public_id });
        setComicReferences([...currentComicReferences(), ...uploaded]);
      }
      setComicReferences([...currentComicReferences(), ...uploaded]);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "网络连接失败";
      setError(t("agent.uploadFailed") + message);
    } finally {
      setUploading(false);
    }
  };

  if (!workflow) return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">{ts("加载中...")}</div>;

  if (workflow?.runtime_config?.agent_mode === "product_refine") {
    return <ProductRefineWorkspace key={`${photoInputKey}:${project?.public_id || "new"}`} workflowCode={workflow.code} workflowName={workflowName} pricing={workflow.runtime_config?.product_pricing} imageModel={generationModel} defaultReviewMode={workflow.runtime_config?.default_review_mode === "strict" ? "strict" : "standard"} project={project ? { ...project, inputs: project.inputs || {}, outputs: project.outputs || {}, estimated_cost: project.estimated_cost || 0, actual_cost: project.actual_cost || 0 } : null} submitting={submitting} error={error} onSubmit={runPhoto} onNewTask={() => { resetTask(); setPhotoInputKey(key => key + 1); }} onLoadHistory={loadHistory} onStop={async () => { if (!project) return; try { await api(`/api/agent-projects/${project.public_id}/cancel`, { method: "POST" }); setProject(await api<Project>(`/api/agent-projects/${project.public_id}`)); } catch (e) { setError(e instanceof Error ? e.message : ts("停止失败")); } }} onRefresh={async () => {
      if (!project) return;
      try {
        const updated = await api<Project>(`/api/agent-projects/${project.public_id}`);
        setProject(updated);
        if (updated.status === "pending" || updated.status === "running") startPolling(updated.public_id);
      } catch {
        /* 到期状态刷新失败时由下一次轻量轮询重试 */
      }
    }} onReview={async action => {
      if (!project) return;
      setError("");
      try {
        const step = action === "review" ? "product_review" : "product_accept";
        await api(`/api/agent-projects/${project.public_id}/steps/${step}/confirm`, { method: "POST", body: JSON.stringify({ payload: {} }) });
        setProject(await api<Project>(`/api/agent-projects/${project.public_id}`));
        startPolling(project.public_id);
      } catch (e) {
        setError(e instanceof Error ? e.message : action === "review" ? ts("启动验收失败") : ts("完成任务失败"));
        throw e;
      }
    }} />;
  }

  if (isVirtualTryOn) {
    const tryOnInputBar = <VirtualTryOnInputBar key={`${photoInputKey}:${project?.public_id || "new"}`} defaultModelCode={workflow.runtime_config?.generation_model_code} initialInputs={project?.inputs} error={error} featureTags={display.feature_tags} onSubmit={runPhoto} />;
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fff1f3] text-gray-900 dark:bg-[#12070a] dark:text-white">
        <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(190,24,93,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(190,24,93,.05)_1px,transparent_1px)] [background-size:40px_40px]" />
        {project ? (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col"><VirtualTryOnResult workflowCode={workflow.code} workflowName={workflowName} project={{ ...project, media_tasks: allMediaTasks }} onNewTask={() => { resetTask(); setPhotoInputKey((key) => key + 1); }} onLoadHistory={loadHistory} /></div>
        ) : (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto"><VirtualTryOnLanding workflowCode={workflow.code} workflowName={workflowName} workflowDescription={workflowDescription} roles={(workflow.runtime_config as any)?.roles || []} heroTags={display.hero_tags} steps={translatedSteps} onLoadHistory={loadHistory} onNewTask={() => setPhotoInputKey((key) => key + 1)} /></div>
        )}
        {tryOnInputBar}
      </div>
    );
  }

  if (isPhotoStudio) {
    const roles = (workflow.runtime_config as any)?.roles || [];
    const photoInputBar = <PhotoStudioInputBar key={photoInputKey} defaultModelCode={workflow.runtime_config?.generation_model_code} error={error} featureTags={display.feature_tags} onSubmit={runPhoto} />;
    // 网格背景 overlay：落地页与项目页保持一致，避免提交后背景突变
    const photoGridOverlay = (
      <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.06)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(232,121,249,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(232,121,249,.08)_1px,transparent_1px)]" />
    );
    if (!project) {
      return (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fdf0f9] text-gray-900 dark:bg-[#0a0510] dark:text-white">
          {photoGridOverlay}
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
            <PhotoStudioLanding workflowCode={workflow.code} workflowName={workflowName} workflowDescription={workflowDescription} roles={roles} heroTags={display.hero_tags} steps={translatedSteps} onLoadHistory={loadHistory} onNewTask={() => setPhotoInputKey((k) => k + 1)} />
          </div>
          {photoInputBar}
        </div>
      );
    }
    const outputs = project.outputs || {};
    const styling = (outputs.styling || {}) as Record<string, any>;
    const photoCells = allMediaTasks.map((task, index) => ({ task, url: mediaURL(task), index }));
    const requestedPhotoCount = Number(project.inputs?.count || 1);
    const extraPhotoCells = project.status === "pending" || project.status === "running" ? Math.max(0, requestedPhotoCount - photoCells.length) : 0;
    const failedCount = allMediaTasks.filter((task) => task.status === "failed").length;
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fdf0f9] text-gray-900 dark:bg-[#0a0510] dark:text-white">
        {photoGridOverlay}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* 项目页保留顶栏：新任务/历史始终可见可点 */}
          <div className="px-3 pt-2 sm:px-5 lg:px-8">
            <PhotoStudioTopBar workflowCode={workflow.code} onNewTask={() => { resetTask(); setPhotoInputKey((k) => k + 1); }} onLoadHistory={loadHistory} />
          </div>
          {project.status === "waiting_confirm" && allMediaTasks.length === 0 ? (
            <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{ts("造型设计完成，等待确认")}</h1>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{ts("确认或修改拍摄方案后，摄影师将按方案开拍。转智能托管则直接开拍。")}</p>
              <div className="mt-5 rounded-2xl border border-fuchsia-100 bg-white/80 p-5 shadow-sm dark:border-fuchsia-400/20 dark:bg-white/5">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-fuchsia-600 dark:text-fuchsia-300">{ts("💄 拍摄方案")}</div>
                <textarea hidden={isComicDrama && project?.outputs?.current_step === "keyframes_confirm"} value={confirmPrompt} readOnly={!allowPromptEdit} onChange={(event) => setConfirmPrompt(event.target.value)} className="h-40 w-full resize-none rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm leading-6 text-gray-700 outline-none dark:border-white/10 dark:bg-gray-950 dark:text-gray-100" />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => void confirmPhotoPlan()} className="rounded-xl bg-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-400">{ts("确认方案并开拍")}</button>
                <button type="button" onClick={() => void enableAutopilot()} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-600 hover:bg-white dark:border-white/15 dark:text-gray-300 dark:hover:bg-white/5">{ts("转智能托管，直接开拍")}</button>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
              <button type="button" onClick={resetTask} className="mb-4 text-sm text-fuchsia-500 hover:text-fuchsia-600 dark:text-fuchsia-300">{ts("← 再拍一套")}</button>
              <div className="mb-5 flex items-center justify-between gap-4">
                <div><h1 className="text-2xl font-bold text-gray-900 dark:text-white">{workflowName}</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{project.status === "succeeded" ? ts("写真拍摄完成") : project.status === "failed" ? ts("拍摄失败") : project.status === "canceled" ? ts("已取消，已生成内容已保留") : ts("AI 摄影团队正在拍摄")}</p></div>
                <span className="rounded-full border border-fuchsia-200 px-3 py-1 text-xs text-fuchsia-600 dark:border-fuchsia-400/30 dark:text-fuchsia-300">{project.status === "succeeded" ? ts("已完成") : project.status === "failed" ? ts("失败") : project.status === "canceled" ? ts("已取消") : `${totalProgress}%`}</span>
              </div>
              {styling.summary ? (
                <div className="mb-4 rounded-2xl border border-fuchsia-100 bg-white/80 px-4 py-3 text-sm leading-6 text-gray-600 shadow-sm dark:border-fuchsia-400/20 dark:bg-white/5 dark:text-gray-300">
                  <span className="mr-2 font-semibold text-fuchsia-600 dark:text-fuchsia-300">{ts("💄 拍摄方案")}</span>{textOf(styling.summary)}
                </div>
              ) : null}
              {project.error_message && <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{project.error_message}</div>}
              {(project.status === "pending" || project.status === "running") && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-fuchsia-100 bg-white/80 px-4 py-2 text-xs text-gray-500 shadow-sm dark:border-fuchsia-400/15 dark:bg-white/5 dark:text-gray-300">
                  <span>{projectStage(project, allMediaTasks, "image", false, ts)}</span>
                  {project.status === "pending" && <button type="button" onClick={() => void cancelProject()} className="font-semibold text-red-500 hover:text-red-600">{t("common.cancel")}</button>}
                </div>
              )}
              {photoCells.length + extraPhotoCells > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {photoCells.map(({ task, url, index }) => (
                    <PhotoStudioPhotoCell key={textOf(task.task_no) || index} task={task} url={url} index={index} />
                  ))}
                  {Array.from({ length: extraPhotoCells }).map((_, index) => (
                    <div key={`extra-${index}`} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl bg-fuchsia-100/60 dark:bg-white/5">
                      <Loader2 size={20} className="animate-spin text-fuchsia-400" />
                      <span className="text-xs text-fuchsia-500 dark:text-fuchsia-300">{ts("生成中…")}</span>
                    </div>
                  ))}
                </div>
              )}
              {failedCount > 0 && <p className="mt-3 text-xs text-red-500">{failedCount}  {ts("张生成失败，可重试补拍")}</p>}
              {project.status === "failed" && <button type="button" onClick={() => void retry()} className="mt-4 rounded-xl bg-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-400">{ts("重试")}</button>}
            </div>
          )}
        </div>
        {photoInputBar}
      </div>
    );
  }

  if (isNovelWorkshop) {
    const roles = (workflow.runtime_config as any)?.roles || [];
    if (!project) {
      return <NovelWorkshopLanding workflowCode={workflow.code} workflowName={workflowName} workflowDescription={workflowDescription} roles={roles} defaultModelCode={workflow.runtime_config?.generation_model_code || workflow.runtime_config?.analysis_model_code} error={error} onSubmit={runNovel} onLoadHistory={loadHistory} />;
    }
    const outputs = project.outputs || {};
    const chapters = Array.isArray(outputs.chapters) ? outputs.chapters as any[] : [];
    const novelShell = (content: ReactNode) => (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#eaf7fb] text-gray-900 dark:bg-[#05080f] dark:text-white">
        <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)]" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-3 py-1.5 sm:px-5 sm:py-2 lg:px-8"><PhotoStudioTopBar workflowCode={workflow.code} historyFallbackTitle={ts("小说任务")} onNewTask={resetTask} onLoadHistory={loadHistory} /></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3 sm:px-8 sm:pt-5">
            <div className="mx-auto w-full max-w-5xl">{content}</div>
          </div>
        </div>
      </div>
    );
    if (project.status === "waiting_confirm") {
      const stage = String(outputs.current_stage || "");
      if (stage === "batch_confirm") {
        const done = chapters.length;
        const total = Number(outputs.total_chapters || 0);
        return novelShell(<><div className="mb-6"><h1 className="text-2xl font-bold">{ts("已完成")} {done}{total > 0 ? ` / ${total}` : ""}  {ts("章，等待确认")}</h1><p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{ts("逐步确认模式下，每完成一批章节都会在这里等你。确认后会继续创作后面的章节。")}</p></div><NovelChapterList chapters={chapters} currentChapter={done} totalChapters={total} onRequestRevision={reviseNovel} /><div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void confirmNovelBatch()} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400">{ts("确认并继续创作")}</button><button type="button" onClick={() => void enableAutopilot()} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-600 hover:bg-white dark:border-white/15 dark:text-gray-300 dark:hover:bg-white/5">{ts("转智能托管，不再逐步确认")}</button></div>{error && <p className="mt-3 text-sm text-red-500 dark:text-red-400">{error}</p>}</>);
      }
      if (outputs.planning) {
        const planning = outputs.planning as any;
        const outline = planning.outline || {};
        const volumes = Array.isArray(outline.volumes) ? outline.volumes : [];
        return novelShell(<><div className="mb-6"><h1 className="text-2xl font-bold">{ts("故事策划完成，等待确认")}</h1><p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{ts("确认大纲后，AI 编辑部会按章节逐步创作正文。")}</p></div><div className="mb-5 rounded-2xl border border-indigo-200 bg-white/70 p-5 dark:border-indigo-400/20 dark:bg-white/[0.04]"><h2 className="text-lg font-semibold">{planning.title || "未命名小说"}</h2><p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">{planning.core_concept || planning.world_setting || "已完成世界观和故事规划"}</p><div className="mt-4 space-y-2">{volumes.flatMap((volume: any) => Array.isArray(volume.chapters) ? volume.chapters : []).map((chapter: any) => <div key={chapter.chapter_number} className="rounded-xl bg-indigo-50 px-3 py-2 dark:bg-white/[0.04]"><span className="mr-2 text-xs text-indigo-600 dark:text-indigo-300">{ts("第")} {chapter.chapter_number}  {ts("章")}</span><span className="text-sm text-gray-700 dark:text-gray-200">{chapter.title}</span><p className="mt-1 text-xs text-gray-500">{chapter.summary}</p></div>)}</div></div><div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => void confirmNovelOutline()} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400">{ts("确认大纲并开始创作")}</button><button type="button" onClick={() => void enableAutopilot()} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-600 hover:bg-white dark:border-white/15 dark:text-gray-300 dark:hover:bg-white/5">{ts("转智能托管，后续不再确认")}</button></div>{error && <p className="mt-3 text-sm text-red-500 dark:text-red-400">{error}</p>}</>);
      }
    }
    return novelShell(
      <>
          <div className="mb-6 flex items-center justify-between gap-4">
            <div><h1 className="text-2xl font-bold">{workflowName}</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{project.status === "waiting_confirm" ? ts("等待你的确认") : project.status === "succeeded" ? ts("全书创作完成") : project.status === "canceled" ? ts("已取消，已生成内容已保留") : project.status === "failed" ? ts("创作中断，已生成内容已保留") : ts("AI 编辑部正在协作创作")}</p></div>
            <span className="rounded-full border border-indigo-300 px-3 py-1 text-xs text-indigo-600 dark:border-indigo-400/30 dark:text-indigo-300">{project.status === "succeeded" ? ts("已完成") : project.status === "canceled" ? ts("已取消") : project.status === "failed" ? ts("已中断") : project.status === "waiting_confirm" ? ts("待确认") : project.status}</span>
          </div>
          {/* 未开始章节创作（或项目被取消/中断）时，展示已完成的故事策划大纲，避免“啥也看不到” */}
          {chapters.length === 0 && outputs.planning ? (() => {
            const planning = outputs.planning as any;
            const outline = planning.outline || {};
            const volumes = Array.isArray(outline.volumes) ? outline.volumes : [];
            return (
              <div className="mb-5 rounded-2xl border border-indigo-200 bg-white/70 p-5 dark:border-indigo-400/20 dark:bg-white/[0.04]">
                <h2 className="text-lg font-semibold">{planning.title || "未命名小说"}</h2>
                <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">{planning.core_concept || planning.world_setting || "已完成世界观和故事规划"}</p>
                <div className="mt-4 space-y-2">{volumes.flatMap((volume: any) => Array.isArray(volume.chapters) ? volume.chapters : []).map((chapter: any) => <div key={chapter.chapter_number} className="rounded-xl bg-indigo-50 px-3 py-2 dark:bg-white/[0.04]"><span className="mr-2 text-xs text-indigo-600 dark:text-indigo-300">{ts("第")} {chapter.chapter_number}  {ts("章")}</span><span className="text-sm text-gray-700 dark:text-gray-200">{chapter.title}</span><p className="mt-1 text-xs text-gray-500">{chapter.summary}</p></div>)}</div>
              </div>
            );
          })() : null}
          <NovelChapterList chapters={chapters} currentChapter={Number(outputs.current_chapter || chapters.length)} totalChapters={Number(outputs.total_chapters || 0)} onRequestRevision={reviseNovel} />
          {project.error_message && <p className="mt-4 text-sm text-red-500 dark:text-red-400">{project.error_message}</p>}
      </>
    );
  }

  if (isVideoUtility) {
    return <VideoUpscaleWorkspace workflow={workflow} />;
  }

  if (isComicDrama) {
    const activeStyle = comicStyles.find((item) => item.public_id === projectDraft.style_id) || comicStyles.find((item) => item.public_id === activeComicProject?.style_id);
    const filteredStyles = comicStyles.filter((item) => styleFilter === "all" || (styleFilter === "system" ? item.source === "system" : item.source !== "system"));
    const projectQuality = activeComicProject?.quality || projectDraft.quality;
    const projectOrientation = activeComicProject?.orientation || projectDraft.orientation;
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden bg-[#eaf7fb] text-gray-900 dark:bg-[#05080f] dark:text-white">
        <aside
          className={
            "relative z-20 hidden shrink-0 flex-col border-r border-gray-200/80 bg-white/80 shadow-sm backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-[#111116]/90 lg:flex " +
            (projectDrawerCollapsed ? "w-[44px]" : "w-[320px]")
          }
        >
          <button
            type="button"
            onClick={() => setComicDrawerCollapsed(!projectDrawerCollapsed)}
            className="absolute -right-4 top-6 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow dark:border-white/10 dark:bg-gray-900 dark:text-gray-300"
            title={projectDrawerCollapsed ? ts("展开项目") : ts("收起项目")}
          >
            {projectDrawerCollapsed ? ">" : "<"}
          </button>
          {projectDrawerCollapsed ? (
            <div className="flex flex-1 items-start justify-center pt-20 text-xs text-gray-400 [writing-mode:vertical-rl]">{ts("项目")}</div>
          ) : (
            <>
              <div className="p-4">
                <button type="button" onClick={() => setProjectModalOpen(true)} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-700 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10">
                  <Plus size={16} /> {t("comic.newProject")}
                </button>
						<button type="button" onClick={() => { const next = !showArchivedProjects; setShowArchivedProjects(next); void loadComicProjects(next); }} className="mt-2 w-full text-center text-xs text-gray-400 hover:text-cyan-600">{showArchivedProjects ? t("comic.hideArchived") : t("comic.showArchived")}</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                {comicProjects.length === 0 ? (
                  <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center text-gray-400">
                    <Folder size={48} strokeWidth={1.5} />
                    <div className="mt-4 text-sm">{t("comic.emptyProjects")}</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {comicProjects.map((item) => {
                      const active = activeComicProject?.public_id === item.public_id;
                      return (
                        <div
                          key={item.public_id}
									role="button"
									tabIndex={0}
                          onClick={() => selectComicProject(item)}
									onKeyDown={(event) => { if (event.key === "Enter") selectComicProject(item); }}
                          className={"w-full rounded-2xl border p-3 text-left transition " + (active ? "border-cyan-300 bg-cyan-50 shadow-sm dark:border-cyan-400/40 dark:bg-cyan-400/10" : "border-gray-100 bg-white/70 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10")}
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-white/10">
                              {item.cover_url ? <Image src={item.cover_url} alt="" width={128} height={96} sizes="64px" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-gray-400"><ImageIcon size={18} /></div>}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.name}</div>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                                <span>{item.orientation === "portrait" ? t("comic.portrait") : t("comic.landscape")}</span>
                                <span>{item.quality}</span>
                                {item.last_workflow_status ? <span>{t(STATUS_LABEL_KEY[item.last_workflow_status] || item.last_workflow_status)}</span> : null}
                              </div>
                            </div>
                          </div>
									<div className="mt-2 flex justify-end gap-1 border-t border-gray-100 pt-2 dark:border-white/10">
										<button type="button" title={t("comic.cloneProject")} onClick={(event) => { event.stopPropagation(); void cloneComicProject(item); }} className="rounded-lg p-1.5 text-gray-400 hover:bg-cyan-50 hover:text-cyan-600"><Copy size={13} /></button>
										<button type="button" title={item.archived ? t("comic.restoreProject") : t("comic.archiveProject")} onClick={(event) => { event.stopPropagation(); void archiveComicProject(item); }} className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600"><Archive size={13} /></button>
										<button type="button" title={t("comic.deleteProject")} onClick={(event) => { event.stopPropagation(); void deleteComicProject(item); }} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
									</div>
								</div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="border-t border-gray-100 p-4 dark:border-white/10">
                <button type="button" onClick={() => setSettingsOpen(true)} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 text-sm font-semibold text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200">
                  <Settings2 size={16} /> {t("comic.smartEngine")}
                </button>
              </div>
            </>
          )}
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden" onMouseEnter={() => !projectDrawerCollapsed && setComicDrawerCollapsed(true)}>
          <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(34,211,238,.24),transparent_28%),radial-gradient(circle_at_12%_84%,rgba(20,184,166,.18),transparent_22%)] dark:bg-[radial-gradient(circle_at_76%_10%,rgba(20,184,166,.22),transparent_28%),radial-gradient(circle_at_14%_82%,rgba(6,182,212,.14),transparent_22%)]" />
          <div className="scrollbar-none relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2 pb-3 sm:px-5 lg:px-8">
            {!project && <div className="comic-landing-stack flex min-h-0 flex-1 flex-col justify-start gap-2 py-2 sm:gap-3 sm:py-3 lg:gap-3 lg:py-2">
              <div className="shrink-0 text-center">
              <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-semibold text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200 sm:px-4 sm:text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> {t("comic.superAgent")}
              </div>
              <div className="flex items-center justify-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-500/10 text-xl sm:h-11 sm:w-11 sm:text-2xl">🎨</div>
                <h1 title={workflowName || t("comic.defaultName")} className="max-w-[min(78vw,960px)] truncate text-xl font-black tracking-normal text-gray-900 dark:text-white sm:text-3xl">{workflowName || t("comic.defaultName")}</h1>
              </div>
              {workflowDescription ? (
                <p
                  title={workflowDescription}
                  className="mx-auto mt-2 line-clamp-2 max-w-3xl px-3 text-xs leading-5 text-gray-500 dark:text-gray-300 sm:text-sm sm:leading-6"
                >
                  {workflowDescription}
                </p>
              ) : null}
              <div className="mt-2 hidden flex-wrap justify-center gap-1.5 sm:mt-3 sm:flex sm:gap-2">
				{[t("comic.tagFusion"), t("comic.tagControl"), t("comic.tagMultiSubject"), t("comic.tagOneClick")].map((tag) => (
                  <span key={tag} title={tag} className="max-w-[180px] truncate rounded-full border border-gray-200 bg-white/55 px-2.5 py-0.5 text-[11px] text-gray-500 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-gray-300 sm:px-3 sm:py-1 sm:text-xs">{tag}</span>
                ))}
              </div>
            </div>

              <div className="agent-showcase min-h-[190px] shrink-0 items-center sm:min-h-[210px] lg:min-h-[220px]">
                <ComicFeatureSelector features={translatedSteps} activeIndex={activeComicFeature} onSelect={setActiveComicFeature} />
                <ComicFeatureHero features={translatedSteps} activeIndex={activeComicFeature} onSelect={setActiveComicFeature} />
              </div>
              <div className="shrink-0">
                <ComicTimeline
                  nodes={translatedTimeline}
                  mobileNodes={translatedTimeline}
                  compact
                />
              </div>
            </div>}
            <div className="mx-auto w-full max-w-[1040px] shrink-0">
                {error && <div className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-200">{error}</div>}
                {project && (
                  <div className="mb-2 rounded-2xl border border-cyan-100 bg-white/70 px-4 py-2 text-xs text-gray-500 shadow-sm backdrop-blur dark:border-cyan-400/15 dark:bg-white/5 dark:text-gray-300">
                    <div className="flex items-center justify-between gap-3">
                    <span>{projectStage(project, allMediaTasks, generationType, true, ts)} · {totalProgress}%</span>
                    <div className="flex items-center gap-2">
					  {finalVideoURL ? <a href={finalVideoURL} target="_blank" rel="noreferrer" className="font-semibold text-cyan-600 dark:text-cyan-200">{t("comic.viewFinal")}</a> : null}
                      {(project.status === "pending" || project.status === "waiting_confirm") && <button type="button" onClick={() => void cancelProject()} className="font-semibold text-red-500 hover:text-red-600">{t("common.cancel")}</button>}
                      {project.status === "failed" && <button type="button" onClick={() => void retry()} className="inline-flex items-center gap-1 font-semibold text-cyan-600 dark:text-cyan-200"><RefreshCw size={12} />{t("comic.retryWorkflow")}</button>}
                    </div>
                    </div>
                    {project.error_message ? <p className="mt-1 text-red-500">{project.error_message}</p> : null}
                  </div>
                )}
                {project?.status === "waiting_confirm" && (
                  <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50/95 p-3 shadow-sm dark:border-amber-400/20 dark:bg-amber-500/10">
                    <div className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-200">{project.outputs?.current_step === "keyframes_confirm" ? ts("请检查下方关键帧的人物与服装，确认后生成视频") : t("agent.confirmPlan")}</div>
                    <textarea hidden={isComicDrama && project?.outputs?.current_step === "keyframes_confirm"} value={confirmPrompt} readOnly={!allowPromptEdit} onChange={(event) => setConfirmPrompt(event.target.value)} className="h-24 w-full resize-none rounded-xl border border-amber-100 bg-white px-3 py-2 text-sm text-gray-700 outline-none dark:border-amber-400/20 dark:bg-gray-950 dark:text-gray-100" />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void confirmStep()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-white"><Check size={15} />{t("agent.confirmGenerate")}</button>
                      {canUseAutopilot && <button type="button" onClick={() => void enableAutopilot()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white dark:bg-white dark:text-gray-900"><Wand2 size={15} />{t("agent.autopilot")}</button>}
                    </div>
                  </div>
                )}
                {finalVideoURL ? <div className="mb-2"><FinalComicVideo url={finalVideoURL} /></div> : null}
                {project ? <ComicProjectPanel project={project} /> : null}
                {!project && <section className="soft-input overflow-hidden">
                  <div className="border-b border-gray-50 px-3 py-2 dark:border-white/10 sm:px-4">
                    <div className="scroll-x-only grid grid-cols-[1fr_auto_1fr] items-center gap-2 overflow-x-auto">
                      <button type="button" onClick={() => void openComicImageLibrary("references")} className="flex h-9 shrink-0 items-center gap-2 justify-self-start rounded-xl border border-gray-100 bg-gray-50 px-3 text-xs font-medium text-gray-600 transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10">
                        <Folder size={15} />{t("asset.library")}
                        {currentComicReferences().length > 0 ? <span className="rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-600 dark:text-cyan-200">{currentComicReferences().length}</span> : null}
                      </button>
                      <label title={ts("输入是已有剧本／原文：按原文定位分镜，保留来源供核对")} className={"flex h-9 shrink-0 cursor-pointer items-center gap-2 justify-self-center rounded-xl border px-3 text-xs font-medium transition " + (comicSourceMode ? "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200" : "border-gray-100 bg-gray-50 text-gray-600 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10")}>
                        <input aria-label={ts("输入是已有剧本／原文：按原文定位分镜，保留来源供核对")} type="checkbox" checked={comicSourceMode} onChange={(e) => setComicSourceMode(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-500" />
                        <span className="whitespace-nowrap">{ts("输入是已有剧本／原文：按原文定位分镜，保留来源供核对")}</span>
                      </label>
                      <button type="button" onClick={() => setHelpOpen(true)} className="flex h-9 shrink-0 items-center gap-2 justify-self-end rounded-xl border border-gray-100 bg-gray-50 px-3 text-xs font-medium text-gray-600 transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10">
                        <HelpCircle size={15} />{t("agent.help")}
                      </button>
                    </div>
                  </div>
                  <div className="flex min-h-[92px] gap-3 p-3 sm:min-h-[104px] sm:p-4">
					<div className="flex shrink-0 gap-1.5">
                      <label className="flex h-14 w-12 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 bg-gray-50 text-[10px] text-gray-400 hover:border-cyan-300 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-cyan-400/10 sm:h-20 sm:w-16">
					  {productImage ? <div className="relative h-full w-full"><Image src={productImage.url} alt="" width={128} height={128} sizes="64px" className="h-full w-full rounded-xl object-cover" /><span className="absolute bottom-1 right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] text-white">{currentComicReferences().length}/8</span></div> : comicUploading || uploading ? <Loader2 size={18} className="animate-spin" /> : <><Plus size={18} /><span>{t("comic.referenceImage")}</span></>}
                        <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(e) => { void handleComicUploads(e.target.files); e.currentTarget.value = ""; }} />
                      </label>
                    </div>
					<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("comic.videoPlaceholder")} className="min-h-[68px] flex-1 resize-none bg-transparent text-sm leading-6 text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500 sm:min-h-[86px]" />
                    <button onClick={run} disabled={submitting} className="mt-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-white shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-400 disabled:opacity-40">
                      {submitting ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-3 py-3 dark:border-white/10 sm:px-4">
                    <button type="button" onClick={() => setStyleModalOpen(true)} className="flex h-9 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 text-xs font-semibold text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
					<Star size={14} className="text-cyan-500" /> {activeComicProject?.style?.name ? ts(activeComicProject.style.name) : activeStyle?.name ? ts(activeStyle.name) : t("comic.selectStyle")}
                    </button>
                    <button type="button" onClick={() => setProjectModalOpen(true)} className="flex h-9 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 text-xs font-semibold text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
					<Folder size={14} /> {activeComicProject?.name || t("comic.selectProject")}
                    </button>
                    <button type="button" disabled={!activeComicProject} onClick={() => setAssetModalOpen(true)} className="flex h-9 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 text-xs font-semibold text-gray-700 disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
                      <ImageIcon size={14} /> {t("comic.assetLibrary")} · {comicAssets.length}
                    </button>
                    <MediaOptionMenu
                      icon={<Mic2 size={14} />}
                      activeLabel={ts(comicNarrationLabel(comicSettings.narration_perspective))}
                      title={ts("配音叙事模式")}
                      subtitle={ts("控制剧本中的旁白视角与角色对白结构")}
                      menuWidth={300}
                    >
                      {(close) => <div className="space-y-1.5">{COMIC_NARRATION_MODES.map((option) => <MediaMenuOption key={option.value} multiline selected={comicSettings.narration_perspective === option.value} onClick={() => { setComicSettings((prev) => ({ ...prev, narration_perspective: option.value })); close(); }}><div><div className="leading-5">{ts(option.label)}</div><div className="mt-0.5 whitespace-normal text-[11px] font-normal leading-4 opacity-65">{ts(option.description)}</div></div></MediaMenuOption>)}</div>}
                    </MediaOptionMenu>
                    {selectedComicVideoModel && !comicVideoSupportsReference ? <button type="button" onClick={() => setSettingsOpen(true)} className="h-9 rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">{ts("当前视频模型不支持参考图")}</button> : null}
                    <MediaOptionMenu
                      icon={<Settings2 size={14} />}
                      activeLabel={projectQuality}
                      title={t("imageToolbar.quality")}
                      subtitle={t("imageToolbar.qualityDesc")}
                    >
                      {(close) => (
                        <div className="space-y-1.5">
                          {["480P", "720P", "1080P"].map((quality) => (
                            <MediaMenuOption
                              key={quality}
                              selected={projectQuality === quality}
                              onClick={() => {
                                void updateComicProjectOutput({ quality });
                                close();
                              }}
                            >
                              {quality}
                            </MediaMenuOption>
                          ))}
                        </div>
                      )}
                    </MediaOptionMenu>
                    <MediaOptionMenu
                      icon={<Wand2 size={14} />}
                      activeLabel={projectOrientation === "portrait" ? t("comic.portrait") : t("comic.landscape")}
                      title={t("video.orientation")}
                      subtitle={t("video.orientationDesc")}
                    >
                      {(close) => (
                        <div className="space-y-1.5">
                          {[
                            { value: "landscape", label: t("comic.landscape") },
                            { value: "portrait", label: t("comic.portrait") },
                          ].map((option) => (
                            <MediaMenuOption
                              key={option.value}
                              selected={projectOrientation === option.value}
                              onClick={() => {
                                void updateComicProjectOutput({ orientation: option.value });
                                close();
                              }}
                            >
                              {option.label}
                            </MediaMenuOption>
                          ))}
                        </div>
                      )}
                    </MediaOptionMenu>
                    <div className="mx-auto flex w-full max-w-[260px] items-center justify-center rounded-full bg-gray-100 p-1 dark:bg-white/10 sm:ml-auto sm:mr-0 sm:w-auto sm:max-w-none">
					<button type="button" onClick={() => setMode("step")} className={"flex-1 rounded-full px-4 py-2 text-center text-xs font-semibold sm:flex-none " + (mode === "step" ? "bg-cyan-500 text-white shadow" : "text-gray-500 dark:text-gray-300")}>{t("agent.stepConfirm")}</button>
					<button type="button" onClick={() => setMode("auto")} className={"flex-1 rounded-full px-4 py-2 text-center text-xs font-semibold sm:flex-none " + (mode === "auto" ? "bg-gray-900 text-white shadow dark:bg-white dark:text-gray-900" : "text-gray-500 dark:text-gray-300")}>{t("agent.autopilot")}</button>
                    </div>
                  </div>
                </section>}
              </div>
            </div>
        </main>

        {projectModalOpen && (
          <ComicProjectModal
            draft={projectDraft}
            selectedStyle={activeStyle}
            uploading={comicUploading}
            submitting={submitting}
            onChange={setProjectDraft}
            onUpload={(file) => uploadComicImage(file, "project")}
            onChooseCoverAsset={() => void openComicImageLibrary("project_cover")}
            onChooseStyle={() => setStyleModalOpen(true)}
            onClose={() => setProjectModalOpen(false)}
            onCreate={createComicProject}
          />
        )}
        {styleModalOpen && (
          <ComicStyleModal
            styles={filteredStyles}
            selectedId={projectDraft.style_id}
            filter={styleFilter}
            onFilter={setStyleFilter}
            onSelect={(id) => setProjectDraft((prev) => ({ ...prev, style_id: id }))}
            onClose={() => setStyleModalOpen(false)}
            onConfirm={() => setStyleModalOpen(false)}
            onAdd={(mode) => {
              setStyleModalOpen(false);
              setStyleAddOpen(mode);
            }}
				onDelete={(style) => void deleteComicStyle(style)}
          />
        )}
        {styleAddOpen && (
          <ComicStyleAddModal
            mode={styleAddOpen}
            draft={styleDraft}
            uploading={comicUploading}
            submitting={submitting}
            onChange={setStyleDraft}
            onUpload={(file) => uploadComicImage(file, "style")}
            onChooseCoverAsset={() => void openComicImageLibrary("style_cover")}
            onClose={() => {
              setStyleAddOpen(null);
              setStyleModalOpen(true);
            }}
            onSave={createComicStyle}
          />
        )}
        {settingsOpen && (
          <ComicPreferenceModal
            settings={comicSettings}
            imageModels={comicImageModels}
            videoModels={comicVideoModels}
            onChange={setComicSettings}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {assetModalOpen && activeComicProject && (
          <ComicAssetModal
            projectId={activeComicProject.public_id}
            items={comicAssets}
            onClose={() => setAssetModalOpen(false)}
            onChanged={() => loadComicAssets(activeComicProject.public_id)}
          />
        )}
        {comicLibraryTarget && (
          <ComicImageLibraryModal
            target={comicLibraryTarget}
            items={comicLibraryItems}
            selected={comicLibrarySelected}
            loading={comicLibraryLoading}
            onSelected={setComicLibrarySelected}
            onClose={() => setComicLibraryTarget(null)}
            onConfirm={confirmComicLibrary}
          />
        )}
        {helpOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={() => setHelpOpen(false)}>
            <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><HelpCircle size={17} className="text-cyan-500" />{t("agent.help")}</div>
                <button type="button" onClick={() => setHelpOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={15} /></button>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-7 text-gray-600 dark:text-gray-300">{display.help || t("agent.helpDefault")}</p>
              <button type="button" onClick={() => setHelpOpen(false)} className="mt-4 h-10 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white dark:bg-white dark:text-gray-950">{t("common.gotIt")}</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden bg-[#eaf7fb] text-gray-900 dark:bg-[#05080f] dark:text-white">
      {!project && (
        <>
          <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(34,211,238,.22),transparent_28%),radial-gradient(circle_at_12%_84%,rgba(20,184,166,.16),transparent_22%)] dark:bg-[radial-gradient(circle_at_76%_10%,rgba(20,184,166,.2),transparent_28%),radial-gradient(circle_at_14%_82%,rgba(6,182,212,.12),transparent_22%)]" />
        </>
      )}
      <div className="relative z-20 shrink-0 px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={resetTask} className="h-9 px-3 rounded-xl bg-primary text-dark text-sm font-semibold flex items-center gap-1.5"><Plus size={15} />{t("common.newTask")}</button>
          <div className="relative">
            <button onClick={openHistory} className="h-9 px-3 rounded-xl bg-white border border-gray-100 text-gray-600 text-sm flex items-center gap-1.5 hover:bg-gray-50 transition dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"><History size={15} />{t("common.history")}</button>
            {historyOpen && (
              <div className="absolute left-0 mt-2 w-[320px] soft-card p-2 z-30 max-h-[60vh] overflow-y-auto">
                {historyItems.length === 0 ? <div className="text-center text-xs text-gray-400 py-6">{t("common.empty")}</div> : historyItems.map((h) => (
                  <button key={h.public_id} onClick={() => loadHistory(h.public_id)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-800 dark:text-gray-100 truncate">{h.title || h.workflow_name}</span>
                      <span className="text-[11px] text-gray-400">{t(STATUS_LABEL_KEY[h.status] || h.status)}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{new Date(h.created_at).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={(project ? "relative z-10 flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-4" : "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3 sm:px-5 lg:px-8 lg:py-4")}>
        <div className={project ? "max-w-[1120px] mx-auto space-y-4" : "mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col"}>
          {!project && (
            <AgentLanding
              workflowIcon={workflow.icon || "\u{1F916}"}
              workflowName={workflowName}
              workflowDescription={workflowDescription}
              heroTags={translatedHeroTags.length ? translatedHeroTags : ["AI Agent", "Step confirm", "Autopilot"]}
              features={translatedSteps}
              activeIndex={activeAgentFeature}
              onSelect={setActiveAgentFeature}
              theme={theme}
              generationType={generationType}
            />
          )}
          {project && (
          <div className="space-y-3">
                <div className="rounded-2xl border border-gray-100 bg-white/80 px-4 py-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-full " + (project.status === "succeeded" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : project.status === "failed" ? "bg-red-500/10 text-red-500" : "bg-primary/10 text-primary")}>
                        {project.status === "succeeded" ? <Check size={16} /> : project.status === "failed" ? <X size={16} /> : <Loader2 size={16} className="animate-spin" />}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{projectStage(project, allMediaTasks, generationType, isComicDrama, ts)}</div>
                        <div className="mt-0.5 text-xs text-gray-400">{project.status === "succeeded" ? ts("成品已就绪，可继续核对或下载") : `${t("workspace.generationProgress")} ${totalProgress}%`}</div>
                      </div>
                    </div>
                    {project.status !== "succeeded" && project.status !== "failed" ? <span className="shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-300">{totalProgress}%</span> : null}
                  </div>
                  {project.status !== "succeeded" && project.status !== "failed" ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: totalProgress + "%" }} /></div> : null}
                </div>
                <div className="space-y-3">
                  {isComicDrama && <ComicProjectPanel project={project} />}
                  {code === "ecommerce_image" && Array.isArray(analysis.missing_information) && analysis.missing_information.length > 0 && <details className="group rounded-xl border border-amber-200/70 bg-amber-50/70 text-xs text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100"><summary className="cursor-pointer list-none px-3 py-2.5 font-semibold">{ts("尚未确认的信息（不会作为商品事实使用）")} · {analysis.missing_information.length}</summary><div className="border-t border-amber-200/60 px-3 py-2 leading-6 dark:border-amber-400/15">{analysis.missing_information.map((item: unknown, i: number) => <p key={i}>{textOf(item)}</p>)}</div></details>}

                  {project.status === "waiting_confirm" && (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 space-y-3 dark:bg-amber-500/10 dark:border-amber-400/20">
                      <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">{t("agent.confirmPlan")}</div>
                      {candidates.length > 0 && (
                        <div className="grid gap-2">
                          {candidates.map((item) => {
                            const selected = selectedCandidateId === item.id;
                            const recommended = item.id === textOf(analysis.recommendation);
                            return (
                              <button
                                type="button"
                                key={item.id}
                                onClick={() => {
                                  setSelectedCandidateId(item.id);
                                  setConfirmPrompt(item.prompt);
                                }}
                                className={
                                  "text-left rounded-xl border px-3 py-2 transition " +
                                  (selected
                                    ? "border-primary bg-white shadow-sm dark:bg-gray-950 dark:border-primary/70"
                                    : "border-amber-100 bg-white/60 hover:bg-white dark:bg-white/5 dark:border-amber-400/20 dark:hover:bg-white/10")
                                }
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{item.title || (t("agent.plan") + " " + item.id)}</span>
                                  {recommended && <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-gray-900 dark:text-primary">{t("agent.aiRecommended")}</span>}
                                </div>
                                {item.reason && <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-300">{item.reason}</p>}
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-400 dark:text-gray-500">{item.prompt}</p>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <textarea
                        value={confirmPrompt}
                        readOnly={!allowPromptEdit}
                        onChange={(e) => setConfirmPrompt(e.target.value)}
                        className="w-full h-32 rounded-xl border border-amber-100 bg-white px-3 py-2 text-sm focus:outline-none read-only:bg-gray-50 read-only:text-gray-500 dark:bg-gray-950 dark:border-amber-400/20 dark:text-gray-100 dark:read-only:bg-white/5 dark:read-only:text-gray-400"
                      />
                      {Array.isArray(analysis.detail_sections) && analysis.detail_sections.length > 0 && (
                        <details className="text-sm" open>
                          <summary className="cursor-pointer py-2 font-medium">{ts("详情模块与成图文案")}</summary>
                          <DetailPagePanel detailPage={{ status: "planning", sections: analysis.detail_sections as DetailSection[] }} />
                        </details>
                      )}
                      <div className="flex items-center gap-2">
                        <button onClick={confirmStep} className="h-10 px-4 rounded-xl bg-primary text-dark font-semibold text-sm flex items-center gap-1.5"><Check size={16} />{t("agent.confirmGenerate")}</button>
                        {canUseAutopilot && <button onClick={enableAutopilot} className="h-10 px-4 rounded-xl bg-gray-900 text-white font-semibold text-sm flex items-center gap-1.5"><Wand2 size={16} />{t("agent.autopilot")}</button>}
                      </div>
                    </div>
                  )}

                  {finalVideoURL && <FinalComicVideo url={finalVideoURL} />}
                  {detailPage && <DetailPagePanel detailPage={detailPage} />}
                  {mediaTasks.length > 0 && !(detailPage && textOf(detailPage.long_image_url)) && <MediaTaskGrid tasks={mediaTasks} generationType={generationType} onMore={() => router.push("/app/works")} />}
                  {project.status === "failed" && (
                    <div className="rounded-2xl bg-red-50 border border-red-100 p-4 dark:bg-red-500/10 dark:border-red-400/20">
                      <p className="text-sm text-red-600 dark:text-red-300 mb-3">{project.error_message || t("workspace.generationFailed")}</p>
                      {code === "ecommerce_image" && detailPage?.status === "partial" && <p className="mb-3 text-xs leading-5 text-red-500 dark:text-red-200">{ts("已成功的详情模块会保留；重试只补生成失败或因参数变化而失效的模块。")}</p>}
                      <button onClick={retry} className="h-9 px-4 rounded-xl bg-gray-900 text-white text-sm flex items-center gap-1.5"><RefreshCw size={15} />{code === "ecommerce_image" && detailPage?.status === "partial" ? ts("仅重试未完成模块") : t("common.retry")}</button>
                    </div>
                  )}
                </div>
          </div>
          )}
        </div>
      </div>

      <div className="relative z-10 shrink-0 px-3 pb-2 pt-1 sm:px-6 sm:pb-3">
        <div className="mx-auto w-full max-w-[1040px]">
          {error && <p className="text-sm text-red-500 mb-2 px-1">{error}</p>}
          <div className="soft-input overflow-hidden">
            <div className="px-3 sm:px-4 py-2 border-b border-gray-50 dark:border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <ChatTopTools
                    value={bottom}
                    onChange={setBottom}
                    showUpload={false}
                    showRole={false}
                    referencePickMode
                    referenceImages={isVideoGeneration ? videoMedia.reference_images : code === "ecommerce_image" ? currentComicReferences() : productImage ? [productImage] : []}
                    onReferenceImagesChange={(imgs) => {
                      if (isVideoGeneration) {
                        setVideoMedia((prev) => ({ ...prev, reference_images: imgs }));
                      } else if (code === "ecommerce_image") {
                        setComicReferences(imgs);
                      } else {
                        setProductImage(imgs[0] || null);
                      }
                    }}
                    maxReferenceImages={code === "ecommerce_image" ? 8 : supportMultipleReferences ? (isVideoGeneration ? maxVideoAssetRefs : 6) : 1}
                  />
                  {(enableStepConfirm || canUseAutopilot) && (
                    <div className="flex items-center bg-gray-100 rounded-xl p-0.5 dark:bg-white/10">
                      {enableStepConfirm && (
                        <button
                          onClick={() => setMode("step")}
                          className={
                            "px-3 py-1.5 rounded-lg text-xs font-medium transition " +
                            (mode === "step" ? "bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-white" : "text-gray-500 dark:text-gray-400")
                          }
                        >
                          {modeLabels[0]}
                        </button>
                      )}
                      {canUseAutopilot && (
                        <button
                          onClick={() => setMode("auto")}
                          className={
                            "px-3 py-1.5 rounded-lg text-xs font-medium transition " +
                            (mode === "auto" ? "bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-white" : "text-gray-500 dark:text-gray-400")
                          }
                        >
                          {modeLabels[1]}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {selectedScene === "auto" && <p className="hidden min-w-0 flex-1 px-3 text-center text-xs text-gray-500 lg:block">{ts("AI按描述识别出图类型；详情页按模块数生成，其余按图片数量生成。")}</p>}
                <div className="flex items-center gap-2">
                  {isComicDrama && (
                    <button onClick={() => setSettingsOpen(true)} className="h-9 px-3 rounded-xl bg-gray-50 border border-gray-100 text-gray-600 text-sm flex items-center gap-1.5 hover:bg-white transition dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10">
                      <Settings2 size={15} />{ts("偏好设置")}
                    </button>
                  )}
                  <button onClick={() => setHelpOpen(true)} className="h-9 px-3 rounded-xl bg-gray-50 border border-gray-100 text-gray-600 text-sm flex items-center gap-1.5 hover:bg-white transition dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"><HelpCircle size={15} />{t("agent.help")}</button>
                </div>
              </div>
            </div>
            {!usesInlineReferenceInput && supportReferenceImage && <div className="px-3 pt-3 sm:px-4">
              {isVideoGeneration && generationModel ? (
                <VideoUploadArea config={videoConfig} media={videoMedia} onChange={setVideoMedia} />
              ) : (
                <div className="scroll-x-only flex flex-nowrap items-center gap-2 h-16 min-w-0">
                  {productImage ? (
                    <div className="group/img relative w-16 h-16 rounded-2xl overflow-hidden border-2 border-white shadow-lg bg-gray-100 shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <Image src={productImage.url} alt={productImage.name} width={128} height={128} sizes="64px" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => setProductImage(null)} className="absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition" title={t("common.remove")}>
                        <X size={12} />
                      </button>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-1 text-[10px] text-white opacity-0 group-hover/img:opacity-100 transition whitespace-nowrap truncate">
                        {productImage.name}
                      </div>
                    </div>
                  ) : (
                    <label className="relative w-20 h-16 rounded-2xl border border-dashed border-gray-200 bg-white shadow-sm flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition shrink-0 dark:bg-white/5 dark:border-white/10 dark:hover:bg-primary/10">
                      {uploading ? <Loader2 size={18} className="animate-spin text-primary" /> : <Plus size={18} className="text-gray-400 dark:text-gray-300" />}
                      <span className="text-[10px] text-gray-400 dark:text-gray-300 text-center leading-tight px-1">{uploading ? t("common.uploading") : t("asset.uploadImage")}</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(e) => { handleUpload(e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                  )}
                </div>
              )}
            </div>}

            <div className="relative flex min-w-0 items-start">
              {code === "ecommerce_image" && supportReferenceImage && <div className="scroll-x-only flex max-w-[52%] shrink-0 items-center gap-2 overflow-x-auto py-3 pl-3 pr-1">
                {currentComicReferences().map((item,index) => <div key={item.url} title={item.name || `${ts("商品参考")} ${index+1}`} className="group/img relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm dark:border-white/10 dark:bg-white/5"><Image src={item.url} alt={item.name || `商品参考 ${index+1}`} width={128} height={128} sizes="64px" className="h-full w-full object-cover" /><span className="absolute inset-x-0 bottom-0 bg-black/65 py-0.5 text-center text-[9px] leading-4 text-white">{index === 0 ? ts("主体") : index+1}</span><button type="button" aria-label={`${ts("移除参考图")} ${index+1}`} onClick={() => setComicReferences(currentComicReferences().filter(x => x.url !== item.url))} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-90 transition sm:opacity-0 sm:group-hover/img:opacity-100"><X size={11}/></button></div>)}
                {currentComicReferences().length < 8 && <label title={ts("上传商品参考图，首图作为主体参考")} className="flex h-16 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-500 shadow-sm transition hover:border-primary/50 hover:bg-primary/5 dark:border-white/15 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-primary/10">{uploading ? <Loader2 size={18} className="animate-spin text-primary"/> : <Plus size={18}/>}<span className="text-[10px] leading-none">{ts("参考图")} {currentComicReferences().length}/8</span><input aria-label={ts("上传商品参考图")} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={e => {void handleComicUploads(e.target.files);e.target.value="";}}/></label>}
              </div>}
              {code === "general_image" && supportReferenceImage && <div className="flex shrink-0 items-center py-3 pl-3 pr-1">
                {productImage ? <div className="group/img relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm dark:border-white/10 dark:bg-white/5"><Image src={productImage.url} alt={productImage.name} width={128} height={128} sizes="64px" className="h-full w-full object-cover" /><button type="button" aria-label={t("common.remove")} onClick={() => setProductImage(null)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-90 transition sm:opacity-0 sm:group-hover/img:opacity-100"><X size={11}/></button></div> : <label title={t("asset.uploadImage")} className="flex h-16 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-500 shadow-sm transition hover:border-primary/50 hover:bg-primary/5 dark:border-white/15 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-primary/10">{uploading ? <Loader2 size={18} className="animate-spin text-primary"/> : <Plus size={18}/>}<span className="px-1 text-center text-[10px] leading-none">{t("asset.uploadImage")}</span><input aria-label={t("asset.uploadImage")} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={e => {handleUpload(e.target.files?.[0]);e.target.value="";}}/></label>}
              </div>}
              {code === "ecommerce_video" && supportReferenceImage && isVideoGeneration && generationModel && <div className="scroll-x-only max-h-[88px] max-w-[52%] shrink-0 overflow-auto py-3 pl-3 pr-1"><VideoUploadArea config={videoConfig} media={videoMedia} onChange={setVideoMedia} /></div>}
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={code === "ecommerce_image" ? ts("描述商品、真实卖点和出图需求；左侧可上传主体、背面、细节或包装参考图，首图作为主体，不同款式请分开生成。") : code === "ecommerce_video" ? ts("描述商品、真实卖点、目标平台和视频意图；左侧可按当前模型上传商品参考图、首尾帧、参考视频或音频。") : code === "general_image" ? ts("描述想生成的画面；左侧可上传参考图，并补充主体、构图、风格和光线要求。") : workflow ? td(`agent.${workflow.code}.input.placeholder`, display.input?.placeholder || t("agent.inputPlaceholder")) : (display.input?.placeholder || t("agent.inputPlaceholder"))} rows={3} className="min-h-[88px] min-w-0 flex-1 resize-none bg-transparent px-4 pb-10 pt-3 pr-14 text-sm text-gray-700 focus:outline-none placeholder:text-gray-400 leading-relaxed dark:text-gray-100 dark:placeholder:text-gray-500" />
              {usesCompactCommerceInput && <button type="button" onClick={() => void enhanceCommercePrompt()} disabled={!prompt.trim() || promptEnhancing} aria-label={ts("增强提示词")} title={ts(`按当前${selectedSceneMeta.label}场景增强提示词`)} className="absolute bottom-2 right-3 flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:border-primary/50 hover:bg-primary/10 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/15 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-primary/15 dark:hover:text-white">
                {promptEnhancing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              </button>}
            </div>
            <div className="px-3 sm:px-4 py-3 border-t border-gray-50 dark:border-white/10 flex items-center gap-2">
              <div className="scroll-x-only flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto pb-1">
                {code === "ecommerce_image" && <MediaOptionMenu icon={<Settings2 size={14}/>} title={ts("电商设置")} subtitle={ts("设置发布渠道、目标受众和视觉风格")} activeLabel={ts("设置")} menuWidth={320} compactOnMobile>
                  {close => <div className="space-y-3">
                    {([
                      {key:"channel", label:"渠道", options:["淘宝 / 天猫","京东","拼多多","抖音电商","小红书","亚马逊","Shopify / 独立站"]},
                      {key:"audience", label:"受众", options:["大众日常","学生青年","都市通勤","家庭生活","亲子家庭","户外运动","品质消费","礼赠人群"]},
                      {key:"visual", label:"视觉风格", options:["简约白底","自然生活","高级质感","清新柔和","科技未来","国风雅致","复古胶片","活力撞色"]},
                    ] as const).map(setting => <div key={setting.key} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
                      <span className="mb-1.5 block px-1 text-xs font-medium text-gray-500 dark:text-gray-400">{ts(setting.label)}</span>
                      <div className="min-w-0 [&>button]:w-full [&>button]:justify-between">
                        <MediaOptionMenu icon={<Settings2 size={14}/>} title={ts(setting.label)} subtitle={ts("选择常用选项，其他要求可写在输入框中")} activeLabel={commerceBrief[setting.key] || ts("自动 · 按输入内容")} menuWidth={280}>
                          {closeSetting => <div className="space-y-1">
                            <MediaMenuOption selected={!commerceBrief[setting.key]} onClick={() => {setCommerceBrief(v => ({...v,[setting.key]:""}));closeSetting();}}>{ts("自动 · 按输入内容")}</MediaMenuOption>
                            {setting.options.map(option => <MediaMenuOption key={option} selected={commerceBrief[setting.key] === option} onClick={() => {setCommerceBrief(v => ({...v,[setting.key]:option}));closeSetting();}}>{ts(option)}</MediaMenuOption>)}
                          </div>}
                        </MediaOptionMenu>
                      </div>
                    </div>)}
                    <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-1 pt-3 dark:border-white/10">
                      <span className="text-[11px] text-gray-400">{ts("其他要求可直接写在输入框中")}</span>
                      <button type="button" onClick={close} className="h-8 shrink-0 rounded-lg bg-primary px-4 text-xs font-semibold text-gray-950">{ts("完成")}</button>
                    </div>
                  </div>}
                </MediaOptionMenu>}
                {isComicDrama ? (
                  <ComicSettingsSummary settings={comicSettings} onOpen={() => setSettingsOpen(true)} />
                ) : (
                  <SceneOptionMenu scenes={outputScenes} value={selectedScene} onChange={setSelectedScene} />
                )}
                {isVideoGeneration && generationModel ? (
                  <>
                    <VideoOptionToolbar schema={generationModel.input_schema} values={params} onChange={setParams} videoConfig={videoConfig} countUnit={t("unit.video")} />
                    <GenerationLanguageMenu languages={generationLanguages} value={languageCode} onChange={setLanguageCode} />
                  </>
                ) : (
                  <>
                    {(isDetailPageScene || selectedScene === "auto") && <MediaOptionMenu icon={<Settings2 size={14}/>} title={ts("详情页模块数")} activeLabel={`${detailSectionCount} ${ts("个模块")}`} subtitle={ts("默认5个：首屏、购买理由、细节、场景、收尾")} compactOnMobile>
                      {close => <div className="space-y-1">{[4,5,6,7,8].map(n => <MediaMenuOption key={n} selected={detailSectionCount === n} onClick={() => {setDetailSectionCount(n);close();}}>{n} {ts("个模块")}{n === 5 ? ` · ${ts("推荐")}` : ""}</MediaMenuOption>)}<p className="px-2 pt-2 text-[11px] leading-5 text-gray-400">{ts("生成前先确认五个模块；规格、多色与包装仅在参考资料明确提供时使用。每个模块自动排版短文案并拼成长图。")}</p></div>}
                    </MediaOptionMenu>}
                    <ImageGenerationToolbar
                      count={count}
                      showCount={!isDetailPageScene}
                      onCountChange={setCount}
                      ratio={imageRatio}
                      onRatioChange={setImageRatio}
                      imageSize={imageSize}
                      onImageSizeChange={setImageSize}
                    />
                    <GenerationLanguageMenu languages={generationLanguages} value={languageCode} onChange={setLanguageCode} />
                  </>
                )}
              </div>
              <div className="shrink-0">
                <button onClick={run} disabled={submitting || project?.status === "running" || project?.status === "pending"} className="w-12 h-12 rounded-full bg-secondary text-white flex items-center justify-center hover:bg-secondary/90 disabled:opacity-40 transition shadow-md">
                  {submitting ? <Loader2 size={20} className="animate-spin" /> : <ArrowUp size={20} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {helpOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setHelpOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900 dark:border dark:border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold mb-2 text-gray-900 dark:text-white">{t("agent.help")}</div>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-7 whitespace-pre-wrap">{display.help || t("agent.helpDefault")}</p>
            <button onClick={() => setHelpOpen(false)} className="mt-4 h-10 px-4 rounded-xl bg-gray-900 text-white text-sm dark:bg-white dark:text-gray-950">{t("common.gotIt")}</button>
          </div>
        </div>
      )}
      {settingsOpen && isComicDrama && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" onClick={() => setSettingsOpen(false)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900 dark:border dark:border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-gray-900 dark:text-white">{ts("偏好设置")}</div>
                <div className="mt-0.5 text-xs text-gray-400">{ts("自定义 AI 漫剧创作偏好")}</div>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={16} /></button>
            </div>
            <div className="grid max-h-[68vh] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
              <ComicSettingCard title={ts("资产图风格参考")}>
                <Segmented value={comicSettings.style_reference_mode} options={[["image_reference", ts("附带风格参考图")], ["text_only", ts("仅文字描述")]]} onChange={(v) => setComicSettings((prev) => ({ ...prev, style_reference_mode: v }))} />
              </ComicSettingCard>
              <ComicSettingCard title={ts("分镜时长模式")}>
                <Segmented value={comicSettings.duration_mode} options={[["compact", ts("紧凑")], ["standard", ts("常规")], ["long", ts("超长")]]} onChange={(v) => setComicSettings((prev) => ({ ...prev, duration_mode: v }))} />
              </ComicSettingCard>
              <ComicSettingCard title={ts("分镜画宫格数")}>
                <Segmented value={String(comicSettings.storyboard_grid)} options={[["2", ts("2宫格")], ["4", ts("4宫格")], ["6", ts("6宫格")], ["9", ts("9宫格")]]} onChange={(v) => setComicSettings((prev) => ({ ...prev, storyboard_grid: Number(v) }))} />
              </ComicSettingCard>
              <ComicSettingCard title={ts("分镜图自动重试")}>
                <NumberRow label={ts("最大重试次数")} value={comicSettings.max_retry} min={0} max={5} onChange={(v) => setComicSettings((prev) => ({ ...prev, max_retry: v }))} />
                <NumberRow label={ts("资产一致性合格分")} value={comicSettings.asset_consistency_score} min={0} max={100} onChange={(v) => setComicSettings((prev) => ({ ...prev, asset_consistency_score: v }))} />
                <NumberRow label={ts("画面逻辑合格分")} value={comicSettings.logic_score} min={0} max={100} onChange={(v) => setComicSettings((prev) => ({ ...prev, logic_score: v }))} />
              </ComicSettingCard>
              <ComicSettingCard title={ts("图片模型")}>
                <ComicModelSelect models={comicImageModels} value={comicSettings.image_model_code} onChange={(value) => setComicSettings((prev) => ({ ...prev, image_model_code: value }))} emptyLabel={ts("请选择图片模型")} />
              </ComicSettingCard>
              <ComicSettingCard title={ts("视频模型")}>
                <ComicModelSelect models={comicVideoModels} value={comicSettings.video_model_code} onChange={(value) => setComicSettings((prev) => ({ ...prev, video_model_code: value }))} emptyLabel={ts("请选择视频模型")} />
                <div className="mt-2 text-[11px] text-gray-400">{ts("支持选择已启用的视频模型；每个分镜按所选模型生成并统一计费。")}</div>
              </ComicSettingCard>
              <ComicSettingCard title={ts("对话模型")}>
                <input className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-white" value={comicSettings.dialogue_model_codes.join(",")} onChange={(e) => setComicSettings((prev) => ({ ...prev, dialogue_model_codes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))} placeholder="chat_demo_v1" />
                <div className="mt-2 text-[11px] text-gray-400">{ts("多个模型用英文逗号分隔，首个为主模型。")}</div>
              </ComicSettingCard>
            </div>
            <button onClick={() => setSettingsOpen(false)} className="mt-4 h-11 w-full rounded-xl bg-secondary text-sm font-semibold text-white">{ts("保存设置")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LegacyAgentLanding({
  workflowIcon,
  workflowName,
  workflowDescription,
  heroTags,
  features,
  activeIndex,
  onSelect,
  theme,
  generationType,
}: {
  workflowIcon: string;
  workflowName: string;
  workflowDescription: string;
  heroTags: string[];
  features: DisplayStep[];
  activeIndex: number;
  onSelect: (index: number) => void;
  theme: { gradient: string; iconBg: string; pill: string; accent: string };
  generationType: "image" | "video";
}) {
  const { ts } = useI18n();
  const safeFeatures = features.length
    ? features
    : [
        { icon: "🔍", title: ts("智能分析"), subtitle: ts("理解你的创作意图与商品卖点") },
        { icon: "✅", title: ts("方案确认"), subtitle: ts("生成前可确认提示词和创作方向") },
        { icon: generationType === "video" ? "🎬" : "🖼️", title: generationType === "video" ? ts("视频生成") : ts("图片生成"), subtitle: ts("按选定场景输出可用素材") },
      ];
  const active = safeFeatures[Math.min(activeIndex, safeFeatures.length - 1)] || safeFeatures[0];
  const activeTags = active.tags?.length ? active.tags : heroTags.slice(0, 4);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-2">
      <div className="shrink-0 pt-1 text-center sm:pt-3 lg:pt-4">
        <div className={"mb-1.5 inline-flex items-center gap-2 rounded-full border border-white/60 px-3 py-1 text-[11px] font-semibold backdrop-blur dark:border-white/10 sm:px-4 sm:text-xs " + theme.pill}>
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
          {generationType === "video" ? ts("视频智能体") : ts("图片智能体")}
        </div>
        <div className="flex items-center justify-center gap-3">
          <div className={"flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl text-xl shadow-sm sm:h-11 sm:w-11 sm:text-2xl " + theme.iconBg}><AgentIcon value={workflowIcon} alt={workflowName} /></div>
          <h1 title={workflowName} className="max-w-[min(78vw,960px)] truncate text-xl font-black tracking-normal text-gray-900 dark:text-white sm:text-3xl">{workflowName}</h1>
        </div>
        {workflowDescription && <p className="mx-auto mt-2 max-w-2xl px-3 text-xs leading-5 text-gray-500 dark:text-gray-300 sm:text-sm">{workflowDescription}</p>}
        <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:mt-3 sm:gap-2">
          {heroTags.map((tag) => (
            <span key={tag} title={tag} className="max-w-[180px] truncate rounded-full border border-gray-200 bg-white/55 px-2.5 py-0.5 text-[11px] text-gray-500 backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-gray-300 sm:px-3 sm:py-1 sm:text-xs">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="agent-showcase min-h-0 flex-1 items-center pt-4 sm:pt-5 lg:pt-5">
        <div className="agent-feature-list mx-auto w-full max-w-[300px] gap-3">
          {safeFeatures.slice(0, 4).map((item, idx) => {
            const selected = activeIndex === idx;
            return (
              <button
                key={item.title + idx}
                type="button"
                onClick={() => onSelect(idx)}
                className={
                  "group w-full min-w-0 max-w-full overflow-hidden box-border rounded-2xl border p-4 text-left backdrop-blur transition duration-300 hover:-translate-y-1 hover:scale-[1.015] hover:shadow-xl hover:shadow-cyan-950/10 active:scale-[0.99] dark:hover:shadow-black/30 " +
                  (selected ? "border-cyan-300 bg-white/75 shadow-lg shadow-cyan-950/5 dark:border-cyan-400/40 dark:bg-white/10" : "border-gray-200 bg-white/55 hover:border-cyan-200 hover:bg-white/70 dark:border-white/10 dark:bg-transparent dark:hover:border-cyan-400/25 dark:hover:bg-cyan-400/5")
                }
              >
                <div className="flex items-center gap-3">
                  <div className={"flex h-10 w-10 items-center justify-center rounded-xl text-lg transition duration-300 group-hover:rotate-3 group-hover:scale-110 " + (selected ? theme.iconBg : "bg-gray-500/10 text-gray-400 dark:bg-transparent dark:text-gray-300")}>
                    {item.icon || "•"}
                  </div>
                  <div className="min-w-0">
                    <div title={item.title} className="truncate text-sm font-bold text-gray-900 dark:text-white">{item.title}</div>
                    {item.subtitle && <div title={item.subtitle} className="mt-1 truncate text-xs text-gray-400">{item.subtitle}</div>}
                  </div>
                  {selected ? <span className="ml-auto text-cyan-500">›</span> : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="agent-feature-card group mx-auto flex max-h-[330px] min-h-[260px] w-full max-w-[640px] flex-col justify-center overflow-y-auto rounded-3xl border border-cyan-300/70 bg-white/65 p-4 shadow-xl shadow-cyan-950/10 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:bg-white/75 hover:shadow-2xl hover:shadow-cyan-950/15 dark:border-cyan-400/30 dark:bg-transparent dark:shadow-black/30 dark:hover:bg-cyan-400/[0.04] sm:min-h-[300px] sm:p-6 lg:max-h-none lg:min-h-[330px] lg:p-7">
          <div className="mb-4 flex items-center justify-between gap-3 lg:mb-5">
            <span className="rounded-xl bg-cyan-500/10 px-3 py-2 text-sm font-black text-cyan-700 dark:text-cyan-200">{String(Math.min(activeIndex + 1, safeFeatures.length)).padStart(2, "0")}</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
              {generationType === "video" ? ts("支持视频生成链路") : ts("支持图片生成链路")}
            </span>
          </div>
          <div className="flex items-start gap-4 lg:gap-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-cyan-500/10 text-2xl text-cyan-600 transition duration-300 group-hover:rotate-3 group-hover:scale-110 dark:text-cyan-200 sm:h-14 sm:w-14 lg:h-16 lg:w-16">
              <AgentIcon value={active.icon || workflowIcon} fallback={workflowIcon} alt={active.title} />
            </div>
            <div className="min-w-0">
              <h2 title={active.title} className="line-clamp-2 text-lg font-black tracking-normal text-gray-900 dark:text-white sm:text-xl lg:text-2xl">{active.title}</h2>
              <p title={active.subtitle || undefined} className="mt-2 line-clamp-3 max-w-[470px] text-xs leading-6 text-gray-500 dark:text-gray-300 sm:text-sm lg:mt-4 lg:leading-7">
                {active.subtitle || ts("输入商品、素材或创意需求，系统会自动理解目标场景、生成策略和输出参数。")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 lg:mt-5">
                {activeTags.map((tag) => (
                  <span key={tag} title={tag} className="max-w-[170px] truncate rounded-lg bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-700 dark:text-cyan-200">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-center gap-2 lg:mt-5">
            {safeFeatures.slice(0, 4).map((feature, idx) => (
              <button
                key={feature.title + idx}
                type="button"
                onClick={() => onSelect(idx)}
                aria-label={`${ts("切换到")} ${feature.title}`}
                className={(idx === activeIndex ? "h-3 w-9 bg-cyan-500 shadow-md shadow-cyan-500/30" : "h-3 w-3 bg-gray-300/70 hover:bg-cyan-300 dark:bg-white/20 dark:hover:bg-cyan-300/70") + " rounded-full transition-all duration-300 hover:scale-125"}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
void LegacyAgentLanding;

function SceneOptionMenu({ scenes, value, onChange }: { scenes: string[]; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const active = IMAGE_SCENES.find((item) => item.code === value) || IMAGE_SCENES[0];
  const labelOf = (code: string, fallback: string) => {
    const key = `agent.scene.${code}`;
    const value = t(key);
    return value === key ? fallback : value;
  };
  return (
    <MediaOptionMenu icon={<Wand2 size={16} />} activeLabel={labelOf(active.code, active.label)} title={t("agent.scene")} subtitle={t("agent.sceneDesc")} compactOnMobile>
      {(close) => (
        <div className="space-y-2">
          {scenes.map((code) => {
            const scene = IMAGE_SCENES.find((item) => item.code === code) || IMAGE_SCENES[0];
            return (
              <MediaMenuOption
                key={scene.code}
                selected={value === scene.code}
                onClick={() => {
                  onChange(scene.code);
                  close();
                }}
              >
                {labelOf(scene.code, scene.label)}
              </MediaMenuOption>
            );
          })}
        </div>
      )}
    </MediaOptionMenu>
  );
}

function ComicFeatureSelector({ features, activeIndex, onSelect }: { features: DisplayStep[]; activeIndex: number; onSelect: (index: number) => void }) {
  return (
    <div className="agent-feature-list mx-auto w-full max-w-[300px] gap-3">
      {features.map((item, idx) => {
        const active = activeIndex === idx;
        return (
        <button key={item.title} type="button" onClick={() => onSelect(idx)} className={"group w-full min-w-0 max-w-full overflow-hidden box-border rounded-2xl border p-4 text-left backdrop-blur transition duration-300 hover:-translate-y-1 hover:scale-[1.015] hover:shadow-xl hover:shadow-cyan-950/10 active:scale-[0.99] dark:hover:shadow-black/30 " + (active ? "border-cyan-300 bg-white/75 shadow-lg shadow-cyan-950/5 dark:border-cyan-400/40 dark:bg-white/10" : "border-gray-200 bg-white/55 hover:border-cyan-200 hover:bg-white/70 dark:border-white/10 dark:bg-transparent dark:hover:border-cyan-400/25 dark:hover:bg-cyan-400/5")}>
          <div className="flex items-center gap-3">
            <div className={"flex h-10 w-10 items-center justify-center rounded-xl text-lg transition duration-300 group-hover:rotate-3 group-hover:scale-110 " + (active ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-200" : "bg-gray-500/10 text-gray-400 dark:bg-transparent dark:text-gray-300")}>
              {item.icon || "•"}
            </div>
            <div className="min-w-0">
              <div title={item.title} className="truncate text-sm font-bold text-gray-900 dark:text-white">{item.title}</div>
              {item.subtitle ? <div title={item.subtitle} className="mt-1 truncate text-xs text-gray-400">{item.subtitle}</div> : null}
            </div>
            {active ? <span className="ml-auto text-cyan-500">›</span> : null}
          </div>
        </button>
        );
      })}
    </div>
  );
}

function ComicFeatureHero({ features, activeIndex, onSelect }: { features: DisplayStep[]; activeIndex: number; onSelect: (index: number) => void }) {
  const { t } = useI18n();
  const item = features[activeIndex] || features[0];
  if (!item) return null;
  return (
    <div className="comic-feature-card group mx-auto flex w-full max-w-[640px] flex-col overflow-hidden rounded-3xl border border-cyan-300/70 bg-white/65 p-4 shadow-xl shadow-cyan-950/10 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:bg-white/75 hover:shadow-2xl hover:shadow-cyan-950/15 dark:border-cyan-400/30 dark:bg-transparent dark:shadow-black/30 dark:hover:bg-cyan-400/[0.04] sm:p-5 lg:p-6">
      <div className="mb-4 flex items-center justify-between lg:mb-5">
        <span className="rounded-xl bg-cyan-500/10 px-3 py-2 text-sm font-black text-cyan-700 dark:text-cyan-200">{String(activeIndex + 1).padStart(2, "0")}</span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">{item.tags?.[0] || t("comic.tagControl")}</span>
      </div>
      <div className="flex items-start gap-4 lg:gap-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10 text-2xl text-cyan-600 transition duration-300 group-hover:rotate-3 group-hover:scale-110 dark:text-cyan-200 sm:h-14 sm:w-14 lg:h-16 lg:w-16">
          {item.icon || "•"}
        </div>
        <div>
          <h2 title={item.title} className="line-clamp-2 text-lg font-black tracking-normal text-gray-900 dark:text-white sm:text-xl lg:text-2xl">{item.title}</h2>
          {item.subtitle ? <p title={item.subtitle} className="mt-2 line-clamp-3 max-w-[460px] text-xs leading-6 text-gray-500 dark:text-gray-300 sm:text-sm lg:mt-4 lg:leading-7">{item.subtitle}</p> : null}
          {item.tags?.length ? <div className="mt-3 flex flex-wrap gap-2 lg:mt-5">
            {item.tags.map((tag) => (
              <span key={tag} title={tag} className="max-w-[170px] truncate rounded-lg bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-700 dark:text-cyan-200">{tag}</span>
            ))}
          </div> : null}
        </div>
      </div>
      <div className="mt-auto flex justify-center gap-2 pt-4 lg:pt-5">
        {features.map((feature, idx) => (
          <button
            key={feature.title}
            type="button"
            onClick={() => onSelect(idx)}
            aria-label={`${t("common.select")} ${feature.title}`}
            className={(idx === activeIndex ? "h-3 w-9 bg-cyan-500 shadow-md shadow-cyan-500/30" : "h-3 w-3 bg-gray-300/70 hover:bg-cyan-300 dark:bg-white/20 dark:hover:bg-cyan-300/70") + " rounded-full transition-all duration-300 hover:scale-125"}
          />
        ))}
      </div>
    </div>
  );
}

function ComicTimeline({ nodes, mobileNodes, compact = false }: { nodes: string[]; mobileNodes?: string[]; compact?: boolean }) {
  const { t } = useI18n();
  const visibleNodes = nodes.filter(Boolean);
  const compactNodes = (mobileNodes?.filter(Boolean).length ? mobileNodes.filter(Boolean) : visibleNodes.slice(0, 4)).slice(0, 4);
  if (!visibleNodes.length) return null;
  const activeIndex = Math.min(visibleNodes.length - 1, Math.floor(visibleNodes.length / 2));
  const compactActiveIndex = Math.min(compactNodes.length - 1, Math.floor(compactNodes.length / 2));
  const tone = (idx: number) => idx < visibleNodes.length / 3 ? "cyan" : idx < visibleNodes.length * 2 / 3 ? "violet" : "amber";
  return (
    <div className={"mx-auto w-full max-w-7xl lg:mb-5 " + (compact ? "py-1" : "py-4")}>
      <div className="mb-2 hidden flex-wrap justify-center gap-2 text-[11px] font-semibold sm:flex lg:justify-around">
        <span className="rounded-full bg-cyan-500/10 px-3 py-1 text-cyan-700 dark:text-cyan-200">01 {t("comic.stageCreative")}</span>
        <span className="rounded-full bg-violet-500/10 px-3 py-1 text-violet-700 dark:text-violet-200">02 {t("comic.stageScript")}</span>
        <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-700 dark:text-amber-200">03 {t("comic.stageProduction")}</span>
      </div>
      <div className="relative grid grid-cols-4 gap-x-1 px-1 py-1 lg:hidden">
        <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-[13px] h-px bg-gradient-to-r from-cyan-400 via-violet-400 to-amber-400" />
        {compactNodes.map((node, idx) => (
          <div key={node} className="relative z-10 flex min-w-0 flex-col items-center justify-start gap-1">
            <span className={"h-6 w-6 rounded-full border-4 bg-white shadow-sm dark:bg-gray-950 " + (idx < 2 ? "border-cyan-400" : idx === 2 ? "border-violet-400" : "border-amber-400")} />
            <span title={node} className={"line-clamp-2 w-full px-0.5 text-center text-[9px] font-semibold leading-tight sm:text-[10px] " + (idx === compactActiveIndex ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-300")}>
              {node}
            </span>
          </div>
        ))}
      </div>
      <div className="relative hidden items-center justify-between gap-2 lg:flex">
        <div className="absolute left-4 right-4 top-3 h-px bg-gradient-to-r from-cyan-400 via-violet-400 to-amber-400" />
        {visibleNodes.map((node, idx) => (
          <div key={node} className="relative z-10 flex min-w-0 flex-1 flex-col items-center gap-2">
            <span className={"h-6 w-6 rounded-full border-4 bg-white dark:bg-gray-950 " + (tone(idx) === "cyan" ? "border-cyan-400" : tone(idx) === "violet" ? "border-violet-400" : "border-amber-400")} />
            <span title={node} className={"max-w-full truncate text-[11px] " + (idx === activeIndex ? "font-black text-gray-900 dark:text-white" : "text-gray-400")}>{node}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComicProjectModal({
  draft,
  selectedStyle,
  uploading,
  submitting,
  onChange,
  onUpload,
  onChooseCoverAsset,
  onChooseStyle,
  onClose,
  onCreate,
}: {
  draft: { cover_url: string; name: string; description: string; style_id: string; orientation: string; quality: string };
  selectedStyle?: ComicStyle;
  uploading: boolean;
  submitting: boolean;
  onChange: (next: any) => void;
  onUpload: (file?: File | null) => void;
  onChooseCoverAsset: () => void;
  onChooseStyle: () => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const { ts } = useI18n();
  const update = (patch: Partial<typeof draft>) => onChange((prev: typeof draft) => ({ ...prev, ...patch }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-200"><Folder size={22} /></div>
            <div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">{ts("新建项目")}</div>
              <div className="text-xs text-gray-400">{ts("创建一个新的漫剧项目")}</div>
            </div>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={18} /></button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto p-6">
          <label className="mx-auto flex h-36 w-64 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-400 hover:border-cyan-300 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5">
            {draft.cover_url ? <Image src={draft.cover_url} alt="" width={512} height={288} sizes="256px" className="h-full w-full rounded-2xl object-cover" /> : uploading ? <Loader2 className="animate-spin" /> : <><ImageIcon size={30} /><span>{ts("点击上传封面")}</span></>}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { onUpload(e.target.files?.[0]); e.currentTarget.value = ""; }} />
          </label>
          <button type="button" onClick={onChooseCoverAsset} className="mx-auto mb-5 mt-2 flex h-9 items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 text-xs font-semibold text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-400/10 dark:text-cyan-200"><Folder size={14} />{ts("从资产库选择封面")}</button>
          <div className="space-y-4">
            <label className="block text-sm text-gray-600 dark:text-gray-300">{ts("项目名称")} <span className="text-red-500">*</span><input value={draft.name} maxLength={100} onChange={(e) => update({ name: e.target.value })} placeholder={ts("请输入项目名称")} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-cyan-400 dark:border-white/10 dark:bg-white/5 dark:text-white" /></label>
            <label className="block text-sm text-gray-600 dark:text-gray-300">{ts("项目描述")}<textarea value={draft.description} maxLength={500} onChange={(e) => update({ description: e.target.value })} placeholder={ts("请输入项目描述（可选）")} className="mt-2 h-24 w-full resize-none rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-cyan-400 dark:border-white/10 dark:bg-white/5 dark:text-white" /></label>
            <button type="button" onClick={onChooseStyle} className="flex h-14 w-full items-center gap-3 rounded-xl border border-dashed border-orange-200 bg-orange-50/50 px-4 text-left text-sm text-gray-600 hover:bg-orange-50 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-gray-200">
              <Star size={20} className="text-orange-500" />
              {selectedStyle ? selectedStyle.name : ts("点击选择画面风格")}
            </button>
            <div>
              <div className="mb-2 text-sm text-gray-600 dark:text-gray-300">{ts("屏幕方向")}</div>
              <div className="grid grid-cols-2 gap-3">
                {[["landscape", ts("横屏")], ["portrait", ts("竖屏")]].map(([value, label]) => (
                  <button key={value} type="button" onClick={() => update({ orientation: value })} className={"rounded-xl border p-4 text-sm font-semibold " + (draft.orientation === value ? "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-400/40 dark:bg-cyan-400/10 dark:text-cyan-200" : "border-gray-200 text-gray-500 dark:border-white/10 dark:text-gray-300")}>{label}</button>
                ))}
              </div>
            </div>
            <select value={draft.quality} onChange={(e) => update({ quality: e.target.value })} className="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white">
              <option value="480P">480P</option><option value="720P">720P</option><option value="1080P">1080P</option>
            </select>
          </div>
        </div>
        <div className="flex justify-between border-t border-gray-100 p-5 dark:border-white/10">
          <button onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 dark:border-white/10 dark:text-gray-300">{ts("取消")}</button>
          <button onClick={onCreate} disabled={submitting} className="rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? ts("创建中...") : ts("创建项目")}</button>
        </div>
      </div>
    </div>
  );
}

function ComicStyleModal({ styles, selectedId, filter, onFilter, onSelect, onClose, onConfirm, onAdd, onDelete }: { styles: ComicStyle[]; selectedId: string; filter: "all" | "system" | "mine"; onFilter: (v: "all" | "system" | "mine") => void; onSelect: (id: string) => void; onClose: () => void; onConfirm: () => void; onAdd: (mode: "smart" | "manual") => void; onDelete: (style: ComicStyle) => void }) {
	const { t, ts } = useI18n();
  const [query, setQuery] = useState("");
  const originalStyleCategories: Record<string, string> = {
    cds_kr_comic: "动漫", cds_jp_anime: "动漫", cds_cn_ancient: "国风",
    cds_cyber: "幻想", cds_chibi_3d: "三维", cds_sketch: "动漫",
  };
  const visibleStyles = styles.filter(style => `${style.name} ${style.prompt}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-white/10">
          <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500"><Star size={21} /></div><div><div className="text-lg font-bold text-gray-900 dark:text-white">{ts("选择风格")}</div><div className="text-xs text-gray-400">{ts("为你的漫剧选择合适的画面风格")}</div></div></div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={18} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-4 dark:border-white/10">
          {([["all", ts("全部")], ["system", ts("系统风格")], ["mine", ts("我的风格")] ] as const).map(([value, label]) => <button key={value} onClick={() => onFilter(value)} className={"rounded-full px-4 py-2 text-sm " + (filter === value ? "bg-orange-50 text-orange-600 ring-1 ring-orange-200 dark:bg-orange-400/10 dark:text-orange-200" : "border border-gray-200 text-gray-500 dark:border-white/10 dark:text-gray-300")}>{label}</button>)}
          <div className="ml-auto flex gap-2"><button onClick={() => onAdd("smart")} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-600 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-200">{ts("新增风格 - 智能识别")}</button><button onClick={() => onAdd("manual")} className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-600 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-200">{ts("新增风格 - 手动添加")}</button></div>
        </div>
        <div className="px-5 pt-4"><input aria-label={ts("搜索风格")} placeholder={ts("搜索风格、类别或画面特征")} value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-orange-400 dark:border-white/10 dark:bg-white/5 dark:text-white" /></div>
        <div className="grid max-h-[56vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{visibleStyles.length === 0 && <p className="col-span-full py-8 text-center text-sm text-gray-400">{ts("没有匹配的风格，请尝试其他关键词")}</p>}
            {visibleStyles.map((style) => <div key={style.public_id} className="relative"><button onClick={() => onSelect(style.public_id)} className={"w-full overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition dark:bg-white/5 " + (selectedId === style.public_id ? "border-orange-300 ring-2 ring-orange-200 dark:border-orange-400/50" : "border-gray-200 hover:border-orange-200 dark:border-white/10")}><div className="aspect-[1.55] bg-gray-100 dark:bg-white/10">{style.source !== "system" && style.cover_url ? <Image src={style.cover_url} alt="" width={480} height={310} sizes="(max-width: 640px) 50vw, 25vw" className="h-full w-full object-cover" /> : <div className="flex h-full flex-col justify-center gap-2 bg-gradient-to-br from-slate-800 to-slate-950 p-4 text-white"><span className="text-[10px] tracking-widest text-orange-200">{ts(style.prompt.match(/^【(.+?)】/)?.[1] || originalStyleCategories[style.public_id] || (style.source === "system" ? "系统风格" : "自定义"))}</span><span className="text-lg font-semibold">{style.source === "system" ? ts(style.name) : style.name}</span><span className="line-clamp-3 text-[11px] leading-5 text-slate-300">{style.prompt.replace(/^【.+?】/, "").split("。")[0]}</span></div>}</div><div className="p-3"><div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{style.source === "system" ? ts(style.name) : style.name}</div><p title={style.prompt} className="mt-1 line-clamp-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">{style.prompt}</p><div className="mt-1 text-[11px] text-gray-400">{style.source === "system" ? ts("系统") : ts("我的")}</div></div></button>{style.source !== "system" ? <button type="button" title={t("comic.deleteStyle")} onClick={() => onDelete(style)} className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-white hover:bg-red-500"><Trash2 size={13} /></button> : null}</div>)}
        </div>
        <div className="flex justify-between border-t border-gray-100 p-5 dark:border-white/10"><span className="text-sm text-gray-400">{selectedId ? ts("已选择风格") : ts("尚未选择风格")}</span><div className="flex gap-2"><button onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 dark:border-white/10 dark:text-gray-300">{ts("取消")}</button><button onClick={onConfirm} className="rounded-xl bg-orange-400 px-5 py-2 text-sm font-semibold text-white">{ts("确认选择")}</button></div></div>
      </div>
    </div>
  );
}

function ComicStyleAddModal({ mode, draft, uploading, submitting, onChange, onUpload, onChooseCoverAsset, onClose, onSave }: { mode: "manual" | "smart"; draft: { cover_url: string; name: string; prompt: string }; uploading: boolean; submitting: boolean; onChange: (next: any) => void; onUpload: (file?: File | null) => void; onChooseCoverAsset: () => void; onClose: () => void; onSave: () => void }) {
  const { ts } = useI18n();
  const update = (patch: Partial<typeof draft>) => onChange((prev: typeof draft) => ({ ...prev, ...patch }));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-white/10"><div className="text-lg font-bold text-gray-900 dark:text-white">{ts("新增风格")}</div><button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={18} /></button></div>
        <div className="space-y-4 p-6">
          <label className="block text-sm text-gray-600 dark:text-gray-300">{ts("参考图")} <span className="text-red-500">*</span><div className="mt-2 flex h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 text-gray-400 dark:border-white/10 dark:bg-white/5">{draft.cover_url ? <Image src={draft.cover_url} alt="" width={640} height={384} sizes="512px" className="h-full w-full rounded-2xl object-cover" /> : uploading ? <Loader2 className="animate-spin" /> : <><Plus size={28} /><span>{ts("点击选择图片")}</span></>}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { onUpload(e.target.files?.[0]); e.currentTarget.value = ""; }} /></div></label>
          <button type="button" onClick={onChooseCoverAsset} className="flex h-9 items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 text-xs font-semibold text-orange-700 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-200"><Folder size={14} />{ts("从资产库选择参考图")}</button>
          <label className="block text-sm text-gray-600 dark:text-gray-300">{ts("风格名称")} <input value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder={ts("给这个风格起个名字")} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-orange-300 dark:border-white/10 dark:bg-white/5 dark:text-white" /></label>
          <label className="block text-sm text-gray-600 dark:text-gray-300">{ts("风格提示词")} <textarea value={draft.prompt} onChange={(e) => update({ prompt: e.target.value })} placeholder={mode === "smart" ? ts("可留空，系统会根据参考图生成基础风格说明") : ts("例如：动漫风格，新海诚画风，赛璐璐上色...")} className="mt-2 h-28 w-full resize-none rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-orange-300 dark:border-white/10 dark:bg-white/5 dark:text-white" /></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 p-5 dark:border-white/10"><button onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 dark:border-white/10 dark:text-gray-300">{ts("取消")}</button><button onClick={onSave} disabled={submitting} className="rounded-xl bg-orange-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? ts("保存中...") : ts("保存")}</button></div>
      </div>
    </div>
  );
}

function ComicImageLibraryModal({ target, items, selected, loading, onSelected, onClose, onConfirm }: { target: ComicLibraryTarget; items: LibraryImageAsset[]; selected: ReferenceImage[]; loading: boolean; onSelected: (items: ReferenceImage[]) => void; onClose: () => void; onConfirm: () => void }) {
  const { ts, td } = useI18n();
  const multiple = target === "references";
  const max = multiple ? 8 : 1;
  const toggle = (asset: LibraryImageAsset) => {
    const item = { url: asset.url, name: asset.name || asset.public_id, public_id: asset.public_id };
    if (!multiple) {
      onSelected([item]);
      return;
    }
    const exists = selected.some((entry) => entry.url === item.url);
    onSelected(exists ? selected.filter((entry) => entry.url !== item.url) : [...selected, item].slice(0, max));
  };
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-white/10"><div><div className="text-lg font-bold text-gray-900 dark:text-white">{ts("从资产库选择图片")}</div><div className="mt-1 text-xs text-gray-400">{multiple ? td("comic.library.maxSelection", "可选择最多 {max} 张角色、道具或场景参考图", { max }) : ts("选择一张图片作为项目封面或风格参考")}</div></div><button type="button" onClick={onClose} className="rounded-xl bg-gray-100 p-2 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={18} /></button></div>
        <div className="max-h-[62vh] min-h-[320px] overflow-y-auto p-5">
          {loading ? <div className="flex h-72 items-center justify-center text-cyan-500"><Loader2 className="animate-spin" /></div> : items.length === 0 ? <div className="flex h-72 flex-col items-center justify-center gap-3 text-gray-400"><ImageIcon size={36} /><span>{ts("资产库暂无图片")}</span></div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">{items.map((asset) => { const active = selected.some((entry) => entry.url === asset.url); return <button key={asset.public_id} type="button" onClick={() => toggle(asset)} className={`overflow-hidden rounded-2xl border text-left transition ${active ? "border-cyan-400 ring-2 ring-cyan-300/40" : "border-gray-100 hover:border-cyan-200 dark:border-white/10"}`}><div className="relative aspect-square bg-gray-100 dark:bg-white/5"><img loading="lazy" decoding="async" src={asset.url} alt={asset.name || ""} className="h-full w-full object-cover" />{active ? <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500 text-white"><Check size={14} /></span> : null}</div><div className="truncate px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200">{asset.name || asset.public_id}</div></button>; })}</div>}
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 p-5 dark:border-white/10"><span className="text-sm text-gray-400">{td("comic.library.selectedCount", "已选择 {count}/{max}", { count: selected.length, max })}</span><div className="flex gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 dark:border-white/10 dark:text-gray-300">{ts("取消")}</button><button type="button" disabled={selected.length === 0} onClick={onConfirm} className="rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{ts("确认选择")}</button></div></div>
      </div>
    </div>
  );
}

function ComicAssetModal({ projectId, items, onClose, onChanged }: { projectId: string; items: ComicAsset[]; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const { t, ts } = useI18n();
  const [draft, setDraft] = useState({ asset_type: "character", asset_code: "", name: "", description: "", visual_prompt: "", reference_asset_ids: [] as string[], metadata: { reference_urls: [] as string[], reference_names: [] as string[] }, status: "locked" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryItems, setLibraryItems] = useState<LibraryImageAsset[]>([]);
  const [message, setMessage] = useState("");
  const assetReferences = draft.metadata.reference_urls.map((url, index) => ({ url, name: draft.metadata.reference_names[index] || `参考图 ${index + 1}`, public_id: draft.reference_asset_ids[index] }));
  const setReferences = (refs: ReferenceImage[]) => setDraft((prev) => ({ ...prev, reference_asset_ids: refs.map((item) => item.public_id).filter((id): id is string => !!id), metadata: { ...prev.metadata, reference_urls: refs.map((item) => item.url), reference_names: refs.map((item) => item.name) } }));
  const uploadReferences = async (files?: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setMessage("");
    try {
      const typeMap: Record<string, string> = { character: "role", prop: "prop", location: "scene" };
      const added: ReferenceImage[] = [];
      for (const file of Array.from(files).slice(0, Math.max(0, 8 - assetReferences.length))) {
        const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: typeMap[draft.asset_type] || "role" });
        added.push({ url: asset.url, name: asset.name || file.name, public_id: asset.public_id });
      }
      setReferences([...assetReferences, ...added]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("参考图上传失败"));
    } finally {
      setUploading(false);
    }
  };
  const openLibrary = async () => {
    setLibraryOpen(true);
    try {
      const result = await listAssets({ kind: "image", page: 1, page_size: 100 });
      setLibraryItems((result.items || []).filter((item) => item.url));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("资产库加载失败"));
    }
  };
  const save = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await api(`/api/comic-drama/projects/${projectId}/assets`, { method: "POST", body: JSON.stringify(draft) });
      setDraft((prev) => ({ ...prev, asset_code: "", name: "", description: "", visual_prompt: "", reference_asset_ids: [], metadata: { reference_urls: [], reference_names: [] } }));
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("comic.assetSaveFailed"));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (item: ComicAsset) => {
    if (!window.confirm(t("comic.confirmDeleteAsset", { name: item.name }))) return;
    await api(`/api/comic-drama/projects/${projectId}/assets/${item.public_id}`, { method: "DELETE" });
    await onChanged();
  };
  const labels: Record<string, string> = { character: t("comic.characters"), prop: t("comic.props"), location: t("comic.locations") };
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="grid max-h-[88vh] w-full max-w-5xl gap-4 overflow-hidden rounded-3xl bg-white p-5 shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900 md:grid-cols-[1.15fr_.85fr]" onClick={(event) => event.stopPropagation()}>
        <div className="min-h-0 overflow-y-auto">
          <div className="mb-3 flex items-center justify-between"><div><h3 className="text-lg font-bold text-gray-900 dark:text-white">{t("comic.assetLibrary")}</h3><p className="text-xs text-gray-400">{t("comic.assetLibraryHint")}</p></div><button type="button" onClick={onClose} className="rounded-xl bg-gray-100 p-2 text-gray-500 dark:bg-white/10"><X size={18} /></button></div>
          <div className="space-y-3">
            {["character", "prop", "location"].map((type) => {
              const grouped = items.filter((item) => item.asset_type === type);
              return <section key={type}><div className="mb-1.5 text-xs font-semibold text-gray-500">{labels[type]} · {grouped.length}</div><div className="grid gap-2 sm:grid-cols-2">{grouped.map((item) => { const cover = Array.isArray(item.metadata?.reference_urls) ? item.metadata.reference_urls[0] : ""; return <div key={item.public_id} className="rounded-xl border border-gray-100 p-3 dark:border-white/10"><div className="flex items-start gap-2">{cover ? <img loading="lazy" decoding="async" src={cover} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400 dark:bg-white/5"><ImageIcon size={17} /></div>}<div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.name}</div><div className="text-[10px] text-gray-400">{item.asset_code} · v{item.version} · {item.reference_asset_ids?.length || 0}  {ts("张参考图")}</div></div><button type="button" onClick={() => void remove(item)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-300">{item.visual_prompt || item.description}</p></div>; })}</div></section>;
            })}
          </div>
        </div>
        <div className="overflow-y-auto rounded-2xl bg-gray-50 p-4 dark:bg-white/5">
          <h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{t("comic.addAsset")}</h4>
          <div className="space-y-3">
            <select value={draft.asset_type} onChange={(event) => setDraft((prev) => ({ ...prev, asset_type: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950 dark:text-white"><option value="character">{labels.character}</option><option value="prop">{labels.prop}</option><option value="location">{labels.location}</option></select>
            <input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder={t("comic.assetName")} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950 dark:text-white" />
            <input value={draft.asset_code} onChange={(event) => setDraft((prev) => ({ ...prev, asset_code: event.target.value }))} placeholder={t("comic.assetCodeOptional")} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950 dark:text-white" />
            <textarea value={draft.description} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} placeholder={t("comic.assetDescription")} className="h-20 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950 dark:text-white" />
            <textarea value={draft.visual_prompt} onChange={(event) => setDraft((prev) => ({ ...prev, visual_prompt: event.target.value }))} placeholder={t("comic.assetVisualPrompt")} className="h-28 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-950 dark:text-white" />
            <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-gray-950">
              <div className="mb-2 flex items-center justify-between"><div><div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{ts("角色 / 道具 / 场景参考图")}</div><div className="text-[11px] text-gray-400">{ts("最多 8 张，将用于关键帧一致性生成")}</div></div><span className="text-xs text-gray-400">{assetReferences.length}/8</span></div>
              {assetReferences.length ? <div className="mb-3 grid grid-cols-4 gap-2">{assetReferences.map((item) => <div key={item.url} className="group relative aspect-square overflow-hidden rounded-lg bg-gray-100"><img loading="lazy" decoding="async" src={item.url} alt={item.name} className="h-full w-full object-cover" /><button type="button" onClick={() => setReferences(assetReferences.filter((entry) => entry.url !== item.url))} className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white group-hover:flex"><X size={12} /></button></div>)}</div> : null}
              <div className="grid grid-cols-2 gap-2"><label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-cyan-200 text-xs font-semibold text-cyan-700 dark:border-cyan-400/30 dark:text-cyan-200">{uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{ts("上传图片")}<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(event) => { void uploadReferences(event.target.files); event.currentTarget.value = ""; }} /></label><button type="button" onClick={() => void openLibrary()} className="flex h-9 items-center justify-center gap-2 rounded-lg border border-violet-200 text-xs font-semibold text-violet-700 dark:border-violet-400/30 dark:text-violet-200"><Folder size={14} />{ts("资产库")}</button></div>
            </div>
            {message && <p className="text-xs text-red-500">{message}</p>}
            <button type="button" disabled={saving || !draft.name.trim()} onClick={() => void save()} className="h-10 w-full rounded-xl bg-cyan-500 text-sm font-semibold text-white disabled:opacity-40">{saving ? t("common.saving") : t("common.save")}</button>
          </div>
        </div>
      </div>
      {libraryOpen ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4" onClick={() => setLibraryOpen(false)}><div className="w-full max-w-3xl rounded-3xl bg-white p-5 shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><div className="font-bold text-gray-900 dark:text-white">{ts("选择资产参考图")}</div><div className="text-xs text-gray-400">{ts("可多选，最多 8 张")}</div></div><button type="button" onClick={() => setLibraryOpen(false)} className="rounded-lg bg-gray-100 p-2 dark:bg-white/10"><X size={16} /></button></div><div className="grid max-h-[58vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">{libraryItems.map((asset) => { const active = assetReferences.some((item) => item.url === asset.url); return <button key={asset.public_id} type="button" onClick={() => setReferences(active ? assetReferences.filter((item) => item.url !== asset.url) : [...assetReferences, { url: asset.url, name: asset.name || asset.public_id, public_id: asset.public_id }].slice(0, 8))} className={`overflow-hidden rounded-xl border ${active ? "border-cyan-400 ring-2 ring-cyan-300/30" : "border-gray-100 dark:border-white/10"}`}><div className="relative aspect-square"><img loading="lazy" decoding="async" src={asset.url} alt="" className="h-full w-full object-cover" />{active ? <Check className="absolute right-2 top-2 rounded-full bg-cyan-500 p-1 text-white" size={22} /> : null}</div><div className="truncate p-2 text-left text-xs text-gray-700 dark:text-gray-200">{asset.name || asset.public_id}</div></button>; })}</div><button type="button" onClick={() => setLibraryOpen(false)} className="mt-4 h-10 w-full rounded-xl bg-cyan-500 text-sm font-semibold text-white">{ts("完成选择")}</button></div></div> : null}
    </div>
  );
}

function ComicPreferenceModal({
  settings,
  imageModels,
  videoModels,
  onChange,
  onClose,
}: {
  settings: any;
  imageModels: Model[];
  videoModels: Model[];
  onChange: (next: any) => void;
  onClose: () => void;
}) {
  const { ts } = useI18n();
  const set = (patch: Record<string, unknown>) => onChange((prev: any) => ({ ...prev, ...patch }));
  const selectedVideoModel = videoModels.find((item) => item.code === settings.video_model_code);
  const videoReferenceCompatible = modelSupportsImageReference(selectedVideoModel);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-3xl bg-white p-5 shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><div><div className="text-lg font-bold text-gray-900 dark:text-white">{ts("偏好设置")}</div><div className="text-xs text-gray-400">{ts("自定义你的漫剧创作偏好")}</div></div><button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={18} /></button></div>
        <div className="grid max-h-[68vh] gap-3 overflow-y-auto md:grid-cols-2">
          <ComicSettingCard title={ts("资产图风格参考")}><Segmented value={settings.style_reference_mode} options={[["image_reference", ts("附带风格参考图")], ["text_only", ts("仅文字描述")]]} onChange={(v) => set({ style_reference_mode: v })} /></ComicSettingCard>
          <ComicSettingCard title={ts("分镜时长模式")}><Segmented value={settings.duration_mode} options={[["compact", ts("紧凑")], ["standard", ts("常规")], ["long", ts("超长")]]} onChange={(v) => set({ duration_mode: v })} /></ComicSettingCard>
          <ComicSettingCard title={ts("配音叙事模式")}><Segmented value={settings.narration_perspective || "smart"} options={COMIC_NARRATION_MODES.map((item) => [item.value, ts(item.label)])} onChange={(v) => set({ narration_perspective: v })} /><div className="mt-2 text-[11px] leading-5 text-gray-400">{ts(COMIC_NARRATION_MODES.find((item) => item.value === settings.narration_perspective)?.description || COMIC_NARRATION_MODES[0].description)}</div></ComicSettingCard>
          <ComicSettingCard title={ts("分镜画宫格数")}><Segmented value={String(settings.storyboard_grid)} options={[["2", ts("2宫格")], ["4", ts("4宫格")], ["6", ts("6宫格")], ["9", ts("9宫格")]]} onChange={(v) => set({ storyboard_grid: Number(v) })} /></ComicSettingCard>
          <ComicSettingCard title={ts("自动重试")}><NumberRow label={ts("最大重试次数")} value={settings.max_retry} min={0} max={5} onChange={(v) => set({ max_retry: v })} /><NumberRow label={ts("资产一致性合格分")} value={settings.asset_consistency_score} min={0} max={100} onChange={(v) => set({ asset_consistency_score: v })} /><NumberRow label={ts("画面逻辑合格分")} value={settings.logic_score} min={0} max={100} onChange={(v) => set({ logic_score: v })} /></ComicSettingCard>
          <ComicSettingCard title={ts("图片模型")}><ComicModelSelect models={imageModels} value={settings.image_model_code} onChange={(value) => set({ image_model_code: value })} emptyLabel={ts("请选择图片模型")} /></ComicSettingCard>
          <ComicSettingCard title={ts("视频模型")}>
            <ComicModelSelect models={videoModels} value={settings.video_model_code} onChange={(value) => set({ video_model_code: value })} emptyLabel={ts("请选择视频模型")} />
            <div className={`mt-2 rounded-lg px-2.5 py-2 text-[11px] ${selectedVideoModel && !videoReferenceCompatible ? "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200" : "text-gray-400"}`}>{selectedVideoModel ? (videoReferenceCompatible ? ts("兼容：会自动把每个分镜关键帧作为图生视频参考。") : ts("不兼容：该模型未声明关键帧/参考图能力，运行前会要求更换模型。")) : ts("AI 漫剧应选择支持图生视频或关键帧参考的视频模型。")}</div>
          </ComicSettingCard>
        </div>
        <button onClick={onClose} className="mt-4 h-11 w-full rounded-xl bg-cyan-500 text-sm font-semibold text-white">{ts("保存设置")}</button>
      </div>
    </div>
  );
}

function ComicModelSelect({
  models,
  value,
  onChange,
  emptyLabel,
}: {
  models: Model[];
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
}) {
  const { ts } = useI18n();
  const currentExists = models.some((item) => item.code === value);
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-gray-950 dark:text-white"
    >
      <option value="">{emptyLabel}</option>
      {value && !currentExists && <option value={value}>{value}{ts("（当前配置）")}</option>}
      {models.map((model) => (
        <option key={model.code} value={model.code}>
          {model.display_name || model.code}
        </option>
      ))}
    </select>
  );
}

function ComicSettingsSummary({ settings, onOpen }: { settings: { duration_mode: string; storyboard_grid: number; max_retry: number; style_reference_mode: string }; onOpen: () => void }) {
  const { ts } = useI18n();
  const durationLabel: Record<string, string> = { compact: "紧凑", standard: "常规", long: "超长" };
  const styleLabel = settings.style_reference_mode === "text_only" ? "文字风格" : "参考图风格";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
    >
      <Settings2 size={15} className="text-gray-400" />
      <span>{styleLabel}</span>
      <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
      <span>{settings.storyboard_grid}{ts("宫格")}</span>
      <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
      <span>{durationLabel[settings.duration_mode] || "常规"}</span>
      <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
      <span>{ts("重试")} {settings.max_retry}</span>
    </button>
  );
}

function ComicProjectPanel({ project }: { project: Project }) {
  const { t, ts } = useI18n();
  const [showAllStoryboards, setShowAllStoryboards] = useState(false);
  const [showAllKeyframes, setShowAllKeyframes] = useState(false);
  const [showAllSegments, setShowAllSegments] = useState(false);
  const comic = (project.outputs?.comic_drama || {}) as Record<string, any>;
  const characters = Array.isArray(comic.characters) ? comic.characters : [];
  const props = Array.isArray(comic.props) ? comic.props : [];
  const locations = Array.isArray(comic.locations) ? comic.locations : [];
  const storyboards = Array.isArray(comic.storyboards) ? comic.storyboards : [];
  const keyframes = Array.isArray(project.outputs?.keyframes) ? project.outputs?.keyframes : Array.isArray(comic.keyframes) ? comic.keyframes : [];
  const segments = Array.isArray(project.outputs?.segments) ? project.outputs?.segments : Array.isArray(comic.segments) ? comic.segments : [];
  const total = Math.max(storyboards.length, keyframes.length, segments.length);
  const assetProgress = comicAssetProgress(project.outputs || {}, textOf(project.error_message));
  const completedKeyframes = keyframes.filter((item: any) => item.status !== "failed" && textOf(item.image_url)).length;
  const completedSegments = segments.filter((item: any) => item.status !== "failed" && textOf(item.video_url)).length;
  const failedItems = [...assetProgress.failed, ...keyframes, ...segments].filter((item: any) => item.status === "failed" || textOf(item.error_message));
  const currentStep = assetProgress.step || project.status;
  const stepLabels: Record<string, string> = {
    consistency_assets: "角色与场景定稿",
    keyframes_confirm: "关键帧待确认",
    storyboard_confirm: t("comic.stepStoryboard"),
    keyframes: t("comic.stepKeyframes"),
    video_segments: t("comic.stepSegments"),
    compose: t("comic.stepCompose"),
    result: t("comic.stepCompleted"),
    running: t("workspace.generating"),
    failed: t("workspace.generationFailed"),
  };
  const visibleStoryboards = showAllStoryboards ? storyboards : storyboards.slice(0, 6);
  const visibleKeyframes = showAllKeyframes ? keyframes : keyframes.slice(0, 6);
  const visibleSegments = showAllSegments ? segments : segments.slice(0, 6);
  if (!storyboards.length && !keyframes.length && !segments.length) return null;
  return (
    <div className="space-y-3 rounded-2xl border border-cyan-100 bg-cyan-50/40 p-4 dark:border-cyan-400/15 dark:bg-cyan-400/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{t("comic.workflowAssets")}</div>
          <div className="mt-0.5 text-xs text-gray-400">{t("comic.workflowAssetsHint")}</div>
        </div>
        <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 dark:text-cyan-200">{stepLabels[currentStep] || currentStep}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          [t("comic.storyboards"), storyboards.length, total],
          [t("资产定稿"), assetProgress.completed, assetProgress.total],
          [t("comic.keyframes"), completedKeyframes, total],
          [t("comic.videoSegments"), completedSegments, total],
        ].map(([label, value, maximum]) => (
          <div key={String(label)} className="rounded-xl border border-white bg-white/80 px-3 py-2 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-300"><span className="truncate">{String(label)}</span><b className="text-gray-800 dark:text-white">{Number(value)}/{Number(maximum)}</b></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"><div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${Number(maximum) ? Math.min(100, Number(value) / Number(maximum) * 100) : 0}%` }} /></div>
          </div>
        ))}
      </div>
      {currentStep === "consistency_assets" && <p className="text-xs leading-5 text-gray-500 dark:text-gray-300">{project.status === "failed" ? t("角色、道具或场景的定稿图生成失败，关键帧和视频片段尚未开始。分镜数量表示脚本已规划，并非图片已生成。") : t("正在生成角色、道具和场景的定稿图，完成后才开始生成关键帧与视频；当前无需确认分镜。")}</p>}
      {project.status === "failed" && <p className="text-xs leading-5 text-amber-700 dark:text-amber-200">{ts("重试将复用输入仍匹配的成功素材，仅补齐失败、缺失或因修改而失效的镜头。已完成素材可在下方预览。")}</p>}
      {Array.isArray(project.outputs?.media_history) && project.outputs.media_history.length > 0 && <details className="text-xs text-gray-500 dark:text-gray-300"><summary className="cursor-pointer">{ts("历史素材 ·")} {project.outputs.media_history.length}{ts("（保留供对比，不参与当前合成）")}</summary><div className="mt-2 flex flex-wrap gap-2">{project.outputs.media_history.map((entry: any, index: number) => { const url = textOf(entry.item?.image_url || entry.item?.video_url); return url ? <a key={index} href={url} target="_blank" rel="noreferrer" className="rounded-lg border px-2 py-1 text-cyan-600">{textOf(entry.item?.id)} · {entry.kind === "keyframes" ? t("关键帧") : t("视频")}  {ts("· 版本")} {index + 1}</a> : null; })}</div></details>}
      {(project.status === "running" || project.status === "pending") && <p role="status" className="text-xs leading-5 text-gray-500 dark:text-gray-300">{ts("正在执行：")}{stepLabels[currentStep] || currentStep}{ts("。已完成")} {completedKeyframes}  {ts("张关键帧、")}{completedSegments}  {ts("段视频，可边生成边预览。")}</p>}
      {failedItems.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200">
          <div className="font-semibold">{t("comic.partialFailure", { count: failedItems.length })}</div>
          <div className="mt-1 line-clamp-2">{textOf(failedItems[0]?.error_message || project.error_message)}</div>
        </div>
      )}
      {(characters.length > 0 || props.length > 0 || locations.length > 0) && (
        <div className="grid gap-2 sm:grid-cols-3">
          {[[t("comic.characters"), characters], [t("comic.props"), props], [t("comic.locations"), locations]].map(([label, items]) => (
            <div key={String(label)} className="rounded-xl border border-white bg-white/80 p-3 dark:border-white/10 dark:bg-white/5">
              <div className="mb-2 text-xs font-semibold text-gray-800 dark:text-gray-100">{String(label)} · {(items as any[]).length}</div>
              <div className="flex flex-wrap gap-1.5">
                {(items as any[]).slice(0, 8).map((item, index) => <span key={textOf(item.code || index)} title={textOf(item.description || item.visual_prompt)} className="max-w-full truncate rounded-full bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-700 dark:text-cyan-200">{textOf(item.name || item.code)}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
      {storyboards.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t("comic.storyboards")} · {storyboards.length}</h4>{storyboards.length > 6 && <button type="button" onClick={() => setShowAllStoryboards((value) => !value)} className="text-[11px] font-medium text-cyan-600 dark:text-cyan-300">{showAllStoryboards ? t("comic.collapse") : t("comic.showAll")}</button>}</div>
          <div className="grid gap-2 md:grid-cols-2">
          {visibleStoryboards.map((item: any, idx: number) => (
            <div key={textOf(item.id || idx)} className="rounded-xl border border-white bg-white/80 p-3 dark:border-white/10 dark:bg-white/5">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-lg bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-200">{textOf(item.id || `S${idx + 1}`)}</span>
                <span className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{textOf(item.title || `${t("comic.storyboard")} ${idx + 1}`)}</span>
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-300">{textOf(item.scene || item.video_prompt || item.keyframe_prompt)}</p>
              {item.source?.verified && textOf(item.source.text) ? <details className="mt-2 text-xs text-gray-500 dark:text-gray-300"><summary className="cursor-pointer">{ts("查看来源 ·")} {item.source.kind === "user_script" ? t("用户原文") : t("本次生成剧本")}</summary><p className="mt-2 whitespace-pre-wrap break-words leading-5">{textOf(item.source.text)}</p><p className="mt-1 text-[10px]">{ts("来源版本")} {textOf(item.source.hash).slice(0, 12)}  {ts("· 仅表示原文定位已校验，不代表画面已通过验收")}</p></details> : <p className="mt-2 text-[10px] text-gray-400">{ts("来源未校验（旧项目或无原文定位）")}</p>}
            </div>
          ))}
          </div>
        </section>
      )}
      {keyframes.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t("comic.keyframes")} · {completedKeyframes}/{total}</h4>{keyframes.length > 6 && <button type="button" onClick={() => setShowAllKeyframes((value) => !value)} className="text-[11px] font-medium text-cyan-600 dark:text-cyan-300">{showAllKeyframes ? t("comic.collapse") : t("comic.showAll")}</button>}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleKeyframes.map((item: any, idx: number) => {
            const failed = item.status === "failed" || !!textOf(item.error_message);
            return (
            <div key={textOf(item.id || idx)} className={`overflow-hidden rounded-xl border bg-white dark:bg-white/5 ${failed ? "border-red-200 dark:border-red-400/30" : "border-white dark:border-white/10"}`}>
              <div className="aspect-video bg-gray-100 dark:bg-gray-950">
                {textOf(item.image_url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={textOf(item.image_url)} alt={textOf(item.title || item.id || `${t("comic.keyframe")} ${idx + 1}`)} className="h-full w-full object-contain" loading="lazy" decoding="async" />
                ) : (
                  <div className={`flex h-full items-center justify-center px-3 text-center text-xs ${failed ? "text-red-500" : "text-gray-400"}`}>{failed ? textOf(item.error_message || t("workspace.generationFailed")) : t("comic.keyframeGenerating")}</div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{textOf(item.title || item.id || `${t("comic.keyframe")} ${idx + 1}`)}</span><span className="text-[10px] text-gray-500">{item.scores?.status === "passed" ? t("视觉检查通过") : item.scores?.checked ? t("需检查") : t("视觉未检查")}</span>
                {Number(item.retry_count || 0) > 0 && <span className="shrink-0 text-[10px] text-amber-600">{t("comic.retryCount", { count: Number(item.retry_count) })}</span>}
              </div>
            </div>
          )})}
          </div>
        </section>
      )}
      {segments.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t("comic.videoSegments")} · {completedSegments}/{total}</h4>{segments.length > 6 && <button type="button" onClick={() => setShowAllSegments((value) => !value)} className="text-[11px] font-medium text-cyan-600 dark:text-cyan-300">{showAllSegments ? t("comic.collapse") : t("comic.showAll")}</button>}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleSegments.map((item: any, idx: number) => {
            const failed = item.status === "failed" || !!textOf(item.error_message);
            return (
            <div key={textOf(item.id || idx)} className={`overflow-hidden rounded-xl border bg-white dark:bg-white/5 ${failed ? "border-red-200 dark:border-red-400/30" : "border-white dark:border-white/10"}`}>
              <div className="aspect-video bg-black">
                {textOf(item.video_url) ? (
                  <video src={textOf(item.video_url)} controls className="h-full w-full object-contain" />
                ) : (
                  <div className={`flex h-full items-center justify-center px-3 text-center text-xs ${failed ? "text-red-400" : "text-gray-400"}`}>{failed ? textOf(item.error_message || t("workspace.generationFailed")) : t("comic.segmentGenerating")}</div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-3 py-2"><span className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{textOf(item.title || item.id || `${t("comic.videoSegment")} ${idx + 1}`)}</span>{Number(item.retry_count || 0) > 0 && <span className="shrink-0 text-[10px] text-amber-600">{t("comic.retryCount", { count: Number(item.retry_count) })}</span>}</div>
            </div>
          )})}
          </div>
        </section>
      )}
    </div>
  );
}

function ComicSettingCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{title}</div>
      {children}
    </section>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      {options.map(([code, label]) => (
        <button key={code} type="button" onClick={() => onChange(code)} className={"rounded-xl border px-3 py-2 text-left text-sm transition " + (value === code ? "border-secondary bg-secondary/10 text-secondary dark:text-cyan-200" : "border-gray-100 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-300")}>
          {label}
        </button>
      ))}
    </div>
  );
}

function NumberRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const set = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  return (
    <div className="mb-2 flex items-center justify-between gap-3 last:mb-0">
      <span className="text-xs text-gray-500 dark:text-gray-300">{label}</span>
      <div className="flex items-center rounded-xl border border-gray-100 bg-white dark:border-white/10 dark:bg-white/5">
        <button type="button" onClick={() => set(value - 1)} className="h-8 w-8 text-gray-500">-</button>
        <input value={value} onChange={(e) => set(Number(e.target.value) || min)} className="h-8 w-12 bg-transparent text-center text-sm font-semibold text-gray-800 outline-none dark:text-white" />
        <button type="button" onClick={() => set(value + 1)} className="h-8 w-8 text-gray-500">+</button>
      </div>
    </div>
  );
}

function FinalComicVideo({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-cyan-100 bg-white p-3 dark:border-cyan-400/20 dark:bg-white/5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">{t("comic.finalVideo")}</div>
        <a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium text-secondary">{t("comic.openVideo")}</a>
      </div>
      <video src={url} controls playsInline preload="metadata" className="max-h-[420px] w-full rounded-xl bg-black object-contain" />
    </div>
  );
}

function DetailPagePanel({ detailPage }: { detailPage: DetailPageOutput }) {
  const { t, ts } = useI18n();
  const sections = Array.isArray(detailPage.sections) ? detailPage.sections : [];
  const longURL = textOf(detailPage.long_image_url);
  const isReady = detailPage.compose_status === "succeeded" && Boolean(longURL);
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-full " + (isReady ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-primary/10 text-primary")}>
            {isReady ? <Check size={16} /> : <Wand2 size={15} />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{isReady ? ts("AI 已完成商品详情页") : t("agent.detailPage.title")}</div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-300">
              {detailPage.status === "planning" ? `${sections.length} ${t("agent.detailPage.modules")}` : <>{t("agent.detailPage.completed")} {Number(detailPage.completed_count ?? sections.length)}/{Number(detailPage.section_count ?? sections.length)} {t("agent.detailPage.modules")}</>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isReady ? <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">{detailPage.status === "planning" ? ts("待确认 · 按模块生成") : detailPage.status === "partial" ? ts("部分模块未完成") : t("agent.detailPage.modulesReady")}</span> : null}
          {longURL ? <a href={longURL} target="_blank" rel="noreferrer" download className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"><Download size={14} />{t("agent.detailPage.downloadLong")}</a> : null}
        </div>
      </div>
      {longURL && (
        <div className="bg-gray-50 p-2 sm:p-4 dark:bg-gray-950/60">
          <Image unoptimized src={longURL} alt={ts("商品详情长图")} width={1200} height={6000} sizes="(max-width: 768px) 100vw, 900px" className="mx-auto h-auto w-full max-w-3xl rounded-xl bg-white shadow-sm" />
        </div>
      )}
      {sections.length > 0 && (
        <details open={!longURL} className="group border-t border-gray-100 dark:border-white/10">
          <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5">{longURL ? ts("查看模块规划与文案") : ts("模块正在依次生成")} · {sections.length}</summary>
          <div className="grid gap-2 border-t border-gray-100 bg-gray-50/70 p-3 sm:grid-cols-2 lg:grid-cols-3 dark:border-white/10 dark:bg-black/10">
            {sections.map((section, index) => (
              <div key={textOf(section.id || index)} className="rounded-xl border border-gray-100 bg-white p-3 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-gray-700 dark:text-gray-200">{index + 1}</span>
                  <span className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{textOf(section.title || section.copy_title || `详情模块 ${index + 1}`)}</span>
                </div>
                {section.objective && <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-300">{section.objective}</p>}
                {section.copy_title && <p className="mt-2 text-sm font-medium">{section.copy_title}</p>}
                {Array.isArray(section.copy_points) && section.copy_points.map((point, i) => <p key={i} className="mt-1 select-text text-xs leading-5 text-gray-600 dark:text-gray-300">{point}</p>)}
              </div>
            ))}
          </div>
        </details>
      )}
      {detailPage.compose_status === "skipped" && detailPage.compose_error && (
        <p className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/15 dark:bg-amber-500/10 dark:text-amber-200">{t("agent.detailPage.composeSkipped")} {detailPage.compose_error}</p>
      )}
    </section>
  );
}

function MediaTaskGrid({ tasks, generationType, onMore }: { tasks: MediaTask[]; generationType: string; onMore: () => void }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null);
  const visibleTasks = tasks.slice(0, 8);
  const count = visibleTasks.length;
  const gridClass =
    count <= 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : count === 3
          ? "grid-cols-1 sm:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";
  const mediaHeight = count <= 1 ? "h-[210px] sm:h-[240px] lg:h-[260px]" : "h-[150px] sm:h-[170px] lg:h-[190px]";

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [preview]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">{t("workspace.generationResult")}</div>
        {tasks.length > 8 && (
          <button type="button" onClick={onMore} className="h-8 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10">
            {t("common.more")}
          </button>
        )}
      </div>
      <div className={`grid ${gridClass} gap-2 sm:gap-3`}>
        {visibleTasks.map((task, idx) => (
          <MediaResultCard
            key={task.task_no || idx}
            task={task}
            index={idx}
            generationType={mediaTaskType(task, generationType)}
            mediaHeight={mediaHeight}
            onPreview={(url, type) => setPreview({ url, type })}
          />
        ))}
      </div>
      {preview && createPortal(
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[200] flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-black/80 p-4" onClick={() => setPreview(null)}>
          <div className={`relative flex max-h-[calc(100dvh-2rem)] w-full items-center justify-center overflow-hidden rounded-2xl bg-black shadow-2xl ${preview.type === "video" ? "max-w-6xl" : "max-w-4xl"}`} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreview(null)} className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white/90 text-gray-900 shadow dark:border-white/10 dark:bg-gray-900/90 dark:text-white" aria-label={t("common.close")}><X size={16} /></button>
            {preview.type === "video" ? (
              <video src={preview.url} controls controlsList="nodownload" playsInline autoPlay className="h-auto max-h-[82dvh] w-full object-contain" />
            ) : preview.type === "audio" ? (
              <div className="flex min-h-52 w-full items-center justify-center p-8">
                <audio src={preview.url} controls autoPlay className="w-full max-w-xl" />
              </div>
            ) : (
              <div className="relative flex max-h-[82dvh] w-full items-center justify-center">
                <a
                  href={preview.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="absolute left-3 top-3 z-20 flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white/90 px-3 text-sm font-medium text-gray-900 shadow dark:border-white/10 dark:bg-gray-900/90 dark:text-white"
                  title={t("common.download")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download size={15} />
                  {t("common.download")}
                </a>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <Image unoptimized src={preview.url} alt="" width={1600} height={900} sizes="(max-width: 768px) 100vw, 896px" className="h-auto max-h-[82dvh] w-auto max-w-full object-contain" />
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function MediaResultCard({
  task,
  index,
  generationType,
  mediaHeight,
  onPreview,
}: {
  task: MediaTask;
  index: number;
  generationType: string;
  mediaHeight: string;
  onPreview: (url: string, type: string) => void;
}) {
  const { t } = useI18n();
  const [imageFailed, setImageFailed] = useState(false);
  const url = mediaURL(task);
  const progress = statusProgress(task.status, task.progress);
  const status = task.status || "";
  const failed = status === "failed";
  const succeeded = status === "succeeded";
  const pendingLabel = failed ? task.error_message || t("workspace.generationFailed") : t("workspace.generating");
  const placeholderClass = failed ? "text-red-500 dark:text-red-300" : "text-gray-500 dark:text-gray-300";

  useEffect(() => {
    setImageFailed(false);
  }, [url, status]);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-2.5 dark:bg-white/5 dark:border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className="max-w-[70%] truncate text-xs text-gray-400">{task.detail_section?.title || `#${index + 1}`}</span>
        <span className={`text-xs ${status === "succeeded" ? "text-emerald-600" : failed ? "text-red-500" : "text-amber-600"}`}>{t(STATUS_LABEL_KEY[status] || status)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden mb-2.5"><div className="h-full bg-primary" style={{ width: progress + "%" }} /></div>
      <div className={`rounded-xl border border-gray-100 ${mediaHeight} flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-950 dark:border-white/10`}>
        {url && generationType === "video" && succeeded ? (
          <div className="relative h-full w-full bg-black flex items-center justify-center">
            <video src={url} controls controlsList="nodownload" playsInline preload="metadata" className="h-full w-full object-contain" />
            <button type="button" onClick={() => onPreview(url, "video")} className="absolute right-2 top-2 z-20 rounded-lg border border-white/20 bg-gray-950/85 px-2.5 py-1 text-xs font-medium text-white shadow-lg backdrop-blur hover:bg-gray-900 dark:bg-gray-900/90 dark:text-white dark:border-white/10 dark:hover:bg-gray-800">{t("common.preview")}</button>
          </div>
        ) : url && generationType === "audio" && succeeded ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-4">
            <audio src={url} controls preload="metadata" className="w-full" />
            <button type="button" onClick={() => onPreview(url, "audio")} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
              {t("common.preview")}
            </button>
          </div>
        ) : url && generationType === "image" && succeeded && !imageFailed ? (
          <div className="relative h-full w-full">
            <button type="button" onClick={() => onPreview(url, "image")} className="h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <Image unoptimized src={url} alt="" width={1280} height={720} sizes="(max-width: 768px) 100vw, 50vw" onError={() => setImageFailed(true)} className="w-full h-full object-contain" />
            </button>
            <a
              href={url}
              download
              target="_blank"
              rel="noreferrer"
              className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-gray-950/85 text-white shadow-lg backdrop-blur hover:bg-gray-900 dark:bg-gray-900/90 dark:text-white dark:border-white/10 dark:hover:bg-gray-800"
              title={t("common.download")}
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={15} />
            </a>
          </div>
        ) : (
          <div className={`px-4 text-center text-sm ${imageFailed ? "text-gray-500 dark:text-gray-300" : placeholderClass}`}>
            {imageFailed ? t("workspace.imageLoadFailed") : pendingLabel}
          </div>
        )}
      </div>
    </div>
  );
}
