export type TaskState = { task_no?: string; public_id?: string; workflow_code?: string; type?: string; status: string; progress?: number; current_step?: string; input?: Record<string, unknown>; inputs?: Record<string, unknown>; output?: Record<string, unknown>; outputs?: Record<string, unknown>; media_tasks?: Array<{ task_no?: string; type?: string; status?: string; progress?: number; output?: Record<string, unknown>; error_message?: string }>; node_runs?: Array<{ node_id?: string; name?: string; type?: string; status?: string; duration_ms?: number; error?: string }>; error_message?: string; created_at?: string };

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
  return {
    images: contentImage ? contentImages : [] as string[],
    videos: Array.from(new Set(mediaURLs(outputs.final_video_url || plan.final_video_url, "video_url"))),
    audios: [] as string[],
  };
}

export function workflowSuccessMessage(run: TaskState): WorkflowMessage | null {
  const media = finalWorkflowMedia(run);
  if (!run.public_id || run.status !== "succeeded" || (!media.videos.length && !media.images.length)) return null;
  const contentPost = (run.outputs?.content_post || {}) as Record<string, unknown>;
  const contentImage = run.workflow_code === "content_image_post" || run.inputs?.creative_scene === "content_image_post" || Boolean(run.outputs?.content_post);
  const copy = contentImage
    ? [contentPost.title, contentPost.hook, contentPost.body, Array.isArray(contentPost.hashtags) ? contentPost.hashtags.join(" ") : ""].filter(Boolean).join("\n\n")
    : "您的视频生成成功啦！";
  return { role: "assistant", content: copy || "内容图文已生成。", resultRunId: run.public_id, ...media };
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
