export type TaskState = { task_no?: string; public_id?: string; workflow_code?: string; type?: string; status: string; progress?: number; current_step?: string; user_feedback?: number; input?: Record<string, unknown>; inputs?: Record<string, unknown>; output?: Record<string, unknown>; outputs?: Record<string, unknown>; media_tasks?: Array<{ task_no?: string; type?: string; status?: string; progress?: number; output?: Record<string, unknown>; error_message?: string }>; node_runs?: Array<{ node_id?: string; name?: string; type?: string; status?: string; duration_ms?: number; error?: string }>; error_message?: string; created_at?: string };

export type WorkflowMessage = { role: "user" | "assistant"; content: string; images?: string[]; videos?: string[]; audios?: string[]; workflow?: TaskState; resultRunId?: string };

function mediaURLs(value: unknown, field: string): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => mediaURLs(item, field));
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (item.status === "failed") return [];
    return mediaURLs(item[field] || item.output || item.url, field);
  }
  return [];
}

function outputMediaURLs(value: unknown, kind: "image" | "video" | "audio", hint = ""): string[] {
  if (typeof value === "string") {
    const clean = value.trim();
    if (!clean) return [];
    const key = hint.toLowerCase();
    const hinted = kind === "image" ? /image|poster|cover|photo|picture|thumbnail/.test(key) : kind === "video" ? /video|movie|clip/.test(key) : /audio|voice|speech|music|narration/.test(key);
    const extension = kind === "image" ? /\.(?:png|jpe?g|webp|gif|avif)(?:\?|$)/i : kind === "video" ? /\.(?:mp4|webm|mov|m3u8)(?:\?|$)/i : /\.(?:mp3|wav|m4a|aac|ogg)(?:\?|$)/i;
    return hinted || extension.test(clean) ? [clean] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => outputMediaURLs(item, kind, hint));
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => outputMediaURLs(item, kind, key));
  return [];
}

export function workflowMaterials(run: TaskState) {
  const outputs = run.outputs || {};
  const plan = (outputs.comic_drama || {}) as Record<string, unknown>;
  const unique = (value: unknown, field: string) => Array.from(new Set(mediaURLs(value, field)));
  return {
    images: unique(outputs.keyframes ?? plan.keyframes ?? outputs.media_tasks ?? run.media_tasks, "image_url"),
    videos: unique(outputs.segments ?? plan.segments ?? outputs.media_tasks ?? run.media_tasks, "video_url").filter((url) => !finalWorkflowMedia(run).videos.includes(url)),
    audios: unique(outputs.narrations ?? plan.narrations ?? outputs.media_tasks ?? run.media_tasks, "audio_url"),
  };
}

export function finalWorkflowMedia(run: TaskState) {
  const outputs = run.outputs || {};
  const plan = (outputs.comic_drama || {}) as Record<string, unknown>;
  const contentPost = (outputs.content_post || {}) as Record<string, unknown>;
  const contentImage = run.workflow_code === "content_image_post" || run.inputs?.creative_scene === "content_image_post" || Boolean(outputs.content_post);
  const contentImages = Array.from(new Set([
    ...mediaURLs(contentPost.image_urls, "image_url"),
    ...mediaURLs(contentPost.cards, "image_url"),
  ]));
  const genericImages = Array.from(new Set(outputMediaURLs(outputs, "image")));
  const genericVideos = Array.from(new Set(outputMediaURLs(outputs, "video")));
  const genericAudios = Array.from(new Set(outputMediaURLs(outputs, "audio")));
  const composedVideos = Array.from(new Set(mediaURLs(outputs.final_video_url || plan.final_video_url, "video_url")));
  return {
    images: contentImage ? contentImages : composedVideos.length ? [] : genericImages,
    videos: composedVideos.length ? composedVideos : genericVideos,
    audios: composedVideos.length ? [] : genericAudios,
  };
}

export function workflowOutputIssue(run: TaskState): string {
  if (run.status !== "succeeded") return "";
  const expected = String(run.inputs?._agent_expected_output || "").toLowerCase();
  const media = finalWorkflowMedia(run);
  if (expected === "image" && !media.images.length) return "未返回预期图片，请检查任务记录或重新规划";
  if (expected === "video" && !media.videos.length) return "未返回预期视频，请检查任务记录或重新规划";
  if (["audio", "speech", "music"].includes(expected) && !media.audios.length) return "未返回预期音频，请检查任务记录或重新规划";
  return "";
}

export function workflowSuccessMessage(run: TaskState): WorkflowMessage | null {
  const media = finalWorkflowMedia(run);
  if (!run.public_id || run.status !== "succeeded" || (!media.videos.length && !media.images.length && !media.audios.length)) return null;
  const contentPost = (run.outputs?.content_post || {}) as Record<string, unknown>;
  const contentImage = run.workflow_code === "content_image_post" || run.inputs?.creative_scene === "content_image_post" || Boolean(run.outputs?.content_post);
  const copy = contentImage
    ? [contentPost.title, contentPost.hook, contentPost.body, Array.isArray(contentPost.hashtags) ? contentPost.hashtags.join(" ") : ""].filter(Boolean).join("\n\n")
    : media.videos.length ? "视频生成完成。" : media.images.length ? "图片生成完成。" : media.audios.length ? "音频生成完成。" : "工作流执行完成。";
  return { role: "assistant", content: copy || "工作流执行完成。", resultRunId: run.public_id, ...media };
}

// Keep each run's materials in its original message; publish its final only once.
export function updateWorkflowMessages(messages: WorkflowMessage[], run: TaskState): WorkflowMessage[] {
  if (!run.public_id) return messages;
  const found = messages.some((message) => message.workflow?.public_id === run.public_id);
  const next = messages.map((message) => message.workflow?.public_id === run.public_id ? { ...message, workflow: run } : message);
  if (!found) next.push({ role: "assistant", content: "", workflow: run });
  const result = workflowSuccessMessage(run);
  if (result && !next.some((message) => message.resultRunId === run.public_id)) next.push(result);
  return next;
}
