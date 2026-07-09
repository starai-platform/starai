"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import type { User } from "@starai/shared-types";

interface CheckinStatus {
  enabled: boolean;
  checked_today: boolean;
  reward: number;
  total_checkins: number;
}

interface ApiToken {
  id: number;
  name: string;
  prefix: string;
  token?: string;
  status: string;
  last_used_at?: string;
  created_at: string;
}

export default function SettingsPage() {
  const { locale: currentLocale, languages: uiLanguages, setLocale: setUILocale, t } = useI18n();
  const [profile, setProfile] = useState<User | null>(null);
  const [nickname, setNickname] = useState("");
  const [locale, setLocale] = useState(currentLocale);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdErr, setPwdErr] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [checkinMsg, setCheckinMsg] = useState("");

  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [newToken, setNewToken] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

  const loadTokens = () => api<{ items: ApiToken[] }>("/api/api-tokens").then((r) => setTokens(r.items || []));

  const loginMethodLabel = (provider?: string) => {
    switch ((provider || "email").toLowerCase()) {
      case "google":
        return "谷歌";
      case "github":
        return "GitHub";
      default:
        return "注册用户";
    }
  };

  const maskToken = (token?: string, prefix?: string) => {
    if (token) return `${token.slice(0, 14)}${"•".repeat(18)}${token.slice(-6)}`;
    return `${prefix || "sk-starai-"}${"•".repeat(10)}`;
  };

  const copyToken = async (key: string, token?: string) => {
    if (!token || typeof navigator === "undefined") return;
    await navigator.clipboard.writeText(token);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((prev) => (prev === key ? "" : prev)), 1200);
  };

  useEffect(() => {
    api<User>("/api/me").then((u) => {
      setProfile(u);
      setNickname(u.nickname || "");
      setLocale(u.locale || currentLocale || "zh-CN");
    });
    api<CheckinStatus>("/api/daily-checkin/status").then(setCheckin).catch(() => {});
    loadTokens().catch(() => {});
  }, [currentLocale]);

  const doCheckin = async () => {
    setCheckinMsg("");
    try {
      const r = await api<{ reward: number }>("/api/daily-checkin", { method: "POST" });
      setCheckinMsg(`签到成功，获得 ${r.reward} 算力`);
      api<CheckinStatus>("/api/daily-checkin/status").then(setCheckin);
    } catch (err) {
      setCheckinMsg(err instanceof Error ? err.message : "签到失败");
    }
  };

  const createToken = async () => {
    try {
      const r = await api<{ token: string }>("/api/api-tokens", {
        method: "POST",
        body: JSON.stringify({ name: tokenName }),
      });
      setNewToken(r.token);
      setTokenName("");
      loadTokens();
    } catch {
      /* ignore */
    }
  };

  const deleteToken = async (id: number) => {
    await api(`/api/api-tokens/${id}`, { method: "DELETE" });
    loadTokens();
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg("");
    try {
      const u = await api<User>("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ nickname, locale }),
      });
      setProfile(u);
      setUILocale(u.locale || locale, { persistUser: false });
      try {
        const raw = localStorage.getItem("user");
        if (raw) {
          const merged = { ...JSON.parse(raw), nickname: u.nickname, locale: u.locale };
          localStorage.setItem("user", JSON.stringify(merged));
        }
      } catch {
        /* ignore */
      }
      setProfileMsg(t("settings.saved"));
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : t("settings.saveFailed"));
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPwd(true);
    setPwdMsg("");
    setPwdErr("");
    try {
      await api("/api/me/change-password", {
        method: "POST",
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      });
      setPwdMsg("密码修改成功");
      setOldPwd("");
      setNewPwd("");
    } catch (err) {
      setPwdErr(err instanceof Error ? err.message : "修改失败");
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto page-padding py-6 sm:py-8 page-container max-w-2xl dark:bg-gray-950">
      <h1 className="text-2xl font-bold mb-6">{t("settings.title")}</h1>

      <section className="soft-card p-6 mb-6">
        <h2 className="font-semibold mb-4">{t("settings.profile")}</h2>
        <form onSubmit={saveProfile} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-2xl border border-gray-100 bg-gray-50/70 p-4 dark:border-white/10 dark:bg-white/5 sm:grid-cols-2">
            <div className="text-sm text-gray-500">{t("settings.accountId")}</div>
            <div className="text-right text-sm font-medium text-gray-800 dark:text-gray-100">{loginMethodLabel(profile?.auth_provider)}</div>
            <div className="min-w-0 truncate font-mono text-sm text-gray-700 dark:text-gray-200" title={profile?.public_id || ""}>{profile?.public_id || "—"}</div>
            <div className="min-w-0 truncate text-right text-sm text-gray-700 dark:text-gray-200" title={profile?.email || ""}>{profile?.email || "—"}</div>
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("settings.nickname")}</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t("common.language")}</label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            >
              {uiLanguages.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.flag} {item.name}
                </option>
              ))}
            </select>
          </div>
          {profileMsg && <p className="text-primary text-sm md:col-span-2">{profileMsg}</p>}
          <button
            type="submit"
            disabled={savingProfile}
            className="px-6 py-2.5 rounded-xl bg-primary text-dark font-semibold text-sm disabled:opacity-50 md:col-span-2"
          >
            {savingProfile ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </section>

      <section className="soft-card p-6">
        <h2 className="font-semibold mb-4">修改密码</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <input
            type="password"
            placeholder="原密码"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <input
            type="password"
            placeholder="新密码（至少 6 位）"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          {pwdErr && <p className="text-danger text-sm">{pwdErr}</p>}
          {pwdMsg && <p className="text-primary text-sm">{pwdMsg}</p>}
          <button
            type="submit"
            disabled={savingPwd || !oldPwd || !newPwd}
            className="px-6 py-2.5 rounded-xl bg-gray-900 text-white font-semibold text-sm disabled:opacity-50"
          >
            {savingPwd ? "提交中..." : "修改密码"}
          </button>
        </form>
      </section>

      <section className="soft-card p-6 mt-6">
        <h2 className="font-semibold mb-4">每日签到</h2>
        {checkin && !checkin.enabled ? (
          <p className="text-sm text-gray-400">签到功能当前未开启</p>
        ) : (
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              已累计签到 <span className="font-semibold text-gray-900">{checkin?.total_checkins ?? 0}</span> 天 · 每次奖励{" "}
              <span className="font-semibold text-primary">{checkin?.reward ?? 0}</span> 算力
            </div>
            <button
              onClick={doCheckin}
              disabled={checkin?.checked_today}
              className="px-5 py-2 rounded-xl bg-primary text-dark font-semibold text-sm disabled:opacity-50"
            >
              {checkin?.checked_today ? "今日已签到" : "立即签到"}
            </button>
          </div>
        )}
        {checkinMsg && <p className="text-primary text-sm mt-3">{checkinMsg}</p>}
      </section>

      <section className="soft-card p-6 mt-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">API 密钥</h2>
            <p className="mt-1 text-xs text-gray-400">默认创建一个密钥即可；如需分业务调用，也可以继续新增。</p>
          </div>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-white/10 dark:text-gray-300">
            {tokens.length} 个
          </span>
        </div>
        <div className="flex gap-2 mb-4">
          <input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder={tokens.length > 0 ? "新密钥名称（可选）" : "默认密钥名称（可选）"}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <button onClick={createToken} className="px-5 py-2.5 rounded-xl bg-gray-900 text-white font-semibold text-sm">
            {tokens.length > 0 ? "新增密钥" : "创建密钥"}
          </button>
        </div>
        {newToken && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50 p-3 dark:border-amber-400/20 dark:bg-amber-400/10">
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-xs text-amber-700 dark:text-amber-200">密钥已创建，请点击复制后妥善保存</div>
              <code className="block truncate text-xs font-mono text-amber-900 dark:text-amber-100">{maskToken(newToken)}</code>
            </div>
            <button
              onClick={() => copyToken("new", newToken)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-amber-200 bg-white text-amber-700 hover:bg-amber-50 dark:border-amber-400/20 dark:bg-white/10 dark:text-amber-100"
              aria-label="复制 API 密钥"
              title="复制"
            >
              {copiedKey === "new" ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
        )}
        <div className="divide-y">
          {tokens.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-6">暂无密钥</div>
          ) : (
            tokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{t.name}</div>
                  <div className="mt-0.5 truncate font-mono text-xs text-gray-400">{maskToken(t.token, t.prefix)}</div>
                  {!t.token && <div className="mt-1 text-[11px] text-amber-500">旧密钥仅可显示前缀，请重新创建后复制完整密钥</div>}
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => copyToken(String(t.id), t.token)}
                    disabled={!t.token}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"
                    aria-label="复制 API 密钥"
                    title={t.token ? "复制" : "旧密钥不可复制完整值"}
                  >
                    {copiedKey === String(t.id) ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                  <button onClick={() => deleteToken(t.id)} className="text-xs text-red-500 hover:underline">
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
