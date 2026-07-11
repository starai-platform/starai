"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { KeyRound, Plus, Search } from "lucide-react";
import { SiteBrand, useSiteBranding } from "@/components/SiteBrand";
import { ReferralShareButton } from "@/components/ReferralShareButton";
import { WorkbenchTopActions } from "@/components/WorkbenchTopActions";
import { useI18n } from "@/i18n/I18nProvider";
import { apiForLocale } from "@/lib/api";

interface APIDoc {
  id: number;
  slug: string;
  title: string;
  summary: string;
  protocol: string;
  base_url: string;
  endpoint: string;
  auth_header: string;
  sdk: string;
  content: Record<string, any>;
  model_code: string;
  model_name: string;
  model_icon_url?: string;
  model_description: string;
  category: string;
  request_mode: string;
  new_api_model: string;
}

const CATEGORY_KEY: Record<string, string> = {
  chat: "nav.chat",
  multi_collab: "nav.chat",
  image: "nav.image",
  video: "nav.video",
  audio: "nav.audio",
};

function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function requestExample(doc: APIDoc, siteName = "StarAI", samples?: { image: string; audio: string; chat: string }) {
  const fromContent = doc.content?.request_example;
  if (fromContent && typeof fromContent === "object") return fromContent;
  if (doc.request_mode === "images") return { model: doc.model_code, prompt: samples?.image || "Cyberpunk-style cat", size: "1024x1024", n: 1 };
  if (doc.request_mode === "audio") return { model: doc.model_code, input: `${samples?.audio || "Welcome to"} ${siteName}`, voice: "alloy" };
  return {
    model: doc.model_code,
    messages: [{ role: "user", content: samples?.chat || "Hello, please introduce your capabilities" }],
    stream: false,
  };
}

function curlExample(doc: APIDoc, siteName = "StarAI", samples?: { image: string; audio: string; chat: string }) {
  return `curl ${doc.base_url}${doc.endpoint} \\
  -H "Content-Type: application/json" \\
  -H "${doc.auth_header}" \\
  -d '${JSON.stringify(requestExample(doc, siteName, samples))}'`;
}

export default function ApiDocsPage() {
  const { t, ts, locale } = useI18n();
  const { site_name, site_api_tagline } = useSiteBranding();
  const [docs, setDocs] = useState<APIDoc[]>([]);
  const [activeSlug, setActiveSlug] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    apiForLocale<{ items: APIDoc[] }>("/api/api-docs", locale, { signal: controller.signal })
      .then((r) => {
        const items = r.items || [];
        const docSlug =
          typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("doc") : "";
        setDocs(items);
        setActiveSlug((prev) => prev || docSlug || items[0]?.slug || "");
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setDocs([]);
      });
    return () => controller.abort();
  }, [locale]);

  const categories = useMemo(() => {
    const uniq = Array.from(new Set(docs.map((d) => d.category).filter(Boolean)));
    return ["all", ...uniq];
  }, [docs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (category !== "all" && d.category !== category) return false;
      if (q && !`${d.title} ${d.model_code} ${d.summary}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [docs, search, category]);

  const active = docs.find((d) => d.slug === activeSlug) || filtered[0] || docs[0];
  const features = Array.isArray(active?.content?.features) ? active.content.features : [];
  const notes = Array.isArray(active?.content?.notes) ? active.content.notes : [];
  const parameters = Array.isArray(active?.content?.parameters) ? active.content.parameters : [];
  const polling = active?.content?.polling && typeof active.content.polling === "object" ? active.content.polling : null;
  const categoryLabel = (code: string) => CATEGORY_KEY[code] ? t(CATEGORY_KEY[code]) : code;
  const exampleSamples = {
    image: ts("一只赛博朋克风格的猫"),
    audio: ts("你好，欢迎使用"),
    chat: ts("你好，请介绍你的能力"),
  };

  return (
    <div className="h-full min-h-0 flex overflow-hidden bg-[#F5F7FB] dark:bg-gray-950">
      <aside className="hidden lg:flex h-full min-h-0 w-[280px] shrink-0 bg-white border-r border-gray-100 flex-col dark:bg-gray-900 dark:border-white/10">
        <div className="p-4 border-b border-gray-100 dark:border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <SiteBrand
              href="/app"
              subtitle={site_api_tagline || "Open API Documentation"}
              nameClassName="font-bold text-gray-900 dark:text-gray-100"
              subtitleClassName="text-[11px] text-gray-400"
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 dark:bg-white/5 dark:border-white/10">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("apiDocs.search")}
              className="flex-1 bg-transparent text-xs focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-2 py-1 rounded-full text-[11px] ${category === c ? "bg-gray-900 text-white dark:bg-white/10 dark:text-gray-100" : "bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400"}`}
              >
                {c === "all" ? t("nav.all") : categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filtered.map((d) => (
            <button
              key={d.slug}
              onClick={() => setActiveSlug(d.slug)}
              className={`w-full text-left rounded-2xl p-3 border transition ${
                active?.slug === d.slug
                  ? "bg-white border-primary dark:bg-gray-900 dark:border-primary"
                  : "bg-white border-transparent hover:bg-gray-50 dark:bg-white/5 dark:border-white/10 dark:hover:bg-white/10"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-gray-900 text-white flex items-center justify-center overflow-hidden shrink-0">
                  {d.model_icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.model_icon_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    d.model_name[0]
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-gray-900 truncate dark:text-gray-100">{d.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600 shrink-0">
                      {categoryLabel(d.category)}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400 truncate mt-0.5">{d.model_code}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="h-full min-h-0 flex-1 min-w-0 overflow-y-auto bg-[#F5F7FB] dark:bg-gray-950">
        {!active ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-5 px-4 text-sm">
            <ReferralShareButton variant="card" />
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center text-gray-400 dark:border-white/10 dark:bg-gray-900">
              {t("apiDocs.noDocs")}
            </div>
          </div>
        ) : (
          <>
            <div className="hidden lg:flex sticky top-0 z-20 items-center justify-between gap-2 px-3 sm:px-5 py-1.5 sm:py-3 shrink-0 border-b border-gray-100 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-gray-950/90">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <Link
                  href="/app"
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-primary text-dark text-[13px] font-semibold shadow-sm hover:bg-primary/90 transition"
                >
                  <Plus size={15} />
                  {t("apiDocs.backWorkspace")}
                </Link>
              </div>
              <WorkbenchTopActions />
            </div>
            <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
            <ReferralShareButton variant="card" className="mb-5" />
            <div className="lg:hidden mb-4 space-y-3">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-100 dark:bg-gray-900 dark:border-white/10">
                <Search size={14} className="text-gray-400 shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("apiDocs.search")}
                  className="flex-1 bg-transparent text-xs focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
                />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {filtered.map((d) => (
                  <button
                    key={d.slug}
                    onClick={() => setActiveSlug(d.slug)}
                    className={`px-3 py-2 rounded-xl text-xs shrink-0 border ${
                      active.slug === d.slug
                        ? "bg-white border-primary text-primary dark:bg-gray-900"
                        : "bg-white border-gray-100 text-gray-500 dark:bg-white/5 dark:border-white/10 dark:text-gray-300"
                    }`}
                  >
                    {d.title}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="text-xs text-gray-400">
                {t("apiDocs.baseUrl")} <code className="ml-2 px-2 py-1 rounded-lg bg-white border border-gray-100">{active.base_url}</code>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/app/pricing" className="px-3 py-1.5 rounded-xl bg-white border border-gray-100 text-xs text-gray-600 hover:border-gray-200">
                  {t("apiDocs.modelPricing")}
                </Link>
                <Link href="/app/settings" className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-100 text-xs text-gray-600 hover:border-gray-200">
                  <KeyRound size={13} /> {t("apiDocs.manageKeys")}
                </Link>
              </div>
            </div>

            <section className="soft-card p-6 mb-5">
              <div className="text-xs text-gray-400 mb-2">{ts("开放 API 文档")} / {categoryLabel(active.category)}</div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold text-gray-900">{active.title}</h1>
                <span className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-semibold">{active.protocol}</span>
                <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 text-xs">{active.model_code}</span>
              </div>
              <p className="text-sm text-gray-500 mt-4 leading-relaxed">{active.summary || active.model_description}</p>
              {features.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {features.map((f: unknown, idx: number) => (
                    <span key={`${String(f)}-${idx}`} className="px-2.5 py-1 rounded-full bg-gray-50 text-gray-500 text-xs">
                      {String(f)}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="soft-card p-5 mb-5 border-emerald-100 bg-emerald-50/50">
              <h2 className="font-semibold text-gray-900 mb-2">{ts("本模型兼容规范")}</h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                {ts("使用平台统一 Base URL 与 API Key 调用，model 字段填写平台模型编码")}
                <code className="mx-1 px-1.5 py-0.5 rounded bg-white border border-emerald-100">{active.model_code}</code>.
                {ts("后端会根据模型配置自动转发到已接入的 OpenAI / New API / 自定义 API 上游。")}
              </p>
            </section>

            <section className="soft-card p-5 mb-5">
              <h2 className="font-semibold mb-3">{ts("协议与端点")}</h2>
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center gap-3 p-3 bg-gray-50">
                  <span className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-bold">POST</span>
                  <code className="text-sm text-gray-700 break-all">{active.base_url}{active.endpoint}</code>
                </div>
                <div className="p-4 text-sm text-gray-600 space-y-2">
                  <div><span className="text-gray-400">{ts("推荐 SDK")}：</span>{active.sdk || "curl"}</div>
                  <div><span className="text-gray-400">{ts("上游模型")}：</span>{active.new_api_model}</div>
                </div>
              </div>
            </section>

            <section className="soft-card p-5 mb-5">
              <h2 className="font-semibold mb-3">{ts("鉴权")}</h2>
              <div className="rounded-xl bg-gray-950 text-gray-100 p-4 text-xs overflow-x-auto">
                <pre>{active.auth_header}</pre>
              </div>
            </section>

            <section className="soft-card p-5 mb-5">
              <h2 className="font-semibold mb-3">{ts("请求示例")}</h2>
              <div className="rounded-xl bg-gray-950 text-gray-100 p-4 text-xs overflow-x-auto">
                  <pre>{curlExample(active, site_name || "StarAI", exampleSamples)}</pre>
              </div>
            </section>

            {parameters.length > 0 && (
              <section className="soft-card p-5 mb-5">
                <h2 className="font-semibold mb-3">{ts("请求参数")}</h2>
                <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-white/10">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
                      <tr>
                        <th className="px-4 py-3">{ts("参数")}</th>
                        <th className="px-4 py-3">{ts("类型")}</th>
                        <th className="px-4 py-3">{ts("必填")}</th>
                        <th className="px-4 py-3">{ts("说明")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                      {parameters.map((p: any, idx: number) => (
                        <tr key={`${p.name || "param"}-${idx}`}>
                          <td className="px-4 py-3 font-mono text-xs text-gray-900 dark:text-gray-100">{p.name}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-300">{p.type || "-"}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-300">{p.required ? ts("是") : ts("否")}</td>
                          <td className="px-4 py-3 text-xs leading-5 text-gray-600 dark:text-gray-300">{p.description || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {polling && (
              <section className="soft-card p-5 mb-5 border-blue-100 bg-blue-50/50 dark:border-blue-400/20 dark:bg-blue-500/10">
                <h2 className="font-semibold mb-2">{ts("异步任务查询")}</h2>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  {ts("图片、视频和音频接口会先返回任务号。请使用")}
                  <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-xs dark:bg-gray-950">{String((polling as any).endpoint || "/v1/tasks/{task_no}")}</code>
                  {ts("查询生成状态；需要进度事件时调用")}
                  <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-xs dark:bg-gray-950">{String((polling as any).events || "/v1/tasks/{task_no}/events")}</code>。
                </p>
                {(polling as any).notes && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{String((polling as any).notes)}</p>}
              </section>
            )}

            <section className="grid lg:grid-cols-2 gap-5 mb-5">
              <div className="soft-card p-5">
                <h2 className="font-semibold mb-3">Body JSON</h2>
                <div className="rounded-xl bg-gray-950 text-gray-100 p-4 text-xs overflow-x-auto">
                  <pre>{pretty(requestExample(active, site_name || "StarAI"))}</pre>
                </div>
              </div>
              <div className="soft-card p-5">
                <h2 className="font-semibold mb-3">{ts("响应示例")}</h2>
                <div className="rounded-xl bg-gray-950 text-gray-100 p-4 text-xs overflow-x-auto">
                  <pre>{pretty(active.content?.response_example)}</pre>
                </div>
              </div>
            </section>

            {notes.length > 0 && (
              <section className="soft-card p-5">
                <h2 className="font-semibold mb-3">{ts("注意事项")}</h2>
                <ul className="space-y-2 text-sm text-gray-600">
                  {notes.map((n: unknown, idx: number) => (
                    <li key={`${String(n)}-${idx}`} className="flex gap-2">
                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      <span>{String(n)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}


