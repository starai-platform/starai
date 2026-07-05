"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Film, Image as ImageIcon, Music, Sparkles, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Work } from "@starai/shared-types";

type MediaKind = "image" | "video" | "audio";
type MediaItem = { kind: MediaKind; url: string; thumbnail?: string };

function collectURLs(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectURLs(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      ...collectURLs(record.url),
      ...collectURLs(record.image_url),
      ...collectURLs(record.video_url),
      ...collectURLs(record.audio_url),
      ...collectURLs(record.result_url),
      ...collectURLs(record.download_url),
      ...collectURLs(record.file_url),
    ];
  }
  return [];
}

function collectMedia(work: Work): MediaItem[] {
  const meta = work.metadata || {};
  const items: MediaItem[] = [];
  const add = (kind: MediaKind, url?: string, thumbnail?: string) => {
    const clean = (url || "").trim();
    if (!clean || items.some((item) => item.url === clean)) return;
    items.push({ kind, url: clean, thumbnail: thumbnail?.trim() || undefined });
  };

  for (const url of collectURLs(meta.image_url)) add("image", url);
  for (const url of collectURLs(meta.images)) add("image", url);

  const videos = Array.isArray(meta.videos) ? meta.videos : meta.video_url ? [meta.video_url] : [];
  for (const raw of videos) {
    if (typeof raw === "string") {
      add("video", raw, typeof meta.thumbnail === "string" ? meta.thumbnail : work.thumbnail_url);
    } else if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      add(
        "video",
        collectURLs(record.url)[0] || collectURLs(record.video_url)[0],
        collectURLs(record.thumbnail)[0] || collectURLs(record.cover)[0] || collectURLs(record.poster_url)[0] || work.thumbnail_url
      );
    }
  }

  for (const url of collectURLs(meta.audio_url)) add("audio", url);
  for (const url of collectURLs(meta.audios)) add("audio", url);

  if (items.length === 0 && work.thumbnail_url) {
    add(work.type === "video" ? "video" : work.type === "audio" ? "audio" : "image", work.thumbnail_url);
  }
  return items;
}

function displayType(kind: string) {
  if (kind === "video") return "视频";
  if (kind === "audio") return "音频";
  return "图片";
}

function MediaIcon({ kind }: { kind?: string }) {
  if (kind === "video") return <Film size={14} />;
  if (kind === "audio") return <Music size={14} />;
  return <ImageIcon size={14} />;
}

function isVideoLikeURL(url?: string) {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(url) || /\/videos\/[^/]+\/content/i.test(url);
}

function VideoThumb({ src, poster, alt = "" }: { src: string; poster?: string; alt?: string }) {
  const usablePoster = !!poster && poster !== src && !isVideoLikeURL(poster);
  const [thumb, setThumb] = useState(usablePoster ? poster || "" : "");
  const [capturing, setCapturing] = useState(!usablePoster);

  useEffect(() => {
    if (usablePoster) {
      setThumb(poster || "");
      setCapturing(false);
      return;
    }
    setThumb("");
    setCapturing(true);
    let cancelled = false;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = src;

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
    const finish = () => {
      if (!cancelled) setCapturing(false);
      cleanup();
    };
    const capture = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, video.videoWidth || 640);
        canvas.height = Math.max(1, video.videoHeight || 360);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas unavailable");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        setThumb(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        // Cross-origin videos may block canvas capture. The fallback <video> below still shows metadata preview.
      } finally {
        finish();
      }
    };
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(0.2, Math.max(0, (video.duration || 1) - 0.05));
      } catch {
        capture();
      }
    };
    video.onseeked = capture;
    video.onerror = finish;
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [poster, src, usablePoster]);

  if (thumb) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumb} alt={alt} className="h-full w-full object-cover" onError={() => setThumb("")} />;
  }
  return (
    <div className="relative h-full w-full bg-gray-950">
      <video
        src={src}
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          try {
            e.currentTarget.currentTime = Math.min(0.2, Math.max(0, (e.currentTarget.duration || 1) - 0.05));
          } catch {}
        }}
      />
      {capturing && <div className="absolute inset-0 bg-gray-950/30" />}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/90">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
          <Film size={22} />
        </span>
      </div>
    </div>
  );
}

function MediaThumb({ item, prompt = "" }: { item?: MediaItem; prompt?: string }) {
  if (!item) return <div className="flex h-full w-full items-center justify-center bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500">暂无作品</div>;
  if (item.kind === "video") return <VideoThumb src={item.url} poster={item.thumbnail} alt={prompt} />;
  if (item.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.url} alt={prompt} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />;
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400">
      <Music size={24} />
      <span className="text-xs">音频</span>
    </div>
  );
}

function MosaicPreview({ media, prompt, onOpen }: { media: MediaItem[]; prompt: string; onOpen: (index: number) => void }) {
  const shown = media.slice(0, Math.min(media.length, 4));
  const gridClass =
    shown.length === 1
      ? "grid-cols-1 grid-rows-1"
      : shown.length === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

  return (
    <div className={`grid h-full w-full gap-1 ${gridClass}`}>
      {shown.map((item, index) => (
        <div
          key={`${item.url}-${index}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(index);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onOpen(index);
            }
          }}
          role="button"
          tabIndex={0}
          className={`group/tile relative min-h-0 overflow-hidden bg-gray-100 cursor-pointer dark:bg-white/5 ${shown.length === 3 && index === 0 ? "row-span-2" : ""}`}
        >
          <MediaThumb item={item} prompt={prompt} />
          <div className="absolute inset-0 bg-black/0 transition group-hover/tile:bg-black/10" />
          {item.kind === "video" && (
            <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
              视频
            </span>
          )}
          {index === 3 && media.length > 4 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-semibold text-white">
              +{media.length - 4}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function WorksPage() {
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | MediaKind>("all");
  const [preview, setPreview] = useState<{ work: Work; index: number } | null>(null);
  const [publishDraft, setPublishDraft] = useState<{ work: Work; is_paid: boolean; price: string; title: string } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const load = () => {
    setLoading(true);
    api<{ items: Work[] }>("/api/works?page_size=80")
      .then((r) => setWorks(r.items || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(
    () =>
      works
        .map((work) => ({ work, media: collectMedia(work) }))
        .filter(({ media }) => filter === "all" || media.some((item) => item.kind === filter)),
    [works, filter]
  );

  const previewMedia = preview ? collectMedia(preview.work) : [];
  const currentMedia = previewMedia[preview?.index || 0];

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除这个作品？作品记录和已转存文件都会被清理。")) return;
    await api(`/api/works/${id}`, { method: "DELETE" });
    if (preview?.work.public_id === id) setPreview(null);
    load();
  };

  const openPublish = (work: Work) => {
    setPublishDraft({ work, is_paid: false, price: "", title: work.prompt ? String(work.prompt).slice(0, 24) : "" });
  };

  const submitPublish = async () => {
    if (!publishDraft || publishing) return;
    const price = publishDraft.is_paid ? Number(publishDraft.price || 0) : 0;
    if (publishDraft.is_paid && (!Number.isFinite(price) || price <= 0)) {
      alert("请填写有效的算力点价格");
      return;
    }
    setPublishing(true);
    try {
      await api(`/api/works/${publishDraft.work.public_id}/publish`, {
        method: "POST",
        body: JSON.stringify({ title: publishDraft.title, tags: [], is_paid: publishDraft.is_paid, price }),
      });
      alert("已提交发布，审核通过后会出现在灵感广场。");
      setPublishDraft(null);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  };

  const counts = useMemo(() => {
    const all = works.map(collectMedia);
    return {
      all: all.length,
      image: all.filter((m) => m.some((item) => item.kind === "image")).length,
      video: all.filter((m) => m.some((item) => item.kind === "video")).length,
      audio: all.filter((m) => m.some((item) => item.kind === "audio")).length,
    };
  }, [works]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f7fb] page-padding py-6 sm:py-8 dark:bg-gray-950">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-white/80 bg-white/90 p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between dark:border-white/10 dark:bg-gray-900/90">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-gray-950 px-3 py-1 text-xs font-medium text-white dark:bg-white/10 dark:text-gray-100">
              <Sparkles size={13} />
              创作资源库
            </div>
            <h1 className="text-2xl font-bold text-gray-950 dark:text-gray-100">我的作品</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">图片、视频、音频统一管理；批量生成会以拼图方式展示全部结果。</p>
          </div>
          <div className="flex w-full overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-1 text-sm sm:w-auto dark:border-white/10 dark:bg-white/5">
            {(["all", "image", "video", "audio"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 font-medium transition ${
                  filter === key ? "bg-white text-gray-950 shadow-sm dark:bg-gray-900 dark:text-gray-100" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                }`}
              >
                {key === "all" ? "全部" : displayType(key)}
                <span className={filter === key ? "text-gray-500" : "text-gray-400"}>{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-20 text-center text-sm text-gray-400 dark:border-white/10 dark:bg-gray-900">加载中...</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-20 text-center text-sm text-gray-400 dark:border-white/10 dark:bg-gray-900">暂无作品，去生成一个新作品吧。</div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map(({ work, media }) => {
              const cover = media[0];
              return (
                <article key={work.public_id} className="group overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-white/10 dark:bg-gray-900">
                  <button type="button" className="relative block w-full bg-gray-100 text-left" onClick={() => setPreview({ work, index: 0 })} title="预览作品">
                    <div className="aspect-[4/3] overflow-hidden">
                      <MosaicPreview media={media} prompt={work.prompt || ""} onOpen={(index) => setPreview({ work, index })} />
                    </div>
                    <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                      <MediaIcon kind={cover?.kind || work.type} />
                      {displayType(cover?.kind || work.type)}
                    </div>
                    {media.length > 1 && (
                      <div className="absolute bottom-3 right-3 rounded-full border border-white/70 bg-white/95 px-3 py-1 text-xs font-semibold text-gray-900 shadow-sm dark:border-white/10 dark:bg-gray-950/90 dark:text-gray-100">
                        {media.length} 个作品
                      </div>
                    )}
                  </button>
                  <div className="p-4">
                    <p className="line-clamp-2 min-h-[40px] text-sm leading-5 text-gray-800 dark:text-gray-100">{work.prompt || "未命名作品"}</p>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-white/10">
                      <span className="text-xs text-gray-400">{new Date(work.created_at).toLocaleDateString()}</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => openPublish(work)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-secondary dark:hover:bg-white/5" title="发布到广场">
                          <Upload size={15} />
                        </button>
                        <button type="button" onClick={() => handleDelete(work.public_id)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" title="删除">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {preview && currentMedia && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3 sm:p-4" onClick={() => setPreview(null)}>
          <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3 dark:border-white/10">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-gray-950 dark:text-gray-100">{preview.work.prompt || "未命名作品"}</div>
                <div className="text-xs text-gray-400">
                  {displayType(currentMedia.kind)} · 共 {(preview.index || 0) + 1}/{previewMedia.length} 个作品 · 创建于 {new Date(preview.work.created_at).toLocaleString()}
                </div>
              </div>
              <button type="button" className="shrink-0 rounded-xl border p-2 text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5" onClick={() => setPreview(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="grid max-h-[calc(92vh-57px)] grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex min-h-[320px] items-center justify-center bg-gray-950 p-3 sm:min-h-[520px] sm:p-4">
                {currentMedia.kind === "video" ? (
                  <video src={currentMedia.url} poster={currentMedia.thumbnail} controls playsInline className="max-h-[76vh] w-full object-contain" />
                ) : currentMedia.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={currentMedia.url} alt={preview.work.prompt || ""} className="max-h-[76vh] max-w-full object-contain" />
                ) : (
                  <audio src={currentMedia.url} controls className="w-full max-w-lg" />
                )}
              </div>
              <aside className="border-t bg-white p-4 lg:border-l lg:border-t-0 dark:border-white/10 dark:bg-gray-900">
                <div className="mb-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-500 dark:text-gray-300">全部作品</span>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-500 dark:bg-white/10 dark:text-gray-300">{previewMedia.length} 个</span>
                </div>
                <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 lg:max-h-[48vh] lg:grid-cols-2">
                  {previewMedia.map((item, idx) => (
                    <button
                      key={`${item.url}-${idx}`}
                      type="button"
                      onClick={() => setPreview({ work: preview.work, index: idx })}
                      className={`relative aspect-square overflow-hidden rounded-xl border bg-gray-100 dark:bg-white/5 ${idx === preview.index ? "border-primary ring-2 ring-primary/20" : "border-gray-200/80 dark:border-white/10"}`}
                    >
                      <MediaThumb item={item} />
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        {idx + 1}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <a href={currentMedia.url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5">
                    <ExternalLink size={16} />
                    查看原图
                  </a>
                  <a href={currentMedia.url} download className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gray-950 text-sm font-medium text-white hover:bg-gray-800">
                    <Download size={16} />
                    下载作品
                  </a>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
      {publishDraft && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4" onClick={() => setPublishDraft(null)}>
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-gray-950 dark:text-gray-100">发布到灵感广场</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">可设置免费或付费同款，付费按算力点扣使用者。</div>
              </div>
              <button type="button" onClick={() => setPublishDraft(null)} className="rounded-xl border p-2 text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                <X size={16} />
              </button>
            </div>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">标题</span>
              <input
                value={publishDraft.title}
                onChange={(e) => setPublishDraft({ ...publishDraft, title: e.target.value })}
                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-gray-950 dark:text-gray-100"
                placeholder="作品标题"
              />
            </label>
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1 dark:bg-white/10">
              <button type="button" onClick={() => setPublishDraft({ ...publishDraft, is_paid: false })} className={`h-10 rounded-xl text-sm font-medium ${!publishDraft.is_paid ? "bg-white text-gray-950 shadow-sm dark:bg-gray-950 dark:text-white" : "text-gray-500 dark:text-gray-300"}`}>免费</button>
              <button type="button" onClick={() => setPublishDraft({ ...publishDraft, is_paid: true })} className={`h-10 rounded-xl text-sm font-medium ${publishDraft.is_paid ? "bg-white text-gray-950 shadow-sm dark:bg-gray-950 dark:text-white" : "text-gray-500 dark:text-gray-300"}`}>付费</button>
            </div>
            {publishDraft.is_paid && (
              <label className="mb-4 block">
                <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">同款使用价格（算力点）</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={publishDraft.price}
                  onChange={(e) => setPublishDraft({ ...publishDraft, price: e.target.value })}
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-gray-950 dark:text-gray-100"
                  placeholder="例如 1.5"
                />
              </label>
            )}
            <button type="button" disabled={publishing} onClick={submitPublish} className="h-11 w-full rounded-xl bg-primary font-semibold text-dark disabled:opacity-60">
              {publishing ? "提交中..." : "提交发布"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
