"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminApi, setAdminSession } from "@/lib/api";
import { AdminBrand } from "@/components/AdminBrand";

// const DEFAULT_EMAIL = "admin@starai.local";
// const DEFAULT_PASSWORD = "admin123";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const saved = localStorage.getItem("admin_email");
    if (saved) setEmail(saved);
    setExpired(new URLSearchParams(window.location.search).get("expired") === "1");
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await adminApi<{ token: string; email: string; role?: string }>("/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setAdminSession({ token: res.token, email: res.email, role: res.role });
      localStorage.setItem("admin_email", email);
      router.replace("/admin/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请检查账号或密码");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f5f9] px-4 py-8 text-gray-950">
      <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-6xl items-center justify-center">
        <form onSubmit={handleLogin} className="w-full max-w-[440px] rounded-[28px] border border-gray-200/80 bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-8">
          <div className="mb-7">
            <AdminBrand
              badgeClassName="h-12 w-12 rounded-2xl"
              titleClassName="text-xl font-bold tracking-tight text-gray-950"
              subtitle="请输入管理员账号登录"
              subtitleClassName="mt-1 text-sm text-gray-500"
            />
          </div>

          {expired && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              登录已过期，请重新登录。
            </div>
          )}

          <label className="mb-1.5 block text-xs font-medium text-gray-500">管理员邮箱</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-gray-950 focus:ring-4 focus:ring-gray-950/5"
            placeholder="请输入账号"
            autoComplete="username"
            required
          />

          <label className="mb-1.5 block text-xs font-medium text-gray-500">密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-4 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-gray-950 focus:ring-4 focus:ring-gray-950/5"
            placeholder="请输入密码"
            autoComplete="current-password"
            required
          />

          {/* <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/80 px-3 py-3 text-xs leading-relaxed text-gray-600">
            <div className="mb-1 font-medium text-gray-800">本地演示账号</div>
            <div>
              邮箱：<code className="font-semibold text-gray-900">{DEFAULT_EMAIL}</code>
            </div>
            <div>
              密码：<code className="font-semibold text-gray-900">{DEFAULT_PASSWORD}</code>
            </div>
          </div> */}

          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

          {/* <button
            type="button"
            onClick={() => setPassword(DEFAULT_PASSWORD)}
            className="mb-2 w-full rounded-2xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            填入演示密码
          </button> */}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-gray-950 py-3 text-sm font-semibold text-white shadow-lg shadow-gray-950/15 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
