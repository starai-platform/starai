"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";
import { useNotificationPolling } from "@/hooks/useNotificationPolling";
import { useNotificationStore } from "@/store/notifications";
import { useI18n } from "@/i18n/I18nProvider";
import { notificationTitle } from "@/lib/notificationText";

interface NotificationItem {
  id: number;
  title: string;
  content: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export function NotificationBell() {
  const { t, formatDate } = useI18n();
  const unread = useNotificationStore((s) => s.unread);
  const decrementUnread = useNotificationStore((s) => s.decrementUnread);
  const clearUnread = useNotificationStore((s) => s.clearUnread);
  useNotificationPolling();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-starai-notif]")) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const load = async () => {
    if (typeof window !== "undefined" && !localStorage.getItem("token")) {
      setNeedLogin(true);
      setItems([]);
      return;
    }
    setNeedLogin(false);
    setLoading(true);
    try {
      const r = await api<{ items: NotificationItem[] }>("/api/notifications");
      setItems(r.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const markRead = async (id: number) => {
    const item = items.find((n) => n.id === id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    if (item && !item.is_read) decrementUnread();
    try {
      await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    } catch {
      /* ignore */
    }
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    clearUnread();
    try {
      await api("/api/notifications/read-all", { method: "PATCH" });
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative" data-starai-notif>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-gray-100 bg-white text-gray-500 shadow-sm hover:border-gray-200 dark:border-white/10 dark:bg-gray-900 dark:text-gray-300"
        aria-label={unread > 0 ? `${unread} ${t("notifications.title")}` : t("notifications.title")}
      >
        <Bell size={18} />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white dark:ring-gray-900" />}
      </button>

      {open && (
        <div className="fixed left-4 right-4 top-16 z-30 flex max-h-[60vh] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/80 bg-white p-0 shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[320px] dark:border-white/10 dark:bg-gray-900">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-50 px-3 py-2 dark:border-white/10">
            <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{t("notifications.title")}{unread > 0 ? ` (${unread})` : ""}</span>
            {items.some((n) => !n.is_read) && (
              <button onClick={markAllRead} className="ml-2 shrink-0 text-[11px] text-primary hover:underline">
                {t("notifications.markAll")}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
            {needLogin ? (
              <div className="break-words px-3 py-6 text-center text-xs text-gray-500">{t("notifications.loginHint")}</div>
            ) : loading ? (
              <div className="py-6 text-center text-xs text-gray-400">{t("common.loading")}</div>
            ) : items.length === 0 ? (
              <div className="break-words px-3 py-6 text-center text-xs text-gray-400">
                {t("notifications.empty")}
                <div className="mt-1 text-[11px] text-gray-300">{t("notifications.emptyDesc")}</div>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markRead(n.id)}
                  className={`w-full max-w-full overflow-hidden rounded-xl px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/5 ${n.is_read ? "" : "bg-primary/5"}`}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    {!n.is_read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="break-words text-sm text-gray-800 [overflow-wrap:anywhere] dark:text-gray-100">{notificationTitle(t, n.title, n.type)}</div>
                      <div className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-500 [overflow-wrap:anywhere] dark:text-gray-400">{n.content}</div>
                      <div className="mt-1 text-[10px] text-gray-400">{formatDate(n.created_at)}</div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
