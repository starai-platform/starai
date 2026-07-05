"use client";

import { useState, type ReactNode } from "react";
import { Clock, Grid3X3, Monitor, Sparkles, Target, Wand2 } from "lucide-react";
import {
  DEFAULT_VIDEO_COUNT_OPTIONS,
  enumLabel,
  parseCountOptions,
  schemaFieldEntries,
  type SchemaFieldMeta,
  type VideoRuntimeConfig,
} from "@starai/shared-types";
import { useI18n } from "@/i18n/I18nProvider";
import { MediaMenuOption, MediaOptionMenu } from "../MediaOptionMenu";

type Translate = ReturnType<typeof useI18n>["t"];

function iconFor(name?: string): ReactNode {
  switch (name) {
    case "layers":
      return <Grid3X3 size={16} />;
    case "clock":
      return <Clock size={16} />;
    case "ratio":
      return <Monitor size={16} />;
    case "sparkles":
      return <Sparkles size={16} />;
    case "target":
      return <Target size={16} />;
    case "wand":
      return <Wand2 size={16} />;
    case "4k":
      return <span className="text-[10px] font-bold leading-none">4K</span>;
    default:
      return <Grid3X3 size={16} />;
  }
}

const FIELD_TITLE_KEY: Record<string, string> = {
  count: "imageToolbar.count",
  duration: "video.duration",
  orientation: "video.orientation",
};

const FIELD_DESC_KEY: Record<string, string> = {
  count: "imageToolbar.countDesc",
  duration: "video.durationDesc",
  orientation: "video.orientationDesc",
};

function safeSchemaText(text: unknown, fallback: string) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return fallback;
  if (/[\u4e00-\u9fff�]/.test(value)) return fallback;
  return value;
}

function fieldTitle(t: Translate, key: string, prop: SchemaFieldMeta) {
  const i18nKey = FIELD_TITLE_KEY[key];
  return i18nKey ? t(i18nKey) : safeSchemaText(prop.title, key);
}

function fieldDesc(t: Translate, key: string, prop: SchemaFieldMeta) {
  const i18nKey = FIELD_DESC_KEY[key];
  const desc = (prop as SchemaFieldMeta & { description?: string }).description;
  return i18nKey ? t(i18nKey) : safeSchemaText(desc || prop.title, key);
}

function optionLabel(t: Translate, key: string, prop: SchemaFieldMeta, value: unknown) {
  const raw = String(value ?? "");
  const lookup = `video.option.${key}.${raw}`;
  const translated = t(lookup);
  if (translated !== lookup) return translated;
  return safeSchemaText(enumLabel(prop, value), raw);
}

function CountOptionMenu({
  prop,
  value,
  videoConfig,
  countUnit,
  onChange,
}: {
  prop: SchemaFieldMeta;
  value: unknown;
  videoConfig?: VideoRuntimeConfig;
  countUnit?: string;
  onChange: (val: number) => void;
}) {
  const { t } = useI18n();
  const unit = countUnit || t("unit.video");
  const options =
    videoConfig?.count_options?.length
      ? videoConfig.count_options
      : prop.enum?.length
        ? parseCountOptions(prop.enum)
        : DEFAULT_VIDEO_COUNT_OPTIONS;
  const allowCustom = videoConfig?.count_allow_custom !== false;
  const maxCustom = videoConfig?.count_max ?? Number(prop.maximum ?? 50) ?? 50;
  const count = Math.max(1, Number(value ?? prop.default ?? options[0] ?? 1) || 1);
  const [customDraft, setCustomDraft] = useState(String(count));

  return (
    <MediaOptionMenu
      icon={iconFor(prop["x-icon"])}
      activeLabel={`${count} ${unit}`}
      title={t("imageToolbar.count")}
      subtitle={t("imageToolbar.countDesc")}
      tone={prop["x-highlight"] ? "yellow" : "white"}
      compactOnMobile
    >
      {(closeMenu) => (
        <div className="space-y-2">
          {options.map((n) => (
            <MediaMenuOption
              key={n}
              selected={count === n}
              onClick={() => {
                onChange(n);
                setCustomDraft(String(n));
                closeMenu();
              }}
            >
              {n} {unit}
            </MediaMenuOption>
          ))}
          {allowCustom && (
            <div className="mt-3 border-t border-gray-100 pt-3 dark:border-white/10">
              <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t("imageToolbar.customCount")}</div>
              <div className="flex items-center gap-3">
                <input
                  value={customDraft}
                  type="number"
                  min={1}
                  max={maxCustom}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-primary focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:[color-scheme:dark]"
                />
                <button
                  type="button"
                  className="h-10 rounded-xl border border-gray-900 bg-white px-4 text-sm font-semibold text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
                  onClick={() => {
                    const n = Math.min(maxCustom, Math.max(1, parseInt(customDraft, 10) || 1));
                    onChange(n);
                    setCustomDraft(String(n));
                    closeMenu();
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </MediaOptionMenu>
  );
}

function renderFieldControl(
  key: string,
  prop: SchemaFieldMeta,
  value: unknown,
  onChange: (key: string, val: unknown) => void,
  t: Translate,
  videoConfig?: VideoRuntimeConfig,
  countUnit?: string
) {
  const widget = prop["x-widget"] || (prop.enum?.length ? "option_menu" : "select");

  if (key === "count" && widget === "option_menu") {
    return <CountOptionMenu prop={prop} value={value} videoConfig={videoConfig} countUnit={countUnit} onChange={(n) => onChange(key, n)} />;
  }

  if (widget === "boolean_toggle") {
    const on = Boolean(value);
    return (
      <button
        type="button"
        onClick={() => onChange(key, !on)}
        className={`flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs shadow-sm transition ${
          on
            ? "border-primary/30 bg-primary/10 text-gray-900 dark:border-primary/30 dark:bg-primary/15 dark:text-gray-100"
            : "border-gray-200 bg-white text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
        }`}
      >
        <span className="text-gray-500 dark:text-gray-400">{iconFor(prop["x-icon"])}</span>
        <span>
          {fieldTitle(t, key, prop)}: {on ? "ON" : "OFF"}
        </span>
      </button>
    );
  }

  const options = prop.enum || [];
  const activeLabel = optionLabel(t, key, prop, value ?? prop.default ?? options[0]);

  return (
    <MediaOptionMenu
      icon={iconFor(prop["x-icon"])}
      activeLabel={String(activeLabel)}
      title={fieldTitle(t, key, prop)}
      subtitle={fieldDesc(t, key, prop)}
      tone={prop["x-highlight"] ? "yellow" : "white"}
      compactOnMobile
    >
      {(closeMenu) => (
        <div className="space-y-2">
          {options.map((opt) => {
            const selected = String(value ?? "") === String(opt);
            return (
              <MediaMenuOption
                key={String(opt)}
                selected={selected}
                onClick={() => {
                  onChange(key, opt);
                  closeMenu();
                }}
              >
                {optionLabel(t, key, prop, opt)}
              </MediaMenuOption>
            );
          })}
        </div>
      )}
    </MediaOptionMenu>
  );
}

export function VideoOptionToolbar({
  schema,
  values,
  onChange,
  videoConfig,
  countUnit,
}: {
  schema: unknown;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  videoConfig?: VideoRuntimeConfig;
  countUnit?: string;
}) {
  const { t } = useI18n();
  const set = (key: string, val: unknown) => onChange({ ...values, [key]: val });
  const entries = schemaFieldEntries(schema);
  if (entries.length === 0) return null;
  return <>{entries.map(([key, prop]) => <span key={key}>{renderFieldControl(key, prop, values[key], set, t, videoConfig, countUnit)}</span>)}</>;
}
