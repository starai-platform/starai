"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Bell,
  Compass,
  FileText,
  Image as ImageIcon,
  LogOut,
  Moon,
  Settings,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { ReferralShareButton } from "./ReferralShareButton";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  onRecharge?: () => void;
}

type Announcement = { id: number; title: string; content: string; level: string; created_at: string };
type StoredUser = { nickname?: string; referral_code?: string; member_level?: string };

function QuickEntryIcon() {
  return (
    <span className="grid h-4 w-4 grid-cols-2 gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="rounded-[3px] bg-primary shadow-[0_0_8px_rgba(18,214,163,0.45)]" />
      ))}
    </span>
  );
}

function initialDarkMode() {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem("theme");
  if (stored) return stored === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
}

export function WorkbenchUserMenu({ onRecharge }: Props) {
  const { t } = useI18n();
  const { logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [wallet, setWallet] = useState<{ compute_balance?: number; cash_balance?: number } | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [darkMode, setDarkMode] = useState(false);

  const navItems = useMemo(
    () => [
      { href: "/app/works", label: t("nav.works"), desc: t("menu.worksDesc"), icon: ImageIcon, color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300" },
      { href: "/app/wallet", label: t("nav.wallet"), desc: t("menu.walletDesc"), icon: Wallet, color: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300" },
      { href: "/app/gallery", label: t("nav.gallery"), desc: t("menu.galleryDesc"), icon: Compass, color: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300" },
      { href: "/app/settings", label: t("nav.settings"), desc: t("menu.settingsDesc"), icon: Settings, color: "bg-gray-50 text-gray-600 dark:bg-white/10 dark:text-gray-300" },
      { href: "/app/pricing", label: t("nav.pricing"), desc: t("menu.pricingDesc"), icon: BadgeDollarSign, color: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300" },
      { href: "/app/api-docs", label: t("nav.apiDocs"), desc: t("menu.apiDocsDesc"), icon: FileText, color: "bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-300" },
    ],
    [t]
  );

  useEffect(() => {
    const isDark = initialDarkMode();
    setDarkMode(isDark);
    document.documentElement.classList.toggle("dark", isDark);

  }, []);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem("user");
      setUser(raw ? JSON.parse(raw) : null);
    } catch {
      setUser(null);
    }
    api<{ compute_balance: number; cash_balance: number }>("/api/wallet")
      .then((w) => setWallet(w))
      .catch(() => setWallet(null));
    api<StoredUser>("/api/me")
      .then((u) => {
        setUser(u);
        try {
          localStorage.setItem("user", JSON.stringify(u));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }, [open]);

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const openAnnouncements = () => {
    setOpen(false);
    setAnnounceOpen(true);
    api<{ items: Announcement[] }>("/api/announcements")
      .then((r) => setAnnouncements(r.items || []))
      .catch(() => setAnnouncements([]));
  };

  return (
    <>
      <div className="relative" data-starai-user-menu>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm hover:border-primary/40 hover:bg-primary/15 dark:border-primary/30 dark:bg-primary/10 dark:text-primary"
          aria-label={t("menu.quickEntry")}
        >
          <QuickEntryIcon />
        </button>

        {open && (
          <>
          <button type="button" aria-label={t("common.close")} className="fixed inset-0 z-20 cursor-default bg-transparent" onClick={() => setOpen(false)} />
          <div className="fixed left-4 right-4 top-16 z-30 rounded-2xl border border-white/80 bg-white p-3 shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[340px] dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{user?.nickname || t("common.notLoggedIn")}</div>
                <div className="mt-0.5 text-[11px] text-gray-400">
                  {user?.member_level || t("menu.defaultMember")} · {t("menu.referralCode")} <span className="font-mono text-gray-700 dark:text-gray-200">{user?.referral_code || "--"}</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  {t("common.compute")} <span className="font-medium text-gray-700 dark:text-gray-200">{wallet?.compute_balance?.toFixed(2) ?? "--"}</span>
                  <span className="mx-1">·</span>
                  {t("menu.cash")} <span className="font-medium text-gray-700 dark:text-gray-200">¥{wallet?.cash_balance?.toFixed(2) ?? "--"}</span>
                </div>
              </div>
              {onRecharge && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onRecharge();
                  }}
                  className="shrink-0 rounded-xl bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
                >
                  {t("common.recharge")}
                </button>
              )}
            </div>

            <div className="my-3 h-px bg-gray-100 dark:bg-white/10" />

            <button
              type="button"
              onClick={toggleTheme}
              className="mb-2 flex w-full items-center justify-between rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 transition hover:border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
            >
              <span className="flex items-center gap-2">
                {darkMode ? <Moon size={16} /> : <Sun size={16} />}
                {darkMode ? t("common.theme.dark") : t("common.theme.light")}
              </span>
              <span className="text-xs text-gray-400">{darkMode ? t("common.theme.toLight") : t("common.theme.toDark")}</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 transition hover:border-gray-200 hover:shadow-sm dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.color}`}>
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.label}</div>
                      <div className="mt-0.5 truncate text-[11px] text-gray-400">{item.desc}</div>
                    </div>
                  </Link>
                );
              })}
              <ReferralShareButton className="col-span-2 h-12" />
            </div>

            <div className="my-3 h-px bg-gray-100 dark:bg-white/10" />

            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={openAnnouncements} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5">
                <Bell size={16} className="text-gray-400" />
                {t("common.announcement")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  setOpen(false);
                  try {
                    await api("/api/auth/logout", { method: "POST" });
                  } catch {
                    /* ignore */
                  }
                  logout();
                  window.location.href = "/";
                }}
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
              >
                <LogOut size={16} className="text-gray-400" />
                {t("common.logout")}
              </button>
            </div>
          </div>
          </>
        )}
      </div>

      {announceOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setAnnounceOpen(false)}>
          <div className="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-950 dark:text-gray-100">{t("announcement.title")}</h3>
              <button onClick={() => setAnnounceOpen(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600 dark:hover:bg-white/5">
                <X size={18} />
              </button>
            </div>
            {announcements.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">{t("announcement.empty")}</div>
            ) : (
              <div className="space-y-4">
                {announcements.map((a) => (
                  <div key={a.id} className="rounded-xl border border-gray-100 p-4 dark:border-white/10">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">{a.level}</span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{a.title}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-300">{a.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
