"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, Upload, ChevronDown, BookOpen, UserRound, Shield, X, Film, FileText, Image as ImageIcon, Lock, Zap, Trash2 } from "lucide-react";
import { api, createRole, deleteAsset, listAssets, listChannelPresets, listRoleTemplates, listRoles, uploadAsset, uploadFile } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export type ReferenceImagePick = { url: string; name: string; public_id?: string };

interface GalleryPickItem {
  public_id: string;
  title?: string;
  cover_url?: string;
  type?: string;
  is_featured: boolean;
  like_count: number;
}

export interface BottomBarState {
  channel_key: string; // price_first, speed_first, success_first
  fallback_enabled: boolean;
  web_search: boolean;
  timeout_sec: number; // default 30
  role_id?: number;
  role_name?: string;
  role_prompt?: string;
  role_icon_url?: string;
  asset_ids: string[]; // public_id[]
  files: { public_id: string; url: string; name: string }[];
}

const TIMEOUTS = [10, 20, 30, 60, 120];

type AssetKind = "image" | "video" | "doc";
type AssetType = "role" | "scene" | "prop";
type AssetItem = { public_id: string; name?: string; mime_type?: string; url: string; kind?: string; asset_type?: string };

const DOC_ACCEPT = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".md",
  ".csv",
].join(",");

function inferAssetKind(file: File): AssetKind {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name)) return "image";
  if (/\.(mp4|mov|webm|mkv|avi)$/i.test(name)) return "video";
  return "doc";
}

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function pill(active: boolean) {
  return clsx(
    "h-8 px-4 rounded-full text-sm border transition",
    active
      ? "bg-primary/15 border-primary/30 text-gray-900 dark:bg-primary/15 dark:border-primary/30 dark:text-gray-100"
      : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:border-white/20"
  );
}

function galleryPricing(item: GalleryPickItem) {
  if (item.is_featured) return { paid: true, price: 1 };
  if (item.like_count >= 10) return { paid: true, price: 0.5 };
  return { paid: false, price: 0 };
}

function AssetGridCard({
  coverUrl,
  title,
  tag,
  kind,
  selected,
  locked,
  onClick,
  onPreview,
  onDelete,
}: {
  coverUrl?: string;
  title: string;
  tag: string;
  kind?: string;
  selected?: boolean;
  locked?: boolean;
  onClick: () => void;
  onPreview?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const k = (kind || "image").toLowerCase();
  return (
    <div
      role="button"
      tabIndex={locked ? -1 : 0}
      onClick={() => {
        if (!locked) onClick();
      }}
      onKeyDown={(e) => {
        if (!locked && (e.key === "Enter" || e.key === " ")) onClick();
      }}
      className={clsx(
        "rounded-xl overflow-hidden bg-white border text-left transition cursor-pointer select-none",
        locked && "cursor-not-allowed opacity-95",
        selected ? "border-primary ring-2 ring-primary/30" : "border-gray-100 hover:border-gray-200 hover:shadow-sm"
      )}
    >
      <div className="relative aspect-[4/5] bg-gray-100 overflow-hidden">
        {k === "image" && coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-400">
            {k === "video" ? <Film size={28} /> : k === "doc" ? <FileText size={28} /> : <ImageIcon size={28} />}
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 px-1.5 py-0.5 rounded-md bg-pink-500 text-white text-[10px] font-medium leading-none">
          {tag}
        </span>
        {onPreview && k === "image" && coverUrl && (
          <button
            type="button"
            className="absolute left-1.5 bottom-1.5 px-2 py-0.5 rounded-lg bg-white/90 border border-gray-200 text-[10px] text-gray-700 hover:bg-white"
            aria-label={t("common.preview")}
            title={t("common.preview")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPreview();
            }}
          >
            预览
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="absolute right-1.5 top-1.5 z-20 inline-flex h-7 items-center gap-1 rounded-lg border border-red-200 bg-red-50/95 px-2 text-[11px] font-semibold text-red-600 shadow-sm hover:bg-red-100 dark:bg-red-500/20 dark:border-red-400/40 dark:text-red-200 dark:hover:bg-red-500/30"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            aria-label={t("asset.deleteAsset")}
            title={t("asset.deleteAsset")}
          >
            <Trash2 size={13} />
            {t("common.delete")}
          </button>
        )}
        {selected && !locked && (
          <div className="absolute right-1.5 bottom-1.5 z-10 w-5 h-5 rounded-full bg-primary text-dark text-[11px] font-bold flex items-center justify-center">
            ✓
          </div>
        )}
      </div>
      <div className="px-2 py-2">
        <div className="text-[12px] font-medium text-gray-900 truncate">{title}</div>
      </div>
    </div>
  );
}

function ReferencePickCard({
  coverUrl,
  title,
  tag,
  paid,
  price,
  selected,
  locked,
  onClick,
}: {
  coverUrl?: string;
  title: string;
  tag: string;
  paid: boolean;
  price: number;
  selected?: boolean;
  locked?: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="button"
      tabIndex={locked ? -1 : 0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!locked && (e.key === "Enter" || e.key === " ")) onClick();
      }}
      className={clsx(
        "rounded-xl overflow-hidden bg-white border text-left transition cursor-pointer select-none",
        locked && "cursor-not-allowed opacity-95",
        selected ? "border-primary ring-2 ring-primary/30" : "border-gray-100 hover:border-gray-200 hover:shadow-sm"
      )}
    >
      <div className="relative aspect-[4/5] bg-gray-100 overflow-hidden">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <ImageIcon size={28} />
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 px-1.5 py-0.5 rounded-md bg-pink-500 text-white text-[10px] font-medium leading-none">
          {tag}
        </span>
        {paid && (
          <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center text-white pointer-events-none">
            <Lock size={18} className="text-amber-300" />
            <span className="text-xs font-medium mt-1">{t("common.paid")}</span>
          </div>
        )}
        {selected && !locked && (
          <div className="absolute right-1.5 top-1.5 w-5 h-5 rounded-full bg-primary text-dark text-[11px] font-bold flex items-center justify-center">
            ✓
          </div>
        )}
      </div>
      <div className="px-2 py-2">
        <div className="text-[12px] font-medium text-gray-900 truncate">{title}</div>
        <div className="mt-1 text-[11px]">
          {paid ? (
            <span className="inline-flex items-center gap-0.5 text-primary font-semibold">
              <Zap size={11} className="text-amber-500 fill-amber-500" />
              {price}
            </span>
          ) : (
            <span className="text-gray-400">{t("common.free")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function BottomBar({
  value,
  onChange,
  showChannel = true,
  showWebSearch = true,
  showTimeout = true,
}: {
  value: BottomBarState;
  onChange: (next: BottomBarState) => void;
  showChannel?: boolean;
  showWebSearch?: boolean;
  showTimeout?: boolean;
}) {
  const { t, td } = useI18n();
  const set = (patch: Partial<BottomBarState>) => onChange({ ...value, ...patch });

  // Channel presets
  const [channels, setChannels] = useState<
    {
      key: string;
      name: string;
      description?: string;
      strategy: string;
      is_fallback_enabled: boolean;
      model_codes?: string[];
      answer_model_codes?: string[];
      summary_model_codes?: string[];
    }[]
  >([]);
  const [channelOpen, setChannelOpen] = useState(false);

  useEffect(() => {
    listChannelPresets()
      .then((r) => setChannels(r.items || []))
      .catch(() => setChannels([]));
  }, []);

  const currentChannel = useMemo(() => channels.find((c) => c.key === value.channel_key), [channels, value.channel_key]);
  const answerCount = (c?: typeof currentChannel) => (c?.answer_model_codes?.length || c?.model_codes?.length || 0);
  const summaryCount = (c?: typeof currentChannel) => c?.summary_model_codes?.length || 0;
  const channelName = (c?: typeof currentChannel) => {
    const key = c?.key || value.channel_key;
    return td(`channel.${key}.name`, c?.name || t(`channel.${key}.name`) || key);
  };
  const channelDescription = (c: NonNullable<typeof currentChannel>) => td(`channel.${c.key}.desc`, c.description || "");

  const pickChannel = (key: string) => {
    const c = channels.find((x) => x.key === key);
    set({
      channel_key: key,
      fallback_enabled: c?.is_fallback_enabled ?? true,
    });
    setChannelOpen(false);
  };

  return (
    <div className="flex items-center gap-2 flex-nowrap sm:flex-wrap w-max sm:w-auto max-w-full">
      {showChannel && (
        <>
          <div className="relative">
            <button
              onClick={() => setChannelOpen((v) => !v)}
              className="h-9 px-2 sm:px-3 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-700 flex items-center gap-1.5 shrink-0 max-w-[140px] sm:max-w-none dark:bg-white/5 dark:border-white/10 dark:text-gray-200"
            >
              <span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                ¥
              </span>
              <span className="truncate">{currentChannel ? channelName(currentChannel) : t("common.select")}</span>
              {currentChannel && <span className="hidden sm:inline text-[11px] text-gray-400">{answerCount(currentChannel)}/{summaryCount(currentChannel)}</span>}
              <ChevronDown size={14} className="text-gray-400" />
            </button>
          </div>

          {channelOpen && (
            <div className="fixed inset-0 z-[60]" onClick={() => setChannelOpen(false)}>
              <div className="absolute inset-0 bg-black/30" />
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-w-[92vw] bg-white rounded-2xl border shadow-2xl p-5 dark:bg-gray-900 dark:border-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="text-lg font-bold">{t("common.select")}</div>
                    <div className="text-sm text-gray-500 mt-1">{t("workspace.submitHint")}</div>
                  </div>
                  <button className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-300" onClick={() => setChannelOpen(false)}>
                    <X size={16} />
                  </button>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-primary font-semibold">
                    <Shield size={18} />
                    {t("channel.dispatch")}
                  </div>
                  <button
                    onClick={() => set({ fallback_enabled: !value.fallback_enabled })}
                    className={clsx(
                      "px-3 py-1.5 rounded-xl text-sm border",
                      value.fallback_enabled ? "bg-primary/10 border-primary/30 text-primary" : "bg-gray-100 border-gray-200 text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-300"
                    )}
                  >
                    {t("channel.fallback")}
                  </button>
                </div>

                <div className="space-y-3">
                  {channels.length ? (
                    channels.map((c) => (
                      <button
                        key={c.key}
                        onClick={() => pickChannel(c.key)}
                        className={clsx(
                          "w-full text-left p-4 rounded-2xl border transition",
                          value.channel_key === c.key ? "bg-primary/10 border-primary/30 dark:bg-primary/10" : "bg-white border-gray-100 hover:border-gray-200 dark:bg-white/5 dark:border-white/10 dark:hover:border-white/20"
                        )}
                      >
                        <div className="flex items-center justify-between">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{channelName(c)}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">
                              {t("channel.answer")} {answerCount(c)} / {t("channel.summary")} {summaryCount(c)}
                            </span>
                            {value.channel_key === c.key && <span className="text-primary font-bold">✓</span>}
                          </div>
                        </div>
                        <div className="text-sm text-gray-500 mt-1">{channelDescription(c)}</div>
                      </button>
                    ))
                  ) : (
                    <div className="text-center text-gray-400 py-10">暂无渠道预设</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showWebSearch && (
        <button
          onClick={() => set({ web_search: !value.web_search })}
          className={`h-9 max-sm:w-9 max-sm:px-0 max-sm:justify-center px-2 sm:px-3 rounded-xl border text-sm flex items-center gap-1.5 shrink-0 ${
            value.web_search ? "bg-primary/10 border-primary/30 text-primary" : "bg-gray-50 border border-gray-200 text-gray-600 dark:bg-white/5 dark:border-white/10 dark:text-gray-300"
          }`}
          title={t("common.search")}
        >
          <Globe size={16} className="shrink-0" />
          <span className="hidden sm:inline whitespace-nowrap">{t("common.search")}</span>
        </button>
      )}

      {showTimeout && (
        <div className="relative">
          <select
            value={value.timeout_sec}
            onChange={(e) => set({ timeout_sec: parseInt(e.target.value, 10) || 30 })}
            className="h-9 px-3 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-200"
          >
            {TIMEOUTS.map((t) => (
              <option key={t} value={t}>
                {t}s
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// Chat header tools (Upload / Asset library / Role) — used in ModelWorkspace header area
export function ChatTopTools({
  value,
  onChange,
  showUpload = true,
  showRole = true,
  referencePickMode = false,
  referenceImages = [],
  onReferenceImagesChange,
  maxReferenceImages = 4,
}: {
  value: BottomBarState;
  onChange: (next: BottomBarState) => void;
  showUpload?: boolean;
  showRole?: boolean;
  referencePickMode?: boolean;
  referenceImages?: ReferenceImagePick[];
  onReferenceImagesChange?: (next: ReferenceImagePick[]) => void;
  maxReferenceImages?: number;
}) {
  const { t } = useI18n();
  const kindText = useCallback((k?: string) => {
    const v = (k || "").toLowerCase();
    if (v === "image") return t("asset.image");
    if (v === "video") return t("asset.video");
    if (v === "doc") return t("asset.doc");
    return t("common.asset");
  }, [t]);
  const typeText = useCallback((item?: string) => {
    const v = (item || "").toLowerCase();
    if (v === "role") return t("asset.role");
    if (v === "scene") return t("asset.scene");
    if (v === "prop") return t("asset.prop");
    return "";
  }, [t]);
  const galleryTypeText = useCallback((item?: string) => {
    const v = (item || "image").toLowerCase();
    if (v === "video") return t("asset.video");
    if (v === "audio") return t("common.audio");
    return t("asset.image");
  }, [t]);
  const set = (patch: Partial<BottomBarState>) => onChange({ ...value, ...patch });

  // Roles
  const [rolesOpen, setRolesOpen] = useState(false);
  const [roles, setRoles] = useState<{ id: number; name: string; description?: string; system_prompt: string; icon_url?: string }[]>([]);
  const [tpls, setTpls] = useState<{ code: string; name: string; description?: string; system_prompt: string; icon_url?: string }[]>([]);
  const [roleTab, setRoleTab] = useState<"existing" | "create">("existing");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [roleQuery, setRoleQuery] = useState("");
  const [roleDraft, setRoleDraft] = useState({
    icon_url: "",
    name: "",
    description: "",
    system_prompt: "",
  });
  const roleIconRef = useRef<HTMLInputElement | null>(null);

  // Assets
  const [assetOpen, setAssetOpen] = useState(false);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetKind, setAssetKind] = useState<AssetKind | "all">("all");
  const [assetType, setAssetType] = useState<AssetType | "all">("all");
  const [assetItems, setAssetItems] = useState<AssetItem[]>([]);
  const [assetPreview, setAssetPreview] = useState<{
    public_id: string;
    name?: string;
    url: string;
    kind?: string;
    asset_type?: string;
    mime_type?: string;
  } | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadKind, setUploadKind] = useState<AssetKind>("image");
  const [uploadType, setUploadType] = useState<AssetType>("role");
  const [uploadName, setUploadName] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [assetNotice, setAssetNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const uploadFileRef = useRef<HTMLInputElement | null>(null);
  const [assetTab, setAssetTab] = useState<"mine" | "gallery">("mine");
  const [pickedRefs, setPickedRefs] = useState<ReferenceImagePick[]>([]);
  const [galleryItems, setGalleryItems] = useState<GalleryPickItem[]>([]);
  const [galleryQuery, setGalleryQuery] = useState("");
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);

  // Files (chat attachments) — up to 10
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!rolesOpen) return;
    listRoles()
      .then((r) => setRoles(r.items || []))
      .catch(() => setRoles([]));
    listRoleTemplates()
      .then((r) => setTpls(r.items || []))
      .catch(() => setTpls([]));
    setRoleTab("existing");
    setAdvancedOpen(false);
    setRoleQuery("");
  }, [rolesOpen]);

  useEffect(() => {
    if (!assetOpen) return;
    if (referencePickMode) {
      setAssetTab("mine");
      setGalleryQuery("");
      setPickedRefs(referenceImages);
      setAssetKind("image");
      setAssetType("all");
    }
  }, [assetOpen, referencePickMode, referenceImages]);

  const loadAssets = useCallback(
    async (override?: { kind?: AssetKind | "all"; type?: AssetType | "all"; q?: string }) => {
      const nextKind = override?.kind ?? assetKind;
      const nextType = override?.type ?? assetType;
      const nextQuery = override?.q ?? assetQuery;
      try {
        const r = await listAssets({
          q: nextQuery,
          page_size: 50,
          kind: referencePickMode ? "image" : nextKind === "all" ? undefined : nextKind,
          type: nextType === "all" ? undefined : nextType,
        } as any);
        setAssetItems(r.items || []);
      } catch {
        setAssetItems([]);
      }
    },
    [assetKind, assetQuery, assetType, referencePickMode]
  );

  useEffect(() => {
    if (!assetOpen || assetTab !== "mine") return;
    loadAssets();
  }, [assetOpen, assetTab, loadAssets]);

  useEffect(() => {
    if (!assetOpen || !referencePickMode || assetTab !== "gallery") return;
    api<{ items: GalleryPickItem[] }>("/api/gallery")
      .then((r) => setGalleryItems(r.items || []))
      .catch(() => setGalleryItems([]));
  }, [assetOpen, referencePickMode, assetTab]);

  useEffect(() => {
    if (!assetNotice) return;
    const t = window.setTimeout(() => setAssetNotice(null), 3500);
    return () => window.clearTimeout(t);
  }, [assetNotice]);

  const pickRole = (r: { id: number; name: string; system_prompt: string; icon_url?: string }) => {
    set({ role_id: r.id, role_name: r.name, role_prompt: r.system_prompt, role_icon_url: r.icon_url });
    setRolesOpen(false);
  };

  const createNewRole = async () => {
    if (!roleDraft.name.trim() || !roleDraft.system_prompt.trim()) return;
    setCreatingRole(true);
    try {
      await createRole({
        name: roleDraft.name,
        description: roleDraft.description,
        system_prompt: roleDraft.system_prompt,
        icon_url: roleDraft.icon_url || undefined,
      } as any);
      const r = await listRoles();
      setRoles(r.items || []);
      setRoleDraft({ icon_url: "", name: "", description: "", system_prompt: "" });
    } finally {
      setCreatingRole(false);
    }
  };

  const toggleAsset = (id: string) => {
    const exists = value.asset_ids.includes(id);
    set({ asset_ids: exists ? value.asset_ids.filter((x) => x !== id) : [...value.asset_ids, id] });
  };

  const toggleRefPick = (item: ReferenceImagePick, locked?: boolean) => {
    if (locked) return;
    const limit = Math.max(1, Number(maxReferenceImages || 1));
    const exists = pickedRefs.some((x) => x.url === item.url);
    if (exists) {
      setPickedRefs(pickedRefs.filter((x) => x.url !== item.url));
      return;
    }
    if (limit <= 1) {
      setPickedRefs([item]);
      return;
    }
    if (pickedRefs.length >= limit) {
      setAssetNotice({ type: "error", message: t("asset.maxReferenceImages", { max: limit }) });
      return;
    }
    setPickedRefs([...pickedRefs, item]);
  };

  const deleteUserAsset = async (asset: AssetItem) => {
    const title = asset.name || asset.public_id;
    if (typeof window !== "undefined" && !window.confirm(`确定删除资产「${title}」吗？删除后无法继续引用该资产。`)) {
      return;
    }
    setDeletingAssetId(asset.public_id);
    setAssetNotice(null);
    try {
      await deleteAsset(asset.public_id);
      setAssetItems((items) => items.filter((item) => item.public_id !== asset.public_id));
      set({
        asset_ids: value.asset_ids.filter((id) => id !== asset.public_id),
        files: value.files.filter((file) => file.public_id !== asset.public_id),
      });
      setPickedRefs((items) => items.filter((item) => item.public_id !== asset.public_id && item.url !== asset.url));
      if (assetPreview?.public_id === asset.public_id) setAssetPreview(null);
      setAssetNotice({ type: "success", message: `「${title}」已删除。` });
      if (assetOpen && assetTab === "mine") await loadAssets();
    } catch (err) {
      setAssetNotice({ type: "error", message: err instanceof Error ? err.message : t("asset.uploadFailed") });
    } finally {
      setDeletingAssetId(null);
    }
  };

  const confirmAssetSelection = () => {
    if (referencePickMode && onReferenceImagesChange) {
      onReferenceImagesChange(pickedRefs);
    }
    setAssetOpen(false);
  };

  const filteredGalleryItems = useMemo(() => {
    const q = galleryQuery.trim().toLowerCase();
    const imageItems = galleryItems.filter((item) => {
      const coverURL = item.cover_url || "";
      return (item.type || "image").toLowerCase() === "image" && !/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(coverURL);
    });
    if (!q) return imageItems;
    return imageItems.filter((item) => (item.title || "").toLowerCase().includes(q));
  }, [galleryItems, galleryQuery]);

  const imageAssetItems = useMemo(
    () => assetItems.filter((a) => (a.kind || "image").toLowerCase() === "image" && a.url),
    [assetItems]
  );

  const selectedAssets = useMemo(() => {
    const map = new Map(assetItems.map((a) => [a.public_id, a]));
    return value.asset_ids.map((id) => map.get(id) || { public_id: id, url: "", name: id } as any);
  }, [assetItems, value.asset_ids]);

  const removeFile = (id: string) => {
    set({ files: value.files.filter((f) => f.public_id !== id) });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const left = Math.max(0, 10 - value.files.length);
    const selected = Array.from(files).slice(0, left);
    if (selected.length === 0) return;
    setUploading(true);
    try {
      const uploaded: { public_id: string; url: string; name: string }[] = [];
      for (const f of selected) {
        const r = await uploadAsset(f, { name: f.name, kind: inferAssetKind(f), asset_type: "prop" });
        uploaded.push({ public_id: r.public_id, url: r.url, name: f.name });
      }
      set({ files: [...value.files, ...uploaded] });
      setAssetNotice({ type: "success", message: t("asset.uploadedAttachments", { count: uploaded.length }) });
      if (assetOpen && assetTab === "mine") await loadAssets();
    } catch (err) {
      setAssetNotice({ type: "error", message: err instanceof Error ? err.message : t("asset.uploadFailed") });
    } finally {
      setUploading(false);
    }
  };

  const uploadRoleIcon = async (f: File) => {
    const url = await uploadFile(f);
    setRoleDraft({ ...roleDraft, icon_url: url });
  };

  const openUploadAsset = () => {
    setUploadModalOpen(true);
    setAssetNotice(null);
    setUploadKind("image");
    setUploadType("role");
    setUploadName("");
    setUploadDesc("");
    setSelectedUploadFile(null);
  };

  const saveUploadedAsset = async () => {
    const f = selectedUploadFile;
    if (!f) return;
    if (uploadName.trim().length === 0) return;
    setUploading(true);
    setAssetNotice(null);
    try {
      await uploadAsset(f, {
        name: uploadName.trim(),
        description: uploadDesc.trim(),
        kind: uploadKind,
        asset_type: uploadType,
      } as any);
      setUploadModalOpen(false);
      setAssetOpen(true);
      setAssetTab("mine");
      setAssetKind(referencePickMode ? "image" : uploadKind);
      setAssetType(uploadType);
      setAssetNotice({ type: "success", message: t("asset.uploadedCompleteSelectManually") });
      setSelectedUploadFile(null);
      setUploadName("");
      setUploadDesc("");
      await loadAssets({ kind: uploadKind, type: uploadType });
    } catch (err) {
      setAssetNotice({ type: "error", message: err instanceof Error ? err.message : t("asset.uploadFailed") });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0 max-w-full">
      {assetNotice && (
        <div
          className={clsx(
            "fixed left-1/2 bottom-24 z-[90] -translate-x-1/2 px-4 py-2.5 rounded-2xl border text-sm shadow-lg bg-white",
            assetNotice.type === "success" ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-600"
          )}
        >
          {assetNotice.message}
        </div>
      )}
      {/* Upload (chat attachments) */}
      {showUpload && (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || value.files.length >= 10}
            className="relative h-9 max-sm:w-9 max-sm:px-0 max-sm:justify-center px-2 sm:px-3 rounded-xl bg-white border border-gray-100 text-gray-700 text-sm shadow-sm flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            title={`${t("asset.uploadAttachment")} ${value.files.length}/10`}
          >
            <Upload size={16} className="text-gray-500 shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">{uploading ? t("common.uploading") : t("common.upload")}</span>
            <span className="hidden sm:inline text-xs text-gray-400 whitespace-nowrap">{value.files.length}/10</span>
            <span className="sm:hidden absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-gray-100 border border-gray-200 text-[10px] text-gray-600 flex items-center justify-center">
              {value.files.length}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      )}
      {showUpload && value.files.length > 0 && (
        <div className="scroll-x-only flex flex-nowrap items-center gap-1.5 max-w-full sm:max-w-[420px] shrink-0">
          {value.files.slice(0, 5).map((f) => (
            <div key={f.public_id} className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-600 dark:bg-white/5 dark:border-white/10 dark:text-gray-300">
              <span className="truncate max-w-[120px]">{f.name}</span>
              <button
                type="button"
                className="w-4 h-4 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500 dark:bg-white/10 dark:border-white/10 dark:text-gray-300"
                onClick={() => removeFile(f.public_id)}
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {value.files.length > 5 && <span className="text-xs text-gray-400">+{value.files.length - 5}</span>}
        </div>
      )}

      {/* Asset library */}
      <button
        onClick={() => setAssetOpen(true)}
        className="relative h-9 max-sm:w-9 max-sm:px-0 max-sm:justify-center px-2 sm:px-3 rounded-xl bg-white border border-gray-100 text-gray-700 text-sm shadow-sm flex items-center gap-1.5 shrink-0 dark:bg-white/5 dark:border-white/10 dark:text-gray-200"
        title={t("asset.library")}
      >
        <BookOpen size={16} className="text-gray-500 dark:text-gray-400 shrink-0" />
        <span className="hidden sm:inline whitespace-nowrap">{t("asset.library")}</span>
        {referencePickMode
          ? referenceImages.length > 0 && (
              <span className="hidden sm:inline text-xs text-primary whitespace-nowrap">({referenceImages.length})</span>
            )
          : value.asset_ids.length > 0 && (
              <span className="hidden sm:inline text-xs text-primary whitespace-nowrap">({value.asset_ids.length})</span>
            )}
        {(referencePickMode ? referenceImages.length : value.asset_ids.length) > 0 && (
          <span className="sm:hidden absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary/15 text-[10px] text-primary flex items-center justify-center">
            {referencePickMode ? referenceImages.length : value.asset_ids.length}
          </span>
        )}
      </button>

      {/* Role */}
      {showRole && (
        <button
          onClick={() => setRolesOpen(true)}
          className="h-9 max-sm:w-9 max-sm:px-0 max-sm:justify-center px-2 sm:px-3 rounded-xl bg-white border border-gray-100 text-gray-700 text-sm shadow-sm flex items-center gap-1.5 min-w-0 sm:max-w-[200px] shrink-0 dark:bg-white/5 dark:border-white/10 dark:text-gray-200"
          title={value.role_name || t("role.select")}
        >
          {value.role_icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.role_icon_url} alt="" className="w-5 h-5 rounded-lg object-cover border border-gray-200 dark:border-white/10 shrink-0" />
          ) : (
            <UserRound size={16} className="text-gray-500 dark:text-gray-400 shrink-0" />
          )}
          <span className="truncate hidden sm:inline whitespace-nowrap">{value.role_name || t("role.select")}</span>
        </button>
      )}

      {/* Role modal (layout aligned with screenshot baseline; will be further refined with templates next step) */}
      {showRole && rolesOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setRolesOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-[calc(100vw-2rem)] sm:max-w-[920px] shadow-2xl overflow-hidden dark:bg-gray-900 dark:border dark:border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10 dark:bg-gray-900 dark:border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <UserRound size={18} />
                </div>
                <div>
                  <div className="font-bold text-gray-900 dark:text-gray-100">{t("role.manage")}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{t("role.manageDesc")}</div>
                </div>
              </div>
              <button className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-300" onClick={() => setRolesOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="p-5 max-h-[78vh] overflow-y-auto">
              <div className="flex items-center gap-6 text-sm font-semibold text-gray-700 mb-4">
                <button
                  className={clsx(roleTab === "existing" ? "text-primary border-b-2 border-primary pb-2" : "text-gray-400 pb-2")}
                  onClick={() => setRoleTab("existing")}
                >
                  {t("role.existing")}
                </button>
                <button
                  className={clsx(roleTab === "create" ? "text-primary border-b-2 border-primary pb-2" : "text-gray-400 pb-2")}
                  onClick={() => setRoleTab("create")}
                >
                  + {t("role.create")}
                </button>
              </div>

              {roleTab === "existing" ? (
                <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 dark:bg-white/5 dark:border-white/10">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="text-sm font-semibold">{t("role.existing")}</div>
                    <input
                      className="w-[240px] px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm dark:bg-gray-900 dark:border-white/10 dark:text-gray-100 dark:placeholder:text-gray-500"
                      placeholder={t("role.searchPlaceholder")}
                      value={roleQuery}
                      onChange={(e) => setRoleQuery(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {roles
                      .filter((r) => {
                        const kw = roleQuery.trim().toLowerCase();
                        if (!kw) return true;
                        return (r.name + " " + (r.description || "")).toLowerCase().includes(kw);
                      })
                      .map((r) => (
                        <div key={r.id} className="w-full bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 hover:border-gray-200 transition dark:bg-white/5 dark:border-white/10 dark:hover:border-white/20">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0 dark:bg-white/10 dark:border-white/10">
                              {r.icon_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.icon_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-xs text-gray-400">AI</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-gray-900 truncate dark:text-gray-100">{r.name}</div>
                              <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{r.description}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => pickRole(r)}
                            className="shrink-0 text-xs px-4 py-2 rounded-xl bg-primary/10 border border-primary/25 text-primary font-semibold hover:bg-primary/15"
                          >
                            {t("role.use")}
                          </button>
                        </div>
                      ))}
                    {roles.length === 0 && <div className="text-center text-gray-400 py-10">{t("role.empty")}</div>}
                  </div>
                </div>
              ) : (
                <div className="border border-gray-100 rounded-2xl p-4 dark:border-white/10">
                  <div className="text-sm font-semibold mb-2">{t("role.new")}</div>

                  <div className="mb-4 px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm text-gray-600 flex items-center justify-between gap-3 dark:bg-white/5 dark:border-white/10 dark:text-gray-300">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-700 dark:text-gray-200">{t("role.promptHintTitle")}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t("role.promptHintDesc")}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((v) => !v)}
                      className="shrink-0 h-9 px-4 rounded-xl bg-white border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:border-white/10 dark:text-gray-100 dark:hover:bg-white/10"
                    >
                      {t("role.advancedSettings")}
                    </button>
                  </div>

                  {advancedOpen && (
                    <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-white border border-gray-100 rounded-2xl p-4 dark:bg-white/5 dark:border-white/10">
                        <div className="text-xs text-gray-500 mb-1">{t("role.outputLanguage")}</div>
                        <select className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-900 dark:border-white/10 dark:text-gray-100">
                          <option value="zh">{t("role.outputLanguageDefault")}</option>
                          <option value="en">English</option>
                        </select>
                        <div className="text-[11px] text-gray-400 mt-2">{t("role.outputLanguageHint")}</div>
                      </div>
                      <div className="bg-white border border-gray-100 rounded-2xl p-4 dark:bg-white/5 dark:border-white/10">
                        <div className="text-xs text-gray-500 mb-1">{t("role.outputFormat")}</div>
                        <select className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-900 dark:border-white/10 dark:text-gray-100">
                          <option value="auto">{t("role.outputFormatAuto")}</option>
                          <option value="bullets">{t("role.outputFormatBullets")}</option>
                          <option value="steps">{t("role.outputFormatSteps")}</option>
                        </select>
                        <div className="text-[11px] text-gray-400 mt-2">{t("role.outputFormatHint")}</div>
                      </div>
                    </div>
                  )}

                  <div className="mb-4">
                    <div className="text-xs text-gray-500 mb-2">{t("role.templateSelect")}</div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-[11px] text-gray-400">{t("role.templateHint")}</div>
                      <button
                        type="button"
                        className="text-xs px-3 py-1.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:border-white/10 dark:text-gray-100 dark:hover:bg-white/10"
                        onClick={() => setRoleDraft({ icon_url: "", name: "", description: "", system_prompt: "" })}
                      >
                        {t("role.clear")}
                      </button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {tpls.map((t) => (
                        <button
                          key={t.code}
                          type="button"
                          onClick={() =>
                            setRoleDraft({
                              icon_url: t.icon_url || roleDraft.icon_url,
                              name: t.name,
                              description: t.description || "",
                              system_prompt: t.system_prompt || "",
                            })
                          }
                          className="min-w-[260px] bg-white border border-gray-100 rounded-2xl p-3 text-left hover:border-gray-200 dark:bg-white/5 dark:border-white/10 dark:hover:border-white/20"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-2xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0 dark:bg-white/10 dark:border-white/10">
                              {t.icon_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={t.icon_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-xs text-gray-400">AI</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-900 truncate dark:text-gray-100">{t.name}</div>
                              <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{t.description}</div>
                            </div>
                          </div>
                        </button>
                      ))}
                      {tpls.length === 0 && <div className="text-center text-gray-400 py-6 w-full">{t("role.noTemplates")}</div>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 角色形象 */}
                    <div className="border border-gray-100 rounded-2xl p-4 dark:border-white/10">
                      <div className="text-sm font-semibold text-gray-800 mb-3 dark:text-gray-100">{t("role.avatar")}</div>
                      <div className="h-36 rounded-2xl bg-gray-50 border border-gray-200 flex flex-col items-center justify-center gap-3 dark:bg-white/5 dark:border-white/10">
                        <div className="w-20 h-20 rounded-full bg-white border border-gray-200 overflow-hidden flex items-center justify-center dark:bg-gray-900 dark:border-white/10">
                          {roleDraft.icon_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={roleDraft.icon_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs text-gray-400">{t("role.uploadAvatarPlaceholder")}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="text-xs px-4 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:border-white/10 dark:text-gray-100 dark:hover:bg-white/10"
                          onClick={() => roleIconRef.current?.click()}
                        >
                          {t("role.uploadAvatar")}
                        </button>
                        <input
                          ref={roleIconRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (!f) return;
                            await uploadRoleIcon(f);
                          }}
                        />
                      </div>
                    </div>

                    {/* 基本信息 */}
                    <div className="border border-gray-100 rounded-2xl p-4 dark:border-white/10">
                      <div className="text-sm font-semibold text-gray-800 mb-3 dark:text-gray-100">{t("role.basicInfo")}</div>
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{t("role.name")}</div>
                          <input
                            className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-900 dark:border-white/10 dark:text-gray-100"
                            placeholder={t("role.namePlaceholder")}
                            value={roleDraft.name}
                            onChange={(e) => setRoleDraft({ ...roleDraft, name: e.target.value })}
                          />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">{t("role.description")}</div>
                          <input
                            className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-900 dark:border-white/10 dark:text-gray-100"
                            placeholder={t("role.descriptionPlaceholder")}
                            value={roleDraft.description}
                            onChange={(e) => setRoleDraft({ ...roleDraft, description: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 角色设定 */}
                  <div className="mt-4 border border-gray-100 rounded-2xl p-4 dark:border-white/10">
                    <div className="text-sm font-semibold text-gray-800 mb-3 dark:text-gray-100">{t("role.setting")}</div>
                    <textarea
                      className="w-full px-3 py-2 border rounded-lg text-sm h-40 dark:bg-gray-900 dark:border-white/10 dark:text-gray-100 dark:placeholder:text-gray-500"
                      placeholder={t("role.settingPlaceholder")}
                      value={roleDraft.system_prompt}
                      onChange={(e) => setRoleDraft({ ...roleDraft, system_prompt: e.target.value })}
                    />
                    <div className="text-[11px] text-gray-400 mt-1 text-right">
                      {roleDraft.system_prompt.length}/3000
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-3 sticky bottom-0 bg-white pt-3 dark:bg-gray-900">
                    <button
                      type="button"
                      className="h-11 px-8 rounded-2xl bg-gray-100 text-gray-600 text-sm dark:bg-white/10 dark:text-gray-300"
                      onClick={() => setRolesOpen(false)}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={createNewRole}
                      disabled={creatingRole}
                      className="h-11 px-8 rounded-2xl bg-primary text-dark font-semibold text-sm disabled:opacity-50"
                    >
                      {creatingRole ? t("role.creating") : t("role.create")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Asset library modal */}
      {assetOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setAssetOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-[calc(100vw-2rem)] sm:max-w-[980px] shadow-2xl overflow-hidden dark:bg-gray-900 dark:border dark:border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between sticky top-0 bg-white z-10 dark:bg-gray-900 dark:border-white/10">
              <div className="font-bold text-gray-900 text-base dark:text-gray-100">
                {referencePickMode ? t("asset.selectReferenceFromLibrary") : t("asset.selectFromLibrary")}
              </div>
              <button className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-300" onClick={() => setAssetOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="p-5 max-h-[78vh] overflow-y-auto">
              {assetNotice && (
                <div
                  className={clsx(
                    "mb-4 px-4 py-2.5 rounded-2xl border text-sm",
                    assetNotice.type === "success"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-red-50 border-red-200 text-red-600"
                  )}
                >
                  {assetNotice.message}
                </div>
              )}
              {referencePickMode ? (
                <>
                  <div className="flex rounded-2xl bg-gray-100 p-1 dark:bg-white/5">
                    <button
                      type="button"
                      className={clsx(
                        "flex-1 h-10 rounded-xl text-sm font-medium transition",
                        assetTab === "mine" ? "bg-primary text-dark shadow-sm" : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                      )}
                      onClick={() => setAssetTab("mine")}
                    >
                      {t("asset.myAssets")}
                    </button>
                    <button
                      type="button"
                      className={clsx(
                        "flex-1 h-10 rounded-xl text-sm font-medium transition",
                        assetTab === "gallery" ? "bg-primary text-dark shadow-sm" : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
                      )}
                      onClick={() => setAssetTab("gallery")}
                    >
                      {t("gallery.title")}
                    </button>
                  </div>

                  <p className="mt-3 text-[12px] text-gray-400 leading-relaxed">
                    {t("asset.freeGalleryOnly")}
                  </p>

                  <div className="flex items-center gap-4 mt-4">
                    <input
                      className="flex-1 px-4 py-2.5 border rounded-2xl text-sm dark:bg-gray-900 dark:border-white/10 dark:text-gray-100 dark:placeholder:text-gray-500"
                      placeholder={assetTab === "gallery" ? t("asset.searchGallery") : t("asset.searchAssets")}
                      value={assetTab === "gallery" ? galleryQuery : assetQuery}
                      onChange={(e) => (assetTab === "gallery" ? setGalleryQuery(e.target.value) : setAssetQuery(e.target.value))}
                    />
                    {assetTab === "mine" && (
                      <button
                        type="button"
                        onClick={openUploadAsset}
                        className="h-10 px-4 rounded-2xl bg-white border border-gray-200 text-sm text-gray-700 flex items-center gap-2 shrink-0 dark:bg-gray-900 dark:border-white/10 dark:text-gray-100"
                      >
                        <span className="text-gray-500">+</span>
                      {t("asset.uploadImage")}
                      </button>
                    )}
                  </div>

                  {assetTab === "mine" && (
                    <div className="flex items-center gap-2 mt-4 flex-wrap">
                      <button className={pill(assetType === "all")} onClick={() => setAssetType("all")}>{t("asset.all")}</button>
                      <button className={pill(assetType === "role")} onClick={() => setAssetType("role")}>{t("asset.role")}</button>
                      <button className={pill(assetType === "scene")} onClick={() => setAssetType("scene")}>{t("asset.scene")}</button>
                      <button className={pill(assetType === "prop")} onClick={() => setAssetType("prop")}>{t("asset.prop")}</button>
                    </div>
                  )}

                  <div className="mt-4 h-[44vh] bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden dark:bg-white/5 dark:border-white/10">
                    {assetTab === "mine" ? (
                      imageAssetItems.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400">
                          <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 flex items-center justify-center mb-3 dark:bg-gray-900 dark:border-white/10">
                            <ImageIcon size={28} className="text-gray-300" />
                          </div>
                          <div className="text-lg font-semibold text-gray-500">{t("asset.noAssets")}</div>
                        </div>
                      ) : (
                        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto h-full content-start">
                          {imageAssetItems.map((a) => {
                            const selected = pickedRefs.some((x) => x.url === a.url);
                            return (
                              <AssetGridCard
                                key={a.public_id}
                                coverUrl={a.url}
                                title={a.name || a.public_id}
                                tag="图片"
                                kind="image"
                                selected={selected}
                                locked={deletingAssetId === a.public_id}
                                onClick={() => toggleRefPick({ url: a.url, name: a.name || a.public_id, public_id: a.public_id })}
                                onDelete={() => deleteUserAsset(a)}
                              />
                            );
                          })}
                        </div>
                      )
                    ) : filteredGalleryItems.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-gray-400">
                          <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 flex items-center justify-center mb-3 dark:bg-gray-900 dark:border-white/10">
                          <ImageIcon size={28} className="text-gray-300" />
                        </div>
                        <div className="text-lg font-semibold text-gray-500">暂无灵感作品</div>
                      </div>
                    ) : (
                      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto h-full content-start">
                        {filteredGalleryItems.map((item) => {
                          const pricing = galleryPricing(item);
                          const selected = !!item.cover_url && pickedRefs.some((x) => x.url === item.cover_url);
                          return (
                            <ReferencePickCard
                              key={item.public_id}
                              coverUrl={item.cover_url}
                              title={item.title || "未命名"}
                              tag={galleryTypeText(item.type)}
                              paid={pricing.paid}
                              price={pricing.price}
                              selected={selected}
                              locked={pricing.paid}
                              onClick={() => {
                                if (!item.cover_url || pricing.paid) return;
                                toggleRefPick({ url: item.cover_url, name: item.title || "灵感参考图" });
                              }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {pickedRefs.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs text-gray-500 mb-2">{t("asset.selectedReferences")}</div>
                      <div className="flex items-center gap-2 overflow-x-auto pb-2">
                        {pickedRefs.map((img) => (
                          <div key={img.url} className="min-w-[160px] bg-white border border-gray-100 rounded-2xl p-2 flex items-center gap-2 dark:bg-white/5 dark:border-white/10">
                            <div className="w-12 h-14 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden shrink-0 dark:bg-white/10 dark:border-white/10">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-gray-900 truncate dark:text-gray-100">{img.name}</div>
                              <div className="text-[11px] text-gray-400 mt-0.5">参考图</div>
                            </div>
                            <button
                              type="button"
                              className="w-8 h-8 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:bg-white/10 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/15"
                              onClick={() => toggleRefPick(img)}
                              aria-label="移除"
                              title="移除"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-5 flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                      {t("asset.selectedCount", { count: pickedRefs.length, max: maxReferenceImages })}
                      {maxReferenceImages <= 1 && <span className="ml-2 text-xs text-gray-400">{t("asset.singleReferenceHint")}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <button type="button" className="h-11 px-6 rounded-2xl bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" onClick={() => setAssetOpen(false)}>
                        {t("common.cancel")}
                      </button>
                      <button type="button" className="h-11 px-6 rounded-2xl bg-primary text-dark font-semibold" onClick={confirmAssetSelection}>
                        {t("asset.confirmSelection")}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
              <div className="flex items-center gap-4">
                <input
                  className="flex-1 px-4 py-2.5 border rounded-2xl text-sm dark:bg-gray-900 dark:border-white/10 dark:text-gray-100 dark:placeholder:text-gray-500"
                  placeholder={t("asset.searchAssets")}
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                />
                <button
                  type="button"
                  onClick={openUploadAsset}
                  className="h-10 px-4 rounded-2xl bg-white border border-gray-200 text-sm text-gray-700 flex items-center gap-2 dark:bg-gray-900 dark:border-white/10 dark:text-gray-100"
                >
                  <span className="text-gray-500">+</span>
                  {t("asset.uploadAsset")}
                </button>
              </div>

              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <button className={pill(assetType === "all" && assetKind === "all")} onClick={() => { setAssetType("all"); setAssetKind("all"); }}>
                  {t("asset.all")}
                </button>
                <button className={pill(assetType === "role")} onClick={() => setAssetType("role")}>{t("asset.role")}</button>
                <button className={pill(assetType === "scene")} onClick={() => setAssetType("scene")}>{t("asset.scene")}</button>
                <button className={pill(assetType === "prop")} onClick={() => setAssetType("prop")}>{t("asset.prop")}</button>
                <button className={pill(assetKind === "video")} onClick={() => setAssetKind("video")}>{t("asset.video")}</button>
                <button className={pill(assetKind === "doc")} onClick={() => setAssetKind("doc")}>{t("asset.doc")}</button>
              </div>

              <div className="mt-4 px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 text-[13px] dark:bg-amber-500/10 dark:border-amber-400/20 dark:text-amber-200">
                {t("asset.temporaryNotice")}
              </div>

              <div className="mt-4 h-[44vh] bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden dark:bg-white/5 dark:border-white/10">
                {assetItems.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400">
                    <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 flex items-center justify-center mb-3 dark:bg-gray-900 dark:border-white/10">
                      <span className="text-2xl">+</span>
                    </div>
                    <div className="text-lg font-semibold text-gray-500">{t("asset.noAssets")}</div>
                  </div>
                ) : (
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto h-full content-start">
                    {assetItems.map((a) => {
                      const selected = value.asset_ids.includes(a.public_id);
                      const kind = (a.kind || "").toLowerCase();
                      const tLabel = typeText(a.asset_type);
                      const kLabel = kindText(a.kind);
                      const tag = tLabel ? `${kLabel}·${tLabel}` : kLabel;
                      return (
                        <AssetGridCard
                          key={a.public_id}
                          coverUrl={a.url}
                          title={a.name || a.public_id}
                          tag={tag}
                          kind={kind}
                          selected={selected}
                          locked={deletingAssetId === a.public_id}
                          onClick={() => toggleAsset(a.public_id)}
                          onPreview={kind === "image" && a.url ? () => setAssetPreview(a) : undefined}
                          onDelete={() => deleteUserAsset(a)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {value.asset_ids.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-gray-500 mb-2">{t("asset.selectedAssets")}</div>
                  <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {selectedAssets.map((a: any) => {
                      const kind = (a.kind || "").toLowerCase();
                      const label = kindText(a.kind);
                      return (
                        <div key={a.public_id} className="min-w-[180px] bg-white border border-gray-100 rounded-2xl p-2 flex items-center gap-2 dark:bg-white/5 dark:border-white/10">
                          <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0 dark:bg-white/10 dark:border-white/10">
                            {kind === "image" && a.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.url} alt="" className="w-full h-full object-cover" />
                            ) : kind === "video" ? (
                              <Film size={18} className="text-gray-400" />
                            ) : kind === "doc" ? (
                              <FileText size={18} className="text-gray-400" />
                            ) : (
                              <ImageIcon size={18} className="text-gray-400" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-gray-900 truncate dark:text-gray-100">{a.name || a.public_id}</div>
                            <div className="text-[11px] text-gray-400 mt-0.5 truncate">{label}</div>
                          </div>
                          <button
                            type="button"
                            className="w-8 h-8 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:bg-white/10 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/15"
                            onClick={() => toggleAsset(a.public_id)}
                            aria-label={t("common.remove")}
                            title={t("common.remove")}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-5 flex items-center justify-between">
                <div className="text-sm text-gray-500">{t("asset.selectedAssetCount", { count: value.asset_ids.length })}</div>
                <div className="flex items-center gap-3">
                  <button type="button" className="h-11 px-6 rounded-2xl bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" onClick={() => setAssetOpen(false)}>
                    {t("common.cancel")}
                  </button>
                  <button type="button" className="h-11 px-6 rounded-2xl bg-primary text-dark font-semibold" onClick={() => setAssetOpen(false)}>
                    {t("asset.confirmSelection")}
                  </button>
                </div>
              </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload asset modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => setUploadModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden dark:bg-gray-900 dark:border dark:border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between dark:border-white/10">
              <div className="font-bold text-gray-900 dark:text-gray-100">
                {uploadKind === "image" ? t("asset.uploadImageAsset") : uploadKind === "video" ? t("asset.uploadVideoAsset") : t("asset.uploadDocAsset")}
              </div>
              <button className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-300" onClick={() => setUploadModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="p-6">
              {referencePickMode ? (
                <div className="px-4 py-2.5 rounded-2xl bg-blue-50 border border-blue-100 text-blue-700 text-sm dark:bg-sky-500/10 dark:border-sky-400/20 dark:text-sky-200">
                  {t("asset.currentReferenceImageOnly")}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button className={pill(uploadKind === "image")} onClick={() => setUploadKind("image")}>{t("asset.image")}</button>
                  <button className={pill(uploadKind === "video")} onClick={() => setUploadKind("video")}>{t("asset.video")}</button>
                  <button className={pill(uploadKind === "doc")} onClick={() => setUploadKind("doc")}>{t("asset.doc")}</button>
                </div>
              )}

              <div
                className="mt-4 h-44 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center gap-2 cursor-pointer dark:border-white/10 dark:bg-white/5"
                onClick={() => uploadFileRef.current?.click()}
              >
                <div className="w-12 h-12 rounded-2xl bg-white border border-gray-200 flex items-center justify-center text-primary dark:bg-gray-900 dark:border-white/10">
                  <Upload size={20} />
                </div>
                <div className="text-base font-semibold text-gray-800 dark:text-gray-100">
                  {t("asset.chooseLocalFile", { kind: uploadKind === "image" ? t("asset.image") : uploadKind === "video" ? t("asset.video") : t("common.document") })}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t("asset.supportedFileDesc")}
                </div>
                <input
                  ref={uploadFileRef}
                  type="file"
                  className="hidden"
                  accept={referencePickMode ? "image/*" : uploadKind === "image" ? "image/*" : uploadKind === "video" ? "video/*" : DOC_ACCEPT}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    setSelectedUploadFile(f);
                    setUploadKind(referencePickMode ? "image" : inferAssetKind(f));
                    if (!uploadName.trim()) setUploadName(f.name.slice(0, 50));
                  }}
                />
              </div>
              {selectedUploadFile && (
                <div className="mt-3 px-4 py-3 rounded-2xl bg-white border border-gray-100 text-sm text-gray-700 flex items-center justify-between gap-3 dark:bg-white/5 dark:border-white/10 dark:text-gray-200">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{selectedUploadFile.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {(selectedUploadFile.size / (1024 * 1024)).toFixed(2)} MB · {kindText(uploadKind)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="h-9 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm dark:bg-white/10 dark:border-white/10 dark:text-gray-200"
                    onClick={() => {
                      setSelectedUploadFile(null);
                    }}
                  >
                    {t("asset.reselect")}
                  </button>
                </div>
              )}

              <div className="mt-5">
                <div className="text-sm font-semibold text-gray-700 mb-2">{t("asset.assetType")}</div>
                <div className="flex items-center gap-2">
                  <button className={pill(uploadType === "role")} onClick={() => setUploadType("role")}>{t("asset.role")}</button>
                  <button className={pill(uploadType === "scene")} onClick={() => setUploadType("scene")}>{t("asset.scene")}</button>
                  <button className={pill(uploadType === "prop")} onClick={() => setUploadType("prop")}>{t("asset.prop")}</button>
                </div>
              </div>

              <div className="mt-5">
                <div className="text-sm font-semibold text-gray-700 mb-2">{t("asset.nameLabel")}</div>
                <input
                  className="w-full px-4 py-3 border rounded-2xl text-sm dark:bg-gray-900 dark:border-white/10 dark:text-gray-100 dark:placeholder:text-gray-500"
                  placeholder={t("asset.namePlaceholder")}
                  value={uploadName}
                  maxLength={50}
                  onChange={(e) => setUploadName(e.target.value)}
                />
              </div>

              <div className="mt-4">
                <div className="text-sm font-semibold text-gray-700 mb-2">{t("asset.descLabel")}</div>
                <input
                  className="w-full px-4 py-3 border rounded-2xl text-sm dark:bg-gray-900 dark:border-white/10 dark:text-gray-100 dark:placeholder:text-gray-500"
                  placeholder={t("asset.descPlaceholder")}
                  value={uploadDesc}
                  maxLength={200}
                  onChange={(e) => setUploadDesc(e.target.value)}
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button type="button" className="h-11 px-8 rounded-2xl bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" onClick={() => setUploadModalOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="h-11 px-8 rounded-2xl bg-primary text-dark font-semibold disabled:opacity-50"
                  disabled={uploading || !selectedUploadFile || !uploadName.trim()}
                  onClick={saveUploadedAsset}
                >
                  {uploading ? t("common.uploading") : t("asset.uploadAndSave")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Asset preview */}
      {assetPreview && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={() => setAssetPreview(null)}>
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden dark:bg-gray-900 dark:border dark:border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between dark:border-white/10">
              <div className="font-bold text-gray-900 truncate dark:text-gray-100">{assetPreview.name || assetPreview.public_id}</div>
              <button className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-300" onClick={() => setAssetPreview(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs dark:bg-white/10 dark:text-gray-200">{kindText(assetPreview.kind)}</span>
                {typeText(assetPreview.asset_type) && (
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs dark:bg-white/10 dark:text-gray-200">{typeText(assetPreview.asset_type)}</span>
                )}
                {assetPreview.mime_type && <span className="text-xs text-gray-400 truncate">{assetPreview.mime_type}</span>}
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden flex items-center justify-center dark:bg-white/5 dark:border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetPreview.url} alt="" className="max-h-[65vh] w-full object-contain" />
              </div>
              <div className="mt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="h-11 px-6 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm"
                  onClick={() => deleteUserAsset(assetPreview)}
                  disabled={deletingAssetId === assetPreview.public_id}
                >
                  {t("asset.deleteAsset")}
                </button>
                <button type="button" className="h-11 px-8 rounded-2xl bg-gray-100 text-gray-600 text-sm dark:bg-white/10 dark:text-gray-300" onClick={() => setAssetPreview(null)}>
                  {t("common.close")}
                </button>
                <button
                  type="button"
                  className="h-11 px-8 rounded-2xl bg-primary text-dark font-semibold text-sm"
                  onClick={() => {
                    toggleAsset(assetPreview.public_id);
                    setAssetPreview(null);
                  }}
                >
                  {value.asset_ids.includes(assetPreview.public_id) ? t("asset.cancelSelection") : t("asset.selectThisAsset")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

