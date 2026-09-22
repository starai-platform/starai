"use client";

import { BUILTIN_LANGUAGE_META, BUILTIN_KEY_TRANSLATIONS } from "./builtins";
import { sourceTranslationKey, translateBuiltinSource, interpolate, usableTranslation, hasCJKText } from "./translation";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { UILanguage, UITranslationOverride, User } from "@starai/shared-types";
import { api, apiCached, hasUserSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { DEFAULT_UI_LANGUAGES, dictionaries, loadLocaleDictionaries, sourceTranslations, SUPPORTED_UI_LOCALES, type TranslationKey } from "./dictionaries";

type PublicConfig = {
  default_locale?: string;
  ui_languages?: UILanguage[];
  ui_translation_overrides?: UITranslationOverride[];
};

type I18nContextValue = {
  locale: string;
  language: UILanguage;
  languages: UILanguage[];
  setLocale: (code: string, options?: { persistUser?: boolean }) => void;
  t: (key: TranslationKey | string, vars?: Record<string, string | number>) => string;
  td: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
  ts: (source: string) => string;
  formatDate: (value: string | number | Date) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function isSupported(code: string) {
  return SUPPORTED_UI_LOCALES.includes(code as any);
}

function normalizeLanguage(item: UILanguage): UILanguage | null {
  const code = String(item.code || "").trim();
  if (!code || !isSupported(code)) return null;
  const builtin = BUILTIN_LANGUAGE_META[code];
  const short = String(item.short || builtin?.short || code.slice(0, 2)).trim().toUpperCase();
  const name = String(item.name || builtin?.name || short).trim();
  const fallback = DEFAULT_UI_LANGUAGES.find((lang) => lang.code === code) as UILanguage | undefined;
  const rawFlag = String(item.flag || "").trim();
  const cleanFlag = rawFlag && !/[cn]/.test(rawFlag) ? rawFlag : "";
  const flag = String(cleanFlag || builtin?.flag || fallback?.flag || "\u{1F310}").trim() || builtin?.flag || "\u{1F310}";
  return {
    code,
    short,
    name,
    flag,
    flag_url: String(item.flag_url || fallback?.flag_url || "").trim() || undefined,
    enabled: item.enabled !== false,
    sort_order: Number(item.sort_order ?? 0) || 0,
  };
}

export function normalizeUILanguages(items?: UILanguage[]) {
  const source = items?.length ? items : DEFAULT_UI_LANGUAGES;
  const unique = new Map<string, UILanguage>();
  source.forEach((item) => {
    const cleaned = normalizeLanguage(item);
    if (cleaned?.enabled) unique.set(cleaned.code, cleaned);
  });
  const list = Array.from(unique.values()).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  return list.length ? list : DEFAULT_UI_LANGUAGES;
}

function matchLocale(candidates: string[], languages: UILanguage[]) {
  for (const candidate of candidates.filter(Boolean)) {
    const exact = languages.find((item) => item.code.toLowerCase() === candidate.toLowerCase());
    if (exact) return exact.code;
    const base = candidate.split("-")[0]?.toLowerCase();
    const sameBase = languages.find((item) => item.code.split("-")[0]?.toLowerCase() === base);
    if (sameBase) return sameBase.code;
  }
  return languages[0]?.code || "zh-CN";
}

function updateStoredUserLocale(code: string) {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return;
    const user = JSON.parse(raw) as User;
    localStorage.setItem("user", JSON.stringify({ ...user, locale: code }));
  } catch {
    /* ignore */
  }
}

function normalizeTranslationOverrides(items?: UITranslationOverride[]) {
  const result: Record<string, Record<string, string>> = {};
  if (!Array.isArray(items)) return result;
  for (const item of items) {
    if (item?.enabled === false) continue;
    const locale = String(item?.locale || "").trim();
    const key = String(item?.key || "").trim();
    const value = String(item?.value || "").trim();
    if (!locale || !isSupported(locale) || !key || !value) continue;
    // Chinese UI should use the built-in Chinese dictionary and admin-provided
    // original Chinese content. Skipping zh-CN overrides prevents imported
    // review files from replacing stable built-ins with partial values.
    if (locale === "zh-CN") continue;
    // en-US overrides must be English. If a mixed CN file was imported by
    // mistake, do not let Chinese values pollute the English UI.
    if (locale === "en-US" && hasCJKText(value)) continue;
    result[locale] ||= {};
    result[locale][key] = value;
  }
  return result;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [languages, setLanguages] = useState<UILanguage[]>(DEFAULT_UI_LANGUAGES);
  const [locale, setLocaleState] = useState("zh-CN");
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});
  const localeRequestRef = useRef(0);
  const selectedLocaleRef = useRef<string | null>(null);

  const activateLocale = useCallback((next: string, onActivated?: () => void) => {
    const request = ++localeRequestRef.current;
    void loadLocaleDictionaries(next)
      .then(() => {
        if (request !== localeRequestRef.current) return;
        localStorage.setItem("site_locale", next);
        setLocaleState(next);
        onActivated?.();
      })
      .catch(() => {
        if (request === localeRequestRef.current) {
          localStorage.setItem("site_locale", "zh-CN");
          setLocaleState("zh-CN");
        }
      });
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    let alive = true;
    apiCached<PublicConfig>("/api/system-configs/public", 60_000, false)
      .then((cfg) => {
        if (!alive) return;
        const next = normalizeUILanguages(cfg?.ui_languages);
        setLanguages(next);
        setOverrides(normalizeTranslationOverrides(cfg?.ui_translation_overrides));
        const stored = localStorage.getItem("site_locale") || "";
        if (selectedLocaleRef.current && next.some((item) => item.code === selectedLocaleRef.current)) return;
        const userLocale = useAuthStore.getState().user?.locale || "";
        const target = matchLocale([stored, userLocale, cfg?.default_locale || "", navigator.language], next);
        activateLocale(target);
      })
      .catch(() => {
        if (!alive) return;
        const next = normalizeUILanguages();
        setLanguages(next);
        setOverrides({});
        if (selectedLocaleRef.current) return;
        const target = matchLocale([localStorage.getItem("site_locale") || "", useAuthStore.getState().user?.locale || "", navigator.language], next);
        activateLocale(target);
      });
    return () => {
      alive = false;
    };
  }, [activateLocale, user?.locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (code: string, options: { persistUser?: boolean } = {}) => {
      const next = matchLocale([code], languages);
      selectedLocaleRef.current = next;
      activateLocale(next, () => {
        updateStoredUserLocale(next);
        if (options.persistUser !== false && hasUserSession()) {
          api<User>("/api/me/profile", { method: "PATCH", body: JSON.stringify({ locale: next }) }).catch(() => {});
        }
        window.dispatchEvent(new CustomEvent("starai:ui-locale-change", { detail: { locale: next } }));
      });
    },
    [activateLocale, languages]
  );

  const t = useCallback(
    (key: TranslationKey | string, vars?: Record<string, string | number>) => {
      const overrideCurrent = usableTranslation(overrides[locale]?.[key as string]);
      const keyCurrent = usableTranslation(BUILTIN_KEY_TRANSLATIONS[key as string]?.[locale]);
      const rawCurrent = usableTranslation(dictionaries[locale]?.[key as TranslationKey]);
      const rawEnglish = usableTranslation(dictionaries["en-US"]?.[key as TranslationKey]);
      // The initial ja/ko/vi catalogs were bootstrapped from English. Treat an
      // unchanged English value as a placeholder so a real built-in/admin
      // translation can win, instead of making the language switch look inert.
      const current = locale !== "en-US" && locale !== "zh-CN" && rawCurrent === rawEnglish ? "" : rawCurrent;
      const overrideEn = usableTranslation(overrides["en-US"]?.[key as string]);
      const fallbackEn = rawEnglish;
      const overrideZh = usableTranslation(overrides["zh-CN"]?.[key as string]);
      const fallbackZh = usableTranslation(dictionaries["zh-CN"]?.[key as TranslationKey]);
      const sourceFallback = locale !== "zh-CN" ? translateBuiltinSource(String(key), locale, dictionaries, sourceTranslations) : "";
      return interpolate(String(overrideCurrent || keyCurrent || current || sourceFallback || overrideEn || fallbackEn || overrideZh || fallbackZh || key), vars);
    },
    [locale, overrides]
  );

  const td = useCallback(
    (key: string, fallback: string, vars?: Record<string, string | number>) => {
      const ownOverride = usableTranslation(overrides[locale]?.[key]);
      const rawBuiltin = usableTranslation(dictionaries[locale]?.[key as TranslationKey]);
      const englishBuiltin = usableTranslation(dictionaries["en-US"]?.[key as TranslationKey]);
      const ownBuiltin = locale !== "en-US" && locale !== "zh-CN" && rawBuiltin === englishBuiltin ? "" : rawBuiltin;
      const ownValue = ownOverride || ownBuiltin;
      if (ownValue) return interpolate(ownValue, vars);
      const translatedFallback = locale !== "zh-CN" ? translateBuiltinSource(fallback, locale, dictionaries, sourceTranslations) : "";
      return interpolate(translatedFallback || fallback, vars);
    },
    [locale, overrides]
  );

  const ts = useCallback((source: string) => {
    if (locale === "zh-CN" || !source.trim()) return source;
    return usableTranslation(overrides[locale]?.[sourceTranslationKey(source.trim())]) || translateBuiltinSource(source.trim(), locale, dictionaries, sourceTranslations) || source;
  }, [locale, overrides]);

  const value = useMemo<I18nContextValue>(() => {
    const language = languages.find((item) => item.code === locale) || languages[0] || DEFAULT_UI_LANGUAGES[0];
    return {
      locale,
      language,
      languages,
      setLocale,
      t,
      td,
      ts,
      formatDate: (input) => new Intl.DateTimeFormat(locale).format(new Date(input)),
      formatNumber: (input, options) => new Intl.NumberFormat(locale, options).format(input),
    };
  }, [languages, locale, setLocale, t, td, ts]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
