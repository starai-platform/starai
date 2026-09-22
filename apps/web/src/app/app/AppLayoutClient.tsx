"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ForcedAnnouncementModal } from "@/components/ForcedAnnouncementModal";
import { apiCached } from "@/lib/api";
import { resolveWorkbenchTheme, type WorkbenchTheme } from "@/lib/workbench-theme";
import { useAuthStore } from "@/store/auth";
import type { User, Wallet } from "@starai/shared-types";

type WorkbenchSession = { user: User; wallet: Wallet };

export default function AppLayoutClient({ children, defaultTheme, initialSession }: { children: React.ReactNode; defaultTheme: WorkbenchTheme; initialSession: WorkbenchSession | null }) {
  const pathname = usePathname();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [authReady, setAuthReady] = useState(Boolean(initialSession));
  const [authError, setAuthError] = useState(false);
  const [initialWallet, setInitialWallet] = useState<Wallet | null>(initialSession?.wallet || null);
  const selectedModelCode = pathname.startsWith("/app/models/")
    ? pathname.split("/").pop()
    : undefined;
  const selectedAgentCode = pathname.startsWith("/app/agents/")
    ? pathname.split("/").pop()
    : undefined;

  useLayoutEffect(() => {
    const apply = () => {
      let preference: string | null = null;
      try { preference = localStorage.getItem("theme"); } catch { /* Storage may be disabled. */ }
      document.documentElement.classList.toggle("dark", resolveWorkbenchTheme(preference, defaultTheme) === "dark");
    };
    apply();
    const onStorage = (event: StorageEvent) => { if (event.key === "theme" || event.key === null) apply(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [defaultTheme]);

  useEffect(() => {
    if (initialSession) {
      setAuth("session", initialSession.user);
      return;
    }
    let active = true;
    apiCached<WorkbenchSession>("/api/workbench/session", 5_000, false)
      .then(({ user, wallet }) => {
        if (!active) return;
        setAuth("session", user);
        setInitialWallet(wallet);
        setAuthReady(true);
      })
      .catch(() => {
        if (active) setAuthError(true);
      });
    return () => { active = false; };
  }, [initialSession, setAuth]);

  if (!authReady) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-6 text-center dark:bg-gray-950">
        {authError ? (
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-300">暂时无法验证登录状态</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-dark">
              重试
            </button>
          </div>
        ) : (
          <span className="sr-only">正在验证登录状态</span>
        )}
      </div>
    );
  }

  return (
    <>
      <AppShell selectedModelCode={selectedModelCode} selectedAgentCode={selectedAgentCode} initialUser={initialSession?.user || null} initialWallet={initialWallet}>{children}</AppShell>
      <ForcedAnnouncementModal />
    </>
  );
}
