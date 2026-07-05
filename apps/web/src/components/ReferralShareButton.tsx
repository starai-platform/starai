"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Gift } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import type { ReferralSummary, User } from "@starai/shared-types";

interface Props {
  variant?: "card" | "button" | "tile";
  className?: string;
}

function getStoredReferralCode() {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return "";
    return (JSON.parse(raw) as User).referral_code || "";
  } catch {
    return "";
  }
}

export function ReferralShareButton({ variant = "button", className = "" }: Props) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const stored = getStoredReferralCode();
    if (stored) setCode(stored);
    api<ReferralSummary>("/api/referrals/summary")
      .then((r) => setCode(r.referral_code || stored))
      .catch(() => {});
  }, []);

  const link = useMemo(() => {
    if (typeof window === "undefined" || !code) return "";
    return `${window.location.origin}/?referral_code=${encodeURIComponent(code)}`;
  }, [code]);

  const copy = async () => {
    setMessage("");
    if (!link) {
      setMessage(t("referral.loginRequired"));
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setMessage(t("referral.copyFailed"));
    }
  };

  if (variant === "card") {
    return (
      <div className={`rounded-2xl border border-amber-100 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10 ${className}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-950 dark:text-gray-100">
              <Gift size={17} className="text-amber-600 dark:text-amber-300" />
              {t("referral.oneClickRecommend")}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("referral.desc")}</div>
            {code && (
              <div className="mt-2 font-mono text-xs text-amber-700 dark:text-amber-200">
                {t("referral.code")}: {code}
              </div>
            )}
          </div>
          <button onClick={copy} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-gray-800 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200">
            <Copy size={16} />
            {copied ? t("referral.copied") : t("referral.copyLink")}
          </button>
        </div>
        {message && <div className="mt-2 text-xs text-amber-700 dark:text-amber-200">{message}</div>}
      </div>
    );
  }

  if (variant === "tile") {
    return (
      <button
        onClick={copy}
        className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-center text-xs transition border-gray-100 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10 ${className}`}
      >
        <Gift size={18} className="shrink-0" />
        <span className="leading-tight">{copied ? t("referral.copied") : t("referral.oneClickPromote")}</span>
      </button>
    );
  }

  return (
    <button onClick={copy} className={`inline-flex items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200 ${className}`}>
      <Gift size={16} />
      {copied ? t("referral.copied") : t("referral.oneClickRecommend")}
    </button>
  );
}
