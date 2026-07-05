"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Model } from "@starai/shared-types";
import { ReferralShareButton } from "@/components/ReferralShareButton";
import { useI18n } from "@/i18n/I18nProvider";

function perM(r: Record<string, unknown>, key: string): number | null {
  const pm = Number(r[`${key}_per_m`]);
  if (Number.isFinite(pm) && pm > 0) return pm;
  const pt = Number(r[key]);
  if (Number.isFinite(pt) && pt > 0) return pt * 1_000_000;
  return null;
}

function fmt(v: number): string {
  return v >= 1000 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(4) : v.toFixed(6);
}

function priceText(m: Model, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const r = m.price_rule as unknown as Record<string, unknown> | undefined;
  if (!r) return "-";
  switch (r.billing_type) {
    case "per_token": {
      const cur = typeof r.currency === "string" ? r.currency : "";
      const parts: string[] = [];
      const input = perM(r, "input_price");
      const output = perM(r, "output_price");
      const cacheRead = perM(r, "cache_read_price");
      if (input !== null) parts.push(t("pricing.inputPrice", { value: `${cur}${fmt(input)}` }));
      if (output !== null) parts.push(t("pricing.outputPrice", { value: `${cur}${fmt(output)}` }));
      if (cacheRead !== null) parts.push(t("pricing.cacheReadPrice", { value: `${cur}${fmt(cacheRead)}` }));
      return parts.length ? `${parts.join(" / ")} / 1M Tokens` : "-";
    }
    case "per_image":
      return t("pricing.computePerImage", { value: Number(r.unit_price ?? 0) });
    case "per_request":
      return t("pricing.computePerRequest", { value: Number(r.unit_price ?? 0) });
    case "per_second":
      return t("pricing.computePerSecond", { value: Number(r.unit_price ?? 0) });
    default:
      return t("pricing.dynamicEstimate");
  }
}

export default function PricingPage() {
  const { t, td } = useI18n();
  const [models, setModels] = useState<Model[]>([]);
  const [category, setCategory] = useState("all");

  useEffect(() => {
    api<Model[]>("/api/models").then(setModels).catch(() => setModels([]));
  }, []);

  const categories = useMemo(() => ["all", ...Array.from(new Set(models.map((m) => m.category).filter(Boolean)))], [models]);
  const filtered = category === "all" ? models : models.filter((m) => m.category === category);
  const categoryLabel = (code: string) => (code === "all" ? t("common.all") : td(`category.${code}`, code));
  const billingLabel = (type?: string) => (type ? t(`billing.${type}`) : "-");

  return (
    <div className="page-container page-padding max-w-5xl flex-1 overflow-y-auto py-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950 dark:text-gray-100">{t("pricing.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {t("pricing.desc")}
          </p>
        </div>
      </div>

      <ReferralShareButton variant="card" className="mb-6" />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              category === c
                ? "bg-gray-950 text-white dark:bg-white dark:text-gray-950"
                : "border border-gray-100 bg-white text-gray-500 hover:border-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
            }`}
          >
            {categoryLabel(c)}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-gray-900">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400">
            <tr>
              <th className="px-5 py-3 text-left">{t("pricing.model")}</th>
              <th className="px-5 py-3 text-left">{t("pricing.category")}</th>
              <th className="px-5 py-3 text-left">{t("pricing.billing")}</th>
              <th className="px-5 py-3 text-left">{t("pricing.price")}</th>
              <th className="px-5 py-3 text-left">{t("pricing.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/10">
            {filtered.map((m) => (
              <tr key={m.code} className="dark:text-gray-200">
                <td className="px-5 py-4">
                  <div className="font-medium text-gray-950 dark:text-gray-100">{m.display_name}</div>
                  <div className="mt-0.5 font-mono text-xs text-gray-400">{m.code}</div>
                </td>
                <td className="px-5 py-4 text-gray-500 dark:text-gray-400">{categoryLabel(m.category)}</td>
                <td className="px-5 py-4 text-gray-500 dark:text-gray-400">{billingLabel(m.price_rule?.billing_type)}</td>
                <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{priceText(m, t)}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-2 py-1 text-xs ${m.is_enabled ? "bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-300" : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"}`}>
                    {m.is_enabled ? t("pricing.enabled") : t("pricing.disabled")}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-gray-400">{t("common.noModels")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
