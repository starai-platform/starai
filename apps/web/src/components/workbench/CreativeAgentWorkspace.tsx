"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readEventStream } from "@/lib/eventStream";
import Link from "next/link";
import { ArrowUp, AudioLines, BrainCircuit, ChevronDown, ChevronRight, Download, Globe, HelpCircle, History, ImageIcon, Loader2, Maximize2, Menu, Music2, Plus, RotateCcw, SlidersHorizontal, Sparkles, Upload, UserRound, Video, X } from "lucide-react";
import type { Model, User } from "@starai/shared-types";
import { API_URL, api, legacyAuthHeaders, uploadAsset } from "@/lib/api";
import { useSiteBranding } from "@/components/SiteBrand";
import { WorkbenchTopActions } from "@/components/WorkbenchTopActions";
import { AgentLanding } from "./AgentLanding";
import { AgentIcon } from "./AgentIcon";
import { ChatTopTools, type BottomBarState } from "./BottomBar";
import { AGENT_THEMES } from "./categoryMeta";
import { finalWorkflowMedia, workflowMaterials, workflowSuccessMessage, updateWorkflowMessages, type TaskState, type WorkflowMessage } from "./creativeAgentWorkflow";

type Attachment = { public_id: string; name: string; url: string; kind?: string };
type SearchResult = { title: string; url: string; snippet?: string; published_date?: string };
type SearchTrace = { queries?: string[]; searched_count?: number; browsed_count?: number; duration_ms?: number };
type Artifact = { kind: string; text: string };
type Message = WorkflowMessage & { artifact?: Artifact; plan?: Plan; planState?: "pending" | "submitted" | "cancelled"; attachments?: Attachment[]; sources?: SearchResult[]; searchTrace?: SearchTrace; searchWarning?: string; searchRequired?: boolean; retryText?: string };
type Plan = { artifact?: Artifact; plan_version?: number; draft_status?: string; slots?: Record<string, unknown>; missing_fields?: string[]; intent?: string; model_code?: string; workflow_code?: string; reply?: string; prompt?: string; params?: Record<string, unknown>; needs_confirm?: boolean };
type AgentDraft = { version: number; status: string; slots: Record<string, unknown>; plan?: Plan; execution_ref?: string; execution_kind?: string; error?: string };
type ReplanResult = { changed: boolean; draft: AgentDraft; changes?: string[] };
type HistoryItem = { public_id: string; title?: string | null; updated_at: string };
type AgentConfig = { icon?: string; runtime_config?: { analysis_model_code?: string; image_model_code?: string; video_model_code?: string; speech_model_code?: string; music_model_code?: string } };
type AgentEvent = { type?: string; asset_ids?: string[]; task_no?: string; project_id?: string; workflow_code?: string; media_type?: string; prompt?: string; role_id?: number; role_name?: string; role_prompt?: string; role_icon_url?: string; search_results?: SearchResult[]; search_trace?: SearchTrace; search_warning?: string };
type AssetRecord = { public_id: string; name?: string; url: string; kind?: string; mime_type?: string };
type MediaSet = { images: string[]; videos: string[]; audios: string[] };
type MediaPreview = { url: string; type: "image" | "video" };
type GenerationType = "image" | "video" | "speech" | "music";
type AgentPlanResponse = { conversation_id?: string; plan?: Plan; search_required?: boolean; search_hint?: string; search_results?: SearchResult[]; search_trace?: SearchTrace; search_warning?: string };

const HOT_PROMPTS = ["生成一套小红书图文笔记和 4 张配图", "根据角色参考图生成 40-50 秒完整短剧", "生成一张产品主图", "做一个 10 秒产品展示视频"];
const CREATIVE_FEATURES = [
  { icon: "✦", title: "理解并连续创作", subtitle: "从自然语言识别目标，自动整理提示词并衔接上一轮结果" },
  { icon: "🖼️", title: "图片与内容图文", subtitle: "支持单图、连续改图，以及标题正文与多张配图的一体化生成" },
  { icon: "🎬", title: "短剧工作流", subtitle: "自动完成剧本、分镜、分段生成与成片合成" },
  { icon: "🎵", title: "语音与音乐", subtitle: "分别调用文本转语音或歌曲音乐模型完成创作" },
];
const MOBILE_FEATURE_ICONS = [Sparkles, ImageIcon, Video, AudioLines];

async function streamAgentPlan(payload: Record<string, unknown>, onEvent: (event: string, data: AgentPlanResponse & { content?: string; message?: string }) => void) {
  const locale = typeof window === "undefined" ? "zh-CN" : localStorage.getItem("site_locale") || "zh-CN";
  const response = await fetch(`${API_URL}/api/creative-agent/plan`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": locale,
      "X-Locale": locale,
      ...legacyAuthHeaders(),
    },
    body: JSON.stringify({ ...payload, stream: true }),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("text/event-stream")) {
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || "智能体分析失败");
    return body.data as AgentPlanResponse;
  }

  if (!response.body) throw new Error("当前浏览器不支持流式输出");
  let meta: AgentPlanResponse = {};
  let result: AgentPlanResponse = {};
  for await (const { event, data: raw } of readEventStream(response.body)) {
    if (raw === "[DONE]") continue;
    const data = JSON.parse(raw) as AgentPlanResponse & { content?: string; message?: string };
    if (event === "meta") meta = { ...meta, ...data };
    if (event === "done") result = { ...meta, ...data };
    if (event === "error") throw new Error(data.message || "智能体生成失败");
    onEvent(event, data);
  }
  return result;
}

function urls(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(urls);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return urls(item.url || item.image_url || item.video_url || item.result_url);
  }
  return [];
}

function taskMedia(output?: Record<string, unknown>, mediaType?: string) {
  if (!output) return { images: [] as string[], videos: [] as string[], audios: [] as string[] };
  const images = [...urls(output.image_url), ...urls(output.images)];
  const videos = [...urls(output.video_url), ...urls(output.videos)];
  const audios = [...urls(output.audio_url), ...urls(output.audios)];
  const generic = [...urls(output.url), ...urls(output.urls), ...urls(output.results), ...urls(output.data)];
  if (mediaType === "video" || (videos.length > 0 && images.length === 0)) videos.push(...generic);
  else if (mediaType === "audio" || audios.length > 0) audios.push(...generic);
  else images.push(...generic);
  return { images: Array.from(new Set(images)), videos: Array.from(new Set(videos)), audios: Array.from(new Set(audios)) };
}

function runMedia(run: TaskState) {
  if (run.outputs) return workflowMaterials(run);
  return taskMedia(run.output, run.type);
}

function runProgress(run: TaskState) {
  if (typeof run.progress === "number") return run.progress;
  if (run.status === "succeeded") return 100;
  const outputs = run.outputs || {};
  const step = run.current_step || String(outputs.current_step || "");
  if (run.workflow_code === "content_image_post" || run.inputs?.creative_scene === "content_image_post" || Boolean(outputs.content_post)) {
    if (step === "result") return 100;
    if (step === "generate") {
      const total = Math.max(2, Number(run.inputs?.image_count) || 4);
      const completed = (run.media_tasks || []).filter((item) => item.type === "image" && item.status === "succeeded").length;
      const active = [...(run.media_tasks || [])].reverse().find((item) => item.type === "image" && item.status !== "succeeded" && item.status !== "failed");
      return Math.round(35 + 60 * Math.min(1, (completed + Math.min(0.95, Number(active?.progress || 0) / 100)) / total));
    }
    return step === "confirm" ? 35 : run.status === "pending" ? 3 : 10;
  }
  const plan = outputs.comic_drama && typeof outputs.comic_drama === "object" ? outputs.comic_drama as Record<string, unknown> : {};
  const total = Math.max(1, Array.isArray(plan.storyboards) ? plan.storyboards.length : Number(run.inputs?.storyboard_grid) || 1);
  const completed = (value: unknown, key: string) => Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && Boolean((item as Record<string, unknown>)[key]) && (item as Record<string, unknown>).status !== "failed").length : 0;
  const active = (type: string) => [...(run.media_tasks || [])].reverse().find((item) => item.type === type && item.status !== "succeeded" && item.status !== "failed");
  const fraction = (type: string) => Math.max(0, Math.min(0.95, Number(active(type)?.progress || 0) / 100));
  if (step === "result") return 100;
  if (step === "compose") return 94;
  if (step === "narrations") return Math.round(80 + 12 * Math.min(1, (completed(outputs.narrations, "audio_url") + fraction("audio")) / total));
  if (step === "video_segments") return Math.round(40 + 40 * Math.min(1, (completed(outputs.segments, "video_url") + fraction("video")) / total));
  if (step === "keyframes") return Math.round(20 + 20 * Math.min(1, (completed(outputs.keyframes, "image_url") + fraction("image")) / total));
  if (step === "storyboard_confirm") return 20;
  return run.status === "pending" ? 3 : 8;
}

function wantsWorkflowResume(text: string) {
  return !/(为什么|这是什么|解释|不要|别|取消|停止|重新开始|从头开始|新建一版|重新做一版)/.test(text) && /^(请|帮我)?(继续|接着|续传|重试|恢复|换.{0,12}模型|切换.{0,12}模型)/.test(text.trim());
}

function mentionedVideoModel(text: string, models: Model[]) {
  const value = text.toLowerCase();
  return models.find((model) => [model.code, model.display_name].some((name) => name && value.includes(name.toLowerCase())))?.code || "";
}

const WORKFLOW_STAGES = [
  ["comic_plan", "故事与分镜"],
  ["keyframes", "角色关键帧"],
  ["video_segments", "分段视频"],
  ["narrations", "对白配音"],
  ["compose", "成片合成"],
] as const;

const CONTENT_IMAGE_STAGES = [
  ["analysis", "内容策划"],
  ["generate", "卡片配图"],
] as const;

function WorkflowRunCard({ task, busy, onRetry }: { task: TaskState; busy: boolean; onRetry: () => void }) {
  const progress = runProgress(task);
  const step = task.current_step || String(task.outputs?.current_step || "");
  const latestRuns = new Map<string, string>();
  for (const run of task.node_runs || []) if (run.node_id) latestRuns.set(run.node_id, run.status || "pending");
  const media = runMedia(task);
  const contentImage = task.workflow_code === "content_image_post" || task.inputs?.creative_scene === "content_image_post" || Boolean(task.outputs?.content_post);
  const stages = contentImage ? CONTENT_IMAGE_STAGES : WORKFLOW_STAGES;
  const plan = task.outputs?.comic_drama && typeof task.outputs.comic_drama === "object" ? task.outputs.comic_drama as Record<string, unknown> : {};
  const contentPost = task.outputs?.content_post && typeof task.outputs.content_post === "object" ? task.outputs.content_post as Record<string, unknown> : {};
  const outline = contentImage
    ? [contentPost.title, contentPost.hook, contentPost.body, Array.isArray(contentPost.hashtags) ? contentPost.hashtags.join(" ") : ""].filter(Boolean).join("\n\n")
    : typeof plan.outline === "string" ? plan.outline : typeof plan.intent === "string" ? plan.intent : "";
  const isActive = task.status === "pending" || task.status === "running";
  const title = contentImage ? "内容创作工作流" : "成片工作流";

  return (
    <div className="soft-card mx-auto mt-4 max-w-5xl overflow-hidden px-4 py-4 text-xs text-gray-500 dark:text-gray-300">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><div className="font-semibold text-gray-800 dark:text-white">{title} · {task.public_id}</div><div className="mt-0.5 truncate">{task.status === "failed" ? task.error_message || "生成失败" : task.status === "succeeded" ? contentImage ? "图文内容已完成" : "成片已完成" : `正在执行：${stages.find(([id]) => id === step)?.[1] || "准备任务"}`}</div></div>
        <div className="flex shrink-0 items-center gap-2"><span className="font-mono text-sm font-semibold text-primary">{progress}%</span>{task.status === "failed" ? <button type="button" disabled={busy} onClick={onRetry} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 font-medium text-white disabled:opacity-50"><RotateCcw size={13} />按当前模型续传</button> : isActive ? <Loader2 size={17} className="animate-spin text-primary" /> : null}</div>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className={`h-full rounded-full bg-gradient-to-r from-cyan-500 via-primary to-emerald-400 transition-all duration-700 ${isActive ? "animate-pulse" : ""}`} style={{ width: `${progress}%` }} />
      </div>
      <div className={`mt-3 grid gap-1.5 ${contentImage ? "grid-cols-2" : "grid-cols-5"}`}>
        {stages.map(([id, label], index) => {
          const state = latestRuns.get(id);
          const active = step === id || (id === "comic_plan" && step === "storyboard_confirm");
          const done = task.status === "succeeded" || state === "succeeded" || (!active && stages.findIndex(([stage]) => stage === step) > index);
          return <div key={id} className={`rounded-lg border px-2 py-2 text-center transition ${active && isActive ? "border-primary/40 bg-primary/10 text-primary" : done ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-400/20 dark:bg-emerald-400/10" : state === "failed" ? "border-red-200 bg-red-50 text-red-500" : "border-gray-100 bg-gray-50 text-gray-400 dark:border-white/5 dark:bg-white/5"}`}><div className="mb-1 text-sm">{done ? "✓" : active && isActive ? "●" : state === "failed" ? "!" : "○"}</div><div className="truncate">{label}</div></div>;
        })}
      </div>
      <details className="group mt-3 rounded-xl border border-gray-100 p-3 dark:border-white/10">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-gray-700 dark:text-gray-200">
          <span>{contentImage ? `内容与配图 · 图片 ${media.images.length}` : `过程素材 · 图片 ${media.images.length} · 分段视频 ${media.videos.length} · 配音 ${media.audios.length}`}</span>
          <ChevronDown size={15} className="shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        {outline ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 leading-5 text-gray-600 dark:bg-white/5 dark:text-gray-300">{outline}</p> : null}
        {media.images.length ? <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{media.images.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} loading="lazy" alt={contentImage ? `内容配图 ${index + 1}` : `已完成关键帧 ${index + 1}`} className="h-20 w-20 shrink-0 rounded-lg object-cover" /></a>)}</div> : null}
        {media.videos.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{media.videos.map((url, index) => <div key={url}><p className="mb-1">分段视频 {index + 1}</p><video src={url} controls preload="none" className="w-full rounded-lg bg-black" aria-label={`分段视频 ${index + 1}`} /></div>)}</div> : null}
        {media.audios.length ? <div className="mt-3 space-y-2">{media.audios.map((url, index) => <audio key={url} src={url} controls preload="none" className="w-full" aria-label={`配音 ${index + 1}`} />)}</div> : null}
        {!outline && !media.images.length && !media.videos.length && !media.audios.length ? <p className="mt-2">素材生成后会逐步显示在这里。</p> : null}
      </details>
    </div>
  );
}

function taskReferences(input?: Record<string, unknown>) {
  if (!input) return { images: [], videos: [], audios: [] };
  return {
    images: Array.from(new Set([...urls(input.reference_images), ...urls(input.first_frame), ...urls(input.last_frame)])),
    videos: Array.from(new Set([...urls(input.reference_videos), ...urls(input.source_video)])),
    audios: Array.from(new Set([...urls(input.reference_audio), ...urls(input.reference_audios)])),
  };
}

function isMusicModel(model: Model) {
  const audio = (model.runtime_rule?.audio || {}) as Record<string, unknown>;
  return audio.input_layout === "dual" || /(music|suno|音乐|歌曲)/i.test(`${model.code} ${model.display_name || ""} ${(model.tags || []).join(" ")}`);
}

function activeAgentChatModel(chats: Model[], agent: AgentConfig) {
  const enabled = (chats || []).filter((item) => item.is_enabled !== false && item.category === "chat" && item.code !== "multi_collab_chat" && !/多模型协作|multi.?collab/i.test(`${item.code} ${item.display_name || ""}`));
  const configured = agent.runtime_config?.analysis_model_code;
  return enabled.find((item) => item.code === configured)?.code || enabled.find((item) => item.code === "chat_demo_v1")?.code || enabled[0]?.code || "";
}

function generationLabel(type: string) {
  return type === "video" ? "视频" : type === "speech" ? "语音" : type === "music" ? "歌曲音乐" : "图片";
}

function generationTypeIcon(type: GenerationType) {
  return type === "image" ? <ImageIcon size={15} /> : type === "video" ? <Video size={15} /> : type === "music" ? <Music2 size={15} /> : <AudioLines size={15} />;
}

function storedPlan(content: string): Plan | null {
  try {
    const value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Plan;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function storedEvent(content: string): AgentEvent | null {
  try {
    const value = JSON.parse(content) as AgentEvent;
    return value?.type?.startsWith("creative_agent_") ? value : null;
  } catch {
    return null;
  }
}

function renderAgentInline(text: string, sources: SearchResult[] = []): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[\d{1,3}\])/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-semibold text-gray-950 dark:text-white">{part.slice(2, -2)}</strong>;
    }
    const citation = part.match(/^\[(\d{1,3})\]$/);
    if (citation) {
      const source = sources[Number(citation[1]) - 1];
      return source ? (
        <a key={index} href={source.url} target="_blank" rel="noreferrer" title={source.title} className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-semibold leading-none text-primary hover:bg-primary/20">
          {citation[1]}
        </a>
      ) : <span key={index}>{part}</span>;
    }
    return <span key={index}>{part}</span>;
  });
}

function AgentRichText({ content, sources = [] }: { content: string; sources?: SearchResult[] }) {
  return (
    <div className="space-y-2.5 text-[14px] leading-7">
      {content.split(/\r?\n/).map((raw, index) => {
        const line = raw.trim();
        if (!line) return <div key={index} className="h-1" />;
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          const size = heading[1].length === 1 ? "text-xl" : heading[1].length === 2 ? "text-lg" : "text-base";
          return <div key={index} className={`${size} pt-1 font-bold tracking-tight text-gray-950 dark:text-white`}>{renderAgentInline(heading[2], sources)}</div>;
        }
        const bullet = line.match(/^[-*•]\s+(.+)$/);
        if (bullet) return <div key={index} className="flex gap-2 pl-1"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><div>{renderAgentInline(bullet[1], sources)}</div></div>;
        const numbered = line.match(/^(\d+)[.)、]\s*(.+)$/);
        if (numbered) return <div key={index} className="flex gap-2"><span className="mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-1 text-xs font-semibold text-primary">{numbered[1]}</span><div>{renderAgentInline(numbered[2], sources)}</div></div>;
        return <p key={index}>{renderAgentInline(line.replace(/^>\s*/, ""), sources)}</p>;
      })}
    </div>
  );
}

function SearchResearchTrace({ trace, sources = [] }: { trace: SearchTrace; sources?: SearchResult[] }) {
  const seconds = Math.max(1, Math.round((trace.duration_ms || 0) / 1000));
  return (
    <details open className="group mb-3 rounded-2xl border border-primary/15 bg-primary/[0.035] px-3 py-2.5 text-xs text-gray-500 dark:border-primary/20 dark:bg-primary/[0.06] dark:text-gray-300">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-gray-700 dark:text-gray-100">
        <Sparkles size={14} className="text-primary" />
        已完成深度搜索（用时 {seconds} 秒）
        <ChevronDown size={13} className="ml-auto transition group-open:rotate-180" />
      </summary>
      <div className="mt-2.5 space-y-2 border-l border-primary/20 pl-3 leading-5">
        <p>已理解问题，并行执行 {trace.queries?.length || 1} 组中英文检索。</p>
        <p><Globe size={13} className="mr-1 inline" />搜索到 {trace.searched_count || sources.length} 个网页，读取并整理 {trace.browsed_count || 0} 条有效资料。</p>
        {sources.length > 0 && (
          <div className="space-y-1">
            {sources.slice(0, 6).map((source, index) => (
              <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="block truncate underline-offset-2 hover:text-primary hover:underline">
                [{index + 1}] {source.title || source.url}
              </a>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export function CreativeAgentWorkspace({
  onOpenModelPicker,
  onOpenNav,
  onRecharge,
  walletBalance,
}: {
  onOpenModelPicker?: () => void;
  onOpenNav?: () => void;
  onRecharge?: () => void;
  walletBalance?: number;
}) {
  const { site_logo: siteLogo, site_name: siteName } = useSiteBranding();
  const [messages, setMessages] = useState<Message[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [prompt, setPrompt] = useState("");
  const [imageModels, setImageModels] = useState<Model[]>([]);
  const [videoModels, setVideoModels] = useState<Model[]>([]);
  const [speechModels, setSpeechModels] = useState<Model[]>([]);
  const [musicModels, setMusicModels] = useState<Model[]>([]);
  const [chatModelCode, setChatModelCode] = useState("");
  const [imageModelCode, setImageModelCode] = useState("");
  const [videoModelCode, setVideoModelCode] = useState("");
  const [defaultImageModelCode, setDefaultImageModelCode] = useState("");
  const [defaultVideoModelCode, setDefaultVideoModelCode] = useState("");
  const [speechModelCode, setSpeechModelCode] = useState("");
  const [musicModelCode, setMusicModelCode] = useState("");
  const [defaultSpeechModelCode, setDefaultSpeechModelCode] = useState("");
  const [defaultMusicModelCode, setDefaultMusicModelCode] = useState("");
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customMediaType, setCustomMediaType] = useState<GenerationType>("image");
  const [bottom, setBottom] = useState<BottomBarState>({
    channel_key: "price_first",
    fallback_enabled: true,
    web_search: false,
    timeout_sec: 30,
    asset_ids: [],
    files: [],
  });
  const [conversationId, setConversationId] = useState("");
  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  const [busy, setBusy] = useState(false);
  const confirmationInFlight = useRef(false);
  const draftRef = useRef<AgentDraft | null>(null);
  const assetsChangedRef = useRef(false);
  const sessionEpoch = useRef(0);
  const selectionEpoch = useRef(0);
  const restoringSelection = useRef(false);
  const [task, setTask] = useState<TaskState | null>(null);
  const [pendingRetry, setPendingRetry] = useState<{ run: TaskState; model: string; message: string; conversation: string } | null>(null);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyListLoading, setHistoryListLoading] = useState(false);
  const [historyLoadingId, setHistoryLoadingId] = useState("");
  const [activeFeature, setActiveFeature] = useState(0);
  const [agentIcon, setAgentIcon] = useState("✦");
  const [deepThink, setDeepThink] = useState(false);
  const [searchAvailable, setSearchAvailable] = useState(false);
  const [searchUnitPrice, setSearchUnitPrice] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [latestGeneratedMedia, setLatestGeneratedMedia] = useState<MediaSet>({ images: [], videos: [], audios: [] });
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);

  const refreshPlan = useCallback(async (checkOnly = true, selection: Record<string, unknown> = {}) => {
    const current = draftRef.current;
    const id = conversationIdRef.current;
    const epoch = sessionEpoch.current;
    if (!current || !id) throw new Error("请先打开当前会话");
    const result = await api<ReplanResult>("/api/creative-agent/replan", { method: "POST", body: JSON.stringify({ conversation_id: id, base_version: current.version, check_only: checkOnly, ...selection }) });
    if (sessionEpoch.current !== epoch) return result;
    draftRef.current = result.draft;
    if (result.changed && result.draft.plan) {
      const plan = result.draft.plan;
      setMessages((items) => [...items.map((item) => item.planState === "pending" ? { ...item, planState: "cancelled" as const } : item), {
        role: "assistant", content: [...(result.changes || []), plan.reply || "方案已更新，请确认后继续。"].join("\n"),
        ...(result.draft.status === "awaiting_confirmation" ? { plan, planState: "pending" as const } : {}),
      }]);
    }
    return result;
  }, []);

  useEffect(() => {
    if (restoringSelection.current) { restoringSelection.current = false; return; }
    selectionEpoch.current++;
    // Recalculate only the affected execution parameters from the saved draft.
    setMessages((current) => current.map((item) => item.planState === "pending" ? { ...item, planState: "cancelled" } : item));
    const draft = draftRef.current;
    const selectedConversationId = conversationIdRef.current;
    const epoch = sessionEpoch.current;
    if (draft && ["awaiting_confirmation", "refreshing"].includes(draft.status) && selectedConversationId) {
      draftRef.current = { ...draft, status: "refreshing" };
      const timer = window.setTimeout(() => {
        setBusy(true); setError("");
        void refreshPlan(false, { video_model_code: customEnabled ? videoModelCode : "", image_model_code: customEnabled ? imageModelCode : "", speech_model_code: customEnabled ? speechModelCode : "", music_model_code: customEnabled ? musicModelCode : "", replace_assets: true, asset_ids: [...bottom.asset_ids, ...bottom.files.map((file) => file.public_id)].filter(Boolean) })
          .catch(async (err) => {
            if (sessionEpoch.current !== epoch) return;
            draftRef.current = await api<AgentDraft>(`/api/creative-agent/state/${selectedConversationId}`).catch(() => draftRef.current);
            setError(err instanceof Error ? err.message : "方案更新失败，原需求已保留");
          }).finally(() => { if (sessionEpoch.current === epoch) setBusy(false); });
      }, 250);
      return () => window.clearTimeout(timer);
    }
  }, [customEnabled, customMediaType, imageModelCode, videoModelCode, speechModelCode, musicModelCode, bottom.files, bottom.asset_ids, refreshPlan]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api<Model[]>("/api/models?category=chat"), api<Model[]>("/api/models?category=image"), api<Model[]>("/api/models?category=video"), api<Model[]>("/api/models?category=audio"), api<AgentConfig>("/api/agents/general_creative_agent"), api<User>("/api/me").catch(() => null), api<{ web_search_enabled?: boolean; web_search_unit_price?: number }>("/api/system-configs/public").catch((): { web_search_enabled?: boolean; web_search_unit_price?: number } => ({}))])
      .then(([chats, images, videos, audios, agent, currentUser, publicConfig]) => {
        const enabled = (items: Model[]) => (items || []).filter((item) => item.is_enabled !== false);
        const nextImages = enabled(images);
        const nextVideos = enabled(videos);
        const nextAudios = enabled(audios);
        const nextSpeech = nextAudios.filter((item) => !isMusicModel(item));
        const nextMusic = nextAudios.filter(isMusicModel);
        setImageModels(nextImages);
        setVideoModels(nextVideos);
        setSpeechModels(nextSpeech);
        setMusicModels(nextMusic);
        const config = agent.runtime_config || {};
        setAgentIcon(agent.icon?.trim() || "✦");
        setChatModelCode(activeAgentChatModel(chats, agent));
        const defaultImage = nextImages.find((item) => item.code === config.image_model_code)?.code || nextImages[0]?.code || "";
        const defaultVideo = nextVideos.find((item) => item.code === config.video_model_code)?.code || nextVideos[0]?.code || "";
        setImageModelCode(defaultImage);
        setVideoModelCode(defaultVideo);
        setDefaultImageModelCode(defaultImage);
        setDefaultVideoModelCode(defaultVideo);
        const defaultSpeech = nextSpeech.find((item) => item.code === config.speech_model_code)?.code || nextSpeech[0]?.code || "";
        const defaultMusic = nextMusic.find((item) => item.code === config.music_model_code)?.code || nextMusic[0]?.code || "";
        setSpeechModelCode(defaultSpeech);
        setMusicModelCode(defaultMusic);
        setDefaultSpeechModelCode(defaultSpeech);
        setDefaultMusicModelCode(defaultMusic);
        setUser(currentUser);
        setSearchAvailable(publicConfig.web_search_enabled === true);
        setSearchUnitPrice(Math.max(0, Number(publicConfig.web_search_unit_price) || 0));
      })
      .catch(() => setError("模型列表加载失败，请稍后重试"));
  }, []);

  useEffect(() => {
    if (!task || ["succeeded", "failed", "cancelled", "canceled", "waiting_confirm"].includes(task.status)) return;
    let disposed = false;
    let timer: number;
    const poll = async () => {
      try {
          const next = await api<TaskState>(task.task_no ? `/api/tasks/${task.task_no}` : `/api/agent-projects/${task.public_id}`);
          if (disposed) return;
          setTask(next);
          if (next.public_id) setMessages((current) => updateWorkflowMessages(current, next));
          if (next.status === "succeeded") {
            const media = next.public_id ? finalWorkflowMedia(next) : runMedia(next);
            setLatestGeneratedMedia(media);
            if (!next.public_id) setMessages((current) => [...current, { role: "assistant", content: "生成完成", ...media }]);
          }
          if (["succeeded", "failed", "cancelled", "canceled", "waiting_confirm"].includes(next.status)) return;
      } catch { /* Retry transient polling failures without losing the run. */ }
      if (!disposed) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 2000);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [task]);

  useEffect(() => {
    if (messages.length > 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActiveFeature((current) => (current + 1) % CREATIVE_FEATURES.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  useEffect(() => {
    if (messages.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "end",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, busy, task?.progress, task?.status]);

  const assetIDs = useMemo(
    () => Array.from(new Set([...bottom.asset_ids, ...bottom.files.map((item) => item.public_id)])),
    [bottom.asset_ids, bottom.files]
  );
  const customModels = customMediaType === "video" ? videoModels : customMediaType === "speech" ? speechModels : customMediaType === "music" ? musicModels : imageModels;
  const customModelCode = customMediaType === "video" ? videoModelCode : customMediaType === "speech" ? speechModelCode : customMediaType === "music" ? musicModelCode : imageModelCode;
  const activeMobileFeature = CREATIVE_FEATURES[activeFeature] || CREATIVE_FEATURES[0];
  const ActiveMobileFeatureIcon = MOBILE_FEATURE_ICONS[activeFeature] || Sparkles;

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, Math.max(0, 10 - bottom.files.length));
    if (!selected.length) return;
    setUploading(true);
    setError("");
    try {
      const uploaded: BottomBarState["files"] = [];
      for (const file of selected) {
        const kind = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name) ? "image" : file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name) ? "video" : file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|aiff|aif|wma)$/i.test(file.name) ? "audio" : "doc";
        const asset = await uploadAsset(file, { name: file.name, kind, asset_type: "prop" });
        uploaded.push({ public_id: asset.public_id, url: asset.url, name: file.name });
      }
      setLatestGeneratedMedia({ images: [], videos: [], audios: [] });
      assetsChangedRef.current = true;
      setBottom((current) => ({ ...current, files: [...current.files, ...uploaded] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "素材上传失败");
    } finally {
      setUploading(false);
    }
  };

  const createGeneration = async (nextPlan: Plan, activeConversationId: string) => {
    const mediaType = nextPlan.intent;
    if (mediaType !== "image" && mediaType !== "video" && mediaType !== "speech" && mediaType !== "music") throw new Error("Agent 未能识别生成类型");
    const generationPrompt = nextPlan.prompt?.trim();
    if (!generationPrompt) throw new Error("Agent 未能生成有效提示词，请补充需求后重试");
    const result = await api<TaskState>("/api/creative-agent/generate", {
      method: "POST",
      body: JSON.stringify({
        confirmed: true,
        plan_version: nextPlan.plan_version,
        conversation_id: activeConversationId,
        media_type: mediaType,
        model_code: nextPlan.model_code,
        prompt: generationPrompt,
        params: nextPlan.params || {},
        asset_ids: assetIDs,
        reference_asset_ids: nextPlan.params?.use_previous_media ? [] : assetIDs,
        reference_image_urls: nextPlan.params?.use_previous_media ? latestGeneratedMedia.images : [],
        reference_video_urls: nextPlan.params?.use_previous_media ? latestGeneratedMedia.videos : [],
        reference_audio_urls: nextPlan.params?.use_previous_media ? latestGeneratedMedia.audios : [],
      }),
    });
    setTask(result);
    if (draftRef.current) draftRef.current = { ...draftRef.current, status: "submitted", execution_ref: result.task_no, execution_kind: "generation" };
    setMessages((current) => [...current, { role: "assistant", content: `已按确认方案创建${generationLabel(mediaType)}任务：${result.task_no}` }]);
  };

  const runWorkflow = async (nextPlan: Plan, activeConversationId: string) => {
    if (nextPlan.workflow_code !== "ai_comic_drama" && nextPlan.workflow_code !== "content_image_post") throw new Error("Agent 选择了暂不支持的工作流");
    const generationPrompt = nextPlan.prompt?.trim();
    if (!generationPrompt) throw new Error(nextPlan.workflow_code === "content_image_post" ? "Agent 未能整理出可执行的图文主题" : "Agent 未能整理出可执行的故事或短剧内容");
    const referenceImages = nextPlan.params?.use_previous_media ? Array.from(new Set(latestGeneratedMedia.images)) : [];
    const result = await api<TaskState>("/api/creative-agent/run-workflow", {
      method: "POST",
      body: JSON.stringify({
        confirmed: true,
        plan_version: nextPlan.plan_version,
        conversation_id: activeConversationId,
        workflow_code: nextPlan.workflow_code,
        prompt: generationPrompt,
        params: {
          ...(nextPlan.params || {}),
          image_model_code: imageModelCode,
          video_model_code: nextPlan.workflow_code === "ai_comic_drama" ? nextPlan.model_code : undefined,
        },
        asset_ids: assetIDs,
        reference_image_urls: referenceImages,
      }),
    });
    setTask(result);
    if (draftRef.current) draftRef.current = { ...draftRef.current, status: "submitted", execution_ref: result.public_id, execution_kind: "workflow" };
    setMessages((current) => updateWorkflowMessages(current, result));
  };

  const retryWorkflow = async (selectedVideoModel = videoModelCode, userMessage = "", run = task) => {
    if (!run?.public_id || busy) return;
    setPendingRetry({ run, model: selectedVideoModel, message: userMessage, conversation: conversationId });
  };

  const confirmWorkflowRetry = async () => {
    if (!pendingRetry || busy || pendingRetry.conversation !== conversationId) return;
    const { run, model: selectedVideoModel, message: userMessage } = pendingRetry;
    setPendingRetry(null);
    setBusy(true);
    setError("");
    try {
      // Resume the existing project; node-reset is reserved for explicit regeneration.
      await api(`/api/agent-projects/${run.public_id}/retry`, {
        method: "POST",
        body: JSON.stringify({
          confirmed: true,
          image_model_code: customEnabled ? imageModelCode : "",
          video_model_code: customEnabled || mentionedVideoModel(userMessage, videoModels) ? selectedVideoModel : "",
          conversation_id: conversationId,
          user_message: userMessage,
        }),
      });
      const next = await api<TaskState>(`/api/agent-projects/${run.public_id}`);
      setTask(next);
      setMessages((current) => updateWorkflowMessages(current, next));
      if (userMessage) setMessages((current) => [...current, { role: "assistant", content: "已从失败节点继续，已完成内容不会重新生成；未完成部分使用服务端当前配置的模型。" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "工作流重试失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmPlan = async (index: number) => {
    const message = messages[index];
    if (busy || confirmationInFlight.current || message?.planState !== "pending" || !message.plan || message.plan.plan_version !== draftRef.current?.version || draftRef.current?.status !== "awaiting_confirmation") return;
    confirmationInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const preflight = await refreshPlan(true);
      if (preflight.changed) return; // Show the difference; this click never authorizes a changed plan.
      setMessages((current) => current.map((item, i) => i === index ? { ...item, planState: "submitted" } : item));
      if (message.plan.intent === "workflow") await runWorkflow(message.plan, conversationId);
      else await createGeneration(message.plan, conversationId);
    } catch (err) {
      if (conversationId) draftRef.current = await api<AgentDraft>(`/api/creative-agent/state/${conversationId}`).catch(() => draftRef.current);
      setError((err instanceof Error ? err.message : "提交失败") + "；原需求已保留，可更新方案；已提交的任务请在历史中继续。");
    } finally {
      confirmationInFlight.current = false;
      setBusy(false);
    }
  };

  const cancelPlan = async (index: number) => {
    const version = messages[index]?.plan?.plan_version;
    if (!version || busy || confirmationInFlight.current) return;
    confirmationInFlight.current = true;
    setBusy(true);
    try {
      draftRef.current = await api<AgentDraft>("/api/creative-agent/cancel-plan", { method: "POST", body: JSON.stringify({ conversation_id: conversationId, plan_version: version }) });
      setMessages((current) => current.map((item) => item.planState === "pending" ? { ...item, planState: "cancelled" } : item));
    } catch (err) { setError(err instanceof Error ? err.message : "取消失败，请刷新会话状态"); }
    finally { confirmationInFlight.current = false; setBusy(false); }
  };

  const sendMessage = async (retryText = "", forceWebSearch = false) => {
    const text = (retryText || prompt).trim();
    if (!text || busy || !chatModelCode) return;
    if (["cancelling", "refreshing"].includes(draftRef.current?.status || "")) { setError("正在按当前选择更新方案，请稍后再发送。"); return; }
    const epoch = sessionEpoch.current;
    const selection = selectionEpoch.current;
    if (task?.public_id && (task.status === "pending" || task.status === "running") && wantsWorkflowResume(text)) {
      setMessages((current) => [...current, { role: "user", content: text }, { role: "assistant", content: `当前工作流正在执行：${task.current_step || "准备任务"}，无需重新创建，我会继续跟踪。` }]);
      if (!retryText) setPrompt("");
      return;
    }
    if (task?.public_id && task.status === "failed" && wantsWorkflowResume(text)) {
      const selectedVideoModel = mentionedVideoModel(text, videoModels) || videoModelCode;
      if (selectedVideoModel !== videoModelCode) setVideoModelCode(selectedVideoModel);
      setMessages((current) => [...current, { role: "user", content: text }]);
      if (!retryText) setPrompt("");
      await retryWorkflow(selectedVideoModel, text);
      return;
    }
    const cleanMessages = messages.filter((item) => !item.searchRequired).map((item) => item.planState === "pending" ? { ...item, planState: "cancelled" as const } : item);
    const lastMessage = cleanMessages[cleanMessages.length - 1];
    const nextMessages = retryText && lastMessage?.role === "user" && lastMessage.content === text
      ? cleanMessages
      : [...cleanMessages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    if (!retryText) setPrompt("");
    setError("");
    setBusy(true);
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    let requestConversationId = conversationId;
    try {
      const updateAssistant = (update: Partial<Message> | ((message: Message) => Message)) => setMessages((current) => {
        const next = [...current];
        const index = next.length - 1;
        if (index < 0 || next[index].role !== "assistant") return current;
        next[index] = typeof update === "function" ? update(next[index]) : { ...next[index], ...update };
        return next;
      });
      const result = await streamAgentPlan({
        base_version: draftRef.current?.version || 0,
        model_code: chatModelCode,
        video_model_code: customEnabled ? videoModelCode : "",
        image_model_code: customEnabled ? imageModelCode : "",
        speech_model_code: customEnabled ? speechModelCode : "",
        music_model_code: customEnabled ? musicModelCode : "",
        replace_assets: assetsChangedRef.current,
        reference_image_urls: latestGeneratedMedia.images,
        reference_video_urls: latestGeneratedMedia.videos,
        reference_audio_urls: latestGeneratedMedia.audios,
        conversation_id: conversationId,
        messages: [{ role: "user", content: text }],
        asset_ids: assetIDs,
        deep_think: deepThink,
        web_search: searchAvailable && (forceWebSearch || bottom.web_search),
        preferred_media_type: customEnabled ? customMediaType : "",
        role_id: bottom.role_id,
      }, (event, data) => {
        if (sessionEpoch.current !== epoch) return;
        if (event === "meta") {
          if (data.conversation_id) { requestConversationId = data.conversation_id; setConversationId(data.conversation_id); }
          updateAssistant({
            sources: data.search_results || [],
            searchTrace: data.search_trace?.queries?.length ? data.search_trace : undefined,
            searchWarning: data.search_warning || "",
          });
        } else if (event === "delta" && data.content) {
          updateAssistant((message) => ({ ...message, content: message.content + data.content }));
        }
      });
      if (sessionEpoch.current !== epoch) return;
      if (result.search_required) {
        updateAssistant({
          content: result.search_hint || "这个问题需要查询实时信息，请先启用智能搜索。",
          searchRequired: true,
          retryText: text,
        });
        return;
      }
      const activeConversationId = result.conversation_id || conversationId;
      if (activeConversationId) setConversationId(activeConversationId);
      const sourceMeta = {
        sources: result.search_results || [],
        searchTrace: result.search_trace?.queries?.length ? result.search_trace : undefined,
        searchWarning: result.search_warning || "",
      };
      const nextPlan = { ...(result.plan || { intent: "chat", reply: "暂时无法理解这次需求，请换一种说法。" }) };
      if (nextPlan.plan_version) draftRef.current = { version: nextPlan.plan_version, status: nextPlan.draft_status || "draft", slots: nextPlan.slots || {}, plan: nextPlan };
      if (selection !== selectionEpoch.current && nextPlan.plan_version && nextPlan.draft_status === "awaiting_confirmation") {
        draftRef.current = await api<AgentDraft>("/api/creative-agent/cancel-plan", { method: "POST", body: JSON.stringify({ conversation_id: activeConversationId, plan_version: nextPlan.plan_version }) });
        updateAssistant({ content: "模型或素材选择已变化，原需求已保留，请点击更新方案，无需重新描述。" });
        return;
      }
      assetsChangedRef.current = false;
      const nextIntent = nextPlan.intent;
      if (nextIntent === "workflow" || nextIntent === "image" || nextIntent === "video" || nextIntent === "speech" || nextIntent === "music") {
        updateAssistant({ content: nextPlan.reply || "方案已整理，请确认后开始生成。", plan: nextPlan, planState: "pending", ...sourceMeta });
      } else {
        updateAssistant({ content: nextPlan.reply || "请继续描述你的需求。", artifact: nextPlan.artifact, ...sourceMeta });
      }
    } catch (err) {
      if (requestConversationId && sessionEpoch.current === epoch) draftRef.current = await api<AgentDraft>(`/api/creative-agent/state/${requestConversationId}`).catch(() => draftRef.current);
      setMessages((current) => current[current.length - 1]?.role === "assistant" && !current[current.length - 1].content ? current.slice(0, -1) : current);
      setError(err instanceof Error ? err.message : "智能体分析失败");
    } finally {
      setBusy(false);
    }
  };

  const resetSession = () => {
    setPendingRetry(null);
    if (busy) return;
    sessionEpoch.current++;
    draftRef.current = null;
    assetsChangedRef.current = false;
    setMessages([]);
    setPrompt("");
    setTask(null);
    setConversationId("");
    setError("");
    setHistoryOpen(false);
    setCustomEnabled(false);
    setLatestGeneratedMedia({ images: [], videos: [], audios: [] });
    setImageModelCode(defaultImageModelCode);
    setVideoModelCode(defaultVideoModelCode);
    setSpeechModelCode(defaultSpeechModelCode);
    setMusicModelCode(defaultMusicModelCode);
    setBottom((current) => ({ ...current, asset_ids: [], files: [] }));
  };

  const openHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) return;
    setHistoryListLoading(true);
    api<HistoryItem[]>("/api/chat/conversations?scope=creative_agent")
      .then((items) => setHistoryItems(items || []))
      .catch((err) => setError(err instanceof Error ? err.message : "历史任务加载失败"))
      .finally(() => setHistoryListLoading(false));
  };

  const loadHistory = async (publicID: string) => {
    if (busy) return;
    setBusy(true);
    sessionEpoch.current++;
    draftRef.current = null;
    setHistoryLoadingId(publicID);
    setHistoryOpen(false);
    setError("");
    try {
      const [conversation, currentChatModel, draft] = await Promise.all([
        api<{ messages?: Array<{ role: string; content: string }> }>(`/api/chat/conversations/${publicID}`),
        Promise.all([api<Model[]>("/api/models?category=chat"), api<AgentConfig>("/api/agents/general_creative_agent")])
          .then(([chats, agent]) => activeAgentChatModel(chats, agent))
          .catch(() => null),
        api<AgentDraft>(`/api/creative-agent/state/${publicID}`),
      ]);
      if (currentChatModel !== null) setChatModelCode(currentChatModel);
      const restored: Message[] = [];
      const assetTargets: Array<{ messageIndex: number; assetIds: string[] }> = [];
      const taskTargets: Array<{ messageIndex: number; userMessageIndex: number; taskNo: string }> = [];
      const workflowTargets: Array<{ messageIndex: number; userMessageIndex: number; projectId: string }> = [];
      let restoredRole: Partial<BottomBarState> = {};
      for (const item of conversation.messages || []) {
        if (item.role === "user") {
          restored.push({ role: "user", content: item.content });
          continue;
        }
        if (item.role === "assistant") {
          const saved = storedPlan(item.content);
          restored.push({ role: "assistant", content: saved?.reply || saved?.prompt || item.content, artifact: saved?.artifact, ...(saved?.prompt ? { plan: saved, planState: "cancelled" as const } : {}) });
          continue;
        }
        const event = storedEvent(item.content);
        if (event?.type === "creative_agent_web_search") {
          for (let index = restored.length - 1; index >= 0; index -= 1) {
            if (restored[index].role === "assistant") {
              restored[index].sources = event.search_results || [];
              restored[index].searchTrace = event.search_trace;
              restored[index].searchWarning = event.search_warning || "";
              break;
            }
          }
          continue;
        }
        if (event?.type === "creative_agent_role") {
          restoredRole = event.role_id ? { role_id: event.role_id, role_name: event.role_name, role_prompt: event.role_prompt, role_icon_url: event.role_icon_url } : { role_id: undefined, role_name: undefined, role_prompt: undefined, role_icon_url: undefined };
          continue;
        }
        if ((event?.type === "creative_agent_assets" || event?.type === "creative_agent_generation" || event?.type === "creative_agent_workflow") && event.asset_ids?.length) {
          for (let index = restored.length - 1; index >= 0; index -= 1) {
            if (restored[index].role === "user") {
              assetTargets.push({ messageIndex: index, assetIds: event.asset_ids });
              break;
            }
          }
        }
        if (event?.type === "creative_agent_generation" && event.task_no) {
          const planned = [...restored].reverse().find((message) => message.plan);
          if (planned) planned.planState = "submitted";
          let userMessageIndex = -1;
          for (let index = restored.length - 1; index >= 0; index -= 1) {
            if (restored[index].role === "user") {
              userMessageIndex = index;
              break;
            }
          }
          const messageIndex = restored.push({ role: "assistant", content: `生成任务：${event.task_no}` }) - 1;
          taskTargets.push({ messageIndex, userMessageIndex, taskNo: event.task_no });
        }
        if (event?.type === "creative_agent_workflow" && event.project_id) {
          const planned = [...restored].reverse().find((message) => message.plan);
          if (planned) planned.planState = "submitted";
          let userMessageIndex = -1;
          for (let index = restored.length - 1; index >= 0; index -= 1) {
            if (restored[index].role === "user") {
              userMessageIndex = index;
              break;
            }
          }
          const messageIndex = restored.push({ role: "assistant", content: `短剧工作流：${event.project_id}` }) - 1;
          workflowTargets.push({ messageIndex, userMessageIndex, projectId: event.project_id });
        }
      }
      if (restored.length === 0) throw new Error("该历史会话暂无可恢复内容");
      if (draft.plan && draft.status === "awaiting_confirmation") {
        if (draft.error) restored.push({ role: "assistant", content: draft.error });
        const existing = restored.find((item) => item.plan?.plan_version === draft.version);
        if (existing) { existing.plan = draft.plan; existing.planState = "pending"; }
        else restored.push({ role: "assistant", content: draft.plan.reply || "待确认方案", plan: draft.plan, planState: "pending" });
      }
      if (draft.execution_ref && draft.execution_kind === "workflow" && !workflowTargets.some((item) => item.projectId === draft.execution_ref)) {
        workflowTargets.push({ messageIndex: restored.push({ role: "assistant", content: "恢复已提交工作流" }) - 1, userMessageIndex: -1, projectId: draft.execution_ref });
      } else if (draft.execution_ref && draft.execution_kind === "generation" && !taskTargets.some((item) => item.taskNo === draft.execution_ref)) {
        taskTargets.push({ messageIndex: restored.push({ role: "assistant", content: "恢复已提交任务" }) - 1, userMessageIndex: -1, taskNo: draft.execution_ref });
      }
      const draftAssetIds = Array.isArray(draft.slots.asset_ids) ? draft.slots.asset_ids.filter((id): id is string => typeof id === "string") : null;
      const allAssetIds = Array.from(new Set([...assetTargets.flatMap((item) => item.assetIds), ...(draftAssetIds || [])]));
      const [assets, tasks, workflows] = await Promise.all([
        Promise.all(allAssetIds.map((id) => api<AssetRecord>(`/api/assets/${encodeURIComponent(id)}`).catch(() => null))),
        Promise.all(taskTargets.map((item) => api<TaskState>(`/api/tasks/${encodeURIComponent(item.taskNo)}`).catch(() => null))),
        Promise.all(workflowTargets.map((item) => api<TaskState>(`/api/agent-projects/${encodeURIComponent(item.projectId)}`).catch(() => null))),
      ]);
      const assetMap = new Map(assets.filter((item): item is AssetRecord => !!item).map((item) => [item.public_id, item]));
      for (const target of assetTargets) {
        const items = target.assetIds.map((id) => assetMap.get(id)).filter((item): item is AssetRecord => !!item);
        restored[target.messageIndex].attachments = items.map((item) => ({ public_id: item.public_id, name: item.name || item.public_id, url: item.url, kind: item.kind }));
        restored[target.messageIndex].images = items.filter((item) => item.kind === "image" || item.mime_type?.startsWith("image/")).map((item) => item.url);
        restored[target.messageIndex].videos = items.filter((item) => item.kind === "video" || item.mime_type?.startsWith("video/")).map((item) => item.url);
        restored[target.messageIndex].audios = items.filter((item) => item.kind === "audio" || item.mime_type?.startsWith("audio/")).map((item) => item.url);
      }
      tasks.forEach((historyTask, index) => {
        if (!historyTask) return;
        const target = taskTargets[index];
        const media = taskMedia(historyTask.output, historyTask.type);
        const references = taskReferences(historyTask.input);
        if (target.userMessageIndex >= 0 && (references.images.length || references.videos.length || references.audios.length)) {
          restored[target.userMessageIndex].images = references.images;
          restored[target.userMessageIndex].videos = references.videos;
          restored[target.userMessageIndex].audios = references.audios;
        }
        restored[target.messageIndex] = {
          role: "assistant",
          content: historyTask.status === "succeeded" ? "生成完成" : historyTask.status === "failed" ? historyTask.error_message || "生成失败" : `生成中 ${historyTask.progress || 0}%`,
          images: media.images,
          videos: media.videos,
          audios: media.audios,
        };
      });
      workflows.forEach((workflow, index) => {
        if (!workflow) return;
        const target = workflowTargets[index];
        restored[target.messageIndex] = {
          role: "assistant",
          content: "",
          workflow,
        };
      });
      const allRuns = [
        ...tasks.map((run, index) => ({ run, position: taskTargets[index].messageIndex })),
        ...workflows.map((run, index) => ({ run, position: workflowTargets[index].messageIndex })),
      ].sort((a, b) => a.position - b.position).map((item) => item.run);
      const latestSucceededMedia = [...allRuns].reverse().reduce<MediaSet | null>((found, historyTask) => {
        if (found || !historyTask || historyTask.status !== "succeeded") return found;
        const media = historyTask.public_id ? finalWorkflowMedia(historyTask) : runMedia(historyTask);
        return media.images.length || media.videos.length || media.audios.length ? media : null;
      }, null);
      setLatestGeneratedMedia(latestSucceededMedia || { images: [], videos: [], audios: [] });
      setMessages(restored.flatMap((message) => {
        const result = message.workflow ? workflowSuccessMessage(message.workflow) : null;
        return result ? [message, result] : [message];
      }));
      // Historical attachments remain on their messages, not in the active draft.
      const currentAssets = draftAssetIds === null ? Array.from(assetMap.values()) : draftAssetIds.map((id) => assetMap.get(id)).filter((item): item is AssetRecord => !!item);
      const restoredFiles = currentAssets.map((item) => ({ public_id: item.public_id, url: item.url, name: item.name || item.public_id }));
      restoringSelection.current = true;
      setBottom((current) => ({ ...current, ...restoredRole, asset_ids: [], files: restoredFiles }));
      setConversationId(publicID);
      setPendingRetry(null);
      draftRef.current = draft;
      assetsChangedRef.current = false;
      const latestTask = [...allRuns].reverse().find((item): item is TaskState => !!item);
      setTask(latestTask || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "历史记录加载失败");
    } finally {
      setHistoryLoadingId("");
      setBusy(false);
    }
  };

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden bg-[#eaf7fb] text-gray-900 dark:bg-[#05080f] dark:text-white">
      <div className="pointer-events-none absolute inset-0 hidden opacity-80 [background-image:linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)] md:block" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(34,211,238,.22),transparent_28%),radial-gradient(circle_at_12%_84%,rgba(20,184,166,.16),transparent_22%)] dark:bg-[radial-gradient(circle_at_76%_10%,rgba(20,184,166,.2),transparent_28%),radial-gradient(circle_at_14%_82%,rgba(6,182,212,.12),transparent_22%)]" />

      {onOpenModelPicker && (
        <div className="relative z-50 flex shrink-0 items-center gap-2 border-b border-white/60 bg-white/70 px-3 py-2 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] lg:hidden">
          <button type="button" onClick={onOpenModelPicker} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-600 dark:bg-white/10 dark:text-gray-200" aria-label="返回模型列表"><ChevronDown size={16} className="rotate-90" /></button>
          {onOpenNav && <button type="button" onClick={onOpenNav} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-600 dark:bg-white/10 dark:text-gray-200" aria-label="打开菜单"><Menu size={18} /></button>}
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">Agent 通用智能体</div>
          <Link href="/app/wallet" className="shrink-0 text-xs font-medium tabular-nums text-primary">{walletBalance?.toFixed(0) ?? "0"}</Link>
        </div>
      )}

      <div className="relative z-50 flex shrink-0 items-center justify-between gap-2 border-b border-white/60 bg-white/35 px-3 py-1.5 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.02] sm:px-5 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button type="button" onClick={resetSession} disabled={busy} aria-label="新任务" className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-2.5 text-[13px] font-semibold text-dark shadow-sm transition hover:bg-primary/90 disabled:opacity-50 sm:px-3">
            <Plus size={15} /><span className="hidden sm:inline">新任务</span>
          </button>
          <div className="relative">
            <button type="button" onClick={openHistory} disabled={!!historyLoadingId} aria-label="历史" className="flex h-9 items-center gap-1.5 rounded-xl border border-gray-100 bg-white px-2.5 text-[13px] text-gray-600 shadow-sm transition hover:border-gray-200 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/20 sm:px-3">
              {historyLoadingId || historyListLoading ? <Loader2 size={15} className="animate-spin" /> : <History size={15} />}<span className="hidden sm:inline">{historyLoadingId || historyListLoading ? "加载中" : "历史"}</span><ChevronDown size={14} className="hidden sm:block" />
            </button>
            {historyOpen && (
              <div className="soft-card pointer-events-auto fixed left-4 right-4 top-[108px] z-[60] max-h-[60vh] overflow-y-auto p-2 sm:absolute sm:left-0 sm:right-auto sm:top-auto sm:mt-2 sm:w-[320px]">
                {historyListLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-xs text-gray-400"><Loader2 size={14} className="animate-spin" />正在加载历史任务</div>
                ) : historyItems.length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-400">暂无历史任务</div>
                ) : historyItems.map((item) => (
                  <button key={item.public_id} type="button" onClick={() => void loadHistory(item.public_id)} disabled={!!historyLoadingId} className="w-full rounded-xl px-3 py-2 text-left transition hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-white/5">
                    <div className="truncate text-sm text-gray-800 dark:text-gray-100">{item.title?.replace(/^(?:Agent 通用智能体|Ageng 通用智能体|Agneg 通用智能体|通用智能体)：/, "") || item.public_id}</div>
                    <div className="mt-0.5 text-[10px] text-gray-400">{historyLoadingId === item.public_id ? "正在打开..." : new Date(item.updated_at).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <WorkbenchTopActions onRecharge={onRecharge} />
      </div>

      <div className={messages.length === 0 ? "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-1 sm:px-5 sm:py-3 lg:px-8 lg:py-4" : "relative z-10 min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4"}>
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-2 text-center md:hidden">
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-primary/15 text-primary"><AgentIcon value={agentIcon} fallback="✦" alt="Agent 通用智能体" /></div>
              <h1 className="mt-2 text-lg font-bold text-gray-950 dark:text-gray-50">Agent 通用智能体</h1>
              <p className="mt-1 max-w-sm text-xs leading-5 text-gray-600 dark:text-gray-300">说出目标，连续完成图片、视频、语音或音乐创作。</p>
              <div className="mt-3 grid w-full max-w-sm grid-cols-2 gap-1.5">
                {HOT_PROMPTS.map((item) => <button key={item} type="button" onClick={() => setPrompt(item)} className="min-h-9 rounded-xl border border-gray-200 bg-white/70 px-2 py-1.5 text-xs leading-4 text-gray-600 transition active:scale-[.98] dark:border-white/10 dark:bg-white/5 dark:text-gray-300">{item}</button>)}
              </div>
              <button type="button" onClick={() => setPrompt(HOT_PROMPTS[activeFeature] || HOT_PROMPTS[0])} className="mt-3 flex w-full max-w-sm items-center gap-3 rounded-xl border border-cyan-200/70 bg-white/75 p-3 text-left shadow-sm backdrop-blur transition active:scale-[.98] dark:border-cyan-400/20 dark:bg-white/[0.05]" aria-label={`快捷创作：${activeMobileFeature.title}`}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><ActiveMobileFeatureIcon size={20} /></div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{activeMobileFeature.title}</h2>
                    <p className="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">{activeMobileFeature.subtitle}</p>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-cyan-600 dark:text-cyan-300" />
              </button>
            </div>
            <div className="hidden min-h-0 flex-1 md:flex">
              <AgentLanding
              workflowIcon={agentIcon}
              workflowName="Agent 通用智能体"
              workflowDescription="一句话理解创作目标，连续完成图片、视频、语音与音乐任务；上一轮结果可直接衔接下一轮。"
              heroTags={HOT_PROMPTS}
              features={CREATIVE_FEATURES}
              activeIndex={activeFeature}
              onSelect={setActiveFeature}
              theme={AGENT_THEMES.comic}
              generationType="mixed"
              compactOnMobile
            />
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-5xl space-y-4 py-2">
            {messages.map((message, index) => (
              <div key={`${index}-${message.role}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`flex max-w-[96%] items-start gap-2.5 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/80 bg-white shadow-sm dark:border-white/10 dark:bg-gray-900">
                    {message.role === "assistant" ? (
                      <img src={siteLogo || "/assets/default-app-icon.svg"} alt={siteName || "Agent"} className="h-full w-full object-cover" />
                    ) : user?.avatar_url ? (
                      <img src={user.avatar_url} alt={user.nickname || "用户"} className="h-full w-full object-cover" />
                    ) : (
                      <UserRound size={18} className="text-gray-400" />
                    )}
                  </div>
                  <div className={`min-w-0 max-w-[calc(100%_-_46px)] text-sm leading-6 ${message.workflow ? "w-[min(78vw,900px)]" : message.resultRunId ? "w-[min(78vw,720px)]" : ""}`}>
                    {message.searchTrace ? <SearchResearchTrace trace={message.searchTrace} sources={message.sources} /> : null}
                    {message.content && !(message.content === "生成完成" && (message.images?.length || message.videos?.length || message.audios?.length)) ? (
                      message.role === "user" ? (
                        <div className="ml-auto w-fit max-w-full whitespace-pre-wrap rounded-2xl bg-primary px-4 py-3 text-dark shadow-sm">{message.content}</div>
                      ) : (
                        <div className="w-full max-w-full rounded-2xl border border-white/80 bg-white px-4 py-3 text-gray-700 shadow-sm dark:border-white/10 dark:bg-gray-900 dark:text-gray-200">
                          <AgentRichText content={message.content} sources={message.sources} />
                        </div>
                      )
                    ) : null}
                    {message.artifact?.text ? <details className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-3"><summary className="cursor-pointer text-xs font-medium">已整理的生成提示词 · 尚未执行</summary><div className="mt-2 whitespace-pre-wrap text-sm">{message.artifact.text}</div><button type="button" className="mt-2 text-xs text-primary" onClick={() => void navigator.clipboard.writeText(message.artifact!.text).catch(() => setError("复制失败，请选择提示词正文手动复制"))}>复制完整提示词</button></details> : null}
                    {message.plan ? (
                      <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                        <div className="text-xs text-gray-500">{message.planState === "pending" ? "待确认 · 确认后会调用模型并产生相应费用" : message.planState === "submitted" ? message.plan.plan_version ? "已提交确认方案" : "历史已执行任务（旧版）" : "历史或已失效方案 · 更新后确认即可继续"}</div>
                        {message.plan.model_code ? <div className="mt-1 text-xs">方案版本：{message.plan.plan_version || "旧版"} · 模型：{message.plan.model_code}</div> : null}
                        {message.plan.slots ? <div className="mt-1 text-xs text-gray-500">{[message.plan.slots.target_duration_sec ? `${message.plan.slots.target_duration_sec} 秒` : "", message.plan.slots.aspect_ratio, message.plan.slots.character, message.plan.slots.style].filter(Boolean).join(" · ")}</div> : null}
                        <details className="mt-2"><summary className="cursor-pointer">查看完整方案 / 文案</summary><div className="mt-2 whitespace-pre-wrap">{message.plan.prompt || String(message.plan.slots?.generation_prompt || message.plan.slots?.script || "尚未形成可执行正文，请先完善需求")}</div></details>
                        {message.planState === "pending" ? <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" disabled={busy} onClick={() => void confirmPlan(index)} className="rounded-lg bg-primary px-4 py-2 text-dark disabled:opacity-50">确认并开始生成</button>
                          <button type="button" disabled={busy} onClick={() => void cancelPlan(index)} className="rounded-lg border border-gray-300 px-4 py-2">取消</button>
                          <span className="self-center text-xs text-gray-500">修改需求可直接在下方输入</span>
                        </div> : null}
                        {message.planState !== "submitted" && message.plan.plan_version === draftRef.current?.version && !["executing", "submitted"].includes(draftRef.current?.status || "") ? <button type="button" disabled={busy} className="mt-2 text-xs text-primary disabled:opacity-50" onClick={() => { setBusy(true); void refreshPlan(true).catch((err) => setError(err instanceof Error ? err.message : "更新失败")).finally(() => setBusy(false)); }}>按最新配置更新方案（保留需求）</button> : null}
                      </div>
                    ) : null}
                    {message.workflow ? <WorkflowRunCard task={message.workflow} busy={busy || (!!task && task.public_id !== message.workflow.public_id && ["pending", "running"].includes(task.status))} onRetry={() => void retryWorkflow(videoModelCode, "", message.workflow)} /> : null}
                    {message.searchRequired && message.retryText ? (
                      <button type="button" disabled={busy} onClick={() => { setBottom((value) => ({ ...value, web_search: true })); void sendMessage(message.retryText, true); }} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 text-sm text-primary transition hover:bg-primary/15 disabled:opacity-50">
                        <Globe size={14} />启用智能搜索并继续
                      </button>
                    ) : null}
                    {message.images?.length ? (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {message.images.map((url) => (
                          <button key={url} type="button" onClick={() => setMediaPreview({ url, type: "image" })} className="group relative block w-full max-w-[260px] overflow-hidden rounded-xl text-left ring-1 ring-black/5 transition hover:ring-primary/50 dark:ring-white/10" aria-label="放大查看图片">
                            <img src={url} alt={message.role === "user" ? "参考素材" : "生成结果"} className="aspect-square w-full object-cover" />
                            <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100"><Maximize2 size={14} /></span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {message.resultRunId && message.videos?.length ? (
                      <div className="mt-2 space-y-2">
                        {message.videos.map((url) => <video key={url} src={url} controls playsInline preload="metadata" className="h-auto max-h-[60dvh] w-auto max-w-full rounded-xl bg-black object-contain sm:max-h-[520px]" aria-label="成品视频" />)}
                      </div>
                    ) : message.videos?.length ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {message.videos.map((url) => (
                          <button key={url} type="button" onClick={() => setMediaPreview({ url, type: "video" })} className="group relative block w-full max-w-[360px] overflow-hidden rounded-xl text-left ring-1 ring-black/5 transition hover:ring-primary/50 dark:ring-white/10" aria-label="放大播放视频">
                            <video src={url} muted preload="metadata" className="aspect-video w-full object-cover" />
                            <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white"><Maximize2 size={14} /></span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {message.audios?.length ? (
                      <div className="mt-2 space-y-2">
                        {message.audios.map((url) => (
                          <div key={url} className="flex w-full max-w-[440px] items-center gap-2">
                            <audio src={url} controls preload="metadata" className="h-10 min-w-0 flex-1" />
                            <a href={url} download target="_blank" rel="noreferrer" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-gray-500 transition hover:border-primary/40 hover:text-primary dark:border-white/15 dark:text-gray-300" aria-label="下载音频"><Download size={15} /></a>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {message.attachments?.some((item) => item.kind !== "image" && item.kind !== "video" && item.kind !== "audio") ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {message.attachments.filter((item) => item.kind !== "image" && item.kind !== "video" && item.kind !== "audio").map((item) => <a key={item.public_id} href={item.url} target="_blank" rel="noreferrer" className="max-w-[220px] truncate rounded-lg border border-black/10 px-2 py-1 text-xs underline-offset-2 hover:underline dark:border-white/10">{item.name}</a>)}
                      </div>
                    ) : null}
                    {message.searchWarning ? <div className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">{message.searchWarning}</div> : null}
                    {message.sources?.length && !message.searchTrace ? (
                      <details className="group mt-2 text-xs text-gray-400">
                        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 transition hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/5 dark:hover:text-gray-200">
                          <Globe size={13} />参考来源 · {message.sources.length}
                          <ChevronDown size={13} className="transition group-open:rotate-180" />
                        </summary>
                        <div className="mt-1 space-y-1 border-l border-gray-200 pl-3 dark:border-white/10">
                          {message.sources.map((source, sourceIndex) => (
                            <a key={`${source.url}-${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer" className="block max-w-xl truncate py-0.5 underline-offset-2 hover:text-primary hover:underline">
                              [{sourceIndex + 1}] {source.title || source.url}{source.published_date ? ` · ${source.published_date}` : ""}
                            </a>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {busy && (
          <div className="mx-auto mt-4 flex max-w-5xl items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Loader2 size={14} className="animate-spin text-primary" />
            正在处理本轮请求…
          </div>
        )}
        {!task?.public_id && task ? (
          <div className="soft-card mx-auto mt-4 flex max-w-5xl items-center justify-between gap-3 px-4 py-3 text-xs text-gray-500 dark:text-gray-300">
            <span className="min-w-0 truncate">{task.public_id ? "成片工作流" : "任务"} {task.public_id || task.task_no}</span>
            <div className="flex shrink-0 items-center gap-2">
              <span className="max-w-[52vw] truncate font-medium text-gray-700 dark:text-gray-200">{task.status === "succeeded" ? "已完成" : task.status === "failed" ? task.error_message || "生成失败" : `${task.current_step || "生成中"} ${runProgress(task)}%`}</span>
            </div>
          </div>
        ) : null}
        <div ref={messagesEndRef} className="h-px" aria-hidden />
      </div>

      <div className="relative z-10 shrink-0 px-2 pb-2 pt-1 sm:px-6 sm:pb-5 sm:pt-2">
        <div className="mx-auto w-full max-w-[1040px]">
          {pendingRetry && pendingRetry.conversation === conversationId && <section aria-label="工作流续传确认" className="mb-3 rounded-xl border border-primary/30 bg-white p-3 text-sm dark:bg-gray-900">
            <p className="font-medium">确认继续工作流 · {pendingRetry.run.public_id}</p>
            <p className="mt-1 text-xs leading-5 text-gray-500">保留已成功素材，只补未完成部分；未完成生成使用当前模型配置，可能产生生成费用。仅重新合成不会调用生成模型。</p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void confirmWorkflowRetry()} className="rounded-lg bg-primary px-3 py-1.5 text-white disabled:opacity-50">确认续传</button>
              <button type="button" onClick={() => setPendingRetry(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 dark:border-white/20">取消续传</button>
            </div>
          </section>}
          {error && <div className="mb-2 px-1 text-sm text-red-500"><p>{error}</p>{conversationId && draftRef.current && !["executing", "submitted"].includes(draftRef.current.status) && <button type="button" disabled={busy} className="mt-1 text-xs underline disabled:opacity-50" onClick={() => {
            setBusy(true); setError("");
            void api<AgentDraft>(`/api/creative-agent/state/${conversationId}`).then((next) => { draftRef.current = next; return refreshPlan(true); }).catch((err) => setError(err instanceof Error ? err.message : "更新失败")).finally(() => setBusy(false));
          }}>同步并更新当前方案，无需重述需求</button>}</div>}
          <div className="soft-input overflow-hidden">
            <div className="flex items-center gap-2 border-b border-gray-50 px-3 py-2 dark:border-white/10 sm:px-4">
              <div className="min-w-0 flex-1"><ChatTopTools value={bottom} onChange={(next) => {
                if (busy) return;
                const before = [...bottom.asset_ids, ...bottom.files.map((item) => item.public_id)].sort().join("|");
                const after = [...next.asset_ids, ...next.files.map((item) => item.public_id)].sort().join("|");
                if (before !== after) { assetsChangedRef.current = true; setLatestGeneratedMedia({ images: [], videos: [], audios: [] }); }
                setBottom(next);
              }} showUpload={false} showRole /></div>
              <button type="button" onClick={() => setGuideOpen(true)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white"><HelpCircle size={15} />玩法说明</button>
            </div>
            <div className="flex min-h-[62px] items-center gap-2 px-2 py-2 sm:min-h-[104px] sm:items-stretch sm:gap-3 sm:px-4 sm:py-3">
              <button type="button" onClick={() => uploadRef.current?.click()} disabled={uploading || bottom.files.length >= 10} className="relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-500 transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 sm:h-auto sm:w-20 sm:gap-1.5 sm:rounded-2xl" aria-label="上传素材">
                {uploading ? <Loader2 size={19} className="animate-spin text-primary" /> : <Upload size={19} />}
                <span className="hidden text-[10px] sm:block">{uploading ? "上传中" : "上传文件"}</span>
                <span className="absolute -bottom-1 -right-1 rounded-full bg-gray-700 px-1 text-[8px] leading-4 text-white dark:bg-gray-200 dark:text-gray-900 sm:static sm:bg-transparent sm:px-0 sm:text-[9px] sm:leading-normal sm:text-gray-400 dark:sm:bg-transparent dark:sm:text-gray-400">{bottom.files.length}/10</span>
              </button>
              <input ref={uploadRef} type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.md" className="hidden" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ""; }} />
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="描述想法，或上传参考素材直接创作。" rows={3} aria-label="创作需求" className="min-h-[48px] min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-relaxed text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500 sm:min-h-[88px] sm:py-2" />
            </div>
            {bottom.files.length > 0 && (
              <div className="scroll-x-only flex flex-nowrap items-center gap-1.5 px-3 pb-3 sm:px-4">
                {bottom.files.map((file) => (
                  <div key={file.public_id} className="flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                    <span className="truncate">{file.name}</span>
                    <button type="button" onClick={() => setBottom((current) => ({ ...current, files: current.files.filter((item) => item.public_id !== file.public_id) }))} className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 dark:border-white/10 dark:bg-white/10 dark:text-gray-300" aria-label={`移除 ${file.name}`}><X size={10} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 border-t border-gray-50 px-2 py-2 dark:border-white/10 sm:px-4 sm:py-3">
              <fieldset disabled={busy} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pb-1">
                <button type="button" onClick={() => setCustomEnabled(false)} aria-pressed={!customEnabled} className={`h-8 whitespace-nowrap rounded-xl border px-2.5 text-xs transition sm:h-9 sm:px-3 sm:text-sm ${!customEnabled ? "border-primary/30 bg-primary/10 text-primary" : "border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"}`}>Agent 模式</button>
                <button type="button" onClick={() => setDeepThink((value) => !value)} aria-label="深度思考" title="深度思考" aria-pressed={deepThink} className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3 sm:text-sm ${deepThink ? "border-primary/30 bg-primary/10 text-primary" : "border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"}`}><BrainCircuit size={15} /><span className="hidden sm:inline">深度思考</span></button>
                {searchAvailable && <button type="button" onClick={() => setBottom((value) => ({ ...value, web_search: !value.web_search }))} aria-label="智能搜索" title="智能搜索" aria-pressed={bottom.web_search} className={`inline-flex h-8 w-8 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border text-xs transition sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3 sm:text-sm ${bottom.web_search ? "border-primary/30 bg-primary/10 text-primary" : "border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"}`}><Globe size={14} /><span className="hidden sm:inline">智能搜索</span></button>}
                <button type="button" onClick={() => setCustomEnabled((value) => !value)} aria-label="自定义" title="自定义" aria-pressed={customEnabled} className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3 sm:text-sm ${customEnabled ? "border-primary/30 bg-primary/10 text-primary" : "border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"}`}><SlidersHorizontal size={14} /><span className="hidden sm:inline">自定义</span></button>
                {customEnabled && (
                  <>
                    <div className="relative h-8 w-9 shrink-0 sm:h-9 sm:w-auto">
                      <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-gray-600 dark:text-gray-200 sm:hidden">{generationTypeIcon(customMediaType)}</span>
                      <select value={customMediaType} onChange={(event) => setCustomMediaType(event.target.value as GenerationType)} aria-label="生成类型" title={`生成类型：${generationLabel(customMediaType)}`} className="h-full w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-1 text-transparent outline-none focus:border-primary [color-scheme:light] sm:px-3 sm:text-sm sm:text-gray-600 dark:border-white/15 dark:bg-gray-900 dark:text-transparent dark:[color-scheme:dark] dark:sm:text-gray-100">
                        <option className="bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-100" value="image">生成图片</option>
                        <option className="bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-100" value="video">生成视频</option>
                        <option className="bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-100" value="speech">语音合成</option>
                        <option className="bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-100" value="music">歌曲音乐</option>
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 sm:hidden" />
                    </div>
                    <div className="relative h-8 w-9 shrink-0 sm:h-9 sm:w-auto sm:max-w-[240px]">
                      <Sparkles className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-gray-500 sm:hidden" size={14} />
                      <select value={customModelCode} onChange={(event) => customMediaType === "video" ? setVideoModelCode(event.target.value) : customMediaType === "speech" ? setSpeechModelCode(event.target.value) : customMediaType === "music" ? setMusicModelCode(event.target.value) : setImageModelCode(event.target.value)} aria-label={`${generationLabel(customMediaType)}模型`} title={`模型：${customModels.find((model) => model.code === customModelCode)?.display_name || "未选择"}`} className="h-full w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-1 text-transparent outline-none focus:border-primary [color-scheme:light] sm:px-3 sm:text-sm sm:text-gray-600 dark:border-white/15 dark:bg-gray-900 dark:text-transparent dark:[color-scheme:dark] dark:sm:text-gray-100">
                        {customModels.map((model) => <option className="bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-100" key={model.code} value={model.code}>{model.display_name}</option>)}
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 sm:hidden" />
                    </div>
                  </>
                )}
                {assetIDs.length > 0 && <span className="whitespace-nowrap text-xs text-gray-400">已选素材 {assetIDs.length}</span>}
              </fieldset>
              <button type="button" onClick={() => void sendMessage()} disabled={busy || !prompt.trim() || !chatModelCode} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-white shadow-md transition hover:bg-secondary/90 disabled:opacity-40 sm:h-12 sm:w-12" aria-label="发送">
                {busy ? <Loader2 size={20} className="animate-spin" /> : <ArrowUp size={20} />}
              </button>
            </div>
          </div>
        </div>
      </div>
      {guideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setGuideOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-gray-100 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-4"><h2 className="font-semibold text-gray-900 dark:text-white">Agent 通用智能体玩法说明</h2><button type="button" onClick={() => setGuideOpen(false)} aria-label="关闭玩法说明" className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10"><X size={17} /></button></div>
            <div className="mt-4 space-y-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
              <p>直接描述想生成的图片、视频、配音或歌曲音乐，也可以先上传参考文件或从资产库选择素材。</p>
              <p>Agent 先区分聊天、文案与生成需求。生成前会展示方案和所用模型，点击“确认并开始生成”后才执行；视频按模型支持的时长规划分段。</p>
              <p>会话会记住当前需求、角色和文案；仅在明确要求使用上一轮素材时才引用。换模型会保留需求并更新待确认方案，不自动重新生成。</p>
              <p>需要指定模型时开启“自定义”，选择一种生成类型后只会显示该类型的模型。</p>
              <p>开启深度思考后，Agent 会更仔细检查目标、素材和参数，响应时间及模型费用可能增加。</p>
              {searchAvailable && <p>开启智能搜索后，Agent 会先检索并交叉核验网页资料，再归纳提炼为直接回答。成功完成一次真实联网检索{searchUnitPrice > 0 ? `扣除 ${searchUnitPrice} 算力` : "当前免费"}；命中缓存或搜索失败不收费，检索决策模型用量另行计算。</p>}
              <p>主聊天模型按实际对话用量计费，生成任务按所选图片、视频或音频模型计费；不额外收取智能体工作流费。</p>
            </div>
          </div>
        </div>
      )}
      {mediaPreview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setMediaPreview(null)}>
          <div className="relative flex max-h-[92vh] w-full max-w-6xl items-center justify-center" onClick={(event) => event.stopPropagation()}>
            {mediaPreview.type === "image" ? (
              <img src={mediaPreview.url} alt="媒体预览" className="max-h-[88vh] max-w-full rounded-xl object-contain" />
            ) : (
              <video src={mediaPreview.url} controls autoPlay className="max-h-[88vh] max-w-full rounded-xl" />
            )}
            <div className="absolute right-2 top-2 flex gap-2">
              <a href={mediaPreview.url} download target="_blank" rel="noreferrer" className="flex h-10 items-center gap-2 rounded-xl bg-black/65 px-3 text-sm text-white transition hover:bg-black/80"><Download size={16} />下载</a>
              <button type="button" onClick={() => setMediaPreview(null)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/65 text-white transition hover:bg-black/80" aria-label="关闭预览"><X size={18} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
