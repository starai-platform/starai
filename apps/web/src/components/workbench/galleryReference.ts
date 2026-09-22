export const REFERENCE_REPOSITORY_URL = "https://github.com/freestylefly/awesome-gpt-image-2";
export const REFERENCE_MANIFEST_URL =
  "https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/cases.json";

const REFERENCE_RAW_ROOT =
  "https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data";
const REFERENCE_CACHE_KEY = "starai:reference-gallery:v1";
const REFERENCE_CACHE_TTL = 24 * 60 * 60 * 1000;

let referenceManifestPromise: Promise<ReferenceGalleryManifest> | null = null;

export interface ReferenceGalleryItem {
  id: number;
  title: string;
  image: string;
  imageAlt?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  prompt: string;
  promptPreview?: string;
  category: string;
  styles: string[];
  scenes: string[];
  featured?: boolean;
  githubUrl?: string;
}

export interface ReferenceGalleryManifest {
  totalCases: number;
  categories: string[];
  styles: string[];
  scenes: string[];
  cases: ReferenceGalleryItem[];
}

export interface ReferenceGalleryFilters {
  query: string;
  category: string;
  style: string;
  scene: string;
  language?: GalleryLanguage | "all";
}

export type GalleryLanguage = "zh" | "latin" | "ja" | "ko" | "other";

export const GALLERY_LANGUAGES: GalleryLanguage[] = ["zh", "latin", "ja", "ko", "other"];

const REFERENCE_TAXONOMY_ZH: Record<string, string> = {
  "Architecture & Spaces": "建筑与空间",
  "Brand & Logos": "品牌与标志",
  "Characters & People": "人物与角色",
  "Charts & Infographics": "图表与信息可视化",
  "Documents & Publishing": "文档与出版",
  "History & Classical Themes": "历史与古典主题",
  "Illustration & Art": "插画与艺术",
  "Other Use Cases": "其他用途",
  "Photography & Realism": "摄影与写实",
  "Posters & Typography": "海报与排版",
  "Products & E-commerce": "商品与电商",
  "Scenes & Storytelling": "场景与叙事",
  "UI & Interfaces": "UI 与界面",
  Architecture: "建筑",
  Brand: "品牌",
  Character: "角色",
  Characters: "人物角色",
  Charts: "图表",
  Classical: "古典",
  Commerce: "商业",
  Creative: "创意",
  Documents: "文档",
  Education: "教育",
  Fashion: "时尚",
  Food: "美食",
  History: "历史",
  Illustration: "插画",
  Infographic: "信息图",
  Photography: "摄影",
  Poster: "海报",
  Product: "商品",
  Products: "商品",
  Realistic: "写实",
  Scenes: "场景",
  Social: "社交媒体",
  Story: "故事叙事",
  Tech: "科技",
  Travel: "旅行",
  UI: "UI 界面",
};

const LANGUAGE_LABELS: Record<string, Record<GalleryLanguage, string>> = {
  "zh-CN": { zh: "中文", latin: "英文及拉丁语系", ja: "日文", ko: "韩文", other: "其他" },
  "en-US": { zh: "Chinese", latin: "English & Latin", ja: "Japanese", ko: "Korean", other: "Other" },
  "ja-JP": { zh: "中国語", latin: "英語・ラテン文字", ja: "日本語", ko: "韓国語", other: "その他" },
  "ko-KR": { zh: "중국어", latin: "영어 및 라틴 문자", ja: "일본어", ko: "한국어", other: "기타" },
  "vi-VN": { zh: "Tiếng Trung", latin: "Tiếng Anh và chữ Latinh", ja: "Tiếng Nhật", ko: "Tiếng Hàn", other: "Khác" },
};

export function referenceImageURL(path: string) {
  const value = String(path || "").trim();
  if (!value || /^https?:\/\//i.test(value)) return value;
  return `${REFERENCE_RAW_ROOT}/${value.replace(/^\/?(?:data\/)?/, "").replace(/^images\//, "images/")}`;
}

export function filterReferenceCases(items: ReferenceGalleryItem[], filters: ReferenceGalleryFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (filters.category !== "all" && item.category !== filters.category) return false;
    if (filters.style !== "all" && !item.styles.includes(filters.style)) return false;
    if (filters.scene !== "all" && !item.scenes.includes(filters.scene)) return false;
    if (filters.language && filters.language !== "all" && detectGalleryLanguage(item.prompt) !== filters.language) return false;
    if (!query) return true;
    return [item.title, item.prompt, item.sourceLabel, item.category, ...item.styles, ...item.scenes]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(query));
  });
}

export function detectGalleryLanguage(text: string): GalleryLanguage {
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[\uac00-\ud7af]/u.test(text)) return "ko";
  if (/[\u3400-\u9fff]/u.test(text)) return "zh";
  if (/[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(text)) return "latin";
  return "other";
}

export function galleryLanguageLabel(language: GalleryLanguage, locale: string) {
  return (LANGUAGE_LABELS[locale] || LANGUAGE_LABELS["en-US"])[language];
}

export function referenceTaxonomyLabel(value: string, locale: string) {
  return locale === "zh-CN" ? REFERENCE_TAXONOMY_ZH[value] || value : value;
}

export function referenceTagEntries(item: Pick<ReferenceGalleryItem, "styles" | "scenes">) {
  return [
    ...item.styles.map((label, index) => ({ key: `style-${index}-${label}`, label })),
    ...item.scenes.map((label, index) => ({ key: `scene-${index}-${label}`, label })),
  ];
}

export function randomReferenceCases(items: ReferenceGalleryItem[], count: number, random = Math.random) {
  const pool = items.slice();
  const limit = Math.min(Math.max(0, count), pool.length);
  for (let index = 0; index < limit; index += 1) {
    const swapIndex = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, limit);
}

export function loadReferenceGalleryManifest(options: { force?: boolean } = {}) {
  if (!options.force && referenceManifestPromise) return referenceManifestPromise;

  referenceManifestPromise = (async () => {
    if (!options.force && typeof window !== "undefined") {
      try {
        const cached = JSON.parse(sessionStorage.getItem(REFERENCE_CACHE_KEY) || "null") as { savedAt?: number; data?: unknown } | null;
        if (cached?.savedAt && Date.now() - cached.savedAt < REFERENCE_CACHE_TTL && isReferenceGalleryManifest(cached.data)) return cached.data;
      } catch {
        // Ignore stale or unavailable browser storage and use the network.
      }
    }

    const response = await fetch(REFERENCE_MANIFEST_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(String(response.status));
    const data: unknown = await response.json();
    if (!isReferenceGalleryManifest(data)) throw new Error("invalid manifest");

    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(REFERENCE_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
      } catch {
        // The in-memory promise still avoids duplicate downloads in this page.
      }
    }
    return data;
  })().catch((error) => {
    referenceManifestPromise = null;
    throw error;
  });

  return referenceManifestPromise;
}

export function isReferenceGalleryManifest(value: unknown): value is ReferenceGalleryManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ReferenceGalleryManifest>;
  const taxonomies = [manifest.categories, manifest.styles, manifest.scenes];
  return taxonomies.every((items) => Array.isArray(items) && items.every((item) => typeof item === "string"))
    && Array.isArray(manifest.cases)
    && manifest.cases.every((item) =>
      typeof item?.id === "number"
      && typeof item.title === "string"
      && typeof item.image === "string"
      && typeof item.prompt === "string"
      && typeof item.category === "string"
      && Array.isArray(item.styles)
      && item.styles.every((style) => typeof style === "string")
      && Array.isArray(item.scenes)
      && item.scenes.every((scene) => typeof scene === "string"),
    );
}
