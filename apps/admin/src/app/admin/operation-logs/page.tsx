"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api";

interface OperationLog {
  id: number;
  admin_email: string;
  action: string;
  target_type?: string;
  target_id?: string;
  detail: Record<string, unknown>;
  created_at: string;
}

const PAGE_SIZE = 20;

export default function OperationLogsPage() {
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [admin, setAdmin] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selected, setSelected] = useState<OperationLog | null>(null);
  const [loading, setLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("page_size", String(PAGE_SIZE));
    if (admin.trim()) sp.set("admin", admin.trim());
    if (startDate) sp.set("start_date", startDate);
    if (endDate) sp.set("end_date", endDate);
    return sp.toString();
  }, [admin, endDate, page, startDate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi<{ items: OperationLog[]; total: number }>(`/operation-logs?${query}`);
      setLogs(res.items || []);
      setTotal(res.total || 0);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load().catch((err) => alert(err instanceof Error ? err.message : "加载失败"));
  }, [load]);

  const applyFilter = () => {
    setPage(1);
    load().catch((err) => alert(err instanceof Error ? err.message : "查询失败"));
  };

  const viewLog = async (id: number) => {
    const item = await adminApi<OperationLog>(`/operation-logs/${id}`);
    setSelected(item);
  };

  const deleteLog = async (id: number) => {
    if (!confirm("确认删除这条操作日志？删除后不可恢复。")) return;
    await adminApi(`/operation-logs/${id}`, { method: "DELETE" });
    await load();
  };

  const clearLogs = async () => {
    if (!confirm("确认删除全部操作日志？该操作不可恢复。")) return;
    await adminApi("/operation-logs", { method: "DELETE" });
    setPage(1);
    await load();
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">操作日志</h1>
          <p className="mt-1 text-sm text-gray-500">记录后台管理员的关键操作，支持按管理员与时间筛选。</p>
        </div>
        <button onClick={clearLogs} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
          删除日志
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">管理员</span>
          <input value={admin} onChange={(e) => setAdmin(e.target.value)} placeholder="邮箱关键词" className="w-56 rounded-xl border px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">开始日期</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">结束日期</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
        </label>
        <button onClick={applyFilter} className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white">搜索</button>
        <button
          onClick={() => {
            setAdmin("");
            setStartDate("");
            setEndDate("");
            setPage(1);
          }}
          className="rounded-xl border px-4 py-2 text-sm text-gray-600"
        >
          重置
        </button>
        <span className="ml-auto text-xs text-gray-400">共 {total} 条，每页 {PAGE_SIZE} 条</span>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">管理员</th>
              <th className="px-4 py-3 text-left">操作</th>
              <th className="px-4 py-3 text-left">对象</th>
              <th className="px-4 py-3 text-left">详情</th>
              <th className="px-4 py-3 text-left">时间</th>
              <th className="px-4 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3">{l.admin_email || "-"}</td>
                <td className="px-4 py-3 font-medium">{l.action}</td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {l.target_type || "-"}{l.target_id ? ` #${l.target_id}` : ""}
                </td>
                <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-gray-400">
                  {l.detail && Object.keys(l.detail).length ? JSON.stringify(l.detail) : "-"}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{new Date(l.created_at).toLocaleString("zh-CN", { hour12: false })}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => viewLog(l.id)} className="text-xs text-secondary hover:underline">查看</button>
                    <button onClick={() => deleteLog(l.id)} className="text-xs text-red-500 hover:underline">删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">{loading ? "加载中..." : "暂无日志"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40">上一页</button>
        <span className="text-sm text-gray-500">{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40">下一页</button>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-gray-950">日志详情</h3>
              <button onClick={() => setSelected(null)} className="text-sm text-gray-400 hover:text-gray-600">关闭</button>
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <Info label="管理员" value={selected.admin_email || "-"} />
              <Info label="操作" value={selected.action} />
              <Info label="对象" value={`${selected.target_type || "-"}${selected.target_id ? ` #${selected.target_id}` : ""}`} />
              <Info label="时间" value={new Date(selected.created_at).toLocaleString("zh-CN", { hour12: false })} />
            </div>
            <pre className="mt-4 max-h-[48vh] overflow-auto rounded-xl bg-gray-950 p-4 text-xs leading-6 text-gray-100">
              {JSON.stringify(selected.detail || {}, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-gray-50 px-3 py-2.5">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="mt-0.5 break-all text-sm text-gray-900">{value}</div>
    </div>
  );
}
