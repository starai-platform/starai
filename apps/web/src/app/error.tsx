"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[web-error]", error);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-gray-900">
        <div className="text-lg font-bold text-gray-900 dark:text-white">页面暂时无法加载</div>
        <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-300">可能是网络波动或服务正在更新，请稍后重试。</p>
        {error.digest ? <div className="mt-2 text-xs text-gray-400">错误编号：{error.digest}</div> : null}
        <button onClick={reset} className="mt-6 rounded-xl bg-gray-950 px-5 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-gray-950">重新加载</button>
      </div>
    </div>
  );
}
