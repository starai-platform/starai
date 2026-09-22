"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { AudioLines, Compass, FileAudio, Gauge, Grid3X3, Settings2, Sparkles, Target } from "lucide-react";
import { MediaOptionMenu } from "../MediaOptionMenu";
import {
  DEFAULT_AUDIO_COUNT_OPTIONS,
  enumLabel,
  isTopPlacementField,
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
    case "voice":
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
  return (
    <MediaOptionMenu icon={icon} activeLabel={activeLabel} title={title} subtitle={subtitle} tone={tone} compactOnMobile>
      {children}
    </MediaOptionMenu>
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
  const { ts, td } = useI18n();
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
      activeLabel={td("audio.count", "{count}", { count })}
      title={prop.title || ts("生成数量")}
      subtitle={ts("选择生成内容的数量")}
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
                <span>{td("audio.count", "{count}", { count: n })}</span>
                {selected && <span className="text-lg leading-none">✓</span>}
              </button>
            );
          })}
          {allowCustom && (
            <div className="pt-3 mt-3 border-t border-gray-100 dark:border-white/10">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{ts("自定义数量")}</div>
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
                  {ts("确定")}
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
  audioConfig: AudioRuntimeConfig | undefined,
  translate: (source: string) => string
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
        aria-label={`${translate(prop.title || key)}: ${on ? translate("开启") : translate("关闭")}`}
        title={`${translate(prop.title || key)}: ${on ? translate("开启") : translate("关闭")}`}
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-xs shadow-sm transition ${
          on ? "bg-primary/10 border-primary/30 text-gray-900 dark:bg-primary/15 dark:border-primary/30 dark:text-gray-100" : "bg-white border-gray-200 text-gray-700 dark:bg-white/5 dark:border-white/10 dark:text-gray-200"
        }`}
      >
        <span className="text-gray-500 dark:text-gray-400">{iconFor(prop["x-icon"])}</span>
        <span className="hidden sm:inline">
          {translate(prop.title || key)}：{on ? translate("开启") : translate("关闭")}
        </span>
      </button>
    );
  }

  const options = prop.enum || [];
  const activeLabel = enumLabel(prop, value ?? prop.default ?? options[0]);

  return (
    <OptionMenu
      icon={iconFor(prop["x-icon"])}
      activeLabel={translate(String(activeLabel))}
      title={translate(prop.title || key)}
      subtitle={translate(`选择${prop.title || key}`)}
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
                <span>{translate(enumLabel(prop, opt))}</span>
                {selected && <span className="text-lg leading-none">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </OptionMenu>
  );
}

const MINIMAX_SPEECH_SETTINGS_KEYS = new Set([
  "speed",
  "vol",
  "pitch",
  "sample_rate",
  "bitrate",
  "channel",
  "output_format",
  "subtitle_enable",
  "subtitle_type",
  "aigc_watermark",
]);

function isMiniMaxSpeech28Schema(entries: Array<[string, SchemaFieldMeta]>) {
  const modelVersion = entries.find(([key]) => key === "model_version")?.[1];
  return modelVersion?.enum?.some((value) => /^speech-2\.8-(hd|turbo)$/i.test(String(value))) ?? false;
}

function AdvancedAudioSettings({
  entries,
  values,
  onChange,
  translate,
}: {
  entries: Array<[string, SchemaFieldMeta]>;
  values: Record<string, unknown>;
  onChange: (key: string, val: unknown) => void;
  translate: (source: string) => string;
}) {
  return (
    <MediaOptionMenu
      icon={<Settings2 size={16} />}
      activeLabel={translate("设置")}
      title={translate("语音设置")}
      subtitle={translate("调整语速、音量、字幕与输出参数")}
      menuWidth={320}
    >
      {() => (
        <div className="space-y-1.5">
          {entries.map(([key, prop]) => {
            const label = translate(prop.title || key);
            const value = values[key] ?? prop.default ?? prop.enum?.[0];

            if (prop["x-widget"] === "boolean_toggle") {
              const enabled = Boolean(value);
              return (
                <button
                  key={key}
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => onChange(key, !enabled)}
                  className="flex h-10 w-full items-center justify-between rounded-xl bg-gray-50 px-3 text-sm font-medium text-gray-800 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
                >
                  <span>{label}</span>
                  <span className={`relative h-5 w-9 rounded-full transition ${enabled ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                  </span>
                </button>
              );
            }

            const options = prop.enum || [];
            const subtitleTypeDisabled = key === "subtitle_type" && !Boolean(values.subtitle_enable);
            return (
              <label
                key={key}
                className={`flex min-h-10 items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-1.5 dark:bg-white/5 ${subtitleTypeDisabled ? "opacity-50" : ""}`}
              >
                <span className="shrink-0 text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
                <select
                  value={String(value ?? "")}
                  disabled={subtitleTypeDisabled}
                  aria-label={label}
                  onChange={(event) => {
                    const selected = options.find((option) => String(option) === event.target.value);
                    onChange(key, selected ?? event.target.value);
                  }}
                  className="min-w-0 max-w-[170px] rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-right text-xs text-gray-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed dark:border-white/10 dark:bg-gray-900 dark:text-gray-200 dark:[color-scheme:dark]"
                >
                  {options.map((option) => (
                    <option key={String(option)} value={String(option)}>
                      {translate(enumLabel(prop, option))}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
    </MediaOptionMenu>
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
  const { ts } = useI18n();
  const set = (key: string, val: unknown) => onChange({ ...values, [key]: val });
  const allEntries = schemaFieldEntries(schema);
  const entries = allEntries.filter(([, prop]) => !isTopPlacementField(prop));
  if (entries.length === 0) return null;

  if (isMiniMaxSpeech28Schema(allEntries)) {
    const quickEntries = entries.filter(([key]) => !MINIMAX_SPEECH_SETTINGS_KEYS.has(key));
    const settingsEntries = entries.filter(([key]) => MINIMAX_SPEECH_SETTINGS_KEYS.has(key));
    return (
      <>
        {quickEntries.map(([key, prop]) => (
          <span key={key}>{renderFieldControl(key, prop, values[key], set, audioConfig, ts)}</span>
        ))}
        {settingsEntries.length > 0 && <AdvancedAudioSettings entries={settingsEntries} values={values} onChange={set} translate={ts} />}
      </>
    );
  }

  return <>{entries.map(([key, prop]) => <span key={key}>{renderFieldControl(key, prop, values[key], set, audioConfig, ts)}</span>)}</>;
}

export function AudioTopControls({
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
  const { ts } = useI18n();
  const set = (key: string, val: unknown) => onChange({ ...values, [key]: val });
  const entries = schemaFieldEntries(schema).filter(([, prop]) => isTopPlacementField(prop));
  if (entries.length === 0) return null;
  return <>{entries.map(([key, prop]) => <span key={key}>{renderFieldControl(key, prop, values[key], set, audioConfig, ts)}</span>)}</>;
}
