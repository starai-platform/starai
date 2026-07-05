/** Video model runtime_rule.video + input_schema extensions (config-driven UI & API). */

export type VideoUploadProfile = "single_ref" | "multi_ref" | "frame_pair" | "none";

export interface VideoFrameSlotConfig {
  key?: string;
  label?: string;
  max?: number;
}

export interface VideoRuntimeConfig {
  upload_profile?: VideoUploadProfile;
  min_reference_images?: number;
  max_reference_images?: number;
  max_total_images?: number;
  count_toward_total?: boolean;
  prompt_hint?: string;
  prompt_required?: boolean;
  show_channel?: boolean;
  show_web_search?: boolean;
  /** Preset batch sizes in the count picker (e.g. 1,3,5,10,30,50). */
  count_options?: number[];
  /** Allow entering a custom count outside presets. */
  count_allow_custom?: boolean;
  /** Max value when count_allow_custom is true. */
  count_max?: number;
  frames?: {
    first?: VideoFrameSlotConfig;
    last?: VideoFrameSlotConfig;
  };
  reference_images?: VideoFrameSlotConfig;
}

export interface UpstreamRuntimeConfig {
  /** Platform param keys to forward upstream (after field_map). */
  include?: string[];
  /** Rename platform key -> upstream key. */
  map?: Record<string, string>;
  /** Always merge into upstream body (static). */
  static?: Record<string, unknown>;
}

export interface SchemaFieldMeta {
  type?: string;
  title?: string;
  enum?: (string | number | boolean)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  /** Display label map for enum values */
  enumLabels?: Record<string, string>;
  /** option_menu | boolean_toggle | select */
  "x-widget"?: string;
  "x-order"?: number;
  "x-icon"?: string;
  "x-highlight"?: boolean;
  /** If true, value is omitted from upstream when equal to "auto" or false */
  "x-omit-auto"?: boolean;
}

export interface VideoMediaItem {
  url: string;
  name: string;
  public_id?: string;
}

export interface VideoMediaState {
  reference_images: VideoMediaItem[];
  first_frame: VideoMediaItem | null;
  last_frame: VideoMediaItem | null;
}

export const DEFAULT_VIDEO_COUNT_OPTIONS = [1, 3, 5, 10, 30, 50];

export const EMPTY_VIDEO_MEDIA: VideoMediaState = {
  reference_images: [],
  first_frame: null,
  last_frame: null,
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseVideoRuntime(runtimeRule?: Record<string, unknown>): VideoRuntimeConfig {
  const video = asRecord(runtimeRule?.video);
  const frames = asRecord(video.frames);
  const first = asRecord(frames.first);
  const last = asRecord(frames.last);
  const ref = asRecord(video.reference_images);
  return {
    upload_profile: (video.upload_profile as VideoUploadProfile) || "single_ref",
    min_reference_images: numOr(video.min_reference_images, 0),
    max_reference_images: numOr(video.max_reference_images, 1),
    max_total_images: numOr(video.max_total_images, 9),
    count_toward_total: video.count_toward_total !== false,
    prompt_hint: typeof video.prompt_hint === "string" ? video.prompt_hint : "",
    prompt_required: video.prompt_required !== false,
    show_channel: video.show_channel !== false,
    show_web_search: video.show_web_search === true,
    count_options: parseCountOptions(video.count_options),
    count_allow_custom: video.count_allow_custom !== false,
    count_max: numOr(video.count_max, 50),
    frames: {
      first: { key: strOr(first.key, "first_frame"), label: strOr(first.label, "首帧"), max: numOr(first.max, 1) },
      last: { key: strOr(last.key, "last_frame"), label: strOr(last.label, "尾帧"), max: numOr(last.max, 1) },
    },
    reference_images: {
      key: strOr(ref.key, "reference_images"),
      max: numOr(ref.max, 4),
    },
  };
}

export function parseUpstreamRuntime(runtimeRule?: Record<string, unknown>): UpstreamRuntimeConfig {
  const up = asRecord(runtimeRule?.upstream);
  const include = Array.isArray(up.include) ? (up.include as string[]) : undefined;
  const map = asRecord(up.map) as Record<string, string>;
  const staticParams = asRecord(up.static);
  return {
    include,
    map: Object.keys(map).length ? map : undefined,
    static: Object.keys(staticParams).length ? staticParams : undefined,
  };
}

export function schemaFieldEntries(schema: unknown): [string, SchemaFieldMeta][] {
  const props = asRecord(asRecord(schema).properties);
  return Object.entries(props)
    .map(([k, v]) => [k, v as SchemaFieldMeta] as [string, SchemaFieldMeta])
    .sort((a, b) => (a[1]["x-order"] ?? 99) - (b[1]["x-order"] ?? 99));
}

export function schemaDefaultsFromFields(schema: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of schemaFieldEntries(schema)) {
    if (prop.default !== undefined) out[key] = prop.default;
    else if (prop.enum?.length) out[key] = prop.enum[0];
  }
  return out;
}

export function enumLabel(prop: SchemaFieldMeta, value: unknown): string {
  const s = String(value);
  return prop.enumLabels?.[s] ?? s;
}

export function buildVideoTaskParams(
  params: Record<string, unknown>,
  media: VideoMediaState,
  runtimeRule?: Record<string, unknown>
): Record<string, unknown> {
  const cfg = parseVideoRuntime(runtimeRule);
  const firstKey = cfg.frames?.first?.key || "first_frame";
  const lastKey = cfg.frames?.last?.key || "last_frame";
  const refKey = cfg.reference_images?.key || "reference_images";
  const out: Record<string, unknown> = { ...params };
  if (media.first_frame?.url) out[firstKey] = media.first_frame.url;
  if (media.last_frame?.url) out[lastKey] = media.last_frame.url;
  if (media.reference_images.length) out[refKey] = media.reference_images.map((x) => x.url);
  return out;
}

export function parseCountOptions(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length) {
    const nums = raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 1);
    if (nums.length) return [...new Set(nums)].sort((a, b) => a - b);
  }
  return DEFAULT_VIDEO_COUNT_OPTIONS;
}

function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length ? v : fallback;
}
