"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";

type Policy = {
  version: number; updated_at?: string; instructions: string; intent_guidance: string;
  research_guidance: string; creation_guidance: string; recovery_guidance: string;
  document_guidance: string;
  default_style: string; max_duration_sec: number; recent_messages: number; summary_chars: number; context_chars: number; max_retry: number; content_repair_attempts: number; plan_repair_attempts: number;
};
type PolicyState = { current: Policy; history: Policy[]; defaults: Policy; effective_prompt: string };
const sections = [
  ["instructions", "核心规则", "始终加载：品牌语气、业务定位和整体回答要求。", 12000],
  ["intent_guidance", "SKILL · 意图与填槽", "媒体创作时按需加载：区分写稿、生成、纠错和增量修改。", 6000],
  ["research_guidance", "SKILL · 联网研究", "启用联网搜索时按需加载：来源质量、时效、榜单和事实边界。", 6000],
  ["creation_guidance", "SKILL · 媒体创作", "图片、视频、语音或音乐创作时按需加载；也传入成片规划阶段。", 6000],
  ["document_guidance", "SKILL · 文档处理", "读取、撰写、连续修改、导出文档或文档转图片时按需加载。", 6000],
  ["recovery_guidance", "SKILL · 任务恢复", "用户询问已执行任务的失败或异常时按需加载；不授权自动重跑。", 6000],
] as const;
const numericFields = [
  ["max_duration_sec", "成品最大秒数", 1, 600], ["recent_messages", "近期完整消息条数", 4, 40],
  ["summary_chars", "较早历史摘录字数", 500, 8000], ["context_chars", "送入模型的近期上下文字数", 8000, 80000], ["max_retry", "媒体阶段重试上限", 0, 3],
  ["content_repair_attempts", "不合格提示词自动修复次数", 0, 1],
  ["plan_repair_attempts", "规划格式自动修复次数", 0, 1],
] as const;
const versionLabel = (version: number) => version === 0 ? "内置策略 · 未发布自定义版本" : `已发布 v${version}`;

export function AgentPolicyEditor() {
  const [state, setState] = useState<PolicyState | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [active, setActive] = useState<(typeof sections)[number][0]>("intent_guidance");
  const changed = !!draft && !!state && JSON.stringify(draft) !== JSON.stringify(state.current);
  const chars = draft ? sections.reduce((sum, [key]) => sum + Array.from(draft[key] || "").length, 0) : 0;
  const invalid = !!draft && (chars > 15900 || numericFields.some(([key, , min, max]) => !Number.isInteger(draft[key]) || draft[key] < min || draft[key] > max));
  const load = async (discard = false) => {
    if (busy || (discard && changed && !window.confirm("刷新会丢弃未发布的策略修改，继续？"))) return;
    setBusy(true); setMessage("");
    try {
      const next = await adminApi<PolicyState>("/agents/general_creative_agent/policy");
      setState(next); setDraft(next.current);
    } catch (err) { setMessage(err instanceof Error ? err.message : "策略加载失败"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []); // Explicit refresh never silently replaces edits.
  const save = async (rollback?: number) => {
    if (!state || !draft || busy || (rollback === undefined && invalid)) return;
    if (rollback !== undefined && !window.confirm(`将历史版本 ${rollback} 发布为新版本？不会删除现有版本，也不会启动任务。`)) return;
    setBusy(true); setMessage("");
    try {
      const next = await adminApi<PolicyState>("/agents/general_creative_agent/policy", { method: "PUT", body: JSON.stringify({ base_version: state.current.version, policy: draft, ...(rollback !== undefined ? { rollback_version: rollback } : {}) }) });
      setState(next); setDraft(next.current); setMessage(`策略 v${next.current.version} 已发布。新对话轮次读取新策略；待执行方案需重新核对确认，已有任务不自动重跑。`);
    } catch (err) { setMessage(err instanceof Error ? err.message : "保存失败"); }
    finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-gray-200 p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold">Agent 理解与业务策略</h3><p className="mt-1 text-xs text-gray-500">{state ? versionLabel(state.current.version) : "读取策略中…"}{changed ? " · 有未发布修改" : ""}</p></div>
      <button type="button" disabled={busy} onClick={() => void load(true)} className="text-xs text-gray-500 disabled:opacity-40">刷新策略</button>
    </div>
    <p className="text-xs leading-5 text-gray-500">LLM 负责理解与内容规划，服务端规则负责验证与执行。核心规则始终加载，其余内置 SKILL 仅在相关请求中加载；这里修改的是指导文本，不是模型训练，也不能绕过确认、权限和计费。</p>
    {draft && <fieldset disabled={busy} className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="策略分类">{sections.map(([key, title]) => <button type="button" role="tab" aria-selected={active === key} aria-controls={`policy-panel-${key}`} id={`policy-tab-${key}`} key={key} onClick={() => setActive(key)} className={`rounded-lg px-3 py-2 text-xs ${active === key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>{title}</button>)}</div>
      {sections.filter(([key]) => active === key).map(([key, title, hint, max]) => <div key={key} role="tabpanel" id={`policy-panel-${key}`} aria-labelledby={`policy-tab-${key}`}>
        <label className="block text-xs font-medium" htmlFor={`policy-${key}`}>{title}</label><p className="my-2 text-xs leading-5 text-gray-500">{hint}</p>
        <textarea id={`policy-${key}`} rows={12} className="admin-input min-h-[240px] leading-6" maxLength={max} value={draft[key] || ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        <p className="mt-1 text-right text-xs text-gray-400">本项 {Array.from(draft[key] || "").length} / {max} 字 · 全部指导 {chars} / 15900 字</p>
      </div>)}
      <details className="rounded-xl bg-gray-50 p-3"><summary className="cursor-pointer text-xs font-medium">执行与记忆参数（规则直接生效）</summary><div className="mt-3 space-y-3">
        <label className="block text-xs">默认风格（留空交由当前需求决定）<input className="admin-input mt-1" maxLength={200} value={draft.default_style} onChange={(e) => setDraft({ ...draft, default_style: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-3">{numericFields.map(([key, label, min, max]) => <label key={key} className="text-xs">{label}<input type="number" min={min} max={max} step={1} className="admin-input mt-1" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} /><span className="text-gray-400">范围 {min}–{max}</span></label>)}</div>
        <p className="text-xs leading-5 text-gray-500">旧历史摘录和上下文压缩不额外调用模型。内容或规划格式修复设为1时，仅在对应验收失败后额外调用一次当前文字模型，按该模型计费；仍不合格则停止，不生成媒体。设为0可关闭对应修复。合成共享音画余量不调用模型、不改变目标总时长。</p>
      </div></details>
      <details className="rounded-xl border border-gray-100 p-3"><summary className="cursor-pointer text-xs font-medium">不可绕过的执行边界</summary><p className="mt-2 text-xs leading-6 text-gray-500">用户确认才执行；槽位白名单与修改依据校验；按模型实际时长规划分段；无效分镜不生成素材；会话归属、权限和计费校验。后台指导不能关闭这些保护。</p></details>
      <details className="rounded-xl border border-gray-100 p-3"><summary className="cursor-pointer text-xs font-medium">当前生效的核心规则与 SKILL 全集</summary><p className="mt-2 text-xs text-gray-500">这里展示可用全集；实际对话只注入核心规则和当前请求命中的 SKILL。固定输出协议、槽位、上下文和模型能力不在这里展示。</p><pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-6">{state?.effective_prompt}</pre></details>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || invalid || (!changed && state?.current.version !== 0)} onClick={() => void save()} className="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white disabled:opacity-40">{busy ? "处理中…" : "发布策略新版本"}</button>
        <button type="button" onClick={() => { if (state && window.confirm("用当前内置指导替换编辑稿？发布前不会生效。")) setDraft({ ...state.defaults, version: state.current.version, updated_at: state.current.updated_at }); }} className="text-xs text-gray-500">载入内置策略到编辑稿</button>
      </div>
      {invalid && <p role="alert" className="text-xs text-red-600">请检查整数参数范围，并将全部指导控制在 15900 字以内。</p>}
      {state && state.history.length > 0 && <details><summary className="cursor-pointer text-xs">最近 10 个策略版本与回滚</summary>{state.history.map((old) => <div key={old.version} className="flex items-center justify-between border-b py-2 text-xs"><span>{versionLabel(old.version)} · {old.updated_at ? new Date(old.updated_at).toLocaleString() : "内置默认"}</span><button type="button" onClick={() => void save(old.version)} className="text-blue-600">回滚并发布</button></div>)}</details>}
    </fieldset>}
    {message && <p role="status" className="text-xs text-gray-600">{message}</p>}
  </section>;
}
