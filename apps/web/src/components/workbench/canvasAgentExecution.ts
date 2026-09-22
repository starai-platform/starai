type Node = { id: string; type?: string; data: Record<string, any> };
type Edge = { source: string; target: string };
export type CanvasAgentMedia = { images: string[]; videos: string[]; audios: string[]; text?: string };
export type CanvasAgentState = {
  status: "running" | "paused" | "waiting_confirm" | "failed" | "succeeded";
  canContinue?: boolean;
  content: string;
  review?: string;
  media?: CanvasAgentMedia;
};

export function canvasAgentResult(nodes: Node[], edges: Edge[]): CanvasAgentMedia | null {
  const executable = nodes.filter(node => node.type === "generator" || node.type === "compositor");
  if (!executable.length || executable.some(node => node.data.status !== "succeeded" || node.data.dirty)) return null;
  const outputs = executable.filter(node => !edges.some(edge => edge.source === node.id && nodes.some(target => target.id === edge.target && target.type !== "contentResult")));
  const urls = (kind: string): string[] => Array.from(new Set(outputs.filter(node => node.data.outputKind === kind).flatMap(node => node.data.outputUrls?.length ? node.data.outputUrls : node.data.outputUrl ? [node.data.outputUrl] : [])));
  const text = executable.filter(node => node.data.contentRole === "publish_copy" || (outputs.includes(node) && node.data.mediaKind === "text")).map(node => String(node.data.outputText || "")).filter(Boolean).join("\n\n");
  const media = { images: urls("image"), videos: urls("video"), audios: urls("audio"), text };
  return media.images.length || media.videos.length || media.audios.length || text ? media : null;
}

export function canvasAgentState(nodes: Node[], edges: Edge[], running: boolean, notice = "", paused = false, mode = "step"): CanvasAgentState {
  const executable = nodes.filter(node => node.type === "generator" || node.type === "compositor");
  const active = executable.find(node => ["pending", "running"].includes(node.data.status));
  const counts = { done: executable.filter(n => n.data.status === "succeeded" && !n.data.dirty).length, failed: executable.filter(n => n.data.status === "failed").length, blocked: executable.filter(n => n.data.status === "blocked").length };
  const pages = executable.filter(n => n.data.contentRole === "publish_image" && n.data.params?.content_layout === "document_pages");
  const summary = pages.length
    ? `共 ${pages.length} 页图片，已完成 ${pages.filter(n => n.data.status === "succeeded" && !n.data.dirty).length} 页；${counts.failed ? `${counts.failed} 个编排/绘图环节失败，` : ""}成功页会保留。`
    : `已完成 ${counts.done}/${executable.length} 步，失败 ${counts.failed} 步，阻塞 ${counts.blocked} 步。`;
  if (paused && !canvasAgentResult(nodes, edges)) return { status: "paused", canContinue: !running, content: `${running ? "正在暂停并保留当前请求。" : "后续生成已暂停。"}${active ? "已提交的上游任务可能仍在处理，结果会保留；这不表示仍在启动新步骤。" : ""}${summary}继续会先查询原任务，再运行未完成部分。` };
  if ((running || active) && !canvasAgentResult(nodes, edges)) {
    if (!active) return { status: "running", content: summary + (notice || "正在检查已有任务和准备下一步生成…") };
    if (active.data.qualityStatus === "checking") return { status: "running", content: `${active.data.label || "媒体"}已生成，正在视觉验收。${summary}` };
    const progress = Math.max(0, Math.min(99, Number(active.data.progress || 0)));
    const queued = String(active.data.progressStage || "").includes("queued") || active.data.status === "pending";
    return {
      status: "running",
      content: active.data.taskStatusHint ? `${active.data.label || "生成任务"}：${active.data.taskStatusHint}。${summary}` : queued
        ? `${active.data.label || "生成任务"}已提交，正在等待上游接单…${summary}`
        : `上游正在${active.data.label || "生成"}${progress > 0 ? ` · 上游报告 ${progress}%` : "，未提供完成百分比"}。${summary}`,
    };
  }
  const media = canvasAgentResult(nodes, edges);
  if (media) {
    const warnings = executable.filter(n => ["warning", "needs_review", "unverified", "check_failed", "checking"].includes(String(n.data.qualityStatus)));
    const content = pages.length ? `共 ${pages.length} 页图片，已全部完成，按原文顺序展示。` : media.text || (media.videos.length ? "您的视频生成成功啦！" : media.images.length ? "您的图片生成成功啦！" : "您的音频生成成功啦！");
    return { status: "succeeded", content: content + (warnings.length ? `\n其中 ${warnings.length} 个节点有视觉提醒或尚未完成验证，请预览成品并查看节点提醒。` : ""), media };
  }
  const failed = executable.find(node => node.data.status === "failed" || node.data.status === "blocked");
  if (failed || !executable.length) return { status: "failed", content: `${summary}${String(failed?.data.error || notice || "生成暂未完成。")}重试会先核对原任务，保留有效的成功结果。` };
  const completed = executable.filter(node => node.data.status === "succeeded");
  if (mode === "auto") return {
    status: "paused", canContinue: true,
    content: `${summary}${completed.length ? "自动执行尚未完成，继续将复用已有结果并自动执行剩余步骤，无需逐步确认。" : "已准备好，开始后将自动执行全部步骤。"}`,
  };
  const urls = (kind: string): string[] => Array.from(new Set(completed.filter(node => node.data.outputKind === kind).flatMap(node => node.data.outputUrls?.length ? node.data.outputUrls : node.data.outputUrl ? [node.data.outputUrl] : [])));
  return {
    status: "waiting_confirm",
    content: completed.length ? "当前步骤已完成，请确认后继续生成。" : notice || "方案已准备好，可以继续生成。",
    review: completed.map(node => node.data.outputText).filter(Boolean).join("\n\n"),
    media: {
      images: urls("image"), videos: urls("video"), audios: urls("audio"),
    },
  };
}
