"use client";

import { useRef, useState, type ReactNode } from "react";
import { AudioLines, ChevronDown, Compass, FileAudio, Gauge, Grid3X3, Sparkles, Target } from "lucide-react";
import {
  DEFAULT_AUDIO_COUNT_OPTIONS,
  enumLabel,
  parseCountOptions,
  schemaFieldEntries,
  type AudioRuntimeConfig,
  type SchemaFieldMeta,
} from "@starai/shared-types";

function iconFor(name?: string): ReactNode {
  switch (name) {
    case "layers":
      return <Grid3X3 size={16} />;
    case "speed":
      return <Gauge size={16} />;
    case "pitch":
    case "emotion":
      return <Target size={16} />;
    case "sparkles":
    case "mode":
      return <Sparkles size={16} />;
    case "compass":
      return <Compass size={16} />;
    case "format":
      return <FileAudio size={16} />;
    case "audio":
      return <AudioLines size={16} />;
    case "bitrate":
      return <Gauge size={16} />;
    default:
      return <Grid3X3 size={16} />;
  }
}

function OptionMenu({
  icon,
  activeLabel,
  title,
  subtitle,
  tone = "white",
  children,
}: {
  icon: ReactNode;
  activeLabel: string;
  title: string;
  subtitle: string;
  tone?: "white" | "yellow";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        left: Math.min(rect.left, window.innerWidth - 272),
        bottom: window.innerHeight - rect.top + 8,
      });
    }
    setOpen((v) => !v);
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        className={`h-8 px-2.5 rounded-xl border text-xs flex items-center gap-1.5 shadow-sm transition ${
          tone === "yellow"
            ? "bg-amber-100 border-amber-300 text-gray-900 dark:bg-amber-500/10 dark:border-amber-400/30 dark:text-amber-100"
            : "bg-white border-gray-200 text-gray-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-200"
        }`}
      >
        <span className="text-gray-500 dark:text-gray-400">{icon}</span>
        <span>{activeLabel}</span>
        <ChevronDown size={13} className={`text-gray-500 transition dark:text-gray-400 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)}>
          <div
            className="fixed w-[220px] max-w-[calc(100vw-1rem)] rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden max-h-[60vh] overflow-y-auto dark:bg-gray-900 dark:border-white/10"
            style={{ left: pos.left, bottom: pos.bottom }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3.5 py-2.5 border-b border-gray-100 dark:border-white/10">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</div>
            </div>
            <div className="p-2">{children(() => setOpen(false))}</div>
          </div>
        </div>
      )}
    </>
  );
}

function CountOptionMenu({
  prop,
  value,
  audioConfig,
  onChange,
}: {
  prop: SchemaFieldMeta;
  value: unknown;
  audioConfig?: AudioRuntimeConfig;
  onChange: (val: number) => void;
}) {
  const options =
    audioConfig?.count_options?.length
      ? audioConfig.count_options
      : prop.enum?.length
        ? parseCountOptions(prop.enum)
        : DEFAULT_AUDIO_COUNT_OPTIONS;
  const allowCustom = audioConfig?.count_allow_custom !== false;
  const maxCustom = audioConfig?.count_max ?? Number(prop.maximum ?? 50) ?? 50;
  const count = Math.max(1, Number(value ?? prop.default ?? options[0] ?? 1) || 1);
  const [customDraft, setCustomDraft] = useState(String(count));

  return (
    <OptionMenu
      icon={iconFor(prop["x-icon"])}
      activeLabel={`${count}个`}
      title={prop.title || "生成数量"}
      subtitle="选择生成内容的数量"
      tone={prop["x-highlight"] ? "yellow" : "white"}
    >
      {(closeMenu) => (
        <div className="space-y-2">
          {options.map((n) => {
            const selected = count === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => {
                  onChange(n);
                  setCustomDraft(String(n));
                  closeMenu();
                }}
                className={`w-full h-10 px-3.5 rounded-xl text-left flex items-center justify-between text-sm font-semibold ${
                  selected ? "bg-primary/10 text-gray-900 dark:bg-primary/15 dark:text-gray-100" : "bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
                }`}
              >
                <span>{n}个</span>
                {selected && <span className="text-lg leading-none">✓</span>}
              </button>
            );
          })}
          {allowCustom && (
            <div className="pt-3 mt-3 border-t border-gray-100 dark:border-white/10">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">自定义数量</div>
              <div className="flex items-center gap-3">
                <input
                  value={customDraft}
                  type="number"
                  min={1}
                  max={maxCustom}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  className="h-10 flex-1 px-3 rounded-xl bg-white border border-gray-200 text-sm text-gray-900 focus:outline-none focus:border-primary dark:bg-white/5 dark:border-white/10 dark:text-gray-100 dark:[color-scheme:dark]"
                />
                <button
                  type="button"
                  className="h-10 px-4 rounded-xl bg-white border border-gray-900 text-gray-900 text-sm font-semibold dark:bg-white/5 dark:border-white/10 dark:text-gray-100"
                  onClick={() => {
                    const n = Math.min(maxCustom, Math.max(1, parseInt(customDraft, 10) || 1));
                    onChange(n);
                    setCustomDraft(String(n));
                    closeMenu();
                  }}
                >
                  确定
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </OptionMenu>
  );
}

function renderFieldControl(
  key: string,
  prop: SchemaFieldMeta,
  value: unknown,
  onChange: (key: string, val: unknown) => void,
  audioConfig?: AudioRuntimeConfig
) {
  const widget = prop["x-widget"] || (prop.enum?.length ? "option_menu" : "select");

  if (key === "count" && widget === "option_menu") {
    return <CountOptionMenu prop={prop} value={value} audioConfig={audioConfig} onChange={(n) => onChange(key, n)} />;
  }

  if (widget === "boolean_toggle") {
    const on = Boolean(value);
    return (
      <button
        type="button"
        onClick={() => onChange(key, !on)}
        className={`h-8 px-2.5 rounded-xl border text-xs flex items-center gap-1.5 shadow-sm transition ${
          on ? "bg-primary/10 border-primary/30 text-gray-900 dark:bg-primary/15 dark:border-primary/30 dark:text-gray-100" : "bg-white border-gray-200 text-gray-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-200"
        }`}
      >
        <span className="text-gray-500 dark:text-gray-400">{iconFor(prop["x-icon"])}</span>
        <span>
          {prop.title || key}：{on ? "开启" : "关闭"}
        </span>
      </button>
    );
  }

  const options = prop.enum || [];
  const activeLabel = enumLabel(prop, value ?? prop.default ?? options[0]);

  return (
    <OptionMenu
      icon={iconFor(prop["x-icon"])}
      activeLabel={String(activeLabel)}
      title={prop.title || key}
      subtitle={`选择${prop.title || key}`}
      tone={prop["x-highlight"] ? "yellow" : "white"}
    >
      {(closeMenu) => (
        <div className="space-y-2">
          {options.map((opt) => {
            const selected = String(value ?? "") === String(opt);
            return (
              <button
                key={String(opt)}
                type="button"
                onClick={() => {
                  onChange(key, opt);
                  closeMenu();
                }}
                className={`w-full h-10 px-3.5 rounded-xl text-left flex items-center justify-between text-sm font-semibold ${
                  selected ? "bg-primary/10 text-gray-900 dark:bg-primary/15 dark:text-gray-100" : "bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
                }`}
              >
                <span>{enumLabel(prop, opt)}</span>
                {selected && <span className="text-lg leading-none">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </OptionMenu>
  );
}

export function AudioOptionToolbar({
  schema,
  values,
  onChange,
  audioConfig,
}: {
  schema: unknown;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  audioConfig?: AudioRuntimeConfig;
}) {
  const set = (key: string, val: unknown) => onChange({ ...values, [key]: val });
  const entries = schemaFieldEntries(schema);
  if (entries.length === 0) return null;
  return <>{entries.map(([key, prop]) => <span key={key}>{renderFieldControl(key, prop, values[key], set, audioConfig)}</span>)}</>;
}
