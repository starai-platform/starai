"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { RechargeModal } from "@/components/RechargeModal";
import type { CashTransaction, ReferralSummary, Wallet, WalletTransaction, WithdrawalRequest } from "@starai/shared-types";

type Tab = "compute" | "cash" | "withdrawals";

const TX_LABELS: Record<string, string> = {
  card_recharge: "卡密充值",
  online_recharge: "在线充值",
  admin_adjust: "管理员调整",
  daily_checkin: "每日签到",
  signup_bonus: "注册赠送",
  referral_reward: "推荐奖励",
  withdrawal_refund: "提现退回",
  chat_usage: "对话消费",
  withdrawal: "提现",
};

const METHOD_LABELS: Record<string, string> = {
  bank: "银行卡",
  wechat: "微信",
  alipay: "支付宝",
  paypal: "PayPal",
};

export default function WalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [showRecharge, setShowRecharge] = useState(false);
  const [tab, setTab] = useState<Tab>("compute");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [childrenOpen, setChildrenOpen] = useState(false);
  const [method, setMethod] = useState<"bank" | "wechat" | "alipay" | "paypal">("alipay");
  const [amount, setAmount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [message, setMessage] = useState("");

  const load = () => {
    api<Wallet>("/api/wallet").then(setWallet);
    api<{ items: WalletTransaction[] }>("/api/wallet/transactions").then((r) => setTransactions(r.items || []));
    api<{ items: CashTransaction[] }>("/api/wallet/cash-transactions").then((r) => setCashTransactions(r.items || []));
    api<{ items: WithdrawalRequest[] }>("/api/wallet/withdrawals").then((r) => setWithdrawals(r.items || []));
    api<ReferralSummary>("/api/referrals/summary").then(setSummary).catch(() => setSummary(null));
  };

  useEffect(() => {
    load();
  }, []);

  const submitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    try {
      await api("/api/wallet/withdrawals", {
        method: "POST",
        body: JSON.stringify({
          method,
          amount: Number(amount),
          account_info: { name: accountName.trim(), account: accountNo.trim(), bank_name: bankName.trim() },
        }),
      });
      setAmount("");
      setAccountName("");
      setAccountNo("");
      setBankName("");
      setWithdrawOpen(false);
      setMessage("提现申请已提交");
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "提现申请提交失败");
    }
  };

  return (
    <div className="page-container page-padding max-w-4xl flex-1 overflow-y-auto py-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">钱包</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowRecharge(true)} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-dark hover:bg-primary/90">
            充值算力
          </button>
          <button onClick={() => setWithdrawOpen(true)} className="rounded-xl border border-gray-200 bg-white px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            申请提现
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="soft-card bg-dark p-6 text-white">
          <div className="mb-1 text-sm text-white/60">算力余额</div>
          <div className="text-4xl font-bold text-primary">{wallet?.compute_balance?.toFixed(2) ?? "--"}</div>
          {!!wallet?.frozen_compute && <div className="mt-2 text-sm text-white/50">冻结中：{wallet.frozen_compute.toFixed(2)}</div>}
        </div>
        <div className="soft-card p-6">
          <div className="mb-1 text-sm text-gray-500">现金余额</div>
          <div className="text-4xl font-bold text-gray-900">¥{wallet?.cash_balance?.toFixed(2) ?? "--"}</div>
          <div className="mt-2 text-sm text-gray-500">可以申请提现</div>
        </div>
      </div>

      <div className="soft-card mb-6 p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">推荐信息</div>
            <div className="mt-1 text-xs text-gray-400">新用户注册时填写你的推荐码，充值成功后会得到奖励。</div>
          </div>
          <div className="rounded-xl bg-gray-100 px-4 py-2 font-mono text-lg font-bold text-gray-900">{summary?.referral_code || "--"}</div>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <button type="button" onClick={() => setChildrenOpen(true)} className="rounded-xl bg-gray-50 px-3 py-2 text-left transition hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10">
            <div className="text-[11px] text-gray-400">直属下级</div>
            <div className="mt-0.5 truncate text-gray-900 dark:text-gray-100">{summary?.direct_count ?? 0} 人</div>
          </button>
          <Info label="算力奖励" value={(summary?.reward_compute ?? 0).toFixed(2)} />
          <Info label="现金奖励" value={`¥${(summary?.reward_cash ?? 0).toFixed(2)}`} />
          <Info label="我的上级" value={summary?.referrer_name || "无"} />
        </div>
      </div>

      {message && <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">{message}</div>}

      <div className="mb-4 flex gap-2">
        {[
          ["compute", "算力流水"],
          ["cash", "现金流水"],
          ["withdrawals", "提现记录"],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as Tab)} className={`rounded-xl px-4 py-2 text-sm font-medium transition ${tab === key ? "bg-gray-900 text-white" : "border border-gray-100 bg-white text-gray-500"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "compute" && <TransactionList items={transactions} />}
      {tab === "cash" && <TransactionList items={cashTransactions} cash />}
      {tab === "withdrawals" && <WithdrawalList items={withdrawals} />}

      {childrenOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setChildrenOpen(false)}>
          <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white text-gray-900 shadow-xl dark:border dark:border-white/10 dark:bg-gray-950 dark:text-gray-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/10">
              <div>
                <h3 className="font-semibold">直属下级</h3>
                <p className="mt-1 text-xs text-gray-400">累计充值金额会随被推荐人后续充值自动累加。</p>
              </div>
              <button type="button" onClick={() => setChildrenOpen(false)} className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">关闭</button>
            </div>
            <div className="max-h-[64vh] overflow-y-auto">
              {!summary?.children?.length ? (
                <div className="px-5 py-10 text-center text-sm text-gray-400">暂无直属下级</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <tr>
                      <th className="px-4 py-3 text-left">用户</th>
                      <th className="px-4 py-3 text-left">邮箱</th>
                      <th className="px-4 py-3 text-right">累计充值</th>
                      <th className="px-4 py-3 text-left">注册时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                    {summary.children.map((child) => (
                      <tr key={child.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{child.nickname || "未设置昵称"}</div>
                          <div className="mt-0.5 font-mono text-xs text-gray-400">{child.public_id}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-300">{child.email || "-"}</td>
                        <td className="px-4 py-3 text-right font-mono">¥{(child.recharge_amount || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{new Date(child.created_at).toLocaleString("zh-CN", { hour12: false })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {withdrawOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setWithdrawOpen(false)}>
          <form onSubmit={submitWithdrawal} className="w-full max-w-md rounded-2xl bg-white p-6 text-gray-900 shadow-xl dark:border dark:border-white/10 dark:bg-gray-950 dark:text-gray-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-semibold">申请提现</h3>
            <div className="space-y-3">
              <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-primary dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 dark:[color-scheme:dark]">
                <option value="alipay">支付宝</option>
                <option value="wechat">微信</option>
                <option value="bank">银行卡</option>
                <option value="paypal">PayPal</option>
              </select>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="提现金额" required className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500" />
              <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="收款人姓名" required className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500" />
              <input value={accountNo} onChange={(e) => setAccountNo(e.target.value)} placeholder="账号 / 手机号 / PayPal 邮箱" required className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500" />
              {method === "bank" && <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="开户行" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-primary dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500" />}
            </div>
            <div className="mt-5 flex gap-2">
              <button type="submit" className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-dark">提交</button>
              <button type="button" onClick={() => setWithdrawOpen(false)} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5">取消</button>
            </div>
          </form>
        </div>
      )}

      <RechargeModal open={showRecharge} onClose={() => setShowRecharge(false)} onSuccess={load} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="mt-0.5 truncate text-gray-900">{value}</div>
    </div>
  );
}

function TransactionList({ items, cash }: { items: WalletTransaction[]; cash?: boolean }) {
  return (
    <div className="soft-card divide-y">
      {items.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">暂无记录</div>
      ) : (
        items.map((tx) => (
          <div key={tx.id} className="flex items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{tx.remark || TX_LABELS[tx.type] || tx.type}</div>
              <div className="mt-0.5 text-xs text-gray-400">{new Date(tx.created_at).toLocaleString("zh-CN", { hour12: false })}</div>
            </div>
            <div className={`text-sm font-semibold ${tx.direction === "in" ? "text-primary" : "text-gray-700"}`}>
              {tx.direction === "in" ? "+" : "-"}
              {cash ? "¥" : ""}
              {tx.amount.toFixed(cash ? 2 : 4)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function WithdrawalList({ items }: { items: WithdrawalRequest[] }) {
  return (
    <div className="soft-card divide-y">
      {items.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">暂无提现记录</div>
      ) : (
        items.map((w) => (
          <div key={w.id} className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <div className="text-sm font-medium">{METHOD_LABELS[w.method] || w.method} · ¥{w.amount.toFixed(2)}</div>
              <div className="mt-0.5 text-xs text-gray-400">{new Date(w.created_at).toLocaleString("zh-CN", { hour12: false })}</div>
              {w.admin_note && <div className="mt-1 text-xs text-gray-500">{w.admin_note}</div>}
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{w.status}</span>
          </div>
        ))
      )}
    </div>
  );
}
