"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Loader2, CheckCircle2, AlertCircle, Square, ImagePlus, ArrowUp, SlidersHorizontal, FolderOpen, Check, ChevronDown, Eye, Download } from "lucide-react";
import { importAssetFromURL, uploadAsset } from "@/lib/api";
import type { Model } from "@starai/shared-types";
import { PhotoStudioTopBar } from "./PhotoStudioLanding";
import { ProductRegionEditor, type ProductRegion } from "./ProductRegionEditor";
import { useI18n } from "@/i18n/I18nProvider";
import { pollAsync } from "@/lib/pollAsync";
import { SystemAssetLibraryDialog, type SystemAssetPick } from "./SystemAssetLibraryDialog";

type Reference = { asset_id: string; url: string; role: "repair" | "product" | "pose" | "style"; edit_regions?: ProductRegion[] | null; protected_regions?: ProductRegion[] | null };
type ProductPreset = "auto_showcase" | "local_repair" | "wear" | "hold_use" | "background" | "detail" | "custom";
type Check = { id: string; description: string; reference: number; region: number[] };
type Attempt = { status: string; image_url?: string; mask_url?: string; issues?: string[]; localization?: { regions?: { id: string; region: number[]; description?: string }[] }; review?: { checks?: { id: string; status: string; reason: string }[] }; verification?: { checks?: { id: string; status: string; reason: string }[] } };
type Result = { title: string; status: string; image_url?: string; attempts: Attempt[] };
type Plan = { product_type?: string; interaction_mode?: string; summary?: string; keep?: string[]; change?: string[]; missing_information?: string[]; shots?: { title: string; prompt: string; source: number; edit_regions?: number[][]; protected_regions?: number[][]; checks: Check[] }[] };
type Project = { public_id: string; status: string; inputs: Record<string, any>; outputs: Record<string, any>; estimated_cost: number; actual_cost: number; error_message?: string | null };
type ProcessRecord = { id: string; stage?: string; status: string; message: string; detail?: string; created_at?: string; updated_at?: string };
type QualitySummary = { product_type?: string; interaction_mode?: string; product_preset?: string; generation_quality?: string; review_mode?: string; first_pass?: boolean; attempts?: number; repairs_used?: number; passed?: number; delivered?: number; strict_verifications?: number };
const MAX_PRODUCT_REFERENCES = 2;

const statusLabel: Record<string, string> = { pending: "等待制作", processing: "制作中", checking: "检查细节", awaiting_review: "已生成 · 待验收", accepted: "已确认 · 未验收", passed: "检查通过", failed: "细节未通过", uncertain: "需要人工检查", needs_review: "已生成 · 有检查提示" };
const field = "w-full rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100";
const selectField = "rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100 [color-scheme:light] dark:[color-scheme:dark]";
const productPresets: { code: ProductPreset; label: string; description: string }[] = [
  { code: "auto_showcase", label: "智能匹配", description: "识别商品和素材，自动选择展示方式" },
  { code: "local_repair", label: "局部问题修复", description: "圈选接缝、穿透、粘连、断裂或标记" },
  { code: "wear", label: "穿戴场景", description: "整图自然生成，严格核对商品身份后交付" },
  { code: "hold_use", label: "手持／使用场景", description: "整图自然生成，严格核对接触与商品细节" },
  { code: "background", label: "更换背景", description: "保持商品主体，调整场景与光影" },
  { code: "detail", label: "商品特写", description: "突出已有材质和工艺细节" },
];

function failureHelp(message: string) {
  if (/timeout|deadline exceeded|超时/i.test(message)) return "图片分析或生成服务响应超时。原图和要求已保留，无需重新上传；可稍后重试，或请管理员检查服务线路。";
  if (/文件上传失败/.test(message)) return "图片编辑线路未接收本次修正附件。原图已保留，无需重新上传；新版每次只提交商品底图和一张必要参考图。";
  if (/保护区域无效|验收项缺少|protected_regions|checks\[|策划.*格式|编辑区域无效/.test(message)) return "系统未能正确定位商品细节，无需手动填写坐标。可以保留原图和要求重新生成；新版会先自动纠正一次方案。";
  if (/模型|线路|upstream|adapter|API|接口/.test(message)) return "生成服务未完成请求。请联系管理员检查模型线路，暂时不用修改图片或描述。";
  if (/预算/.test(message)) return "本次额度已用完，已有图片会保留。可减少图片数量后重新生成。";
  return message;
}

function productModelRatios(model?: Model | null) {
  const properties = model?.input_schema?.properties as Record<string, { enum?: unknown[] }> | undefined;
  const configured = properties?.aspect_ratio?.enum;
  const ratios = Array.isArray(configured) ? configured.map(String).filter(value => value === "auto" || /^\d+:\d+$/.test(value)) : [];
  return Array.from(new Set(["auto", ...(ratios.length ? ratios : ["1:1"])]));
}

function productModelQualities(model?: Model | null) {
  const properties = model?.input_schema?.properties as Record<string, { enum?: unknown[] }> | undefined;
  const configured = properties?.quality?.enum;
  const allowed = new Set(["auto", "low", "medium", "high", "xhigh", "max"]);
  const qualities = Array.isArray(configured) ? configured.map(value => String(value).toLowerCase()).filter(value => allowed.has(value)) : [];
  return Array.from(new Set(qualities.length ? qualities : ["auto"]));
}

function defaultProductRatio(ratios: string[], model?: Model | null, preserveProduct = false) {
  if (preserveProduct && ratios.includes("auto")) return "auto";
  if (ratios.includes("1:1")) return "1:1";
  const configured = String(model?.default_params?.aspect_ratio || "");
  return ratios.includes(configured) ? configured : ratios[0] || "auto";
}

function defaultProductQuality(qualities: string[], model: Model | null | undefined, localRepair: boolean) {
  const configured = String(model?.default_params?.quality || "").toLowerCase();
  if (configured !== "auto" && qualities.includes(configured)) return configured;
  if (localRepair && qualities.includes("xhigh")) return "xhigh";
  if (qualities.includes("high")) return "high";
  if (qualities.includes(configured)) return configured;
  return qualities[0] || "auto";
}

const qualityLabels: Record<string, string> = { auto: "自动（由线路决定）", low: "低 · 快速预览", medium: "中", high: "高 · 商用默认", xhigh: "超高 · 精修默认", max: "最高 · 更慢且成本更高" };

async function downloadProductImage(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("图片下载失败");
  const objectURL = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectURL;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}

function ProcessIcon({ status }: { status: string }) {
  if (["passed", "succeeded"].includes(status)) return <CheckCircle2 size={17} className="text-emerald-500" />;
  if (["failed", "uncertain"].includes(status)) return <AlertCircle size={17} className="text-amber-500" />;
  if (["waiting", "awaiting_review"].includes(status)) return <Eye size={17} className="text-cyan-600 dark:text-cyan-300" />;
  return <Loader2 size={17} className="animate-spin text-cyan-500" />;
}

export function ProductRefineWorkspace({ workflowCode, workflowName, project, pricing, imageModel, defaultReviewMode = "standard", submitting, error, onSubmit, onNewTask, onLoadHistory, onStop, onReview, onRefresh }: {
  workflowCode: string; workflowName: string;
  project: Project | null; submitting: boolean; error: string;
  pricing?: { workflow_fee?: number; image_unit_fee?: number };
  imageModel?: Model | null;
  defaultReviewMode?: "standard" | "strict";
  onSubmit: (inputs: Record<string, any>) => Promise<void>;
  onNewTask: () => void; onLoadHistory: (id: string) => void | Promise<void>; onStop: () => void | Promise<void>;
  onReview: (action: "review" | "accept") => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const { t, ts } = useI18n();
  const [refs, setRefs] = useState<Reference[]>(project?.inputs.product_references || []);
  const [prompt, setPrompt] = useState(project?.inputs.prompt || "");
  const [productPreset, setProductPreset] = useState<ProductPreset>((project?.inputs.product_preset as ProductPreset) || "auto_showcase");
  const [deliverables, setDeliverables] = useState(project?.inputs.deliverables || "");
  const [count, setCount] = useState(Number(project?.inputs.count || 1));
  const [reviewMode, setReviewMode] = useState<"standard" | "strict">(project?.inputs.review_mode === "strict" || !project && defaultReviewMode === "strict" ? "strict" : "standard");
  const ratios = useMemo(() => productModelRatios(imageModel), [imageModel]);
  const qualities = useMemo(() => productModelQualities(imageModel), [imageModel]);
  const [aspectRatio, setAspectRatio] = useState(String(project?.inputs.aspect_ratio || (productPreset === "local_repair" ? "auto" : defaultProductRatio(ratios, imageModel, productPreset === "wear" || productPreset === "hold_use"))));
  const [aspectRatioTouched, setAspectRatioTouched] = useState(!!project?.inputs.aspect_ratio);
  const [quality, setQuality] = useState(String(project?.inputs.quality || defaultProductQuality(qualities, imageModel, productPreset === "local_repair")));
  const [qualityTouched, setQualityTouched] = useState(false);
  const workflowFee = Number(pricing?.workflow_fee || 0);
  const imageUnitFee = Number(pricing?.image_unit_fee || 0);
  const estimatedFee = workflowFee + count * imageUnitFee;
  const [advanced, setAdvanced] = useState(false);
  const [showRegions, setShowRegions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  const [selected, setSelected] = useState(0);
  const [version, setVersion] = useState(-1);
  const [regionReference, setRegionReference] = useState(-1);
  const [processOpen, setProcessOpen] = useState(() => !((project?.outputs.product_results || []) as Result[]).some(item => item.image_url || item.attempts?.some(entry => entry.image_url)));
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(!project);
  const [previewURL, setPreviewURL] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [reviewAction, setReviewAction] = useState<"review" | "accept" | "">("");
  const refreshRef = useRef(onRefresh);
  const localRepair = productPreset === "local_repair";
  const sceneGeneration = productPreset === "wear" || productPreset === "hold_use" || refs.some(ref => ref.role === "pose");
  const busy = submitting || uploading || reviewAction !== "" || !!project && ["pending", "running", "canceling"].includes(project.status);
  const projectID = project?.public_id;
  const plan = project?.outputs.product_plan as Plan | undefined;
  const results = (project?.outputs.product_results || []) as Result[];
  const generatedCount = results.filter(item => item.image_url || item.attempts?.some(entry => entry.image_url)).length;
  const hasGeneratedImage = generatedCount > 0;
  const awaitingReview = project?.status === "waiting_confirm" && project.outputs.current_step === "product_review_confirm" && hasGeneratedImage;
  const reviewSkipped = Boolean(project?.outputs.product_review_skipped);
  const autoCompleted = Boolean(project?.outputs.product_auto_completed);
  const reviewDeadlineAt = String(project?.outputs.review_deadline_at || "");
  const reviewDeadline = new Date(reviewDeadlineAt);
  const reviewDeadlineLabel = Number.isNaN(reviewDeadline.getTime()) ? "约2小时后" : reviewDeadline.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const result = results[selected];
  const shot = plan?.shots?.[selected];
  const attempt = result?.attempts?.[version < 0 ? result.attempts.length - 1 : version];
  const imageReady = Boolean(attempt?.image_url);
  const waitingForReview = attempt?.status === "awaiting_review";
  const acceptedWithoutReview = attempt?.status === "accepted";
  const sourceRefs = (project?.inputs.product_references || refs) as Reference[];
  const original = sourceRefs[(shot?.source || 1) - 1]?.url;
  const storedProcess = (project?.outputs.product_process_log || []) as ProcessRecord[];
  const qualitySummary = project?.outputs.product_quality_summary as QualitySummary | undefined;
  const processRecords: ProcessRecord[] = storedProcess.length ? storedProcess : project ? [
    { id: "legacy_plan", stage: "planning", status: plan ? project.error_message?.includes("策划") ? "failed" : "passed" : busy ? "running" : "failed", message: plan ? "商品分析方案已返回" : "正在分析商品与交付要求", detail: project.error_message?.includes("策划") ? project.error_message : undefined },
    ...results.flatMap((item, index) => item.attempts?.length ? item.attempts.flatMap((entry, attemptIndex) => [
      { id: `legacy_generate_${index}_${attemptIndex}`, stage: "product_edit", status: entry.image_url ? "passed" : entry.status, message: `第${index + 1}张${attemptIndex ? `第${attemptIndex}次修正` : "候选图"}${entry.image_url ? "已生成" : "未完成"}`, detail: entry.issues?.join("；") },
      ...(entry.review ? [{ id: `legacy_review_${index}_${attemptIndex}`, stage: "product_review", status: entry.status, message: `第${index + 1}张细节验收${entry.status === "passed" ? "通过" : "未通过"}`, detail: entry.issues?.join("；") }] : [])
    ]) : []),
    ...(project.error_message ? [{ id: "legacy_result", stage: "result", status: "failed", message: "流程未完成", detail: project.error_message }] : [])
  ] : [];

  useEffect(() => {
    if (!projectID) return;
    setProcessOpen(!hasGeneratedImage);
  }, [hasGeneratedImage, projectID]);

  useEffect(() => {
    setMobileSettingsOpen(!projectID);
  }, [projectID]);

  useEffect(() => {
    if (localRepair && aspectRatio !== "auto") setAspectRatio("auto");
    else if (sceneGeneration && !aspectRatioTouched && ratios.includes("auto") && aspectRatio !== "auto") setAspectRatio("auto");
    else if (!localRepair && !ratios.includes(aspectRatio)) setAspectRatio(defaultProductRatio(ratios, imageModel, productPreset === "wear" || productPreset === "hold_use"));
  }, [aspectRatio, aspectRatioTouched, imageModel, localRepair, productPreset, ratios, sceneGeneration]);

  useEffect(() => {
    if (!qualities.includes(quality) || !project?.inputs.quality && !qualityTouched && imageModel) setQuality(defaultProductQuality(qualities, imageModel, localRepair));
  }, [imageModel, localRepair, project?.inputs.quality, qualities, quality, qualityTouched]);

  useEffect(() => {
    if (!localRepair || regionReference >= 0) return;
    const repairIndex = refs.findIndex(ref => ref.role === "repair");
    if (repairIndex >= 0) setRegionReference(repairIndex);
  }, [localRepair, refs, regionReference]);

  useEffect(() => {
    if (!previewURL) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPreviewURL(""); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [previewURL]);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const deadlineTime = new Date(reviewDeadlineAt).getTime();
    if (!awaitingReview || Number.isNaN(deadlineTime)) return;
    let stopPolling: (() => void) | undefined;
    const refreshAfterDeadline = () => {
      stopPolling = pollAsync(async () => refreshRef.current(), 15_000, true);
    };
    const refreshTimer = setTimeout(refreshAfterDeadline, Math.max(0, deadlineTime - Date.now()));
    return () => {
      clearTimeout(refreshTimer);
      stopPolling?.();
    };
  }, [awaitingReview, reviewDeadlineAt]);

  async function downloadCurrentImage(url: string) {
    setLocalError(""); setDownloading(true);
    try {
      const attemptIndex = version < 0 ? Math.max(0, (result?.attempts?.length || 1) - 1) : version;
      await downloadProductImage(url, `商品精修-${project?.public_id || "result"}-${selected + 1}-v${attemptIndex + 1}.png`);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "图片下载失败，请稍后重试");
    } finally { setDownloading(false); }
  }

  async function decideReview(action: "review" | "accept") {
    setLocalError("");
    setReviewAction(action);
    try {
      await onReview(action);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "操作失败，请稍后重试");
    } finally {
      setReviewAction("");
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setLocalError(""); setUploading(true);
    try {
      const chosen = Array.from(files);
      if (chosen.length + refs.length > MAX_PRODUCT_REFERENCES) throw new Error("最多上传2张：一张商品图和一张可选参考图");
      for (const file of chosen) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("请上传不超过10MB的JPG、PNG或WEBP图片");
        const asset = await uploadAsset(file, { name: file.name, kind: "image", asset_type: "prop" });
        setRefs(current => {
          const role: Reference["role"] = localRepair ? current.some(ref => ref.role === "repair") ? "product" : "repair" : current.some(ref => ref.role === "product") ? "pose" : "product";
          return [...current, { asset_id: asset.public_id, url: asset.url, role }];
        });
      }
    } catch (e) { setLocalError(e instanceof Error ? e.message : "上传失败"); }
    finally { setUploading(false); }
  }

  function openLibrary() {
    if (busy || refs.length >= MAX_PRODUCT_REFERENCES) return;
    setLocalError(""); setLibraryOpen(true);
  }

  function importLibraryAssets(items: SystemAssetPick[]) {
	setRefs(current => {
	  let hasProduct = current.some(ref => ref.role === "product");
	  let hasRepair = current.some(ref => ref.role === "repair");
	  const additions = items.filter((item): item is SystemAssetPick & { public_id: string } => !!item.public_id && !current.some(ref => ref.asset_id === item.public_id)).map(item => {
		const role: Reference["role"] = localRepair ? hasRepair ? "product" : "repair" : hasProduct ? "pose" : "product";
		if (role === "repair") hasRepair = true;
		if (role === "product") hasProduct = true;
		return { asset_id: item.public_id, url: item.url, role };
	  });
	  return [...current, ...additions].slice(0, MAX_PRODUCT_REFERENCES);
	});
	setLibraryOpen(false);
  }

  function selectProductPreset(nextPreset: ProductPreset) {
    setProductPreset(nextPreset);
    if (nextPreset === "local_repair") {
      setCount(1); setAspectRatio("auto"); setAspectRatioTouched(false);
      setQuality(defaultProductQuality(qualities, imageModel, true));
      setQualityTouched(false);
    } else {
      setRegionReference(-1);
      if (!aspectRatioTouched) setAspectRatio(defaultProductRatio(ratios, imageModel, nextPreset === "wear" || nextPreset === "hold_use"));
      setQuality(defaultProductQuality(qualities, imageModel, false));
      setQualityTouched(false);
    }
    setRefs(current => {
      if (nextPreset === "local_repair") {
        if (current.some(ref => ref.role === "repair")) return current;
        const first = current.findIndex(ref => ref.role === "product");
        if (first < 0) return current;
        return current.map((ref, index) => index === first ? { ...ref, role: "repair", protected_regions: [] } : ref);
      }
      return current.map(ref => ref.role === "repair" ? { ...ref, role: "product" } : ref);
    });
  }

  async function submit(deliverablesOverride?: string, countOverride?: number, refsOverride?: Reference[], presetOverride?: ProductPreset) {
    setLocalError("");
    const submittedRefs = refsOverride ?? refs;
    const submittedPreset = presetOverride ?? productPreset;
    const submittedLocalRepair = submittedPreset === "local_repair";
    if (submittedLocalRepair) {
      const repair = submittedRefs.find(ref => ref.role === "repair");
      if (!repair) { setLocalError("请上传一张待修图片"); return; }
      if (!repair.edit_regions?.length) { setLocalError("请在待修图片上拖动框选至少一个问题区域"); return; }
    } else if (!submittedRefs.some(r => r.role === "product")) { setLocalError("请上传至少一张商品原图"); return; }
    if (!(estimatedFee > 0)) { setLocalError("预计费用尚未加载，请刷新页面后重试"); return; }
    const submittedAspectRatio = submittedLocalRepair ? "auto" : sceneGeneration && !aspectRatioTouched ? "auto" : aspectRatio;
    await onSubmit({ prompt: prompt.trim(), product_preset: submittedPreset, deliverables: (deliverablesOverride ?? deliverables).trim(), product_references: submittedRefs, count: countOverride ?? count, max_repairs: 0, review_mode: reviewMode, aspect_ratio: submittedAspectRatio, quality });
    setSelected(0); setVersion(-1);
  }

  async function repairCurrentImage() {
    if (!attempt?.image_url) return;
    setLocalError(""); setUploading(true);
    try {
      const imported = await importAssetFromURL(attempt.image_url, `商品精修-${project?.public_id || "result"}-${selected + 1}-待修图`);
      const localized = (attempt.localization?.regions || []).map(item => item.region).filter((region): region is ProductRegion => region.length === 4 && region.every(Number.isFinite));
      const planned = (shot?.edit_regions || []).filter((region): region is ProductRegion => region.length === 4 && region.every(Number.isFinite));
      const editRegions = localized.length ? localized : planned.length ? planned : [[0, 0, 1, 1] as ProductRegion];
      const originalProduct = sourceRefs.find(ref => ref.role === "product");
      const repairRefs: Reference[] = [{ asset_id: imported.public_id, url: imported.url, role: "repair", edit_regions: editRegions, protected_regions: [] }];
      if (originalProduct?.asset_id) repairRefs.push({ ...originalProduct, role: "product", edit_regions: null, protected_regions: null });
      const request = `仅修改当前成品：${shot?.title || result.title}。保留当前构图、人物、商品位置和已经正确的细节，只修正检查提示。\n检查提示：${attempt.issues?.join("；") || "优化当前图片中不自然的局部细节"}`;
      setCount(1); setDeliverables(request);
      await submit(request, 1, repairRefs, "local_repair");
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "当前成品转为待修图片失败，请稍后重试");
    } finally { setUploading(false); }
  }

  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#eaf7fb] text-gray-900 dark:bg-[#05080f] dark:text-white">
    <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)]" />
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(34,211,238,.22),transparent_28%),radial-gradient(circle_at_12%_84%,rgba(20,184,166,.16),transparent_22%)] dark:bg-[radial-gradient(circle_at_76%_10%,rgba(20,184,166,.2),transparent_28%),radial-gradient(circle_at_14%_82%,rgba(6,182,212,.12),transparent_22%)]" />
    <div className="relative z-20 shrink-0 px-4 pb-3 pt-5 sm:px-6 lg:px-8 lg:pt-6"><PhotoStudioTopBar workflowCode={workflowCode} historyFallbackTitle={workflowName} onNewTask={onNewTask} onLoadHistory={onLoadHistory} /></div>
    <div className="relative grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 pb-5 pt-3 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-7 lg:overflow-hidden lg:px-8 lg:pb-7 xl:grid-cols-[350px_minmax(0,1fr)]">
      {project && <button type="button" aria-expanded={mobileSettingsOpen} onClick={() => setMobileSettingsOpen(open => !open)} className="flex items-center justify-center gap-2 rounded-xl border border-white/80 bg-white/90 px-4 py-3 text-sm font-medium text-gray-700 shadow-sm lg:hidden dark:border-white/10 dark:bg-gray-900/90 dark:text-gray-200"><SlidersHorizontal size={16} />{mobileSettingsOpen ? t("收起参数设置") : t("展开参数设置")}<ChevronDown size={16} className={`transition-transform ${mobileSettingsOpen ? "rotate-180" : ""}`} /></button>}
      <aside className={`${project && !mobileSettingsOpen ? "hidden lg:block" : ""} space-y-5 self-start rounded-3xl border border-white/80 bg-white/95 p-5 shadow-sm lg:max-h-full lg:overflow-y-auto lg:p-6 dark:border-white/10 dark:bg-gray-900/95`}>
        <div><h1 className="text-lg font-semibold">{workflowName}</h1><p className="mt-1.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{ts("上传原图，说出想改的地方。")}</p></div>
        <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
          <section><h2 className="mb-3 text-sm font-semibold">{localRepair ? t("待修图片与商品参考") : t("商品图与可选参考图")}</h2>
            <div className="grid grid-cols-2 gap-2">{refs.map((ref, index) => <div key={`${ref.asset_id}:${index}`} className="relative rounded-lg border border-gray-200 p-1.5 dark:border-white/10">
              <img loading="lazy" decoding="async" src={ref.url} alt={`参考图${index + 1}`} className="h-24 w-full object-contain" />
              <button type="button" aria-label={`移除参考图${index + 1}`} className="absolute right-1 top-1 rounded bg-white/90 p-1 text-gray-700" onClick={() => setRefs(refs.filter((_, i) => i !== index))}><X size={13} /></button>
              <label className="mt-1 block text-xs">{ts("图")}{index + 1}{ts("用途")}<select aria-label={`图${index + 1}用途`} value={ref.role} onChange={e => { const role=e.target.value as Reference["role"]; setRefs(refs.map((r, i) => i === index ? { ...r, role, ...(role === "repair" ? { protected_regions: [] } : {}) } : role === "repair" && r.role === "repair" ? { ...r, role: "product" } : r)); if (role === "repair") setRegionReference(index); }} className={`${selectField} mt-1 w-full px-2 py-1.5`}>{localRepair && <option value="repair">{ts("待修图片")}</option>}<option value="product">{ts("商品结构参考")}</option>{!localRepair && <option value="pose">{ts("人物／姿态")}</option>}<option value="style">{ts("背景／风格")}</option></select></label>
              {(ref.role === "product" || ref.role === "repair") && <button type="button" onClick={() => setRegionReference(regionReference===index ? -1 : index)} className="mt-2 text-xs font-medium text-cyan-700 dark:text-cyan-300">{regionReference === index ? t("收起区域定位") : ref.edit_regions?.length || ref.protected_regions?.length ? t("调整已定位区域") : ref.role === "repair" ? t("圈选问题区域（必填）") : t("手动定位区域（可选）")}</button>}
            </div>)}</div>
            {["product","repair"].includes(refs[regionReference]?.role || "") && <ProductRegionEditor key={`${refs[regionReference].asset_id}:${refs[regionReference].role}`} url={refs[regionReference].url} edit={refs[regionReference].edit_regions} protectedAreas={refs[regionReference].protected_regions} repairOnly={refs[regionReference].role === "repair"} onChange={(edit_regions,protected_regions) => setRefs(current => current.map((r,i) => i===regionReference ? {...r,edit_regions,protected_regions} : r))} />}
            {!!refs.length && <p className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">{localRepair ? t("待修图片必须圈选问题区域。请把缺陷及其红圈、箭头等标注一起框住，并保留少量周边用于衔接；相距较远的问题请分开圈选。圈外内容和原图尺寸保持不变。") : t("未手动框选时，系统会自动定位重点核对区域和局部修改区域。上脚／换场景不会把矩形区域贴回成片。")}</p>}
            <div className="mt-2 grid grid-cols-2 gap-2"><label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 p-3 text-xs ${busy || refs.length >= MAX_PRODUCT_REFERENCES ? "pointer-events-none opacity-50" : "hover:border-orange-400"}`}>
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}{ts("本地上传")}
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy || refs.length >= MAX_PRODUCT_REFERENCES} className="sr-only" onChange={e => { void upload(e.target.files); e.target.value = ""; }} />
            </label><button type="button" disabled={busy || refs.length >= MAX_PRODUCT_REFERENCES} onClick={openLibrary} className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 p-3 text-xs hover:border-cyan-400 disabled:opacity-50 dark:border-white/10"><FolderOpen size={16} />{ts("资产库导入")}</button></div><p className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">{ts("最多2张 ·")} {localRepair ? t("第一张默认为待修图片，第二张可补充商品结构参考。") : t("第1张是商品图；第2张可选，用于人物姿态或背景风格，不会替代商品本身。")}{ts("本地图片每张不超过10MB。")}</p>
          </section>
          <section><div className="flex items-end justify-between gap-3"><div><h3 className="text-sm font-semibold">{ts("展示方式")}</h3><p className="mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400">{ts("系统会识别商品品类并自动补齐结构、交互和验收规则")}</p></div></div><div className="mt-2 grid grid-cols-2 gap-2">{productPresets.map(item => <button key={item.code} type="button" aria-pressed={productPreset === item.code} onClick={() => selectProductPreset(item.code)} className={`rounded-xl border px-3 py-2.5 text-left transition ${productPreset === item.code ? "border-cyan-400 bg-cyan-50 text-cyan-900 ring-1 ring-cyan-200 dark:bg-cyan-400/10 dark:text-cyan-100" : "border-gray-200 bg-white/70 text-gray-600 hover:border-cyan-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"}`}><span className="block text-xs font-semibold">{ts(item.label)}</span><span className="mt-1 block text-[10px] leading-4 opacity-70">{ts(item.description)}</span></button>)}</div></section>
          <label className="block text-sm font-semibold">{localRepair ? t("修复要求") : t("补充你的要求")} <span className="font-normal text-gray-400">{ts("（可选）")}</span><textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} maxLength={4000} className={`${field} mt-2 resize-y font-normal leading-6`} placeholder={localRepair ? t("例如：移除红圈；修复提手与衣服之间的穿透和粘连；保留提手纹理、衣服车线、人物手指及原有光影。") : t("只写你特别在意的内容，例如：保持鞋子后视角，增加穿鞋小腿，穿黑色长裤。未说明的细节由商品规则自动补全。")} /><span className="mt-1 block text-[11px] leading-5 text-gray-500 dark:text-gray-400">{localRepair ? t("写清勾选区要修复的问题、期待结果和必须保留的细节。") : t("你的明确要求优先于预设；预设只补充没有说明的部分。")}</span></label>
          {localRepair ? <div className="flex items-center justify-between gap-3 text-sm"><span>{ts("输出数量")}</span><span className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-300">{ts("1张 · 保持原尺寸")}</span></div> : <label className="flex items-center justify-between gap-3 text-sm">{ts("生成数量")}<select className={`${selectField} w-24`} value={count} onChange={e => setCount(Number(e.target.value))}>{[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}{ts("张")}</option>)}</select></label>}
          <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"><SlidersHorizontal size={14} />{advanced ? t("收起高级设置") : t("高级设置（可选）")}</button>
          {advanced && <div className="space-y-4 border-t border-gray-100 pt-4 dark:border-white/10">
          <div className="rounded-xl bg-gray-50 px-3 py-2 text-[11px] leading-5 text-gray-500 dark:bg-white/5 dark:text-gray-400">{ts("当前图片模型：")}{imageModel?.display_name || imageModel?.code || "后台配置模型"}{ts("。切换后台模型后，比例和生成质量会按新模型能力自动更新。")}</div>
          <div><label className="block text-xs font-semibold">{ts("图片比例")}<select disabled={localRepair} className={`${selectField} mt-1 w-full disabled:opacity-60`} value={localRepair ? "auto" : aspectRatio} onChange={e => { setAspectRatio(e.target.value); setAspectRatioTouched(true); }}>{ratios.map(ratio => <option key={ratio} value={ratio}>{ratio === "auto" ? t("自动（跟随原图）") : ratio}</option>)}</select></label><p className="mt-1 text-[11px] leading-5 text-gray-400">{localRepair ? t("局部修复固定保留待修图片的尺寸和比例") : sceneGeneration ? t("穿戴、手持或姿态参考默认跟随商品原图比例；如需固定版式，可在这里手动选择。") : <>{ts("选项来自后台图片模型")}{imageModel?.display_name ? `「${imageModel.display_name}」` : t("配置")}</>}</p></div>
          <div><label className="block text-xs font-semibold">{ts("生成质量")}<select className={`${selectField} mt-1 w-full`} value={quality} onChange={e => { setQuality(e.target.value); setQualityTouched(true); }}>{qualities.map(item => <option key={item} value={item}>{ts(qualityLabels[item] || item)}</option>)}</select></label><p className="mt-1 text-[11px] leading-5 text-gray-400">{ts("选项跟随当前图片模型能力；默认值会结合模型配置与当前修复模式自动选择。")}</p></div>
          {!localRepair && <label className="block text-sm font-semibold">{ts("逐张交付要求")}<textarea value={deliverables} onChange={e => setDeliverables(e.target.value)} rows={3} maxLength={4000} className={`${field} mt-2 font-normal`} placeholder={t("可选：第1张后视角上脚；第2张后跟特写。")} /></label>}
          <label className="block text-xs">{ts("验收强度")}<select className={`${selectField} mt-1 w-full`} value={reviewMode} onChange={e => setReviewMode(e.target.value === "strict" ? "strict" : "standard")}><option value="standard">{ts("标准 · 动态定位后验收")}</option><option value="strict">{ts("严格 · 增加独立复核")}</option></select><span className="mt-1 block text-[11px] leading-5 text-gray-400">{ts("严格模式更慢，但能减少单次视觉模型误判。")}</span></label>
          {refs.some(r => r.edit_regions?.length || r.protected_regions?.length) && <button type="button" className="text-xs text-cyan-700 dark:text-cyan-300" onClick={() => { setRefs(current => current.map(ref => ({ ...ref, edit_regions: [], protected_regions: [] }))); setRegionReference(localRepair ? refs.findIndex(ref => ref.role === "repair") : -1); }}>{localRepair ? t("清除全部问题区域") : t("清除手动框选，恢复自动识别")}</button>}
          </div>}
        </fieldset>
        {(localError || error) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{localError || error}</p>}
        <footer className="space-y-3 border-t border-gray-100 pt-5 dark:border-white/10">
          <div className="min-w-0"><p className="text-sm font-medium">{busy ? t("正在处理，请稍候") : estimatedFee > 0 ? `本次预计费用 ¥${estimatedFee.toFixed(2)}` : t("正在读取预计费用")}</p><p className="mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400">{busy ? t("完成后会自动显示结果") : estimatedFee > 0 ? `工作流 ¥${workflowFee.toFixed(2)} + ${count}张 × 图片单价 ¥${imageUnitFee.toFixed(2)}；实际费用不超过本次预计费用。` : t("费用由后台工作流收费与图片模型单价计算。")}</p></div>
          {project && ["pending","running"].includes(project.status) ? <button type="button" onClick={() => void onStop()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm dark:border-white/10"><Square size={13} />{ts("停止生成")}</button> : awaitingReview ? <p className="rounded-xl bg-cyan-50 px-4 py-3 text-center text-xs leading-5 text-cyan-800 dark:bg-cyan-400/10 dark:text-cyan-200">{ts("图片制作已暂停；")}{reviewDeadlineLabel}{ts("前未操作将自动完成。")}</p> : <button type="button" disabled={busy} onClick={() => void submit()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-dark shadow-sm transition hover:brightness-95 disabled:opacity-50">{busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}{project ? t("重新分析并生成") : t("开始生成")}</button>}
        </footer>
      </aside>
      <main className={`min-w-0 lg:min-h-0 lg:flex-col ${project ? "block lg:flex" : "hidden lg:flex"}`}>
        <div className="min-h-0 flex-1 space-y-5 rounded-3xl border border-white/70 bg-white/70 p-5 shadow-sm sm:p-7 lg:overflow-y-auto dark:border-white/10 dark:bg-gray-900/65">
        {!project ? <div className="mx-auto flex min-h-[320px] max-w-lg flex-col items-center justify-center py-12 text-center lg:min-h-full"><div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-cyan-600 shadow-sm dark:bg-white/5 dark:text-cyan-300"><ImagePlus size={28} strokeWidth={1.5} /></div><h2 className="text-2xl font-semibold">{ts("商品细节，留在原图里")}</h2><p className="mt-3 text-sm leading-7 text-gray-500 dark:text-gray-400">{ts("上传商品，描述想要的画面。")}<br />{ts("自动识别细节、制作并检查，无需手动框选。")}</p><div className="mt-8 flex flex-wrap justify-center gap-3 text-xs text-gray-500 dark:text-gray-400"><span>{ts("1 上传商品")}</span><span>→</span><span>{ts("2 描述要求")}</span><span>→</span><span>{ts("3 查看成片")}</span></div></div> : <>
          <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{project.status === "succeeded" ? t("精修结果") : project.status === "failed" ? t("本次生成未完成") : awaitingReview ? t("图片已生成，等待你的决定") : busy ? t("正在制作你的商品图") : t("本次精修")}</h2><p className="mt-2 text-xs text-gray-500">{project.status === "succeeded" ? project.outputs.product_auto_completed ? t("等待期结束，已按当前图片自动完成；未运行验收与复核") : project.outputs.quality_status === "needs_review" ? t("图片已生成；检查提示供参考，不满意可手动修改") : t("图片已生成，可查看、下载并对照原图复核") : project.status === "failed" ? t("本次未完成交付，请查看具体问题") : project.status === "canceled" ? t("已停止，当前任务不会继续生成") : project.status === "canceling" ? t("正在停止") : awaitingReview ? t("自动验收与复核已暂停，不会继续调用验收模型") : t("制作与验收进行中")}</p></div><span className="text-xs text-gray-500">{["succeeded","failed","canceled"].includes(project.status) ? `实际 ¥${Number(project.actual_cost).toFixed(2)}` : `预算 ¥${Number(project.estimated_cost).toFixed(2)}`}</span></header>
          {project.error_message && <div role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><div className="flex gap-2"><AlertCircle size={18} className="mt-1 shrink-0" />{failureHelp(project.error_message)}</div><details className="mt-2 text-xs"><summary className="cursor-pointer">{ts("查看错误详情")}</summary><p className="mt-2 break-words">{project.error_message}</p></details></div>}
          {awaitingReview && <section className="rounded-2xl border border-cyan-200 bg-cyan-50/90 p-4 dark:border-cyan-400/20 dark:bg-cyan-400/10"><div className="flex gap-3"><div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-cyan-700 shadow-sm dark:bg-white/10 dark:text-cyan-200"><Eye size={18} /></div><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{ts("先看成品，再决定是否验收")}</h3><p className="mt-1 text-xs leading-5 text-cyan-900/70 dark:text-cyan-100/70">{generatedCount}  {ts("张首版图片已全部生成。点击“验收与复核”才会继续检查；如果当前效果满意，可直接完成。")}{reviewDeadlineLabel}{ts("前没有选择时，系统将按当前成品自动完成，不产生验收调用。")}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={reviewAction !== ""} onClick={() => void decideReview("review")} className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-700 disabled:opacity-50">{reviewAction === "review" ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}{ts("验收与复核")}</button><button type="button" disabled={reviewAction !== ""} onClick={() => void decideReview("accept")} className="inline-flex items-center gap-2 rounded-xl border border-cyan-300 bg-white px-4 py-2.5 text-sm font-medium text-cyan-800 hover:border-cyan-400 disabled:opacity-50 dark:border-cyan-400/30 dark:bg-white/5 dark:text-cyan-100">{reviewAction === "accept" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{ts("满意，完成任务")}</button></div></div></div></section>}
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white/70 dark:border-white/10 dark:bg-white/5"><button type="button" aria-expanded={processOpen} onClick={() => setProcessOpen(open => !open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"><span><span className="text-sm font-semibold">{ts("制作与验收记录")}</span><span className="ml-2 text-xs text-gray-400">{processRecords.length}  {ts("条")}</span></span><ChevronDown size={17} className={`shrink-0 text-gray-400 transition-transform ${processOpen ? "rotate-180" : ""}`} /></button>{processOpen && <ol className="border-t border-gray-100 px-4 py-2 dark:border-white/10">{processRecords.map((record, index) => <li key={record.id || index} className="flex gap-3 border-b border-gray-100 py-3 last:border-0 dark:border-white/10"><span className="mt-0.5 shrink-0"><ProcessIcon status={record.status} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{record.message}</p>{record.created_at && <time className="text-[10px] text-gray-400">{new Date(record.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>}</div>{record.detail && <p className="mt-1 break-words text-xs leading-5 text-gray-500 dark:text-gray-400">{failureHelp(record.detail)}</p>}</div></li>)}</ol>}</section>
          {qualitySummary && <section className="flex flex-wrap gap-2 text-[11px] text-gray-600 dark:text-gray-300"><span className="rounded-full bg-white/80 px-3 py-1.5 dark:bg-white/10">{ts("品类")} {ts(String(qualitySummary.product_type || "识别中"))}</span><span className="rounded-full bg-white/80 px-3 py-1.5 dark:bg-white/10">{ts("交互")} {ts(String(qualitySummary.interaction_mode || "无"))}</span><span className="rounded-full bg-white/80 px-3 py-1.5 dark:bg-white/10">{ts("预设")} {ts(productPresets.find(item => item.code === qualitySummary.product_preset)?.label || "智能匹配")}</span><span className="rounded-full bg-white/80 px-3 py-1.5 dark:bg-white/10">{ts("质量")} {ts(qualityLabels[qualitySummary.generation_quality || ""] || qualitySummary.generation_quality || "默认")}</span>{reviewSkipped ? <span className="rounded-full bg-white/80 px-3 py-1.5 dark:bg-white/10">{autoCompleted ? t("到期自动完成 · 未验收") : t("用户已跳过验收")}</span> : <><span className="rounded-full bg-white/80 px-3 py-1.5 dark:bg-white/10">{qualitySummary.review_mode === "strict" ? t("严格验收") : t("标准验收")}</span><span className="rounded-full bg-white/80 px-3 py-1.5 dark:bg-white/10">{ts("通过")} {qualitySummary.passed || 0}/{qualitySummary.delivered || results.length}</span></>}<span className="rounded-full bg-white/80 px-3 py-1.5 dark:bg-white/10">{ts("修正")} {qualitySummary.repairs_used || 0}  {ts("次")}</span></section>}
          {plan && <details className="rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5"><summary className="cursor-pointer text-xs font-medium">{ts("查看自动识别的保留项与修改项")}</summary><p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">{plan.summary}</p><section className="mt-4 grid gap-4 sm:grid-cols-2"><div><h3 className="text-xs font-semibold">{ts("必须保留")}</h3><ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">{plan.keep?.map((s,i) => <li key={i}>{s}</li>)}</ul></div><div><h3 className="text-xs font-semibold">{ts("允许改变")}</h3><ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">{plan.change?.map((s,i) => <li key={i}>{s}</li>)}</ul></div>{!!plan.missing_information?.length && <p className="text-sm text-amber-700 sm:col-span-2">{ts("需要补充：")}{plan.missing_information.join("；")}</p>}</section></details>}
          <nav aria-label={t("逐张交付")} className="flex flex-wrap gap-2">{results.map((r,i) => <button type="button" key={i} onClick={() => { setSelected(i); setVersion(-1); }} className={`rounded-lg border px-3 py-2 text-left text-xs ${selected===i ? "border-primary bg-primary/10 text-teal-800 dark:text-primary" : "border-gray-200 dark:border-white/10"}`}><span className="block font-medium">{i+1}. {r.title}</span><span className="mt-1 block opacity-70">{r.status === "uncertain" && !r.image_url ? t("生成未完成") : ts(statusLabel[r.status] || r.status)}</span></button>)}</nav>
          {result && <section className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">
            <figure><figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500"><span>{project.inputs.product_preset === "local_repair" ? t("待修底图") : t("商品原图")}</span><button type="button" onClick={() => setShowRegions(!showRegions)}>{showRegions ? t("隐藏区域标记") : t("查看识别区域")}</button></figcaption><div className="relative">
              {original && <img loading="lazy" decoding="async" src={original} alt={t("商品原图")} className="block h-auto w-full rounded-lg" />}
              {showRegions && [...(shot?.edit_regions || []).map(box=>({box,protect:false})),...(shot?.protected_regions || []).map(box=>({box,protect:true}))].map(({box:b,protect},i)=><div key={i} title={protect ? t("重点核对区域") : t("局部修改区域")} className={`pointer-events-none absolute border ${protect ? "border-emerald-500 bg-emerald-400/20" : "border-orange-500 bg-orange-400/10"}`} style={{left:`${b[0]*100}%`,top:`${b[1]*100}%`,width:`${b[2]*100}%`,height:`${b[3]*100}%`}} />)}
            </div></figure>
            <figure><figcaption className="mb-2 text-xs text-gray-500">{attempt?.status === "passed" ? t("生成成品 · 检查通过") : waitingForReview ? t("生成成品 · 等待验收") : acceptedWithoutReview ? t("生成成品 · 用户已确认") : imageReady ? t("生成成品 · 有检查提示") : t("生成结果")}</figcaption>{attempt?.image_url ? <><div className="group relative overflow-hidden rounded-lg"><img loading="lazy" decoding="async" src={attempt.image_url} alt={t("商品精修生成成品")} className="h-auto w-full" /><div className="absolute right-2 top-2 flex items-center gap-1"><button type="button" title={t("查看原图")} aria-label={t("查看原图")} onClick={() => setPreviewURL(attempt.image_url || "")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/30 bg-black/60 text-white shadow-sm backdrop-blur hover:bg-black/80"><Eye size={15} /></button><button type="button" title={t("下载原图")} aria-label={t("下载原图")} disabled={downloading} onClick={() => void downloadCurrentImage(attempt.image_url || "")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/30 bg-black/60 text-white shadow-sm backdrop-blur hover:bg-black/80 disabled:opacity-50">{downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}</button></div></div>{waitingForReview ? <p className="mt-2 rounded-lg bg-cyan-50 px-3 py-2 text-[11px] leading-5 text-cyan-800 dark:bg-cyan-400/10 dark:text-cyan-200">{ts("图片已保存，验收与复核尚未开始。你可以先放大查看，满意后直接完成，或手动启动验收。")}</p> : acceptedWithoutReview ? <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-5 text-gray-600 dark:bg-white/5 dark:text-gray-300">{ts("你已确认当前成品，本张未运行自动验收与复核。")}</p> : attempt.status !== "passed" && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{ts("图片已经生成，可以正常查看和下载。以下检查提示仅供参考；如果不满意，再点击“按检查问题修改这张”。")}</p>}</> : <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-400">{busy ? t("制作中…") : t("暂无成品")}</div>}</figure>
          </div>
            {result.attempts.length>1 && <label className="flex items-center gap-2 text-xs">{ts("查看版本")}<select className={`${selectField} max-w-44`} value={version < 0 ? result.attempts.length-1 : version} onChange={e => setVersion(Number(e.target.value))}>{result.attempts.map((a,i) => <option value={i} key={i}>{i===0?t("首次制作"):`${ts("修正")}${i}`} · {ts(statusLabel[a.status] || a.status)}</option>)}</select></label>}
            <details className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5"><summary className="cursor-pointer text-xs font-medium">{ts("细节检查 ·")} {attempt?.review ? ts(statusLabel[attempt.status] || "检查记录") : waitingForReview ? t("等待手动验收") : acceptedWithoutReview ? t("已跳过") : t("等待成片")}</summary>{attempt?.localization?.regions?.length ? <p className="mt-2 text-[11px] text-gray-400">{ts("已在成品中动态定位")} {attempt.localization.regions.length}  {ts("个检查区域")}</p> : null}<div className="mt-2 divide-y divide-gray-100 dark:divide-white/10">{shot?.checks.map(check => { const review = attempt?.review?.checks?.find(c => c.id===check.id); const verification = attempt?.verification?.checks?.find(c => c.id===check.id); return <div key={check.id} className="flex gap-3 py-3">{review?.status === "pass" && (!verification || verification.status === "pass") ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" /> : <AlertCircle size={17} className="mt-0.5 shrink-0 text-amber-500" />}<div><p className="text-sm">{check.description}</p><p className="mt-1 text-xs leading-5 text-gray-500">{review?.reason || (waitingForReview ? t("点击验收与复核后开始检查") : acceptedWithoutReview ? t("用户选择跳过自动检查") : t("尚未完成检查"))}</p>{verification && <p className="mt-1 text-xs leading-5 text-cyan-700 dark:text-cyan-300">{ts("独立复核：")}{verification.reason}</p>}</div></div>; })}</div></details>
            {!!attempt?.issues?.length && <p className="text-sm leading-6 text-amber-700 dark:text-amber-300">{attempt.issues.map(failureHelp).join("；")}</p>}
            {!busy && !awaitingReview && attempt?.image_url && <button type="button" onClick={() => void repairCurrentImage()} className="rounded-xl border border-primary/40 px-3 py-2 text-xs text-teal-700 dark:text-primary">{ts("按检查问题修改这张")}</button>}
          </section>}
        </>}
        </div>
      </main>
    </div>
    <SystemAssetLibraryDialog open={libraryOpen} kind="image" title={ts("从资产库选择图片")} description={ts("最多选择 2 张：商品图 + 可选的姿态或风格参考图")} disabledIds={refs.map(ref => ref.asset_id)} maxSelected={Math.max(1, MAX_PRODUCT_REFERENCES - refs.length)} onClose={() => setLibraryOpen(false)} onConfirm={importLibraryAssets} />
    {previewURL && <div role="dialog" aria-modal="true" aria-label={t("查看商品精修原图")} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6" onClick={() => setPreviewURL("")}><div className="relative flex max-h-[92vh] max-w-[94vw] items-center justify-center overflow-hidden rounded-2xl bg-black shadow-2xl" onClick={event => event.stopPropagation()}><div className="absolute right-3 top-3 z-10 flex gap-2"><button type="button" title={t("下载原图")} aria-label={t("下载原图")} disabled={downloading} onClick={() => void downloadCurrentImage(previewURL)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-black/70 text-white hover:bg-black/90 disabled:opacity-50">{downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}</button><button type="button" title={t("关闭")} aria-label={t("关闭")} onClick={() => setPreviewURL("")} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-black/70 text-white hover:bg-black/90"><X size={16} /></button></div><img loading="lazy" decoding="async" src={previewURL} alt={t("商品精修原图预览")} className="h-auto max-h-[92vh] w-auto max-w-[94vw] object-contain" /></div></div>}
  </div>;
}
