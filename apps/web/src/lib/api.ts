const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

const responseCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();
const MAX_RESPONSE_CACHE_ENTRIES = 128;

export function clearApiCache() {
  responseCache.clear();
}

export function hasUserSession() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("starai_session") === "1" || !!localStorage.getItem("token");
}

export function legacyAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function localeHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const locale = localStorage.getItem("site_locale") || "zh-CN";
  return { "X-Locale": locale, "Accept-Language": locale };
}

function responseMessage(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const body = value as { message?: unknown; error?: unknown };
  if (typeof body.message === "string") return body.message.trim();
  if (body.error && typeof body.error === "object") {
    const message = (body.error as { message?: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return "";
}

async function parseResponse<T>(res: Response, fallback: string): Promise<T> {
  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    if (res.status >= 500 && /cloudflare|bad gateway|gateway time-?out|web server is down|host error/i.test(raw)) {
      throw new Error(`${fallback}：服务网关暂时异常，请稍后重试`);
    }
    const detail = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(`${fallback}（HTTP ${res.status}）${detail ? `：${detail}` : ""}`);
  }

  if (!res.ok) {
    throw new Error(responseMessage(json) || `${fallback}（HTTP ${res.status}）`);
  }

  if (json && typeof json === "object" && "code" in json) {
    const envelope = json as { code?: unknown; message?: unknown; data?: unknown };
    if (typeof envelope.code === "number" && envelope.code !== 0) {
      throw new Error(responseMessage(json) || fallback);
    }
    return envelope.data as T;
  }

  return json as T;
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...localeHeaders(),
    ...legacyAuthHeaders(),
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
  return parseResponse<T>(res, "请求失败");
}

/**
 * Fetch localized content with the locale captured by the React render that
 * started the request. Reading localStorage inside api() alone is not enough:
 * an older request may finish after a language switch and overwrite the newer
 * result. Callers should also pass an AbortSignal when the locale can change.
 */
export function apiForLocale<T>(
  path: string,
  locale: string,
  options: RequestInit = {}
): Promise<T> {
  return api<T>(path, {
    ...options,
    headers: {
      "X-Locale": locale,
      "Accept-Language": locale,
      ...(options.headers as Record<string, string>),
    },
  });
}

function cachedRequest<T>(key: string, ttlMs: number, request: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise as Promise<T>;

  for (const [cacheKey, entry] of responseCache) {
    if (entry.expiresAt <= now) responseCache.delete(cacheKey);
  }
  while (responseCache.size >= MAX_RESPONSE_CACHE_ENTRIES) {
    responseCache.delete(responseCache.keys().next().value!);
  }

  const promise = request().catch((error) => {
    if (responseCache.get(key)?.promise === promise) responseCache.delete(key);
    throw error;
  });
  responseCache.set(key, { expiresAt: now + ttlMs, promise });
  return promise;
}

export function apiCached<T>(path: string, ttlMs = 30_000, varyByLocale = true): Promise<T> {
  const locale = varyByLocale && typeof window !== "undefined"
    ? localStorage.getItem("site_locale") || "zh-CN"
    : "shared";
  return cachedRequest(`${locale}:${path}`, ttlMs, () => api<T>(path));
}

export function apiForLocaleCached<T>(path: string, locale: string, ttlMs = 30_000): Promise<T> {
  return cachedRequest(`${locale}:${path}`, ttlMs, () => apiForLocale<T>(path, locale));
}

export async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/upload`, {
    method: "POST",
    headers: { ...legacyAuthHeaders(), ...localeHeaders() },
    credentials: "include",
    body: form,
  });
  const data = await parseResponse<{ url: string }>(res, "上传失败");
  return data.url;
}

export async function uploadAsset(
  file: File,
  meta?: { name?: string; description?: string; kind?: string; asset_type?: string }
): Promise<{ public_id: string; url: string; name?: string; kind?: string; asset_type?: string; mime_type?: string; size_bytes?: number }> {
  const form = new FormData();
  form.append("file", file);
  if (meta?.name) form.append("name", Array.from(meta.name).slice(0, 50).join(""));
  if (meta?.description) form.append("description", meta.description);
  if (meta?.kind) form.append("kind", meta.kind);
  if (meta?.asset_type) form.append("asset_type", meta.asset_type);
  const res = await fetch(`${API_URL}/api/assets/upload`, {
    method: "POST",
    headers: { ...legacyAuthHeaders(), ...localeHeaders() },
    credentials: "include",
    body: form,
  });
  return parseResponse<{ public_id: string; url: string; name?: string; kind?: string; asset_type?: string; mime_type?: string; size_bytes?: number }>(res, "上传失败");
}

export async function importAssetFromURL(url: string, name?: string) {
  return api<{ public_id: string; work_public_id: string; url: string; name?: string; kind: string; asset_type: string; mime_type?: string; size_bytes?: number; duration_seconds?: number }>("/api/assets/import-url", {
    method: "POST",
    body: JSON.stringify({ url, ...(name ? { name } : {}) }),
  });
}

export async function listAssets(params: { q?: string; tag?: string; kind?: string; type?: string; page?: number; page_size?: number } = {}) {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.tag) sp.set("tag", params.tag);
  if (params.kind) sp.set("kind", params.kind);
  if (params.type) sp.set("type", params.type);
  if (params.page) sp.set("page", String(params.page));
  if (params.page_size) sp.set("page_size", String(params.page_size));
  const suffix = sp.toString() ? `?${sp.toString()}` : "";
  return api<{ items: any[]; total: number }>(`/api/assets${suffix}`);
}

export async function deleteAsset(publicId: string) {
  return api<null>(`/api/assets/${encodeURIComponent(publicId)}`, { method: "DELETE" });
}

export async function listRoles() {
  return api<{ items: any[] }>("/api/roles");
}

export async function createRole(payload: { name: string; description?: string; system_prompt: string; icon_url?: string; is_default?: boolean }) {
  return api(`/api/roles`, { method: "POST", body: JSON.stringify(payload) });
}

export async function listRoleTemplates() {
  return api<{ items: any[] }>("/api/role-templates");
}

export async function listChannelPresets() {
  return api<{ items: any[] }>("/api/channel-presets");
}

export { API_URL };
