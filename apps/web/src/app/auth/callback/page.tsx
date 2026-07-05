"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import type { User } from "@starai/shared-types";

export default function OAuthCallbackPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const errMsg = hash.get("error");
    const token = hash.get("token");
    if (errMsg) {
      setError(decodeURIComponent(errMsg));
      return;
    }
    if (!token) {
      setError("缺少登录凭证，请重新登录");
      return;
    }
    // Persist the token first so the /api/me request carries it.
    localStorage.setItem("token", token);
    api<User>("/api/me")
      .then((user) => {
        setAuth(token, user);
        router.replace("/app");
      })
      .catch((e) => {
        localStorage.removeItem("token");
        setError(e instanceof Error ? e.message : "登录失败，请重试");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 w-full max-w-sm text-center">
        {error ? (
          <>
            <div className="text-4xl mb-4">⚠️</div>
            <div className="text-base font-semibold text-gray-900">登录失败</div>
            <div className="text-sm text-gray-500 mt-2 break-all">{error}</div>
            <button
              onClick={() => router.replace("/")}
              className="mt-6 w-full py-3 rounded-xl bg-primary text-dark font-semibold hover:bg-primary/90 transition"
            >
              返回首页重新登录
            </button>
          </>
        ) : (
          <>
            <div className="w-10 h-10 mx-auto rounded-full border-2 border-gray-200 border-t-gray-900 animate-spin" />
            <div className="text-sm text-gray-500 mt-5">正在完成登录，请稍候...</div>
          </>
        )}
      </div>
    </div>
  );
}
