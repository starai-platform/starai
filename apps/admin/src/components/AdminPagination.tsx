"use client";

export function AdminPagination({
  page,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page <= 1) {
    return <div className="mt-4 text-right text-xs text-gray-400">共 {total} 条</div>;
  }
  return (
    <div className="mt-4 flex items-center justify-end gap-3">
      <span className="text-xs text-gray-400">共 {total} 条，每页 {pageSize} 条</span>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        className="rounded-xl border px-3 py-2 text-sm text-gray-600 disabled:opacity-40"
      >
        上一页
      </button>
      <span className="text-sm text-gray-500">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        className="rounded-xl border px-3 py-2 text-sm text-gray-600 disabled:opacity-40"
      >
        下一页
      </button>
    </div>
  );
}

