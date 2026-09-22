import zhCN from "./locales/zh-CN";

export const SUPPORTED_UI_LOCALES = ["zh-CN", "en-US", "ja-JP", "ko-KR", "vi-VN"] as const;
export type SupportedUILocale = (typeof SUPPORTED_UI_LOCALES)[number];

export const DEFAULT_UI_LANGUAGES = [
  { code: "zh-CN", short: "ZH", name: "Chinese (Simplified)", flag: "\u{1F1E8}\u{1F1F3}", flag_url: "/assets/comic-styles/cn.png?v=20260712", enabled: true, sort_order: 10 },
  { code: "en-US", short: "EN", name: "English", flag: "\u{1F1FA}\u{1F1F8}", flag_url: "/assets/comic-styles/us.png?v=20260712", enabled: true, sort_order: 20 },
  { code: "ja-JP", short: "JA", name: "Japanese", flag: "\u{1F1EF}\u{1F1F5}", flag_url: "/assets/comic-styles/jp.png?v=20260712", enabled: true, sort_order: 30 },
  { code: "ko-KR", short: "KO", name: "Korean", flag: "\u{1F1F0}\u{1F1F7}", flag_url: "/assets/comic-styles/kr.png?v=20260712", enabled: true, sort_order: 40 },
  { code: "vi-VN", short: "VI", name: "Vietnamese", flag: "\u{1F1FB}\u{1F1F3}", flag_url: "/assets/comic-styles/vn.png?v=20260712", enabled: true, sort_order: 50 },
];

export const dictionaries: Record<string, Record<string, string>> = {
  "zh-CN": zhCN,
};

export const sourceTranslations: Record<string, Record<string, string>> = {};

const dictionaryLoaders: Record<SupportedUILocale, () => Promise<{ default: Record<string, string> }>> = {
  "zh-CN": () => Promise.resolve({ default: zhCN }),
  "en-US": () => import("./locales/en-US"),
  "ja-JP": () => import("./locales/ja-JP"),
  "ko-KR": () => import("./locales/ko-KR"),
  "vi-VN": () => import("./locales/vi-VN"),
};

const sourceTranslationLoaders: Partial<Record<SupportedUILocale, () => Promise<{ default: Record<string, string> }>>> = {
  "en-US": () => import("./source-locales/en-US"),
  "ja-JP": () => import("./source-locales/ja-JP"),
  "ko-KR": () => import("./source-locales/ko-KR"),
  "vi-VN": () => import("./source-locales/vi-VN"),
};

export async function loadDictionary(locale: string) {
  if (dictionaries[locale]) return dictionaries[locale];
  const loader = dictionaryLoaders[locale as SupportedUILocale];
  if (!loader) return zhCN;
  const dictionary = (await loader()).default;
  dictionaries[locale] = dictionary;
  return dictionary;
}

async function loadSourceTranslations(locale: string) {
  if (locale === "zh-CN" || sourceTranslations[locale]) return;
  const loader = sourceTranslationLoaders[locale as SupportedUILocale];
  if (loader) sourceTranslations[locale] = (await loader()).default;
}

export async function loadLocaleDictionaries(locale: string) {
  await Promise.all([
    loadDictionary(locale),
    loadSourceTranslations(locale),
    locale === "zh-CN" || locale === "en-US" ? Promise.resolve() : loadDictionary("en-US"),
  ]);
}

export type TranslationKey = string;
