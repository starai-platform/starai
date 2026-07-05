"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BellRing, X } from "lucide-react";
import { api } from "@/lib/api";

interface Announcement {
  id: number;
  title: string;
  content: string;
  level: string;
  is_published: boolean;
  is_forced?: boolean;
  created_at: string;
}

const ACK_KEY = "starai_forced_announcement_ack";
export const SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY = "starai_skip_forced_announcement_once";

function readAcked(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
}

function writeAcked(ids: number[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACK_KEY, JSON.stringify(Array.from(new Set(ids)).slice(-80)));
}

export function ForcedAnnouncementModal() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [acked, setAcked] = useState<number[]>([]);
  const pathname = usePathname();
  const loadingRef = useRef(false);
  const lastCheckRef = useRef(0);

  const refreshAnnouncements = useCallback((force = false) => {
    if (typeof window === "undefined" || loadingRef.current) return;
    const now = Date.now();
    if (!force && now - lastCheckRef.current < 15_000) return;
    lastCheckRef.current = now;
    loadingRef.current = true;
    api<{ items: Announcement[] }>("/api/announcements")
      .then((r) => {
        const nextItems = r.items || [];
        const storedAcked = readAcked();
        if (window.localStorage.getItem(SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY) === "1") {
          window.localStorage.removeItem(SKIP_FORCED_ANNOUNCEMENT_ONCE_KEY);
          const forcedIDs = nextItems.filter((a) => a.is_published && a.is_forced).map((a) => a.id);
          const nextAcked = [...storedAcked, ...forcedIDs];
          setAcked(nextAcked);
          writeAcked(nextAcked);
        } else {
          setAcked(storedAcked);
        }
        setItems(nextItems);
      })
      .catch(() => setItems([]))
      .finally(() => {
        loadingRef.current = false;
      });
  }, []);

  useEffect(() => {
    refreshAnnouncements(true);
  }, [pathname, refreshAnnouncements]);

  useEffect(() => {
    const onFocus = () => refreshAnnouncements(true);
    const onCheck = () => refreshAnnouncements();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshAnnouncements(true);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("starai:check-forced-announcements", onCheck);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshAnnouncements();
    }, 120_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("starai:check-forced-announcements", onCheck);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [refreshAnnouncements]);

  useEffect(() => {
    const onPointerUp = () => {
      window.dispatchEvent(new Event("starai:check-forced-announcements"));
    };
    document.addEventListener("pointerup", onPointerUp, { passive: true });
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, []);

  const current = useMemo(() => items.find((a) => a.is_published && a.is_forced && !acked.includes(a.id)) || null, [items, acked]);

  const close = () => {
    if (!current) return;
    const next = [...acked, current.id];
    setAcked(next);
    writeAcked(next);
  };

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:border dark:border-white/10 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <BellRing size={20} />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-950 dark:text-white">平台公告</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">{new Date(current.created_at).toLocaleString()}</div>
            </div>
          </div>
          <button type="button" onClick={close} className="rounded-xl p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white" aria-label="关闭公告">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5">
          <h2 className="text-xl font-bold text-gray-950 dark:text-white">{current.title}</h2>
          <div className="mt-3 max-h-[45vh] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-gray-600 dark:text-gray-300">{current.content}</div>
        </div>
        <div className="flex justify-end border-t border-gray-100 bg-gray-50 px-5 py-4 dark:border-white/10 dark:bg-gray-950/50">
          <button type="button" onClick={close} className="rounded-xl bg-gray-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 dark:bg-primary dark:text-dark dark:hover:bg-primary/90">
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
