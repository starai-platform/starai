"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

interface Withdrawal {
  id: number;
  public_id: string;
  user_public_id: string;
  nickname: string;
  email: string;
  method: string;
  amount: number;
  account_info: Record<string, unknown>;
  status: string;
  admin_note?: string;
  created_at: string;
}

const PAGE_SIZE = 10;

const STATUS_LABELS: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
  paid: "已打款",
  cancelled: "已取消",
};

const METHOD_LABELS: Record<string, string> = {
  bank: "银行卡",
  wechat: "微信",
  alipay: "支付宝",
  paypal: "PayPal",
};

export default function WithdrawalsPage() {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [active, setActive] = useState<Withdrawal | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (status) params.set("status", status);
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    adminApi<{ items: Withdrawal[]; total: number }>(`/withdrawals?${params.toString()}`)
      .then((r) => {
        setItems(r.items || []);
        setTotal(r.total || 0);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "加载提现列表失败"));
  }, [status, keyword, startDate, endDate, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status, keyword, startDate, endDate]);

  const review = async (next: "approved" | "rejected" | "paid") => {
    if (!active) return;
    try {
      await adminApi(`/withdrawals/${active.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next, admin_note: note }),
      });
      setActive(null);
      setNote("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "审核操作失败");
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">提现管理</h1>
      </div>

      <div className="mb-4 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索昵称 / 用户ID / 邮箱 / 提现单号" className="rounded-xl border px-3 py-2 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border px-3 py-2 text-sm">
          <option value="">全部状态</option>
          <option value="pending">待审核</option>
          <option value="approved">已通过</option>
          <option value="paid">已打款</option>
          <option value="rejected">已驳回</option>
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
        <button
          onClick={() => {
            setKeyword("");
            setStatus("");
            setStartDate("");
            setEndDate("");
          }}
          className="rounded-xl border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          重置
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">用户</th>
              <th className="px-4 py-3 text-left">方式</th>
              <th className="px-4 py-3 text-left">账户</th>
              <th className="px-4 py-3 text-right">金额</th>
              <th className="px-4 py-3 text-left">状态</th>
              <th className="px-4 py-3 text-left">时间</th>
              <th className="px-4 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((w) => (
              <tr key={w.id}>
                <td className="px-4 py-3">
                  <div>{w.nickname || w.user_public_id}</div>
                  <div className="font-mono text-xs text-gray-400">{w.user_public_id}</div>
                  <div className="text-xs text-gray-400">{w.email || "-"}</div>
                </td>
                <td className="px-4 py-3">{METHOD_LABELS[w.method] || w.method}</td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  <div>{String(w.account_info?.name || "-")}</div>
                  <div>{String(w.account_info?.account || "-")}</div>
                  {w.account_info?.bank_name ? <div>{String(w.account_info.bank_name)}</div> : null}
                </td>
                <td className="px-4 py-3 text-right font-mono">¥{w.amount.toFixed(2)}</td>
                <td className="px-4 py-3">{STATUS_LABELS[w.status] || w.status}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{new Date(w.created_at).toLocaleString("zh-CN", { hour12: false })}</td>
                <td className="px-4 py-3">
                  <button onClick={() => setActive(w)} className="text-xs text-secondary hover:underline">审核</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-gray-400">暂无提现申请</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <AdminPagination page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setActive(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-semibold">审核提现</h3>
            <div className="mb-4 rounded-xl bg-gray-50 p-3 text-sm">
              <div>{active.nickname || active.user_public_id}</div>
              <div className="mt-1 text-gray-500">{METHOD_LABELS[active.method] || active.method} · ¥{active.amount.toFixed(2)}</div>
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="审核备注" className="mb-4 h-24 w-full rounded-xl border px-3 py-2 text-sm" />
            <div className="flex gap-2">
              {active.status === "pending" && <button onClick={() => review("approved")} className="flex-1 rounded-xl bg-green-600 py-2 text-sm font-semibold text-white">通过</button>}
              {active.status === "approved" && <button onClick={() => review("paid")} className="flex-1 rounded-xl bg-gray-950 py-2 text-sm font-semibold text-white">标记打款</button>}
              {(active.status === "pending" || active.status === "approved") && <button onClick={() => review("rejected")} className="flex-1 rounded-xl border py-2 text-sm">驳回</button>}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setError("")}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-red-600">操作失败</h3>
            <p className="mt-3 break-all text-sm text-gray-600">{error}</p>
            <button onClick={() => setError("")} className="mt-5 w-full rounded-xl bg-gray-950 py-2 text-sm font-semibold text-white">知道了</button>
          </div>
        </div>
      )}
    </div>
  );
}
