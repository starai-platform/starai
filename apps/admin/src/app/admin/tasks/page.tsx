"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi, API_URL, getAdminToken } from "@/lib/api";
import type { Task } from "@starai/shared-types";
import { AdminPagination } from "@/components/AdminPagination";

const STATUSES = ["pending", "running", "succeeded", "failed", "cancelled"];
const PAGE_SIZE = 20;

function collectURLs(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === "string") {
    const s = v.trim();
    return s ? [s] : [];
  }
  if (Array.isArray(v)) return v.flatMap(collectURLs);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.url === "string" && o.url.trim()) return [o.url.trim()];
    return Object.values(o).flatMap(collectURLs);
  }
  return [];
}

function taskMediaFromOutput(output?: Record<string, unknown>) {
  const o = output || {};
  const videoURL = collectURLs(o.video_url)[0] || "";
  const audioURL = collectURLs(o.audio_url)[0] || "";
  const imageURLs = [...collectURLs(o.image_url), ...collectURLs(o.images)]
    .filter((url, i, arr) => url && arr.indexOf(url) === i);
  return { videoURL, audioURL, imageURLs };
}

function isTaskMediaProxy(url: string) {
  return /\/api\/tasks\/[^/]+\/media\b/.test(url);
}

function AdminTaskVideo({ src }: { src: string }) {
  const [playSrc, setPlaySrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectURL = "";
    setFailed(false);
    if (!src) {
      setPlaySrc("");
      return;
    }
    if (!isTaskMediaProxy(src)) {
      setPlaySrc(src);
      return;
    }
    const token = getAdminToken();
    fetch(src.startsWith("http") ? src : `${API_URL}${src}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        objectURL = URL.createObjectURL(blob);
        setPlaySrc(objectURL);
      })
      .catch(() => {
        setFailed(true);
        setPlaySrc("");
      });
    return () => {
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [src]);

  if (failed) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="text-sm text-secondary hover:underline break-all">
        无法内嵌播放，点击在新窗口打开
      </a>
    );
  }
  if (!playSrc) return <div className="text-sm text-gray-400 py-6">视频加载中...</div>;
  return <video src={playSrc} controls className="rounded-xl max-w-full w-full max-h-[420px] bg-black" />;
}

function TaskOutputPreview({ task }: { task: Task }) {
  const media = taskMediaFromOutput(task.output);
  const prompt = typeof task.input?.prompt === "string" ? task.input.prompt : "";

  return (
    <div className="space-y-4">
      {prompt && (
        <div>
          <div className="text-xs text-gray-400 mb-1">提示词</div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{prompt}</p>
        </div>
      )}
      {task.type === "video" && media.videoURL && (
        <div>
          <div className="text-xs text-gray-400 mb-2">生成视频</div>
          <AdminTaskVideo src={media.videoURL} />
          <a href={media.videoURL} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-secondary mt-2 inline-block break-all">
            {media.videoURL}
          </a>
        </div>
      )}
      {task.type === "audio" && media.audioURL && (
        <div>
          <div className="text-xs text-gray-400 mb-2">生成音频</div>
          <audio src={media.audioURL} controls className="w-full" />
        </div>
      )}
      {(task.type === "image" || media.imageURLs.length > 0) && (
        <div>
          <div className="text-xs text-gray-400 mb-2">生成图片</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {media.imageURLs.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="block rounded-xl border overflow-hidden bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="w-full h-auto object-contain max-h-80" />
              </a>
            ))}
          </div>
        </div>
      )}
      {!media.videoURL && !media.audioURL && media.imageURLs.length === 0 && (
        <div className="text-sm text-gray-400 py-4">暂无可用预览，请查看原始输出</div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-400 hover:text-gray-600">原始输出 JSON</summary>
        <pre className="mt-2 p-3 bg-gray-50 rounded-lg overflow-auto max-h-48 text-[11px] text-gray-600">
          {JSON.stringify(task.output || {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [viewTask, setViewTask] = useState<Task | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = () => {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (status) params.set("status", status);
    adminApi<{ items: Task[]; total: number }>(`/tasks?${params.toString()}`).then((r) => {
      setTasks(r.items || []);
      setTotal(r.total || 0);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const handleRetry = async (taskNo: string) => {
    await adminApi(`/tasks/${taskNo}/retry`, { method: "POST" });
    load();
  };

  const handleCancel = async (taskNo: string) => {
    if (!confirm("确定取消该任务？冻结的算力将退回用户。")) return;
    await adminApi(`/tasks/${taskNo}/cancel`, { method: "POST" });
    load();
  };

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (type && t.type !== type) return false;
      if (kw) {
        const hay = `${t.task_no} ${t.upstream_task_id || ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [tasks, type, search]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">任务管理</h1>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          placeholder="搜索任务号 / 上游任务号"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm w-56"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 rounded-lg border text-sm">
          <option value="">全部状态</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2 rounded-lg border text-sm">
          <option value="">全部类型</option>
          <option value="image">image</option>
          <option value="video">video</option>
          <option value="audio">audio</option>
        </select>
        <span className="text-xs text-gray-400">共 {filtered.length} 个</span>
      </div>
      <div className="bg-white rounded-2xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left px-4 py-3">任务号</th>
              <th className="text-left px-4 py-3">类型</th>
              <th className="text-left px-4 py-3">状态</th>
              <th className="text-left px-4 py-3">预估/实际</th>
              <th className="text-left px-4 py-3">错误</th>
              <th className="text-left px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((t) => (
              <tr key={t.task_no}>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-gray-900">{t.task_no}</div>
                  {t.upstream_task_id ? (
                    <div className="font-mono text-[11px] text-gray-400 mt-0.5 break-all">{t.upstream_task_id}</div>
                  ) : (
                    <div className="text-[11px] text-gray-300 mt-0.5">—</div>
                  )}
                </td>
                <td className="px-4 py-3">{t.type}</td>
                <td className="px-4 py-3">
                  <span className={
                    t.status === "succeeded" ? "text-green-600" :
                    t.status === "failed" ? "text-red-500" : "text-gray-500"
                  }>{t.status}</span>
                </td>
                <td className="px-4 py-3">{t.estimated_cost.toFixed(4)} / {t.actual_cost.toFixed(4)}</td>
                <td className="px-4 py-3 text-xs text-red-400 max-w-xs truncate">{t.error_message}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {t.status === "succeeded" && (
                      <button onClick={() => setViewTask(t)} className="text-xs text-secondary hover:underline">
                        查看
                      </button>
                    )}
                    {t.status === "failed" && (
                      <button onClick={() => handleRetry(t.task_no)} className="text-xs text-secondary hover:underline">
                        重试
                      </button>
                    )}
                    {(t.status === "pending" || t.status === "running") && (
                      <button onClick={() => handleCancel(t.task_no)} className="text-xs text-amber-600 hover:underline">
                        取消
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AdminPagination page={page} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {viewTask && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setViewTask(null)}>
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">任务生成内容</h3>
                <div className="font-mono text-xs text-gray-500 mt-1">{viewTask.task_no}</div>
                {viewTask.upstream_task_id && (
                  <div className="font-mono text-[11px] text-gray-400 mt-0.5 break-all">{viewTask.upstream_task_id}</div>
                )}
              </div>
              <button onClick={() => setViewTask(null)} className="text-sm text-gray-400 hover:text-gray-600 shrink-0">
                关闭
              </button>
            </div>
            <TaskOutputPreview task={viewTask} />
          </div>
        </div>
      )}
    </div>
  );
}
