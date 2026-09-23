"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Download, Loader2, Wand2 } from "lucide-react";
import { api, uploadFile } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { mergeDetailTextLayers, normalizeDetailTextLayers, renderDetailTextLayers, type DetailTextLayer } from "./detailTextLayers";

type Section = {
  source_image_url?: string;
  image_url?: string;
  copy_title?: string;
  copy_points?: string[];
  image_prompt?: string;
  text_layers?: DetailTextLayer[];
};

function currentLayers(section: Section): DetailTextLayer[] {
  if (Array.isArray(section.text_layers)) return normalizeDetailTextLayers(section.text_layers);
  const title = section.copy_title?.trim();
  const body = (section.copy_points || []).filter(Boolean).join("\n");
  return normalizeDetailTextLayers([
    ...(title ? [{ text: title, x: 0.08, y: 0.63, width: 0.84, font_size: 0.05, color: "#202124", weight: "bold" }] : []),
    ...(body ? [{ text: body, x: 0.08, y: 0.72, width: 0.84, font_size: 0.027, color: "#202124" }] : []),
  ]);
}

function parsedLayers(content: string): DetailTextLayer[] {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI 没有返回可用的排版方案，请重试");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { text_layers?: unknown };
  return normalizeDetailTextLayers(parsed.text_layers);
}

async function visionReference(url: string): Promise<string> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error("详情底图读取失败");
  const image = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(1, 768 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    image.close();
  }
}

export function DetailPageRevisionEditor({ section, index, projectId, modelCode, userPrompt, designSystem, onUpdated }: {
  section: Section;
  index: number;
  projectId: string;
  modelCode: string;
  userPrompt: string;
  designSystem: unknown;
  onUpdated: () => Promise<void>;
}) {
  const { ts } = useI18n();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [layers, setLayers] = useState<DetailTextLayer[]>(() => currentLayers(section));
  const [previewURL, setPreviewURL] = useState("");
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => { if (previewURL) URL.revokeObjectURL(previewURL); }, [previewURL]);

  const changeLayers = (next: DetailTextLayer[]) => {
    setLayers(next);
    setPreviewBlob(null);
    setPreviewURL("");
  };
  const preview = async (next = layers) => {
    const blob = await renderDetailTextLayers(section.source_image_url || "", next);
    setPreviewBlob(blob);
    setPreviewURL(URL.createObjectURL(blob));
  };
  const askAI = async (mode: "copy" | "layout" | "both") => {
    if (!modelCode) { setError(ts("未配置文案模型，请先在后台配置分析模型")); return; }
    setBusy(mode);
    setError("");
    try {
      const base = normalizeDetailTextLayers(layers);
      const imageData = await visionReference(section.source_image_url || "");
      const result = await api<{ content: string }>("/api/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model_code: modelCode, ephemeral: true, stream: false,
          params: { reference_images: [imageData] },
          messages: [
            { role: "system", content: `你是电商详情图的创意总监。你会看到当前原始底图；它可能已经带有图片模型画出的广告字、参数、尺码或购买按钮。先观察真实画面：商品本体上的品牌标识可以保留；若背景、信息卡或按钮上已有广告文字，返回空的text_layers，不要再覆盖第二层文字。否则根据商品位置、空白和视觉流向决定新文字与排版，不得压在鞋面、放大镜特写、图标、人物或已有文字上。只返回严格JSON，包含text_layers数组；图层可为零个或多个，每层给出text、x、y、width、font_size、color、align、weight，可选background。坐标及字号为0到1的数值，由这张图决定，不沿用固定模板。用户明确要求原样显示的文字必须准确；其余内容可自由创作，包括虚拟商品概念。整页维持视觉主题与色彩，但每屏文字表达可以不同。不强制标题、卖点、卡片、字数或顺序，图层不得互相重叠。不要返回解释或图片。${mode === "copy" ? "只改文字，保持原图层数量和每层排版参数；如果底图已有广告文字，可返回空数组。" : mode === "layout" ? "只改图层的排版参数，文字必须逐字保持，图层数量不变；若底图已有广告文字，应提示用户改用文案排版都换。" : "文字和排版都可重新创作，也可不放文字。"}` },
            { role: "user", content: JSON.stringify({ user_prompt: userPrompt, instruction: instruction || "请让这一屏更有创意、更贴合实际画面", design_system: designSystem, image_prompt: section.image_prompt, current_copy_for_inspiration: base.map(layer => layer.text) }) },
          ],
        }),
      });
      const next = mergeDetailTextLayers(base, parsedLayers(result.content), mode);
      changeLayers(next);
      await preview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ts("文案排版生成失败"));
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setBusy("save");
    setError("");
    try {
      const blob = previewBlob || await renderDetailTextLayers(section.source_image_url || "", layers);
      const imageURL = await uploadFile(new File([blob], `detail-${index + 1}-revision.jpg`, { type: "image/jpeg" }));
      await api(`/api/agent-projects/${projectId}/detail-sections/${index}`, {
        method: "PATCH",
        body: JSON.stringify({ image_url: imageURL, text_layers: normalizeDetailTextLayers(layers) }),
      });
      await onUpdated();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ts("保存详情图失败"));
    } finally {
      setBusy("");
    }
  };

  if (!section.source_image_url) return null;
  return <div className="mt-3 border-t border-gray-100 pt-3 dark:border-white/10">
    <button type="button" onClick={() => { setOpen(!open); changeLayers(currentLayers(section)); setError(""); }} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-primary dark:border-white/15 dark:text-gray-200">{ts(open ? "收起文案与排版" : "调整文案与排版")}</button>
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-gray-500 dark:text-gray-300">{ts("复用原图，只重绘文字。AI 改写可能产生文字模型费用，保存前可预览；不重新生成图片。")}</p>
      <textarea value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={ts("想改哪里？留空也可以，例如：更有故事感、更大胆、减少说明文字") } rows={2} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 dark:border-white/15 dark:bg-gray-950 dark:text-gray-100" />
      <div className="flex flex-wrap gap-1.5">
        {([ ["copy", "只换文案"], ["layout", "只换排版"], ["both", "文案排版都换"] ] as const).map(([mode, label]) => <button key={mode} type="button" onClick={() => void askAI(mode)} disabled={!!busy || (mode === "layout" && layers.length === 0)} className="flex items-center gap-1 rounded-lg bg-primary/15 px-2.5 py-1.5 text-xs font-semibold text-gray-800 disabled:opacity-50 dark:text-gray-100">{busy === mode ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}{ts(label)}</button>)}
      </div>
      {layers.map((layer, layerIndex) => <div key={layerIndex} className="rounded-lg border border-gray-200 p-2 dark:border-white/15">
        <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-300"><span>{ts("文字图层")} {layerIndex + 1}</span><button type="button" onClick={() => changeLayers(layers.filter((_, i) => i !== layerIndex))}>{ts("删除")}</button></div>
        <textarea value={layer.text} onChange={event => changeLayers(layers.map((item, i) => i === layerIndex ? { ...item, text: event.target.value } : item))} rows={2} className="mt-1 w-full rounded-md border border-gray-200 bg-transparent px-2 py-1 text-xs dark:border-white/15" />
        <details className="mt-1 text-[11px] text-gray-500 dark:text-gray-300"><summary className="cursor-pointer">{ts("位置与样式")}</summary><div className="mt-2 grid grid-cols-3 gap-1.5">
          {([ ["x", "横向"], ["y", "纵向"], ["width", "宽度"], ["font_size", "字号"] ] as const).map(([field, label]) => <label key={field}>{ts(label)}<input type="number" min={0} max={1} step={0.01} value={layer[field]} onChange={event => changeLayers(layers.map((item, i) => i === layerIndex ? { ...item, [field]: Number(event.target.value) } : item))} className="mt-0.5 w-full rounded border border-gray-200 bg-transparent px-1.5 py-1 dark:border-white/15" /></label>)}
          <label>{ts("字色")}<input type="color" value={layer.color} onChange={event => changeLayers(layers.map((item, i) => i === layerIndex ? { ...item, color: event.target.value } : item))} className="mt-0.5 h-7 w-full" /></label>
          <label>{ts("对齐")}<select value={layer.align || "left"} onChange={event => changeLayers(layers.map((item, i) => i === layerIndex ? { ...item, align: event.target.value as DetailTextLayer["align"] } : item))} className="mt-0.5 w-full rounded border border-gray-200 bg-transparent px-1 py-1 dark:border-white/15"><option value="left">{ts("左")}</option><option value="center">{ts("中")}</option><option value="right">{ts("右")}</option></select></label>
          <label>{ts("字重")}<select value={layer.weight || "normal"} onChange={event => changeLayers(layers.map((item, i) => i === layerIndex ? { ...item, weight: event.target.value as DetailTextLayer["weight"] } : item))} className="mt-0.5 w-full rounded border border-gray-200 bg-transparent px-1 py-1 dark:border-white/15"><option value="normal">{ts("常规")}</option><option value="bold">{ts("加粗")}</option></select></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={!!layer.background} onChange={event => changeLayers(layers.map((item, i) => i === layerIndex ? { ...item, background: event.target.checked ? "#202124" : undefined } : item))} />{ts("文字底色")}</label>
          {layer.background && <label>{ts("底色")}<input type="color" value={layer.background} onChange={event => changeLayers(layers.map((item, i) => i === layerIndex ? { ...item, background: event.target.value } : item))} className="mt-0.5 h-7 w-full" /></label>}
        </div></details>
      </div>)}
      <div className="flex gap-3"><button type="button" onClick={() => changeLayers([...layers, { text: "", x: 0.08, y: 0.7, width: 0.84, font_size: 0.045, color: "#FFFFFF", align: "left" }])} className="text-xs text-gray-500 hover:text-primary">{ts("＋ 添加文字图层")}</button><button type="button" onClick={() => changeLayers([])} className="text-xs text-gray-500 hover:text-primary">{ts("清空本屏文字")}</button></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setBusy("preview"); void preview().catch(cause => setError(cause instanceof Error ? cause.message : ts("预览失败"))).finally(() => setBusy("")); }} disabled={!!busy} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs dark:border-white/15">{ts("预览修改")}</button><button type="button" onClick={() => void save()} disabled={!!busy} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-dark disabled:opacity-50">{busy === "save" ? ts("保存中…") : ts("保存为当前版本")}</button></div>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      <div className="relative overflow-hidden rounded-lg bg-gray-100 dark:bg-black/30"><Image unoptimized src={previewURL || section.image_url || section.source_image_url} alt={ts("详情图预览")} width={600} height={600} className="h-auto w-full" /></div>
      {previewURL && <a href={previewURL} download={`detail-${index + 1}-preview.jpg`} className="inline-flex items-center gap-1 text-xs text-gray-500"><Download size={12} />{ts("下载预览")}</a>}
    </div>}
  </div>;
}
