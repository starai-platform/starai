"use client";

import { useEffect, useState } from "react";
import { ArrowUp, BookMarked, Bot, FileText, HelpCircle, History, ListChecks, Plus, Ruler, Sparkles } from "lucide-react";
import { api, apiCached } from "@/lib/api";
import { NovelPlayGuide } from "./NovelPlayGuide";
import { DEFAULT_GENERATION_LANGUAGES, GenerationLanguageMenu } from "./GenerationLanguageMenu";
import { MediaMenuOption, MediaOptionMenu } from "./MediaOptionMenu";
import { useI18n } from "@/i18n/I18nProvider";

type HistoryItem = { public_id: string; title?: string; workflow_name?: string; status: string; created_at: string };
type Props = { workflowCode: string; workflowName: string; workflowDescription: string; roles: any[]; defaultModelCode?: string; error?: string; onSubmit: (inputs: Record<string, any>) => void | Promise<void>; onLoadHistory?: (id: string) => void | Promise<void> };
const INTENTS = [["new", "从头新写", "请帮我从头创作一部小说"], ["continue", "续写旧稿", "请帮我续写这份旧稿"], ["rewrite", "改写润色", "请帮我改写并润色下面的内容"], ["prequel", "前传", "请帮我创作这个故事的前传"], ["extra", "番外", "请帮我创作这个故事的番外篇"], ["insert", "中间插写", "请帮我在现有故事中插入一段新情节"]] as const;
const GENRES = ["玄幻", "都市", "言情", "悬疑", "科幻", "历史", "武侠", "游戏", "现实"];
const LENGTHS = [["short", "短篇 · 3万字内", "短篇·3万字内"], ["medium", "中篇 · 约15万字", "中篇·约15万字"], ["long", "长篇 · 50万字以上", "长篇·50万字以上"]] as const;

export function NovelWorkshopLanding({ workflowCode, workflowName, workflowDescription, roles, defaultModelCode, error, onSubmit, onLoadHistory }: Props) {
  const { t, ts } = useI18n();
  const [mode, setMode] = useState<"auto" | "step">("auto");
  const [prompt, setPrompt] = useState("请帮我从头创作一部小说"); const [intent, setIntent] = useState("new"); const [genre, setGenre] = useState("玄幻"); const [length, setLength] = useState("short"); const [language, setLanguage] = useState("zh-CN"); const [guideOpen, setGuideOpen] = useState(false); const [submitting, setSubmitting] = useState(false); const [models, setModels] = useState<{ code: string; display_name?: string; category?: string }[]>([]); const [model, setModel] = useState(defaultModelCode || ""); const [fileName, setFileName] = useState(""); const [historyOpen, setHistoryOpen] = useState(false); const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]); const [historyError, setHistoryError] = useState("");
  useEffect(() => { apiCached<{ code: string; display_name?: string; category?: string }[]>("/api/models?category=chat").then((items) => { const list = (items || []).filter((item) => item.category !== "multi_collab" && item.code !== "multi_collab_chat" && !/多模型协作|multi.?collab/i.test(`${item.code} ${item.display_name || ""}`)); setModels(list); setModel((old) => list.some((item) => item.code === old) ? old : list[0]?.code || ""); }).catch(() => setModels([])); }, [defaultModelCode]);
  const chooseIntent = (id: string, text: string) => { setIntent((old) => old === id ? "" : id); setPrompt((old) => old === text ? "" : old && !old.startsWith(text) ? `${text}\n\n${old}` : text); };
  const attach = (file?: File) => { if (!file) return; setFileName(file.name); setPrompt((old) => `${old}${old ? "\n\n" : ""}[文档：${file.name}]`); };
  const submit = async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    try {
      const languageItem = DEFAULT_GENERATION_LANGUAGES.find((item) => item.code === language);
      await onSubmit({
        prompt: prompt.trim(), intent, genre, length_code: length,
        word_count_target: LENGTHS.find((item) => item[0] === length)?.[2] || LENGTHS[1][2],
        style: "轻松幽默", language,
        ...(languageItem ? { language_label: languageItem.prompt_label || languageItem.name } : {}),
        _mode: mode, ...(model ? { model_code: model } : {}),
      });
    } finally { setSubmitting(false); }
  };
  const reset = () => { setPrompt("请帮我从头创作一部小说"); setIntent("new"); setGenre("玄幻"); setLength("short"); setMode("auto"); setFileName(""); };
  const toggleHistory = async () => { const next = !historyOpen; setHistoryOpen(next); if (!next) return; setHistoryError(""); try { const result = await api<{ items: HistoryItem[] }>(`/api/agent-projects?workflow_code=${encodeURIComponent(workflowCode)}&page=1&page_size=20`); setHistoryItems(result.items || []); } catch (e) { setHistoryItems([]); setHistoryError(e instanceof Error ? e.message : "历史记录加载失败"); } };

  const intentLabel = INTENTS.find((item) => item[0] === intent)?.[1] || "创作意图";
  const lengthLabel = LENGTHS.find((item) => item[0] === length)?.[1] || "目标篇幅";
  const modelLabel = models.find((item) => item.code === model)?.display_name || model || "写作模型";

  const modeToggle = (
    <div className="flex shrink-0 items-center rounded-xl border border-gray-200 bg-gray-50 p-0.5 text-xs dark:border-white/10 dark:bg-white/5">
      <button type="button" onClick={() => setMode("auto")} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition ${mode === "auto" ? "bg-primary text-dark font-semibold shadow-sm" : "text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white"}`}><Bot size={13} />{ts("智能托管")}</button>
      <button type="button" onClick={() => setMode("step")} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition ${mode === "step" ? "bg-primary text-dark font-semibold shadow-sm" : "text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white"}`}><ListChecks size={13} />{ts("逐步确认")}</button>
    </div>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#eaf7fb] text-gray-900 dark:bg-[#05080f] dark:text-white">
      <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-60 dark:[background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)]" />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-1.5 sm:py-2 sm:px-5 lg:px-8">
        <div className="relative flex shrink-0 items-center gap-2">
          <button type="button" onClick={reset} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-dark"><Plus size={15} />{ts("新任务")}</button>
          <button type="button" onClick={toggleHistory} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-100 bg-white px-3 text-sm text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"><History size={15} />{ts("历史")}</button>
          {historyOpen && (
            <div className="absolute left-0 top-11 z-40 w-[320px] max-h-[60vh] overflow-y-auto rounded-2xl border border-gray-100 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-gray-900">
              {historyError ? <div className="p-4 text-xs text-red-500">{historyError}</div> : historyItems.length === 0 ? <div className="p-5 text-center text-xs text-gray-400">{ts("暂无历史任务")}</div> : historyItems.map((item) => (
                <button key={item.public_id} type="button" onClick={() => { setHistoryOpen(false); onLoadHistory?.(item.public_id); }} className="w-full rounded-xl px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/5">
                  <div className="truncate text-sm text-gray-800 dark:text-gray-100">{item.title || item.workflow_name || "小说任务"}</div>
                  <div className="mt-0.5 text-[10px] text-gray-400">{new Date(item.created_at).toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <NovelHeader name={workflowName} description={workflowDescription} roles={roles} />
        {error && <div className="mx-auto mt-2 w-full max-w-[760px] rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">{error.includes("Failed to fetch") || error.includes("fetch failed") ? t("无法连接到 API 服务（localhost:8080），请先启动后端服务后重试。") : error}</div>}
      </div>
      <div className="relative z-20 shrink-0 px-3 pb-2.5 pt-1 sm:px-6 sm:pb-5 sm:pt-2">
        <div className="mx-auto w-full max-w-[1040px]">
          <div className="soft-input overflow-hidden">
            {/* 输入区上方工具参数栏：创作意图 / 题材类型 /（PC）智能托管切换 / 玩法说明 */}
            <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-50 px-3 py-2 dark:border-white/10">
              <MediaOptionMenu icon={<Sparkles size={15} />} activeLabel={ts(intentLabel)} title={t("创作意图")} subtitle={t("选择本次任务想要的创作方式，会自动带入对应的提示语")} compactOnMobile>
                {(close) => (
                  <div className="space-y-2">
                    {INTENTS.map((item) => (
                      <MediaMenuOption key={item[0]} selected={intent === item[0]} onClick={() => { chooseIntent(item[0], item[2]); close(); }}>{ts(item[1])}</MediaMenuOption>
                    ))}
                  </div>
                )}
              </MediaOptionMenu>
              <MediaOptionMenu icon={<BookMarked size={15} />} activeLabel={ts(genre || "题材类型")} title={t("题材类型")} subtitle={t("决定故事的世界观、风格与节奏基调")} compactOnMobile>
                {(close) => (
                  <div className="grid grid-cols-3 gap-2">
                    {GENRES.map((item) => (
                      <MediaMenuOption key={item} selected={genre === item} onClick={() => { setGenre(item); close(); }}>{ts(item)}</MediaMenuOption>
                    ))}
                  </div>
                )}
              </MediaOptionMenu>
              <div className="hidden shrink-0 sm:block">{modeToggle}</div>
              <button type="button" onClick={() => setGuideOpen(true)} className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"><HelpCircle size={15} />{ts("玩法说明")}</button>
            </div>
            <div className="flex min-h-[112px] items-start gap-3 px-3 py-3">
              <label className="flex h-16 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-gray-200 text-[10px] text-gray-400 hover:border-primary/50 dark:border-white/10 dark:text-gray-400">
                <FileText size={18} /><span className="max-w-[68px] truncate">{fileName || ts("上传文档")}</span>
                <input type="file" className="hidden" accept=".txt,.doc,.docx,.pdf" onChange={(event) => { attach(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </label>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder={t("说说你想写的故事，或把已有正文直接贴进来……")} className="min-h-[88px] min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-relaxed text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500" />
            </div>
            {/* 输入区下方工具栏：写作模型 / 语言 / 目标篇幅 / 发送 */}
            <div className="flex items-center gap-2 overflow-x-auto border-t border-gray-50 px-3 py-3 dark:border-white/10">
              <MediaOptionMenu icon={<Bot size={15} />} activeLabel={modelLabel} title={t("写作模型")} subtitle={t("选择负责全书创作的对话模型")} compactOnMobile menuWidth={260}>
                {(close) => (
                  <div className="space-y-2">
                    {models.length === 0 ? <div className="px-2 py-3 text-center text-xs text-gray-400">{ts("暂无可用的对话模型")}</div> : models.map((item) => (
                      <MediaMenuOption key={item.code} selected={model === item.code} onClick={() => { setModel(item.code); close(); }}>{item.display_name || item.code}</MediaMenuOption>
                    ))}
                  </div>
                )}
              </MediaOptionMenu>
              <GenerationLanguageMenu languages={DEFAULT_GENERATION_LANGUAGES} value={language} onChange={setLanguage} />
              <MediaOptionMenu icon={<Ruler size={15} />} activeLabel={ts(lengthLabel)} title={t("目标篇幅")} subtitle={t("决定大纲规模与全书总字数目标")} compactOnMobile menuWidth={240}>
                {(close) => (
                  <div className="space-y-2">
                    {LENGTHS.map((item) => (
                      <MediaMenuOption key={item[0]} selected={length === item[0]} onClick={() => { setLength(item[0]); close(); }}>{ts(item[1])}</MediaMenuOption>
                    ))}
                  </div>
                )}
              </MediaOptionMenu>
              <button type="button" onClick={submit} disabled={!prompt.trim() || submitting} className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-white shadow-md disabled:opacity-40">{submitting ? "…" : <ArrowUp size={19} />}</button>
            </div>
            {/* 移动端：托管/逐步确认单独一行居中，避免挤爆上方工具栏 */}
            <div className="flex justify-center border-t border-gray-50 px-3 py-2 dark:border-white/10 sm:hidden">{modeToggle}</div>
          </div>
        </div>
      </div>
      <NovelPlayGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}

const TEAM = [["chief_editor", "总编", ""], ["story_planner", "故事策划", "搭建故事圣经"], ["chapter_writer", "章节写手", "逐章创作正文"], ["proofreader", "审校员", "检查设定矛盾"], ["archivist", "档案员", "维护设定台账"], ["rhythm_editor", "节奏编排师", "安排故事节奏"], ["polish_writer", "文学润色师", "统一全书文风"]] as const;
const avatarOf = (id: string) => `https://api.dicebear.com/9.x/adventurer/svg?seed=starai-${id}`;

function OnlineDot() {
  return <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400 shadow-sm dark:border-[#0b1220]" />;
}

function MemberAvatar({ src, large = false }: { src: string; large?: boolean }) {
  return (
    <div className={`relative shrink-0 ${large ? "h-16 w-16" : "h-12 w-12"}`}>
      <div className={`h-full w-full overflow-hidden rounded-full bg-indigo-100 shadow-sm ring-1 ring-indigo-200/80 dark:bg-indigo-500/10 dark:ring-indigo-400/30`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      </div>
      <OnlineDot />
    </div>
  );
}

function NovelHeader({ name, description, roles }: { name: string; description: string; roles: any[] }) {
  const { ts } = useI18n();
  const roleName = (id: string, fallback: string) => roles.find((item) => item.id === id)?.name || fallback;
  const roleAvatar = (id: string) => roles.find((item) => item.id === id)?.avatar_url || avatarOf(id);
  const roleTip = (id: string, fallback: string) => roles.find((item) => item.id === id)?.description || fallback;
  const chief = TEAM[0];
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col justify-center py-2 lg:py-4">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />{ts("文学智能体")}</div>
        <div className="mt-2 flex items-center justify-center gap-2.5 sm:gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-xl dark:bg-indigo-500/15 sm:h-12 sm:w-12 sm:text-2xl">📖</div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white sm:text-4xl">{ts(name || "AI小说工坊")}</h1>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-[13px] leading-5 text-gray-500 dark:text-slate-300 sm:text-sm sm:leading-6">{ts(description || "一句话创意，让 AI 帮你写完一整本书。")}</p>
        <div className="mt-2 flex justify-center gap-2"><span className="hero-tag">{ts("AI编辑部")}</span><span className="hero-tag">{ts("多角色协同")}</span><span className="hero-tag">{ts("全程可控")}</span></div>
      </div>
      {/* 为你效力的 AI 编辑部（透明背景，与页面融为一体） */}
      <div className="mx-auto mt-4 w-full px-3 sm:mt-5 sm:px-0">
        <div className="flex items-center justify-center gap-3">
          <h2 className="text-sm font-bold text-indigo-600 dark:text-indigo-300 sm:text-base">{ts("为你效力的 AI 编辑部")}</h2>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
            <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>
            {TEAM.length}  {ts("位成员在线")}
          </span>
        </div>
        <div className="mt-2.5 flex flex-col gap-3 sm:mt-3 sm:flex-row sm:items-start sm:gap-5">
          <div className="flex items-center justify-center gap-3 sm:w-[248px] sm:flex-col sm:items-center sm:text-center">
            <MemberAvatar src={roleAvatar(chief[0])} large />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:justify-center">
                <span className="text-sm font-bold text-gray-900 dark:text-white">{ts(roleName(chief[0], chief[1]))}</span>
                <span className="rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">{ts("主控")}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-4 text-gray-500 dark:text-slate-400 sm:mt-1" title={ts(roleTip(chief[0], chief[2]))}>{ts(roleTip(chief[0], chief[2]))}</p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-x-2 gap-y-2.5 place-items-center sm:grid-cols-6 sm:gap-y-4">
            {TEAM.slice(1).map(([id, fallback, tip]) => (
              <div key={id} title={ts(roleTip(id, tip))} className="flex flex-col items-center gap-1.5">
                <MemberAvatar src={roleAvatar(id)} />
                <span className="whitespace-nowrap text-[11px] text-gray-600 dark:text-slate-300">{ts(roleName(id, fallback))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
