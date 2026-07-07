"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import {
  ArrowUp,
  Bell,
  ChevronDown,
  Check,
  Clipboard,
  Download,
  History,
  Menu,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { api, API_URL, uploadAsset } from "@/lib/api";
import type { Model } from "@starai/shared-types";
import {
  buildAudioTaskParams,
  buildVideoTaskParams,
  EMPTY_VIDEO_MEDIA,
  parseAudioRuntime,
  parseVideoRuntime,
  schemaDefaultsFromFields,
  type VideoMediaState,
} from "@starai/shared-types";
import { useNotificationPolling } from "@/hooks/useNotificationPolling";
import { useNotificationStore } from "@/store/notifications";
import { WorkbenchUserMenu } from "@/components/WorkbenchUserMenu";
import { UILanguageSelector } from "@/components/UILanguageSelector";
import { useI18n } from "@/i18n/I18nProvider";
import { notificationTitle } from "@/lib/notificationText";
import { CATEGORY_TAG, MODEL_ICONS } from "./categoryMeta";
import { SchemaForm, schemaDefaults, schemaProperties } from "./SchemaForm";
import { BottomBar, ChatTopTools, type BottomBarState } from "./BottomBar";
import { PricingModal } from "@/components/workbench/PricingModal";
import { AudioOptionToolbar } from "./audio/AudioOptionToolbar";
import { AudioUploadButton } from "./audio/AudioUploadButton";
import { VideoUploadArea } from "./video/VideoUploadArea";
import { VideoOptionToolbar } from "./video/VideoOptionToolbar";
import { ImageGenerationToolbar, buildImageGenerationParams, normalizeTier } from "./ImageGenerationToolbar";
import { GenerationLanguageMenu, buildLanguageParams, useGenerationLanguages } from "./GenerationLanguageMenu";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type MultiModelResult = {
  model_code: string;
  display_name: string;
  icon_url?: string;
  content: string;
  error?: { code: string; message: string };
};

type MultiCollabSnapshot = {
  type: "multi_collab";
  summary: string;
  results: MultiModelResult[];
};

function defaultImageSizeForConfig(runtimeRule: Model["runtime_rule"], defaultParams: Model["default_params"]) {
  const runtimeQuality = (runtimeRule as any)?.image?.default_quality;
  const defaultQuality = (defaultParams as any)?.quality ?? (defaultParams as any)?.image_size;
  return normalizeTier(String(runtimeQuality ?? defaultQuality ?? "1K").toUpperCase());
}

function parseMultiCollabSnapshot(content: string): MultiCollabSnapshot | null {
  try {
    const data = JSON.parse(content) as Partial<MultiCollabSnapshot>;
    if (data?.type === "multi_collab") {
      return {
        type: "multi_collab",
        summary: typeof data.summary === "string" ? data.summary : "",
        results: Array.isArray(data.results)
          ? data.results
              .filter((x) => x && typeof x.model_code === "string")
              .map((x) => ({
                model_code: String(x.model_code),
                display_name: String(x.display_name || x.model_code),
                icon_url: typeof x.icon_url === "string" ? x.icon_url : undefined,
                content: typeof x.content === "string" ? x.content : "",
                error:
                  x.error && typeof x.error === "object"
                    ? { code: String((x.error as { code?: string }).code || ""), message: String((x.error as { message?: string }).message || "") }
                    : undefined,
              }))
          : [],
      };
    }
  } catch {
    /* legacy plain-text assistant message */
  }
  return null;
}

type RefImage = { url: string; name: string; public_id?: string };
type VideoResult = { url: string; thumbnail?: string };

type HistoryItem = {
  id: string;
  kind: "chat" | "task";
  title?: string | null;
  updated_at: string;
  status?: string;
};

type ChannelPreset = {
  key: string;
  name: string;
  model_codes?: string[];
  answer_model_codes?: string[];
  summary_model_codes?: string[];
  is_fallback_enabled?: boolean;
};

type ModelBadge = { code: string; icon?: string; label: string };

function BadgeCircle({ badge, size = 28 }: { badge: ModelBadge; size?: number }) {
  const dim = { width: size, height: size };
  if (badge.icon) {
    return (
      <div className="rounded-full border-2 border-white bg-gray-100 overflow-hidden flex items-center justify-center" style={dim} title={badge.label}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={badge.icon} alt={badge.label} className="w-full h-full object-cover" />
      </div>
    );
  }
  const initial = (badge.label || badge.code || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="rounded-full border-2 border-white bg-primary/15 text-primary font-semibold flex items-center justify-center"
      style={{ ...dim, fontSize: Math.max(10, Math.round(size * 0.4)) }}
      title={badge.label}
    >
      {initial}
    </div>
  );
}

const OUTPUT_FORMAT_INSTRUCTION =
  "Use structured Markdown in the answer: start with a short title (# or ##), organize the body into clear paragraphs, and use ##/### headings, lists, bold text, and code blocks when helpful. Do not output raw HTML.";

const UI_TEXT = {
  copied: "\u5df2\u590d\u5236",
  copy: "\u590d\u5236",
  copyContent: "\u590d\u5236\u5185\u5bb9",
  generating: "\u751f\u6210\u4e2d...",
  thinking: "\u601d\u8003\u4e2d...",
  summaryGenerating: "\u6c47\u603b\u751f\u6210\u4e2d...",
  noSummary: "\u6682\u65e0\u6c47\u603b",
  waitingModel: "\u6b63\u5728\u7b49\u5f85\u6a21\u578b\u54cd\u5e94...",
  imageUnit: "\u5f20",
  requestFailed: "\u8bf7\u6c42\u5931\u8d25",
  taskStatus: "\u4efb\u52a1\u72b6\u6001",
  statusPending: "\u7b49\u5f85\u4e2d",
  statusRunning: "\u751f\u6210\u4e2d",
  statusSucceeded: "\u5df2\u5b8c\u6210",
  statusFailed: "\u751f\u6210\u5931\u8d25",
  statusCancelled: "\u5df2\u53d6\u6d88",
  generatedImages: "\u751f\u6210\u7ed3\u679c",
  noImageResult: "\u4efb\u52a1\u5df2\u5b8c\u6210\uff0c\u4f46\u672a\u8fd4\u56de\u53ef\u663e\u793a\u7684\u56fe\u7247\u5730\u5740\u3002",
  imageLoadFailed: "\u56fe\u7247\u5730\u5740\u65e0\u6cd5\u8bbf\u95ee\uff0c\u8bf7\u68c0\u67e5 API/MinIO \u6216\u751f\u6210\u670d\u52a1\u662f\u5426\u542f\u52a8\u3002",
  openImage: "\u6253\u5f00\u539f\u56fe",
  downloadImage: "\u4e0b\u8f7d\u56fe\u7247",
  historyEmpty: "\u6682\u65e0\u5386\u53f2\u8bb0\u5f55",
  count: "\u6570\u91cf",
  chooseCount: "\u9009\u62e9\u751f\u6210\u6570\u91cf",
  customCount: "\u81ea\u5b9a\u4e49\u6570\u91cf",
  aspectRatio: "\u5c3a\u5bf8\u6bd4\u4f8b",
  chooseAspectRatio: "\u9009\u62e9\u56fe\u7247\u6bd4\u4f8b",
  quality: "\u8d28\u91cf",
  chooseQuality: "\u9009\u62e9\u56fe\u7247\u8d28\u91cf",
};

function statusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "pending") return UI_TEXT.statusPending;
  if (normalized === "running" || normalized === "runing" || normalized === "processing") return UI_TEXT.statusRunning;
  if (normalized === "succeeded" || normalized === "success") return UI_TEXT.statusSucceeded;
  if (normalized === "failed" || normalized === "error") return UI_TEXT.statusFailed;
  if (normalized === "cancelled" || normalized === "canceled") return UI_TEXT.statusCancelled;
  return status;
}

function isSucceededStatus(status: string) {
  const normalized = status.toLowerCase();
  return normalized === "succeeded" || normalized === "success";
}

function fallbackProgress(status: string, current = 0) {
  const normalized = status.toLowerCase();
  if (normalized === "pending") return Math.max(current, 8);
  if (normalized === "running" || normalized === "runing" || normalized === "processing") return Math.max(current, 28);
  if (isSucceededStatus(normalized)) return 100;
  if (normalized === "failed" || normalized === "error" || normalized === "cancelled" || normalized === "canceled") return current;
  return current;
}

function latestProgressFromEvents(events: unknown[]) {
  let latest = -1;
  for (const item of events) {
    const event = item as { payload?: Record<string, unknown> };
    const raw = event?.payload?.progress;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n)) latest = Math.max(latest, Math.min(100, Math.max(0, n)));
  }
  return latest;
}

function collectURLs(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectURLs(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      ...collectURLs(record.url),
      ...collectURLs(record.image_url),
      ...collectURLs(record.b64_json),
      ...collectURLs(record.output_url),
      ...collectURLs(record.thumbnail),
    ];
  }
  return [];
}

function normalizeImageSrc(src: string) {
  const value = src.trim();
  if (!value) return "";
  if (/^(https?:|data:image\/|blob:)/i.test(value)) return value;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 100) {
    return `data:image/png;base64,${value.replace(/\s+/g, "")}`;
  }
  return value;
}

function collectVideoResults(value: unknown): VideoResult[] {
  if (!value) return [];
  if (typeof value === "string") {
    const url = value.trim();
    return url ? [{ url }] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectVideoResults(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const url = collectURLs(record.url)[0] || collectURLs(record.video_url)[0] || collectURLs(record.result_url)[0] || "";
    if (!url) return [];
    const thumbnail = collectURLs(record.thumbnail)[0] || collectURLs(record.cover_url)[0] || collectURLs(record.poster_url)[0] || undefined;
    return [{ url, thumbnail }];
  }
  return [];
}

function extractTaskOutput(output?: Record<string, unknown> | null) {
  if (!output) return { videoURLs: [] as VideoResult[], audioURL: "", imageURLs: [] as string[] };
  const videoURLs = [
    ...collectVideoResults(output.video_url),
    ...collectVideoResults(output.videos),
    ...collectVideoResults(output.results),
    ...collectVideoResults(output.data),
  ].filter((item, idx, arr) => item.url && arr.findIndex((x) => x.url === item.url) === idx);
  const audioURL = collectURLs(output.audio_url)[0] || "";
  const imageURLs = [
    ...collectURLs(output.image_url),
    ...collectURLs(output.b64_json),
    ...collectURLs(output.images),
    ...collectURLs(output.urls),
    ...collectURLs(output.results),
    ...collectURLs(output.data),
  ].map(normalizeImageSrc).filter((url, idx, arr) => url && arr.indexOf(url) === idx);
  return { videoURLs, audioURL, imageURLs };
}

function TaskMediaVideo({ src, className }: { src: string; className?: string }) {
  const { t } = useI18n();
  const [playSrc, setPlaySrc] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const needsAuth = /\/api\/tasks\/[^/]+\/media\b/.test(src);
    if (!needsAuth) {
      setPlaySrc(src);
      setLoading(false);
      return;
    }
    let objectURL = "";
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    setLoading(true);
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        objectURL = URL.createObjectURL(blob);
        setPlaySrc(objectURL);
      })
      .catch(() => setPlaySrc(""))
      .finally(() => setLoading(false));
    return () => {
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [src]);
  if (loading) return <div className="text-sm text-gray-500 py-8">{t("workspace.videoLoading")}</div>;
  if (!playSrc) return <div className="text-sm text-red-500 py-8">{t("workspace.videoLoadFailed")}</div>;
  return <video src={playSrc} controls className={className} />;
}

function ModelMediaResultGrid({
  type,
  images = [],
  videos = [],
}: {
  type: "image" | "video";
  images?: string[];
  videos?: VideoResult[];
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<{ url: string; type: "image" | "video" } | null>(null);
  const items = type === "video" ? videos.map((item) => item.url).filter(Boolean) : images.filter(Boolean);
  const visibleItems = items.slice(0, 8);
  const count = visibleItems.length;
  const gridClass =
    count <= 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : count === 3
          ? "grid-cols-1 sm:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";
  const mediaHeight = count <= 1 ? "h-[210px] sm:h-[240px] lg:h-[260px]" : "h-[150px] sm:h-[170px] lg:h-[190px]";
  if (items.length === 0) return null;

  return (
    <div className="soft-card tech-card p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("workspace.generationResult")}</div>
        {items.length > 8 && (
          <Link href="/app/works" className="h-8 rounded-xl border border-gray-200 bg-white px-3 inline-flex items-center text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10">
            {t("common.more")}
          </Link>
        )}
      </div>
      <div className={`grid ${gridClass} gap-2 sm:gap-3`}>
        {visibleItems.map((url, idx) => (
          <ModelMediaResultCard
            key={`${url}-${idx}`}
            url={url}
            type={type}
            index={idx}
            mediaHeight={mediaHeight}
            onPreview={(nextURL, nextType) => setPreview({ url: nextURL, type: nextType })}
          />
        ))}
      </div>
      {preview && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="relative max-h-[88vh] w-full max-w-4xl rounded-2xl bg-black shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreview(null)} className="absolute right-3 top-3 z-10 w-9 h-9 rounded-xl border border-gray-200 bg-white/90 text-gray-900 flex items-center justify-center shadow dark:bg-gray-900/90 dark:text-white dark:border-white/10"><X size={16} /></button>
            {preview.type === "video" ? (
              <TaskMediaVideo src={preview.url} className="max-h-[88vh] w-full object-contain" />
            ) : (
              <div className="relative">
                <button
                  type="button"
                  className="absolute left-3 top-3 z-10 flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white/90 px-3 text-sm font-medium text-gray-900 shadow dark:bg-gray-900/90 dark:text-white dark:border-white/10"
                  title={t("workspace.downloadImage")}
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadImage(preview.url, "starai-image.png");
                  }}
                >
                  <Download size={15} />
                  {t("common.download")}
                </button>
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

function ModelMediaPendingGrid({ type, count }: { type: "image" | "video"; count: number }) {
  const { t } = useI18n();
  const safeCount = Math.min(8, Math.max(1, Math.round(Number(count) || 1)));
  const placeholders = Array.from({ length: safeCount });
  const gridClass =
    safeCount <= 1
      ? "grid-cols-1"
      : safeCount === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : safeCount === 3
          ? "grid-cols-1 sm:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";
  const mediaHeight = safeCount <= 1 ? "h-[210px] sm:h-[240px] lg:h-[260px]" : "h-[150px] sm:h-[170px] lg:h-[190px]";
  return (
    <div className="soft-card p-3 sm:p-4">
      <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{t("workspace.generationResult")}</div>
      <div className={`grid ${gridClass} gap-2 sm:gap-3`}>
        {placeholders.map((_, idx) => (
          <div key={idx} className="rounded-2xl border border-gray-100 bg-white p-2.5 dark:bg-white/5 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-gray-400">#{idx + 1}</span>
              <span className="text-xs text-amber-600">{t("status.running")}</span>
            </div>
            <div className={`result-scan rounded-xl border border-gray-100 ${mediaHeight} flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-950 dark:border-white/10`}>
              <div className="px-4 text-center text-sm text-gray-500 dark:text-gray-300">
                {type === "video" ? t("workspace.videoGenerating") : t("workspace.imageGenerating")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelMediaResultCard({
  url,
  type,
  index,
  mediaHeight,
  onPreview,
}: {
  url: string;
  type: "image" | "video";
  index: number;
  mediaHeight: string;
  onPreview: (url: string, type: "image" | "video") => void;
}) {
  const { t } = useI18n();
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [url]);
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-2.5 transition hover:-translate-y-0.5 hover:border-primary/30 dark:bg-white/5 dark:border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">#{index + 1}</span>
        <span className="text-xs text-emerald-600">{t("status.succeeded")}</span>
      </div>
      <div className={`rounded-xl border border-gray-100 ${mediaHeight} flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-950 dark:border-white/10`}>
        {type === "video" ? (
          <div className="relative h-full w-full bg-black flex items-center justify-center">
            <TaskMediaVideo src={url} className="h-full w-full bg-black object-contain" />
            <button type="button" onClick={() => onPreview(url, "video")} className="absolute right-2 top-2 z-20 rounded-lg border border-white/20 bg-gray-950/85 px-2.5 py-1 text-xs font-medium text-white shadow-lg backdrop-blur hover:bg-gray-900 dark:bg-gray-900/90 dark:text-white dark:border-white/10 dark:hover:bg-gray-800">{t("common.preview")}</button>
          </div>
        ) : !imageFailed ? (
          <div className="relative h-full w-full">
            <button type="button" onClick={() => onPreview(url, "image")} className="h-full w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Generated result ${index + 1}`} onError={() => setImageFailed(true)} className="w-full h-full object-contain" />
            </button>
            <button
              type="button"
              className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-gray-950/85 text-white shadow-lg backdrop-blur hover:bg-gray-900 dark:bg-gray-900/90 dark:text-white dark:border-white/10 dark:hover:bg-gray-800"
              title={t("workspace.downloadImage")}
              onClick={(e) => {
                e.stopPropagation();
                downloadImage(url, `starai-image-${index + 1}.png`);
              }}
            >
              <Download size={15} />
            </button>
          </div>
        ) : (
          <div className="px-4 text-center text-sm text-gray-500 dark:text-gray-300">{t("workspace.imageLoadFailed")}</div>
        )}
      </div>
    </div>
  );
}

function downloadImage(src: string, filename: string) {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = src;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function copyToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  if (typeof document === "undefined") return Promise.resolve();
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
  return Promise.resolve();
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key} className="font-semibold text-gray-950 dark:text-gray-100">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key} className="px-1.5 py-0.5 rounded-md bg-gray-100 text-[0.92em] text-gray-800 dark:bg-white/10 dark:text-gray-100">{part.slice(1, -1)}</code>;
    }
    return <span key={key}>{part}</span>;
  });
}

function RichMarkdown({ content, emptyText }: { content: string; emptyText?: string }) {
  const text = content.trim() || emptyText || "";
  const lines = text.split(/\r?\n/);
  const nodes: ReactNode[] = [];

  const pushParagraph = (parts: string[], key: string) => {
    const body = parts.join(" ").trim();
    if (!body) return;
    nodes.push(
      <p key={key} className="my-2 text-[15px] leading-7 text-gray-700 dark:text-gray-200">
        {renderInlineMarkdown(body, key)}
      </p>
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={`code-${i}`} className="my-3 overflow-x-auto rounded-2xl bg-gray-950 px-4 py-3 text-xs leading-6 text-gray-100">
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const body = heading[2].replace(/#+$/, "").trim();
      if (level === 1) {
        nodes.push(<h1 key={`h1-${i}`} className="mb-3 mt-1 text-xl font-bold leading-8 text-gray-950 dark:text-gray-100">{body}</h1>);
      } else if (level === 2) {
        nodes.push(<h2 key={`h2-${i}`} className="mb-2 mt-5 text-lg font-bold leading-7 text-gray-950 dark:text-gray-100">{body}</h2>);
      } else {
        nodes.push(<h3 key={`h3-${i}`} className="mb-2 mt-4 text-base font-semibold leading-6 text-gray-900 dark:text-gray-100">{body}</h3>);
      }
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      i--;
      nodes.push(
        <ul key={`ul-${i}`} className="my-3 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-gray-700 dark:text-gray-200">
          {items.map((item, idx) => <li key={idx}>{renderInlineMarkdown(item, `ul-${i}-${idx}`)}</li>)}
        </ul>
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      i--;
      nodes.push(
        <ol key={`ol-${i}`} className="my-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-7 text-gray-700 dark:text-gray-200">
          {items.map((item, idx) => <li key={idx}>{renderInlineMarkdown(item, `ol-${i}-${idx}`)}</li>)}
        </ol>
      );
      continue;
    }

    if (line.startsWith(">")) {
      const quote = line.replace(/^>\s?/, "");
      nodes.push(
      <blockquote key={`quote-${i}`} className="my-3 rounded-2xl border-l-4 border-primary/60 bg-primary/5 px-4 py-3 text-sm leading-7 text-gray-700 dark:text-gray-200">
          {renderInlineMarkdown(quote, `quote-${i}`)}
        </blockquote>
      );
      continue;
    }

    const paragraph = [line];
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() &&
      !/^(#{1,3})\s+/.test(lines[i + 1].trim()) &&
      !/^[-*]\s+/.test(lines[i + 1].trim()) &&
      !/^\d+[.)]\s+/.test(lines[i + 1].trim()) &&
      !lines[i + 1].trim().startsWith(">") &&
      !lines[i + 1].trim().startsWith("```")
    ) {
      paragraph.push(lines[i + 1].trim());
      i++;
    }
    pushParagraph(paragraph, `p-${i}`);
  }

  return <div className="rich-output min-w-0">{nodes}</div>;
}

function CopyOutputButton({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-500 shadow-sm transition hover:border-primary/40 hover:text-gray-900 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:text-gray-100"
      onClick={onCopy}
      title={UI_TEXT.copyContent}
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Clipboard size={14} />}
      {copied ? UI_TEXT.copied : UI_TEXT.copy}
    </button>
  );
}

interface Props {
  model: Model;
  initialPrompt?: string;
  onOpenModelPicker?: () => void;
  onOpenNav?: () => void;
  onRecharge?: () => void;
}

/** Right-side input toolbar meta, aligned to h-9 controls. */
function InputToolbarMeta({
  onPricing,
  pricingLabel,
  costHint,
}: {
  onPricing?: () => void;
  pricingLabel?: string;
  costHint?: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-end justify-center gap-0.5 shrink-0 h-9">
      {costHint ? (
        <button
          type="button"
          onClick={onPricing}
          className="h-[17px] px-1.5 rounded-md text-[10px] leading-none text-gray-500 hover:text-primary whitespace-nowrap transition underline-offset-2 hover:underline"
          title={t("workspace.viewPricing")}
        >
          {costHint}
        </button>
      ) : onPricing ? (
        <button
          type="button"
          onClick={onPricing}
          className="h-[17px] px-1.5 rounded-md bg-gray-50 border border-gray-200 text-[10px] leading-none text-gray-600 hover:bg-gray-100 whitespace-nowrap dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"
        >
          {pricingLabel || t("workspace.tokenBilling")}
        </button>
      ) : null}
      <span className="text-[10px] leading-none text-gray-300 dark:text-gray-500 whitespace-nowrap">{t("workspace.shiftEnter")}</span>
    </div>
  );
}

export function ModelWorkspace({ model, initialPrompt, onOpenModelPicker, onOpenNav, onRecharge }: Props) {
  const { t, td } = useI18n();
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [mmMode, setMmMode] = useState(false);
  const [mmActiveTab, setMmActiveTab] = useState<"answer" | "summary">("answer");
  const [mmResults, setMmResults] = useState<MultiModelResult[]>([]);
  const [mmSummary, setMmSummary] = useState<string>("");
  const [copiedOutputKey, setCopiedOutputKey] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);
  const [estimateError, setEstimateError] = useState("");
  const [taskStatus, setTaskStatus] = useState("");
  const [taskOutput, setTaskOutput] = useState<string | null>(null);
  const [taskImages, setTaskImages] = useState<string[]>([]);
  const [taskVideos, setTaskVideos] = useState<VideoResult[]>([]);
  const [taskProgress, setTaskProgress] = useState(0);
  const [params, setParams] = useState<Record<string, unknown>>(() => ({
    ...(model.category === "video" || model.category === "audio"
      ? schemaDefaultsFromFields(model.input_schema)
      : schemaDefaults(model.input_schema)),
    ...(model.default_params || {}),
  }));
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  const [videoMedia, setVideoMedia] = useState<VideoMediaState>(EMPTY_VIDEO_MEDIA);
  const [audioSecondaryPrompt, setAudioSecondaryPrompt] = useState("");
  const [audioRef, setAudioRef] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bottom, setBottom] = useState<BottomBarState>({
    channel_key: typeof model.default_params?.channel_key === "string" ? model.default_params.channel_key : "price_first",
    fallback_enabled: true,
    web_search: false,
    timeout_sec: 30,
    asset_ids: [],
    files: [],
  });
  const [menuWallet, setMenuWallet] = useState<{ compute_balance?: number } | null>(null);
  const [conversationId, setConversationId] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<
    { id: number; title: string; content: string; type?: string; is_read: boolean; created_at: string }[]
  >([]);
  const unread = useNotificationStore((s) => s.unread);
  const setUnread = useNotificationStore((s) => s.setUnread);
  const decrementUnread = useNotificationStore((s) => s.decrementUnread);
  const clearUnread = useNotificationStore((s) => s.clearUnread);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifNeedLogin, setNotifNeedLogin] = useState(false);
  const [homeCards, setHomeCards] = useState<
    { key: string; title: string; description?: string; icon_url?: string; icon_emoji?: string; theme: string }[]
  >([]);
  const [channelPresets, setChannelPresets] = useState<ChannelPreset[]>([]);
  const [modelMap, setModelMap] = useState<Record<string, { icon_url?: string; display_name?: string }>>({});
  const [compactBadge, setCompactBadge] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [imageCount, setImageCount] = useState(1);
  const [imageRatio, setImageRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");
  const { languages: generationLanguages, selectedCode: languageCode, setSelectedCode: setLanguageCode, selectedLanguage } = useGenerationLanguages();
  const bottomRef = useRef<HTMLDivElement>(null);
  // IMPORTANT:
  // Your project uses a "pseudo model" for multi-collab chat (seeded as code=multi_collab_chat),
  // and historically it was still under category="chat". So multi-collab mode must be detected by code too,
  // otherwise we'd accidentally downgrade it to single-chat UI and break channel/timeout + mm SSE.
  const isMultiCollab = model.category === "multi_collab" || model.code === "multi_collab_chat";
  const isChatSingle = model.category === "chat" && !isMultiCollab;
  const isChat = isChatSingle || isMultiCollab;
  const isImage = model.category === "image";
  const isVideo = model.category === "video";
  const isAudio = model.category === "audio";
  const hasSchemaFields = Object.keys(schemaProperties(model.input_schema)).length > 0;
  const tag = CATEGORY_TAG[model.category] || { label: model.category, labelKey: `modelCategory.${model.category}`, className: "bg-gray-100 text-gray-600" };
  const modelName = td(`model.${model.code}.name`, model.display_name);
  const modelDescription = td(`model.${model.code}.description`, model.description || t("workspace.defaultModelDesc"));
  const modelCategoryLabel = td(`modelCategory.${model.category}`, t(tag.labelKey), { category: model.category });
  const caps = (model.runtime_rule as any)?.capabilities || {};
  const capWebSearch = !!caps.web_search;
  const capDeepThink = !!caps.deep_think;
  const rawMaxRefImages = (model.runtime_rule as any)?.image?.max_reference_images ?? (model.default_params as any)?.max_reference_images;
  const maxRefImages = Math.max(
    0,
    Math.min(
      20,
      rawMaxRefImages === undefined || rawMaxRefImages === null || rawMaxRefImages === "" ? 4 : Number(rawMaxRefImages) || 0
    )
  );
  const videoConfig = parseVideoRuntime(model.runtime_rule);
  const audioConfig = parseAudioRuntime(model.runtime_rule);
  const maxVideoAssetRefs =
    videoConfig.upload_profile === "frame_pair"
      ? videoConfig.reference_images?.max ?? 4
      : videoConfig.max_reference_images ?? 1;
  const promptPlaceholder = isChat
    ? t("workspace.placeholder.chat")
    : isVideo
    ? videoConfig.prompt_hint || t("workspace.placeholder.video")
    : isAudio
    ? audioConfig.prompt_hint || t("workspace.placeholder.audio")
    : t("workspace.placeholder.image");
  const referenceAssetIds = useMemo(
    () =>
      [
        ...refImages.map((x) => x.public_id),
        videoMedia.first_frame?.public_id,
        videoMedia.last_frame?.public_id,
        ...videoMedia.reference_images.map((x) => x.public_id),
      ].filter((x): x is string => !!x),
    [refImages, videoMedia.first_frame, videoMedia.last_frame, videoMedia.reference_images]
  );

  useEffect(() => {
    const secondaryKey = parseAudioRuntime(model.runtime_rule).secondary_prompt_key || "style_prompt";
    const defaults = model.default_params || {};
    setParams({
      ...(isVideo || isAudio ? schemaDefaultsFromFields(model.input_schema) : schemaDefaults(model.input_schema)),
      ...defaults,
    });
    setRefImages([]);
    setVideoMedia(EMPTY_VIDEO_MEDIA);
    setAudioSecondaryPrompt(String(defaults[secondaryKey] ?? ""));
    setAudioRef(null);
    if (isImage) {
      setImageSize(defaultImageSizeForConfig(model.runtime_rule, defaults));
    }
    setBottom((prev) => ({
      ...prev,
      channel_key: typeof defaults.channel_key === "string" && defaults.channel_key ? defaults.channel_key : prev.channel_key,
    }));
    setPrompt(initialPrompt || "");
  }, [model.code, initialPrompt, isVideo, isAudio, isImage, model.input_schema, model.default_params, model.runtime_rule]);

  useEffect(() => {
    const selectedAssets = bottom.asset_ids?.length ? { asset_ids: bottom.asset_ids } : {};
    const selectedReferenceAssets = referenceAssetIds.length ? { reference_asset_ids: referenceAssetIds } : {};
    const languageParams = buildLanguageParams(selectedLanguage);
    const bodyParams = isVideo
      ? { ...buildVideoTaskParams(params, videoMedia, model.runtime_rule), ...languageParams, ...selectedAssets, ...selectedReferenceAssets }
      : isAudio
        ? {
            ...buildAudioTaskParams(params, prompt, audioSecondaryPrompt, model.runtime_rule),
            ...(audioRef?.url ? { reference_audio: audioRef.url } : {}),
            ...selectedAssets,
          }
        : isImage
        ? {
            ...params,
            ...buildImageGenerationParams({ count: imageCount, ratio: imageRatio, imageSize }),
            ...languageParams,
            ...(refImages.length ? { reference_images: refImages.map((x) => x.url) } : {}),
            ...selectedAssets,
            ...selectedReferenceAssets,
          }
        : { ...params, ...(isMultiCollab ? { channel_key: bottom.channel_key, fallback_enabled: bottom.fallback_enabled } : {}), ...selectedAssets };
    setEstimateError("");
    api<{ estimated_cost: number }>(`/api/models/${model.code}/estimate`, {
      method: "POST",
      body: JSON.stringify({ params: bodyParams }),
    })
      .then((r) => {
        setEstimatedCost(r.estimated_cost);
        setEstimateError("");
      })
      .catch((err) => {
        setEstimatedCost(null);
        if (isMultiCollab) setEstimateError(err instanceof Error ? err.message : t("workspace.modelPriceMissing"));
      });
  }, [
    model.code,
    params,
    videoMedia,
    isVideo,
    isImage,
    isAudio,
    model.runtime_rule,
    imageCount,
    imageRatio,
    imageSize,
    selectedLanguage,
    refImages,
    prompt,
    audioSecondaryPrompt,
    audioRef,
    bottom.asset_ids,
    bottom.channel_key,
    bottom.fallback_enabled,
    isMultiCollab,
    referenceAssetIds,
    t,
  ]);

  useEffect(() => {
    if (!isChat) return;
    api<{ items: { key: string; title: string; description?: string; icon_url?: string; icon_emoji?: string; theme: string }[] }>(
      "/api/home/cards"
    )
      .then((r) => setHomeCards(r.items || []))
      .catch(() => setHomeCards([]));
  }, [isChat]);

  useEffect(() => {
    if (!isChat) return;
    api<{ items: ChannelPreset[] }>("/api/channel-presets")
      .then((r) => setChannelPresets(r.items || []))
      .catch(() => setChannelPresets([]));
    api<any[]>("/api/models")
      .then((items) => {
        const map: Record<string, { icon_url?: string; display_name?: string }> = {};
        for (const m of items || []) {
          if (m && typeof m.code === "string") {
            map[m.code] = { icon_url: m.icon_url || undefined, display_name: m.display_name || undefined };
          }
        }
        setModelMap(map);
      })
      .catch(() => setModelMap({}));
  }, [isChat]);

  // Initialize the channel preset once per model. After this runs, the user is
  // free to switch presets via BottomBar without being forced back to default.
  const channelInitRef = useRef<string>("");
  useEffect(() => {
    if (!isMultiCollab || channelPresets.length === 0) return;
    if (channelInitRef.current === model.code) return;
    channelInitRef.current = model.code;
    const defaultKey = typeof model.default_params?.channel_key === "string" ? model.default_params.channel_key : "";
    const nextKey =
      defaultKey && channelPresets.some((p) => p.key === defaultKey)
        ? defaultKey
        : channelPresets.some((p) => p.key === bottom.channel_key)
          ? bottom.channel_key
          : channelPresets[0].key;
    if (nextKey && nextKey !== bottom.channel_key) {
      const preset = channelPresets.find((p) => p.key === nextKey);
      setBottom((prev) => ({ ...prev, channel_key: nextKey, fallback_enabled: preset?.is_fallback_enabled ?? prev.fallback_enabled }));
    }
  }, [isMultiCollab, channelPresets, model.code, model.default_params, bottom.channel_key]);

  useEffect(() => {
    if (!isChat) return;
    const calc = () => {
      // Compact when window is narrow or height is small (e.g. browser zoom).
      const w = window.innerWidth;
      const h = window.innerHeight;
      setCompactBadge(w < 1024 || h < 820);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [isChat]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest("[data-starai-history]")) setHistoryOpen(false);
      if (!target.closest("[data-starai-notif]")) setNotifOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useNotificationPolling();

  const openNotif = () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (!next) return;
    if (typeof window !== "undefined" && !localStorage.getItem("token")) {
      setNotifNeedLogin(true);
      setNotifItems([]);
      setNotifLoading(false);
      return;
    }
    setNotifNeedLogin(false);
    setNotifLoading(true);
    api<{
      items: { id: number; title: string; content: string; type?: string; is_read: boolean; created_at: string }[];
      unread: number;
    }>("/api/notifications")
      .then((r) => {
        setNotifItems(r.items || []);
        setUnread(r.unread || 0);
      })
      .catch(() => {
        setNotifItems([]);
      })
      .finally(() => setNotifLoading(false));
  };

  const markNotifRead = async (id: number) => {
    const item = notifItems.find((n) => n.id === id);
    if (!item || item.is_read) return;
    try {
      await api(`/api/notifications/${id}/read`, { method: "POST" });
      setNotifItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      decrementUnread();
    } catch {
      /* ignore */
    }
  };

  const markAllRead = async () => {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      setNotifItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      clearUnread();
    } catch {
      /* ignore */
    }
  };

  const openHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) {
      if (isChat) {
        api<{ public_id: string; title?: string | null; updated_at: string }[]>(
          `/api/chat/conversations?model_code=${encodeURIComponent(model.code)}`
        )
          .then((items) =>
            setHistoryItems((items || []).map((item) => ({ id: item.public_id, kind: "chat", title: item.title, updated_at: item.updated_at })))
          )
          .catch(() => setHistoryItems([]));
        return;
      }
      const taskType = isVideo ? "video" : isAudio ? "audio" : "image";
      api<{ items: Array<{ task_no: string; status: string; input?: Record<string, unknown>; created_at: string; finished_at?: string }> }>(
        `/api/tasks?model_code=${encodeURIComponent(model.code)}&type=${taskType}&page_size=50`
      )
        .then((res) =>
          setHistoryItems(
            (res.items || []).map((item) => ({
              id: item.task_no,
              kind: "task",
              title:
                typeof item.input?.user_prompt === "string" && item.input.user_prompt.trim()
                  ? item.input.user_prompt
                  : typeof item.input?.prompt === "string"
                    ? item.input.prompt
                    : item.task_no,
              updated_at: item.finished_at || item.created_at,
              status: item.status,
            }))
          )
        )
        .catch(() => setHistoryItems([]));
    }
  };

  const loadConversation = async (publicId: string) => {
    try {
      const conv = await api<{
        public_id: string;
        messages: { role: string; content: string }[];
      }>(`/api/chat/conversations/${publicId}`);
      const raw = conv.messages || [];
      const displayMessages: Message[] = [];
      let restoredResults: MultiModelResult[] = [];
      let restoredSummary = "";

      for (const m of raw) {
        if (m.role === "user") {
          displayMessages.push({ role: "user", content: m.content });
          continue;
        }
        if (m.role !== "assistant") continue;
        if (isMultiCollab) {
          const snap = parseMultiCollabSnapshot(m.content);
          if (snap) {
            restoredSummary = snap.summary;
            restoredResults = snap.results;
          } else if (m.content.trim()) {
            // Legacy history: assistant content is plain summary text.
            restoredSummary = m.content;
          }
          continue;
        }
        displayMessages.push({ role: "assistant", content: m.content });
      }

      setMessages(displayMessages);
      if (isMultiCollab && (restoredSummary || restoredResults.length > 0)) {
        setMmMode(true);
        setMmResults(restoredResults);
        setMmSummary(restoredSummary);
        setMmActiveTab(restoredSummary ? "summary" : "answer");
      } else {
        setMmMode(false);
        setMmResults([]);
        setMmSummary("");
      }
      setConversationId(conv.public_id);
      setTaskStatus("");
      setTaskOutput(null);
      setTaskImages([]);
      setHistoryOpen(false);
    } catch {
      /* ignore */
    }
  };

  const loadTaskHistory = async (taskNo: string) => {
    try {
      const task = await api<{
        task_no: string;
        status: string;
        input?: Record<string, unknown>;
        output?: Record<string, unknown>;
      }>(`/api/tasks/${taskNo}`);
      const media = extractTaskOutput(task.output || {});
      setMessages([]);
      setConversationId("");
      setPrompt(
        typeof task.input?.user_prompt === "string" && task.input.user_prompt.trim()
          ? task.input.user_prompt
          : typeof task.input?.prompt === "string"
            ? task.input.prompt
            : ""
      );
      setTaskStatus(task.status);
      setTaskOutput(media.videoURLs[0]?.url || media.audioURL || media.imageURLs[0] || null);
      setTaskImages(media.imageURLs);
      setTaskVideos(media.videoURLs);
      setTaskProgress(isSucceededStatus(task.status) ? 100 : fallbackProgress(task.status));
      setHistoryOpen(false);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    api<{ compute_balance: number }>("/api/wallet")
      .then((w) => setMenuWallet(w))
      .catch(() => setMenuWallet(null));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const p = sp.get("prompt");
      if (p) setPrompt(p);
    } catch {
      /* ignore */
    }
  }, []);

  const handleCopyOutput = async (key: string, text: string) => {
    await copyToClipboard(text);
    setCopiedOutputKey(key);
    window.setTimeout(() => setCopiedOutputKey((current) => (current === key ? null : current)), 1500);
  };

  const handleChat = async () => {
    if (!prompt.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: prompt };
    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setStreaming(true);
    setMmMode(false);
    setMmResults([]);
    setMmSummary("");
    const newMessages = [...messages, userMsg];
    let assistantContent = "";

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_URL}/api/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model_code: model.code,
          conversation_id: conversationId,
            messages: [
              { role: "system", content: OUTPUT_FORMAT_INSTRUCTION },
              ...(bottom.role_prompt ? [{ role: "system", content: bottom.role_prompt }] : []),
              ...(bottom.asset_ids?.length
                ? [
                    {
                      role: "system",
                      content: `Selected asset public_ids: ${bottom.asset_ids.join(", ")}. Use these assets as context when answering.`,
                    },
                  ]
                : []),
              ...(bottom.files?.length
                ? [
                    {
                      role: "system",
                      content: `Uploaded attachment asset public_ids: ${bottom.files
                        .map((f) => f.public_id)
                        .join(", ")}. Use these attachments as context when answering.`,
                    },
                  ]
                : []),
              ...newMessages.map((m) => ({ role: m.role, content: m.content })),
            ],
          params: {
            ...params,
            ...(isMultiCollab
              ? {
                  channel_key: bottom.channel_key,
                  fallback_enabled: bottom.fallback_enabled,
                  web_search: bottom.web_search,
                  timeout_sec: bottom.timeout_sec,
                }
              : {}),
            ...(isChatSingle && capWebSearch ? { web_search: bottom.web_search } : {}),
            asset_ids: bottom.asset_ids,
            file_asset_ids: bottom.files.map((f) => f.public_id),
          },
          stream: true,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({} as { message?: string; data?: { conversation_id?: string } }));
        if (json.data?.conversation_id) {
          setConversationId(json.data.conversation_id);
        }
        throw new Error(json.message || UI_TEXT.requestFailed);
                                                                                                                                                                                                                                                                                                                      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      let buffer = "";
      const applyDelta = (content: string) => {
        assistantContent += content;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent };
          return updated;
        });
      };

      const upsertMmResult = (patch: Partial<MultiModelResult> & { model_code: string }) => {
        setMmResults((prev) => {
          const idx = prev.findIndex((r) => r.model_code === patch.model_code);
          if (idx === -1)
            return [
              ...prev,
              {
                model_code: patch.model_code,
                display_name: patch.display_name || patch.model_code,
                content: patch.content || "",
                icon_url: patch.icon_url,
                error: patch.error,
              },
            ];
          const next = [...prev];
          next[idx] = { ...next[idx], ...patch, content: patch.content ?? next[idx].content };
          return next;
        });
      };

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const evt of events) {
            let eventType = "";
            let dataStr = "";
            for (const line of evt.split("\n")) {
              if (line.startsWith("event: ")) eventType = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataStr += line.slice(6);
            }
            if (!dataStr) continue;
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(dataStr);
            } catch {
              continue;
            }
            if (eventType === "mm_start") {
              setMmMode(true);
              setMmActiveTab("answer");
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && !last.content.trim()) {
                  return prev.slice(0, -1);
                }
                return prev;
              });
            } else if (eventType === "mm_model_start") {
              setMmMode(true);
              const code = String(data.model_code || "");
              if (code) {
                upsertMmResult({
                  model_code: code,
                  display_name: typeof data.display_name === "string" ? data.display_name : code,
                  icon_url: typeof data.icon_url === "string" ? data.icon_url : undefined,
                });
              }
            } else if (eventType === "mm_model_delta") {
              setMmMode(true);
              const code = String(data.model_code || "");
              const content = typeof data.content === "string" ? data.content : "";
              if (code && content) {
                setMmResults((prev) => {
                  const idx = prev.findIndex((r) => r.model_code === code);
                  if (idx === -1) return [...prev, { model_code: code, display_name: code, content, icon_url: undefined }];
                  const next = [...prev];
                  next[idx] = { ...next[idx], content: (next[idx].content || "") + content };
                  return next;
                });
              }
            } else if (eventType === "mm_model_done") {
              setMmMode(true);
              const code = String(data.model_code || "");
              if (code && typeof data.error === "object" && data.error) {
                const errObj = data.error as { code?: string; message?: string };
                upsertMmResult({
                  model_code: code,
                  error: { code: errObj.code || "MODEL_PROVIDER_ERROR", message: errObj.message || "Model error" },
                });
              }
            } else if (eventType === "mm_done") {
              setMmMode(true);
              if (typeof data.conversation_id === "string" && data.conversation_id) {
                setConversationId(data.conversation_id);
              }
              if (typeof data.summary === "string") setMmSummary(data.summary);
              if (Array.isArray(data.results)) {
                const items = data.results as any[];
                setMmResults(
                  items
                    .filter((x) => x && typeof x.model_code === "string")
                    .map((x) => ({
                      model_code: String(x.model_code),
                      display_name: String(x.display_name || x.model_code),
                      icon_url: typeof x.icon_url === "string" ? x.icon_url : undefined,
                      content: typeof x.content === "string" ? x.content : "",
                      error: x.error && typeof x.error === "object" ? { code: String(x.error.code || ""), message: String(x.error.message || "") } : undefined,
                    }))
                );
              }
            } else if (eventType === "delta" && typeof data.content === "string") {
              applyDelta(data.content);
            } else if (eventType === "done") {
              if (typeof data.conversation_id === "string" && data.conversation_id) {
                setConversationId(data.conversation_id);
              }
            } else if (eventType === "error" || eventType === "mm_error") {
              throw new Error((data.message as string) || "Model error");
            } else if (!eventType && typeof data.content === "string") {
              applyDelta(data.content);
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Chat failed";
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant" && !last.content) {
          updated[updated.length - 1] = { role: "assistant", content: `[${msg}]` };
        } else if (last?.role === "user") {
          updated.push({ role: "assistant", content: `[${msg}]` });
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (refImages.length >= maxRefImages) {
      alert(t("workspace.maxReferenceImages", { max: maxRefImages }));
      return;
    }
    setUploading(true);
    try {
      const next: RefImage[] = [];
      for (const f of Array.from(files).slice(0, maxRefImages - refImages.length)) {
        const asset = await uploadAsset(f, { name: f.name, kind: "image", asset_type: "prop" });
        next.push({ url: asset.url, name: asset.name || f.name, public_id: asset.public_id });
      }
      setRefImages((prev) => [...prev, ...next].slice(0, maxRefImages));
    } catch (err) {
      alert(err instanceof Error ? err.message : t("asset.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleMediaTask = async () => {
    if (isVideo && videoConfig.prompt_required !== false && !prompt.trim()) {
      alert(t("workspace.enterPrompt"));
      return;
    }
    if (isAudio && audioConfig.prompt_required !== false && !prompt.trim()) {
      alert(t("workspace.enterText"));
      return;
    }
    if (!isVideo && !isAudio && !prompt.trim()) return;
    setTaskStatus("pending");
    setTaskOutput(null);
    setTaskImages([]);
    setTaskVideos([]);
    setTaskProgress(8);
    try {
      const imageParams = isImage
        ? {
            ...buildImageGenerationParams({ count: imageCount, ratio: imageRatio, imageSize }),
            ...buildLanguageParams(selectedLanguage),
            user_prompt: prompt,
            ...(bottom.role_prompt ? { role_prompt: bottom.role_prompt } : {}),
            ...(bottom.asset_ids?.length ? { asset_ids: bottom.asset_ids } : {}),
          }
        : {};
      const selectedAssets = bottom.asset_ids?.length ? { asset_ids: bottom.asset_ids } : {};
      const selectedReferenceAssets = referenceAssetIds.length ? { reference_asset_ids: referenceAssetIds } : {};
      const taskParams = isVideo
        ? { ...buildVideoTaskParams(params, videoMedia, model.runtime_rule), ...buildLanguageParams(selectedLanguage), user_prompt: prompt, ...selectedAssets, ...selectedReferenceAssets }
        : isAudio
          ? {
              ...buildAudioTaskParams(params, prompt, audioSecondaryPrompt, model.runtime_rule),
              ...(audioRef?.url ? { reference_audio: audioRef.url } : {}),
              ...selectedAssets,
            }
          : {
            ...params,
            ...imageParams,
            user_prompt: prompt,
            ...(refImages.length ? { reference_images: refImages.map((x) => x.url) } : {}),
            ...selectedReferenceAssets,
          };
      const task = await api<{
        task_no: string;
        status: string;
        error_message?: string;
      }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ model_code: model.code, prompt, params: taskParams }),
      });
      setTaskStatus(task.status);
      setTaskProgress(fallbackProgress(task.status, 8));
      if (task.status === "failed") {
        alert(task.error_message || t("workspace.insufficientBalance"));
        return;
      }
      const interval = setInterval(async () => {
        const nextTask = await api<{
          status: string;
          output: Record<string, unknown>;
          error_message?: string;
        }>(`/api/tasks/${task.task_no}`);
        setTaskStatus(nextTask.status);
        api<unknown[]>(`/api/tasks/${task.task_no}/events`)
          .then((events) => {
            const progress = latestProgressFromEvents(events);
            if (progress >= 0) setTaskProgress((current) => Math.max(current, progress));
            else setTaskProgress((current) => fallbackProgress(nextTask.status, current));
          })
          .catch(() => setTaskProgress((current) => fallbackProgress(nextTask.status, current)));
        if (nextTask.status === "succeeded") {
          const media = extractTaskOutput(nextTask.output);
          setTaskOutput(media.videoURLs[0]?.url || media.audioURL || media.imageURLs[0] || null);
          setTaskImages(media.imageURLs);
          setTaskVideos(media.videoURLs);
          setTaskProgress(100);
          clearInterval(interval);
        } else if (nextTask.status === "failed") {
          alert(nextTask.error_message || t("workspace.generationFailed"));
          clearInterval(interval);
        }
      }, 2000);
    } catch (err) {
      setTaskStatus("");
      alert(err instanceof Error ? err.message : t("workspace.submitFailed"));
    }
  };

  const submit = () => (isChat ? handleChat() : handleMediaTask());

  const hasConversation = messages.length > 0 || !!taskOutput || taskImages.length > 0 || taskVideos.length > 0 || !!taskStatus;
  const currentPreset = isChat ? channelPresets.find((p) => p.key === bottom.channel_key) : undefined;
  const normalizePresetCodes = (codes?: string[]) => {
    const seen = new Set<string>();
    const hasModelMap = Object.keys(modelMap).length > 0;
    return (codes || [])
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((code) => {
        if (!code || seen.has(code)) return false;
        if (hasModelMap && !modelMap[code]) return false;
        seen.add(code);
        return true;
      });
  };
  const presetAnswerCodes = normalizePresetCodes(
    currentPreset?.answer_model_codes?.length ? currentPreset.answer_model_codes : currentPreset?.model_codes || []
  );
  const presetSummaryCodes = normalizePresetCodes(currentPreset?.summary_model_codes || []);
  const badgeFromCode = (code: string): ModelBadge => ({
    code,
    icon: modelMap[code]?.icon_url,
    label: modelMap[code]?.display_name || code,
  });
  // Answer badges: prefer live multi-model results, otherwise show the preset's
  // configured answer models so the UI always matches the backend preset.
  const answerBadges: ModelBadge[] =
    mmResults.length > 0
      ? mmResults.map((r) => ({ code: r.model_code, icon: r.icon_url, label: r.display_name || r.model_code })).slice(0, 4)
      : presetAnswerCodes.map(badgeFromCode).slice(0, 4);
  const summaryBadge: ModelBadge | undefined =
    presetSummaryCodes.length > 0 ? badgeFromCode(presetSummaryCodes[0]) : undefined;
  const badgeBottom = "bottom-28 lg:bottom-20";

  return (
    <div className="workspace-surface flex flex-col h-full min-h-0">
      {onOpenModelPicker && (
        <div className="lg:hidden flex items-center gap-2 px-3 py-2.5 bg-white border-b border-gray-100 shrink-0 dark:bg-gray-900 dark:border-white/10">
          <button
            type="button"
            onClick={onOpenModelPicker}
            className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-600 shrink-0 dark:bg-white/10 dark:text-gray-200"
            aria-label="Open model picker"
          >
            <ChevronDown size={16} className="rotate-90" />
          </button>
          {onOpenNav && (
            <button
              type="button"
              onClick={onOpenNav}
              className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-600 shrink-0 dark:bg-white/10 dark:text-gray-200"
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
          )}
          <div className="flex-1 min-w-0 font-semibold text-sm text-gray-900 truncate dark:text-gray-100">{modelName}</div>
          <Link href="/app/wallet" className="text-xs text-primary font-medium shrink-0 tabular-nums">
            {menuWallet?.compute_balance?.toFixed(0) ?? "0"}
          </Link>
        </div>
      )}
      {/* Top action bar */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-1.5 sm:py-3 max-lg:border-b max-lg:border-gray-100/80 shrink-0 flex-wrap dark:border-white/10">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => {
              setMessages([]);
              setTaskOutput(null);
              setTaskStatus("");
              setConversationId("");
            }}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-primary text-dark text-[13px] font-semibold shadow-sm hover:bg-primary/90 transition"
          >
            <Plus size={15} />
              <span className="hidden sm:inline">{t("common.newTask")}</span>
          </button>
          <div className="relative" data-starai-history>
            <button
              onClick={openHistory}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-white text-gray-600 text-[13px] shadow-sm border border-gray-100 hover:border-gray-200 transition dark:bg-white/5 dark:text-gray-300 dark:border-white/10 dark:hover:border-white/20"
            >
              <History size={15} />
              <span className="hidden sm:inline">{t("common.history")}</span>
              <ChevronDown size={14} className="hidden sm:block" />
            </button>
            {historyOpen && (
              <div className="fixed sm:absolute left-4 right-4 sm:left-0 sm:right-auto sm:mt-2 sm:w-[300px] top-16 sm:top-auto soft-card p-2 z-30 max-h-[60vh] overflow-y-auto">
                {historyItems.length === 0 ? (
                  <div className="text-center text-xs text-gray-400 py-6">{UI_TEXT.historyEmpty}</div>
                ) : (
                  historyItems.map((item) => (
                    <button
                      key={`${item.kind}-${item.id}`}
                      onClick={() => (item.kind === "chat" ? loadConversation(item.id) : loadTaskHistory(item.id))}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-50 transition dark:text-gray-200 dark:hover:bg-white/5"
                    >
                      <div className="text-sm text-gray-800 truncate dark:text-gray-100">
                        {item.title || item.id}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5 flex items-center justify-between gap-2">
                        <span>{new Date(item.updated_at).toLocaleString()}</span>
                        {item.status && <span>{statusLabel(item.status)}</span>}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
        <div className="relative" data-starai-notif>
          <button
            onClick={openNotif}
            className="relative w-9 h-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center text-gray-500 shadow-sm hover:border-gray-200 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:border-white/20"
            aria-label={unread > 0 ? `${unread} ${t("notifications.title")}` : t("notifications.title")}
          >
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
            )}
          </button>
          {notifOpen && (
            <div className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 sm:mt-2 sm:w-[320px] top-16 sm:top-auto soft-card z-30 max-h-[60vh] overflow-hidden flex flex-col min-w-0">
              <div className="flex items-center justify-between px-3 py-2 shrink-0 border-b border-gray-50 dark:border-white/10">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {t("notifications.title")}{unread > 0 ? ` (${unread})` : ""}
                </span>
                {notifItems.some((n) => !n.is_read) && (
                  <button onClick={markAllRead} className="text-[11px] text-primary hover:underline shrink-0 ml-2">
                    {t("notifications.markAll")}
                  </button>
                )}
              </div>
              <div className="overflow-y-auto overflow-x-hidden p-2 min-h-0 flex-1">
                {notifNeedLogin ? (
                  <div className="text-center text-xs text-gray-500 py-6 px-3 break-words">
                    {t("notifications.loginHint")}
                  </div>
                ) : notifLoading ? (
                  <div className="text-center text-xs text-gray-400 py-6">{t("common.loading")}</div>
                ) : notifItems.length === 0 ? (
                  <div className="text-center text-xs text-gray-400 py-6 px-3 break-words">
                    {t("notifications.empty")}
                    <div className="mt-1 text-[11px] text-gray-300">
                      {t("notifications.emptyDesc")}
                    </div>
                  </div>
                ) : (
                  notifItems.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => markNotifRead(n.id)}
                      className={`w-full max-w-full text-left px-3 py-2 rounded-xl transition-colors hover:bg-gray-50 overflow-hidden dark:hover:bg-white/5 ${n.is_read ? "" : "bg-primary/5"}`}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {!n.is_read && (
                          <span className="mt-1.5 w-1.5 h-1.5 shrink-0 rounded-full bg-red-500" />
                        )}
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="text-sm text-gray-800 dark:text-gray-100 break-words [overflow-wrap:anywhere]">{notificationTitle(t, n.title, n.type)}</div>
                          <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                            {n.content}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-1">
                            {new Date(n.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <UILanguageSelector compact />
        <WorkbenchUserMenu onRecharge={onRecharge} />
        </div>
      </div>

      {/* Scrollable main */}
      <div className={`flex-1 px-4 sm:px-5 w-full ${hasConversation ? "overflow-y-auto pb-6" : "overflow-y-auto max-lg:overflow-y-auto pb-3"} min-h-0`}>
        {messages.length === 0 && !taskOutput && !taskStatus ? (
          <div className="min-h-full flex flex-col justify-center max-lg:justify-start max-lg:py-4">
            <div className="w-full max-lg:pt-1">
              {/* Hero banner */}
              <div className={clsx("soft-card w-full max-w-[980px] mx-auto p-4 sm:p-10 text-center mb-3 max-lg:mb-5", (isImage || isVideo) && "tech-card")}>
                <div className="tech-icon w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-xl sm:text-2xl mx-auto mb-3 sm:mb-4 overflow-hidden shadow-sm dark:bg-white/10 dark:border-white/10">
                  {model.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={model.icon_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    MODEL_ICONS[model.category] || "AI"
                  )}
                </div>
                <h1 className={clsx("text-base sm:text-xl font-bold text-gray-900 mb-1 sm:mb-1.5 dark:text-gray-100", (isImage || isVideo) && "tech-title")}>{modelName}</h1>
                <p className="text-gray-500 text-[12px] sm:text-[13px] max-w-md mx-auto leading-relaxed line-clamp-3 sm:line-clamp-none">
                  {modelDescription}
                </p>
                {model.tags?.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1 sm:gap-1.5 mt-2 sm:mt-3">
                    {model.tags.slice(0, 6).map((tagText) => (
                      <span key={tagText} className="px-1.5 sm:px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] sm:text-xs dark:bg-white/10 dark:text-gray-300">
                        {td(`model.${model.code}.tag.${tagText}`, tagText)}
                      </span>
                    ))}
                  </div>
                )}
                <span className={`inline-block mt-2 sm:mt-3 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium ${tag.className}`}>
                  {modelCategoryLabel}
                </span>
              </div>

              {(isImage || isVideo) && (
                <div className="mx-auto mb-3 flex w-full max-w-[980px] justify-center max-lg:mb-4">
                  <div className="input-status-line">
                    <span className="typing-status-text">
                      {isVideo ? t("workspace.waitVideoInput") : t("workspace.waitImageInput")}
                    </span>
                    <span className="input-status-hint">
                      {t("workspace.submitHint")}
                    </span>
                  </div>
                </div>
              )}

              {/* Feature grid (multi-collab only) */}
              {isMultiCollab && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 w-full max-w-[980px] mx-auto max-lg:mb-2">
                  {(homeCards.length ? homeCards : []).map((f) => {
                    const title = td(`homeCard.${f.key}.title`, f.title);
                    const description = td(`homeCard.${f.key}.description`, f.description || "");
                    const bg =
                      f.theme === "amber"
                        ? "bg-amber-50 text-amber-600"
                        : f.theme === "purple"
                        ? "bg-purple-50 text-purple-600"
                        : f.theme === "blue"
                        ? "bg-blue-50 text-blue-600"
                        : f.theme === "pink"
                        ? "bg-pink-50 text-pink-600"
                        : f.theme === "green"
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-gray-50 text-gray-600";
                    return (
                      <div key={f.key} className="soft-card p-3 sm:p-4 flex gap-2.5 sm:gap-3 items-start">
                        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center text-base sm:text-lg shrink-0 ${bg} overflow-hidden`}>
                          {f.icon_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={f.icon_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            f.icon_emoji || "AI"
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">{title}</h3>
                          {description && <p className="text-xs text-gray-500 mt-1 leading-relaxed dark:text-gray-400">{description}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : isChat ? (
          <div className="max-w-[980px] mx-auto space-y-4 py-4">
            {mmMode ? (
              <div className="soft-card p-4">
                {messages
                  .filter((msg) => msg.role === "user")
                  .map((msg, i) => (
                    <div key={`mm-user-${i}`} className="mb-4 flex justify-end">
                      <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-primary text-dark whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  ))}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setMmActiveTab("answer")}
                      className={`h-8 px-3 rounded-xl text-sm border ${
                        mmActiveTab === "answer" ? "bg-primary/15 border-primary/30 text-gray-900 dark:text-gray-100" : "bg-white border-gray-200 text-gray-600 dark:bg-white/5 dark:border-white/10 dark:text-gray-300"
                      }`}
                    >
                      {t("channel.answer")}
                    </button>
                    <button
                      onClick={() => setMmActiveTab("summary")}
                      className={`h-8 px-3 rounded-xl text-sm border ${
                        mmActiveTab === "summary" ? "bg-primary/15 border-primary/30 text-gray-900 dark:text-gray-100" : "bg-white border-gray-200 text-gray-600 dark:bg-white/5 dark:border-white/10 dark:text-gray-300"
                      }`}
                    >
                      {t("channel.summary")}
                    </button>
                  </div>
                  <div className="flex items-center -space-x-2">
                    {mmResults.slice(0, 8).map((r) => (
                      <div key={r.model_code} className="w-8 h-8 rounded-xl bg-white border border-gray-100 overflow-hidden flex items-center justify-center shadow-sm">
                        {r.icon_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.icon_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs text-gray-400">AI</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {mmActiveTab === "summary" ? (
                  <div className="mt-3 rounded-2xl bg-white border border-gray-100 px-4 py-4">
                    <div className="mb-2 flex items-center justify-end">
                      <CopyOutputButton
                        text={mmSummary}
                        copied={copiedOutputKey === "mm-summary"}
                        onCopy={() => handleCopyOutput("mm-summary", mmSummary)}
                      />
                    </div>
                    <RichMarkdown content={mmSummary} emptyText={streaming ? UI_TEXT.summaryGenerating : UI_TEXT.noSummary} />
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {mmResults.length === 0 ? (
                      <div className="text-sm text-gray-500 px-2 py-6 text-center">{UI_TEXT.waitingModel}</div>
                    ) : (
                      mmResults.map((r) => (
                        <div key={r.model_code} className="bg-white border border-gray-100 rounded-2xl p-4">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center">
                              {r.icon_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.icon_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-xs text-gray-400">AI</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-900 truncate">{r.display_name}</div>
                              <div className="text-[11px] text-gray-400 truncate">{r.model_code}</div>
                            </div>
                          </div>
                          {r.error ? (
                            <div className="text-sm text-red-600">[{r.error.message}]</div>
                          ) : (
                            <>
                              <div className="mb-2 flex items-center justify-end">
                                <CopyOutputButton
                                  text={r.content}
                                  copied={copiedOutputKey === `mm-${r.model_code}`}
                                  onCopy={() => handleCopyOutput(`mm-${r.model_code}`, r.content)}
                                />
                              </div>
                              <RichMarkdown content={r.content} emptyText={streaming ? UI_TEXT.generating : ""} />
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === "user" ? "bg-primary text-dark whitespace-pre-wrap" : "soft-card text-gray-800"
                      }`}
                    >
                      {msg.role === "user" ? (
                        msg.content
                      ) : (
                        <>
                          <div className="mb-2 flex items-center justify-end">
                            <CopyOutputButton
                              text={msg.content}
                              copied={copiedOutputKey === `msg-${i}`}
                              onCopy={() => handleCopyOutput(`msg-${i}`, msg.content)}
                            />
                          </div>
                          <RichMarkdown content={msg.content} emptyText={streaming && i === messages.length - 1 ? UI_TEXT.thinking : ""} />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
            <div ref={bottomRef} />
          </div>
        ) : (
          <div className="max-w-[980px] mx-auto py-4">
            {taskStatus && (
              <div className="soft-card p-5 mb-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-gray-500">{UI_TEXT.taskStatus}:</span>
                    <span className="font-medium ml-1">{statusLabel(taskStatus)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    {isSucceededStatus(taskStatus) && isImage && taskImages.length > 0 && (
                      <span>{taskImages.length} {UI_TEXT.imageUnit}</span>
                    )}
                    {isSucceededStatus(taskStatus) && isVideo && taskVideos.length > 0 && (
                      <span>{taskVideos.length} 个视频</span>
                    )}
                    {!isSucceededStatus(taskStatus) && taskStatus.toLowerCase() !== "failed" && (
                      <span>{Math.round(taskProgress)}%</span>
                    )}
                  </div>
                </div>
                {!isSucceededStatus(taskStatus) && taskStatus.toLowerCase() !== "failed" && (
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-secondary transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(4, taskProgress))}%` }}
                    />
                  </div>
                )}
              </div>
            )}
            {isVideo && (taskVideos.length > 0 || taskOutput) && (
              <ModelMediaResultGrid type="video" videos={taskVideos.length > 0 ? taskVideos : [{ url: taskOutput || "" }]} />
            )}
            {taskOutput && isAudio && (
              <audio src={taskOutput} controls className="w-full max-w-lg" />
            )}
            {isImage && taskImages.length > 0 && (
              <ModelMediaResultGrid type="image" images={taskImages} />
            )}
            {isImage && taskImages.length === 0 && taskStatus && !isSucceededStatus(taskStatus) && taskStatus.toLowerCase() !== "failed" && (
              <ModelMediaPendingGrid type="image" count={imageCount} />
            )}
            {isImage && isSucceededStatus(taskStatus) && taskImages.length === 0 && (
              <div className="soft-card p-5 text-sm text-amber-700 bg-amber-50 border border-amber-100">
                {UI_TEXT.noImageResult}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input section */}
      <div className="shrink-0 px-3 sm:px-5 pt-2 max-lg:pt-3 pb-6 sm:pb-6 max-lg:pb-8">
        <div className="w-full max-w-[980px] mx-auto">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-2 px-1">
            <div className="flex items-center gap-1.5">
            <Plus size={12} />
            {t("workspace.quickStart")}
            </div>
            <span className="text-[11px] text-gray-400">
              {bottom.role_name ? `Role: ${bottom.role_name}` : ""}
            </span>
          </div>
          <div className="soft-input overflow-hidden">
            {isChat ? (
              <div className="px-3 sm:px-4 py-2 border-b border-gray-50">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <ChatTopTools value={bottom} onChange={setBottom} />
                    {isMultiCollab && (
                      <div className="flex lg:hidden items-center gap-1 h-9 shrink-0">
                        {/* compact collaborator logos */}
                        <div className="scroll-x-only flex flex-nowrap items-center -space-x-1 max-w-[120px] sm:max-w-[160px]">
                          {answerBadges.map((b, i) => (
                            <BadgeCircle key={b.code + i} badge={b} size={22} />
                          ))}
                          {summaryBadge && (
                            <div className="ml-0.5">
                              <BadgeCircle badge={summaryBadge} size={22} />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <InputToolbarMeta onPricing={() => setPricingOpen(true)} />
                </div>
              </div>
            ) : (
              <div className="px-3 sm:px-4 py-2.5 border-b border-gray-50 space-y-3">
                {isImage ? (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="flex-1 min-w-0">
                        <ChatTopTools
                          value={bottom}
                          onChange={setBottom}
                          showUpload={false}
                          referencePickMode
                          referenceImages={refImages}
                          onReferenceImagesChange={setRefImages}
                          maxReferenceImages={maxRefImages}
                        />
                      </div>
                      <InputToolbarMeta
                        onPricing={() => setPricingOpen(true)}
                        costHint={estimatedCost != null ? `Est. ${estimatedCost.toFixed(2)}/run` : null}
                      />
                    </div>
                    {maxRefImages > 0 ? (
                      <div className="scroll-x-only flex flex-nowrap items-center gap-2 w-full h-16">
                        {refImages.map((img, i) => (
                          <div key={img.url} className="relative w-16 h-16 rounded-2xl overflow-hidden border-2 border-white shadow-lg bg-gray-100 shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setRefImages((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                              title="Remove reference"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                        {refImages.length < maxRefImages && (
                          <label className="relative w-20 h-16 rounded-2xl border border-dashed border-gray-200 bg-white shadow-sm flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition shrink-0">
                            <Plus size={18} className="text-gray-400" />
                            <span className="text-[10px] text-gray-400 whitespace-nowrap">{t("common.reference")} {refImages.length}/{maxRefImages}</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              multiple
                              className="hidden"
                              disabled={uploading}
                              onChange={(e) => {
                                handleUpload(e.target.files);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        )}
                      </div>
                    ) : (
                      <div className="h-9 px-3 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-400 flex items-center">
                        {t("model.referenceUnsupported")}
                      </div>
                    )}
                  </div>
                ) : isVideo ? (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="flex-1 min-w-0">
                        <ChatTopTools
                          value={bottom}
                          onChange={setBottom}
                          showUpload={false}
                          referencePickMode
                          referenceImages={videoMedia.reference_images}
                          onReferenceImagesChange={(imgs) =>
                            setVideoMedia((prev) => ({ ...prev, reference_images: imgs }))
                          }
                          maxReferenceImages={maxVideoAssetRefs}
                        />
                      </div>
                      <InputToolbarMeta
                        onPricing={() => setPricingOpen(true)}
                        costHint={estimatedCost != null ? `Est. ${estimatedCost.toFixed(2)}/run` : null}
                      />
                    </div>
                    <VideoUploadArea config={videoConfig} media={videoMedia} onChange={setVideoMedia} />
                  </div>
                ) : isAudio ? (
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1 h-9">
                      {audioConfig.show_upload && (
                        <AudioUploadButton
                          url={audioRef?.url}
                          name={audioRef?.name}
                          onChange={setAudioRef}
                        />
                      )}
                    </div>
                    <InputToolbarMeta
                      onPricing={() => setPricingOpen(true)}
                      pricingLabel={t("workspace.tokenBilling")}
                      costHint={
                        audioConfig.billing_hint === "per_token"
                          ? undefined
                          : estimatedCost != null
                            ? `Est. ${estimatedCost.toFixed(2)}/run`
                            : null
                      }
                    />
                  </div>
                ) : (
                  <>
                    {hasSchemaFields && (
                      <SchemaForm schema={model.input_schema} values={params} onChange={setParams} />
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      {refImages.map((img, i) => (
                        <div key={img.url} className="relative w-12 h-12 rounded-lg overflow-hidden border border-gray-200">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                          <button
                            onClick={() => setRefImages((prev) => prev.filter((_, idx) => idx !== i))}
                            className="absolute top-0 right-0 w-4 h-4 bg-black/60 text-white flex items-center justify-center rounded-bl"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      {refImages.length < maxRefImages && (
                        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 text-gray-600 text-xs hover:bg-gray-100 transition cursor-pointer">
                          <Upload size={14} />
                          {uploading ? "Uploading..." : "Upload"}
                          <span className="text-gray-400">{refImages.length}/{maxRefImages}</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            multiple
                            className="hidden"
                            disabled={uploading}
                            onChange={(e) => {
                              handleUpload(e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {isAudio && audioConfig.input_layout === "dual" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-50">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={audioConfig.prompt_hint || "Enter text..."}
                  rows={5}
                  className="w-full px-4 py-3 text-sm resize-none focus:outline-none bg-transparent placeholder:text-gray-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <textarea
                  value={audioSecondaryPrompt}
                  onChange={(e) => setAudioSecondaryPrompt(e.target.value)}
                  placeholder={
                    audioConfig.secondary_prompt_hint ||
                    "Enter a secondary prompt..."
                  }
                  rows={5}
                  className="w-full px-4 py-3 text-sm resize-none focus:outline-none bg-transparent placeholder:text-gray-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              </div>
            ) : (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={promptPlaceholder}
                rows={isVideo || isAudio ? 4 : 3}
                className="w-full px-4 py-3 text-sm resize-none focus:outline-none bg-transparent placeholder:text-gray-400"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            )}
            <div
              className={
                isMultiCollab
                  ? "flex flex-col gap-2 px-3 sm:px-4 py-2.5 border-t border-gray-50 sm:flex-row sm:items-center sm:justify-between"
                  : "flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-t border-gray-50"
              }
            >
              <div
                className={
                  isMultiCollab
                    ? "w-full min-w-0 scroll-x-only sm:flex-1 sm:overflow-visible"
                    : "flex flex-1 items-center gap-1.5 sm:gap-2 flex-wrap min-w-0"
                }
              >
                {isMultiCollab && <BottomBar value={bottom} onChange={setBottom} showWebSearch={false} showTimeout={false} />}
                {isChatSingle && (
                  <>
                    {capDeepThink && (
                      <button
                        type="button"
                        className="h-9 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
                      >
                        Deep think
                      </button>
                    )}
                    {capWebSearch && (
                      <button
                        type="button"
                        onClick={() => setBottom({ ...bottom, web_search: !bottom.web_search })}
                        className={`h-9 px-3 rounded-xl border text-sm ${
                          bottom.web_search
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-gray-50 border-gray-200 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
                        }`}
                      >
                        Web search
                      </button>
                    )}
                  </>
                )}
                {isImage && (
                  <>
                    <ImageGenerationToolbar
                      count={imageCount}
                      onCountChange={setImageCount}
                      ratio={imageRatio}
                      onRatioChange={setImageRatio}
                      imageSize={imageSize}
                      onImageSizeChange={setImageSize}
                    />
                    <GenerationLanguageMenu languages={generationLanguages} value={languageCode} onChange={setLanguageCode} />
                  </>
                )}
                {isVideo && (
                  <>
                    {(videoConfig.show_channel || videoConfig.show_web_search) && (
                      <BottomBar
                        value={bottom}
                        onChange={setBottom}
                        showChannel={videoConfig.show_channel !== false}
                        showWebSearch={!!videoConfig.show_web_search}
                        showTimeout={false}
                      />
                    )}
                    <VideoOptionToolbar
                      schema={model.input_schema}
                      values={params}
                      onChange={setParams}
                      videoConfig={videoConfig}
                    />
                    <GenerationLanguageMenu languages={generationLanguages} value={languageCode} onChange={setLanguageCode} />
                  </>
                )}
                {isAudio && (
                  <>
                    {(audioConfig.show_channel || audioConfig.show_web_search) && (
                      <BottomBar
                        value={bottom}
                        onChange={setBottom}
                        showChannel={audioConfig.show_channel !== false}
                        showWebSearch={!!audioConfig.show_web_search}
                        showTimeout={false}
                      />
                    )}
                    <AudioOptionToolbar
                      schema={model.input_schema}
                      values={params}
                      onChange={setParams}
                      audioConfig={audioConfig}
                    />
                  </>
                )}
                {estimatedCost !== null && !isVideo && !isImage && !isAudio && !isMultiCollab && (
                  <span className="text-xs text-primary ml-1">
                    Est. {estimatedCost.toFixed(4)}
                  </span>
                )}
              </div>
              <div className={isMultiCollab ? "flex items-center justify-between gap-2 w-full sm:w-auto shrink-0" : "shrink-0"}>
                {estimatedCost !== null && isMultiCollab && (
                  <span className="text-xs text-primary whitespace-nowrap">
                    Est. {estimatedCost.toFixed(4)}
                  </span>
                )}
                {estimatedCost === null && estimateError && isMultiCollab && (
                  <span className="text-xs text-amber-500 whitespace-nowrap">
                    {t("workspace.modelPriceMissing")}
                  </span>
                )}
              <button
                onClick={submit}
                disabled={
                  streaming ||
                  (isVideo
                    ? videoConfig.prompt_required !== false && !prompt.trim()
                    : isAudio
                      ? audioConfig.prompt_required !== false && !prompt.trim()
                      : !prompt.trim())
                }
                className="w-9 h-9 rounded-full bg-secondary text-white flex items-center justify-center hover:bg-secondary/90 disabled:opacity-40 transition shadow-md shrink-0"
              >
                <ArrowUp size={18} />
              </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating model badges - bottom right */}
      {isMultiCollab && (
        <>
          {/* Full badge (desktop, enough space) */}
          {!compactBadge && (
            <div className={`fixed ${badgeBottom} right-8 soft-card px-3 py-2 shadow-lg z-10 hidden lg:flex flex-col gap-2 w-[140px]`}>
              <div className="flex items-center justify-between gap-1">
                <div className="text-xs font-medium text-gray-700 shrink-0">{t("channel.answer")}</div>
                <div className="flex -space-x-2">
                  {answerBadges.map((b, i) => (
                    <div key={b.code + i} style={{ zIndex: answerBadges.length - i }}>
                      <BadgeCircle badge={b} size={28} />
                    </div>
                  ))}
                  {answerBadges.length === 0 && <div className="text-[11px] text-gray-400">{t("channel.unconfigured")}</div>}
                </div>
              </div>
              <div className="h-px bg-gray-100 dark:bg-white/10" />
              <div className="flex items-center justify-between gap-1">
                <div className="text-xs text-gray-500 shrink-0">{t("channel.summary")}</div>
                <div className="flex">
                  {summaryBadge ? (
                    <BadgeCircle badge={summaryBadge} size={28} />
                  ) : (
                    <div className="text-[11px] text-gray-400">{t("channel.unconfigured")}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Compact badge (small/zoomed screens) */}
          {compactBadge && (
            <>
              <button
                type="button"
                onClick={() => setBadgeOpen(true)}
                className={`fixed ${badgeBottom} right-4 z-10 soft-card w-10 h-10 flex items-center justify-center shadow-lg max-lg:hidden`}
                title={`${t("channel.answer")} / ${t("channel.summary")}`}
              >
                {summaryBadge ? (
                  <BadgeCircle badge={summaryBadge} size={32} />
                ) : answerBadges[0] ? (
                  <BadgeCircle badge={answerBadges[0]} size={32} />
                ) : (
                  <div className="text-[11px] text-gray-400">MM</div>
                )}
              </button>
              {badgeOpen && (
                <div className="fixed inset-0 z-[50] bg-black/40 flex items-center justify-center p-4" onClick={() => setBadgeOpen(false)}>
                  <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden dark:bg-gray-900 dark:border dark:border-white/10" onClick={(e) => e.stopPropagation()}>
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between dark:border-white/10">
                      <div className="font-bold text-gray-900 text-base dark:text-gray-100">{t("channel.answer")} / {t("channel.summary")}</div>
                      <button className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-300" onClick={() => setBadgeOpen(false)}>
                        <X size={16} />
                      </button>
                    </div>
                    <div className="p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t("channel.answerModels")}</div>
                        <div className="flex -space-x-2">
                          {answerBadges.map((b, i) => (
                            <div key={b.code + i} style={{ zIndex: answerBadges.length - i }}>
                              <BadgeCircle badge={b} size={36} />
                            </div>
                          ))}
                          {answerBadges.length === 0 && <div className="text-sm text-gray-400">{t("channel.unconfigured")}</div>}
                        </div>
                      </div>
                      <div className="h-px bg-gray-100 dark:bg-white/10" />
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600 dark:text-gray-300">{t("channel.summaryModels")}</div>
                        {summaryBadge ? (
                          <BadgeCircle badge={summaryBadge} size={36} />
                        ) : (
                          <div className="text-sm text-gray-400">{t("channel.unconfigured")}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      <PricingModal open={pricingOpen} onClose={() => setPricingOpen(false)} currentModelCode={model.code} />
    </div>
  );
}
