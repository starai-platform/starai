"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type PaymentPackage = { public_id: string; name: string; amount: number; badge?: string; effective_compute_credits: number; credits_mode: "manual" | "formula" };
type PaymentConfig = {
  payment_enabled: boolean;
  card_recharge_enabled: boolean;
  payment_provider?: string;
  payment_currency?: string;
  payment_mock_mode?: boolean;
  payment_packages?: PaymentPackage[];
};

export function RechargeModal({ open, onClose, onSuccess }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"online" | "card">("card");
  const [code, setCode] = useState("");
  const [packageId, setPackageId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const packages = config?.payment_packages || [];
  const selectedPackage = packages.find((item) => item.public_id === packageId) || packages[0];
  const amount = selectedPackage?.amount || 0;

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setError("");
    api<PaymentConfig>("/api/payment/config")
      .then((c) => {
        setConfig(c);
        setTab(c.payment_enabled ? "online" : "card");
        setPackageId((current) => c.payment_packages?.some((item) => item.public_id === current) ? current : c.payment_packages?.[0]?.public_id || "");
      })
      .catch(() => setConfig(null));
  }, [open]);

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await api<{ credited: number }>("/api/recharge/card", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setMessage(t("recharge.cardSuccess", { amount: res.credited }));
      setCode("");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("recharge.failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleOnline = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await api<{ compute_credited: number; status: string; checkout_url?: string }>("/api/payment/orders", {
        method: "POST",
        body: JSON.stringify({ package_id: selectedPackage?.public_id, channel: config?.payment_provider || "mock" }),
      });
      if (res.status === "pending" && res.checkout_url) {
        window.location.assign(res.checkout_url);
        return;
      }
      setMessage(t("recharge.paymentSuccess", { amount: res.compute_credited }));
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("recharge.paymentFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-white shadow-xl dark:border-white/10 dark:bg-gray-900 dark:text-gray-100">
          <div className="modal-shell">
            <Dialog.Title className="mb-4 text-lg font-bold text-gray-950 dark:text-gray-100">{t("recharge.title")}</Dialog.Title>

            <div className="mb-4 flex gap-2 rounded-xl bg-gray-100 p-1 dark:bg-white/5">
              <button
                onClick={() => setTab("online")}
                disabled={!config?.payment_enabled}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                  tab === "online"
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100"
                    : "text-gray-500 dark:text-gray-400"
                } ${!config?.payment_enabled ? "cursor-not-allowed opacity-40" : ""}`}
              >
                {t("recharge.online")}
              </button>
              <button
                onClick={() => setTab("card")}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                  tab === "card"
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {t("recharge.card")}
              </button>
            </div>

            {tab === "online" ? (
              <div className="space-y-4">
                {packages.length > 0 ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {packages.map((item) => (
                    <button
                      key={item.public_id}
                      onClick={() => setPackageId(item.public_id)}
                      className={`relative min-h-16 rounded-xl border px-2 py-3 text-sm font-semibold transition ${
                        selectedPackage?.public_id === item.public_id
                          ? "border-primary bg-primary/10 text-primary dark:bg-primary/15"
                          : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/20"
                      }`}
                    >
                      {item.badge ? <span className="absolute -right-1.5 -top-2 max-w-[90%] truncate rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-medium text-white">{item.badge}</span> : null}
                      <span className="block">{item.amount.toFixed(2).replace(/\.00$/, "")} {config?.payment_currency || ""}</span>
                      <span className="mt-1 block text-[10px] font-medium text-emerald-600 dark:text-emerald-300">{t("recharge.creditsReceived", { amount: item.effective_compute_credits.toFixed(2).replace(/\.00$/, "") })}</span>
                      {item.name && item.name !== `${item.amount} ${config?.payment_currency || ""}` ? <span className="mt-1 block truncate text-[10px] font-normal opacity-65">{item.name}</span> : null}
                    </button>
                  ))}
                </div> : <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400 dark:border-white/10">{t("recharge.noPackages")}</div>}

                {error && <p className="text-sm text-danger">{error}</p>}
                {message && <p className="text-sm text-primary">{message}</p>}

                <button
                  onClick={handleOnline}
                  disabled={loading || !selectedPackage}
                  className="w-full rounded-xl bg-primary py-3 font-semibold text-dark disabled:opacity-50"
                >
                  {loading ? t("recharge.paying") : t("recharge.payAmount", { amount: `${amount} ${config?.payment_currency || ""}`.trim() })}
                </button>

                <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
                  {t(config?.payment_mock_mode ? "recharge.mockNotice" : "recharge.securePaymentNotice")}
                </p>
              </div>
            ) : (
              <form onSubmit={handleRedeem} className="space-y-4">
                <input
                  type="text"
                  placeholder={t("recharge.cardPlaceholder")}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-mono text-sm text-gray-900 focus:border-primary focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
                />
                {error && <p className="text-sm text-danger">{error}</p>}
                {message && <p className="text-sm text-primary">{message}</p>}
                <button
                  type="submit"
                  disabled={loading || !code}
                  className="w-full rounded-xl bg-primary py-3 font-semibold text-dark disabled:opacity-50"
                >
                  {loading ? t("recharge.redeeming") : t("recharge.redeemNow")}
                </button>
              </form>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
