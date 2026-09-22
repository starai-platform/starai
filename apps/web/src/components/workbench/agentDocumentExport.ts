import { apiBlob } from "@/lib/api";

// Only the current user request enables exports, never an attachment, model
// reply or earlier request in the conversation.
export function requestsAgentDocument(text: string): boolean {
  const document = /文档|文件|\b(?:word|pdf|docx)\b/i;
  const create = /(?:生成|创建|制作|做成|做一份|做一个|写成|撰写|编写|写一份|整理成|导出|转换成|转换为|转成|转为|保存为|另存为|输出为|下载|提供|给我|我要|我需要|需要一|换成).{0,60}(?:文档|文件|\b(?:word|pdf|docx)\b)|(?:\b(?:word|pdf|docx)\b|文档|文件).{0,20}(?:生成|导出|下载)(?:一下|一份|给我|出来|吧|$)/i;
  const negative = /(?:不要|不用|无需|不需要|不必|别|取消|暂不).{0,25}(?:生成|制作|做成|导出|下载|文档|文件|word|pdf|docx)|(?:只|仅)(?:要|需|输出|显示|展示|给我).{0,8}(?:正文|文字|文本|回答)/i;
  const question = /如何|怎么|怎样|为什么|什么是|(?:有什么|有何)区别|会不会|是否|(?:解释|介绍).{0,30}(?:生成|导出|下载)|下载不了|打不开|生成失败|导出失败|需要.{0,12}(?:配置|安装)|支持吗|能不能生成|能否生成|(?:能|可以|支持)生成.{0,12}(?:吗|么)/;
  let requested = false;
  const request = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, "").replace(/`[^`]*`|[“「『][^”」』]*[”」』]/g, "");
  for (const line of request.split(/[\n。！？!?；;，,]/)) {
    if (line.trimStart().startsWith(">")) continue;
    if (negative.test(line)) { requested = false; continue; }
    if (document.test(line) && create.test(line) && !question.test(line)) requested = true;
  }
  return requested;
}

export async function downloadAgentDocument(content: string, format: "docx" | "pdf") {
  let blob = await apiBlob("/api/creative-agent/export-document", {
    method: "POST",
    headers: { Accept: "application/octet-stream" },
    body: JSON.stringify({ content, format }),
  });
  // A rolling deployment may still route to an older API returning JSON.
  if (blob.type.includes("application/json")) {
    const response = JSON.parse(await blob.text());
    if (response.code !== 0 || !response.data?.data_base64) throw new Error(response.message || "文件导出失败");
    const result = response.data;
    blob = new Blob([Uint8Array.from(atob(result.data_base64), (char) => char.charCodeAt(0))], { type: result.mime_type });
  }
  const expectedType = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (blob.type !== expectedType || blob.size === 0) throw new Error("未收到有效的文档，请重试");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `文档.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
