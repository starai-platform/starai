type FramePairModel = {
  runtime_rule?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
  default_params?: Record<string, unknown>;
};

export type FramePairShot = {
  id: string;
  prompt: string;
  firstFrameUrl: string;
  lastFrameUrl: string;
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  duration: number;
};

export type FramePairShotState = {
  status: "idle" | "running" | "succeeded" | "failed";
  progress?: number;
  taskNo?: string;
  outputUrl?: string;
  error?: string;
};

const FRAME_PAIR_PROFILES = new Set(["frame_pair", "veo_frame_pair", "minimax_h3", "aliyun_multimodal"]);

function videoRuntime(model?: FramePairModel) {
  const rule = model?.runtime_rule?.video;
  return rule && typeof rule === "object" && !Array.isArray(rule) ? rule as Record<string, unknown> : {};
}

export function supportsFramePair(model?: FramePairModel) {
  return Boolean(model && FRAME_PAIR_PROFILES.has(String(videoRuntime(model).upload_profile || "")));
}

export function normalizeFramePairShots(value: unknown): FramePairShot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index): FramePairShot[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const id = String(item.id || `shot_${index + 1}`);
    const duration = Number(item.duration || 0);
    return [{
      id,
      prompt: String(item.prompt || ""),
      firstFrameUrl: String(item.firstFrameUrl || ""),
      lastFrameUrl: String(item.lastFrameUrl || ""),
      firstFrameAssetId: String(item.firstFrameAssetId || "") || undefined,
      lastFrameAssetId: String(item.lastFrameAssetId || "") || undefined,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 5,
    }];
  });
}

export function validateFramePairShots(shots: FramePairShot[]) {
  if (!shots.length) return "请至少添加一个镜头。";
  const invalid = shots.findIndex(shot => !shot.prompt.trim() || (!shot.firstFrameUrl && !shot.lastFrameUrl) || !Number.isFinite(shot.duration) || shot.duration <= 0);
  return invalid < 0 ? "" : `镜头 ${invalid + 1} 需要填写视频文案、至少一张首帧或尾帧图片，以及有效时长。`;
}

export function framePairSegmentCount(targetDuration: number, segmentDuration: number) {
  if (!Number.isFinite(targetDuration) || !Number.isFinite(segmentDuration) || targetDuration <= 0 || segmentDuration <= 0) return 1;
  return Math.max(1, Math.ceil(targetDuration / segmentDuration));
}

export type FramePairVideoSizeOption = {
  value: string;
  label: string;
  params: Record<string, string>;
};

function schemaProperty(fields: Record<string, unknown>, key: string) {
  const value = fields[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function schemaOptions(fields: Record<string, unknown>, key: string) {
  const property = schemaProperty(fields, key);
  const labels = property.enumLabels && typeof property.enumLabels === "object" && !Array.isArray(property.enumLabels)
    ? property.enumLabels as Record<string, unknown>
    : {};
  return (Array.isArray(property.enum) ? property.enum : []).map(value => ({
    value: String(value),
    label: String(labels[String(value)] || ""),
  }));
}

function videoDirectionLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["landscape", "horizontal", "16:9"].includes(normalized)) return "横屏";
  if (["portrait", "vertical", "9:16"].includes(normalized)) return "竖屏";
  if (["square", "1:1"].includes(normalized)) return "方形";
  if (normalized === "adaptive" || normalized === "auto") return "自适应";
  const dimensions = normalized.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  if (!dimensions) return value;
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  return width === height ? "方形" : width > height ? "横屏" : "竖屏";
}

function videoQualityLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  const dimensions = normalized.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  if (!dimensions) return /^(\d+(?:\.\d+)?)(p|k)$/i.test(value.trim()) ? value.trim().toUpperCase() : value;
  const shortEdge = Math.min(Number(dimensions[1]), Number(dimensions[2]));
  if (shortEdge === 2160) return "4K";
  if (shortEdge === 1440) return "2K";
  return `${shortEdge}P`;
}

function sizeOptionValue(params: Record<string, string>) {
  const entries = Object.entries(params);
  return entries.length === 1 ? entries[0][1] : entries.map(([key, value]) => `${key}=${value}`).join("|");
}

export function framePairVideoSize(model?: FramePairModel) {
  const properties = model?.input_schema?.properties;
  const fields = properties && typeof properties === "object" && !Array.isArray(properties) ? properties as Record<string, unknown> : {};
  const sizeOptions = schemaOptions(fields, "size");
  let options: FramePairVideoSizeOption[] = [];
  if (sizeOptions.length) {
    options = sizeOptions.map(option => ({
      value: option.value,
      label: option.label || `${videoDirectionLabel(option.value)} · ${videoQualityLabel(option.value)}`,
      params: { size: option.value },
    }));
  } else {
    const directionKey = ["aspect_ratio", "ratio", "orientation"].find(key => schemaOptions(fields, key).length) || "";
    const directions = directionKey ? schemaOptions(fields, directionKey) : [];
    const qualities = schemaOptions(fields, "resolution");
    const directionValues = directions.length ? directions : [{ value: "", label: "" }];
    const qualityValues = qualities.length ? qualities : [{ value: "", label: "" }];
    options = directionValues.flatMap(direction => qualityValues.map(quality => {
      const params: Record<string, string> = {};
      if (directionKey && direction.value) params[directionKey] = direction.value;
      if (quality.value) params.resolution = quality.value;
      return {
        value: sizeOptionValue(params),
        label: [direction.label || (direction.value ? videoDirectionLabel(direction.value) : ""), quality.label || (quality.value ? videoQualityLabel(quality.value) : "")].filter(Boolean).join(" · "),
        params,
      };
    })).filter(option => Object.keys(option.params).length > 0);
  }
  const defaults = Object.fromEntries(Object.keys(fields).map(key => {
    const property = schemaProperty(fields, key);
    return [key, String(model?.default_params?.[key] ?? property.default ?? "")];
  }));
  const selected = options.find(option => Object.entries(option.params).every(([key, value]) => defaults[key] === value)) || options[0];
  return { options, value: selected?.value || "", params: selected?.params || {} };
}

export function framePairTaskParams(
  model: FramePairModel,
  params: Record<string, unknown>,
  shot: FramePairShot,
) {
  const runtime = videoRuntime(model);
  const profile = String(runtime.upload_profile || "");
  const next: Record<string, unknown> = { ...params, duration: params.duration ?? shot.duration, user_prompt: shot.prompt };
  if (["minimax_h3", "aliyun_multimodal"].includes(profile)) {
    next[String(runtime.mode_param || "generation_mode")] = shot.firstFrameUrl && shot.lastFrameUrl ? "first_last" : shot.firstFrameUrl ? "first_frame" : "last_frame";
  }
  const frames = runtime.frames && typeof runtime.frames === "object" && !Array.isArray(runtime.frames) ? runtime.frames as Record<string, unknown> : {};
  const first = frames.first && typeof frames.first === "object" && !Array.isArray(frames.first) ? frames.first as Record<string, unknown> : {};
  const last = frames.last && typeof frames.last === "object" && !Array.isArray(frames.last) ? frames.last as Record<string, unknown> : {};
  const firstKey = String(first.key || "first_frame");
  const lastKey = String(last.key || "last_frame");
  if (shot.firstFrameUrl) next[firstKey] = shot.firstFrameUrl;
  else delete next[firstKey];
  if (shot.lastFrameUrl) next[lastKey] = shot.lastFrameUrl;
  else delete next[lastKey];
  return next;
}
