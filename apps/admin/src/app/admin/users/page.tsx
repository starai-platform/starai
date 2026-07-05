"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

interface MemberLevel {
  id: number;
  code: string;
  name: string;
  referral_reward_amount: number;
  referral_reward_account: "compute" | "cash";
  referral_reward_type: "fixed" | "percent";
  referral_reward_trigger: "first_recharge" | "every_recharge";
  is_default: boolean;
  is_enabled: boolean;
  sort_order: number;
}

interface ApiTokenItem {
  id: number;
  name: string;
  prefix: string;
  token?: string;
  status: string;
  last_used_at?: string;
  created_at: string;
}

interface UserItem {
  id: number;
  public_id: string;
  nickname: string;
  avatar_url?: string;
  email: string;
  status: string;
  user_level: string;
  member_level_id: number;
  member_level: string;
  referral_code: string;
  referrer_id?: number;
  referrer_name?: string;
  direct_count: number;
  compute_balance: number;
  cash_balance: number;
  api_token_count: number;
  active_api_token_count: number;
  api_token_last_used_at?: string;
  api_token_last_created_at?: string;
  api_tokens?: ApiTokenItem[] | null;
  created_at: string;
}

interface RewardItem {
  id: number;
  referred_public_id: string;
  referred_nickname: string;
  reward_account: "compute" | "cash";
  amount: number;
  trigger_type: string;
  trigger_id: string;
  created_at: string;
}

interface WithdrawalItem {
  id: number;
  public_id: string;
  method: string;
  amount: number;
  account_info: Record<string, unknown>;
  status: string;
  admin_note?: string;
  created_at: string;
}

interface UserDetail extends UserItem {
  locale: string;
  frozen_compute: number;
  login_providers: string[];
  works_count: number;
  children: UserItem[] | null;
  referral_rewards: RewardItem[] | null;
  withdrawals: WithdrawalItem[] | null;
  api_tokens: ApiTokenItem[] | null;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: "正常", className: "bg-green-50 text-green-600" },
  frozen: { label: "冻结", className: "bg-amber-50 text-amber-600" },
  banned: { label: "封禁", className: "bg-red-50 text-red-600" },
};
const PAGE_SIZE = 10;

function usableAvatar(url?: string) {
  const clean = (url || "").trim();
  if (!clean) return "";
  if (/\.svg(\?|#|$)/i.test(clean)) return "";
  if (/dicebear\.com/i.test(clean)) return "";
  return clean;
}

function UserAvatar({ user }: { user: Pick<UserItem, "nickname" | "avatar_url" | "public_id"> }) {
  const src = usableAvatar(user.avatar_url);
  const initial = (user.nickname || user.public_id || "U").slice(0, 1).toUpperCase();
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={user.nickname || user.public_id} onError={() => setFailed(true)} className="h-10 w-10 rounded-full object-cover ring-1 ring-gray-100" />;
  }
  return <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-950 text-sm font-semibold text-white">{initial}</div>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [levels, setLevels] = useState<MemberLevel[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  const [adjustUser, setAdjustUser] = useState<UserItem | null>(null);
  const [adjustAccount, setAdjustAccount] = useState<"compute" | "cash">("compute");
  const [amount, setAmount] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    adminApi<{ items: UserItem[]; total: number }>(`/users?page=${page}&page_size=${PAGE_SIZE}`).then((r) => {
      setUsers(r.items || []);
      setTotal(r.total || 0);
    });
    adminApi<{ items: MemberLevel[] }>("/member-levels").then((r) => setLevels(r.items || []));
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return users.filter((u) => {
      if (status && u.status !== status) return false;
      if (!kw) return true;
      return [u.nickname, u.public_id, u.email, u.referral_code, u.referrer_name || ""].some((v) => (v || "").toLowerCase().includes(kw));
    });
  }, [users, status, search]);

  const openDetail = async (u: UserItem) => {
    const d = await adminApi<UserDetail>(`/users/${u.id}/detail`);
    setDetail(d);
    setEditOpen(false);
  };

  const refreshDetail = async () => {
    if (!detail) return;
    const d = await adminApi<UserDetail>(`/users/${detail.id}/detail`);
    setDetail(d);
    load();
  };

  const setUserStatus = async (u: UserItem, next: string) => {
    const label = STATUS_META[next]?.label || next;
    if (!confirm(`确认将用户「${u.nickname || u.public_id}」状态改为「${label}」？`)) return;
    await adminApi(`/users/${u.id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    load();
  };

  const handleAdjust = async () => {
    if (!adjustUser || !amount) return;
    await adminApi(`/users/${adjustUser.id}/adjust-balance`, {
      method: "POST",
      body: JSON.stringify({ account: adjustAccount, amount: Number(amount), remark: "管理员调整" }),
    });
    setAdjustUser(null);
    setAmount("");
    load();
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">用户管理</h1>
        <button onClick={() => setLevelOpen(true)} className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white">
          会员等级管理
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input placeholder="搜索昵称 / 用户ID / 邮箱 / 推荐码" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72 rounded-xl border px-3 py-2 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border px-3 py-2 text-sm">
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="frozen">冻结</option>
          <option value="banned">封禁</option>
        </select>
        <span className="text-xs text-gray-400">共 {filtered.length} 人</span>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">用户</th>
              <th className="px-4 py-3 text-left">会员</th>
              <th className="px-4 py-3 text-left">推荐关系</th>
              <th className="px-4 py-3 text-left">API Key</th>
              <th className="px-4 py-3 text-left">注册时间</th>
              <th className="px-4 py-3 text-right">算力</th>
              <th className="px-4 py-3 text-right">现金</th>
              <th className="px-4 py-3 text-left">状态</th>
              <th className="px-4 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((u) => {
              const meta = STATUS_META[u.status] || { label: u.status, className: "bg-gray-100 text-gray-500" };
              return (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <UserAvatar user={u} />
                      <div>
                        <div className="font-medium text-gray-900">{u.nickname || "未设置昵称"}</div>
                        <div className="mt-0.5 font-mono text-xs text-gray-400">{u.public_id}</div>
                        <div className="mt-0.5 text-xs text-gray-400">{u.email || "-"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{u.member_level || u.user_level}</div>
                    <div className="mt-0.5 text-xs text-gray-400">码 {u.referral_code}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-500">上级：{u.referrer_name || "无"}</div>
                    <div className="mt-1 text-xs text-gray-500">下级：{u.direct_count} 人</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-gray-700">{u.active_api_token_count || 0}/{u.api_token_count || 0} 启用</div>
                    {u.api_tokens && u.api_tokens.length > 0 ? (
                      <div className="mt-1 space-y-1">
                        {u.api_tokens.map((t) => (
                          <div key={t.id} className="max-w-[230px] break-all font-mono text-[11px] text-gray-500">
                            {t.token || `${t.prefix}******`}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-gray-400">未创建</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{new Date(u.created_at).toLocaleString("zh-CN", { hour12: false })}</td>
                  <td className="px-4 py-3 text-right font-mono">{u.compute_balance.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono">¥{u.cash_balance.toFixed(2)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${meta.className}`}>{meta.label}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => openDetail(u)} className="text-xs text-secondary hover:underline">查看</button>
                      <button onClick={() => { setAdjustUser(u); setAdjustAccount("compute"); }} className="text-xs text-secondary hover:underline">调余额</button>
                      {u.status !== "active" && <button onClick={() => setUserStatus(u, "active")} className="text-xs text-green-600 hover:underline">恢复</button>}
                      {u.status === "active" && <button onClick={() => setUserStatus(u, "frozen")} className="text-xs text-amber-600 hover:underline">冻结</button>}
                      {u.status !== "banned" && <button onClick={() => setUserStatus(u, "banned")} className="text-xs text-red-500 hover:underline">封禁</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AdminPagination page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {detail && <UserDetailModal detail={detail} levels={levels} users={users} editOpen={editOpen} setEditOpen={setEditOpen} onClose={() => setDetail(null)} onSaved={refreshDetail} />}
      {levelOpen && <MemberLevelModal levels={levels} onClose={() => setLevelOpen(false)} onSaved={load} />}

      {adjustUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAdjustUser(null)}>
          <div className="w-80 rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-semibold">调整余额</h3>
            <select value={adjustAccount} onChange={(e) => setAdjustAccount(e.target.value as "compute" | "cash")} className="mb-3 w-full rounded-xl border px-3 py-2 text-sm">
              <option value="compute">算力余额</option>
              <option value="cash">现金余额</option>
            </select>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="正数增加，负数扣除" className="mb-4 w-full rounded-xl border px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={handleAdjust} className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-dark">确认</button>
              <button onClick={() => setAdjustUser(null)} className="flex-1 rounded-xl border py-2 text-sm">取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserDetailModal({ detail, levels, users, editOpen, setEditOpen, onClose, onSaved }: {
  detail: UserDetail;
  levels: MemberLevel[];
  users: UserItem[];
  editOpen: boolean;
  setEditOpen: (v: boolean) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [email, setEmail] = useState(detail.email || "");
  const [nickname, setNickname] = useState(detail.nickname || "");
  const [password, setPassword] = useState("");
  const [computeBalance, setComputeBalance] = useState(String(detail.compute_balance ?? 0));
  const [cashBalance, setCashBalance] = useState(String(detail.cash_balance ?? 0));
  const [memberLevelID, setMemberLevelID] = useState(detail.member_level_id || 0);
  const [referrerID, setReferrerID] = useState(detail.referrer_id || 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEmail(detail.email || "");
    setNickname(detail.nickname || "");
    setPassword("");
    setComputeBalance(String(detail.compute_balance ?? 0));
    setCashBalance(String(detail.cash_balance ?? 0));
    setMemberLevelID(detail.member_level_id || 0);
    setReferrerID(detail.referrer_id || 0);
  }, [detail]);

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        email: email.trim(),
        nickname: nickname.trim(),
        compute_balance: Number(computeBalance || 0),
        cash_balance: Number(cashBalance || 0),
        member_level_id: memberLevelID,
        referrer_id: referrerID,
      };
      if (password.trim()) body.password = password.trim();
      await adminApi(`/users/${detail.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setEditOpen(false);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[86vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-semibold">{editOpen ? "编辑用户" : "用户详情"}</h3>
          <div className="flex gap-3">
            {editOpen ? <button onClick={save} disabled={saving} className="text-sm text-secondary hover:underline disabled:opacity-50">{saving ? "保存中..." : "保存"}</button> : <button onClick={() => setEditOpen(true)} className="text-sm text-secondary hover:underline">编辑</button>}
            <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">关闭</button>
          </div>
        </div>

        {editOpen ? (
          <div className="grid gap-3 md:grid-cols-2">
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="昵称" className="rounded-xl border px-3 py-2 text-sm" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" className="rounded-xl border px-3 py-2 text-sm" />
            <input type="number" value={computeBalance} onChange={(e) => setComputeBalance(e.target.value)} placeholder="算力余额" className="rounded-xl border px-3 py-2 text-sm" />
            <input type="number" value={cashBalance} onChange={(e) => setCashBalance(e.target.value)} placeholder="现金余额" className="rounded-xl border px-3 py-2 text-sm" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="新密码（留空不修改）" className="rounded-xl border px-3 py-2 text-sm" />
            <select value={memberLevelID} onChange={(e) => setMemberLevelID(Number(e.target.value))} className="rounded-xl border px-3 py-2 text-sm">
              {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select value={referrerID} onChange={(e) => setReferrerID(Number(e.target.value))} className="rounded-xl border px-3 py-2 text-sm">
              <option value={0}>无上级</option>
              {users.filter((u) => u.id !== detail.id).map((u) => <option key={u.id} value={u.id}>{u.nickname || u.public_id} · {u.referral_code}</option>)}
            </select>
          </div>
        ) : (
          <>
            <div className="mb-5 grid gap-3 text-sm md:grid-cols-4">
              <Info label="用户ID" value={detail.public_id} />
              <Info label="会员等级" value={detail.member_level || detail.user_level} />
              <Info label="推荐码" value={detail.referral_code} />
              <Info label="上级" value={detail.referrer_name || "无"} />
              <Info label="算力余额" value={detail.compute_balance.toFixed(2)} />
              <Info label="冻结算力" value={detail.frozen_compute.toFixed(2)} />
              <Info label="现金余额" value={`¥${detail.cash_balance.toFixed(2)}`} />
              <Info label="作品数" value={String(detail.works_count)} />
              <Info label="API Key" value={`${detail.active_api_token_count || 0}/${detail.api_token_count || 0} 启用`} />
            </div>

            <Section title={`API Key（${detail.api_tokens?.length || 0}）`}>
              <MiniTable empty="暂无 API Key">
                {detail.api_tokens?.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{t.name || "未命名 Key"}</div>
                      <div className="mt-0.5 break-all font-mono text-xs text-gray-500">{t.token || `${t.prefix}******`}</div>
                    </td>
                    <td className="px-3 py-2">{t.status === "active" ? "启用" : t.status}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{t.last_used_at ? new Date(t.last_used_at).toLocaleString("zh-CN", { hour12: false }) : "从未使用"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{new Date(t.created_at).toLocaleString("zh-CN", { hour12: false })}</td>
                  </tr>
                ))}
              </MiniTable>
            </Section>

            <Section title={`直属下级（${detail.children?.length || 0}）`}>
              <MiniTable empty="暂无下级">
                {detail.children?.map((u) => (
                  <tr key={u.id}>
                    <td className="px-3 py-2">{u.nickname || u.public_id}</td>
                    <td className="px-3 py-2 font-mono text-xs">{u.referral_code}</td>
                    <td className="px-3 py-2">{u.member_level}</td>
                    <td className="px-3 py-2">{new Date(u.created_at).toLocaleString("zh-CN", { hour12: false })}</td>
                  </tr>
                ))}
              </MiniTable>
            </Section>

            <Section title={`推荐奖励（${detail.referral_rewards?.length || 0}）`}>
              <MiniTable empty="暂无奖励">
                {detail.referral_rewards?.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{r.referred_nickname || r.referred_public_id}</td>
                    <td className="px-3 py-2">{r.reward_account === "cash" ? "现金" : "算力"}</td>
                    <td className="px-3 py-2 font-mono">{r.amount.toFixed(2)}</td>
                    <td className="px-3 py-2">{new Date(r.created_at).toLocaleString("zh-CN", { hour12: false })}</td>
                  </tr>
                ))}
              </MiniTable>
            </Section>

            <Section title={`提现记录（${detail.withdrawals?.length || 0}）`}>
              <MiniTable empty="暂无提现">
                {detail.withdrawals?.map((w) => (
                  <tr key={w.id}>
                    <td className="px-3 py-2">{w.method}</td>
                    <td className="px-3 py-2 font-mono">¥{w.amount.toFixed(2)}</td>
                    <td className="px-3 py-2">{w.status}</td>
                    <td className="px-3 py-2">{new Date(w.created_at).toLocaleString("zh-CN", { hour12: false })}</td>
                  </tr>
                ))}
              </MiniTable>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function MemberLevelModal({ levels, onClose, onSaved }: { levels: MemberLevel[]; onClose: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState<MemberLevel | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("0");
  const [account, setAccount] = useState<"compute" | "cash">("compute");
  const [rewardType, setRewardType] = useState<"fixed" | "percent">("fixed");
  const [rewardTrigger, setRewardTrigger] = useState<"first_recharge" | "every_recharge">("first_recharge");
  const [isDefault, setIsDefault] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const startEdit = (level?: MemberLevel) => {
    setEditing(level || null);
    setCode(level?.code || "");
    setName(level?.name || "");
    setAmount(String(level?.referral_reward_amount ?? 0));
    setAccount(level?.referral_reward_account || "compute");
    setRewardType(level?.referral_reward_type || "fixed");
    setRewardTrigger(level?.referral_reward_trigger || "first_recharge");
    setIsDefault(!!level?.is_default);
    setEnabled(level?.is_enabled ?? true);
  };

  const save = async () => {
    await adminApi("/member-levels", {
      method: "POST",
      body: JSON.stringify({
        code: code.trim(),
        name: name.trim(),
        referral_reward_amount: Number(amount),
        referral_reward_account: account,
        referral_reward_type: rewardType,
        referral_reward_trigger: rewardTrigger,
        is_default: isDefault,
        is_enabled: enabled,
        sort_order: editing?.sort_order || 0,
      }),
    });
    startEdit();
    onSaved();
  };

  useEffect(() => {
    startEdit();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-semibold">会员等级管理</h3>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">关闭</button>
        </div>
        <div className="mb-5 grid gap-3 md:grid-cols-6">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="等级代码 normal/gold" disabled={!!editing} className="rounded-xl border px-3 py-2 text-sm md:col-span-2 disabled:bg-gray-50" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="等级名称" className="rounded-xl border px-3 py-2 text-sm md:col-span-2" />
          <select value={rewardType} onChange={(e) => setRewardType(e.target.value as typeof rewardType)} className="rounded-xl border px-3 py-2 text-sm">
            <option value="fixed">固定金额</option>
            <option value="percent">充值比例</option>
          </select>
          <div className="relative">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={rewardType === "percent" ? "比例" : "固定奖励"} className="w-full rounded-xl border px-3 py-2 pr-10 text-sm" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{rewardType === "percent" ? "%" : account === "cash" ? "元" : "算力"}</span>
          </div>
          <select value={account} onChange={(e) => setAccount(e.target.value as typeof account)} className="rounded-xl border px-3 py-2 text-sm">
            <option value="compute">奖励到算力</option>
            <option value="cash">奖励到现金</option>
          </select>
          <select value={rewardTrigger} onChange={(e) => setRewardTrigger(e.target.value as typeof rewardTrigger)} className="rounded-xl border px-3 py-2 text-sm">
            <option value="first_recharge">首充奖励</option>
            <option value="every_recharge">每次充值奖励</option>
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> 默认等级</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 启用</label>
          <button onClick={save} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-dark md:col-span-2">保存等级</button>
          <button onClick={() => startEdit()} className="rounded-xl border px-4 py-2 text-sm md:col-span-2">新增</button>
        </div>
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2 text-left">代码</th><th className="px-3 py-2 text-left">名称</th><th className="px-3 py-2 text-left">奖励规则</th><th className="px-3 py-2 text-left">触发</th><th className="px-3 py-2 text-left">状态</th><th className="px-3 py-2 text-left">操作</th></tr></thead>
            <tbody className="divide-y">
              {levels.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 font-mono text-xs">{l.code}</td>
                  <td className="px-3 py-2">{l.name}{l.is_default && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">默认</span>}</td>
                  <td className="px-3 py-2">
                    {l.referral_reward_type === "percent" ? `${l.referral_reward_amount}%` : `${l.referral_reward_amount.toFixed(2)} ${l.referral_reward_account === "cash" ? "元" : "算力"}`}
                    <span className="ml-1 text-xs text-gray-400">到{l.referral_reward_account === "cash" ? "现金" : "算力"}</span>
                  </td>
                  <td className="px-3 py-2">{l.referral_reward_trigger === "every_recharge" ? "每次充值" : "首次充值"}</td>
                  <td className="px-3 py-2">{l.is_enabled ? "启用" : "停用"}</td>
                  <td className="px-3 py-2"><button onClick={() => startEdit(l)} className="text-xs text-secondary hover:underline">编辑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-2 text-sm font-semibold text-gray-900">{title}</div>
      {children}
    </div>
  );
}

function MiniTable({ children, empty }: { children?: React.ReactNode; empty: string }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  if (!hasRows) return <div className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-gray-400">{empty}</div>;
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}
