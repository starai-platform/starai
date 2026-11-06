/** Video model runtime_rule.video + input_schema extensions (config-driven UI & API). */

export type VideoUploadProfile =
  | "first_frame"
  | "single_ref"
  | "multi_ref"
  | "frame_pair"
  | "veo_frame_pair"
  | "veo_reference"
  | "omni_reference"
  | "seedance_2"
  | "minimax_h3"
  | "gateway_reference"
  | "aliyun_multimodal"
  | "aliyun_happyhorse_text"
  | "aliyun_happyhorse_first_frame"
  | "aliyun_happyhorse_reference"
  | "aliyun_happyhorse_edit"
  | "none";

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
  /** Shared limit across reference images, videos and audios (including frames). */
  max_reference_total?: number;
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
  reference_videos?: VideoFrameSlotConfig;
  reference_audios?: VideoFrameSlotConfig;
  mode_param?: string;
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
  description?: string;
  enum?: (string | number | boolean)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  "x-allow-custom"?: boolean;
  "x-enum-labels"?: string[];
  /** Display label map for enum values */
  enumLabels?: Record<string, string>;
  /** option_menu | boolean_toggle | select */
  "x-widget"?: string;
  widget?: string;
  "x-order"?: number;
  "x-icon"?: string;
  "x-highlight"?: boolean;
  /** Move a field to a model-specific prominent area instead of the bottom toolbar. */
  "x-placement"?: string;
  /** Collapse related bottom-toolbar fields into one menu. */
  "x-group"?: string;
  /** If true, value is omitted from upstream when equal to "auto" or false */
  "x-omit-auto"?: boolean;
}

export interface VideoMediaItem {
  url: string;
  name: string;
  public_id?: string;
  /** Browser-detected media duration, used for dynamic video cost estimates. */
  duration_seconds?: number;
}

export interface VideoMediaState {
  reference_images: VideoMediaItem[];
  reference_videos: VideoMediaItem[];
  reference_audios: VideoMediaItem[];
  first_frame: VideoMediaItem | null;
  last_frame: VideoMediaItem | null;
}

export const DEFAULT_VIDEO_COUNT_OPTIONS = [1, 3, 5, 10, 30, 50];

export const EMPTY_VIDEO_MEDIA: VideoMediaState = {
  reference_images: [],
  reference_videos: [],
  reference_audios: [],
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
  const refVideos = asRecord(video.reference_videos);
  const refAudios = asRecord(video.reference_audios);
  return {
    upload_profile: (video.upload_profile as VideoUploadProfile) || "single_ref",
    min_reference_images: numOr(video.min_reference_images, 0),
    max_reference_images: numOr(video.max_reference_images, 1),
    max_total_images: numOr(video.max_total_images, 9),
    max_reference_total: video.max_reference_total !== undefined ? Math.max(0, numOr(video.max_reference_total, 9)) : asRecord(runtimeRule?.upstream).adapter === "zex_video" ? 9 : undefined,
    count_toward_total: video.count_toward_total !== false,
    prompt_hint: typeof video.prompt_hint === "string" ? video.prompt_hint : "",
    prompt_required: video.prompt_required !== false,
    show_channel: video.show_channel === true,
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
    reference_videos: {
      key: strOr(refVideos.key, "reference_videos"),
      max: numOr(refVideos.max, 3),
    },
    reference_audios: {
      key: strOr(refAudios.key, "reference_audios"),
      max: numOr(refAudios.max, 3),
    },
    mode_param: strOr(video.mode_param, "generation_mode"),
  };
}

export function videoReferenceCapacity(config: VideoRuntimeConfig, media: VideoMediaState, mode?: string) {
  const active = (kind: string) => (kind === "image" || !["single_ref", "multi_ref"].includes(String(config.upload_profile)))
    && (mode === undefined || mode === "reference" || mode.split("_").includes(kind));
  const images = active("image") ? media.reference_images.length : 0;
  const videos = active("video") ? media.reference_videos.length : 0;
  const audios = active("audio") ? media.reference_audios.length : 0;
  const frames = (mode === undefined || mode === "first_frame" || mode === "first_last" ? Number(!!media.first_frame) : 0)
    + (mode === undefined || mode === "last_frame" || mode === "first_last" ? Number(!!media.last_frame) : 0);
  const total = images + videos + audios + frames;
  const remaining = config.max_reference_total === undefined ? Infinity : Math.max(0, config.max_reference_total - total);
  return {
    total, limit: config.max_reference_total, remaining,
    reference_images: Math.min(config.reference_images?.max ?? config.max_reference_images ?? 1, images + remaining),
    reference_videos: Math.min(config.reference_videos?.max ?? 3, videos + remaining),
    reference_audios: Math.min(config.reference_audios?.max ?? 3, audios + remaining),
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

export function isTopPlacementField(prop: Pick<SchemaFieldMeta, "x-placement">) {
  return prop["x-placement"] === "top" || prop["x-placement"] === "audio_top";
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
  const index = prop.enum?.findIndex((option) => String(option) === s) ?? -1;
  return prop.enumLabels?.[s] ?? prop["x-enum-labels"]?.[index] ?? s;
}

/** Schema choices may narrow the runtime capability, never exceed it. */
export function schemaCountConfig(prop: SchemaFieldMeta, runtime: Pick<VideoRuntimeConfig, "count_options" | "count_max" | "count_allow_custom"> = {}, fallback = DEFAULT_VIDEO_COUNT_OPTIONS) {
  const minimum = Math.max(1, Math.ceil(prop.minimum ?? 1));
  const maximum = Math.min(50, runtime.count_max ?? 50, prop.maximum ?? 50);
  const step = prop.multipleOf && prop.multipleOf > 0 ? prop.multipleOf : 1;
  const valid = (n: number) => Number.isInteger(n) && n >= minimum && n <= maximum && Math.abs(n / step - Math.round(n / step)) < 1e-8;
  const capability = runtime.count_options || [];
  const options = parseCountOptions(prop.enum?.length ? prop.enum : capability.length ? capability : fallback)
    .filter((n) => valid(n) && (runtime.count_allow_custom !== false || !capability.length || capability.includes(n)));
  const allowCustom = runtime.count_allow_custom !== false && (prop["x-allow-custom"] === true || !prop.enum?.length);
  return { options, minimum, maximum, step, allowCustom };
}

export function selectVideoTaskMedia(params: Record<string, unknown>, media: VideoMediaState, runtimeRule?: Record<string, unknown>): VideoMediaState {
  const cfg = parseVideoRuntime(runtimeRule);
  const adapter = String(asRecord(runtimeRule?.upstream).adapter || "");
  if (adapter === "omni_frame_pair_v1") return { ...EMPTY_VIDEO_MEDIA, first_frame: media.first_frame, last_frame: media.last_frame };
  if (["omni_reference_v1", "octopus_sd_mini_v1"].includes(adapter)) return String(params[cfg.mode_param || "generation_mode"] || "text") === "reference"
    ? { ...EMPTY_VIDEO_MEDIA, reference_images: media.reference_images } : EMPTY_VIDEO_MEDIA;
  if (!["zex_video", "volcengine_seedance_2", "topenrouter_seedance_2", "minimax_h3_v2", "omni_reference_v1", "octopus_sd_mini_v1"].includes(adapter) && !["seedance_2", "minimax_h3"].includes(String(cfg.upload_profile))) return media;
  const mode = String(params[cfg.mode_param || "generation_mode"] || "text");
  return mode === "text" || mode === "draft_task" || cfg.upload_profile === "none" ? EMPTY_VIDEO_MEDIA
    : ["first_frame", "last_frame", "first_last"].includes(mode) ? { ...EMPTY_VIDEO_MEDIA, first_frame: mode !== "last_frame" ? media.first_frame : null, last_frame: mode !== "first_frame" ? media.last_frame : null }
    : { ...media, first_frame: null, last_frame: null,
      reference_images: mode === "reference" || mode.split("_").includes("image") ? media.reference_images : [],
      reference_videos: !["single_ref", "multi_ref"].includes(String(cfg.upload_profile)) && (mode === "reference" || mode.split("_").includes("video")) ? media.reference_videos : [],
      reference_audios: !["single_ref", "multi_ref"].includes(String(cfg.upload_profile)) && (mode === "reference" || mode.split("_").includes("audio")) ? media.reference_audios : [] };
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
  const refVideoKey = cfg.reference_videos?.key || "reference_videos";
  const refAudioKey = cfg.reference_audios?.key || "reference_audios";
  const out: Record<string, unknown> = { ...params };
  if (["zex_video", "volcengine_seedance_2", "topenrouter_seedance_2", "minimax_h3_v2", "omni_reference_v1", "omni_frame_pair_v1", "octopus_sd_mini_v1"].includes(String(asRecord(runtimeRule?.upstream).adapter)) || ["seedance_2", "minimax_h3"].includes(String(cfg.upload_profile))) {
    for (const key of [firstKey, lastKey, refKey, refVideoKey, refAudioKey, "images", "videos", "audios", "input_reference", "first_last_frame", "reference_video_duration_seconds"]) delete out[key];
  }
  media = selectVideoTaskMedia(params, media, runtimeRule);
  if (media.first_frame?.url) out[firstKey] = media.first_frame.url;
  if (media.last_frame?.url) out[lastKey] = media.last_frame.url;
  if (media.reference_images.length) out[refKey] = media.reference_images.map((x) => x.url);
  if (media.reference_videos.length) out[refVideoKey] = media.reference_videos.map((x) => x.url);
  const referenceVideoDuration = media.reference_videos.reduce(
    (total, item) => total + (Number.isFinite(item.duration_seconds) ? Math.max(0, item.duration_seconds || 0) : 0),
    0
  );
  if (referenceVideoDuration > 0) out.reference_video_duration_seconds = referenceVideoDuration;
  if (media.reference_audios.length) out[refAudioKey] = media.reference_audios.map((x) => x.url);
  return out;
}

export interface VideoPromptReference extends VideoMediaItem {
  kind: "image" | "video" | "audio";
  index: number;
}

/** Enable only verified multimodal protocols, not every video upload template. */
export function supportsVideoPromptReferences(model?: { code?: string; runtime_rule?: Record<string, unknown> } | null): boolean {
  const rule = model?.runtime_rule;
  const adapter = String(asRecord(rule?.upstream).adapter || "");
  if (["volcengine_seedance_2", "topenrouter_seedance_2", "minimax_h3_v2"].includes(adapter)) return true;
  return adapter === "zex_video" && /seedance[_-]2[._-][05]|minimax[_-]h3/i.test(`${model?.code} ${rule?.template_key}`);
}

export function videoPromptReferences(params: Record<string, unknown>, media: VideoMediaState, runtimeRule?: Record<string, unknown>): VideoPromptReference[] {
  const selected = selectVideoTaskMedia(params, media, runtimeRule);
  const groups: Record<VideoPromptReference["kind"], VideoMediaItem[]> = {
    image: [selected.first_frame, selected.last_frame, ...selected.reference_images].filter((item): item is VideoMediaItem => Boolean(item)),
    video: [...selected.reference_videos], audio: [...selected.reference_audios],
  };
  const mode = String(params[parseVideoRuntime(runtimeRule).mode_param || "generation_mode"] || "text");
  const candidates = (["image", "video", "audio"] as const).flatMap(kind => groups[kind].map(item => ({ ...item, kind })));
  if (["volcengine_seedance_2", "topenrouter_seedance_2"].includes(String(asRecord(runtimeRule?.upstream).adapter)) && params.portrait_asset_id && /image|video/.test(mode)) {
    const kind = params.portrait_asset_type === "video" ? "video" : "image";
    const id = String(params.portrait_asset_id).replace(/^asset:\/\//, "");
    candidates.unshift({ url: `asset://${id}`, name: id, kind });
  }
  const seen = new Set<string>();
  const counts = { image: 0, video: 0, audio: 0 };
  return candidates.filter(item => {
    if (!item.url || (asRecord(runtimeRule?.upstream).adapter !== "zex_video" && seen.has(item.url))) return false;
    seen.add(item.url);
    return true;
  }).map(item => ({ ...item, index: ++counts[item.kind] }));
}

export function videoReferenceToken(reference: Pick<VideoPromptReference, "kind" | "index">, locale: string) {
  const kind = locale.startsWith("zh") ? { image: "图片", video: "视频", audio: "音频" }[reference.kind] : reference.kind;
  return `@${kind}${reference.index}`;
}

const videoMentionPattern = () => /@(图片|圖片|图像|视频|視頻|音频|音頻|image|video|audio)([0-9]+|\?)(?![a-zA-Z0-9_])/gi;
function videoMentionMatches(prompt: string) {
  let end = -1;
  return [...prompt.matchAll(videoMentionPattern())].filter(match => {
    if (match.index !== end && /[a-zA-Z0-9_@]/.test(prompt[match.index - 1] || "")) return false;
    end = match.index + match[0].length;
    return true;
  });
}
function videoMentionKind(label: string): VideoPromptReference["kind"] {
  return /^(图片|圖片|图像|image)$/i.test(label) ? "image" : /^(视频|視頻|video)$/i.test(label) ? "video" : "audio";
}

/** Reindex by asset identity in one pass; never silently bind a removed asset to its successor. */
export function reconcileVideoReferences(prompt: string, previous: VideoPromptReference[], next: VideoPromptReference[]): string {
  const starts = new Set(videoMentionMatches(prompt).map(match => match.index));
  return prompt.replace(videoMentionPattern(), (token, label: string, number: string, offset: number) => {
    if (!starts.has(offset)) return token;
    if (number === "?") return token;
    const kind = videoMentionKind(label);
    const old = previous.find(item => item.kind === kind && item.index === Number(number));
    if (!old) return token;
    const sameAsset = (item: VideoPromptReference) => item.kind === kind && (old.public_id && item.public_id ? item.public_id === old.public_id : item.url === old.url);
    const occurrence = previous.filter(item => item.index < old.index && sameAsset(item)).length;
    const matches = next.filter(sameAsset);
    const current = matches[occurrence] || matches[0];
    return `@${label}${current?.index ?? "?"}`;
  });
}

export function invalidVideoReferences(prompt: string, references: VideoPromptReference[]): string[] {
  return videoMentionMatches(prompt).filter(match => !references.some(item => item.kind === videoMentionKind(match[1]) && item.index === Number(match[2]))).map(match => match[0]);
}

export function videoMentionQuery(value: string, caret: number) {
  const match = /(?<![a-zA-Z0-9_@])@([^@\s,，。;；!?！？<>]*)$/.exec(value.slice(0, caret));
  return match ? { start: caret - match[0].length, end: caret, query: match[1] } : null;
}

const SIZE_BASED_VIDEO_PROFILES = new Set(["veo_frame_pair", "veo_reference", "omni_reference"]);

export function isSizeBasedVideoProfile(runtimeRule?: Record<string, unknown>) {
  const video = asRecord(runtimeRule?.video);
  const upstream = asRecord(runtimeRule?.upstream);
  const profile = String(video.upload_profile || "").toLowerCase();
  const adapter = String(upstream.adapter || "").toLowerCase();
  return SIZE_BASED_VIDEO_PROFILES.has(profile) || ["veo_frame_pair_v1", "veo_reference_v1", "omni_reference_v1", "omni_frame_pair_v1"].includes(adapter);
}

export function canonicalVideoSize(value: unknown, fallback = "1280x720") {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (/^\d+x\d+$/.test(raw)) return raw;
  if (["portrait", "vertical", "9:16"].includes(raw)) return "720x1280";
  if (["landscape", "horizontal", "16:9"].includes(raw)) return "1280x720";
  return fallback;
}

// VEO/Omni /v1/videos uses a widthxheight `size`. Remove legacy direction
// aliases so conflicting defaults can never override the option selected in the workbench.
export function normalizeSizeBasedVideoParams(params: Record<string, unknown>, runtimeRule?: Record<string, unknown>) {
  if (!isSizeBasedVideoProfile(runtimeRule)) return params;
  const next = { ...params };
  const selected = next.size ?? next.aspect_ratio ?? next.orientation ?? next.ratio;
  next.size = canonicalVideoSize(selected);
  delete next.aspect_ratio;
  delete next.orientation;
  delete next.ratio;
  return next;
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
