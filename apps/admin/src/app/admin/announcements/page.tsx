"use client";

import { useEffect, useMemo, useState } from "react";
import { BellRing, Megaphone, Pencil, Send, Trash2 } from "lucide-react";
import { adminApi } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

interface Announcement {
  id: number;
  title: string;
  content: string;
  level: string;
  is_published: boolean;
  is_forced?: boolean;
  created_at: string;
}

const EMPTY = { title: "", content: "", level: "info", is_published: true, is_forced: false };
const PAGE_SIZE = 10;

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [page, setPage] = useState(1);
  const paginatedItems = useMemo(() => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [items, page]);

  const load = () => adminApi<{ items: Announcement[] }>("/announcements").then((r) => setItems(r.items || []));

  useEffect(() => {
    load();
  }, []);

  const submit = async (publish?: boolean) => {
    if (!form.title.trim() || !form.content.trim()) {
      setMsg("请填写公告标题和内容");
      return;
    }
    const payload = { ...form, is_published: publish !== undefined ? publish : form.is_published };
    setSaving(true);
    setMsg("");
    try {
      if (editingId) {
        await adminApi(`/announcements/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setMsg(payload.is_published ? "公告已保存并发布" : "公告已保存为草稿");
      } else {
        await adminApi("/announcements", { method: "POST", body: JSON.stringify(payload) });
        setMsg(payload.is_forced ? "强制公告已发布，用户前台会弹窗展示" : payload.is_published ? "普通公告已发布" : "草稿已保存");
      }
      setForm(EMPTY);
      setEditingId(null);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (a: Announcement) => {
    await adminApi(`/announcements/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: a.title,
        content: a.content,
        level: a.level,
        is_published: !a.is_published,
        is_forced: !!a.is_forced,
      }),
    });
    load();
  };

  const edit = (a: Announcement) => {
    setEditingId(a.id);
    setForm({ title: a.title, content: a.content, level: a.level, is_published: a.is_published, is_forced: !!a.is_forced });
    setMsg("");
  };

  const pushNotify = async (a: Announcement) => {
    if (!a.is_published) return;
    if (!confirm(`确定将「${a.title}」推送到所有用户的通知铃铛？`)) return;
    try {
      await adminApi(`/announcements/${a.id}/push-notifications`, { method: "POST" });
      setMsg("已推送到用户通知铃铛");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "推送失败");
    }
  };

  const remove = async (id: number) => {
    if (!confirm("确定删除这条公告？")) return;
    await adminApi(`/announcements/${id}`, { method: "DELETE" });
    if (editingId === id) {
      setEditingId(null);
      setForm(EMPTY);
    }
    load();
  };

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-950">公告管理</h1>
        <p className="mt-1 text-sm text-gray-500">
          普通公告展示在用户公告列表；勾选强制公告后，已发布公告会在前台自动弹窗，用户确认后不再重复展示同一条。
        </p>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Megaphone size={18} className="text-gray-700" />
          <h2 className="font-semibold text-gray-900">{editingId ? "编辑公告" : "新建公告"}</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="公告标题（必填）"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="公告内容（必填）"
              rows={6}
              className="w-full resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-4 rounded-xl bg-gray-50 p-4">
            <div>
              <label className="text-xs text-gray-500">公告级别</label>
              <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                <option value="info">信息</option>
                <option value="success">成功</option>
                <option value="warning">警告</option>
              </select>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white p-3 text-sm text-gray-700">
              <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} className="mt-0.5 rounded" />
              <span>
                <span className="block font-medium">立即发布</span>
                <span className="mt-0.5 block text-xs text-gray-400">默认开启，用户前台可见。</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
              <input type="checkbox" checked={form.is_forced} onChange={(e) => setForm({ ...form, is_forced: e.target.checked })} className="mt-0.5 rounded" />
              <span>
                <span className="block font-semibold">强制弹窗公告</span>
                <span className="mt-0.5 block text-xs text-amber-700/75">发布后前台自动弹窗展示。</span>
              </span>
            </label>
          </div>
        </div>

        {msg && <p className={`mt-4 text-sm ${msg.includes("失败") ? "text-red-600" : "text-emerald-600"}`}>{msg}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
          <button type="button" disabled={saving} onClick={() => submit(true)} className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-6 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
            <Send size={16} />
            {saving ? "提交中..." : editingId ? "保存并发布" : "发布公告"}
          </button>
          <button type="button" disabled={saving} onClick={() => submit(false)} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            存为草稿
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY); setMsg(""); }} className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700">
              取消编辑
            </button>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="font-semibold text-gray-950">公告列表</h2>
          <span className="text-xs text-gray-400">{items.length} 条</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">标题</th>
                <th className="px-4 py-3 text-left">类型</th>
                <th className="px-4 py-3 text-left">状态</th>
                <th className="px-4 py-3 text-left">时间</th>
                <th className="px-4 py-3 text-left">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {paginatedItems.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50/70">
                  <td className="max-w-[360px] px-4 py-3">
                    <div className="font-medium text-gray-900">{a.title}</div>
                    <div className="mt-1 line-clamp-1 text-xs text-gray-400">{a.content}</div>
                  </td>
                  <td className="px-4 py-3">
                    {a.is_forced ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                        <BellRing size={12} /> 强制弹窗
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">普通公告</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {a.is_published ? <span className="text-green-600">已发布</span> : <span className="text-gray-400">草稿</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => edit(a)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                        <Pencil size={13} /> 编辑
                      </button>
                      <button onClick={() => togglePublish(a)} className="text-xs text-blue-600 hover:underline">
                        {a.is_published ? "下架" : "发布"}
                      </button>
                      {a.is_published && (
                        <button onClick={() => pushNotify(a)} className="text-xs text-amber-600 hover:underline">
                          推送通知
                        </button>
                      )}
                      <button onClick={() => remove(a.id)} className="inline-flex items-center gap-1 text-xs text-red-500 hover:underline">
                        <Trash2 size={13} /> 删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400">暂无公告</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <AdminPagination page={page} total={items.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </section>
    </div>
  );
}
