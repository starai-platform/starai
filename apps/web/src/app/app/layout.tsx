import AppLayoutClient from "./AppLayoutClient";
import { API_URL, getPublicSystemConfig } from "@/lib/public-config";
import { resolveWorkbenchTheme, workbenchThemeScript } from "@/lib/workbench-theme";
import { cookies } from "next/headers";
import type { User, Wallet } from "@starai/shared-types";

type WorkbenchSession = { user: User; wallet: Wallet };

async function getInitialWorkbenchSession(): Promise<WorkbenchSession | null> {
  const session = (await cookies()).get("starai_session")?.value;
  if (!session) return null;
  try {
    const response = await fetch(`${API_URL}/api/workbench/session`, {
      cache: "no-store",
      headers: { Cookie: `starai_session=${session}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return (body?.data || null) as WorkbenchSession | null;
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [config, initialSession] = await Promise.all([getPublicSystemConfig(), getInitialWorkbenchSession()]);
  const defaultTheme = resolveWorkbenchTheme(null, config.workbench_default_theme);
  return <>
    <script dangerouslySetInnerHTML={{ __html: workbenchThemeScript(defaultTheme) }} />
    <AppLayoutClient defaultTheme={defaultTheme} initialSession={initialSession}>{children}</AppLayoutClient>
  </>;
}
