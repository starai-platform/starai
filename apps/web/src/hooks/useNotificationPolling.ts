import { useEffect } from "react";
import { useNotificationStore } from "@/store/notifications";

let pollSubscribers = 0;
let pollTimer: number | null = null;

function startPolling(refreshUnread: () => Promise<void>) {
  if (pollTimer) return;
  refreshUnread();
  pollTimer = window.setInterval(refreshUnread, 30_000);
}

function stopPolling() {
  if (pollSubscribers > 0 || !pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

export function useNotificationPolling() {
  const refreshUnread = useNotificationStore((s) => s.refreshUnread);

  useEffect(() => {
    pollSubscribers += 1;
    startPolling(refreshUnread);
    return () => {
      pollSubscribers -= 1;
      stopPolling();
    };
  }, [refreshUnread]);
}
