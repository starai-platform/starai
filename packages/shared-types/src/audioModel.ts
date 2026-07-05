/** Audio model runtime_rule.audio + input_schema extensions (config-driven UI & API). */

import {
  DEFAULT_VIDEO_COUNT_OPTIONS,
  enumLabel,
  parseCountOptions,
  parseUpstreamRuntime,
  schemaDefaultsFromFields,
  schemaFieldEntries,
  type SchemaFieldMeta,
  type UpstreamRuntimeConfig,
} from "./videoModel";

export type AudioInputLayout = "single" | "dual";
export type AudioBillingHint = "per_token" | "estimated";

export interface AudioRuntimeConfig {
  input_layout?: AudioInputLayout;
  prompt_hint?: string;
  secondary_prompt_hint?: string;
  /** Params key for the secondary textarea when input_layout=dual */
  secondary_prompt_key?: string;
  prompt_required?: boolean;
  show_channel?: boolean;
  show_web_search?: boolean;
  /** Show reference-audio upload button (e.g. Suno) */
  show_upload?: boolean;
  /** Top-right billing label style */
  billing_hint?: AudioBillingHint;
  count_options?: number[];
  count_allow_custom?: boolean;
  count_max?: number;
}

export {
  enumLabel,
  parseUpstreamRuntime,
  schemaDefaultsFromFields,
  schemaFieldEntries,
  type SchemaFieldMeta,
  type UpstreamRuntimeConfig,
};

export function parseAudioRuntime(runtimeRule?: Record<string, unknown>): AudioRuntimeConfig {
  const audio = asRecord(runtimeRule?.audio);
  return {
    input_layout: (audio.input_layout as AudioInputLayout) || "single",
    prompt_hint: typeof audio.prompt_hint === "string" ? audio.prompt_hint : "",
    secondary_prompt_hint:
      typeof audio.secondary_prompt_hint === "string" ? audio.secondary_prompt_hint : "",
    secondary_prompt_key:
      typeof audio.secondary_prompt_key === "string" && audio.secondary_prompt_key
        ? audio.secondary_prompt_key
        : "style_prompt",
    prompt_required: audio.prompt_required !== false,
    show_channel: audio.show_channel !== false,
    show_web_search: audio.show_web_search === true,
    show_upload: audio.show_upload === true,
    billing_hint: audio.billing_hint === "estimated" ? "estimated" : "per_token",
    count_options: parseCountOptions(audio.count_options),
    count_allow_custom: audio.count_allow_custom !== false,
    count_max: numOr(audio.count_max, 50),
  };
}

export function buildAudioTaskParams(
  params: Record<string, unknown>,
  prompt: string,
  secondaryPrompt: string,
  runtimeRule?: Record<string, unknown>
): Record<string, unknown> {
  const cfg = parseAudioRuntime(runtimeRule);
  const out: Record<string, unknown> = { ...params, prompt };
  if (cfg.input_layout === "dual" && secondaryPrompt.trim()) {
    out[cfg.secondary_prompt_key || "style_prompt"] = secondaryPrompt.trim();
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export { DEFAULT_VIDEO_COUNT_OPTIONS as DEFAULT_AUDIO_COUNT_OPTIONS };
