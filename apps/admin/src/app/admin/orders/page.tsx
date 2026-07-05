"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

interface Order {
  order_no: string;
  channel: string;
  amount: number;
  compute_credited: number;
  status: string;
  paid_at?: string;
  created_at: string;
  user_public_id: string;
  nickname: string;
}
const PAGE_SIZE = 20;

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    adminApi<{ items: Order[]; total: number }>(`/orders?page=${page}&page_size=${PAGE_SIZE}`).then((r) => {
      setOrders(r.items || []);
      setTotal(r.total || 0);
    });
  }, [page]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (status && o.status !== status) return false;
      if (
        kw &&
        !o.order_no.toLowerCase().includes(kw) &&
        !(o.nickname || "").toLowerCase().includes(kw) &&
        !(o.user_public_id || "").toLowerCase().includes(kw)
      )
        return false;
      return true;
    });
  }, [orders, status, search]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">订单管理</h1>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          placeholder="搜索订单号 / 用户"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm w-60"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 rounded-lg border text-sm">
          <option value="">全部状态</option>
          <option value="paid">paid</option>
          <option value="pending">pending</option>
          <option value="failed">failed</option>
        </select>
        <span className="text-xs text-gray-400">共 {filtered.length} 笔</span>
      </div>
      <div className="bg-white rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-4 py-3">订单号</th>
              <th className="text-left px-4 py-3">用户</th>
              <th className="text-left px-4 py-3">渠道</th>
              <th className="text-left px-4 py-3">金额</th>
              <th className="text-left px-4 py-3">到账算力</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">时间</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((o) => (
              <tr key={o.order_no}>
                <td className="px-4 py-3 font-mono text-xs">{o.order_no}</td>
                <td className="px-4 py-3">{o.nickname || o.user_public_id}</td>
                <td className="px-4 py-3">{o.channel}</td>
                <td className="px-4 py-3">¥{o.amount.toFixed(2)}</td>
                <td className="px-4 py-3">{o.compute_credited.toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={o.status === "paid" ? "text-green-600" : "text-gray-500"}>{o.status}</span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{new Date(o.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无订单</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <AdminPagination page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </div>
  );
}
