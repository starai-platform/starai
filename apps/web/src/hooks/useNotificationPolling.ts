import { useEffect } from "react";
import { useNotificationStore } from "@/store/notifications";
import { pollAsync } from "@/lib/pollAsync";

let pollSubscribers = 0;
let stopPoll: (() => void) | null = null;

function startPolling(refreshUnread: () => Promise<void>) {
  if (stopPoll) return;
  stopPoll = pollAsync(async () => {
    if (document.visibilityState === "visible") await refreshUnread();
  }, 30_000, true);
}

function stopPolling() {
  if (pollSubscribers > 0 || !stopPoll) return;
  stopPoll();
  stopPoll = null;
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
