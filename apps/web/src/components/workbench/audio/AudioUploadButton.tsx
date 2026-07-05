"use client";

import { useState } from "react";
import { Upload, X } from "lucide-react";
import { uploadFile } from "@/lib/api";

export function AudioUploadButton({
  url,
  name,
  onChange,
}: {
  url?: string;
  name?: string;
  onChange: (next: { url: string; name: string } | null) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      onChange({ url: await uploadFile(f), name: f.name });
    } catch (err) {
      alert(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  if (url) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-xl border border-gray-200 bg-white text-xs text-gray-600 shrink-0 max-w-[200px] dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
        <span className="truncate flex-1" title={name || url}>
          {name || "参考音频"}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-gray-400 hover:text-gray-700 shrink-0 dark:hover:text-gray-100"
          title="移除"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <label
      className="h-9 w-9 rounded-xl border border-gray-200 bg-white text-gray-500 flex items-center justify-center cursor-pointer hover:bg-gray-50 shrink-0 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
      title={uploading ? "上传中..." : "上传参考音频"}
    >
      <Upload size={16} />
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
