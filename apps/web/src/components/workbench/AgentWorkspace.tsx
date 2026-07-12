"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Archive, ArrowUp, Check, Copy, Download, Folder, HelpCircle, History, ImageIcon, Loader2, Plus, RefreshCw, Settings2, Star, Trash2, Wand2, X } from "lucide-react";
import { api, apiForLocale, uploadAsset } from "@/lib/api";
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

type DisplayStep = { icon?: string; title: string; subtitle?: string; tags?: string[] };
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
    orientation?: string;
    quality?: string;
  };
};
type NodeRun = { node_id: string; name: string; type: string; status: string; output: Record<string, any>; error?: string };
type DetailSection = { id?: string; type?: string; title?: string; objective?: string; copy_title?: string; copy_points?: string[]; image_url?: string; status?: string };
type DetailPageOutput = { status?: string; compose_status?: string; compose_error?: string; long_image_url?: string; section_count?: number; completed_count?: number; sections?: DetailSection[] };
type MediaTask = { task_no: string; status: string; progress: number; output?: Record<string, any>; error_message?: string; detail_section?: DetailSection };
type ReferenceImage = { url: string; name: string; public_id?: string };
type AnalysisCandidate = { id: string; title?: string; reason?: string; prompt: string; negative_prompt?: string; params?: Record<string, unknown> };
type Project = {
  public_id: string;
  status: string;
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

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: "status.pending",
  running: "status.running",
  waiting_confirm: "status.waitingConfirm",
  succeeded: "status.succeeded",
  failed: "status.failed",
};

const IMAGE_SCENES = [
  { code: "main_image", label: "\u5546\u54c1\u4e3b\u56fe", kind: "image" },
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

function mediaURL(task: MediaTask) {
  const out = task.output || {};
  return textOf(out.video_url || out.image_url || (Array.isArray(out.images) && out.images[0]?.url) || (Array.isArray(out.videos) && out.videos[0]?.url));
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

function projectStage(project: Project | null, mediaTasks: MediaTask[], generationType: "image" | "video", isComicDrama = false) {
  if (!project) return "开始";
  if (project.status === "waiting_confirm") return "方案确认";
  if (project.status === "succeeded") return "已完成";
  if (project.status === "failed") return "失败";
  if (isComicDrama) {
    const step = textOf(project.outputs?.current_step);
    if (step === "storyboard_confirm") return "分镜规划中...";
    if (step === "video_segments") return "分段视频生成中...";
    if (step === "compose") return "最终成片合成中...";
    if (step === "result") return "成片整理中...";
    if (mediaTasks.some((task) => mediaURL(task) && task.output?.image_url)) return "关键帧生成中...";
    return "AI漫剧规划中...";
  }
  if (mediaTasks.length > 0 || project.outputs?.media_tasks || project.outputs?.current_step === "generate") return generationType === "video" ? "视频生成中..." : "图片生成中...";
  return "AI分析中...";
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
  const rules: Record<string, string> = {
    main_image: "必须生成电商商品主图：商品主体清晰，背景干净或高级简洁，突出材质和卖点，不要做成详情页、场景图或海报。",
    detail_image: "必须生成商品详情图：突出商品结构、材质细节、功能卖点、规格层次和详情页排版感，不要生成普通主图。",
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
  const { t, td, locale } = useI18n();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [generationModel, setGenerationModel] = useState<Model | null>(null);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
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
  const [confirmPrompt, setConfirmPrompt] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ProjectListItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    const controller = new AbortController();
    apiForLocale<Workflow>(`/api/agents/${code}`, locale, { signal: controller.signal })
      .then((wf) => {
        if (controller.signal.aborted) return;
        setWorkflow(wf);
        setCount(Math.max(1, Number(wf.runtime_config?.default_count || 1)));
        const modelCode = wf.runtime_config?.generation_model_code;
        if (modelCode) {
          apiForLocale<Model>(`/api/models/${modelCode}`, locale, { signal: controller.signal })
            .then((m) => {
              if (controller.signal.aborted) return;
              setGenerationModel(m);
              setParams({ ...schemaDefaultsFromFields(m.input_schema), ...(m.default_params || {}) });
              if (typeof m.default_params?.channel_key === "string") {
                setBottom((prev) => ({ ...prev, channel_key: String(m.default_params.channel_key) }));
              }
            })
            .catch((error) => {
              if (error?.name !== "AbortError") setGenerationModel(null);
            });
        } else {
          setGenerationModel(null);
          setParams({});
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setWorkflow(null);
      });
    return () => {
      controller.abort();
    };
  }, [code, locale]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const display = workflow?.display_config || {};
  const isComicDrama = workflow?.runtime_config?.agent_mode === "comic_drama" || workflow?.runtime_config?.preset_code === "ai_comic_drama";
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
  const enableStepConfirm = flowOptions.enable_step_confirm !== false;
  const canUseAutopilot = flowOptions.enable_autopilot !== false;
  const allowPromptEdit = flowOptions.allow_prompt_edit !== false;
  const requireReferenceImage = workflow?.runtime_config?.require_image === true;
  const allowTextOnly = inputCaps.allow_text_only === true;
  const supportReferenceImage = inputCaps.support_reference_image !== false;
  const supportMultipleReferences = inputCaps.support_multiple_references === true;
  const modeLabels = [t("agent.stepConfirm"), t("agent.autopilot")];
  const outputScenes = useMemo(
    () => normalizeCreativeScenes(workflow?.runtime_config?.creative_scenes || workflow?.runtime_config?.output_scenes, generationType),
    [workflow?.runtime_config?.creative_scenes, workflow?.runtime_config?.output_scenes, generationType]
  );
  const selectedSceneMeta = IMAGE_SCENES.find((item) => item.code === selectedScene) || IMAGE_SCENES[0];
  const isDetailPageScene = selectedSceneMeta.code === "detail_image" && generationType === "image";
  const videoConfig = parseVideoRuntime(generationModel?.runtime_rule);
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
  });
  const [comicProjects, setComicProjects] = useState<ComicProject[]>([]);
	const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [activeComicProject, setActiveComicProject] = useState<ComicProject | null>(null);
  const [comicStyles, setComicStyles] = useState<ComicStyle[]>([]);
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
  const maxVideoAssetRefs =
    videoConfig.upload_profile === "frame_pair"
      ? videoConfig.reference_images?.max ?? 4
      : videoConfig.max_reference_images ?? 1;
  const analysis = useMemo(
    () => project?.outputs?.analysis || project?.node_runs?.find((n) => n.node_id === "analysis")?.output || {},
    [project]
  );
  const allMediaTasks = useMemo(
    () => (project?.media_tasks?.length ? project.media_tasks : ((project?.outputs?.media_tasks || []) as MediaTask[])),
    [project]
  );
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
      setComicProjects(res.items || []);
      setActiveComicProject((prev) => (prev && res.items?.some((item) => item.public_id === prev.public_id) ? prev : res.items?.[0] || null));
    } catch {
      setComicProjects([]);
    }
  };

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

  useEffect(() => {
    if (!isComicDrama) return;
    loadComicProjects();
    loadComicStyles();
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("comicProjectDrawerCollapsed") : null;
    if (stored === "1") setProjectDrawerCollapsed(true);
		// Load once when entering comic mode; the loaders intentionally use the current view state.
		// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComicDrama]);

  useEffect(() => {
    if (!isComicDrama) return;
    const featureCount = Math.max(1, translatedSteps.length);
    const timer = window.setInterval(() => {
      setActiveComicFeature((prev) => (prev + 1) % featureCount);
    }, 3600);
    return () => window.clearInterval(timer);
  }, [isComicDrama, translatedSteps.length]);

  useEffect(() => {
    if (isComicDrama || project) return;
    const total = Math.max(1, Math.min(4, translatedSteps.length));
    const timer = window.setInterval(() => {
      setActiveAgentFeature((prev) => (prev + 1) % total);
    }, 3600);
    return () => window.clearInterval(timer);
  }, [isComicDrama, project, translatedSteps.length]);

  const setComicDrawerCollapsed = (value: boolean) => {
    setProjectDrawerCollapsed(value);
    if (typeof window !== "undefined") window.localStorage.setItem("comicProjectDrawerCollapsed", value ? "1" : "0");
  };

  useEffect(() => {
    if (!outputScenes.includes(selectedScene)) {
      const fallback = generationType === "video" ? "product_video" : "main_image";
      setSelectedScene(outputScenes.includes(fallback) ? fallback : outputScenes[0] || fallback);
    }
  }, [generationType, outputScenes, selectedScene]);

  useEffect(() => {
    if (isDetailPageScene && count < 4) setCount(6);
  }, [count, isDetailPageScene]);

  const startPolling = (publicId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const p = await api<Project>(`/api/agent-projects/${publicId}`);
        setProject(p);
        if (p.status === "succeeded" || p.status === "failed" || p.status === "waiting_confirm") {
          if (pollRef.current) clearInterval(pollRef.current);
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
    setSubmitting(true);
    setError("");
    try {
      const selectedAssets = bottom.asset_ids?.length ? { asset_ids: bottom.asset_ids } : {};
      const videoParams = isVideoGeneration && generationModel
        ? buildVideoTaskParams(params, videoMedia, generationModel.runtime_rule)
        : {};
      const imageParams = !isVideoGeneration
        ? buildImageGenerationParams({ count, ratio: imageRatio, imageSize })
        : {};
      const languageParams = buildLanguageParams(selectedLanguage);
      const imageURL =
        productImage?.url ||
        videoMedia.reference_images[0]?.url ||
        videoMedia.first_frame?.url ||
        videoMedia.last_frame?.url ||
        "";
      const referenceAssetIds = [
        productImage?.public_id,
        videoMedia.first_frame?.public_id,
        videoMedia.last_frame?.public_id,
        ...videoMedia.reference_images.map((x) => x.public_id),
      ].filter((x): x is string => !!x);
      const scenePrompt = clientScenePrompt(selectedSceneMeta.code, selectedSceneMeta.label, generationType);
      const userPrompt = prompt.trim();
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
            detail_section_count: isDetailPageScene ? Math.max(4, Math.min(8, count || 6)) : undefined,
            generation_language: languageParams.language,
            generation_language_label: languageParams.language_label,
            ...(isComicDrama ? {
              ...comicSettings,
              comic_project_id: activeComicProject?.public_id,
              comic_project_name: activeComicProject?.name,
              comic_project_description: activeComicProject?.description,
              comic_style: activeComicProject?.style || comicStyles.find((item) => item.public_id === projectDraft.style_id),
              orientation: activeComicProject?.orientation || projectDraft.orientation,
              quality: activeComicProject?.quality || projectDraft.quality,
            } : {}),
            count: Number((videoParams as any).count ?? (imageParams as any).count ?? params.count ?? count),
            n: Number((videoParams as any).count ?? (imageParams as any).n ?? params.count ?? count),
            image_url: imageURL || undefined,
            reference_asset_ids: referenceAssetIds,
            _mode: !enableStepConfirm || mode === "auto" ? "auto" : "step",
          },
        }),
      });
      setProject(p);
      if (isComicDrama) loadComicProjects();
      startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动失败");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmStep = async () => {
    if (!project) return;
    await api(`/api/agent-projects/${project.public_id}/steps/confirm/confirm`, {
      method: "POST",
      body: JSON.stringify({ payload: { prompt: confirmPrompt, candidate_id: selectedCandidateId } }),
    });
    const p = await api<Project>(`/api/agent-projects/${project.public_id}`);
    setProject(p);
    startPolling(project.public_id);
  };

  const enableAutopilot = async () => {
    if (!project) return;
    await api(`/api/agent-projects/${project.public_id}/autopilot`, { method: "POST", body: JSON.stringify({ enabled: true }) });
    startPolling(project.public_id);
  };

  const retry = async () => {
    if (!project) return;
		const failedNode = [...(project.node_runs || [])].reverse().find((node) => node.status === "failed");
		if (failedNode) {
			await api(`/api/agent-projects/${project.public_id}/retry-node`, { method: "POST", body: JSON.stringify({ node_id: failedNode.node_id }) });
		} else {
			await api(`/api/agent-projects/${project.public_id}/retry`, { method: "POST" });
		}
    startPolling(project.public_id);
  };

  const resetTask = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setProject(null);
    setError("");
  };

  const openHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) {
      api<{ items: ProjectListItem[] }>(`/api/agent-projects?workflow_code=${encodeURIComponent(code)}&page=1&page_size=20`).then((r) => setHistoryItems(r.items || [])).catch(() => setHistoryItems([]));
    }
  };

  const loadHistory = async (id: string) => {
    const p = await api<Project>(`/api/agent-projects/${id}`);
    setProject(p);
    setHistoryOpen(false);
  };

  const uploadComicImage = async (file?: File | null, target: "project" | "style" = "project") => {
    if (!file) return;
    setComicUploading(true);
    setError("");
    try {
      const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: target === "project" ? "cover" : "style_reference" });
      if (target === "project") {
        setProjectDraft((prev) => ({ ...prev, cover_url: asset.url }));
      } else {
        setStyleDraft((prev) => ({ ...prev, cover_url: asset.url }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setComicUploading(false);
    }
  };

  const createComicProject = async () => {
    if (!projectDraft.name.trim()) {
      setError("请输入项目名称");
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
      setError(err instanceof Error ? err.message : "创建项目失败");
    } finally {
      setSubmitting(false);
    }
  };

  const createComicStyle = async () => {
    if (!styleDraft.name.trim()) {
      setError("请输入风格名称");
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
      setError(err instanceof Error ? err.message : "保存风格失败");
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
      const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: "prop" });
      setProductImage({ url: asset.url, name: asset.name || file.name, public_id: asset.public_id });
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "网络连接失败";
      setError(t("agent.uploadFailed") + message);
    } finally {
      setUploading(false);
    }
  };

  if (!workflow) return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">加载中...</div>;

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
            title={projectDrawerCollapsed ? "展开项目" : "收起项目"}
          >
            {projectDrawerCollapsed ? ">" : "<"}
          </button>
          {projectDrawerCollapsed ? (
            <div className="flex flex-1 items-start justify-center pt-20 text-xs text-gray-400 [writing-mode:vertical-rl]">项目</div>
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
                          onClick={() => setActiveComicProject(item)}
									onKeyDown={(event) => { if (event.key === "Enter") setActiveComicProject(item); }}
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

        <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto" onMouseEnter={() => !projectDrawerCollapsed && setComicDrawerCollapsed(true)}>
          <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(34,211,238,.24),transparent_28%),radial-gradient(circle_at_12%_84%,rgba(20,184,166,.18),transparent_22%)] dark:bg-[radial-gradient(circle_at_76%_10%,rgba(20,184,166,.22),transparent_28%),radial-gradient(circle_at_14%_82%,rgba(6,182,212,.14),transparent_22%)]" />
          <div className="relative z-10 flex min-h-0 flex-1 flex-col px-3 py-3 pb-4 sm:px-5 lg:min-h-[700px] lg:px-8 lg:py-4">
            <div className="shrink-0 pt-1 text-center sm:pt-3 lg:pt-4">
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

            <div className="flex min-h-0 flex-1 flex-col gap-3 pt-4">
              <div className="agent-showcase min-h-[260px] flex-1 items-center">
                <ComicFeatureSelector features={translatedSteps} activeIndex={activeComicFeature} onSelect={setActiveComicFeature} />
                <ComicFeatureHero features={translatedSteps} activeIndex={activeComicFeature} onSelect={setActiveComicFeature} />
              </div>
              <div className="shrink-0">
                <ComicTimeline
                  nodes={display.timeline?.length ? display.timeline : (workflow.nodes || []).map((node) => node.name)}
                  mobileNodes={(workflow.nodes || []).map((node) => node.name)}
                  compact
                />
              </div>
              <div className="mx-auto mt-auto w-full max-w-5xl shrink-0">
                {error && <div className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-200">{error}</div>}
                {project && (
                  <div className="mb-2 flex items-center justify-between rounded-2xl border border-cyan-100 bg-white/70 px-4 py-2 text-xs text-gray-500 shadow-sm backdrop-blur dark:border-cyan-400/15 dark:bg-white/5 dark:text-gray-300">
                    <span>{projectStage(project, allMediaTasks, generationType, true)} · {totalProgress}%</span>
					{finalVideoURL ? <a href={finalVideoURL} target="_blank" rel="noreferrer" className="font-semibold text-cyan-600 dark:text-cyan-200">{t("comic.viewFinal")}</a> : null}
                  </div>
                )}
                <div className="rounded-3xl border border-gray-200 bg-white/90 shadow-xl shadow-cyan-950/10 backdrop-blur dark:border-white/10 dark:bg-[#1b1d22]/95 dark:shadow-black/30">
                  <div className="flex min-h-[92px] gap-3 p-3 sm:min-h-[104px] sm:p-4">
                    <label className="flex h-14 w-12 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 bg-gray-50 text-[10px] text-gray-400 hover:border-cyan-300 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-cyan-400/10 sm:h-20 sm:w-16">
					{productImage ? <Image src={productImage.url} alt="" width={128} height={128} sizes="64px" className="h-full w-full rounded-xl object-cover" /> : comicUploading || uploading ? <Loader2 size={18} className="animate-spin" /> : <><Plus size={18} /><span>{t("comic.referenceImage")}</span></>}
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(e) => { handleUpload(e.target.files?.[0]); e.currentTarget.value = ""; }} />
                    </label>
					<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("comic.videoPlaceholder")} className="min-h-[68px] flex-1 resize-none bg-transparent text-sm leading-6 text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500 sm:min-h-[86px]" />
                    <button onClick={run} disabled={submitting || project?.status === "running" || project?.status === "pending"} className="mt-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-white shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-400 disabled:opacity-40">
                      {submitting ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-3 py-3 dark:border-white/10 sm:px-4">
                    <button type="button" onClick={() => setStyleModalOpen(true)} className="flex h-9 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 text-xs font-semibold text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
					<Star size={14} className="text-cyan-500" /> {activeComicProject?.style?.name || activeStyle?.name || t("comic.selectStyle")}
                    </button>
                    <button type="button" onClick={() => setProjectModalOpen(true)} className="flex h-9 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 text-xs font-semibold text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
					<Folder size={14} /> {activeComicProject?.name || t("comic.selectProject")}
                    </button>
                    <span className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">{projectQuality}</span>
					<span className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">{projectOrientation === "portrait" ? t("comic.portrait") : t("comic.landscape")}</span>
                    <div className="mx-auto flex w-full max-w-[260px] items-center justify-center rounded-full bg-gray-100 p-1 dark:bg-white/10 sm:ml-auto sm:mr-0 sm:w-auto sm:max-w-none">
					<button type="button" onClick={() => setMode("step")} className={"flex-1 rounded-full px-4 py-2 text-center text-xs font-semibold sm:flex-none " + (mode === "step" ? "bg-cyan-500 text-white shadow" : "text-gray-500 dark:text-gray-300")}>{t("agent.stepConfirm")}</button>
					<button type="button" onClick={() => setMode("auto")} className={"flex-1 rounded-full px-4 py-2 text-center text-xs font-semibold sm:flex-none " + (mode === "auto" ? "bg-gray-900 text-white shadow dark:bg-white dark:text-gray-900" : "text-gray-500 dark:text-gray-300")}>{t("agent.autopilot")}</button>
                    </div>
                  </div>
                </div>
              </div>
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
            onClose={() => {
              setStyleAddOpen(null);
              setStyleModalOpen(true);
            }}
            onSave={createComicStyle}
          />
        )}
        {settingsOpen && (
          <ComicPreferenceModal settings={comicSettings} onChange={setComicSettings} onClose={() => setSettingsOpen(false)} />
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
      {project && (
      <div className="relative z-10 shrink-0 px-4 sm:px-6 py-3 flex items-center justify-between">
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
      )}

      <div className={(project ? "relative z-10 flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-4" : "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3 sm:px-5 lg:px-8 lg:py-4")}>
        <div className={project ? "max-w-[1120px] mx-auto space-y-4" : "mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col"}>
          {!project && (
            <AgentLanding
              workflowIcon={workflow.icon || "\u{1F916}"}
              workflowName={workflowName}
              workflowDescription={workflowDescription}
              heroTags={display.hero_tags || ["AI Agent", "Step confirm", "Autopilot"]}
              features={translatedSteps}
              activeIndex={activeAgentFeature}
              onSelect={setActiveAgentFeature}
              theme={theme}
              generationType={generationType}
            />
          )}
          {project && (
          <div className="grid gap-4">
            <div className="soft-card p-5 sm:p-6 min-h-[320px]">
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">{projectStage(project, allMediaTasks, generationType, isComicDrama)}</div>
                      <div className="mt-0.5 text-xs text-gray-400">{t("workspace.generationProgress")} {totalProgress}%</div>
                    </div>
                    {project.status === "running" || project.status === "pending" ? <Loader2 size={18} className="animate-spin text-primary" /> : null}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {([
                      t("workspace.stepStart"),
                      t("workspace.stepAnalysis"),
                      generationType === "video" ? t("workspace.stepVideoGenerating") : t("workspace.stepImageGenerating"),
                      t("workspace.stepDone"),
                    ]).map((s, i) => {
                      const activeIdx = project.status === "succeeded" ? 3 : (mediaTasks.length || project.outputs?.current_step === "generate") ? 2 : analysis && Object.keys(analysis).length ? 1 : 0;
                      return <div key={s} className={"h-8 rounded-xl flex items-center justify-center text-[11px] border " + (i <= activeIdx ? "bg-primary/10 border-primary/30 text-gray-900 dark:text-gray-100" : "bg-gray-50 border-gray-100 text-gray-400 dark:bg-white/5 dark:border-white/10")}>{s}</div>;
                    })}
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: totalProgress + "%" }} /></div>
                  {isComicDrama && <ComicProjectPanel project={project} />}

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
                      <div className="flex items-center gap-2">
                        <button onClick={confirmStep} className="h-10 px-4 rounded-xl bg-primary text-dark font-semibold text-sm flex items-center gap-1.5"><Check size={16} />{t("agent.confirmGenerate")}</button>
                        {canUseAutopilot && <button onClick={enableAutopilot} className="h-10 px-4 rounded-xl bg-gray-900 text-white font-semibold text-sm flex items-center gap-1.5"><Wand2 size={16} />{t("agent.autopilot")}</button>}
                      </div>
                    </div>
                  )}

                  {finalVideoURL && <FinalComicVideo url={finalVideoURL} />}
                  {detailPage && <DetailPagePanel detailPage={detailPage} />}
                  {mediaTasks.length > 0 && <MediaTaskGrid tasks={mediaTasks} generationType={generationType} onMore={() => router.push("/app/works")} />}
                  {project.status === "failed" && (
                    <div className="rounded-2xl bg-red-50 border border-red-100 p-4 dark:bg-red-500/10 dark:border-red-400/20">
                      <p className="text-sm text-red-600 dark:text-red-300 mb-3">{project.error_message || t("workspace.generationFailed")}</p>
                      <button onClick={retry} className="h-9 px-4 rounded-xl bg-gray-900 text-white text-sm flex items-center gap-1.5"><RefreshCw size={15} />{t("common.retry")}</button>
                    </div>
                  )}
                </div>
            </div>
          </div>
          )}
        </div>
      </div>

      <div className="relative z-10 shrink-0 px-3 sm:px-6 pb-4 sm:pb-5 pt-2">
        <div className="max-w-[1120px] mx-auto">
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
                    referenceImages={isVideoGeneration ? videoMedia.reference_images : productImage ? [productImage] : []}
                    onReferenceImagesChange={(imgs) => {
                      if (isVideoGeneration) {
                        setVideoMedia((prev) => ({ ...prev, reference_images: imgs }));
                      } else {
                        setProductImage(imgs[0] || null);
                      }
                    }}
                    maxReferenceImages={supportMultipleReferences ? (isVideoGeneration ? maxVideoAssetRefs : 6) : 1}
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
                <div className="flex items-center gap-2">
                  {isComicDrama && (
                    <button onClick={() => setSettingsOpen(true)} className="h-9 px-3 rounded-xl bg-gray-50 border border-gray-100 text-gray-600 text-sm flex items-center gap-1.5 hover:bg-white transition dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10">
                      <Settings2 size={15} />偏好设置
                    </button>
                  )}
                  <button onClick={() => setHelpOpen(true)} className="h-9 px-3 rounded-xl bg-gray-50 border border-gray-100 text-gray-600 text-sm flex items-center gap-1.5 hover:bg-white transition dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"><HelpCircle size={15} />{t("agent.help")}</button>
                </div>
              </div>
            </div>
            <div className="px-3 sm:px-4 pt-3">
              {supportReferenceImage && isVideoGeneration && generationModel ? (
                <VideoUploadArea config={videoConfig} media={videoMedia} onChange={setVideoMedia} />
              ) : supportReferenceImage ? (
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
              ) : null}
            </div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={display.input?.placeholder || t("agent.inputPlaceholder")} rows={3} className="w-full min-h-[88px] resize-none bg-transparent px-4 py-3 text-sm text-gray-700 focus:outline-none placeholder:text-gray-400 leading-relaxed dark:text-gray-100 dark:placeholder:text-gray-500" />
            <div className="px-3 sm:px-4 py-3 border-t border-gray-50 dark:border-white/10 flex items-center gap-2">
              <div className="scroll-x-only flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto pb-1">
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
                    <ImageGenerationToolbar
                      count={count}
                      onCountChange={(value) => setCount(isDetailPageScene ? Math.max(4, Math.min(8, value)) : value)}
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
                <div className="font-semibold text-gray-900 dark:text-white">偏好设置</div>
                <div className="mt-0.5 text-xs text-gray-400">自定义 AI 漫剧创作偏好</div>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={16} /></button>
            </div>
            <div className="grid max-h-[68vh] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
              <ComicSettingCard title="资产图风格参考">
                <Segmented value={comicSettings.style_reference_mode} options={[["image_reference", "附带风格参考图"], ["text_only", "仅文字描述"]]} onChange={(v) => setComicSettings((prev) => ({ ...prev, style_reference_mode: v }))} />
              </ComicSettingCard>
              <ComicSettingCard title="分镜时长模式">
                <Segmented value={comicSettings.duration_mode} options={[["compact", "紧凑"], ["standard", "常规"], ["long", "超长"]]} onChange={(v) => setComicSettings((prev) => ({ ...prev, duration_mode: v }))} />
              </ComicSettingCard>
              <ComicSettingCard title="分镜画宫格数">
                <Segmented value={String(comicSettings.storyboard_grid)} options={[["4", "4宫格"], ["6", "6宫格"], ["9", "9宫格"]]} onChange={(v) => setComicSettings((prev) => ({ ...prev, storyboard_grid: Number(v) }))} />
              </ComicSettingCard>
              <ComicSettingCard title="分镜图自动重试">
                <NumberRow label="最大重试次数" value={comicSettings.max_retry} min={0} max={5} onChange={(v) => setComicSettings((prev) => ({ ...prev, max_retry: v }))} />
                <NumberRow label="资产一致性合格分" value={comicSettings.asset_consistency_score} min={0} max={100} onChange={(v) => setComicSettings((prev) => ({ ...prev, asset_consistency_score: v }))} />
                <NumberRow label="画面逻辑合格分" value={comicSettings.logic_score} min={0} max={100} onChange={(v) => setComicSettings((prev) => ({ ...prev, logic_score: v }))} />
              </ComicSettingCard>
              <ComicSettingCard title="图片模型">
                <input className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-white" value={comicSettings.image_model_code} onChange={(e) => setComicSettings((prev) => ({ ...prev, image_model_code: e.target.value }))} placeholder="image_fast_v1" />
              </ComicSettingCard>
              <ComicSettingCard title="视频模型">
                <input className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-white" value={comicSettings.video_model_code} onChange={(e) => setComicSettings((prev) => ({ ...prev, video_model_code: e.target.value }))} placeholder="video_demo_v1" />
                <div className="mt-2 inline-flex rounded-full bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-700 dark:text-cyan-200">系统推荐</div>
              </ComicSettingCard>
              <ComicSettingCard title="对话模型">
                <input className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-white" value={comicSettings.dialogue_model_codes.join(",")} onChange={(e) => setComicSettings((prev) => ({ ...prev, dialogue_model_codes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))} placeholder="chat_demo_v1" />
                <div className="mt-2 text-[11px] text-gray-400">多个模型用英文逗号分隔，首个为主模型。</div>
              </ComicSettingCard>
            </div>
            <button onClick={() => setSettingsOpen(false)} className="mt-4 h-11 w-full rounded-xl bg-secondary text-sm font-semibold text-white">保存设置</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentLanding({
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
          <div className={"flex h-9 w-9 items-center justify-center rounded-2xl text-xl shadow-sm sm:h-11 sm:w-11 sm:text-2xl " + theme.iconBg}>{workflowIcon}</div>
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
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10 text-2xl text-cyan-600 transition duration-300 group-hover:rotate-3 group-hover:scale-110 dark:text-cyan-200 sm:h-14 sm:w-14 lg:h-16 lg:w-16">
              {active.icon || workflowIcon}
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
    <div className="comic-feature-card group mx-auto flex w-full max-w-[640px] flex-col overflow-y-auto rounded-3xl border border-cyan-300/70 bg-white/65 p-4 shadow-xl shadow-cyan-950/10 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:bg-white/75 hover:shadow-2xl hover:shadow-cyan-950/15 dark:border-cyan-400/30 dark:bg-transparent dark:shadow-black/30 dark:hover:bg-cyan-400/[0.04] sm:p-6 lg:p-7">
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
  onChooseStyle: () => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const update = (patch: Partial<typeof draft>) => onChange((prev: typeof draft) => ({ ...prev, ...patch }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-200"><Folder size={22} /></div>
            <div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">新建项目</div>
              <div className="text-xs text-gray-400">创建一个新的漫剧项目</div>
            </div>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={18} /></button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto p-6">
          <label className="mx-auto mb-5 flex h-36 w-64 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-400 hover:border-cyan-300 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5">
            {draft.cover_url ? <Image src={draft.cover_url} alt="" width={512} height={288} sizes="256px" className="h-full w-full rounded-2xl object-cover" /> : uploading ? <Loader2 className="animate-spin" /> : <><ImageIcon size={30} /><span>点击上传封面</span></>}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { onUpload(e.target.files?.[0]); e.currentTarget.value = ""; }} />
          </label>
          <div className="space-y-4">
            <label className="block text-sm text-gray-600 dark:text-gray-300">项目名称 <span className="text-red-500">*</span><input value={draft.name} maxLength={100} onChange={(e) => update({ name: e.target.value })} placeholder="请输入项目名称" className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-cyan-400 dark:border-white/10 dark:bg-white/5 dark:text-white" /></label>
            <label className="block text-sm text-gray-600 dark:text-gray-300">项目描述<textarea value={draft.description} maxLength={500} onChange={(e) => update({ description: e.target.value })} placeholder="请输入项目描述（可选）" className="mt-2 h-24 w-full resize-none rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-cyan-400 dark:border-white/10 dark:bg-white/5 dark:text-white" /></label>
            <button type="button" onClick={onChooseStyle} className="flex h-14 w-full items-center gap-3 rounded-xl border border-dashed border-orange-200 bg-orange-50/50 px-4 text-left text-sm text-gray-600 hover:bg-orange-50 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-gray-200">
              <Star size={20} className="text-orange-500" />
              {selectedStyle ? selectedStyle.name : "点击选择画面风格"}
            </button>
            <div>
              <div className="mb-2 text-sm text-gray-600 dark:text-gray-300">屏幕方向</div>
              <div className="grid grid-cols-2 gap-3">
                {[["landscape", "横屏"], ["portrait", "竖屏"]].map(([value, label]) => (
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
          <button onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 dark:border-white/10 dark:text-gray-300">取消</button>
          <button onClick={onCreate} disabled={submitting} className="rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? "创建中..." : "创建项目"}</button>
        </div>
      </div>
    </div>
  );
}

function ComicStyleModal({ styles, selectedId, filter, onFilter, onSelect, onClose, onConfirm, onAdd, onDelete }: { styles: ComicStyle[]; selectedId: string; filter: "all" | "system" | "mine"; onFilter: (v: "all" | "system" | "mine") => void; onSelect: (id: string) => void; onClose: () => void; onConfirm: () => void; onAdd: (mode: "smart" | "manual") => void; onDelete: (style: ComicStyle) => void }) {
	const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-white/10">
          <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500"><Star size={21} /></div><div><div className="text-lg font-bold text-gray-900 dark:text-white">选择风格</div><div className="text-xs text-gray-400">为你的漫剧选择合适的画面风格</div></div></div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={18} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-4 dark:border-white/10">
          {([["all", "全部"], ["system", "系统风格"], ["mine", "我的风格"]] as const).map(([value, label]) => <button key={value} onClick={() => onFilter(value)} className={"rounded-full px-4 py-2 text-sm " + (filter === value ? "bg-orange-50 text-orange-600 ring-1 ring-orange-200 dark:bg-orange-400/10 dark:text-orange-200" : "border border-gray-200 text-gray-500 dark:border-white/10 dark:text-gray-300")}>{label}</button>)}
          <div className="ml-auto flex gap-2"><button onClick={() => onAdd("smart")} className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-600 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-200">新增风格 - 智能识别</button><button onClick={() => onAdd("manual")} className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-600 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-200">新增风格 - 手动添加</button></div>
        </div>
        <div className="grid max-h-[56vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{styles.map((style) => <div key={style.public_id} className="relative"><button onClick={() => onSelect(style.public_id)} className={"w-full overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition dark:bg-white/5 " + (selectedId === style.public_id ? "border-orange-300 ring-2 ring-orange-200 dark:border-orange-400/50" : "border-gray-200 hover:border-orange-200 dark:border-white/10")}><div className="aspect-[1.55] bg-gray-100 dark:bg-white/10">{style.cover_url ? <Image src={style.cover_url} alt="" width={480} height={310} sizes="(max-width: 640px) 50vw, 25vw" className="h-full w-full object-cover" /> : null}</div><div className="p-3"><div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{style.name}</div><div className="mt-1 text-[11px] text-gray-400">{style.source === "system" ? "系统" : "我的"}</div></div></button>{style.source !== "system" ? <button type="button" title={t("comic.deleteStyle")} onClick={() => onDelete(style)} className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-white hover:bg-red-500"><Trash2 size={13} /></button> : null}</div>)}
        </div>
        <div className="flex justify-between border-t border-gray-100 p-5 dark:border-white/10"><span className="text-sm text-gray-400">{selectedId ? "已选择风格" : "尚未选择风格"}</span><div className="flex gap-2"><button onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 dark:border-white/10 dark:text-gray-300">取消</button><button onClick={onConfirm} className="rounded-xl bg-orange-400 px-5 py-2 text-sm font-semibold text-white">确认选择</button></div></div>
      </div>
    </div>
  );
}

function ComicStyleAddModal({ mode, draft, uploading, submitting, onChange, onUpload, onClose, onSave }: { mode: "manual" | "smart"; draft: { cover_url: string; name: string; prompt: string }; uploading: boolean; submitting: boolean; onChange: (next: any) => void; onUpload: (file?: File | null) => void; onClose: () => void; onSave: () => void }) {
  const update = (patch: Partial<typeof draft>) => onChange((prev: typeof draft) => ({ ...prev, ...patch }));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-white/10"><div className="text-lg font-bold text-gray-900 dark:text-white">新增风格</div><button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={18} /></button></div>
        <div className="space-y-4 p-6">
          <label className="block text-sm text-gray-600 dark:text-gray-300">参考图 <span className="text-red-500">*</span><div className="mt-2 flex h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 text-gray-400 dark:border-white/10 dark:bg-white/5">{draft.cover_url ? <Image src={draft.cover_url} alt="" width={640} height={384} sizes="512px" className="h-full w-full rounded-2xl object-cover" /> : uploading ? <Loader2 className="animate-spin" /> : <><Plus size={28} /><span>点击选择图片</span></>}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { onUpload(e.target.files?.[0]); e.currentTarget.value = ""; }} /></div></label>
          <label className="block text-sm text-gray-600 dark:text-gray-300">风格名称 <input value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="给这个风格起个名字" className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-orange-300 dark:border-white/10 dark:bg-white/5 dark:text-white" /></label>
          <label className="block text-sm text-gray-600 dark:text-gray-300">风格提示词 <textarea value={draft.prompt} onChange={(e) => update({ prompt: e.target.value })} placeholder={mode === "smart" ? "可留空，系统会根据参考图生成基础风格说明" : "例如：动漫风格，新海诚画风，赛璐璐上色..."} className="mt-2 h-28 w-full resize-none rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-orange-300 dark:border-white/10 dark:bg-white/5 dark:text-white" /></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 p-5 dark:border-white/10"><button onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 dark:border-white/10 dark:text-gray-300">取消</button><button onClick={onSave} disabled={submitting} className="rounded-xl bg-orange-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? "保存中..." : "保存"}</button></div>
      </div>
    </div>
  );
}

function ComicPreferenceModal({ settings, onChange, onClose }: { settings: any; onChange: (next: any) => void; onClose: () => void }) {
  const set = (patch: Record<string, unknown>) => onChange((prev: any) => ({ ...prev, ...patch }));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-3xl bg-white p-5 shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><div><div className="text-lg font-bold text-gray-900 dark:text-white">偏好设置</div><div className="text-xs text-gray-400">自定义你的漫剧创作偏好</div></div><button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300"><X size={18} /></button></div>
        <div className="grid max-h-[68vh] gap-3 overflow-y-auto md:grid-cols-2">
          <ComicSettingCard title="资产图风格参考"><Segmented value={settings.style_reference_mode} options={[["image_reference", "附带风格参考图"], ["text_only", "仅文字描述"]]} onChange={(v) => set({ style_reference_mode: v })} /></ComicSettingCard>
          <ComicSettingCard title="分镜时长模式"><Segmented value={settings.duration_mode} options={[["compact", "紧凑"], ["standard", "常规"], ["long", "超长"]]} onChange={(v) => set({ duration_mode: v })} /></ComicSettingCard>
          <ComicSettingCard title="分镜画宫格数"><Segmented value={String(settings.storyboard_grid)} options={[["4", "4宫格"], ["6", "6宫格"], ["9", "9宫格"]]} onChange={(v) => set({ storyboard_grid: Number(v) })} /></ComicSettingCard>
          <ComicSettingCard title="自动重试"><NumberRow label="最大重试次数" value={settings.max_retry} min={0} max={5} onChange={(v) => set({ max_retry: v })} /><NumberRow label="资产一致性合格分" value={settings.asset_consistency_score} min={0} max={100} onChange={(v) => set({ asset_consistency_score: v })} /><NumberRow label="画面逻辑合格分" value={settings.logic_score} min={0} max={100} onChange={(v) => set({ logic_score: v })} /></ComicSettingCard>
          <ComicSettingCard title="图片模型"><input value={settings.image_model_code} onChange={(e) => set({ image_model_code: e.target.value })} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white" /></ComicSettingCard>
          <ComicSettingCard title="视频模型"><input value={settings.video_model_code} onChange={(e) => set({ video_model_code: e.target.value })} className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white" /></ComicSettingCard>
        </div>
        <button onClick={onClose} className="mt-4 h-11 w-full rounded-xl bg-cyan-500 text-sm font-semibold text-white">保存设置</button>
      </div>
    </div>
  );
}

function ComicSettingsSummary({ settings, onOpen }: { settings: { duration_mode: string; storyboard_grid: number; max_retry: number; style_reference_mode: string }; onOpen: () => void }) {
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
      <span>{settings.storyboard_grid}宫格</span>
      <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
      <span>{durationLabel[settings.duration_mode] || "常规"}</span>
      <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
      <span>重试 {settings.max_retry}</span>
    </button>
  );
}

function ComicProjectPanel({ project }: { project: Project }) {
  const comic = (project.outputs?.comic_drama || {}) as Record<string, any>;
  const storyboards = Array.isArray(comic.storyboards) ? comic.storyboards : [];
  const keyframes = Array.isArray(project.outputs?.keyframes) ? project.outputs?.keyframes : Array.isArray(comic.keyframes) ? comic.keyframes : [];
  const segments = Array.isArray(project.outputs?.segments) ? project.outputs?.segments : Array.isArray(comic.segments) ? comic.segments : [];
  if (!storyboards.length && !keyframes.length && !segments.length) return null;
  return (
    <div className="space-y-3 rounded-2xl border border-cyan-100 bg-cyan-50/40 p-4 dark:border-cyan-400/15 dark:bg-cyan-400/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">AI漫剧工作流资产</div>
          <div className="mt-0.5 text-xs text-gray-400">分镜、关键帧和分段视频会随流程逐步补齐</div>
        </div>
        <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 dark:text-cyan-200">{textOf(project.outputs?.current_step || project.status)}</span>
      </div>
      {storyboards.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {storyboards.slice(0, 6).map((item: any, idx: number) => (
            <div key={textOf(item.id || idx)} className="rounded-xl border border-white bg-white/80 p-3 dark:border-white/10 dark:bg-white/5">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-lg bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-200">{textOf(item.id || `S${idx + 1}`)}</span>
                <span className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{textOf(item.title || `分镜 ${idx + 1}`)}</span>
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-300">{textOf(item.scene || item.video_prompt || item.keyframe_prompt)}</p>
            </div>
          ))}
        </div>
      )}
      {keyframes.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {keyframes.slice(0, 6).map((item: any, idx: number) => (
            <div key={textOf(item.id || idx)} className="overflow-hidden rounded-xl border border-white bg-white dark:border-white/10 dark:bg-white/5">
              <div className="aspect-video bg-gray-100 dark:bg-gray-950">
                {textOf(item.image_url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <Image src={textOf(item.image_url)} alt="" width={640} height={360} sizes="(max-width: 768px) 100vw, 50vw" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-400">关键帧生成中</div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{textOf(item.title || item.id || `关键帧 ${idx + 1}`)}</span>
                {Number(item.retry_count || 0) > 0 && <span className="text-[10px] text-amber-600">重试 {Number(item.retry_count)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {segments.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {segments.slice(0, 6).map((item: any, idx: number) => (
            <div key={textOf(item.id || idx)} className="overflow-hidden rounded-xl border border-white bg-white dark:border-white/10 dark:bg-white/5">
              <div className="aspect-video bg-black">
                {textOf(item.video_url) ? (
                  <video src={textOf(item.video_url)} controls className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-400">视频生成中</div>
                )}
              </div>
              <div className="px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200">{textOf(item.title || item.id || `视频段 ${idx + 1}`)}</div>
            </div>
          ))}
        </div>
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
  return (
    <div className="rounded-2xl border border-cyan-100 bg-white p-3 dark:border-cyan-400/20 dark:bg-white/5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-white">最终合成视频</div>
        <a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium text-secondary">打开</a>
      </div>
      <video src={url} controls className="max-h-[420px] w-full rounded-xl bg-black object-contain" />
    </div>
  );
}

function DetailPagePanel({ detailPage }: { detailPage: DetailPageOutput }) {
  const { t } = useI18n();
  const sections = Array.isArray(detailPage.sections) ? detailPage.sections : [];
  const longURL = textOf(detailPage.long_image_url);
  return (
    <div className="space-y-3 rounded-2xl border border-amber-100 bg-amber-50/50 p-4 dark:border-amber-400/15 dark:bg-amber-400/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{t("agent.detailPage.title")}</div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-300">
            {t("agent.detailPage.completed")} {Number(detailPage.completed_count || sections.length)}/{Number(detailPage.section_count || sections.length)} {t("agent.detailPage.modules")}
          </div>
        </div>
        <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-200">
          {detailPage.compose_status === "succeeded" ? t("agent.detailPage.longReady") : t("agent.detailPage.modulesReady")}
        </span>
      </div>
      {longURL && (
        <div className="overflow-hidden rounded-xl border border-white bg-white dark:border-white/10 dark:bg-gray-950">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-white/10">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t("agent.detailPage.finalLong")}</span>
            <a href={longURL} target="_blank" rel="noreferrer" download className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-200"><Download size={14} />{t("agent.detailPage.downloadLong")}</a>
          </div>
          <div className="max-h-[620px] overflow-y-auto bg-gray-50 p-2 dark:bg-gray-950">
            <Image src={longURL} alt="商品详情长图" width={1200} height={6000} sizes="(max-width: 768px) 100vw, 900px" className="mx-auto h-auto w-full max-w-3xl" />
          </div>
        </div>
      )}
      {sections.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((section, index) => (
            <div key={textOf(section.id || index)} className="rounded-xl border border-white bg-white/80 p-3 dark:border-white/10 dark:bg-white/5">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-200">{index + 1}</span>
                <span className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{textOf(section.title || section.copy_title || `详情模块 ${index + 1}`)}</span>
              </div>
              {section.objective && <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-300">{section.objective}</p>}
            </div>
          ))}
        </div>
      )}
      {detailPage.compose_status === "skipped" && detailPage.compose_error && (
        <p className="text-xs text-amber-700 dark:text-amber-200">{t("agent.detailPage.composeSkipped")} {detailPage.compose_error}</p>
      )}
    </div>
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
            generationType={generationType}
            mediaHeight={mediaHeight}
            onPreview={(url, type) => setPreview({ url, type })}
          />
        ))}
      </div>
      {preview && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="relative max-h-[88vh] w-full max-w-4xl rounded-2xl bg-black shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreview(null)} className="absolute right-3 top-3 z-10 w-9 h-9 rounded-xl border border-gray-200 bg-white/90 text-gray-900 flex items-center justify-center shadow dark:bg-gray-900/90 dark:text-white dark:border-white/10"><X size={16} /></button>
            {preview.type === "video" ? (
              <video src={preview.url} controls autoPlay className="max-h-[88vh] w-full object-contain" />
            ) : (
              <div className="relative">
                <a
                  href={preview.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="absolute left-3 top-3 z-10 flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white/90 px-3 text-sm font-medium text-gray-900 shadow dark:bg-gray-900/90 dark:text-white dark:border-white/10"
                  title={t("common.download")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download size={15} />
                  {t("common.download")}
                </a>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <Image src={preview.url} alt="" width={1600} height={900} sizes="100vw" className="max-h-[88vh] w-full object-contain" />
              </div>
            )}
          </div>
        </div>
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
            <video src={url} controls className="h-full w-full object-contain" />
            <button type="button" onClick={() => onPreview(url, "video")} className="absolute right-2 top-2 z-20 rounded-lg border border-white/20 bg-gray-950/85 px-2.5 py-1 text-xs font-medium text-white shadow-lg backdrop-blur hover:bg-gray-900 dark:bg-gray-900/90 dark:text-white dark:border-white/10 dark:hover:bg-gray-800">{t("common.preview")}</button>
          </div>
        ) : url && generationType !== "video" && succeeded && !imageFailed ? (
          <div className="relative h-full w-full">
            <button type="button" onClick={() => onPreview(url, "image")} className="h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <Image src={url} alt="" width={1280} height={720} sizes="(max-width: 768px) 100vw, 50vw" onError={() => setImageFailed(true)} className="w-full h-full object-contain" />
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
