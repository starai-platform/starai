"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { ForcedAnnouncementModal } from "@/components/ForcedAnnouncementModal";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const selectedModelCode = pathname.startsWith("/app/models/")
    ? pathname.split("/").pop()
    : undefined;

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
    document.documentElement.classList.toggle("dark", stored ? stored === "dark" : prefersDark);
  }, []);

  return (
    <>
      <AppShell selectedModelCode={selectedModelCode}>{children}</AppShell>
      <ForcedAnnouncementModal />
    </>
  );
}
