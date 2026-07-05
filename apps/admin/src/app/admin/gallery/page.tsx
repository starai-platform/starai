"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { AdminPagination } from "@/components/AdminPagination";

interface GalleryItem {
  id: number;
  public_id: string;
  title?: string;
  prompt?: string;
  cover_url?: string;
  media_url?: string;
  thumbnail_url?: string;
  type?: string;
  tags: string[];
  status: string;
  is_featured: boolean;
  like_count: number;
  created_at: string;
}

const PAGE_SIZE = 8;

function isVideoMedia(item: GalleryItem) {
  const mediaURL = item.media_url || item.cover_url || "";
  return item.type === "video" || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(mediaURL);
}

function GalleryMediaPreview({ item }: { item: GalleryItem }) {
  const mediaURL = item.media_url || item.cover_url || "";
  const poster = item.thumbnail_url || (item.cover_url && item.cover_url !== mediaURL ? item.cover_url : "");
  if (!mediaURL) {
    return <div className="flex aspect-square w-full items-center justify-center bg-gray-50 text-xs text-gray-400">暂无封面</div>;
  }
  if (isVideoMedia(item)) {
    return (
      <div className="relative aspect-square w-full bg-black">
        <video src={withVideoPreviewTime(mediaURL)} poster={poster || undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(18,214,163,.2),transparent_36%),linear-gradient(180deg,rgba(0,0,0,.06),rgba(0,0,0,.28))]" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/35 text-white shadow-lg backdrop-blur">
            <span className="ml-0.5 text-base">▶</span>
          </div>
        </div>
        <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white">视频</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={mediaURL} alt={item.title || ""} className="aspect-square w-full object-cover" />
  );
}

function withVideoPreviewTime(url: string) {
  if (!url || url.includes("#t=")) return url;
  return `${url.split("#")[0]}#t=0.1`;
}

const STATUSES = [
  { value: "", label: "全部" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
];

export default function GalleryAdminPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (status) params.set("status", status);
    adminApi<{ items: GalleryItem[]; total?: number }>(`/gallery?${params.toString()}`).then((r) => {
      setItems(r.items || []);
      setTotal(r.total || 0);
    });
  }, [page, status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const audit = async (id: number, body: Record<string, unknown>) => {
    await adminApi(`/gallery/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    load();
  };

  const remove = async (id: number) => {
    if (!confirm("确定删除这个灵感作品吗？")) return;
    await adminApi(`/gallery/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">灵感广场审核</h1>

      <div className="mb-4 flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setStatus(s.value)}
            className={`rounded-full px-4 py-1.5 text-sm transition ${
              status === s.value ? "bg-gray-950 text-white shadow-sm" : "border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-2xl border bg-white">
            <GalleryMediaPreview item={item} />
            <div className="p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    item.status === "approved"
                      ? "bg-green-50 text-green-600"
                      : item.status === "rejected"
                        ? "bg-red-50 text-red-500"
                        : "bg-amber-50 text-amber-600"
                  }`}
                >
                  {item.status}
                </span>
                {item.is_featured ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">精选</span> : null}
              </div>
              <div className="truncate text-sm font-medium">{item.title || "未命名作品"}</div>
              <p className="mt-1 line-clamp-2 text-[11px] text-gray-400">{item.prompt}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => audit(item.id, { status: "approved" })} className="text-[11px] text-green-600 hover:underline">
                  通过
                </button>
                <button type="button" onClick={() => audit(item.id, { status: "rejected" })} className="text-[11px] text-red-500 hover:underline">
                  拒绝
                </button>
                <button type="button" onClick={() => audit(item.id, { is_featured: !item.is_featured })} className="text-[11px] text-amber-600 hover:underline">
                  {item.is_featured ? "取消精选" : "设为精选"}
                </button>
                <button type="button" onClick={() => remove(item.id)} className="text-[11px] text-gray-400 hover:underline">
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 ? <div className="col-span-full py-16 text-center text-gray-400">暂无作品</div> : null}
      </div>

      <AdminPagination page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </div>
  );
}
