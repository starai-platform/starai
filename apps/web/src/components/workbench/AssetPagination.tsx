"use client";

import { useI18n } from "@/i18n/I18nProvider";

export function AssetPagination({ page, total, loading, onChange }: {
  page: number; total: number; loading: boolean; onChange: (page: number) => void;
}) {
  const { td } = useI18n();
  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <nav aria-label={td("asset.pagination", "资产分页")} className="flex shrink-0 items-center justify-between gap-2 px-2 py-3 text-xs text-gray-500 dark:text-gray-400">
      <span role="status">{loading ? td("asset.pageLoading", "加载中…") : td("asset.pageSummary", "第 {page} / {pages} 页 · 共 {total} 项", { page, pages, total })}</span>
      <div className="flex gap-2">
        <button type="button" disabled={loading || page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10">{td("asset.previousPage", "上一页")}</button>
        <button type="button" disabled={loading || page >= pages} onClick={() => onChange(page + 1)} className="rounded-lg border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10">{td("asset.nextPage", "下一页")}</button>
      </div>
    </nav>
  );
}
