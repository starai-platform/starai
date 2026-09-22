"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Copy, ExternalLink, Play, RotateCcw, Search, Sparkles, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import {
  filterReferenceCases,
  GALLERY_LANGUAGES,
  galleryLanguageLabel,
  loadReferenceGalleryManifest,
  REFERENCE_REPOSITORY_URL,
  referenceTagEntries,
  referenceTaxonomyLabel,
  referenceImageURL,
  detectGalleryLanguage,
  type GalleryLanguage,
  type ReferenceGalleryItem,
  type ReferenceGalleryManifest,
} from "./galleryReference";

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
  is_paid?: boolean;
  price?: number;
  like_count: number;
}

interface GalleryTag {
  name: string;
  slug: string;
}

interface ImageModelOption {
  code: string;
  category?: string;
  is_enabled?: boolean;
}

type GalleryDetail =
  | { kind: "reference"; item: ReferenceGalleryItem }
  | { kind: "community"; item: GalleryItem };

const REFERENCE_BATCH_SIZE = 24;

export function GalleryPanel({
  activeTag,
  activeReferenceCategory = "all",
  activeReferenceStyle = "all",
  activeReferenceScene = "all",
  activeReferenceLanguage = "all",
  activeCommunityLanguage = "all",
  galleryMode,
  onGalleryModeChange,
  onCommunityTagChange,
  onCommunityLanguageChange,
  onCommunityLanguagesChange,
  onReferenceCategoryChange,
  onReferenceStyleChange,
  onReferenceSceneChange,
  onReferenceLanguageChange,
  onReferenceTaxonomyChange,
  onUseTemplate,
}: {
  activeTag: string;
  activeReferenceCategory?: string;
  activeReferenceStyle?: string;
  activeReferenceScene?: string;
  activeReferenceLanguage?: GalleryLanguage | "all";
  activeCommunityLanguage?: GalleryLanguage | "all";
  galleryMode?: "reference" | "community";
  onGalleryModeChange?: (mode: "reference" | "community") => void;
  onCommunityTagChange?: (tag: string) => void;
  onCommunityLanguageChange?: (language: GalleryLanguage | "all") => void;
  onCommunityLanguagesChange?: (languages: GalleryLanguage[]) => void;
  onReferenceCategoryChange?: (category: string) => void;
  onReferenceStyleChange?: (style: string) => void;
  onReferenceSceneChange?: (scene: string) => void;
  onReferenceLanguageChange?: (language: GalleryLanguage | "all") => void;
  onReferenceTaxonomyChange?: (taxonomy: { categories: string[]; styles: string[]; scenes: string[]; languages: GalleryLanguage[] }) => void;
  onUseTemplate: (modelCode: string | undefined, prompt: string) => void;
}) {
  const { locale, t, td } = useI18n();
  const [internalMode, setInternalMode] = useState<"reference" | "community">("reference");
  const mode = galleryMode ?? internalMode;
  const [communityTag, setCommunityTag] = useState(activeTag || "all");
  const [communityItems, setCommunityItems] = useState<GalleryItem[]>([]);
  const [communityTags, setCommunityTags] = useState<GalleryTag[]>([]);
  const [communityTotal, setCommunityTotal] = useState(0);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [communityError, setCommunityError] = useState("");
  const [communityReload, setCommunityReload] = useState(0);
  const [communityQuery, setCommunityQuery] = useState("");
  const [communityLanguage, setCommunityLanguage] = useState<GalleryLanguage | "all">("all");
  const [manifest, setManifest] = useState<ReferenceGalleryManifest | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState("");
  const [referenceReload, setReferenceReload] = useState(0);
  const [referenceVisibleCount, setReferenceVisibleCount] = useState(REFERENCE_BATCH_SIZE);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [style, setStyle] = useState("all");
  const [scene, setScene] = useState("all");
  const [referenceLanguage, setReferenceLanguage] = useState<GalleryLanguage | "all">("all");
  const [detail, setDetail] = useState<GalleryDetail | null>(null);
  const [cloning, setCloning] = useState(false);
  const [copied, setCopied] = useState("");
  const [referenceModelCode, setReferenceModelCode] = useState<string>();

  useEffect(() => {
    setCommunityTag(activeTag || "all");
    if (!galleryMode && activeTag && activeTag !== "all") setInternalMode("community");
  }, [activeTag, galleryMode]);

  useEffect(() => {
    setCategory(activeReferenceCategory || "all");
  }, [activeReferenceCategory]);

  useEffect(() => setStyle(activeReferenceStyle || "all"), [activeReferenceStyle]);
  useEffect(() => setScene(activeReferenceScene || "all"), [activeReferenceScene]);
  useEffect(() => setReferenceLanguage(activeReferenceLanguage), [activeReferenceLanguage]);
  useEffect(() => setCommunityLanguage(activeCommunityLanguage), [activeCommunityLanguage]);

  useEffect(() => {
    if (mode !== "community") return;
    let active = true;
    api<{ items: GalleryTag[] }>("/api/gallery/tags")
      .then((result) => { if (active) setCommunityTags(result.items || []); })
      .catch(() => { if (active) setCommunityTags([]); });
    return () => { active = false; };
  }, [mode]);

  useEffect(() => {
    if (mode !== "reference") return;
    let active = true;
    api<ImageModelOption[]>("/api/models?category=image")
      .then((models) => {
        if (!active) return;
        const available = (models || []).filter((model) => model.is_enabled !== false && model.category !== "multi_collab");
        setReferenceModelCode((available.find((model) => model.code === "gpt-image-2") || available[0])?.code);
      })
      .catch(() => { if (active) setReferenceModelCode(undefined); });
    return () => { active = false; };
  }, [mode]);

  useEffect(() => {
    if (mode !== "community") return;
    let active = true;
    setCommunityLoading(true);
    setCommunityError("");
    const query = communityTag && communityTag !== "all" ? `&tag=${encodeURIComponent(communityTag)}` : "";
    api<{ items: GalleryItem[]; total?: number }>(`/api/gallery?page_size=60${query}`)
      .then((result) => {
        if (!active) return;
        setCommunityItems(result.items || []);
        setCommunityTotal(result.total ?? result.items?.length ?? 0);
      })
      .catch(() => { if (active) setCommunityError(t("gallery.loadFailed")); })
      .finally(() => { if (active) setCommunityLoading(false); });
    return () => { active = false; };
  }, [communityReload, communityTag, mode, t]);

  useEffect(() => {
    let active = true;
    setReferenceLoading(true);
    setReferenceError("");
    loadReferenceGalleryManifest({ force: referenceReload > 0 })
      .then((data) => {
        if (active) setManifest(data);
      })
      .catch(() => {
        if (active) setReferenceError(t("gallery.referenceLoadFailed"));
      })
      .finally(() => {
        if (active) setReferenceLoading(false);
      });
    return () => { active = false; };
  }, [referenceReload, t]);

  useEffect(() => {
    setReferenceVisibleCount(REFERENCE_BATCH_SIZE);
  }, [referenceQuery, category, style, scene, referenceLanguage]);

  useEffect(() => {
    if (!manifest) return;
    onReferenceTaxonomyChange?.({
      categories: manifest.categories,
      styles: manifest.styles,
      scenes: manifest.scenes,
      languages: GALLERY_LANGUAGES.filter((language) => manifest.cases.some((item) => detectGalleryLanguage(item.prompt) === language)),
    });
  }, [manifest, onReferenceTaxonomyChange]);

  useEffect(() => {
    if (!detail) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [detail]);

  const referenceItems = useMemo(
    () => filterReferenceCases(manifest?.cases || [], { query: referenceQuery, category, style, scene, language: referenceLanguage }),
    [manifest, referenceQuery, category, style, scene, referenceLanguage],
  );
  const communityVisible = useMemo(() => {
    const query = communityQuery.trim().toLocaleLowerCase();
    return communityItems.filter((item) => {
      if (communityLanguage !== "all" && detectGalleryLanguage(item.prompt || item.title || "") !== communityLanguage) return false;
      if (!query) return true;
      return [item.title, item.prompt, ...(item.tags || [])]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(query));
    });
  }, [communityItems, communityLanguage, communityQuery]);

  const communityNavTags = useMemo(() => {
    const seen = new Set(["all"]);
    return [
      { name: t("gallery.all"), slug: "all" },
      ...communityTags.filter((tag) => {
        const slug = tag.slug.trim();
        if (!slug || seen.has(slug)) return false;
        seen.add(slug);
        return true;
      }),
    ];
  }, [communityTags, t]);
  const referenceLanguages = useMemo(
    () => GALLERY_LANGUAGES.filter((language) => manifest?.cases.some((item) => detectGalleryLanguage(item.prompt) === language)),
    [manifest],
  );
  const communityLanguages = useMemo(
    () => GALLERY_LANGUAGES.filter((language) => communityItems.some((item) => detectGalleryLanguage(item.prompt || item.title || "") === language)),
    [communityItems],
  );

  useEffect(() => onCommunityLanguagesChange?.(communityLanguages), [communityLanguages, onCommunityLanguagesChange]);

  const tagLabel = (name: string, slug = name) => td(`gallery.tag.${slug}`, name);
  const taxonomyLabel = (value: string) => referenceTaxonomyLabel(value, locale);
  const selectMode = (next: "reference" | "community") => {
    setInternalMode(next);
    onGalleryModeChange?.(next);
  };
  const selectCommunityTag = (next: string) => {
    setCommunityTag(next);
    setCommunityLanguage("all");
    onCommunityTagChange?.(next);
    onCommunityLanguageChange?.("all");
  };
  const selectReferenceCategory = (next: string) => {
    setCategory(next);
    onReferenceCategoryChange?.(next);
  };
  const selectReferenceStyle = (next: string) => {
    setStyle(next);
    onReferenceStyleChange?.(next);
  };
  const selectReferenceScene = (next: string) => {
    setScene(next);
    onReferenceSceneChange?.(next);
  };
  const selectReferenceLanguage = (next: string) => {
    const language = next as GalleryLanguage | "all";
    setReferenceLanguage(language);
    onReferenceLanguageChange?.(language);
  };
  const selectCommunityLanguage = (next: string) => {
    const language = next as GalleryLanguage | "all";
    setCommunityLanguage(language);
    onCommunityLanguageChange?.(language);
  };

  const handleUseCommunity = async (item: GalleryItem) => {
    setCloning(true);
    try {
      const result = await api<{ model_code?: string; prompt?: string }>(`/api/gallery/${item.public_id}/clone`, { method: "POST" });
      setDetail(null);
      onUseTemplate(result.model_code, result.prompt || "");
    } finally {
      setCloning(false);
    }
  };

  const copyPrompt = async (key: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1600);
    } catch {
      setCopied("");
    }
  };

  return (
    <div className="gallery-experience flex-1 overflow-y-auto bg-[#f5f7fa] px-4 py-6 dark:bg-gray-950 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto w-full max-w-[1480px]">
        <header className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-950 dark:text-gray-50 sm:text-4xl">{t("gallery.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">{t("gallery.newDesc")}</p>
          </div>
          <div className="inline-flex w-full rounded-2xl border border-gray-200 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-gray-900 sm:w-auto">
            <ModeButton active={mode === "reference"} onClick={() => selectMode("reference")} icon={<Sparkles size={16} />} label={t("gallery.referenceCases")} />
            <ModeButton active={mode === "community"} onClick={() => selectMode("community")} icon={<Users size={16} />} label={t("gallery.communityWorks")} />
          </div>
        </header>

        {mode === "reference" ? (
          <>
            <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-gray-900 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950 dark:text-white">{t("gallery.referenceHeading")}</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("gallery.referenceCredit")}</p>
                </div>
                <label className="relative block w-full lg:max-w-md">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
                  <input
                    value={referenceQuery}
                    onChange={(event) => setReferenceQuery(event.target.value)}
                    placeholder={t("gallery.referenceSearch")}
                    className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-gray-500"
                  />
                </label>
              </div>
              <div className="mt-5 space-y-4 border-t border-gray-100 pt-4 dark:border-white/10">
                <FilterRow label={t("gallery.category")} values={manifest?.categories || []} value={category} onChange={selectReferenceCategory} allLabel={t("gallery.all")} getLabel={taxonomyLabel} />
                <FilterRow label={t("gallery.style")} values={manifest?.styles || []} value={style} onChange={selectReferenceStyle} allLabel={t("gallery.all")} getLabel={taxonomyLabel} />
                <FilterRow label={t("gallery.scene")} values={manifest?.scenes || []} value={scene} onChange={selectReferenceScene} allLabel={t("gallery.all")} getLabel={taxonomyLabel} />
                <FilterRow label={t("gallery.language")} values={referenceLanguages} value={referenceLanguage} onChange={selectReferenceLanguage} allLabel={t("gallery.all")} getLabel={(value) => galleryLanguageLabel(value as GalleryLanguage, locale)} />
              </div>
            </section>

            <div className="mb-4 flex items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-400">
              <span>{t("gallery.resultCount", { count: referenceItems.length })}</span>
              {(category !== "all" || style !== "all" || scene !== "all" || referenceLanguage !== "all" || referenceQuery) && (
                <button type="button" onClick={() => { setReferenceQuery(""); selectReferenceCategory("all"); selectReferenceStyle("all"); selectReferenceScene("all"); selectReferenceLanguage("all"); }} className="inline-flex items-center gap-1.5 font-medium text-gray-600 hover:text-emerald-700 dark:text-gray-300 dark:hover:text-emerald-300">
                  <RotateCcw size={14} />{t("gallery.resetFilters")}
                </button>
              )}
            </div>

            {referenceLoading ? <GallerySkeleton /> : referenceError ? (
              <GalleryError message={referenceError} retry={() => setReferenceReload((value) => value + 1)} retryLabel={t("common.retry")} />
            ) : referenceItems.length === 0 ? (
              <GalleryEmpty title={t("gallery.noMatches")} description={t("gallery.noMatchesDesc")} />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {referenceItems.slice(0, referenceVisibleCount).map((item) => (
                    <ReferenceCard key={item.id} item={item} onOpen={() => setDetail({ kind: "reference", item })} onCopy={() => copyPrompt(`reference-${item.id}`, item.prompt)} copied={copied === `reference-${item.id}`} taxonomyLabel={taxonomyLabel} t={t} />
                  ))}
                </div>
                {referenceItems.length > referenceVisibleCount && (
                  <div className="mt-7 text-center">
                    <button type="button" onClick={() => setReferenceVisibleCount((count) => count + REFERENCE_BATCH_SIZE)} className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-emerald-400 hover:text-emerald-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:border-emerald-300/50 dark:hover:text-emerald-200">
                      {t("common.more")}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_12px_40px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-gray-900 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-950 dark:text-white">{t("gallery.communityHeading")}</h2>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("gallery.communityDesc")}</p>
                </div>
                <label className="relative block w-full lg:max-w-md">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
                  <input value={communityQuery} onChange={(event) => setCommunityQuery(event.target.value)} placeholder={t("gallery.searchPlaceholder")} className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-gray-500" />
                </label>
              </div>
              <div className="mt-5 space-y-4 border-t border-gray-100 pt-4 dark:border-white/10">
                <div className="grid gap-2 sm:grid-cols-[76px_minmax(0,1fr)] sm:items-start">
                  <div className="pt-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">{t("gallery.category")}</div>
                  <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
                    {communityNavTags.map((tag) => (
                      <button key={tag.slug} type="button" onClick={() => selectCommunityTag(tag.slug)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition active:scale-[0.98] ${communityTag === tag.slug ? "border border-emerald-500/50 bg-emerald-50 text-emerald-800 dark:border-emerald-300/50 dark:bg-emerald-300/10 dark:text-emerald-200" : "border border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"}`}>
                        {tag.slug === "all" ? tag.name : tagLabel(tag.name, tag.slug)}
                      </button>
                    ))}
                  </div>
                </div>
                <FilterRow label={t("gallery.language")} values={communityLanguages} value={communityLanguage} onChange={selectCommunityLanguage} allLabel={t("gallery.all")} getLabel={(value) => galleryLanguageLabel(value as GalleryLanguage, locale)} />
              </div>
            </section>

            <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t("gallery.resultCount", { count: communityQuery || communityLanguage !== "all" ? communityVisible.length : communityTotal })}</div>
            {communityLoading ? <GallerySkeleton /> : communityError ? (
              <GalleryError message={communityError} retry={() => setCommunityReload((value) => value + 1)} retryLabel={t("common.retry")} />
            ) : communityVisible.length === 0 ? (
              <GalleryEmpty title={t("gallery.empty")} description={t("gallery.communityEmptyDesc")} />
            ) : (
              <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
                {communityVisible.map((item) => <CommunityCard key={item.public_id} item={item} onOpen={() => setDetail({ kind: "community", item })} featuredLabel={t("gallery.featured")} paidLabel={t("common.compute")} videoLabel={t("asset.video")} />)}
              </div>
            )}
          </>
        )}
      </div>

      {detail && (
        <GalleryDetailModal
          detail={detail}
          cloning={cloning}
          copied={copied === `${detail.kind}-${detail.kind === "reference" ? detail.item.id : detail.item.public_id}`}
          onClose={() => setDetail(null)}
          onCopy={() => copyPrompt(`${detail.kind}-${detail.kind === "reference" ? detail.item.id : detail.item.public_id}`, detail.item.prompt || "")}
          onUse={() => detail.kind === "reference" ? (setDetail(null), onUseTemplate(referenceModelCode, detail.item.prompt)) : handleUseCommunity(detail.item)}
          tagLabel={tagLabel}
          taxonomyLabel={taxonomyLabel}
          t={t}
        />
      )}
    </div>
  );
}

function ModeButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button type="button" onClick={onClick} className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] sm:flex-none ${active ? "bg-gray-950 text-white shadow-sm dark:bg-emerald-300 dark:text-gray-950" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"}`}>{icon}{label}</button>;
}

function FilterRow({ label, values, value, onChange, allLabel, getLabel = (item) => item }: { label: string; values: readonly string[]; value: string; onChange: (value: string) => void; allLabel: string; getLabel?: (value: string) => string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[76px_minmax(0,1fr)] sm:items-start">
      <div className="pt-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</div>
      <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
        {["all", ...values].map((item) => (
          <button key={item} type="button" onClick={() => onChange(item)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition active:scale-[0.98] ${value === item ? "border border-emerald-500/50 bg-emerald-50 text-emerald-800 dark:border-emerald-300/50 dark:bg-emerald-300/10 dark:text-emerald-200" : "border border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"}`}>
            {item === "all" ? allLabel : getLabel(item)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReferenceCard({ item, onOpen, onCopy, copied, taxonomyLabel, t }: { item: ReferenceGalleryItem; onOpen: () => void; onCopy: () => void; copied: boolean; taxonomyLabel: (value: string) => string; t: (key: string, vars?: Record<string, string | number>) => string }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.045)] transition duration-300 hover:-translate-y-1 hover:border-emerald-400/60 hover:shadow-[0_18px_44px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-gray-900 dark:hover:border-emerald-300/40">
      <button type="button" onClick={onOpen} className="relative block aspect-[4/5] w-full overflow-hidden bg-gray-100 text-left dark:bg-white/5">
        <Image src={referenceImageURL(item.image)} alt={item.imageAlt || item.title} fill sizes="(min-width: 1536px) 25vw, (min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-contain transition duration-500 group-hover:scale-[1.025]" />
        <span className="absolute left-3 top-3 rounded-lg bg-gray-950/80 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">Case {item.id}</span>
        <span className="absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-gray-950/70 px-3 py-2 text-xs font-semibold text-white opacity-0 backdrop-blur-md transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"><Search size={14} />{t("gallery.viewDetails")}</span>
      </button>
      <div className="p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
          <span className="truncate">{taxonomyLabel(item.category)}</span>
          {item.sourceLabel && <span className="ml-auto shrink-0 truncate text-gray-400">{item.sourceLabel}</span>}
        </div>
        <button type="button" onClick={onOpen} className="mt-2 block w-full text-left">
          <h3 className="line-clamp-1 text-base font-semibold text-gray-950 dark:text-white">{item.title}</h3>
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-500 dark:text-gray-400">{item.promptPreview || item.prompt}</p>
        </button>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {referenceTagEntries(item).slice(0, 4).map((entry) => <span key={entry.key} className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-500 dark:bg-white/5 dark:text-gray-300">{taxonomyLabel(entry.label)}</span>)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCopy} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98] dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/10">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t("gallery.copied") : t("gallery.copyPrompt")}</button>
          <button type="button" onClick={onOpen} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98] dark:bg-emerald-300 dark:text-gray-950 dark:hover:bg-emerald-200"><Sparkles size={14} />{t("gallery.usePrompt")}</button>
        </div>
      </div>
    </article>
  );
}

function CommunityCard({ item, onOpen, featuredLabel, paidLabel, videoLabel }: { item: GalleryItem; onOpen: () => void; featuredLabel: string; paidLabel: string; videoLabel: string }) {
  return (
    <button type="button" onClick={onOpen} className="group mb-4 block w-full break-inside-avoid overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition hover:-translate-y-1 hover:border-emerald-400/50 hover:shadow-[0_16px_38px_rgba(15,23,42,0.09)] dark:border-white/10 dark:bg-gray-900">
      <GalleryPreview item={item} videoLabel={videoLabel} />
      <div className="p-3.5">
        <div className="flex items-center gap-1.5">
          {item.is_featured && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">{featuredLabel}</span>}
          {item.is_paid && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-300/10 dark:text-emerald-200">{item.price || 0} {paidLabel}</span>}
          <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{item.title || "Untitled"}</span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-gray-400">{item.prompt}</p>
      </div>
    </button>
  );
}

function GalleryDetailModal({ detail, cloning, copied, onClose, onCopy, onUse, tagLabel, taxonomyLabel, t }: { detail: GalleryDetail; cloning: boolean; copied: boolean; onClose: () => void; onCopy: () => void; onUse: () => void; tagLabel: (name: string) => string; taxonomyLabel: (value: string) => string; t: (key: string, vars?: Record<string, string | number>) => string }) {
  const referenceItem = detail.kind === "reference" ? detail.item : null;
  const communityItem = detail.kind === "community" ? detail.item : null;
  const title = referenceItem?.title || communityItem?.title || "Untitled";
  const prompt = referenceItem?.prompt || communityItem?.prompt || "";
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-950/70 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="relative max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/10 bg-white shadow-2xl dark:bg-[#0d1420]">
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-gray-950/70 text-white backdrop-blur-md transition hover:bg-gray-950 active:scale-[0.98]"><X size={18} /></button>
        <div className="grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="bg-gray-100 dark:bg-gray-950">
            {referenceItem ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={referenceImageURL(referenceItem.image)} alt={referenceItem.imageAlt || title} className="h-full max-h-[86dvh] w-full object-contain" />
            ) : communityItem ? <GalleryPreview item={communityItem} detail videoLabel={t("asset.video")} /> : null}
          </div>
          <div className="flex min-h-0 flex-col p-5 sm:p-7">
            <div className="pr-10">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {referenceItem ? <><span>Case {referenceItem.id}</span><span>{taxonomyLabel(referenceItem.category)}</span></> : communityItem?.is_featured ? <span>{t("gallery.featured")}</span> : null}
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-950 dark:text-white">{title}</h2>
              {referenceItem?.sourceLabel && <a href={referenceItem.sourceUrl || referenceItem.githubUrl || REFERENCE_REPOSITORY_URL} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-emerald-700 dark:text-gray-400 dark:hover:text-emerald-300">{t("gallery.source")}: {referenceItem.sourceLabel}<ExternalLink size={12} /></a>}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {referenceItem
                ? referenceTagEntries(referenceItem).map((entry) => <span key={entry.key} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-300">{taxonomyLabel(entry.label)}</span>)
                : (communityItem?.tags || []).map((tag, index) => <span key={`${index}-${tag}`} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-300">#{tagLabel(tag)}</span>)}
            </div>
            <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">{t("gallery.fullPrompt")}</div>
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap pr-2 text-sm leading-6 text-gray-700 dark:text-gray-200">{prompt}</p>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={onCopy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98] dark:border-white/10 dark:text-gray-100 dark:hover:bg-white/10">{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? t("gallery.copied") : t("gallery.copyPrompt")}</button>
              <button type="button" onClick={onUse} disabled={cloning} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 dark:bg-emerald-300 dark:text-gray-950 dark:hover:bg-emerald-200"><Sparkles size={17} />{cloning ? t("common.loading") : referenceItem ? t("gallery.usePrompt") : t("landing.tryNow")}</button>
            </div>
            {referenceItem?.githubUrl && <a href={referenceItem.githubUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10">{t("gallery.openSource")}<ExternalLink size={15} /></a>}
            {communityItem?.is_paid && <p className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">{t("gallery.paidHint", { price: communityItem.price || 0 })}</p>}
          </div>
        </div>
      </div>
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
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white backdrop-blur"><Play size={18} fill="currentColor" /></span></div>
        <span className="absolute left-2 top-2 rounded-lg bg-black/60 px-2 py-1 text-[11px] text-white">{videoLabel}</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mediaURL} alt={item.title || ""} loading="lazy" decoding="async" className={`w-full object-cover ${detail ? "max-h-[86dvh]" : "transition duration-500 group-hover:scale-[1.025]"}`} />;
}

function GallerySkeleton() {
  return <div aria-label="loading" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900"><div className="aspect-[4/5] animate-pulse bg-gray-200 dark:bg-white/10" /><div className="space-y-3 p-4"><div className="h-3 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-white/10" /><div className="h-5 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-white/10" /><div className="h-12 animate-pulse rounded bg-gray-100 dark:bg-white/5" /></div></div>)}</div>;
}

function GalleryError({ message, retry, retryLabel }: { message: string; retry: () => void; retryLabel: string }) {
  return <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50/70 px-6 text-center dark:border-red-500/20 dark:bg-red-500/5"><AlertCircle className="text-red-500" size={28} /><p className="mt-3 text-sm text-red-700 dark:text-red-300">{message}</p><button type="button" onClick={retry} className="mt-4 rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white active:scale-[0.98] dark:bg-white dark:text-gray-950">{retryLabel}</button></div>;
}

function GalleryEmpty({ title, description }: { title: string; description: string }) {
  return <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 text-center dark:border-white/15 dark:bg-white/5"><Search className="text-gray-300 dark:text-gray-600" size={30} /><h3 className="mt-4 font-semibold text-gray-800 dark:text-gray-100">{title}</h3><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p></div>;
}

function withVideoPreviewTime(url: string) {
  if (!url || url.includes("#t=")) return url;
  return `${url.split("#")[0]}#t=0.1`;
}
