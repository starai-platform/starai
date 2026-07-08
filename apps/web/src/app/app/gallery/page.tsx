"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

interface GalleryItem {
  public_id: string;
  title?: string;
  prompt?: string;
  cover_url?: string;
  media_url?: string;
  thumbnail_url?: string;
  type?: string;
  tags: string[];
  is_featured: boolean;
  is_paid: boolean;
  price: number;
  like_count: number;
}

interface GalleryTag {
  name: string;
  slug: string;
}

export default function GalleryPage() {
  const { t, td } = useI18n();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [tags, setTags] = useState<GalleryTag[]>([]);
  const [activeTag, setActiveTag] = useState("all");

  useEffect(() => {
    api<{ items: GalleryTag[] }>("/api/gallery/tags").then((r) => setTags(r.items || []));
  }, []);

  useEffect(() => {
    const q = activeTag && activeTag !== "all" ? `?tag=${activeTag}` : "";
    api<{ items: GalleryItem[] }>(`/api/gallery${q}`).then((r) => setItems(r.items || []));
  }, [activeTag]);

  const navTags = useMemo(() => {
    const seen = new Set<string>(["all"]);
    return [
      { name: t("gallery.all"), slug: "all" },
      ...tags.filter((tag) => {
        const slug = (tag.slug || "").trim();
        if (!slug || seen.has(slug)) return false;
        seen.add(slug);
        return true;
      }),
    ];
  }, [tags, t]);
  const tagLabel = (tag: GalleryTag) => (tag.slug === "all" ? tag.name : td(`gallery.tag.${tag.slug}`, tag.name));

  return (
    <div className="page-container flex-1 overflow-y-auto page-padding py-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-1 text-2xl font-bold">{t("gallery.title")}</h1>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">{t("gallery.desc")}</p>

        <div className="mb-6 flex flex-wrap gap-2">
          {navTags.map((tag) => (
            <button
              key={tag.slug}
              onClick={() => setActiveTag(tag.slug)}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                activeTag === tag.slug
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-950"
                  : "border border-gray-100 bg-white text-gray-500 hover:border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
              }`}
            >
              {tagLabel(tag)}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <div className="py-16 text-center text-gray-400">{t("gallery.empty")}</div>
        ) : (
          <div className="columns-1 gap-4 [column-fill:_balance] sm:columns-2 md:columns-3 lg:columns-4">
            {items.map((item) => (
              <Link
                key={item.public_id}
                href={`/app/gallery/${item.public_id}`}
                className="mb-4 block break-inside-avoid overflow-hidden rounded-2xl border border-gray-100 bg-white transition hover:shadow-lg group dark:border-white/10 dark:bg-white/5"
              >
                <GalleryCover item={item} videoLabel={t("asset.video")} />
                <div className="p-3">
                  <div className="flex items-center gap-1.5">
                    {item.is_featured && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:bg-amber-500/10 dark:text-amber-200">
                        {t("gallery.featured")}
                      </span>
                    )}
                    {item.is_paid && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-gray-900 dark:text-primary">
                        {item.price || 0} {t("common.compute")}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{item.title || "Untitled"}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-gray-400">{item.prompt}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryCover({ item, videoLabel }: { item: GalleryItem; videoLabel: string }) {
  const mediaURL = item.media_url || item.cover_url || "";
  const poster = item.thumbnail_url || item.cover_url || "";
  const isVideo = item.type === "video" || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(mediaURL);
  const previewURL = isVideo ? withVideoPreviewTime(mediaURL) : mediaURL;
  if (!mediaURL) return <div className="aspect-[4/3] bg-gray-100 dark:bg-white/5" />;
  if (isVideo) {
    return (
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
  return <img src={mediaURL} alt={item.title || ""} className="w-full object-cover transition group-hover:scale-[1.02]" />;
}

function withVideoPreviewTime(url: string) {
  if (!url || url.includes("#t=")) return url;
  return `${url.split("#")[0]}#t=0.1`;
}
