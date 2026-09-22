export function canvasImageReferenceLimit(model: { runtime_rule?: Record<string, any>; default_params?: Record<string, any> }) {
  const raw = model.runtime_rule?.image?.max_reference_images ?? model.default_params?.max_reference_images ?? 4;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(20, Math.trunc(value))) : 4;
}

export function referenceSheetLayout(count: number) {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cell = Math.min(768, Math.floor(2048 / Math.max(columns, rows)));
  return { columns, rows, cell, width: columns * cell, height: rows * cell };
}

export function canvasReferenceImageURL(url: string, origin: string) {
  const source = new URL(url, origin);
  // Reuse Next's existing image loader so remote storage without CORS headers
  // can be drawn safely on a same-origin canvas.
  return /^https?:$/.test(source.protocol) && source.origin !== origin
    ? `/_next/image?url=${encodeURIComponent(source.href)}&w=2048&q=75` : url;
}

export async function canvasVisionImages(urls: string[]): Promise<string[]> {
  const images: string[] = [];
  for (const url of urls) {
    if (url.startsWith("data:image/")) { images.push(url); continue; }
    let response: Response | undefined;
    const proxy = canvasReferenceImageURL(url, window.location.origin);
    const sources = [...new Set([url, proxy])];
    for (let attempt = 0; attempt < 2 && !response?.ok; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 1000));
      for (const source of sources) {
        try { response = await fetch(source, { signal: AbortSignal.timeout(15000), cache: "no-store" }); }
        catch { continue; }
        if (response.ok) break;
      }
    }
    if (!response?.ok) throw new Error(`第 ${images.length + 1} 张验收图片读取失败（${response?.status || "网络或跨域错误"}），图片已生成，无需重新生图`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size > 16 * 1024 * 1024) throw new Error("验收图片格式不支持或超过 16MB");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    images.push(`data:${blob.type};base64,${btoa(binary)}`);
  }
  return images;
}

// A single reference image can retain every asset, without silently dropping
// identities or switching to a different (possibly more expensive) model.
export async function createCanvasReferenceSheet(urls: string[]): Promise<File> {
  if (!urls.length || urls.length > 20) throw new Error("参考版需要 1～20 张图片");
  const sources = await canvasVisionImages(urls);
  const { columns, cell, width, height } = referenceSheetLayout(urls.length);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建参考版，请重新打开页面后重试");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
  for (let index = 0; index < urls.length; index++) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { img.onload = img.onerror = null; reject(new Error(`第 ${index + 1} 张定稿图读取超时`)); }, 30000);
        img.onload = () => { clearTimeout(timer); resolve(); };
        img.onerror = () => { clearTimeout(timer); reject(new Error(`第 ${index + 1} 张定稿图无法读取，请检查图片地址或跨域配置`)); };
        img.src = sources[index];
      });
      const x = index % columns * cell, y = Math.floor(index / columns) * cell;
      const scale = Math.min((cell - 16) / img.naturalWidth, (cell - 48) / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      ctx.drawImage(img, x + (cell - w) / 2, y + 32 + (cell - 32 - h) / 2, w, h);
      ctx.fillStyle = "#111827"; ctx.font = "bold 24px sans-serif";
      ctx.fillText(String(index + 1), x + 12, y + 26);
    } finally { img.onload = img.onerror = null; img.src = ""; }
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("参考版导出失败")), "image/jpeg", 0.92));
  return new File([blob], "workflow-reference-sheet.jpg", { type: "image/jpeg" });
}

export function referenceSheetPrompt(prompt: string, count: number) {
  return prompt.replace(/参考图\s*(\d+)/g, "参考版第$1格")
    + `\n输入图片是包含 ${count} 格的资产参考版，格内数字对应上述资产绑定。只借鉴各格的身份、外观和物体特征，生成当前分镜的一幅完整画面；禁止输出拼图、分格、编号或参考版边框。`;
}
