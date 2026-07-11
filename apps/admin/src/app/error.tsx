"use client";

import { useEffect } from "react";

export default function AdminErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[admin-error]", error);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f3f5f9] p-6">
      <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="text-lg font-bold text-gray-950">后台页面加载失败</div>
        <p className="mt-2 text-sm leading-6 text-gray-500">请确认 API 服务正常，或稍后重新加载当前页面。</p>
        {error.digest ? <div className="mt-2 text-xs text-gray-400">错误编号：{error.digest}</div> : null}
        <button onClick={reset} className="mt-6 rounded-xl bg-gray-950 px-5 py-2.5 text-sm font-semibold text-white">重新加载</button>
      </div>
    </div>
  );
}
