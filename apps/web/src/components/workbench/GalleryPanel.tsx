"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

interface GalleryItem {
  public_id: string;
  model_code?: string;
  title?: string;
  prompt?: string;
  cover_url?: string;
  media_url?: string;
  thumbnail_url?: string;
  type?: string;
  tags: string[];
  is_featured: boolean;
  like_count: number;
}

export function GalleryPanel({
  activeTag,
  onUseTemplate,
}: {
  activeTag: string;
  onUseTemplate: (modelCode: string | undefined, prompt: string) => void;
}) {
  const { t, td } = useI18n();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [detail, setDetail] = useState<GalleryItem | null>(null);
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    const q = activeTag && activeTag !== "all" ? `?tag=${activeTag}` : "";
    api<{ items: GalleryItem[] }>(`/api/gallery${q}`).then((r) => setItems(r.items || []));
  }, [activeTag]);

  const tagLabel = (name: string) => td(`gallery.tag.${name}`, name);

  const handleUseSame = async (item: GalleryItem) => {
    setCloning(true);
    try {
      const r = await api<{ model_code?: string; prompt?: string }>(`/api/gallery/${item.public_id}/clone`, {
        method: "POST",
      });
      onUseTemplate(r.model_code, r.prompt || "");
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto page-padding py-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-1 text-2xl font-bold">{t("gallery.title")}</h1>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">{t("gallery.desc")}</p>

        {items.length === 0 ? (
          <div className="py-16 text-center text-gray-400">{t("gallery.empty")}</div>
        ) : (
          <div className="columns-1 gap-4 [column-fill:_balance] sm:columns-2 md:columns-3 lg:columns-4">
            {items.map((item) => (
              <button
                key={item.public_id}
                onClick={() => setDetail(item)}
                className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-2xl border border-gray-100 bg-white text-left transition hover:shadow-lg group dark:border-white/10 dark:bg-white/5"
              >
                <GalleryPreview item={item} videoLabel={t("asset.video")} />
                <div className="p-3">
                  <div className="flex items-center gap-1.5">
                    {item.is_featured && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:bg-amber-500/10 dark:text-amber-200">
                        {t("gallery.featured")}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{item.title || "Untitled"}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-gray-400">{item.prompt}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl dark:border dark:border-white/10 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid gap-6 p-6 md:grid-cols-2">
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 dark:border-white/10 dark:bg-white/5">
                <GalleryPreview item={detail} detail videoLabel={t("asset.video")} />
              </div>
              <div className="flex flex-col">
                <div className="flex items-start justify-between">
                  <h2 className="mb-2 text-xl font-bold text-gray-950 dark:text-white">{detail.title || "Untitled"}</h2>
                  <button onClick={() => setDetail(null)} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                    {t("common.close")}
                  </button>
                </div>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {detail.tags?.map((name) => (
                    <span key={name} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-white/10 dark:text-gray-300">
                      #{tagLabel(name)}
                    </span>
                  ))}
                </div>
                <div className="soft-card mb-4 p-4">
                  <div className="mb-1 text-xs text-gray-400">Prompt</div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200">{detail.prompt}</p>
                </div>
                <button
                  onClick={() => handleUseSame(detail)}
                  disabled={cloning}
                  className="mt-auto w-full rounded-xl bg-primary py-3 font-semibold text-dark disabled:opacity-50"
                >
                  {cloning ? t("common.loading") : t("landing.tryNow")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GalleryPreview({ item, detail = false, videoLabel }: { item: GalleryItem; detail?: boolean; videoLabel: string }) {
  const mediaURL = item.media_url || item.cover_url || "";
  const poster = item.thumbnail_url || item.cover_url || "";
  const isVideo = item.type === "video" || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(mediaURL);
  const previewURL = isVideo && !detail ? withVideoPreviewTime(mediaURL) : mediaURL;
  if (!mediaURL) return <div className="aspect-[4/3] bg-gray-100 dark:bg-white/5" />;
  if (isVideo) {
    return detail ? (
      <video src={mediaURL} poster={poster && poster !== mediaURL ? poster : undefined} controls playsInline className="w-full bg-gray-950" />
    ) : (
      <div className="relative aspect-video bg-gray-950">
        <video src={previewURL} poster={poster && poster !== mediaURL ? poster : undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(18,214,163,.2),transparent_36%),linear-gradient(180deg,rgba(0,0,0,.06),rgba(0,0,0,.28))]" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white shadow-lg backdrop-blur">
            <span className="ml-0.5 text-lg">▶</span>
          </div>
        </div>
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[11px] text-white">{videoLabel}</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mediaURL} alt={item.title || ""} className={`w-full object-cover ${detail ? "" : "transition group-hover:scale-[1.02]"}`} />;
}

function withVideoPreviewTime(url: string) {
  if (!url || url.includes("#t=")) return url;
  return `${url.split("#")[0]}#t=0.1`;
}
