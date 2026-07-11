"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

interface TranslationRow {
  source_id: number;
  entity_type: string;
  entity_key: string;
  field_path: string;
  source_locale: string;
  source_text: string;
  locale: string;
  value: string;
  status: string;
  translation_source: string;
  error_message?: string;
  updated_at: string;
}

interface ModelRow {
  code: string;
  display_name: string;
  request_mode: string;
  is_enabled: boolean;
}
interface TranslationStats { locale: string; total: number; pending: number; translated: number; reviewed: number; failed: number }

const PAGE_SIZE = 50;
const LOCALES = ["en-US", "ja-JP", "ko-KR", "vi-VN"];

export default function ContentTranslationsPage() {
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [locale, setLocale] = useState("en-US");
  const [entityType, setEntityType] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [modelCode, setModelCode] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [stats, setStats] = useState<TranslationStats[]>([]);
  const [autoEnabled, setAutoEnabled] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ locale, page: String(page), page_size: String(PAGE_SIZE) });
    if (entityType) params.set("entity_type", entityType);
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    const result = await adminApi<{ items: TranslationRow[]; total: number }>(`/content-translations?${params}`);
    setRows(result.items || []);
    setTotal(result.total || 0);
    const summary = await adminApi<{ items: TranslationStats[] }>(`/content-translations/stats${entityType ? `?entity_type=${entityType}` : ""}`);
    setStats(summary.items || []);
  }, [entityType, locale, page, search, status]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "翻译列表加载失败"));
  }, [load]);

  useEffect(() => {
    Promise.all([adminApi<ModelRow[]>("/models"), adminApi<Record<string, unknown>>("/system-configs")]).then(([items, cfg]) => {
      const chatModels = (items || []).filter((item) => item.is_enabled && item.request_mode === "chat_completions");
      setModels(chatModels);
      const configured = String(cfg.i18n_translation_model_code || "");
      setModelCode((current) => current || configured || chatModels[0]?.code || "");
      setAutoEnabled(cfg.i18n_auto_translate_enabled === true);
    }).catch(() => setModels([]));
  }, []);

  const save = async (row: TranslationRow, reviewed: boolean) => {
    setBusy(`save-${row.source_id}`);
    setError("");
    try {
      await adminApi(`/content-translations/${row.source_id}`, {
        method: "PUT",
        body: JSON.stringify({ locale, value: row.value, reviewed }),
      });
      setMessage(reviewed ? "翻译已保存并审核" : "翻译已保存");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy("");
    }
  };

  const syncCatalog = async () => {
    setBusy("sync");
    setError("");
    try {
      const result = await adminApi<{ entities: number }>("/content-translations/sync", { method: "POST" });
      setMessage(`已同步 ${result.entities} 个模型和工作流，只新增或重置发生变化的字段。`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步失败");
    } finally {
      setBusy("");
    }
  };

  const autoTranslate = async () => {
    if (!modelCode) {
      setError("请先选择翻译模型");
      return;
    }
    setBusy("translate");
    setError("");
    try {
      const result = await adminApi<{ translated: number }>("/content-translations/auto-translate", {
        method: "POST",
        body: JSON.stringify({ locale, model_code: modelCode, entity_type: entityType, limit: 50 }),
      });
      setMessage(`AI 已翻译 ${result.translated} 个字段。可继续执行，直到待翻译数量为 0。`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 翻译失败");
    } finally {
      setBusy("");
    }
  };

  const translateHistory = async () => {
    if (!modelCode) { setError("请先选择翻译模型"); return; }
    setBusy("history"); setError("");
    try {
      await adminApi("/content-translations/sync", { method: "POST" });
      let translated = 0;
      for (const targetLocale of LOCALES) {
        for (let batch = 0; batch < 20; batch++) {
          const result = await adminApi<{ translated: number }>("/content-translations/auto-translate", { method: "POST", body: JSON.stringify({ locale: targetLocale, model_code: modelCode, entity_type: entityType, limit: 50 }) });
          translated += result.translated;
          if (result.translated === 0) break;
        }
      }
      setMessage(`历史内容补翻完成，共生成 ${translated} 个译文。`); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "历史内容补翻失败"); }
    finally { setBusy(""); }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">动态内容翻译</h1>
          <p className="mt-1 text-sm text-gray-500">模型、工作流和参数显示文案由数据库按语言返回，不再为每个业务对象修改前端字典。</p>
        </div>
        <div className="flex gap-2">
          <button disabled={!!busy} onClick={syncCatalog} className="rounded-xl border bg-white px-4 py-2 text-sm disabled:opacity-50">{busy === "sync" ? "同步中..." : "同步全部内容"}</button>
          <button disabled={!!busy || !modelCode} onClick={autoTranslate} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-dark disabled:opacity-50">{busy === "translate" ? "翻译中..." : "AI 翻译当前缺失项"}</button>
          <button disabled={!!busy || !modelCode} onClick={translateHistory} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === "history" ? "历史补翻中..." : "补翻全部历史内容"}</button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-5">
        <select value={locale} onChange={(e) => { setLocale(e.target.value); setPage(1); }} className="admin-input">
          {LOCALES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className="admin-input">
          <option value="">全部内容类型</option>
          <option value="model">模型</option>
          <option value="workflow">工作流</option>
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="admin-input">
          <option value="">全部状态</option>
          <option value="pending">待翻译</option>
          <option value="translated">已翻译</option>
          <option value="reviewed">已审核</option>
          <option value="failed">失败</option>
        </select>
        <select value={modelCode} onChange={(e) => setModelCode(e.target.value)} className="admin-input">
          <option value="">选择 AI 翻译模型</option>
          {models.map((model) => <option key={model.code} value={model.code}>{model.display_name} / {model.code}</option>)}
        </select>
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="搜索编码、字段或内容" className="admin-input" />
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
      {message && <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      {!autoEnabled && <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">模型/工作流可以正常保存，但自动翻译尚未开启。请在系统设置指定并测试翻译模型后开启自动翻译。</div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => <div key={item.locale} className="rounded-2xl border bg-white p-4 text-sm"><div className="font-semibold">{item.locale}</div><div className="mt-2 text-gray-500">完成 {item.translated + item.reviewed}/{item.total} · 待翻译 {item.pending} · 失败 <span className={item.failed ? "text-red-600" : ""}>{item.failed}</span></div></div>)}
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={`${row.source_id}-${row.locale}`} className="rounded-2xl border bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-gray-900 px-2 py-1 text-white">{row.entity_type}</span>
              <span className="font-mono font-semibold">{row.entity_key}</span>
              <span className="font-mono text-gray-400">{row.field_path}</span>
              <span className={`ml-auto rounded-full px-2 py-1 ${row.status === "reviewed" ? "bg-emerald-50 text-emerald-700" : row.status === "pending" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{row.status}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-gray-400">原文（{row.source_locale}）</div>
                <div className="min-h-20 whitespace-pre-wrap rounded-xl bg-gray-50 px-3 py-2 text-sm leading-6">{row.source_text}</div>
              </div>
              <div>
                <div className="mb-1 text-xs text-gray-400">译文（{locale}）</div>
                <textarea value={row.value} onChange={(e) => setRows((current) => current.map((item) => item.source_id === row.source_id ? { ...item, value: e.target.value } : item))} className="min-h-20 w-full rounded-xl border px-3 py-2 text-sm leading-6 outline-none focus:border-primary" />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              {row.error_message && <div className="mr-auto rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">最近错误：{row.error_message}</div>}
              <button disabled={busy === `save-${row.source_id}` || !row.value.trim()} onClick={() => save(row, false)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">保存</button>
              <button disabled={busy === `save-${row.source_id}` || !row.value.trim()} onClick={() => save(row, true)} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white disabled:opacity-50">保存并审核</button>
            </div>
          </div>
        ))}
        {!rows.length && <div className="rounded-2xl border bg-white py-12 text-center text-sm text-gray-400">当前筛选条件下暂无翻译记录</div>}
      </div>

      <AdminPagination page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </div>
  );
}
