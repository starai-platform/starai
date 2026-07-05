"use client";

import { useEffect, useMemo, useState } from "react";
import { Languages } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import type { GenerationLanguage } from "@starai/shared-types";
import { MediaMenuOption, MediaOptionMenu } from "./MediaOptionMenu";

export const DEFAULT_GENERATION_LANGUAGES: GenerationLanguage[] = [
  { code: "zh-CN", short: "ZH", name: "中文（简体）", prompt_label: "Simplified Chinese", enabled: true, sort_order: 10 },
  { code: "en-US", short: "EN", name: "English", prompt_label: "English", enabled: true, sort_order: 20 },
  { code: "ja-JP", short: "JA", name: "日本語", prompt_label: "Japanese", enabled: true, sort_order: 30 },
  { code: "ko-KR", short: "KO", name: "한국어", prompt_label: "Korean", enabled: true, sort_order: 40 },
  { code: "vi-VN", short: "VI", name: "Tiếng Việt", prompt_label: "Vietnamese", enabled: true, sort_order: 50 },
];

type PublicLanguageConfig = {
  default_locale?: string;
  generation_languages?: GenerationLanguage[];
};

function cleanLanguage(item: GenerationLanguage): GenerationLanguage | null {
  const code = String(item.code || "").trim();
  const name = String(item.name || "").trim();
  const short = String(item.short || code.slice(0, 2) || "").trim().toUpperCase();
  if (!code || !name || !short) return null;
  return {
    code,
    name,
    short,
    prompt_label: String(item.prompt_label || name).trim(),
    enabled: item.enabled !== false,
    sort_order: Number(item.sort_order ?? 0) || 0,
  };
}

export function normalizeGenerationLanguages(items?: GenerationLanguage[]) {
  const source = items?.length ? items : DEFAULT_GENERATION_LANGUAGES;
  const unique = new Map<string, GenerationLanguage>();
  source.forEach((item) => {
    const cleaned = cleanLanguage(item);
    if (cleaned?.enabled) unique.set(cleaned.code, cleaned);
  });
  const languages = Array.from(unique.values()).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  return languages.length ? languages : DEFAULT_GENERATION_LANGUAGES;
}

function matchLanguageCode(candidate: string, languages: GenerationLanguage[]) {
  const exact = languages.find((item) => item.code.toLowerCase() === candidate.toLowerCase());
  if (exact) return exact.code;
  const base = candidate.split("-")[0]?.toLowerCase();
  const sameBase = languages.find((item) => item.code.split("-")[0]?.toLowerCase() === base);
  return sameBase?.code;
}

function defaultLanguageCode(defaultLocale?: string, languages: GenerationLanguage[] = DEFAULT_GENERATION_LANGUAGES) {
  const candidates = [
    typeof window !== "undefined" ? localStorage.getItem("generation_language_code") || "" : "",
    typeof window !== "undefined" ? localStorage.getItem("site_locale") || "" : "",
    defaultLocale || "",
    typeof navigator !== "undefined" ? navigator.language : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const matched = matchLanguageCode(candidate, languages);
    if (matched) return matched;
  }
  return languages[0]?.code || "zh-CN";
}

export function buildLanguageParams(language?: GenerationLanguage | null) {
  const lang = language || DEFAULT_GENERATION_LANGUAGES[0];
  return {
    language: lang.code,
    language_label: lang.prompt_label || lang.name,
    language_name: lang.name,
  };
}

export function useGenerationLanguages() {
  const { locale: uiLocale } = useI18n();
  const [languages, setLanguages] = useState<GenerationLanguage[]>(DEFAULT_GENERATION_LANGUAGES);
  const [selectedCode, setSelectedCodeState] = useState(DEFAULT_GENERATION_LANGUAGES[0].code);

  useEffect(() => {
    let alive = true;
    api<PublicLanguageConfig>("/api/system-configs/public")
      .then((cfg) => {
        if (!alive) return;
        const next = normalizeGenerationLanguages(cfg.generation_languages);
        setLanguages(next);
        setSelectedCodeState(defaultLanguageCode(uiLocale || cfg.default_locale, next));
      })
      .catch(() => {
        if (!alive) return;
        const next = normalizeGenerationLanguages();
        setLanguages(next);
        setSelectedCodeState(defaultLanguageCode(uiLocale || "zh-CN", next));
      });
    return () => {
      alive = false;
    };
  }, [uiLocale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromUILocale = (code: string) => {
      if (localStorage.getItem("generation_language_code")) return;
      const matched = matchLanguageCode(code, languages);
      if (matched) setSelectedCodeState(matched);
    };
    syncFromUILocale(uiLocale);
    const handler = (event: Event) => {
      const next = (event as CustomEvent<{ locale?: string }>).detail?.locale;
      if (next) syncFromUILocale(next);
    };
    window.addEventListener("starai:ui-locale-change", handler);
    return () => window.removeEventListener("starai:ui-locale-change", handler);
  }, [languages, uiLocale]);

  const selectedLanguage = useMemo(
    () => languages.find((item) => item.code === selectedCode) || languages[0] || DEFAULT_GENERATION_LANGUAGES[0],
    [languages, selectedCode]
  );

  const setSelectedCode = (code: string) => {
    setSelectedCodeState(code);
    try {
      localStorage.setItem("generation_language_code", code);
    } catch {
      /* ignore */
    }
  };

  return { languages, selectedCode, setSelectedCode, selectedLanguage };
}

export function GenerationLanguageMenu({
  languages,
  value,
  onChange,
}: {
  languages: GenerationLanguage[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const active = languages.find((item) => item.code === value) || languages[0] || DEFAULT_GENERATION_LANGUAGES[0];
  return (
    <MediaOptionMenu
      icon={<Languages size={16} />}
      activeLabel={active.short}
      title={t("generation.language")}
      subtitle={t("generation.languageDesc")}
      compactOnMobile
    >
      {(close) => (
        <div className="space-y-2">
          {languages.map((item) => (
            <MediaMenuOption
              key={item.code}
              selected={item.code === active.code}
              onClick={() => {
                onChange(item.code);
                close();
              }}
            >
              <span className="flex w-full items-center justify-between gap-3">
                <span>{item.name}</span>
                <span className="text-xs font-bold text-gray-400">{item.short}</span>
              </span>
            </MediaMenuOption>
          ))}
        </div>
      )}
    </MediaOptionMenu>
  );
}
