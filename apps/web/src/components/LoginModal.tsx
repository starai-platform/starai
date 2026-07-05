"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import type { User } from "@starai/shared-types";
import { SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY } from "@/components/ForcedAnnouncementModal";
import { useI18n } from "@/i18n/I18nProvider";
import { useSiteBranding } from "./SiteBrand";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "email" | "account";
type LegalDoc = "terms" | "privacy";

const LOGIN_MODAL_CLASS =
  "modal-shell fixed left-1/2 top-1/2 z-50 mx-0 max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl";

const LEGAL_MODAL_CLASS =
  "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11151b] text-white shadow-2xl shadow-black/40";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18A10.96 10.96 0 0 1 12 5.98c.98 0 1.96.13 2.88.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function CaptchaRow({
  captchaSvg,
  captchaInput,
  onCaptchaInputChange,
  onRefresh,
}: {
  captchaSvg: string;
  captchaInput: string;
  onCaptchaInputChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div
        className="flex h-10 w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
        dangerouslySetInnerHTML={captchaSvg ? { __html: captchaSvg } : undefined}
      />
      <input
        type="text"
        placeholder={t("login.captcha")}
        value={captchaInput}
        onChange={(e) => onCaptchaInputChange(e.target.value)}
        required
        className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
      />
      <button type="button" onClick={onRefresh} className="shrink-0 px-2 text-xs text-gray-500 hover:text-primary">
        {t("login.refresh")}
      </button>
    </div>
  );
}

function LegalModal({
  doc,
  title,
  content,
  onClose,
}: {
  doc: LegalDoc | null;
  title: string;
  content: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!doc) return null;
  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
        <Dialog.Title className="text-base font-semibold text-white">{title}</Dialog.Title>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-lg px-2 py-1 text-xl leading-none text-white/45 hover:bg-white/10 hover:text-white">
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-scroll overscroll-contain px-5 py-5" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="whitespace-pre-wrap break-words text-sm leading-7 text-white/72">
          {content.trim() || t("login.legalEmpty")}
        </div>
      </div>
      <div className="shrink-0 border-t border-white/10 bg-white/[0.02] px-5 py-4 text-right">
        <button type="button" onClick={onClose} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-dark hover:bg-primary/90">
          {t("common.gotIt")}
        </button>
      </div>
    </>
  );
}

export function LoginModal({ open, onClose }: Props) {
  const { site_name, image_captcha_enabled, terms_title, terms_content, privacy_title, privacy_content } = useSiteBranding();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("email");
  const [step, setStep] = useState<"form" | "set_password">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isNewUser, setIsNewUser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState<{ google?: boolean; github?: boolean }>({});
  const [oauthLoading, setOauthLoading] = useState("");
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);
  const { setAuth } = useAuthStore();
  const router = useRouter();
  const rawImageCaptchaEnabled = image_captcha_enabled as unknown;
  const captchaEnabled = !(
    rawImageCaptchaEnabled === false ||
    rawImageCaptchaEnabled === 0 ||
    String(rawImageCaptchaEnabled).toLowerCase() === "false"
  );

  const loadCaptcha = useCallback(async () => {
    try {
      const res = await api<{ id: string; image_svg: string }>("/api/auth/captcha");
      setCaptchaId(res.id);
      setCaptchaSvg(res.image_svg);
      setCaptchaInput("");
    } catch {
      setError(t("login.captchaLoadFailed"));
    }
  }, [t]);

  const resetForm = useCallback(() => {
    setStep("form");
    setPassword("");
    setConfirmPwd("");
    setEmailCode("");
    setReferralCode("");
    setCaptchaInput("");
    setAgreed(false);
    setIsNewUser(false);
    setError("");
    setCountdown(0);
  }, []);

  useEffect(() => {
    if (!open) {
      setLegalDoc(null);
      return;
    }
    resetForm();
    const fromURL = new URLSearchParams(window.location.search).get("referral_code") || "";
    setReferralCode(fromURL.replace(/\D/g, "").slice(0, 6));
    setTab("email");
    api<{ google: boolean; github: boolean }>("/api/auth/oauth/providers")
      .then(setProviders)
      .catch(() => setProviders({}));
  }, [open, resetForm]);

  useEffect(() => {
    if (!open) return;
    if (captchaEnabled && tab === "account") {
      loadCaptcha();
    } else {
      setCaptchaId("");
      setCaptchaSvg("");
      setCaptchaInput("");
    }
  }, [open, captchaEnabled, loadCaptcha, tab]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const oauthLogin = async (provider: "google" | "github") => {
    setOauthLoading(provider);
    setError("");
    try {
      const suffix = referralCode.trim() ? `?referral_code=${encodeURIComponent(referralCode.trim())}` : "";
      const res = await api<{ url: string }>(`/api/auth/oauth/${provider}/url${suffix}`);
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.redirectFailed"));
      setOauthLoading("");
    }
  };

  const sendCode = async () => {
    if (!email.trim()) return setError(t("login.enterEmail"));
    if (!agreed) return setError(t("login.agreeRequired"));
    setLoading(true);
    setError("");
    try {
      const res = await api<{ debug_code?: string }>("/api/auth/email/send-code", {
        method: "POST",
        body: JSON.stringify({ email, captcha_id: captchaId, captcha_code: captchaInput }),
      });
      setCountdown(60);
      if (res.debug_code) {
        setEmailCode(res.debug_code);
        setError(t("login.debugCode", { code: res.debug_code }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.sendFailed"));
    } finally {
      setLoading(false);
    }
  };

  const verifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) return setError(t("login.agreeRequired"));
    setLoading(true);
    setError("");
    try {
      const res = await api<{ token: string; user: User; needs_set_password?: boolean; is_new_user?: boolean }>("/api/auth/email/verify", {
        method: "POST",
        body: JSON.stringify({ email, code: emailCode, referral_code: referralCode.trim() }),
      });
      setAuth(res.token, res.user);
      if (res.needs_set_password) {
        setIsNewUser(!!res.is_new_user);
        setStep("set_password");
      } else {
        if (res.is_new_user) window.localStorage.setItem(SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY, "1");
        onClose();
        router.push("/app");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.verifyFailed"));
    } finally {
      setLoading(false);
    }
  };

  const accountLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (captchaEnabled && !captchaInput.trim()) return setError(t("login.enterCaptcha"));
    setLoading(true);
    setError("");
    try {
      const res = await api<{ token: string; user: User }>("/api/auth/login/password", {
        method: "POST",
        body: JSON.stringify({ email, password, captcha_id: captchaId, captcha_code: captchaInput }),
      });
      setAuth(res.token, res.user);
      onClose();
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.loginFailed"));
      if (captchaEnabled) loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return setError(t("login.passwordMin"));
    if (password !== confirmPwd) return setError(t("login.passwordMismatch"));
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/set-password", { method: "POST", body: JSON.stringify({ password }) });
      if (isNewUser) window.localStorage.setItem(SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY, "1");
      onClose();
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.setPasswordFailed"));
    } finally {
      setLoading(false);
    }
  };

  const hasOAuth = !!providers.google || !!providers.github;
  const siteName = site_name || "StarAI";
  const legalTitle = legalDoc === "privacy" ? privacy_title || t("login.privacy") : terms_title || t("login.terms");
  const legalContent = legalDoc === "privacy" ? privacy_content || "" : terms_content || "";

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className={legalDoc ? LEGAL_MODAL_CLASS : LOGIN_MODAL_CLASS}>
          {legalDoc ? (
            <LegalModal doc={legalDoc} title={legalTitle} content={legalContent} onClose={() => setLegalDoc(null)} />
          ) : step === "set_password" ? (
            <>
              <Dialog.Title className="mb-1 text-xl font-bold">{t("login.setPassword")}</Dialog.Title>
              <Dialog.Description className="mb-6 text-sm text-gray-500">
                {isNewUser ? t("login.setPasswordDescNew") : t("login.setPasswordDesc")}
              </Dialog.Description>
              <form onSubmit={submitPassword} className="space-y-4">
                <input type="password" placeholder={t("login.newPassword")} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                <input type="password" placeholder={t("login.confirmPassword")} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                {error && <p className="text-sm text-danger">{error}</p>}
                <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3 font-semibold text-dark transition hover:bg-primary/90 disabled:opacity-50">
                  {loading ? t("common.saving") : t("login.finish")}
                </button>
                <button type="button" onClick={() => { onClose(); router.push("/app"); }} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600">
                  {t("login.later")}
                </button>
              </form>
            </>
          ) : (
            <>
              <Dialog.Title className="mb-1 text-xl font-bold">{t("login.title", { site: siteName })}</Dialog.Title>
              <Dialog.Description className="mb-6 text-sm text-gray-500">{t("login.desc")}</Dialog.Description>
              <div className="mb-6 flex gap-2">
                {[
                  { key: "email" as const, label: t("login.emailTab") },
                  { key: "account" as const, label: t("login.accountTab") },
                ].map((item) => (
                  <button key={item.key} type="button" onClick={() => { setTab(item.key); setError(""); if (captchaEnabled && item.key === "account") loadCaptcha(); }} className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${tab === item.key ? "bg-primary text-dark" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    {item.label}
                  </button>
                ))}
              </div>

              {tab === "email" ? (
                <form onSubmit={verifyEmail} className="space-y-4">
                  <input type="email" placeholder={t("login.email")} value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                  <div className="flex gap-2">
                    <input type="text" placeholder={t("login.emailCode")} value={emailCode} onChange={(e) => setEmailCode(e.target.value)} required maxLength={6} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                    <button type="button" disabled={loading || countdown > 0} onClick={sendCode} className="shrink-0 rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      {countdown > 0 ? `${countdown}s` : t("login.getCode")}
                    </button>
                  </div>
                  <input type="text" placeholder={t("login.referral")} value={referralCode} onChange={(e) => setReferralCode(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                  <label className="flex cursor-pointer select-none items-start gap-2 text-xs text-gray-500">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                    <span>
                      {t("login.agreePrefix")}
                      <button type="button" onClick={(e) => { e.preventDefault(); setLegalDoc("terms"); }} className="mx-0.5 text-primary hover:underline">{t("login.terms")}</button>
                      {t("login.and")}
                      <button type="button" onClick={(e) => { e.preventDefault(); setLegalDoc("privacy"); }} className="mx-0.5 text-primary hover:underline">{t("login.privacy")}</button>
                    </span>
                  </label>
                  {error && <p className="text-sm text-danger">{error}</p>}
                  <button type="submit" disabled={loading || !agreed} className="w-full rounded-xl bg-primary py-3 font-semibold text-dark transition hover:bg-primary/90 disabled:opacity-50">
                    {loading ? t("login.verifying") : t("login.submit")}
                  </button>
                  <p className="text-center text-[11px] text-gray-400">{t("login.firstHint")}</p>
                </form>
              ) : (
                <form onSubmit={accountLogin} className="space-y-4">
                  <input type="email" placeholder={t("login.email")} value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                  <input type="password" placeholder={t("login.password")} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-primary focus:outline-none" />
                  {captchaEnabled && <CaptchaRow captchaSvg={captchaSvg} captchaInput={captchaInput} onCaptchaInputChange={setCaptchaInput} onRefresh={loadCaptcha} />}
                  {error && <p className="text-sm text-danger">{error}</p>}
                  <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3 font-semibold text-dark transition hover:bg-primary/90 disabled:opacity-50">
                    {loading ? t("login.loading") : t("login.login")}
                  </button>
                </form>
              )}

              {hasOAuth && (
                <div className="mt-5">
                  <div className="flex items-center gap-3 text-[11px] text-gray-400">
                    <span className="h-px flex-1 bg-gray-100" /> {t("login.oauth")} <span className="h-px flex-1 bg-gray-100" />
                  </div>
                  <div className="mt-4 flex gap-3">
                    {providers.google && <button type="button" disabled={!!oauthLoading} onClick={() => oauthLogin("google")} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"><GoogleIcon />{oauthLoading === "google" ? "..." : "Google"}</button>}
                    {providers.github && <button type="button" disabled={!!oauthLoading} onClick={() => oauthLogin("github")} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"><GithubIcon />{oauthLoading === "github" ? "..." : "GitHub"}</button>}
                  </div>
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
