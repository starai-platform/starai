"use client";

import { useMemo, useState } from "react";

const MEDIA_PARAM_OPTIONS: { key: string; title: string }[] = [
  { key: "reference_images", title: "参考图列表" },
  { key: "first_frame", title: "首帧" },
  { key: "last_frame", title: "尾帧" },
];

function parseSchemaOptions(inputSchemaText: string): { key: string; title: string }[] {
  try {
    const schema = JSON.parse(inputSchemaText || "{}");
    const props = (schema?.properties ?? {}) as Record<string, { title?: string }>;
    return Object.entries(props).map(([key, val]) => ({
      key,
      title: val?.title || key,
    }));
  } catch {
    return [];
  }
}

export function UpstreamIncludeEditor({
  inputSchemaText,
  value,
  onChange,
}: {
  inputSchemaText: string;
  value: string[];
  onChange: (keys: string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [customKey, setCustomKey] = useState("");

  const allOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of parseSchemaOptions(inputSchemaText)) map.set(o.key, o.title);
    for (const o of MEDIA_PARAM_OPTIONS) map.set(o.key, o.title);
    return Array.from(map.entries()).map(([key, title]) => ({ key, title }));
  }, [inputSchemaText]);

  const titleOf = (key: string) => allOptions.find((o) => o.key === key)?.title || key;

  const available = allOptions.filter((o) => !value.includes(o.key));

  const addKeys = (keys: string[]) => {
    const next = [...value];
    for (const k of keys) {
      const key = k.trim();
      if (key && !next.includes(key)) next.push(key);
    }
    onChange(next);
  };

  const removeKey = (key: string) => onChange(value.filter((k) => k !== key));

  const togglePick = (key: string) => {
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const confirmPick = () => {
    addKeys(picked);
    setPicked([]);
    setPickerOpen(false);
  };

  const addCustom = () => {
    if (!customKey.trim()) return;
    addKeys([customKey.trim()]);
    setCustomKey("");
  };

  return (
    <div className="mt-1 space-y-3">
      {value.length === 0 ? (
        <div className="px-3 py-4 rounded-xl border border-dashed border-gray-200 text-sm text-gray-400 text-center">
          尚未配置上游参数字段，请从下方添加
        </div>
      ) : (
        <ul className="space-y-2">
          {value.map((key) => (
            <li
              key={key}
              className="flex items-center gap-3 px-3 py-2 rounded-xl border border-gray-100 bg-white"
            >
              <span className="text-sm font-medium text-gray-900 shrink-0">{titleOf(key)}</span>
              <code className="text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 font-mono">{key}</code>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => removeKey(key)}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">从 input_schema / 媒体字段中选择（可多选）</span>
          <button
            type="button"
            onClick={() => {
              setPickerOpen((v) => !v);
              setPicked([]);
            }}
            className="text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-primary/40"
          >
            {pickerOpen ? "收起" : "添加参数"}
          </button>
        </div>

        {pickerOpen && (
          <div className="space-y-2">
            {available.length === 0 ? (
              <div className="text-xs text-gray-400 px-1">可选参数已全部添加</div>
            ) : (
              <div className="max-h-44 overflow-y-auto rounded-xl border border-gray-200 bg-white divide-y divide-gray-50">
                {available.map((o) => (
                  <label
                    key={o.key}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={picked.includes(o.key)}
                      onChange={() => togglePick(o.key)}
                      className="rounded border-gray-300"
                    />
                    <span className="font-medium text-gray-900">{o.title}</span>
                    <code className="text-[11px] text-gray-400 font-mono">{o.key}</code>
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={picked.length === 0}
                onClick={confirmPick}
                className="text-xs px-3 py-1.5 rounded-lg bg-primary text-dark font-semibold disabled:opacity-40"
              >
                添加选中 ({picked.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setPicked(available.map((o) => o.key));
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600"
              >
                全选可选
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 border-t border-gray-200">
          <input
            className="flex-1 px-3 py-2 rounded-lg border text-xs font-mono bg-white"
            placeholder="自定义 params 键，如 custom_field"
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <button
            type="button"
            onClick={addCustom}
            className="text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 shrink-0"
          >
            新增自定义键
          </button>
        </div>
      </div>
    </div>
  );
}
