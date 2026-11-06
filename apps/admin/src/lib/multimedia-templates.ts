/** Gateway protocols are selected explicitly; model aliases remain editable. */
export type MultimediaTemplate = {
  key: string;
  label: string;
  category: "image" | "video" | "audio";
  endpoint: string;
  model: string;
  description: string;
  schema: Record<string, unknown>;
  defaults: Record<string, unknown>;
  runtime: Record<string, any>;
  billing: "per_image" | "per_second" | "per_request" | "per_token";
  connection?: Record<string, unknown>;
  priceRule?: Record<string, unknown>;
};

const field = (title: string, values: Array<string | number>, icon: string, order: number) => ({
  type: typeof values[0] === "number" ? values.every((value) => Number.isInteger(value)) ? "integer" : "number" : "string", title,
  enum: values, default: values[0], "x-widget": "option_menu", "x-icon": icon, "x-order": order,
});
const schema = (properties: Record<string, unknown>) => ({ type: "object", properties });
const video = (profile = "none", max = 0) => ({
  upload_profile: profile, prompt_required: true, max_reference_images: max,
  min_reference_images: 0, max_total_images: max, reference_images: { key: "reference_images", max },
  count_options: [1], count_allow_custom: false, count_max: 1, show_channel: false,
});
const native = (include: string[], extra: Record<string, unknown> = {}) => ({ adapter: "native_media", request_format: "json", include, ...extra });
const videoFields = { duration: field("视频时长", [5, 10], "clock", 1), seed: { type: "integer", title: "随机种子", minimum: 0, "x-order": 5 } };
const imageFields = { count: field("生成数量", [1], "layers", 1), aspect_ratio: field("画面比例", ["auto", "1:1", "16:9", "9:16"], "ratio", 2) };
const imageRuntime = { max_reference_images: 0, count_options: [1], count_max: 1, show_size_tier: false, supported_ratios: ["auto", "1:1", "16:9", "9:16"], allow_auto_ratio: true };
const MINIMAX_IMAGE_RATIOS = ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"];

// Zex's /v1/videos contract differs from both Sora and the vendor-native APIs.
const ZEX_VIDEO_MODELS = [
  "grok-imagine-video-1.5", "grok-imagine-video-1.5-fast", "grok-imagine-video-1.5-lite",
  "seedance-2.0", "seedance-2.0-mini", "seedance-2.5",
  "minimax-h3", "minimax-h3-max",
];
const ZEX_MINIMAX_MODES = ["text", "image", "video", "audio", "image_audio", "image_video", "video_audio", "image_video_audio", "reference"];
const zexVideoTemplates: MultimediaTemplate[] = ZEX_VIDEO_MODELS.map((model) => {
  const grok = model.startsWith("grok-");
  const lite = model.endsWith("-lite");
  const fast = model.endsWith("-fast");
  const minimax = model.startsWith("minimax-");
  const multimodal = minimax || model.startsWith("seedance-2.0");
  const seedance25 = model === "seedance-2.5";
  const durations = seedance25 ? [10, 15, 30] : Array.from({ length: 12 }, (_, i) => i + 4);
  const defaultDuration = seedance25 ? 10 : multimodal ? 6 : 5;
  const modes = minimax ? ZEX_MINIMAX_MODES : ["text", "first_frame", ...(!fast && !lite ? ["first_last"] : []), ...(!lite ? ["reference"] : [])];
  const maxImages = lite ? 1 : grok ? 7 : multimodal ? 9 : 4;
  const resolutions = minimax ? ["480p", "768p"] : ["480p", "720p"];
  return {
    key: `zex_${model.replaceAll(".", "_").replaceAll("-", "_")}`,
    label: `章鱼哥 · ${model}${seedance25 ? "（10/15/30 秒）" : ""} 视频 JSON`, category: "video", endpoint: "/v1/videos", model: seedance25 ? "seedance-2.5-10s" : model,
    description: `章鱼哥网关协议，seconds 使用字符串，完成后读取顶层 url/video_url。${seedance25 ? "工作台选择 10/15/30 秒，自动调用对应的 seedance-2.5-{时长}s 模型，每个时长分别配置固定售价，仅接收图片。" : lite ? "仅文生或单张首帧。" : fast ? "仅单张首帧；多图参考最长 10 秒。" : multimodal ? "图片、视频、音频参考合计最多 9 项。" : "支持首帧、首尾帧及最多 7 张参考图。"}当前分辨率支持 ${resolutions.join(" / ")}，默认 ${resolutions[0]}。可按上游配置扩展参数中的分辨率选项。`,
    schema: {
      ...schema({
        generation_mode: { ...field("素材组合", modes, "layers", 0), ...(minimax ? { description: "选择参考素材组合，上传对应素材。" } : {}), enumLabels: { text: "文生视频", first_frame: "首帧", first_last: "首尾帧", reference: minimax ? "自由参考组合" : "参考内容", image: "图片 + 文本", video: "视频 + 文本", audio: "音频 + 文本", image_audio: "图片 + 音频", image_video: "图片 + 视频", video_audio: "视频 + 音频", image_video_audio: "图片 + 视频 + 音频" } },
        duration: { ...field("视频时长", durations, "clock", 1), default: defaultDuration },
        aspect_ratio: field("画面比例", ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "ratio", 2),
        resolution: field("分辨率", resolutions, "4k", 3),
      }), required: ["duration"],
    },
    defaults: { generation_mode: "text", duration: defaultDuration, aspect_ratio: "16:9", resolution: resolutions[0] }, billing: seedance25 || model === "seedance-2.0" ? "per_request" : "per_second",
    ...(seedance25 ? { priceRule: { unit_price_by_duration: { "10": 0, "15": 0, "30": 0 } } } : multimodal ? { priceRule: { unit_price_by_resolution: Object.fromEntries(resolutions.map(resolution => [resolution, 0])) } } : {}),
    connection: { auth_type: "bearer" },
    runtime: {
      video: { ...video("aliyun_multimodal", maxImages), mode_param: "generation_mode", max_total_images: maxImages,
        max_reference_total: multimodal ? 9 : maxImages, reference_max_duration: fast ? 10 : 0,
        reference_videos: { key: "reference_videos", max: multimodal ? 9 : 0 }, reference_audios: { key: "reference_audios", max: multimodal ? 9 : 0 } },
      upstream: { adapter: "zex_video", request_format: "json", include: ["duration", "aspect_ratio", "resolution"],
        ...(seedance25 ? { model_template: "seedance-2.5-{duration}s" } : {}),
        poll_path: "/v1/videos/{id}", poll_interval_sec: 5,
        response_map: { task_id: "id", status: "status", progress: "progress", media_url: ["url", "video_url"] },
        success_statuses: ["completed"], failure_statuses: ["failed"] },
    },
  };
});

// Upload shape uses the existing components; gateway protocol and prices stay put.
export function configureZexUploadProfile<T extends { runtime_rule: string; input_schema: string; default_params: string; new_api_model?: string }>(form: T, profile: string): T {
  const runtime = JSON.parse(form.runtime_rule || "{}");
  if (runtime.upstream?.adapter !== "zex_video") return form;
  const template = zexVideoTemplates.find(t => t.key === runtime.template_key || t.model === form.new_api_model);
  const input = JSON.parse(form.input_schema || "{}");
  const defaults = JSON.parse(form.default_params || "{}");
  const video = runtime.video || {};
  const key = video.mode_param || "generation_mode";
  const property = input.properties?.[key] || {};
  const minimax = template?.key.startsWith("zex_minimax_h3") === true;
  const capabilities: string[] = minimax ? ["text", "reference"] : (template?.schema.properties as any)?.generation_mode?.enum || property.enum || ["text", "reference"];
  let modes = [...capabilities];
  if (profile === "none") modes = ["text"];
  if (["multi_ref", "single_ref"].includes(profile)) modes = capabilities.filter(m => ["text", "first_frame", "first_last", "reference"].includes(m));
  if (profile === "first_frame") modes = capabilities.filter(m => ["text", "first_frame"].includes(m));
  if (profile === "frame_pair") modes = capabilities.filter(m => ["text", "first_frame", "first_last"].includes(m));
  if (profile === "seedance_2" || (minimax && ["aliyun_multimodal", "gateway_reference"].includes(profile))) {
    const combinations = ["image", "video", ...(minimax ? ["audio"] : []), "image_audio", "image_video", "video_audio", "image_video_audio"].filter(m =>
      (!m.includes("image") || Number(video.reference_images?.max ?? video.max_reference_images ?? 0) > 0)
      && (!m.includes("video") || Number(video.reference_videos?.max ?? 0) > 0)
      && (!m.includes("audio") || Number(video.reference_audios?.max ?? 0) > 0));
    modes = capabilities.filter(m => m !== "reference").concat(capabilities.includes("reference") ? combinations : []);
    if (minimax && profile !== "seedance_2" && capabilities.includes("reference")) modes.push("reference");
  }
  const mode = modes.includes(defaults[key]) ? defaults[key] : modes[0] || "text";
  input.properties = { ...input.properties, [key]: { ...property, title: "素材组合", enum: modes, default: mode, ...(minimax ? { description: "选择参考素材组合，上传对应素材。" } : {}),
    enumLabels: { ...property.enumLabels, text: "文生视频", first_frame: "首帧", first_last: "首尾帧", reference: minimax ? "自由参考组合" : "参考内容", image: minimax ? "图片 + 文本" : "参考图片", video: minimax ? "视频 + 文本" : "参考视频", audio: "音频 + 文本", image_audio: "图片 + 音频", image_video: "图片 + 视频", video_audio: "视频 + 音频", image_video_audio: "图片 + 视频 + 音频" } } };
  return { ...form, runtime_rule: JSON.stringify({ ...runtime, video: { ...video, upload_profile: profile } }, null, 2), input_schema: JSON.stringify(input, null, 2), default_params: JSON.stringify({ ...defaults, [key]: mode }, null, 2) };
}

export const MULTIMEDIA_TEMPLATES: MultimediaTemplate[] = [
  ...zexVideoTemplates,
  {
    key: "omni_frame_pair_v1", label: "章鱼哥 · Omni Flash 10 秒 · 首帧 / 首尾帧", category: "video", endpoint: "/v1/videos", model: "omni_flash-10s-fl",
    description: "Omni 首尾帧独立型号，固定 10 秒、720P；首帧必填、尾帧可选。按顺序发送 images 和 size，时长由模型名决定。",
    schema: { ...schema({ duration: field("视频时长", [10], "clock", 1), size: field("视频尺寸", ["1280x720", "720x1280"], "ratio", 2) }), required: ["first_frame"] },
    defaults: { duration: 10, size: "1280x720" }, billing: "per_request",
    connection: { auth_type: "bearer" },
    runtime: {
      video: { ...video("veo_frame_pair", 0), max_total_images: 2, max_reference_total: 2,
        frames: { first: { key: "first_frame", label: "首帧", max: 1 }, last: { key: "last_frame", label: "尾帧（可选）", max: 1 } },
        reference_videos: { key: "reference_videos", max: 0 }, reference_audios: { key: "reference_audios", max: 0 } },
      upstream: { adapter: "omni_frame_pair_v1", request_format: "json", include: ["size", "first_frame", "last_frame"],
        poll_path: "/v1/videos/{id}", poll_interval_sec: 10, poll_timeout_sec: 7200, request_timeout_sec: 120,
        response_map: { task_id: "id", status: "status", media_url: ["url", "video_url"] } },
    },
  },
  ...[
    ["newapi_grok_image", "Grok", "grok-imagine-image"],
    ["newapi_doubao_image", "Doubao / Seedream", ""],
    ["newapi_qwen_image", "Qwen-Image", "qwen-image"],
    ["newapi_minimax_image", "MiniMax Image", "image-01"],
  ].map(([key, name, model]): MultimediaTemplate => ({
    key, label: `NEW API / OpenLux · ${name} 图片 JSON`, category: "image", endpoint: "/v1/images/generations", model,
    description: "采用网关 Images JSON 协议；模型别名、尺寸及扩展字段以接入方文档为准。默认只开启文生图。",
    schema: schema({ count: imageFields.count }), defaults: { count: 1, aspect_ratio: "auto" }, billing: "per_image",
    runtime: { image: { ...imageRuntime, supported_ratios: ["auto"], count_options: [1], count_max: 1 }, upstream: native([]) },
  })),
  {
    key: "minimax_native_image", label: "MiniMax 原生 / 透传网关 · image-01 文生图 JSON", category: "image", endpoint: "/v1/image_generation", model: "image-01",
    description: "MiniMax 同步文生图，支持 1–9 张、八种比例、可选种子与提示词优化，返回 URL 或 Base64。未开启参考图输入。",
    schema: schema({ count: field("生成数量", [1, 2, 3, 4, 5, 6, 7, 8, 9], "layers", 1), aspect_ratio: field("画面比例", MINIMAX_IMAGE_RATIOS, "ratio", 2), seed: { ...videoFields.seed, "x-placement": "top" }, response_format: { ...field("返回格式", ["url", "base64"], "format", 3), "x-placement": "top" }, prompt_optimizer: { type: "boolean", title: "优化提示词", default: false, "x-widget": "boolean_toggle", "x-placement": "top", "x-order": 4 } }),
    defaults: { count: 1, aspect_ratio: "1:1", response_format: "url", prompt_optimizer: false }, billing: "per_image",
    runtime: { image: { ...imageRuntime, count_options: [1, 2, 3, 4], count_allow_custom: true, count_max: 9, supported_ratios: MINIMAX_IMAGE_RATIOS, allow_auto_ratio: false }, upstream: native(["count", "aspect_ratio", "seed", "response_format", "prompt_optimizer"], { map: { count: "n" }, response_map: { media_url: "data.image_urls", media_base64: "data.image_base64" } }) },
  },
  {
    key: "grok_native_image", label: "Grok 原生 · 文生图 JSON", category: "image", endpoint: "/v1/images/generations", model: "grok-imagine-image",
    description: "xAI 原生文生图；不发送 OpenAI quality 档位。图像编辑请另配 /v1/images/edits JSON 与 image.url。",
    schema: schema({ count: field("生成数量", [1], "layers", 1) }), defaults: { count: 1 }, billing: "per_image",
    runtime: { image: { ...imageRuntime, supported_ratios: ["auto"] }, upstream: native(["count"], { map: { count: "n" } }) },
  },
  {
    key: "newapi_video_json", label: "NEW API · 通用视频 JSON", category: "video", endpoint: "/v1/video/generations", model: "",
    description: "通用 JSON 任务协议，支持数值 duration 与 image 单张首帧。请填写网关公布的 Grok / Doubao / Wan / Vidu / MiniMax 模型别名与支持参数。",
    schema: schema(videoFields), defaults: { duration: 5 }, billing: "per_second",
    runtime: { video: video("first_frame", 1), upstream: native(["duration", "seed", "first_frame"], { map: { first_frame: "image" }, poll_path: "/v1/video/generations/{id}", response_map: { task_id: "task_id", status: "status", media_url: "url" } }) },
  },
  ...["json", "multipart"].map((format): MultimediaTemplate => ({
    key: `gateway_video_${format}`, label: `NEW API / OpenLux · /v1/videos ${format === "json" ? "JSON 二开" : "multipart"}`, category: "video", endpoint: "/v1/videos", model: "",
    description: "OpenAI Videos 任务协议，首帧使用 input_reference，时长使用 seconds；二开接口可修改 include/map/static、poll_path 与 response_map。",
    schema: schema({ duration: field("视频时长", [4, 8, 12], "clock", 1), size: field("视频尺寸", ["1280x720", "720x1280"], "ratio", 2) }), defaults: { duration: 4, size: "1280x720" }, billing: "per_second",
    runtime: { video: video("first_frame", 1), upstream: { include: ["duration", "size", "first_frame"], map: { duration: "seconds", first_frame: "input_reference" }, request_format: format, poll_path: "/v1/videos/{id}" } },
  })),
  {
    key: "grok_native_video", label: "Grok 原生 / 透传网关 · 视频 JSON", category: "video", endpoint: "/v1/videos/generations", model: "grok-imagine-video",
    description: "xAI 视频生成任务；image.url 使用首帧，状态和 video.url 使用响应映射。",
    schema: schema({ duration: videoFields.duration, aspect_ratio: field("画面比例", ["16:9", "9:16", "1:1"], "ratio", 2), resolution: field("分辨率", ["480p", "720p"], "4k", 3) }), defaults: { duration: 5, aspect_ratio: "16:9", resolution: "480p" }, billing: "per_second",
    runtime: { video: video("first_frame", 1), upstream: native(["duration", "aspect_ratio", "resolution", "first_frame"], { map: { first_frame: "image.url" }, poll_path: "/v1/videos/{id}", response_map: { task_id: "request_id", status: "status", media_url: "video.url", output_seconds: "video.duration" }, success_statuses: ["done", "completed"], failure_statuses: ["failed", "expired"] }) },
  },
  ...[false, true].map((image): MultimediaTemplate => ({
    key: image ? "vidu_native_image_video" : "vidu_native_text_video", label: `Vidu 原生 / 透传网关 · ${image ? "图生" : "文生"}视频`, category: "video", endpoint: image ? "/ent/v2/img2video" : "/ent/v2/text2video", model: "viduq1",
    description: `Vidu q1 默认 5 秒；${image ? "图生比例跟随首帧图片，提示词可选。" : ""}其他模型请同步调整 schema。原生鉴权为 Token，Bearer 网关需修改 connection.auth_type。`,
    schema: schema({ duration: field("视频时长", [5], "clock", 1), ...(!image ? { aspect_ratio: field("画面比例", ["16:9", "9:16", "1:1"], "ratio", 2) } : {}), resolution: field("分辨率", ["1080p"], "4k", 3), seed: videoFields.seed }), defaults: { duration: 5, ...(!image ? { aspect_ratio: "16:9" } : {}), resolution: "1080p" }, billing: "per_second",
    runtime: { video: { ...video(image ? "multi_ref" : "none", image ? 1 : 0), prompt_required: !image, min_reference_images: image ? 1 : 0 }, upstream: native(["duration", ...(!image ? ["aspect_ratio"] : []), "resolution", "seed", ...(image ? ["reference_images"] : [])], { map: { reference_images: "images" }, poll_path: "/ent/v2/tasks/{id}/creations", response_map: { task_id: "task_id", status: "state", media_url: "creations", error: "err_code" }, success_statuses: ["success"], failure_statuses: ["failed"] }) },
    connection: { auth_type: "token" },
  })),
  {
    key: "wan_native_video", label: "Wan 原生 / 百炼透传网关 · 文生视频", category: "video", endpoint: "/api/v1/services/aigc/video-generation/video-synthesis", model: "wan2.2-t2v-plus",
    description: "百炼异步视频 JSON，prompt 与参数封装为 input/parameters；支持任务轮询。网关是否透传异步请求头需按接入方核实。",
    schema: schema({ duration: field("视频时长", [5], "clock", 1), size: field("视频尺寸", ["832*480", "1920*1080"], "ratio", 2), seed: videoFields.seed }), defaults: { duration: 5, size: "832*480" }, billing: "per_second",
    runtime: { video: video(), upstream: { adapter: "aliyun_wan_video", request_format: "json", include: ["duration", "size", "seed"], poll_path: "/api/v1/tasks/{id}", response_map: { task_id: "output.task_id", status: "output.task_status", media_url: "output.video_url", error: "output.message" }, success_statuses: ["SUCCEEDED"], failure_statuses: ["FAILED", "CANCELED"] } },
    connection: { headers: { "X-DashScope-Async": "enable" } },
  },
  {
    key: "vidu_reference_image", label: "Vidu / OpenLux · 参考生图异步 JSON", category: "image", endpoint: "/ent/v2/reference2image", model: "viduq1",
    description: "Vidu 参考生图，支持 1–7 张参考图，任务查询共用 /ent/v2/tasks/{id}/creations。网关默认 Bearer，官方直连请选 Token 鉴权。",
    schema: schema({ count: imageFields.count, aspect_ratio: field("画面比例", ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"], "ratio", 2) }), defaults: { count: 1, aspect_ratio: "auto" }, billing: "per_image",
    runtime: { image: { ...imageRuntime, max_reference_images: 7, min_reference_images: 1, count_options: [1], count_max: 1, reference_images: { key: "reference_images", max: 7 }, supported_ratios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"] }, upstream: native(["reference_images", "aspect_ratio"], { map: { reference_images: "images" }, poll_path: "/ent/v2/tasks/{id}/creations", response_map: { status: "state", media_url: "creations", error: "err_code" }, success_statuses: ["success"], failure_statuses: ["failed"] }) },
  },
  {
    key: "vidu_text_audio", label: "Vidu / OpenLux · 文生音效异步 JSON", category: "audio", endpoint: "/ent/v2/text2audio", model: "audio1.0",
    description: "文生音效使用 prompt 与 2–10 秒 duration，任务查询共用 Vidu creations。网关默认 Bearer，官方直连请选 Token 鉴权。",
    schema: schema({ duration: { type: "number", title: "音频时长（秒）", minimum: 2, maximum: 10, default: 5 } }), defaults: { duration: 5 }, billing: "per_second",
    runtime: { audio: { input_layout: "single", prompt_required: true, show_channel: false, billing_hint: "estimated", count_options: [1], count_allow_custom: false, count_max: 1 }, upstream: native(["duration"], { poll_path: "/ent/v2/tasks/{id}/creations", response_map: { status: "state", media_url: "creations", error: "err_code" }, success_statuses: ["success"], failure_statuses: ["failed"] }) },
  },
  {
    key: "wan_native_image_video", label: "Wan 原生 / 百炼透传网关 · 图生视频", category: "video", endpoint: "/api/v1/services/aigc/video-generation/video-synthesis", model: "wan2.2-i2v-plus",
    description: "Wan 2.2 图生视频需要 1 张首帧，固定 5 秒；图生分辨率通过 resolution 选择。",
    schema: { ...schema({ duration: field("视频时长", [5], "clock", 1), resolution: field("分辨率", ["480P", "1080P"], "4k", 2), seed: videoFields.seed }), required: ["first_frame"] }, defaults: { duration: 5, resolution: "480P" }, billing: "per_second",
    runtime: { video: { ...video("first_frame", 1), min_reference_images: 1 }, upstream: { adapter: "aliyun_wan_video", request_format: "json", include: ["duration", "resolution", "seed", "first_frame"], map: { first_frame: "img_url" }, poll_path: "/api/v1/tasks/{id}", response_map: { task_id: "output.task_id", status: "output.task_status", media_url: "output.video_url", error: "output.message" }, success_statuses: ["SUCCEEDED"], failure_statuses: ["FAILED", "CANCELED"] } },
    connection: { headers: { "X-DashScope-Async": "enable" } },
  },
  {
    key: "minimax_native_video", label: "MiniMax 原生 / 透传网关 · Hailuo 视频", category: "video", endpoint: "/v1/video_generation", model: "MiniMax-Hailuo-2.3",
    description: "MiniMax V1 视频任务，按 task_id 轮询，成功后由 file_id 查询下载链接。H3 系列继续使用现有 V2 模板。",
    schema: schema({ duration: field("视频时长", [6], "clock", 1), resolution: field("分辨率", ["768P", "1080P"], "4k", 2) }), defaults: { duration: 6, resolution: "768P" }, billing: "per_second",
    runtime: { video: video("first_frame", 1), upstream: native(["duration", "resolution", "first_frame"], { map: { first_frame: "first_frame_image" }, poll_path: "/v1/query/video_generation?task_id={id}", response_map: { task_id: "task_id", status: "status", file_id: "file_id" }, success_statuses: ["Success"], failure_statuses: ["Fail"], result_path: "/v1/files/retrieve?file_id={file_id}", result_response_map: { media_url: "file.download_url" } }) },
  },
  ...[
    ["newapi_audio_speech", "通用 TTS", ""],
    ["newapi_qwen_speech", "Qwen TTS", ""],
    ["newapi_minimax_speech", "MiniMax TTS", "speech-2.8-hd"],
  ].map(([key, name, model]): MultimediaTemplate => ({
    key, label: `NEW API / OpenLux · ${name} OpenAI 兼容`, category: "audio", endpoint: "/v1/audio/speech", model,
    description: "OpenAI Speech JSON 与二进制音频响应；模型名及音色按网关公布的别名填写。原生 MiniMax / Qwen 请使用已有官方模板。",
    schema: { ...schema({ voice: { type: "string", title: "音色 ID", minLength: 1, "x-placement": "top", "x-order": 1 }, speed: field("语速", [1, 0.8, 1.2, 1.5], "speed", 2), response_format: field("输出格式", ["mp3", "wav", "flac", "opus"], "format", 3) }), required: ["voice"] }, defaults: { speed: 1, response_format: "mp3" }, billing: "per_request",
    runtime: { audio: { input_layout: "single", prompt_required: true, show_channel: false, billing_hint: "estimated", count_options: [1], count_allow_custom: false, count_max: 1 }, upstream: native(["voice", "speed", "response_format"], { map: { prompt: "input" } }) },
  })),
];

export function applyMultimediaTemplate<T extends { new_api_model: string; new_api_extra_params: string; runtime_rule: string }>(current: T, key: string) {
  const template = MULTIMEDIA_TEMPLATES.find((item) => item.key === key);
  if (!template) return current;
  const extra = JSON.parse(clearTemplateConnection(current.new_api_extra_params, current.runtime_rule));
  const connection = { ...extra.connection, ...template.connection };
  if (template.connection?.headers) connection.headers = { ...extra.connection?.headers, ...(template.connection.headers as object) };
  return {
    ...current, category: template.category, request_mode: template.category === "image" ? "images" : template.category,
    new_api_endpoint: template.endpoint, new_api_model: template.model || current.new_api_model,
    new_api_extra_params: JSON.stringify({ ...extra, connection }, null, 2),
    input_schema: JSON.stringify(template.schema, null, 2), default_params: JSON.stringify(template.defaults, null, 2),
    runtime_rule: JSON.stringify({ ...template.runtime, template_key: key, capabilities: { web_search: false, deep_think: false }, ...(template.category === "image" ? { image: { ...template.runtime.image, interface_type: key } } : {}) }, null, 2),
    price_rule: JSON.stringify(template.billing === "per_token" ? { billing_type: "per_token", input_price_per_m: 0, output_price_per_m: 0, currency: "POINT" } : { billing_type: template.billing, unit_price: 0, currency: "POINT", ...template.priceRule }, null, 2),
  };
}

/** Remove provider-owned connection defaults while preserving edited headers and credentials. */
export function clearTemplateConnection(extraText: string, runtimeText: string): string {
  let extra: Record<string, any> = {};
  let runtime: Record<string, any> = {};
  try { const parsed = JSON.parse(extraText || "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) extra = parsed; } catch { /* invalid form JSON is validated on save */ }
  try { runtime = JSON.parse(runtimeText || "{}") || {}; } catch { /* no recognized template */ }
  const previous = MULTIMEDIA_TEMPLATES.find((template) => template.key === runtime.template_key)?.connection;
  const connection = { ...extra.connection };
  if (previous?.auth_type && connection.auth_type === previous.auth_type) connection.auth_type = "bearer";
  const headers = { ...connection.headers };
  for (const [key, value] of Object.entries(previous?.headers || {})) if (headers[key] === value) delete headers[key];
  if (connection.headers) connection.headers = headers;
  return JSON.stringify({ ...extra, connection }, null, 2);
}

export function clearMediaTemplateRuntime(runtimeText: string): string {
  let runtime: Record<string, any> = {};
  try { runtime = JSON.parse(runtimeText || "{}") || {}; } catch { /* invalid form JSON is validated on save */ }
  for (const key of ["template_key", "upstream", "image", "video", "audio"]) delete runtime[key];
  return JSON.stringify({ ...runtime, capabilities: { ...runtime.capabilities, web_search: false, deep_think: false } }, null, 2);
}
