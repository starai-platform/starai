"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { ArrowUp, Camera, Download, HelpCircle, ImageIcon, Layers, Loader2, Shirt, Sparkles, Upload, X } from "lucide-react";
import { apiCached, uploadAsset } from "@/lib/api";
import { BottomBarState, ChatTopTools, ReferenceImagePick } from "./BottomBar";
import { MediaMenuOption, MediaOptionMenu } from "./MediaOptionMenu";
import { PhotoStudioTopBar } from "./PhotoStudioLanding";
import { TryOnPlayGuide } from "./TryOnPlayGuide";
import { useI18n } from "@/i18n/I18nProvider";

type Role = { id: string; name?: string; avatar?: string; description?: string };
type Step = { icon?: string; title?: string; subtitle?: string; tags?: string[] };
type Pick = { url: string; name: string; public_id: string };
type ModelItem = { code: string; display_name?: string; tags?: string[]; runtime_rule?: Record<string, any> };
type MediaTask = { task_no?: string; status?: string; progress?: number; output?: Record<string, any>; error_message?: string };
type Project = { status: string; inputs?: Record<string, any>; outputs?: Record<string, any>; media_tasks?: MediaTask[]; error_message?: string };

const CATEGORIES = [
  { value: "auto", label: "自动识别" },
  { value: "tops", label: "上装" },
  { value: "bottoms", label: "下装" },
  { value: "one-pieces", label: "连衣裙" },
];
const PHOTO_TYPES = [
  { value: "auto", label: "自动识别" },
  { value: "flat-lay", label: "平铺商品图" },
  { value: "model", label: "模特商品图" },
];
const COUNTS = [1, 2, 4];
const SIZES = ["1K", "2K"];
const DEFAULT_TEAM: Role[] = [
  { id: "stylist", name: "穿搭顾问", avatar: "/assets/photo-studio/stylist.png", description: "理解服装类型和穿着要求" },
  { id: "garment", name: "服装分析师", avatar: "/assets/photo-studio/photo-director.png", description: "识别版型、颜色、纹理与细节" },
  { id: "tryon", name: "试衣摄影师", avatar: "/assets/photo-studio/photographer.png", description: "调用多参考图模型完成试穿" },
  { id: "quality", name: "质检师", avatar: "/assets/photo-studio/retoucher.png", description: "检查人物和服装一致性" },
];
const TEAM_AVATARS: Record<string, string> = Object.fromEntries(DEFAULT_TEAM.map((role) => [role.id, role.avatar || ""]));

function isTryOnModel(model: ModelItem, defaultCode?: string) {
  if (model.code === defaultCode) return true;
  const imageRule = model.runtime_rule?.image || {};
  if (Number(imageRule.max_reference_images || model.runtime_rule?.max_reference_images || 0) >= 2) return true;
  const text = `${model.code} ${model.display_name || ""} ${(model.tags || []).join(" ")} ${JSON.stringify(model.runtime_rule || {})}`.toLowerCase();
  return text.includes("nano_banana") || text.includes("nano banana") || text.includes("gpt-image-2") || text.includes("gemini");
}

function imageURL(task: MediaTask) {
  const out = task.output || {};
  if (typeof out.image_url === "string") return out.image_url;
  if (Array.isArray(out.images)) {
    const first = out.images[0];
    if (typeof first === "string") return first;
    if (first && typeof first.url === "string") return first.url;
  }
  return "";
}

export function VirtualTryOnLanding({ workflowCode, workflowName, workflowDescription, roles, heroTags, steps, onLoadHistory, onNewTask }: {
  workflowCode: string;
  workflowName: string;
  workflowDescription: string;
  roles?: Role[];
  heroTags?: string[];
  steps?: Step[];
  onLoadHistory?: (id: string) => void | Promise<void>;
  onNewTask?: () => void;
}) {
  const { ts } = useI18n();
  const team = roles?.length ? roles : DEFAULT_TEAM;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2 sm:px-5 lg:px-8">
      <PhotoStudioTopBar workflowCode={workflowCode} historyFallbackTitle={ts("试衣任务")} onNewTask={onNewTask} onLoadHistory={onLoadHistory} />
      <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col justify-center py-3">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"><Shirt size={13} />{ts("AI 视觉试穿")}</div>
          <div className="mt-3 flex items-center justify-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-2xl dark:bg-rose-500/15">👗</div><h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white sm:text-4xl">{workflowName || ts("AI试衣间")}</h1></div>
          <p className="mx-auto mt-2 max-w-3xl text-sm leading-6 text-gray-500 dark:text-slate-300">{workflowDescription || ts("上传人物照和服装图，快速生成自然的视觉试穿效果。")}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">{(heroTags?.length ? heroTags : ["双图试穿", "人物保真", "服装还原"]).map((tag) => <span key={tag} className="hero-tag">{ts(tag)}</span>)}</div>
        </div>
        {!!steps?.length && <div className="mx-auto mt-4 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">{steps.map((step, index) => <div key={index} className="rounded-2xl border border-white bg-white/75 p-3 backdrop-blur dark:border-white/10 dark:bg-white/5"><div className="text-lg">{step.icon}</div><div className="mt-1 text-xs font-semibold text-gray-800 dark:text-gray-100">{step.title}</div><div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-gray-400">{step.subtitle}</div></div>)}</div>}
        <div className="mx-auto mt-4 w-full">
          <h2 className="text-center text-sm font-bold text-rose-600 dark:text-rose-300 sm:text-base">{ts("为你效力的 AI 穿搭团队")}</h2>
          <div className="mx-auto mt-3 grid max-w-[640px] grid-cols-4 gap-2 sm:gap-4">{team.map((role) => <div key={role.id} title={ts(role.description || "")} className="flex flex-col items-center gap-1.5 text-center"><div className="relative"><img loading="lazy" decoding="async" src={(role.avatar || "").startsWith("/") ? role.avatar : TEAM_AVATARS[role.id] || DEFAULT_TEAM[0].avatar} alt={ts(role.name || role.id)} width={120} height={120} className="h-12 w-12 rounded-full object-cover shadow-sm ring-1 ring-rose-200 dark:ring-rose-400/30" /><span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400 dark:border-[#12070a]" /></div><span className="whitespace-nowrap text-[11px] text-gray-600 dark:text-slate-300">{ts(role.name || role.id)}</span></div>)}</div>
        </div>
      </div>
    </div>
  );
}

function ImagePick({ label, value, uploading, onUpload, onClear }: { label: string; value: Pick | null; uploading: boolean; onUpload: (file?: File) => void; onClear: () => void }) {
  const { ts } = useI18n();
  return value ? (
    <div className="group relative h-24 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-white bg-gray-100 shadow-lg dark:border-white/10"><img loading="lazy" decoding="async" src={value.url} alt={ts(label)} className="h-full w-full object-cover" /><button type="button" onClick={onClear} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100" title={`${ts("移除")}${ts(label)}`}><X size={12} /></button><span className="absolute inset-x-1 bottom-1 rounded-lg bg-black/55 px-1 py-0.5 text-center text-[10px] text-white">{ts(label)}</span></div>
  ) : (
    <label className="flex h-24 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-gray-200 bg-white text-[10px] text-gray-400 shadow-sm hover:border-rose-300 hover:bg-rose-50/40 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"><>{uploading ? <Loader2 size={19} className="animate-spin text-rose-400" /> : <Upload size={19} />}</><span className="px-1 text-center">{uploading ? ts("上传中") : ts(label)}</span><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={(event) => { onUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
  );
}

export function VirtualTryOnInputBar({ defaultModelCode, initialInputs, error, featureTags, onSubmit }: { defaultModelCode?: string; initialInputs?: Record<string, any>; error?: string; featureTags?: string[]; onSubmit: (inputs: Record<string, any>) => void | Promise<void> }) {
  const { t, ts } = useI18n();
  const [person, setPerson] = useState<Pick | null>(() => initialInputs?.person_image_url && initialInputs?.person_asset_id ? { url: String(initialInputs.person_image_url), name: "人物照片", public_id: String(initialInputs.person_asset_id) } : null);
  const [garment, setGarment] = useState<Pick | null>(() => initialInputs?.garment_image_url && initialInputs?.garment_asset_id ? { url: String(initialInputs.garment_image_url), name: "服装图片", public_id: String(initialInputs.garment_asset_id) } : null);
  const [uploading, setUploading] = useState<"person" | "garment" | "">("");
  const [category, setCategory] = useState(() => String(initialInputs?.garment_category || "auto"));
  const [photoType, setPhotoType] = useState(() => String(initialInputs?.garment_photo_type || "auto"));
  const [count, setCount] = useState(() => Number(initialInputs?.count || 1));
  const [imageSize, setImageSize] = useState(() => String(initialInputs?.image_size || "1K"));
  const [prompt, setPrompt] = useState(() => String(initialInputs?.prompt || ""));
  const [models, setModels] = useState<ModelItem[]>([]);
  const [model, setModel] = useState(() => String(initialInputs?.model_code || defaultModelCode || ""));
  const [consent, setConsent] = useState(() => initialInputs?.consent_confirmed === true);
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [libraryTarget, setLibraryTarget] = useState<"person" | "garment">("person");
  const [bottom, setBottom] = useState<BottomBarState>({ channel_key: "price_first", fallback_enabled: true, web_search: false, timeout_sec: 30, asset_ids: [], files: [] });

  useEffect(() => { apiCached<ModelItem[]>("/api/models?category=image").then((items) => { const list = (items || []).filter((item) => isTryOnModel(item, defaultModelCode)); setModels(list); setModel((old) => list.some((item) => item.code === old) ? old : list[0]?.code || defaultModelCode || ""); }).catch(() => setModels([])); }, [defaultModelCode]);

  const upload = async (kind: "person" | "garment", file?: File) => {
    if (!file || uploading) return;
    setUploading(kind); setLocalError("");
    try { const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: kind === "person" ? "role" : "prop" }); const pick = { url: asset.url, name: file.name, public_id: asset.public_id }; if (kind === "person") setPerson(pick); else setGarment(pick); }
    catch (err) { setLocalError(err instanceof Error ? err.message : ts("图片上传失败")); }
    finally { setUploading(""); }
  };

  const submit = async () => {
    if (submitting) return;
    if (!person || !garment) { setLocalError(ts("请先上传人物照片和服装图片")); return; }
    if (!model) { setLocalError(ts("当前没有可用的多参考图模型，请联系管理员配置")); return; }
    if (!consent) { setLocalError(ts("请确认人物照片已获得授权")); return; }
    setSubmitting(true); setLocalError("");
    try { await onSubmit({ person_image_url: person.url, person_asset_id: person.public_id, garment_image_url: garment.url, garment_asset_id: garment.public_id, garment_category: category, garment_photo_type: photoType, image_size: imageSize, aspect_ratio: "3:4", count, prompt: prompt.trim(), model_code: model, consent_confirmed: true, _mode: "auto" }); }
    finally { setSubmitting(false); }
  };

  const label = (items: { value: string; label: string }[], value: string) => items.find((item) => item.value === value)?.label || value;
  const libraryImages: ReferenceImagePick[] = libraryTarget === "person" ? (person ? [person] : []) : (garment ? [garment] : []);
  const selectFromLibrary = (images: ReferenceImagePick[]) => {
    const image = images[0];
    if (!image) {
      if (libraryTarget === "person") setPerson(null); else setGarment(null);
      return;
    }
    if (!image.public_id) {
      setLocalError(ts("请选择资产库中的个人图片资产"));
      return;
    }
    const pick = { url: image.url, name: image.name, public_id: image.public_id };
    if (libraryTarget === "person") setPerson(pick); else setGarment(pick);
    setLocalError("");
  };

  return (
    <div className="relative z-20 shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-5">
      <div className="mx-auto w-full max-w-[1040px]">
        {!!featureTags?.length && <div className="mb-1.5 flex flex-wrap justify-center gap-1.5">{featureTags.map((tag) => <span key={tag} className="rounded-full border border-rose-100 bg-white/70 px-2.5 py-0.5 text-[10px] text-rose-600 dark:border-rose-400/20 dark:bg-white/5 dark:text-rose-300">{ts(tag)}</span>)}</div>}
        {(error || localError) && <p className="mb-2 px-1 text-sm text-red-500">{localError || error}</p>}
        <div className="soft-input overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-50 px-3 py-2 dark:border-white/10">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ChatTopTools value={bottom} onChange={setBottom} showUpload={false} showRole={false} referencePickMode referenceAssetsOnly referenceImages={libraryImages} onReferenceImagesChange={selectFromLibrary} maxReferenceImages={1} assetLibraryLabel={ts("资产库")} />
              <MediaOptionMenu icon={<ImageIcon size={15} />} activeLabel={libraryTarget === "person" ? ts("引入人物") : ts("引入服装")} title={ts("资产库引入目标")} subtitle={ts("选择资产库图片要用于人物还是服装")} compactOnMobile>
                {(close) => <div className="space-y-2"><MediaMenuOption selected={libraryTarget === "person"} onClick={() => { setLibraryTarget("person"); close(); }}>{ts("人物照片")}</MediaMenuOption><MediaMenuOption selected={libraryTarget === "garment"} onClick={() => { setLibraryTarget("garment"); close(); }}>{ts("服装图片")}</MediaMenuOption></div>}
              </MediaOptionMenu>
              <MediaOptionMenu icon={<Shirt size={15} />} activeLabel={ts(label(CATEGORIES, category))} title={ts("服装类型")} subtitle={ts("指定本次要替换的服装区域")} compactOnMobile>
                {(close) => <div className="space-y-2">{CATEGORIES.map((item) => <MediaMenuOption key={item.value} selected={category === item.value} onClick={() => { setCategory(item.value); close(); }}>{ts(item.label)}</MediaMenuOption>)}</div>}
              </MediaOptionMenu>
              <MediaOptionMenu icon={<ImageIcon size={15} />} activeLabel={ts(label(PHOTO_TYPES, photoType))} title={ts("商品图类型")} subtitle={ts("平铺图和模特图使用不同识别方式")} compactOnMobile>
                {(close) => <div className="space-y-2">{PHOTO_TYPES.map((item) => <MediaMenuOption key={item.value} selected={photoType === item.value} onClick={() => { setPhotoType(item.value); close(); }}>{ts(item.label)}</MediaMenuOption>)}</div>}
              </MediaOptionMenu>
            </div>
            <button type="button" onClick={() => setGuideOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5 sm:px-2.5"><HelpCircle size={15} />{ts("玩法说明")}</button>
          </div>

          <div className="flex min-h-[132px] items-start gap-3 px-3 py-3">
            <ImagePick label={ts("人物照片")} value={person} uploading={uploading === "person"} onUpload={(file) => void upload("person", file)} onClear={() => setPerson(null)} />
            <ImagePick label={ts("服装图片")} value={garment} uploading={uploading === "garment"} onUpload={(file) => void upload("garment", file)} onClear={() => setGarment(null)} />
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder={ts("可选：补充穿着要求，例如外套敞开，保留原来的裤装")} className="min-h-[96px] min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-relaxed text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-100" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-50 px-3 py-3 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <MediaOptionMenu icon={<Sparkles size={15} />} activeLabel={models.find((item) => item.code === model)?.display_name || model || ts("模型")} title={ts("试衣模型")} subtitle={ts("仅显示支持多参考图的图片模型")} compactOnMobile menuWidth={300}>
                {(close) => <div className="space-y-2">{models.length === 0 ? <div className="px-2 py-3 text-center text-xs text-gray-400">{ts("暂无可用的试衣模型")}</div> : models.map((item) => <MediaMenuOption key={item.code} selected={model === item.code} onClick={() => { setModel(item.code); close(); }}>{item.display_name || item.code}</MediaMenuOption>)}</div>}
              </MediaOptionMenu>
              <MediaOptionMenu icon={<Camera size={15} />} activeLabel={imageSize} title={ts("清晰度")} subtitle={ts("更高分辨率会增加生成费用")} compactOnMobile>
                {(close) => <div className="space-y-2">{SIZES.map((item) => <MediaMenuOption key={item} selected={imageSize === item} onClick={() => { setImageSize(item); close(); }}>{item}</MediaMenuOption>)}</div>}
              </MediaOptionMenu>
              <MediaOptionMenu icon={<Layers size={15} />} activeLabel={t("{count}张", { count })} title={ts("生成张数")} subtitle={ts("每张结果单独调用并计费")} compactOnMobile>
                {(close) => <div className="space-y-2">{COUNTS.map((item) => <MediaMenuOption key={item} selected={count === item} onClick={() => { setCount(item); close(); }}>{t("{count} 张", { count: item })}</MediaMenuOption>)}</div>}
              </MediaOptionMenu>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-gray-500 dark:text-gray-300"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{ts("我确认人物照片为本人或已获得使用授权")}</label>
              <button type="button" disabled={!person || !garment || !model || !consent || submitting || uploading !== ""} onClick={() => void submit()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-white shadow-md transition hover:bg-secondary/90 disabled:opacity-40" title={ts("开始生成试衣图")}>{submitting ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={19} />}</button>
            </div>
          </div>
        </div>
      </div>
      <TryOnPlayGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}

export function VirtualTryOnResult({ workflowCode, workflowName, project, onNewTask, onLoadHistory }: { workflowCode: string; workflowName: string; project: Project; onNewTask: () => void; onLoadHistory?: (id: string) => void | Promise<void> }) {
  const { t, ts } = useI18n();
  const tasks = project.media_tasks?.length ? project.media_tasks : ((project.outputs?.media_tasks || []) as MediaTask[]);
  const requested = Number(project.inputs?.count || 1);
  const pendingSlots = ["pending", "running"].includes(project.status) ? Math.max(0, requested - tasks.length) : 0;
  const personURL = String(project.inputs?.person_image_url || "");
  const garmentURL = String(project.inputs?.garment_image_url || "");
  const statusText = project.status === "succeeded" ? ts("试穿完成") : project.status === "failed" ? ts("试穿失败") : ts("AI 正在生成试穿效果");
  const badgeText = project.status === "succeeded" ? ts("已完成") : project.status === "failed" ? ts("失败") : ts("生成中");
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden text-gray-900 dark:text-white">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pt-2 sm:px-5 lg:px-8"><PhotoStudioTopBar workflowCode={workflowCode} historyFallbackTitle={ts("试衣任务")} onNewTask={onNewTask} onLoadHistory={onLoadHistory} /></div>
        <div className="mx-auto w-full max-w-6xl px-4 py-6">
          <div className="mb-5 flex items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">{workflowName}</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{statusText}</p></div><span className="rounded-full border border-rose-200 px-3 py-1 text-xs text-rose-600 dark:border-rose-400/30 dark:text-rose-300">{badgeText}</span></div>
          {project.error_message && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{project.error_message}</div>}
          <div className="grid gap-5 lg:grid-cols-[180px_180px_1fr]">
            <div><h2 className="mb-2 text-sm font-semibold">{ts("人物原图")}</h2>{personURL && <img loading="lazy" decoding="async" src={personURL} alt={ts("人物原图")} className="aspect-[3/4] w-full rounded-2xl bg-white object-cover shadow-sm" />}</div>
            <div><h2 className="mb-2 text-sm font-semibold">{ts("服装原图")}</h2>{garmentURL && <img loading="lazy" decoding="async" src={garmentURL} alt={ts("服装原图")} className="aspect-[3/4] w-full rounded-2xl bg-white object-contain p-2 shadow-sm" />}</div>
            <div><h2 className="mb-2 text-sm font-semibold">{ts("试穿结果")}</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{tasks.map((task, index) => { const url = imageURL(task); if (task.status === "succeeded" && url) return <div key={task.task_no || index} className="group relative overflow-hidden rounded-2xl bg-white shadow-sm"><img loading="lazy" decoding="async" src={url} alt={t("试穿结果 {count}", { count: index + 1 })} className="aspect-[3/4] w-full object-cover" /><a href={url} target="_blank" rel="noreferrer" download className="absolute inset-x-2 bottom-2 hidden items-center justify-center gap-1 rounded-xl bg-black/60 py-1.5 text-xs text-white group-hover:flex"><Download size={13} />{ts("查看原图")}</a></div>; if (task.status === "failed") return <div key={task.task_no || index} className="flex aspect-[3/4] items-center justify-center rounded-2xl border border-red-100 bg-red-50 text-xs text-red-400">{ts("生成失败")}</div>; return <div key={task.task_no || index} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl bg-rose-100/70"><Loader2 size={20} className="animate-spin text-rose-400" /><span className="text-xs text-rose-500">{ts("生成中")}</span></div>; })}{Array.from({ length: pendingSlots }).map((_, index) => <div key={`pending-${index}`} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl bg-rose-100/70"><Loader2 size={20} className="animate-spin text-rose-400" /><span className="text-xs text-rose-500">{ts("等待生成")}</span></div>)}</div></div>
          </div>
          <p className="mt-5 text-xs text-gray-400">{ts("AI 试穿仅供视觉参考，不代表真实尺码、松紧度、面料垂感或实际穿着效果。")}</p>
        </div>
      </div>
    </div>
  );
}
