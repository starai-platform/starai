"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api";

type FrozenItem = {
  id: number;
  user_id: number;
  amount: number;
  ref_type: string;
  ref_id: string;
  status: string;
  task_status?: string;
  error?: string;
  age_minutes: number;
  created_at: string;
  released_at?: string;
  wallet_tx_ids?: number[];
};

type TaskItem = {
  task_no: string;
  type: string;
  status: string;
  model_code?: string;
  estimated_cost: number;
  actual_cost: number;
  error_code?: string;
  error_message?: string;
  created_at: string;
  finished_at?: string;
};

type CardAnomaly = {
  card_id: number;
  user_id?: number;
  value: number;
  hash_prefix: string;
  used_at: string;
};

type OpsOverview = {
  stats: {
    frozen_count: number;
    frozen_amount: number;
    stale_chat_freezes: number;
    stale_tasks: number;
    stale_workflows: number;
    pending_tasks: number;
    running_tasks: number;
    recent_failed_tasks: number;
    card_recharge_anomalies: number;
    worker_online: boolean;
    worker_last_heartbeat?: string;
    worker_heartbeat_age_seconds?: number;
  };
  frozen_items: FrozenItem[];
  recent_failed_tasks: TaskItem[];
  card_anomalies: CardAnomaly[];
};

const numberFmt = (v?: number) => (Number(v || 0)).toLocaleString("zh-CN");
const creditFmt = (v?: number) => (Number(v || 0)).toFixed(4);
const timeFmt = (v?: string) => (v ? new Date(v).toLocaleString("zh-CN") : "-");

export default function OpsPage() {
  const [data, setData] = useState<OpsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi<OpsOverview>("/ops/overview");
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const riskItems = useMemo(() => {
    if (!data) return [];
    const s = data.stats;
    return [
      s.worker_online ? null : "Worker 心跳异常，请检查 worker 容器/进程。",
      s.stale_tasks > 0 ? `存在 ${s.stale_tasks} 个超时生成任务。` : null,
      s.stale_workflows > 0 ? `存在 ${s.stale_workflows} 个超时工作流。` : null,
      s.stale_chat_freezes > 0 ? `存在 ${s.stale_chat_freezes} 个超时对话冻结。` : null,
      s.card_recharge_anomalies > 0 ? `存在 ${s.card_recharge_anomalies} 条卡密兑换账务异常。` : null,
    ].filter(Boolean) as string[];
  }, [data]);

  const reconcile = async () => {
    if (!confirm("确定执行运营巡检处理？系统会释放超时冻结，并将超时任务标记失败。")) return;
    setBusy("reconcile");
    setMessage("");
    try {
      const res = await adminApi<{ released_chat_freezes: number; failed_tasks: number; failed_workflows: number }>("/ops/reconcile", { method: "POST" });
      setMessage(`已处理：释放对话冻结 ${res.released_chat_freezes}，失败任务 ${res.failed_tasks}，失败工作流 ${res.failed_workflows}`);
      await load();
    } finally {
      setBusy("");
    }
  };

  const releaseFreeze = async (id: number) => {
    if (!confirm(`确定释放冻结记录 #${id}？此操作会退回冻结算力。`)) return;
    setBusy(`release-${id}`);
    setMessage("");
    try {
      await adminApi(`/ops/frozen-balances/${id}/release`, { method: "POST" });
      setMessage(`已释放冻结记录 #${id}`);
      await load();
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">运营巡检</h1>
          <p className="mt-1 text-sm text-gray-500">集中检查冻结余额、超时任务、Worker 心跳和卡密兑换异常。</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            刷新
          </button>
          <button onClick={reconcile} disabled={busy === "reconcile"} className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
            执行巡检处理
          </button>
        </div>
      </div>

      {message && <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat title="Worker 状态" value={data?.stats.worker_online ? "在线" : "异常"} sub={data?.stats.worker_last_heartbeat ? `最后心跳 ${timeFmt(data.stats.worker_last_heartbeat)}` : "暂无心跳"} danger={!data?.stats.worker_online} />
        <Stat title="冻结余额" value={creditFmt(data?.stats.frozen_amount)} sub={`${numberFmt(data?.stats.frozen_count)} 条冻结记录`} danger={(data?.stats.frozen_count || 0) > 0} />
        <Stat title="任务积压" value={numberFmt((data?.stats.pending_tasks || 0) + (data?.stats.running_tasks || 0))} sub={`pending ${numberFmt(data?.stats.pending_tasks)} / running ${numberFmt(data?.stats.running_tasks)}`} danger={(data?.stats.stale_tasks || 0) > 0} />
        <Stat title="24h 失败任务" value={numberFmt(data?.stats.recent_failed_tasks)} sub={`卡密异常 ${numberFmt(data?.stats.card_recharge_anomalies)} 条`} danger={(data?.stats.recent_failed_tasks || 0) > 0 || (data?.stats.card_recharge_anomalies || 0) > 0} />
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-950">风险提醒</h2>
          <span className="text-xs text-gray-400">自动规则：chat 30 分钟，任务 6 小时，工作流 12 小时</span>
        </div>
        {riskItems.length ? (
          <div className="space-y-2">
            {riskItems.map((x) => (
              <div key={x} className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">{x}</div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">当前未发现高风险异常。</div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/5">
        <h2 className="mb-4 font-semibold text-gray-950">冻结余额异常</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-400">
              <tr>
                <th className="py-2">ID</th>
                <th className="py-2">用户</th>
                <th className="py-2">金额</th>
                <th className="py-2">业务</th>
                <th className="py-2">状态</th>
                <th className="py-2">冻结时长</th>
                <th className="py-2">流水</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.frozen_items || []).map((item) => (
                <tr key={item.id}>
                  <td className="py-3 font-mono text-xs">{item.id}</td>
                  <td className="py-3">{item.user_id}</td>
                  <td className="py-3 font-mono">{creditFmt(item.amount)}</td>
                  <td className="py-3">
                    <div>{item.ref_type}</div>
                    <div className="max-w-[220px] truncate font-mono text-xs text-gray-400">{item.ref_id}</div>
                  </td>
                  <td className="py-3">{item.task_status || item.status}</td>
                  <td className="py-3">{item.age_minutes} 分钟</td>
                  <td className="py-3 text-xs text-gray-400">{item.wallet_tx_ids?.join(", ") || "-"}</td>
                  <td className="py-3">
                    <button onClick={() => releaseFreeze(item.id)} disabled={busy === `release-${item.id}`} className="text-xs text-amber-600 hover:underline disabled:opacity-50">
                      手动释放
                    </button>
                  </td>
                </tr>
              ))}
              {!(data?.frozen_items || []).length && (
                <tr><td colSpan={8} className="py-8 text-center text-sm text-gray-400">暂无冻结记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/5">
          <h2 className="mb-4 font-semibold text-gray-950">最近失败任务</h2>
          <div className="space-y-3">
            {(data?.recent_failed_tasks || []).map((task) => (
              <div key={task.task_no} className="rounded-xl border border-gray-100 p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <div className="font-mono text-xs text-gray-900">{task.task_no}</div>
                  <div className="text-xs text-gray-400">{timeFmt(task.finished_at || task.created_at)}</div>
                </div>
                <div className="mt-1 text-xs text-gray-500">{task.type} / {task.model_code || "-"}</div>
                <div className="mt-2 text-xs text-red-500">{task.error_code || "-"} {task.error_message || ""}</div>
              </div>
            ))}
            {!(data?.recent_failed_tasks || []).length && <div className="py-6 text-center text-sm text-gray-400">暂无失败任务</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/5">
          <h2 className="mb-4 font-semibold text-gray-950">卡密兑换异常</h2>
          <div className="space-y-3">
            {(data?.card_anomalies || []).map((item) => (
              <div key={item.card_id} className="rounded-xl border border-red-100 bg-red-50/50 p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <div>卡密 #{item.card_id}</div>
                  <div className="font-mono">{creditFmt(item.value)}</div>
                </div>
                <div className="mt-1 text-xs text-gray-500">用户 {item.user_id || "-"} / hash {item.hash_prefix} / {timeFmt(item.used_at)}</div>
                <div className="mt-2 text-xs text-red-500">卡密已使用，但没有找到对应 card_recharge 钱包流水。</div>
              </div>
            ))}
            {!(data?.card_anomalies || []).length && <div className="py-6 text-center text-sm text-gray-400">暂无卡密账务异常</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ title, value, sub, danger }: { title: string; value: string; sub: string; danger?: boolean }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-gray-950/5">
      <div className="text-sm text-gray-500">{title}</div>
      <div className={danger ? "mt-2 text-2xl font-bold text-amber-600" : "mt-2 text-2xl font-bold text-gray-950"}>{value}</div>
      <div className="mt-3 truncate text-xs text-gray-400">{sub}</div>
    </section>
  );
}
