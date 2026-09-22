"use client";

import { Check, Clock, Download, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";

type Chapter = { chapter_number: number; title: string; polished_content?: string; raw_content?: string; summary?: string; word_count?: number; status: string; created_at?: string };
type Props = { chapters: Chapter[]; currentChapter?: number; totalChapters?: number; onRewrite?: (chapterNumber: number) => void; onRequestRevision?: (request: { chapterNumber?: number; instruction: string }) => void | Promise<void> };
function contentOf(chapter: Chapter) { return chapter.polished_content || chapter.raw_content || chapter.summary || "本章内容正在生成..."; }
function downloadText(filename: string, text: string) { const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }

export function NovelChapterList({ chapters, currentChapter, totalChapters, onRewrite, onRequestRevision }: Props) {
  const { t, ts } = useI18n();
  const [selectedNumber, setSelectedNumber] = useState<number | null>(chapters[0]?.chapter_number ?? null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionType, setRevisionType] = useState<"chapter" | "outline">("chapter");
  const [revisionText, setRevisionText] = useState("");
  useEffect(() => {
    if (selectedNumber == null && chapters[0]) setSelectedNumber(chapters[0].chapter_number);
    if (selectedNumber != null && !chapters.some((chapter) => chapter.chapter_number === selectedNumber) && chapters[0]) setSelectedNumber(chapters[0].chapter_number);
  }, [chapters, selectedNumber]);
  const selected = chapters.find((chapter) => chapter.chapter_number === selectedNumber) || chapters[0];
  const totalWords = useMemo(() => chapters.reduce((sum, chapter) => sum + Number(chapter.word_count || 0), 0), [chapters]);
  const total = totalChapters || chapters.length;
  const progress = total ? Math.min(100, Math.round((chapters.length / total) * 100)) : 0;
  const bookText = chapters.map((chapter) => `第 ${chapter.chapter_number} 章 ${chapter.title}\n\n${contentOf(chapter)}`).join("\n\n\n");
  const openRevision = (type: "chapter" | "outline") => { setRevisionType(type); setRevisionText(""); setRevisionOpen(true); };

  if (!chapters.length) return (
    <div className="rounded-2xl border border-indigo-200 bg-white/70 p-6 text-gray-500 dark:border-indigo-400/20 dark:bg-white/[0.04] dark:text-gray-400">
      <div className="flex items-center justify-between"><div className="flex items-center gap-3"><Clock size={22} className="animate-spin text-indigo-500 dark:text-indigo-300" /><div><p className="text-sm font-semibold text-gray-900 dark:text-white">{ts("AI 编辑部已开始创作")}</p><p className="mt-1 text-xs">{ts("正在准备第")} {currentChapter || 1}  {ts("章，请稍候...")}</p></div></div><span className="font-mono text-sm text-indigo-600 dark:text-indigo-300">0 / {totalChapters || 0}  {ts("章")}</span></div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"><div className="h-full w-[3%] rounded-full bg-indigo-500" /></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-100/80 to-purple-100/70 p-4 dark:border-indigo-400/20 dark:from-indigo-500/10 dark:to-purple-500/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="text-sm font-semibold text-gray-900 dark:text-white">{ts("创作进度")}</div><div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{ts("已完成")} {chapters.length} / {total}  {ts("章 ·")} {totalWords.toLocaleString()}  {ts("字")}</div></div>
          <div className="flex items-center gap-2"><span className="font-mono text-sm text-indigo-600 dark:text-indigo-300">{progress}%</span><button type="button" onClick={() => openRevision("outline")} disabled={!onRequestRevision} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-indigo-300 px-3 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 dark:border-indigo-400/30 dark:text-indigo-200 dark:hover:bg-indigo-400/10">{ts("修改大纲")}</button><button type="button" onClick={() => downloadText("AI小说工坊-全文.txt", bookText)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white/70 px-3 text-xs font-semibold text-gray-700 hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"><Download size={14} />{ts("下载全文")}</button></div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-700" style={{ width: `${progress}%` }} /></div>
        {currentChapter && currentChapter > chapters.length && <div className="mt-2 flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-300"><Clock size={14} className="animate-spin" />{ts("正在创作第")} {currentChapter}  {ts("章，已完成内容可先阅读")}</div>}
      </div>

      <div className="grid min-h-[520px] grid-cols-1 overflow-hidden rounded-2xl border border-gray-200 bg-white/70 dark:border-white/10 dark:bg-white/[0.03] lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-b border-gray-200 bg-gray-50/80 p-3 dark:border-white/10 dark:bg-black/10 lg:border-b-0 lg:border-r">
          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{ts("章节目录")}</div>
          <div className="max-h-[420px] space-y-1 overflow-y-auto lg:max-h-[620px]">{chapters.map((chapter) => { const active = chapter.chapter_number === selected?.chapter_number; return <button key={chapter.chapter_number} type="button" onClick={() => setSelectedNumber(chapter.chapter_number)} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition ${active ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200" : "text-gray-500 hover:bg-white hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"}`}><span className="shrink-0">{chapter.status === "completed" ? <Check size={15} className="text-emerald-500 dark:text-emerald-400" /> : <Clock size={15} className="text-amber-500 dark:text-amber-400" />}</span><span className="min-w-0 flex-1 truncate text-sm">{ts("第")} {chapter.chapter_number}  {ts("章 ·")} {chapter.title}</span></button>; })}</div>
        </aside>
        <article className="min-w-0 bg-white/80 p-5 dark:bg-[#111827]/40 sm:p-8">
          {selected ? <><div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4 dark:border-white/10"><div><div className="text-xs text-indigo-600 dark:text-indigo-300">{ts("第")} {selected.chapter_number}  {ts("章")}</div><h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">{selected.title}</h2><div className="mt-2 text-xs text-gray-500">{Number(selected.word_count || 0).toLocaleString()}  {ts("字")}</div></div><div className="flex items-center gap-2"><button type="button" onClick={() => openRevision("chapter")} disabled={!onRequestRevision} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-indigo-300 px-3 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-400/30 dark:text-indigo-200 dark:hover:bg-indigo-400/10">{ts("修改本章")}</button><button type="button" onClick={() => downloadText(`第${selected.chapter_number}章-${selected.title || "正文"}.txt`, contentOf(selected))} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"><Download size={14} />{ts("下载本章")}</button>{onRewrite && selected.status === "completed" && <button type="button" onClick={() => onRewrite(selected.chapter_number)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-indigo-300 px-3 text-xs text-indigo-700 hover:bg-indigo-50 dark:border-indigo-400/30 dark:text-indigo-200 dark:hover:bg-indigo-400/10"><RefreshCw size={14} />{ts("重写")}</button>}</div></div>{selected.summary && <div className="mb-5 rounded-xl bg-gray-50 p-3 text-sm leading-6 text-gray-600 dark:bg-white/[0.04] dark:text-gray-400"><span className="mr-2 text-xs text-gray-500">{ts("本章摘要")}</span>{selected.summary}</div>}<div className="whitespace-pre-wrap text-[15px] leading-8 text-gray-700 dark:text-gray-200">{contentOf(selected)}</div></> : <div className="flex h-full items-center justify-center text-sm text-gray-500">{ts("选择章节开始阅读")}</div>}
        </article>
      </div>

      {revisionOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => setRevisionOpen(false)}><div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h3 className="font-semibold text-gray-900 dark:text-white">{revisionType === "chapter" ? `修改第 ${selected?.chapter_number || ""} 章` : t("修改故事大纲")}</h3><button type="button" onClick={() => setRevisionOpen(false)} className="text-gray-400 hover:text-gray-900 dark:hover:text-white"><X size={18} /></button></div><p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{ts("提交后会创建一个新的小说版本，原版本保留在历史记录中。请描述需要调整的内容。")}</p><textarea autoFocus value={revisionText} onChange={(event) => setRevisionText(event.target.value)} placeholder={revisionType === "chapter" ? t("例如：加强冲突，把结尾改成悬念，不改变人物设定") : t("例如：第3章提前揭示线索，增加一卷终章，将第5章改为感情转折")} className="mt-4 h-32 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 focus:border-indigo-400 dark:border-white/10 dark:bg-black/20 dark:text-white dark:placeholder:text-gray-500" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setRevisionOpen(false)} className="rounded-xl px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5">{ts("取消")}</button><button type="button" disabled={!revisionText.trim()} onClick={() => { if (!revisionText.trim()) return; void onRequestRevision?.({ chapterNumber: revisionType === "chapter" ? selected?.chapter_number : undefined, instruction: revisionText.trim() }); setRevisionOpen(false); }} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{ts("生成新版本")}</button></div></div></div>}
    </div>
  );
}
