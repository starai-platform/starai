import type { SystemConfig } from "@starai/shared-types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export type PublicSystemConfig = Partial<SystemConfig>;

export async function getPublicSystemConfig(): Promise<PublicSystemConfig> {
  try {
    const res = await fetch(`${API_URL}/api/system-configs/public`, { cache: "no-store" });
    if (!res.ok) return {};
    const json = await res.json();
    return (json?.data || {}) as PublicSystemConfig;
  } catch {
    return {};
  }
}
