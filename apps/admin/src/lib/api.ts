export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

const ADMIN_TOKEN_KEY = "admin_token";
const ADMIN_EMAIL_KEY = "admin_email";
const ADMIN_ROLE_KEY = "admin_role";

export function getAdminToken() {
  return typeof window !== "undefined" ? localStorage.getItem(ADMIN_TOKEN_KEY) : null;
}

export function setAdminSession(data: { token: string; email?: string; role?: string }) {
  localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
  if (data.email) localStorage.setItem(ADMIN_EMAIL_KEY, data.email);
  if (data.role) localStorage.setItem(ADMIN_ROLE_KEY, data.role);
}

export function clearAdminSession() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_EMAIL_KEY);
  localStorage.removeItem(ADMIN_ROLE_KEY);
}

function handleUnauthorized(path: string) {
  if (typeof window === "undefined" || path === "/login") return;
  clearAdminSession();
  if (!window.location.pathname.startsWith("/admin/login")) {
    window.location.href = "/admin/login?expired=1";
  }
}

export async function adminApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/admin/api${path}`, { ...options, headers });
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  let json: any = null;
  if (ct.includes("application/json")) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("服务返回 JSON 解析失败，请检查后端日志");
    }
  }
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    if (!json) throw new Error(`请求失败（${res.status}）。请确认 API 服务已重启并包含该路由。`);
    throw new Error(json.message || `请求失败（${res.status}）`);
  }
  if (!json) throw new Error("服务返回非 JSON，请检查后端是否异常");
  return json.data as T;
}

export async function adminUploadFile(file: File): Promise<string> {
  const token = getAdminToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/admin/api/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const json = await res.json();
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized("/upload");
    throw new Error(json.message || "上传失败");
  }
  return json.data.url as string;
}
