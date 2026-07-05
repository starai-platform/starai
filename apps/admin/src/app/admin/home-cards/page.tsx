"use client";

import { useEffect, useState } from "react";
import { adminApi, adminUploadFile } from "@/lib/api";

interface HomeCard {
  id: number;
  key: string;
  title: string;
  description?: string;
  icon_url?: string;
  icon_emoji?: string;
  theme: string;
  sort_order: number;
  is_enabled: boolean;
}

const THEMES = ["gray", "amber", "purple", "blue", "pink", "green"] as const;

const empty = {
  key: "",
  title: "",
  description: "",
  icon_url: "",
  icon_emoji: "✨",
  theme: "gray",
  sort_order: 0,
  is_enabled: true,
};

export default function HomeCardsAdminPage() {
  const [items, setItems] = useState<HomeCard[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [err, setErr] = useState("");

  const load = () => adminApi<{ items: HomeCard[] }>("/home/cards").then((r) => setItems(r.items || []));
  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setForm({ ...empty });
    setErr("");
    setShow(true);
  };

  const openEdit = (c: HomeCard) => {
    setForm({
      key: c.key,
      title: c.title,
      description: c.description || "",
      icon_url: c.icon_url || "",
      icon_emoji: c.icon_emoji || "",
      theme: c.theme || "gray",
      sort_order: c.sort_order || 0,
      is_enabled: c.is_enabled,
    });
    setErr("");
    setShow(true);
  };

  const uploadIcon = async (file: File) => {
    const url = await adminUploadFile(file);
    setForm((prev) => ({ ...prev, icon_url: url }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await adminApi("/home/cards", { method: "POST", body: JSON.stringify(form) });
      setShow(false);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "保存失败");
    }
  };

  const remove = async (key: string) => {
    if (!confirm(`确认删除卡片 ${key}？`)) return;
    await adminApi(`/home/cards/${key}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">多模型协作卡片</h1>
        <button onClick={openCreate} className="px-4 py-2 rounded-xl bg-primary text-dark font-semibold text-sm">
          新增卡片
        </button>
      </div>

      {show && (
        <form onSubmit={save} className="bg-white rounded-2xl border p-6 mb-6 grid grid-cols-2 gap-4">
          <div className="col-span-2 flex items-center justify-between">
            <h2 className="font-semibold">编辑卡片</h2>
            <button type="button" onClick={() => setShow(false)} className="text-sm text-gray-400 hover:text-gray-600">
              取消
            </button>
          </div>
          <div>
            <label className="text-xs text-gray-500">key（唯一）</label>
            <input
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">标题</label>
            <input
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500">描述</label>
            <input
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="col-span-2">
            <label className="text-xs text-gray-500">图标</label>
            <div className="mt-1 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center text-lg">
                {form.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.icon_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{form.icon_emoji || "✨"}</span>
                )}
              </div>
              <label className="px-3 py-2 rounded-lg border text-sm cursor-pointer hover:bg-gray-50">
                上传图片
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadIcon(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <input
                className="flex-1 px-3 py-2 rounded-lg border text-sm"
                placeholder="或粘贴 icon_url"
                value={form.icon_url}
                onChange={(e) => setForm({ ...form, icon_url: e.target.value })}
              />
              <input
                className="w-24 px-3 py-2 rounded-lg border text-sm"
                placeholder="emoji"
                value={form.icon_emoji}
                onChange={(e) => setForm({ ...form, icon_emoji: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">主题色</label>
            <select
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value })}
            >
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">排序</label>
            <input
              type="number"
              className="w-full mt-1 px-3 py-2 rounded-lg border text-sm"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_enabled}
              onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
            />
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
              <th className="text-left px-4 py-3">标题</th>
              <th className="text-left px-4 py-3">主题</th>
              <th className="text-left px-4 py-3">排序</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((c) => (
              <tr key={c.key}>
                <td className="px-4 py-3 font-mono text-xs">{c.key}</td>
                <td className="px-4 py-3">{c.title}</td>
                <td className="px-4 py-3">{c.theme}</td>
                <td className="px-4 py-3">{c.sort_order}</td>
                <td className="px-4 py-3">{c.is_enabled ? <span className="text-green-600">启用</span> : <span className="text-gray-400">禁用</span>}</td>
                <td className="px-4 py-3 space-x-3">
                  <button onClick={() => openEdit(c)} className="text-xs text-secondary hover:underline">
                    编辑
                  </button>
                  <button onClick={() => remove(c.key)} className="text-xs text-red-500 hover:underline">
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-10">
                  暂无卡片
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

