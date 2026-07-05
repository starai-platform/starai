"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, Download, HelpCircle, History, Loader2, Plus, RefreshCw, Wand2, X } from "lucide-react";
import { api, uploadAsset } from "@/lib/api";
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
  input?: { image_label?: string; placeholder?: string; modes?: string[] };
  help?: string;
};
type Workflow = {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
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
  };
};
type NodeRun = { node_id: string; name: string; type: string; status: string; output: Record<string, any>; error?: string };
type MediaTask = { task_no: string; status: string; progress: number; output?: Record<string, any>; error_message?: string };
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

function projectStage(project: Project | null, mediaTasks: MediaTask[], generationType: "image" | "video") {
  if (!project) return "开始";
  if (project.status === "waiting_confirm") return "方案确认";
  if (project.status === "succeeded") return "已完成";
  if (project.status === "failed") return "失败";
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
  const fallback = generationType === "video" ? "product_video" : "main_image";
  const allowed = new Set<string>(IMAGE_SCENES.filter((item) => item.kind === generationType).map((item) => item.code));
  const values = Array.isArray(items) ? items.map((item) => String(item)).filter((item) => allowed.has(item)) : [];
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
  };
  return [
    `当前用户选择的创作场景：${label} (${code})。`,
    rules[code] || `必须严格按照 ${label} 场景生成。`,
    `Generation type: ${generationType}. The selected scene is a hard requirement and must override any generic/default scene.`,
  ].join("\n");
}

export function AgentWorkspace({ code }: { code: string }) {
  const { t, td } = useI18n();
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
    api<Workflow>(`/api/agents/${code}`)
      .then((wf) => {
        setWorkflow(wf);
        setCount(Math.max(1, Number(wf.runtime_config?.default_count || 1)));
        const modelCode = wf.runtime_config?.generation_model_code;
        if (modelCode) {
          api<Model>(`/api/models/${modelCode}`)
            .then((m) => {
              setGenerationModel(m);
              setParams({ ...schemaDefaultsFromFields(m.input_schema), ...(m.default_params || {}) });
              if (typeof m.default_params?.channel_key === "string") {
                setBottom((prev) => ({ ...prev, channel_key: String(m.default_params.channel_key) }));
              }
            })
            .catch(() => setGenerationModel(null));
        } else {
          setGenerationModel(null);
          setParams({});
        }
      })
      .catch(() => setWorkflow(null));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [code]);

  const display = workflow?.display_config || {};
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
  const videoConfig = parseVideoRuntime(generationModel?.runtime_rule);
  const maxVideoAssetRefs =
    videoConfig.upload_profile === "frame_pair"
      ? videoConfig.reference_images?.max ?? 4
      : videoConfig.max_reference_images ?? 1;
  const analysis = useMemo(
    () => project?.outputs?.analysis || project?.node_runs?.find((n) => n.node_id === "analysis")?.output || {},
    [project]
  );
  const mediaTasks = useMemo(
    () => (project?.media_tasks?.length ? project.media_tasks : ((project?.outputs?.media_tasks || []) as MediaTask[])),
    [project]
  );
  const candidates = useMemo(() => analysisCandidates(analysis), [analysis]);
  const totalProgress = useMemo(() => {
    if (!project) return 0;
    if (mediaTasks.length) {
      return Math.round(mediaTasks.reduce((sum, t) => sum + statusProgress(t.status, t.progress), 0) / mediaTasks.length);
    }
    if (project.outputs?.current_step === "generate") return project.status === "running" ? 8 : 5;
    return statusProgress(project.status);
  }, [project, mediaTasks]);

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
    if (flow.enable_autopilot !== false) {
      setMode("auto");
    } else if (flow.enable_autopilot === false) {
      setMode("step");
    }
  }, [workflow]);

  useEffect(() => {
    if (!outputScenes.includes(selectedScene)) {
      const fallback = generationType === "video" ? "product_video" : "main_image";
      setSelectedScene(outputScenes.includes(fallback) ? fallback : outputScenes[0] || fallback);
    }
  }, [generationType, outputScenes, selectedScene]);

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
            generation_language: languageParams.language,
            generation_language_label: languageParams.language_label,
            count: Number((videoParams as any).count ?? (imageParams as any).count ?? params.count ?? count),
            n: Number((videoParams as any).count ?? (imageParams as any).n ?? params.count ?? count),
            image_url: imageURL || undefined,
            reference_asset_ids: referenceAssetIds,
            _mode: !enableStepConfirm || mode === "auto" ? "auto" : "step",
          },
        }),
      });
      setProject(p);
      startPolling(p.public_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "鍚姩澶辫触");
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
    await api(`/api/agent-projects/${project.public_id}/retry`, { method: "POST" });
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

  const handleUpload = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: "prop" });
      setProductImage({ url: asset.url, name: asset.name || file.name, public_id: asset.public_id });
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "缃戠粶杩炴帴澶辫触";
      setError(t("agent.uploadFailed") + message);
    } finally {
      setUploading(false);
    }
  };

  if (!workflow) return <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">鍔犺浇涓?..</div>;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#EEF1F6] dark:bg-gray-950">
      <div className="shrink-0 px-4 sm:px-6 py-3 flex items-center justify-between">
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

      <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-4">
        <div className="max-w-[1120px] mx-auto space-y-4">
          {!project && (
            <div className={"rounded-3xl border border-white/60 bg-gradient-to-br px-6 py-6 text-center shadow-sm dark:bg-none dark:bg-gray-900 dark:border-white/10 dark:shadow-none sm:px-8 " + theme.gradient}>
              <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
                {(display.hero_tags || ["AI Agent", "Step confirm", "Autopilot"]).map((tag) => (
                  <span key={tag} className={"rounded-full px-2.5 py-1 text-[11px] font-medium " + theme.pill}>{td("agent." + workflow.code + ".tag." + tag, tag)}</span>
                ))}
              </div>
              <div className="flex items-center justify-center gap-3">
                <div className={"flex h-14 w-14 items-center justify-center rounded-2xl text-3xl " + theme.iconBg}>{workflow.icon || "\u{1F916}"}</div>
                <div className="text-left">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">{workflowName}</h1>
                  {workflowDescription && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{workflowDescription}</p>}
                </div>
              </div>
            </div>
          )}
          <div className={project ? "grid gap-4" : "grid gap-4 lg:grid-cols-[330px_1fr]"}>
            {!project && (
              <div className="space-y-3">
                {translatedSteps.map((s, i) => {
                  const active = i === 0;
                  return (
                    <div key={s.title + i} className={"soft-card border-2 p-4 " + (active ? "border-primary shadow-md" : "border-transparent")}>
                      <div className="flex items-start gap-3">
                        <div className={"flex h-9 w-9 items-center justify-center rounded-xl text-lg " + (active ? theme.iconBg : "bg-gray-50 text-gray-400 dark:bg-white/5 dark:text-gray-500")}>{s.icon || "•"}</div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">{s.title}</div>
                          {s.subtitle && <div className="mt-0.5 text-[11px] leading-relaxed text-gray-400">{s.subtitle}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="soft-card p-5 sm:p-6 min-h-[320px]">
              {!project ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="input-status-line">
                    <span className="typing-status-text">
                      {generationType === "video" ? t("workspace.waitVideoInput") : t("workspace.waitImageInput")}
                    </span>
                    <span className="input-status-hint">
                      {t("agent.analysisHint")}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">{projectStage(project, mediaTasks, generationType)}</div>
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

                  {mediaTasks.length > 0 && <MediaTaskGrid tasks={mediaTasks} generationType={generationType} onMore={() => router.push("/app/works")} />}
                  {project.status === "failed" && (
                    <div className="rounded-2xl bg-red-50 border border-red-100 p-4 dark:bg-red-500/10 dark:border-red-400/20">
                      <p className="text-sm text-red-600 dark:text-red-300 mb-3">{project.error_message || t("workspace.generationFailed")}</p>
                      <button onClick={retry} className="h-9 px-4 rounded-xl bg-gray-900 text-white text-sm flex items-center gap-1.5"><RefreshCw size={15} />{t("common.retry")}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-3 sm:px-6 pb-5 sm:pb-6 pt-3 bg-[#EEF1F6] dark:bg-gray-950">
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
                <button onClick={() => setHelpOpen(true)} className="h-9 px-3 rounded-xl bg-gray-50 border border-gray-100 text-gray-600 text-sm flex items-center gap-1.5 hover:bg-white transition dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"><HelpCircle size={15} />{t("agent.help")}</button>
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
                      <img src={productImage.url} alt={productImage.name} className="w-full h-full object-cover" />
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
                <SceneOptionMenu scenes={outputScenes} value={selectedScene} onChange={setSelectedScene} />
                {isVideoGeneration && generationModel ? (
                  <>
                    <VideoOptionToolbar schema={generationModel.input_schema} values={params} onChange={setParams} videoConfig={videoConfig} countUnit={t("unit.video")} />
                    <GenerationLanguageMenu languages={generationLanguages} value={languageCode} onChange={setLanguageCode} />
                  </>
                ) : (
                  <>
                    <ImageGenerationToolbar
                      count={count}
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
                <img src={preview.url} alt="" className="max-h-[88vh] w-full object-contain" />
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
        <span className="text-xs text-gray-400">#{index + 1}</span>
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
              <img src={url} alt="" onError={() => setImageFailed(true)} className="w-full h-full object-contain" />
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

