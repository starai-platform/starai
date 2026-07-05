import { create } from "zustand";
import { api } from "@/lib/api";

interface NotificationState {
  unread: number;
  refreshUnread: () => Promise<void>;
  setUnread: (n: number) => void;
  decrementUnread: () => void;
  clearUnread: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unread: 0,
  refreshUnread: async () => {
    if (typeof window === "undefined" || !localStorage.getItem("token")) {
      set({ unread: 0 });
      return;
    }
    try {
      const r = await api<{ unread: number }>("/api/notifications/unread");
      set({ unread: r.unread || 0 });
    } catch {
      /* ignore */
    }
  },
  setUnread: (n) => set({ unread: Math.max(0, n) }),
  decrementUnread: () => set({ unread: Math.max(0, get().unread - 1) }),
  clearUnread: () => set({ unread: 0 }),
}));
