export type DetailTextLayer = {
  text: string;
  x: number;
  y: number;
  width: number;
  font_size: number;
  color: string;
  align?: "left" | "center" | "right";
  weight?: "normal" | "bold";
  background?: string;
};

const hex = /^#[0-9a-fA-F]{6}$/;
const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeDetailTextLayers(value: unknown): DetailTextLayer[] {
  if (!Array.isArray(value) || value.length > 24) throw new Error("文字图层格式无效或数量过多");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("文字图层格式无效");
    const raw = item as Record<string, unknown>;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (Array.from(text).length > 1000) throw new Error("单个文字图层过长");
    const x = clamp(raw.x, 0.08, 0, 0.95);
    const y = clamp(raw.y, 0.7, 0, 0.95);
    const width = clamp(raw.width, 0.84, 0.04, 1 - x);
    const font_size = clamp(raw.font_size, 0.045, 0.012, 0.18);
    const layer: DetailTextLayer = {
      text, x, y, width, font_size,
      color: typeof raw.color === "string" && hex.test(raw.color) ? raw.color : "#FFFFFF",
      align: raw.align === "center" || raw.align === "right" ? raw.align : "left",
      weight: raw.weight === "bold" ? "bold" : "normal",
      ...(typeof raw.background === "string" && hex.test(raw.background) ? { background: raw.background } : {}),
    };
    return layer;
  }).filter((layer) => layer.text);
}

export function mergeDetailTextLayers(current: DetailTextLayer[], proposed: DetailTextLayer[], mode: "copy" | "layout" | "both"): DetailTextLayer[] {
  if (mode === "both" || current.length === 0) return proposed;
  if (mode === "copy" && proposed.length === 0) return [];
  if (proposed.length !== current.length) throw new Error("AI 改变了图层数量，请改用“文案和排版一起重做”");
  return proposed.map((layer, index) => mode === "copy"
    ? { ...current[index], text: layer.text }
    : { ...layer, text: current[index].text });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of Array.from(paragraph)) {
      if (line && ctx.measureText(line + char).width > width) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}

type TextBox = { x: number; y: number; width: number; height: number };

export function chooseDetailLayerTop(x: number, wantedY: number, width: number, height: number, pad: number, imageWidth: number, imageHeight: number, occupied: TextBox[]): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  const gap = Math.max(4, Math.floor(imageWidth / 200));
  for (let top = 0; top <= imageHeight - height; top++) {
    const left = Math.max(0, x - pad);
    const right = Math.min(imageWidth, x + width + pad);
    const upper = Math.max(0, top - pad);
    const lower = Math.min(imageHeight, top + height + pad);
    const clear = occupied.every(box => right + gap <= box.x || box.x + box.width + gap <= left || lower + gap <= box.y || box.y + box.height + gap <= upper);
    if (clear && Math.abs(top - wantedY) < bestDistance) {
      best = top;
      bestDistance = Math.abs(top - wantedY);
    }
  }
  return best;
}

/** Re-typeset the stored clean source image; no image model call is involved. */
export async function renderDetailTextLayers(sourceURL: string, layers: DetailTextLayer[]): Promise<Blob> {
  const response = await fetch(sourceURL, { mode: "cors" });
  if (!response.ok) throw new Error("详情底图读取失败");
  const image = await createImageBitmap(await response.blob());
  try {
    if (image.width * image.height > 32_000_000) throw new Error("详情底图尺寸过大");
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器暂不支持文字排版");
    ctx.drawImage(image, 0, 0);
    ctx.textBaseline = "top";
	const occupied: TextBox[] = [];
    for (const layer of normalizeDetailTextLayers(layers)) {
      const x = Math.round(layer.x * image.width);
      const y = Math.round(layer.y * image.height);
      const width = Math.min(image.width - x, Math.round(layer.width * image.width));
      let size = Math.max(12, Math.round(layer.font_size * image.width));
      let lines: string[] = [];
      do {
        ctx.font = `${layer.weight === "bold" ? "700" : "400"} ${size}px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
        lines = wrapText(ctx, layer.text, width);
        if (lines.length * size * 1.3 <= image.height) break;
        size = Math.floor(size * 0.9);
      } while (size >= 12);
      if (size < 12) throw new Error("文字超出图片，请调整位置或字号");
      const lineHeight = Math.round(size * 1.3);
      const pad = layer.background ? Math.max(8, Math.round(image.width * 0.012)) : 0;
      const top = chooseDetailLayerTop(x, Math.min(y, image.height - lines.length * lineHeight), width, lines.length * lineHeight, pad, image.width, image.height, occupied);
      if (top === null) throw new Error("文字图层空间不足，请调整排版");
      occupied.push({ x: Math.max(0, x - pad), y: Math.max(0, top - pad), width: Math.min(image.width, x + width + pad) - Math.max(0, x - pad), height: Math.min(image.height, top + lines.length * lineHeight + pad) - Math.max(0, top - pad) });
      const lineXs = lines.map(line => x + (layer.align === "center" ? (width - ctx.measureText(line).width) / 2 : layer.align === "right" ? width - ctx.measureText(line).width : 0));
      if (layer.background) {
        const left = Math.max(0, Math.min(...lineXs) - pad);
        const right = Math.min(image.width, Math.max(...lines.map((line, index) => lineXs[index] + ctx.measureText(line).width)) + pad);
        ctx.fillStyle = layer.background + "5E";
        ctx.beginPath();
        ctx.roundRect(left, Math.max(0, top - pad), right - left, Math.min(image.height - top + pad, lines.length * lineHeight + pad * 2), Math.max(4, image.width / 100));
        ctx.fill();
      }
      ctx.fillStyle = layer.color;
	  ctx.globalAlpha = 235 / 255;
      lines.forEach((line, index) => {
        ctx.fillText(line, lineXs[index], top + index * lineHeight);
      });
	  ctx.globalAlpha = 1;
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("详情图导出失败")), "image/jpeg", 0.92));
  } finally {
    image.close();
  }
}
