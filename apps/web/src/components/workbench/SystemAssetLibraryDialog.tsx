"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, FileText, Film, FolderOpen, Image as ImageIcon, Loader2, Map, Music2, Search, Sparkles, UserRound, Users, X } from "lucide-react";
import { api, listAssets } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { AssetPagination } from "./AssetPagination";
import { filterReferenceCases, loadReferenceGalleryManifest, referenceImageURL, type ReferenceGalleryItem } from "./galleryReference";

export type SystemAssetKind = "all" | "image" | "video" | "audio" | "doc";
export type SystemAssetPick = {
  public_id?: string;
  url: string;
  name: string;
  kind?: string;
  asset_type?: string;
  size_bytes?: number;
  metadata?: Record<string, unknown>;
};

type CommunityAsset = {
  public_id: string;
  title?: string;
  cover_url?: string;
  type?: string;
  is_featured?: boolean;
  like_count?: number;
};

const PAGE_SIZE = 18;

type AssetCategory = "all" | "role" | "prop" | "scene" | "image" | "video" | "audio" | "doc";

const ASSET_CATEGORIES: Array<{
  id: AssetCategory;
  kind?: Exclude<SystemAssetKind, "all">;
  type?: "role" | "prop" | "scene";
  icon: typeof ImageIcon;
}> = [
  { id: "all", icon: FolderOpen },
  { id: "role", kind: "image", type: "role", icon: UserRound },
  { id: "prop", kind: "image", type: "prop", icon: Box },
  { id: "scene", kind: "image", type: "scene", icon: Map },
  { id: "image", kind: "image", icon: ImageIcon },
  { id: "video", kind: "video", icon: Film },
  { id: "audio", kind: "audio", icon: Music2 },
  { id: "doc", kind: "doc", icon: FileText },
];

function keyOf(item: SystemAssetPick) {
  return item.public_id || item.url;
}

function AssetPreview({ item, selected, disabled, onClick }: { item: SystemAssetPick; selected: boolean; disabled: boolean; onClick: () => void }) {
  const kind = String(item.kind || "image").toLowerCase();
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`group overflow-hidden rounded-xl border bg-white text-left transition dark:bg-white/5 ${selected ? "border-primary ring-2 ring-primary/30" : "border-gray-100 hover:border-primary/50 dark:border-white/10"} disabled:cursor-not-allowed disabled:opacity-45`}>
      <div className="relative aspect-square overflow-hidden bg-gray-100 dark:bg-gray-950/40">
        {kind === "image" && item.url ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img loading="lazy" decoding="async" src={item.url} alt={item.name} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        </> : kind === "video" && item.url ? <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-gray-400">{kind === "audio" ? <Music2 size={26}/> : kind === "doc" ? <FileText size={26}/> : kind === "video" ? <Film size={26}/> : <ImageIcon size={26}/>}</div>}
        {selected && <span className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-dark">✓</span>}
      </div>
      <div className="truncate px-2.5 py-2 text-xs font-medium text-gray-700 dark:text-gray-200">{item.name}</div>
    </button>
  );
}

export function SystemAssetLibraryDialog({
  open,
  kind = "image",
  title,
  description,
  selected = [],
  disabledIds = [],
  maxSelected = 1,
  allowInspiration = false,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  kind?: SystemAssetKind;
  title?: string;
  description?: string;
  selected?: SystemAssetPick[];
  disabledIds?: string[];
  maxSelected?: number;
  allowInspiration?: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (items: SystemAssetPick[]) => void;
}) {
  const { t, ts, td } = useI18n();
  const [tab, setTab] = useState<"mine" | "gallery">("mine");
  const [galleryMode, setGalleryMode] = useState<"reference" | "community">("reference");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AssetCategory>("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<SystemAssetPick[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<SystemAssetPick[]>([]);
  const [referenceItems, setReferenceItems] = useState<ReferenceGalleryItem[]>([]);
  const [communityItems, setCommunityItems] = useState<CommunityAsset[]>([]);
  const request = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const canBrowseInspiration = allowInspiration && kind === "image";
  const disabled = useMemo(() => new Set(disabledIds), [disabledIds]);

  useEffect(() => {
    if (!open) return;
    setTab("mine");
    setGalleryMode("reference");
    setQuery("");
    setCategory("all");
    setPage(1);
    setDraft(selectedRef.current);
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "mine") return;
    const current = ++request.current;
    setLoading(true);
    const categoryConfig = ASSET_CATEGORIES.find((item) => item.id === category);
    const requestedKind = categoryConfig?.kind || (kind === "all" ? undefined : kind);
    listAssets({
      page,
      page_size: PAGE_SIZE,
      q: query || undefined,
      kind: requestedKind,
      type: categoryConfig?.type,
    })
      .then((result) => {
        if (current !== request.current) return;
        setItems((result.items || []).map((item: any) => ({ ...item, name: item.name || item.public_id })));
        setTotal(Number(result.total || 0));
      })
      .catch(() => { if (current === request.current) { setItems([]); setTotal(0); } })
      .finally(() => { if (current === request.current) setLoading(false); });
  }, [category, kind, open, page, query, tab]);

  useEffect(() => {
    if (!open || tab !== "gallery" || galleryMode !== "reference") return;
    setLoading(true);
    loadReferenceGalleryManifest()
      .then((manifest) => setReferenceItems(manifest.cases || []))
      .catch(() => setReferenceItems([]))
      .finally(() => setLoading(false));
  }, [galleryMode, open, tab]);

  useEffect(() => {
    if (!open || tab !== "gallery" || galleryMode !== "community") return;
    const current = ++request.current;
    setLoading(true);
    api<{ items: CommunityAsset[]; total?: number }>(`/api/gallery?page=${page}&page_size=${PAGE_SIZE}`)
      .then((result) => { if (current === request.current) { setCommunityItems(result.items || []); setTotal(Number(result.total || 0)); } })
      .catch(() => { if (current === request.current) { setCommunityItems([]); setTotal(0); } })
      .finally(() => { if (current === request.current) setLoading(false); });
  }, [galleryMode, open, page, tab]);

  const filteredReferences = useMemo(() => filterReferenceCases(referenceItems, { query, category: "all", style: "all", scene: "all" }), [query, referenceItems]);
  const visibleItems = useMemo(() => {
    if (tab === "mine") return items;
    if (galleryMode === "reference") return filteredReferences.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item) => ({ url: referenceImageURL(item.image), name: item.title, kind: "image" }));
    const normalized = query.trim().toLocaleLowerCase();
    return communityItems.filter((item) => !normalized || `${item.title || ""}`.toLocaleLowerCase().includes(normalized)).map((item) => ({ url: item.cover_url || "", name: item.title || ts("未命名"), kind: item.type || "image", disabled: !!item.is_featured || Number(item.like_count || 0) >= 10 }));
  }, [communityItems, filteredReferences, galleryMode, items, page, query, tab, ts]);
  const pageTotal = tab === "mine" ? total : galleryMode === "reference" ? filteredReferences.length : total;
  const categoryLabel = (id: AssetCategory) => {
    if (id === "all") return t("common.all");
    if (id === "role") return t("asset.role");
    if (id === "prop") return t("asset.prop");
    if (id === "scene") return t("asset.scene");
    if (id === "image") return t("asset.image");
    if (id === "video") return t("asset.video");
    if (id === "audio") return t("common.audio");
    return t("asset.doc");
  };

  const toggle = (item: SystemAssetPick & { disabled?: boolean }) => {
    if (item.disabled || disabled.has(keyOf(item))) return;
    const exists = draft.some((entry) => keyOf(entry) === keyOf(item));
    if (exists) return setDraft((current) => current.filter((entry) => keyOf(entry) !== keyOf(item)));
    if (maxSelected <= 1) return setDraft([item]);
    setDraft((current) => [...current, item].slice(0, maxSelected));
  };

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title || ts("资产库")} className="flex h-[min(680px,calc(100dvh-1rem))] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-white/10 sm:px-5">
          <div><h2 className="font-bold text-gray-900 dark:text-gray-100">{title || ts("资产库")}</h2><p className="mt-0.5 text-xs text-gray-400">{description || ts("选择当前账号可访问的素材")}</p></div>
          <button type="button" aria-label={t("common.close")} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"><X size={16}/></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
          <div className="flex shrink-0 rounded-xl bg-gray-100 p-1 dark:bg-white/5">
            <button type="button" onClick={() => { setTab("mine"); setPage(1); }} className={`h-8 flex-1 rounded-lg text-sm font-medium transition ${tab === "mine" ? "bg-primary text-dark shadow-sm" : "text-gray-600 dark:text-gray-300"}`}>{t("asset.myAssets")}</button>
            {canBrowseInspiration && <button type="button" onClick={() => { setTab("gallery"); setGalleryMode("reference"); setPage(1); }} className={`h-8 flex-1 rounded-lg text-sm font-medium transition ${tab === "gallery" ? "bg-primary text-dark shadow-sm" : "text-gray-600 dark:text-gray-300"}`}>{t("gallery.title")}</button>}
          </div>
          {tab === "gallery" && <div className="mt-2 grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/5"><button type="button" onClick={() => { setGalleryMode("reference"); setPage(1); }} className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${galleryMode === "reference" ? "bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-white" : "text-gray-500"}`}><Sparkles size={14}/>{t("gallery.referenceCases")}</button><button type="button" onClick={() => { setGalleryMode("community"); setPage(1); }} className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${galleryMode === "community" ? "bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-white" : "text-gray-500"}`}><Users size={14}/>{t("gallery.communityWorks")}</button></div>}
          {tab === "mine" && <div className="scroll-x-only mt-2 flex shrink-0 items-center gap-1.5 overflow-x-auto pb-0.5" aria-label={ts("资产分类")}>
            {ASSET_CATEGORIES.map((item) => {
              const Icon = item.icon;
              const available = item.id === "all" || kind === "all" || item.kind === kind;
              return <button
                key={item.id}
                type="button"
                disabled={!available}
                aria-pressed={category === item.id}
                title={available ? categoryLabel(item.id) : ts("当前功能不支持此类素材")}
                onClick={() => { setCategory(item.id); setPage(1); }}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${category === item.id ? "border-primary/40 bg-primary/12 text-primary" : "border-gray-200 bg-white text-gray-600 hover:border-primary/30 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"} disabled:cursor-not-allowed disabled:opacity-35`}
              ><Icon size={13}/>{categoryLabel(item.id)}</button>;
            })}
          </div>}
          <form className="mt-2 flex shrink-0 gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); }}><label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-gray-200 px-3 dark:border-white/10"><Search size={14} className="text-gray-400"/><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={tab === "mine" ? t("asset.searchAssets") : t("asset.searchGallery")} className="min-w-0 flex-1 bg-transparent text-sm outline-none dark:text-gray-100"/></label></form>
          <div className="mt-2 min-h-[220px] flex-1 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-2 dark:border-white/10 dark:bg-white/5">
            {loading ? <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-400"><Loader2 size={18} className="animate-spin"/>{td("asset.pageLoading", "加载中…")}</div> : visibleItems.length ? <div className={`grid content-start gap-2 ${kind === "video" ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"}`}>{visibleItems.map((item: any) => <AssetPreview key={keyOf(item)} item={item} selected={draft.some((entry) => keyOf(entry) === keyOf(item))} disabled={!!item.disabled || disabled.has(keyOf(item))} onClick={() => toggle(item)}/>)}</div> : <div className="flex h-full flex-col items-center justify-center text-gray-400"><FolderOpen size={30} className="mb-2 opacity-50"/><span>{t("asset.noAssets")}</span></div>}
          </div>
          <AssetPagination page={page} total={pageTotal} loading={loading} pageSize={PAGE_SIZE} onChange={setPage}/>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 pt-2 dark:border-white/10"><span className="text-xs text-gray-500">{t("asset.selectedCount", { count: draft.length, max: maxSelected })}</span><div className="flex gap-2"><button type="button" onClick={onClose} className="h-9 rounded-xl bg-gray-100 px-4 text-sm text-gray-600 dark:bg-white/10 dark:text-gray-300">{t("common.cancel")}</button><button type="button" onClick={() => onConfirm(draft)} className="h-9 rounded-xl bg-primary px-4 text-sm font-semibold text-dark">{confirmLabel || t("asset.confirmSelection")}</button></div></footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}
