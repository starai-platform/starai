import { create } from "zustand";
import type { User } from "@starai/shared-types";
import { API_URL } from "@/lib/api";

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  setAuth: (token, user) => {
    localStorage.removeItem("token");
    localStorage.setItem("starai_session", "1");
    localStorage.setItem("user", JSON.stringify(user));
    set({ token: "session", user });
  },
  logout: () => {
    void fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    localStorage.removeItem("token");
    localStorage.removeItem("starai_session");
    localStorage.removeItem("user");
    set({ token: null, user: null });
  },
  hydrate: () => {
    const token = localStorage.getItem("token");
    const session = localStorage.getItem("starai_session") === "1";
    const userStr = localStorage.getItem("user");
    if ((session || token) && userStr) {
      set({ token: session ? "session" : token, user: JSON.parse(userStr) });
    }
  },
}));
