const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

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
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "请求失败");
  return json.data as T;
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

export async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/upload`, {
    method: "POST",
    headers: { ...legacyAuthHeaders(), ...localeHeaders() },
    credentials: "include",
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "上传失败");
  return json.data.url as string;
}

export async function uploadAsset(
  file: File,
  meta?: { name?: string; description?: string; kind?: string; asset_type?: string }
): Promise<{ public_id: string; url: string; name?: string; kind?: string; asset_type?: string; mime_type?: string; size_bytes?: number }> {
  const form = new FormData();
  form.append("file", file);
  if (meta?.name) form.append("name", meta.name);
  if (meta?.description) form.append("description", meta.description);
  if (meta?.kind) form.append("kind", meta.kind);
  if (meta?.asset_type) form.append("asset_type", meta.asset_type);
  const res = await fetch(`${API_URL}/api/assets/upload`, {
    method: "POST",
    headers: { ...legacyAuthHeaders(), ...localeHeaders() },
    credentials: "include",
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "上传失败");
  return json.data as { public_id: string; url: string; name?: string; kind?: string; asset_type?: string; mime_type?: string; size_bytes?: number };
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
