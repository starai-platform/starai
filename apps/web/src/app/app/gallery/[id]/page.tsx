"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface GalleryItem {
  public_id: string;
  model_code?: string;
  title?: string;
  prompt?: string;
  cover_url?: string;
  media_url?: string;
  thumbnail_url?: string;
  type?: string;
  tags: string[];
  is_paid: boolean;
  price: number;
  like_count: number;
  created_at: string;
}

export default function GalleryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [item, setItem] = useState<GalleryItem | null>(null);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (id) api<GalleryItem>(`/api/gallery/${id}`).then(setItem).catch(() => setItem(null));
  }, [id]);

  const cloneSame = async () => {
    setCloning(true);
    setError("");
    try {
      const r = await api<{ model_code?: string; prompt?: string }>(`/api/gallery/${id}/clone`, { method: "POST" });
      const code = r.model_code;
      const prompt = r.prompt || "";
      if (code) {
        router.push(`/app/models/${code}?prompt=${encodeURIComponent(prompt)}`);
      } else {
        router.push(`/app?prompt=${encodeURIComponent(prompt)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成同款失败");
      setCloning(false);
    }
  };

  if (!item) {
    return <div className="flex-1 page-padding py-8 text-center text-gray-400">加载中...</div>;
  }
  const mediaURL = item.media_url || item.cover_url || "";
  const isVideo = item.type === "video" || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(mediaURL);
  const poster = item.thumbnail_url || (item.cover_url && item.cover_url !== mediaURL ? item.cover_url : "");

  return (
    <div className="flex-1 overflow-y-auto page-padding py-6 sm:py-8 page-container">
      <div className="max-w-4xl mx-auto">
        <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 mb-4">
          ← 返回广场
        </button>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl overflow-hidden bg-white border border-gray-100">
            {isVideo && mediaURL ? (
              <video src={mediaURL} poster={poster || undefined} controls playsInline className="w-full bg-gray-950" />
            ) : mediaURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaURL} alt={item.title || ""} className="w-full object-cover" />
            ) : (
              <div className="aspect-[4/3] bg-gray-100" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold mb-2">{item.title || "未命名作品"}</h1>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {item.is_paid && (
                <span className="px-2 py-0.5 rounded-full bg-primary/15 text-gray-900 text-xs font-semibold">{item.price || 0} 算力点</span>
              )}
              {item.tags?.map((t) => (
                <span key={t} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">#{t}</span>
              ))}
            </div>
            <div className="soft-card p-4 mb-4">
              <div className="text-xs text-gray-400 mb-1">提示词</div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{item.prompt}</p>
            </div>
            <button
              onClick={cloneSame}
              disabled={cloning}
              className="w-full py-3 rounded-xl bg-primary text-dark font-semibold disabled:opacity-50"
            >
              {cloning ? "跳转中..." : item.is_paid ? `付费生成同款（${item.price || 0} 算力点）` : "生成同款"}
            </button>
            {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
