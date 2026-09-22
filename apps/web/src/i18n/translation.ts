export function interpolate(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return Object.entries(vars).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, String(value)), text);
}

export function usableTranslation(value?: string) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  return /\?{2,}/.test(text) ? "" : text;
}

export function hasCJKText(value?: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ""));
}
export function sourceTranslationKey(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `source.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const sourceIndexes = new WeakMap<Record<string, string>, Map<string, string>>();

export function translateBuiltinSource(
  source: string,
  locale: string,
  dictionaries: Record<string, Record<string, string>>,
  sourceTranslations: Record<string, Record<string, string>>,
) {
  const direct = sourceTranslations[locale]?.[source];
  if (direct) return direct;
  const sourceDictionary = dictionaries["zh-CN"];
  if (!sourceDictionary) return "";
  let index = sourceIndexes.get(sourceDictionary);
  if (!index) {
    index = new Map();
    for (const [key, value] of Object.entries(sourceDictionary)) {
      // Preserve the original first-key-wins behavior for duplicate source text.
      if (!index.has(value)) index.set(value, key);
    }
    sourceIndexes.set(sourceDictionary, index);
  }
  const key = index.get(source);
  if (!key) return "";
  const targetDictionary = dictionaries[locale] || dictionaries["en-US"] || {};
  const value = targetDictionary[key] || dictionaries["en-US"]?.[key];
  return value && value !== source ? value : "";
}
