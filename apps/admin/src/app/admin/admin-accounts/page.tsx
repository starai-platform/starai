"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";

interface AdminAccount {
  id: number;
  email: string;
  role: "super_admin" | "operator" | string;
  status: "active" | "disabled" | string;
  created_at: string;
  updated_at: string;
}

const EMPTY = { email: "", password: "", role: "operator", status: "active" };

export default function AdminAccountsPage() {
  const [items, setItems] = useState<AdminAccount[]>([]);
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await adminApi<{ items: AdminAccount[] }>("/admin-accounts");
    setItems(res.items || []);
  };

  useEffect(() => {
    load().catch((err) => alert(err instanceof Error ? err.message : "加载失败"));
  }, []);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const startEdit = (item: AdminAccount) => {
    setEditing(item);
    setForm({ email: item.email, password: "", role: item.role || "operator", status: item.status || "active" });
  };

  const save = async () => {
    if (!form.email.trim()) return alert("请填写邮箱");
    if (!editing && form.password.trim().length < 6) return alert("新建管理员需要设置至少 6 位密码");
    setSaving(true);
    try {
      const body = {
        email: form.email.trim(),
        password: form.password.trim(),
        role: form.role,
        status: form.status,
      };
      if (editing) {
        await adminApi(`/admin-accounts/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await adminApi("/admin-accounts", { method: "POST", body: JSON.stringify(body) });
      }
      startCreate();
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-950">管理员账号</h1>
        <p className="mt-1 text-sm text-gray-500">管理后台登录账号、角色和账号状态。操作员默认不能管理管理员账号。</p>
      </div>

      <div className="mb-5 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-5">
        <input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="邮箱" className="rounded-xl border px-3 py-2 text-sm md:col-span-2" />
        <input type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder={editing ? "重置密码（留空不改）" : "登录密码"} className="rounded-xl border px-3 py-2 text-sm" />
        <select value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm">
          <option value="operator">操作员</option>
          <option value="super_admin">超级管理员</option>
        </select>
        <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm">
          <option value="active">启用</option>
          <option value="disabled">禁用</option>
        </select>
        <div className="flex gap-2 md:col-span-5">
          <button onClick={save} disabled={saving} className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "保存中..." : editing ? "保存修改" : "新增管理员"}
          </button>
          {editing && <button onClick={startCreate} className="rounded-xl border px-4 py-2 text-sm text-gray-600">取消编辑</button>}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">账号</th>
              <th className="px-4 py-3 text-left">角色</th>
              <th className="px-4 py-3 text-left">状态</th>
              <th className="px-4 py-3 text-left">创建时间</th>
              <th className="px-4 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 font-medium text-gray-950">{item.email}</td>
                <td className="px-4 py-3">{item.role === "super_admin" ? "超级管理员" : "操作员"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${item.status === "active" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                    {item.status === "active" ? "启用" : "禁用"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{new Date(item.created_at).toLocaleString("zh-CN", { hour12: false })}</td>
                <td className="px-4 py-3">
                  <button onClick={() => startEdit(item)} className="text-xs text-secondary hover:underline">编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
