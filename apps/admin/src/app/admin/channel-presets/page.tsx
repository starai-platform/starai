"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";

interface Preset {
  id: number;
  key: string;
  name: string;
  description?: string;
  strategy: string;
  is_fallback_enabled: boolean;
  model_codes: string[];
  answer_model_codes?: string[];
  summary_model_codes?: string[];
  is_enabled: boolean;
  sort_order: number;
}

interface AdminModel {
  id: number;
  code: string;
  display_name: string;
  icon_url?: string;
  category: string;
  is_enabled: boolean;
  sort_order: number;
}

const empty = {
  key: "",
  name: "",
  description: "",
  strategy: "price_first",
  is_fallback_enabled: true,
  model_codes: [] as string[],
  answer_model_codes: [] as string[],
  summary_model_codes: [] as string[],
  is_enabled: true,
  sort_order: 0,
};

export default function ChannelPresetsPage() {
  const [items, setItems] = useState<Preset[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [err, setErr] = useState("");

  const load = () => adminApi<{ items: Preset[] }>("/channel-presets").then((r) => setItems(r.items || []));
  const loadModels = () => adminApi<AdminModel[]>("/models").then((r) => setModels(r || []));
  useEffect(() => {
    load();
    loadModels();
  }, []);

  const openCreate = () => {
    setForm({ ...empty });
    setErr("");
    setShow(true);
  };

  const openEdit = (p: Preset) => {
    setForm({
      ...p,
      description: p.description || "",
      answer_model_codes: p.answer_model_codes?.length ? p.answer_model_codes : p.model_codes || [],
      summary_model_codes: p.summary_model_codes || [],
    } as any);
    setErr("");
    setShow(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    const answerCodes = form.answer_model_codes?.length ? form.answer_model_codes : form.model_codes || [];
    const summaryCodes = form.summary_model_codes || [];
    if (answerCodes.length < 2) {
      setErr("问答模型至少选择 2 个");
      return;
    }
    if (summaryCodes.length < 1) {
      setErr("总结模型至少选择 1 个");
      return;
    }
    const payload = {
      key: form.key,
      name: form.name,
      description: form.description,
      strategy: form.strategy,
      is_fallback_enabled: form.is_fallback_enabled,
      model_codes: answerCodes,
      answer_model_codes: answerCodes,
      summary_model_codes: summaryCodes,
      is_enabled: form.is_enabled,
      sort_order: Number(form.sort_order) || 0,
    };
    try {
      await adminApi("/channel-presets", { method: "POST", body: JSON.stringify(payload) });
      setShow(false);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "保存失败");
    }
  };

  const chatModels = models
    .filter((m) => m.is_enabled && m.category === "chat" && m.code !== "multi_collab_chat")
    .sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name));

  const toggleModelCode = (field: "answer_model_codes" | "summary_model_codes", code: string) => {
    setForm((prev) => {
      const selected = prev[field] || [];
      return {
        ...prev,
        [field]: selected.includes(code) ? selected.filter((x) => x !== code) : [...selected, code],
      };
    });
  };

  const ModelPicker = ({
    title,
    hint,
    field,
    min,
  }: {
    title: string;
    hint: string;
    field: "answer_model_codes" | "summary_model_codes";
    min: number;
  }) => {
    const selectedCodes = form[field] || [];
    return (
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <label className="text-xs text-gray-500">{title}</label>
            <div className="text-[11px] text-gray-400 mt-1">{hint}</div>
          </div>
          <span className={`text-xs ${selectedCodes.length < min ? "text-red-500" : "text-gray-500"}`}>
            已选 {selectedCodes.length} 个 / 最少 {min} 个
          </span>
        </div>
        {chatModels.length === 0 ? (
          <div className="rounded-xl border bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
            暂无可选聊天模型，请先在模型管理中接入并启用聊天模型。
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {chatModels.map((m) => {
              const selected = selectedCodes.includes(m.code);
              return (
                <button
                  key={`${field}-${m.code}`}
                  type="button"
                  onClick={() => toggleModelCode(field, m.code)}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                    selected ? "bg-primary/5 border-primary/40 ring-2 ring-primary/10" : "bg-white border-gray-100 hover:border-gray-200"
                  }`}
                >
                  <span className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                    {m.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.icon_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-gray-400">AI</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900 truncate">{m.display_name}</span>
                    <span className="block text-[11px] text-gray-400 truncate">{m.code}</span>
                  </span>
                  <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[11px] ${selected ? "bg-primary border-primary text-dark" : "border-gray-200 text-transparent"}`}>
                    ✓
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const remove = async (key: string) => {
    if (!confirm(`确认删除预设 ${key}？`)) return;
    await adminApi(`/channel-presets/${key}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">渠道预设</h1>
        <button onClick={openCreate} className="px-4 py-2 rounded-xl bg-primary text-dark font-semibold text-sm">
          新增预设
        </button>
      </div>

      {show && (
        <form onSubmit={save} className="bg-white rounded-2xl border p-6 mb-6 grid grid-cols-2 gap-4">
          <div className="col-span-2 flex items-center justify-between">
            <h2 className="font-semibold">编辑预设</h2>
            <button type="button" onClick={() => setShow(false)} className="text-sm text-gray-400 hover:text-gray-600">
              取消
            </button>
          </div>
          <div>
            <label className="text-xs text-gray-500">key</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required />
          </div>
          <div>
            <label className="text-xs text-gray-500">名称</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500">描述</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-500">策略</label>
            <select className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}>
              <option value="success_first">success_first</option>
              <option value="speed_first">speed_first</option>
              <option value="price_first">price_first</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">排序</label>
            <input type="number" className="w-full mt-1 px-3 py-2 rounded-lg border text-sm" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} />
          </div>
          <div className="col-span-2">
            <div className="space-y-5">
              <ModelPicker
                title="问答模型"
                hint="至少选择 2 个模型并行回答，系统会分别展示各模型输出。"
                field="answer_model_codes"
                min={2}
              />
              <ModelPicker
                title="总结模型"
                hint="至少选择 1 个模型，用于融合/总结问答模型的输出。"
                field="summary_model_codes"
                min={1}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_fallback_enabled} onChange={(e) => setForm({ ...form, is_fallback_enabled: e.target.checked })} />
            自动容错
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} />
            启用
          </label>
          {err && <p className="col-span-2 text-sm text-red-500">{err}</p>}
          <button type="submit" className="col-span-2 py-2 bg-primary rounded-xl text-dark font-semibold">
            保存
          </button>
        </form>
      )}

      <div className="bg-white rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-4 py-3">key</th>
              <th className="text-left px-4 py-3">名称</th>
              <th className="text-left px-4 py-3">策略</th>
              <th className="text-left px-4 py-3">问答/总结</th>
              <th className="text-left px-4 py-3">自动容错</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((p) => (
              <tr key={p.key}>
                <td className="px-4 py-3 font-mono text-xs">{p.key}</td>
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{p.strategy}</td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {(p.answer_model_codes?.length || p.model_codes?.length || 0)} / {(p.summary_model_codes?.length || 0)}
                </td>
                <td className="px-4 py-3">{p.is_fallback_enabled ? "是" : "否"}</td>
                <td className="px-4 py-3">{p.is_enabled ? <span className="text-green-600">启用</span> : <span className="text-gray-400">禁用</span>}</td>
                <td className="px-4 py-3 space-x-3">
                  <button onClick={() => openEdit(p)} className="text-xs text-secondary hover:underline">
                    编辑
                  </button>
                  <button onClick={() => remove(p.key)} className="text-xs text-red-500 hover:underline">
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-10">
                  暂无预设
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

