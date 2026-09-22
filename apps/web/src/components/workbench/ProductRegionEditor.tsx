"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";

export type ProductRegion = [number, number, number, number];

function normalizeRegions(value: ProductRegion[] | null | undefined): ProductRegion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((box): box is ProductRegion => Array.isArray(box) && box.length === 4 && box.every(axis => typeof axis === "number" && Number.isFinite(axis)));
}

export function ProductRegionEditor({ url, edit: editValue, protectedAreas: protectedValue, repairOnly = false, onChange }: {
  url: string; edit?: ProductRegion[] | null; protectedAreas?: ProductRegion[] | null;
  repairOnly?: boolean;
  onChange: (edit: ProductRegion[], protectedAreas: ProductRegion[]) => void;
}) {
  const { t, ts } = useI18n();
  const edit = normalizeRegions(editValue);
  const protectedAreas = repairOnly ? [] : normalizeRegions(protectedValue);
  const [mode, setMode] = useState<"edit" | "protect">(repairOnly ? "edit" : "protect");
  const [draft, setDraft] = useState<ProductRegion | null>(null);
  const start = useRef<[number, number] | null>(null);
  const point = (event: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  return <div className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3 dark:border-white/10">
    <p className="text-xs leading-5 text-gray-500">{repairOnly ? t("拖动橙色框圈住完整缺陷，并带上少量正常边缘用于自然衔接。相距较远的问题请分别圈选；框线只用于定位，不会写进成品。") : t("可选：绿色框标出必须核对的商品细节，橙色框标出局部修图范围。上脚和换场景时，绿色框不会整块贴回成片。")}</p>
    <div className="flex gap-2 text-xs">{!repairOnly && <button type="button" aria-pressed={mode === "protect"} onClick={() => setMode("protect")} className={`rounded px-2 py-1 ${mode === "protect" ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}`}>{ts("重点核对")}</button>}<button type="button" aria-pressed={mode === "edit"} onClick={() => setMode("edit")} className={`rounded px-2 py-1 ${mode === "edit" ? "bg-orange-100 text-orange-800" : "bg-gray-100 text-gray-600"}`}>{repairOnly ? t("问题修复范围") : t("局部修改")}</button><button type="button" onClick={() => onChange([], [])} className="ml-auto text-gray-500">{ts("清除")}</button></div>
    <div className="relative touch-none select-none" onPointerDown={e => { if (e.button !== 0) return; start.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (!start.current) return; const p = point(e), s = start.current; setDraft([Math.min(s[0], p[0]), Math.min(s[1], p[1]), Math.abs(p[0]-s[0]), Math.abs(p[1]-s[1])]); }} onPointerCancel={() => { start.current=null; setDraft(null); }} onPointerUp={e => {
      if (!start.current) return;
      const p=point(e), s=start.current;
      const box: ProductRegion=[Math.min(s[0],p[0]),Math.min(s[1],p[1]),Math.abs(p[0]-s[0]),Math.abs(p[1]-s[1])];
      start.current=null;setDraft(null);
      if (box[2]<0.005 || box[3]<0.005) return;
      if (mode==="edit" && edit.length<12) onChange([...edit,box],repairOnly ? [] : protectedAreas);
      if (mode==="protect" && protectedAreas.length<12) onChange(edit,[...protectedAreas,box]);
    }}><img src={url} alt={t("拖动框选商品重点核对或局部修改区域")} draggable={false} className="pointer-events-none block h-auto w-full" />
      {[...edit.map(box => ({box,protect:false})),...protectedAreas.map(box => ({box,protect:true})),...(draft ? [{box:draft,protect:mode==="protect"}] : [])].map(({box,protect},i) => <div key={i} className={`pointer-events-none absolute border-2 ${protect ? "border-emerald-500 bg-emerald-400/20" : "border-orange-500 bg-orange-400/15"}`} style={{left:`${box[0]*100}%`,top:`${box[1]*100}%`,width:`${box[2]*100}%`,height:`${box[3]*100}%`}} />)}
    </div>
    <p className="text-[11px] text-gray-500">{repairOnly ? `问题区域 ${edit.length}/12` : `重点核对 ${protectedAreas.length}/12 · 局部修改 ${edit.length}/12`}</p>
    <details className="text-xs"><summary className="cursor-pointer text-gray-500">{ts("使用数值调整区域（百分比）")}</summary>{(repairOnly ? ["edit"] as const : ["protect","edit"] as const).map(kind => <div key={kind} className="mt-2"><button type="button" onClick={() => kind==="protect" ? protectedAreas.length<12 && onChange(edit,[...protectedAreas,[0.25,0.25,0.25,0.25]]) : edit.length<12 && onChange([...edit,[0,0,0.25,0.25]],repairOnly ? [] : protectedAreas)} className="underline">{ts("添加")}{kind==="protect"?t("重点核对"):repairOnly?t("问题"):t("局部修改")}{ts("区域")}</button>{(kind==="protect"?protectedAreas:edit).map((box,index) => <div key={index} className="mt-1 flex gap-1">{box.map((value,axis) => <label key={axis} className="min-w-0 flex-1">{[t("左"),t("上"),t("宽"),t("高")][axis]}<input type="number" min="0" max="100" step="0.1" value={Number((value*100).toFixed(2))} onChange={e => { const regions=(kind==="protect"?protectedAreas:edit).map(b=>[...b] as ProductRegion);regions[index][axis]=Number(e.target.value)/100;onChange(kind==="edit"?regions:edit,kind==="protect"?regions:repairOnly?[]:protectedAreas); }} className="w-full rounded border border-gray-200 bg-transparent p-1" /></label>)}<button type="button" aria-label={`删除${kind}区域${index+1}`} onClick={() => onChange(kind==="edit"?edit.filter((_,i)=>i!==index):edit,kind==="protect"?protectedAreas.filter((_,i)=>i!==index):repairOnly?[]:protectedAreas)}>×</button></div>)}</div>)}</details>
  </div>;
}
