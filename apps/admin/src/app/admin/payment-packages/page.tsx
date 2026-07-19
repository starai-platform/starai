"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { adminApi } from "@/lib/api";

type PaymentPackage = {
  public_id: string;
  name: string;
  amount: number;
  badge: string;
  is_enabled: boolean;
  sort_order: number;
  updated_at: string;
};

const EMPTY = { name: "", amount: 10, badge: "", is_enabled: true, sort_order: 10 };

export default function PaymentPackagesPage() {
  const [items, setItems] = useState<PaymentPackage[]>([]);
  const [editing, setEditing] = useState<PaymentPackage | null | undefined>(undefined);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const result = await adminApi<{ items: PaymentPackage[] }>("/payment-packages");
      setItems(result.items || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载充值套餐失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, sort_order: (items.at(-1)?.sort_order || 0) + 10 });
    setMessage("");
  };

  const openEdit = (item: PaymentPackage) => {
    setEditing(item);
    setForm({ name: item.name, amount: item.amount, badge: item.badge || "", is_enabled: item.is_enabled, sort_order: item.sort_order });
    setMessage("");
  };

  const save = async () => {
    if (saving || form.amount <= 0) return;
    setSaving(true);
    setMessage("");
    try {
      await adminApi(editing?.public_id ? `/payment-packages/${editing.public_id}` : "/payment-packages", {
        method: editing?.public_id ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });
      setEditing(undefined);
      await load();
      setMessage("充值套餐已保存，前台下次打开充值窗口立即生效。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: PaymentPackage) => {
    if (!window.confirm(`确定删除充值套餐「${item.name || item.amount}」吗？历史订单金额不会受影响。`)) return;
    setMessage("");
    try {
      await adminApi(`/payment-packages/${item.public_id}`, { method: "DELETE" });
      await load();
      setMessage("充值套餐已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-950">在线充值套餐</h1><p className="mt-1 text-sm text-gray-500">管理工作台“充值 → 在线支付”显示的金额档位。订单金额以服务端套餐为准，不能由前端自行修改。</p></div>
        <button type="button" onClick={openCreate} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-dark"><Plus size={16} />新增套餐</button>
      </div>

      {message && <div className={`rounded-xl px-4 py-3 text-sm ${message.includes("失败") || message.includes("不存在") || message.includes("相同") ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{message}</div>}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-3 text-left">名称</th><th className="px-4 py-3 text-left">支付金额</th><th className="px-4 py-3 text-left">角标</th><th className="px-4 py-3 text-left">排序</th><th className="px-4 py-3 text-left">状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item) => <tr key={item.public_id} className="hover:bg-gray-50/70"><td className="px-4 py-3 font-medium text-gray-900">{item.name}</td><td className="px-4 py-3 font-semibold text-gray-950">{item.amount.toFixed(2)}</td><td className="px-4 py-3">{item.badge ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700">{item.badge}</span> : <span className="text-gray-300">—</span>}</td><td className="px-4 py-3 text-gray-500">{item.sort_order}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${item.is_enabled ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400"}`}>{item.is_enabled ? "前台显示" : "已停用"}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" onClick={() => openEdit(item)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"><Pencil size={13} />编辑</button><button type="button" onClick={() => void remove(item)} className="inline-flex items-center gap-1 rounded-lg border border-red-100 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"><Trash2 size={13} />删除</button></div></td></tr>)}
            {!loading && items.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">暂无充值套餐，请点击右上角新增。</td></tr>}
            {loading && <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">加载中...</td></tr>}
          </tbody>
        </table>
      </div>

      {editing !== undefined && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(undefined)}><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-gray-950">{editing ? "编辑充值套餐" : "新增充值套餐"}</h2><p className="mt-1 text-xs text-gray-400">币种使用系统支付配置中的统一币种。</p></div><button type="button" onClick={() => setEditing(undefined)} className="rounded-lg bg-gray-100 p-2 text-gray-500"><X size={16} /></button></div><div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-gray-500">套餐名称</span><input value={form.name} maxLength={128} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：入门套餐" className="admin-input" /></label><label><span className="mb-1.5 block text-xs text-gray-500">支付金额</span><input type="number" min="0.01" max="1000000" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })} className="admin-input" /></label><label><span className="mb-1.5 block text-xs text-gray-500">排序</span><input type="number" value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) || 0 })} className="admin-input" /></label><label className="sm:col-span-2"><span className="mb-1.5 block text-xs text-gray-500">角标（可选）</span><input value={form.badge} maxLength={64} onChange={(event) => setForm({ ...form, badge: event.target.value })} placeholder="例如：热门、最划算" className="admin-input" /></label><label className="sm:col-span-2 flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm text-gray-700"><input type="checkbox" checked={form.is_enabled} onChange={(event) => setForm({ ...form, is_enabled: event.target.checked })} />启用后在前台在线支付中显示</label></div><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setEditing(undefined)} className="h-10 rounded-xl border border-gray-200 px-4 text-sm text-gray-600">取消</button><button type="button" disabled={saving || form.amount <= 0} onClick={() => void save()} className="h-10 rounded-xl bg-primary px-5 text-sm font-semibold text-dark disabled:opacity-50">{saving ? "保存中..." : "保存"}</button></div></div></div>}
    </div>
  );
}
