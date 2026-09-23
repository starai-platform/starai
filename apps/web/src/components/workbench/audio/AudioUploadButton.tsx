"use client";

import { useState } from "react";
import { Music2, Plus, X } from "lucide-react";
import { uploadFile } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export function AudioUploadButton({
  url,
  name,
  onChange,
}: {
  url?: string;
  name?: string;
  onChange: (next: { url: string; name: string } | null) => void;
}) {
  const { ts } = useI18n();
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      onChange({ url: await uploadFile(f), name: f.name });
    } catch (err) {
      alert(err instanceof Error ? err.message : ts("上传失败"));
    } finally {
      setUploading(false);
    }
  };

  if (url) {
    return (
      <div className="flex h-14 min-w-20 max-w-[180px] shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-2 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
        <Music2 size={17} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate" title={name || url}>
          {name || ts("参考音频")}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-gray-400 hover:text-gray-700 shrink-0 dark:hover:text-gray-100"
          title={ts("移除")}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <label
      className="flex h-14 min-w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-2 text-gray-400 transition hover:border-primary/40 hover:bg-primary/5 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-primary/10"
      title={uploading ? ts("上传中...") : ts("上传参考音频")}
    >
      <Plus size={17} />
      <span className="whitespace-nowrap text-[10px]">{uploading ? ts("上传中...") : ts("参考音频 0/1")}</span>
      <input
        type="file"
        accept="audio/*"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          handleUpload(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}
