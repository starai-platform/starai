"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import { clsx } from "clsx";
import type { Model } from "@starai/shared-types";
import { api } from "@/lib/api";
import { CATEGORY_TAG, MODEL_ICONS } from "./categoryMeta";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/** Resolve a per-1M-tokens display value: prefers `{key}_per_m`, falls back to per-token `{key}` x 1e6. */
function pricePerM(price: any, key: string): number | null {
  const perM = num(price?.[`${key}_per_m`]);
  if (perM !== null) return perM;
  const perToken = num(price?.[key]);
  if (perToken !== null) return perToken * 1_000_000;
  return null;
}

function formatPerM(perM: number) {
  if (perM >= 1000) return perM.toFixed(2);
  if (perM >= 0.01) return perM.toFixed(4);
  return perM.toFixed(6);
}

const TOKEN_PRICE_ROWS: { key: string; label: string; required?: boolean }[] = [
  { key: "input_price", label: "输入价格（Prompt）", required: true },
  { key: "output_price", label: "输出价格（Completion）", required: true },
  { key: "cache_read_price", label: "缓存读取价格（命中）" },
  { key: "cache_write_price", label: "缓存写入价格" },
];

export function PricingModal({
  open,
  onClose,
  currentModelCode,
}: {
  open: boolean;
  onClose: () => void;
  currentModelCode?: string;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | "chat" | "image" | "video" | "audio">("all");
  const [activeCode, setActiveCode] = useState<string | undefined>(currentModelCode);

  useEffect(() => {
    if (!open) return;
    setErr("");
    setLoading(true);
    setActiveCode(currentModelCode);
    api<Model[]>("/api/models")
      .then((items) => {
        setModels(items || []);
        setActiveCode((prev) => currentModelCode || prev || items?.[0]?.code);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentModelCode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return models.filter((m) => {
      const viewCat = m.category === "multi_collab" ? "chat" : m.category;
      if (cat !== "all" && viewCat !== cat) return false;
      if (!kw) return true;
      if (m.code.toLowerCase().includes(kw)) return true;
      if (m.display_name.toLowerCase().includes(kw)) return true;
      if ((m.description || "").toLowerCase().includes(kw)) return true;
      if ((m.tags || []).some((t) => t.toLowerCase().includes(kw))) return true;
      return false;
    });
  }, [models, q, cat]);

  const active = useMemo(
    () => filtered.find((m) => m.code === activeCode) || models.find((m) => m.code === activeCode) || null,
    [filtered, models, activeCode]
  );

  const price = active?.price_rule as any;
  const billingType = (price?.billing_type || "") as string;
  const unitPrice = num(price?.unit_price);
  const currency = typeof price?.currency === "string" && price.currency ? price.currency : "";
  const surchargePerM = num(price?.surcharge_per_m);
  const tokenRows = TOKEN_PRICE_ROWS.map((row) => ({
    ...row,
    value: pricePerM(price, row.key),
  }))
    .concat(surchargePerM !== null && surchargePerM > 0 ? [{ key: "surcharge", label: "平台附加费", value: surchargePerM }] : [])
    .filter((row) => row.required || row.value !== null);

  const billingLabel =
    billingType === "per_token"
      ? "按 Token 计费"
      : billingType === "per_request"
        ? "按次计费"
        : billingType === "per_image"
          ? "按张计费"
          : billingType === "per_second"
            ? "按秒计费"
            : billingType || "未知";

  const headerHint =
    billingType === "per_token"
      ? "按 Token 计费，页面统一换算为每 1M Tokens 展示。"
      : billingType === "per_second"
        ? "按秒计费，通常会受到视频时长与生成数量共同影响。"
        : billingType === "per_request"
          ? "按次计费，每次调用消耗固定额度。"
          : "查看当前模型的计费方式、展示口径与单价。";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-[980px] overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl dark:border-white/10 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <div className="text-base font-bold text-gray-900 dark:text-gray-100">模型价格查询</div>
            <div className="mt-0.5 text-xs text-gray-400">{headerHint}</div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[360px_1fr]">
          <div className="border-b border-gray-100 dark:border-white/10 md:border-b-0 md:border-r">
            <div className="p-4">
              <div className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                <Search size={14} className="shrink-0 text-gray-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜索：模型名称 / 编码 / 标签"
                  className="flex-1 bg-transparent text-sm placeholder:text-gray-400 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {[
                  { code: "all" as const, label: "全部" },
                  { code: "chat" as const, label: "聊天" },
                  { code: "image" as const, label: "图片" },
                  { code: "video" as const, label: "视频" },
                  { code: "audio" as const, label: "音频" },
                ].map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setCat(c.code)}
                    className={clsx(
                      "h-8 rounded-full border px-3 text-xs transition",
                      cat === c.code
                        ? "border-gray-900 bg-gray-900 text-white dark:border-primary dark:bg-primary dark:text-dark"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/20"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[56vh] overflow-y-auto px-3 pb-4">
              {loading && <div className="py-10 text-center text-sm text-gray-400">加载中...</div>}
              {!!err && !loading && <div className="py-10 text-center text-sm text-red-500">{err}</div>}
              {!loading && !err && filtered.length === 0 && <div className="py-10 text-center text-sm text-gray-400">没有匹配的模型</div>}

              <div className="space-y-2">
                {filtered.map((m) => {
                  const selected = m.code === activeCode;
                  const viewCat = m.category === "multi_collab" ? "chat" : m.category;
                  const tag = CATEGORY_TAG[m.category] || CATEGORY_TAG[viewCat] || { label: viewCat, className: "bg-gray-100 text-gray-600" };
                  return (
                    <button
                      key={m.code}
                      type="button"
                      onClick={() => setActiveCode(m.code)}
                      className={clsx(
                        "w-full rounded-2xl border p-3 text-left transition",
                        selected
                          ? "border-primary/30 bg-primary/5 dark:bg-primary/10"
                          : "border-gray-100 bg-white hover:border-gray-200 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
                      )}
                    >
                      <div className="flex gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-white dark:border-white/10 dark:bg-white/10">
                          {m.icon_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.icon_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-lg">{MODEL_ICONS[viewCat] || "AI"}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{m.display_name}</div>
                            <span className={clsx("shrink-0 rounded-full px-1.5 py-0.5 text-[10px]", tag.className)}>{tag.label}</span>
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] text-gray-400">{m.description || m.code}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-5">
            {!active ? (
              <div className="py-12 text-center text-sm text-gray-400">请选择左侧模型</div>
            ) : (
              <div className="space-y-4">
                <div className="soft-card p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-100 bg-white dark:border-white/10 dark:bg-white/10">
                      {active.icon_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={active.icon_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-2xl">{MODEL_ICONS[active.category === "multi_collab" ? "chat" : active.category] || "AI"}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-lg font-bold text-gray-900 dark:text-gray-100">{active.display_name}</div>
                      <div className="mt-0.5 truncate text-xs text-gray-400">{active.code}</div>
                    </div>
                  </div>
                  {active.description && <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-300">{active.description}</div>}
                  {active.tags?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {active.tags.slice(0, 10).map((t) => (
                        <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-white/10 dark:text-gray-300">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="soft-card p-4">
                    <div className="text-xs text-gray-400">计费方式</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{billingLabel}</div>
                    <div className="mt-2 text-xs text-gray-400">
                      {billingType === "per_second"
                        ? "费用通常约等于单价 x 时长（秒）x 生成数量，实际以提交参数为准。"
                        : billingType === "per_token"
                          ? "输入、输出、缓存读取等价格会分别展示，方便核对实际成本。"
                          : "价格以系统算力度量为准，充值后即可直接调用。"}
                    </div>
                  </div>
                  <div className="soft-card p-4">
                    <div className="text-xs text-gray-400">展示口径</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {billingType === "per_token"
                        ? "每 1M Tokens"
                        : billingType === "per_second"
                          ? "算力 / 秒"
                          : billingType === "per_request"
                            ? "算力 / 次"
                            : billingType === "per_image"
                              ? "算力 / 张"
                              : "算力"}
                    </div>
                    <div className="mt-2 text-xs text-gray-400">
                      {billingType === "per_token"
                        ? "如果后台存的是单 Token 单价，这里会自动换算成每 1M Tokens。"
                        : "前台输入区中的“预估”金额，会基于当前参数做近似计算。"}
                    </div>
                  </div>
                </div>

                <div className="soft-card p-5">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">价格</div>
                  {billingType === "per_token" ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {tokenRows.map((row) => (
                        <div key={row.key} className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-white/5">
                          <div className="text-xs text-gray-400">{row.label}</div>
                          <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
                            {row.value === null ? "--" : `${currency}${formatPerM(row.value)}`}
                          </div>
                          <div className="mt-1 text-xs text-gray-400">/ 1M Tokens</div>
                        </div>
                      ))}
                    </div>
                  ) : billingType === "per_second" || billingType === "per_request" || billingType === "per_image" ? (
                    <div className="mt-3">
                      <div className="inline-block min-w-[180px] rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-white/5">
                        <div className="text-xs text-gray-400">单价</div>
                        <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{unitPrice === null ? "--" : unitPrice.toFixed(4)}</div>
                        <div className="mt-1 text-xs text-gray-400">
                          算力
                          {billingType === "per_second" ? " / 秒" : billingType === "per_image" ? " / 张" : " / 次"}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">该模型暂时没有固定单价配置。</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
