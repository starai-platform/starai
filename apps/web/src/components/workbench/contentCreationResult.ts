function textValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(" ");
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function publishSource(raw: string) {
  const source = raw.trim();
  if (!source) return "";

  const unfenced = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const parsed = JSON.parse(unfenced) as Record<string, unknown>;
    const post = (parsed.content_post && typeof parsed.content_post === "object"
      ? parsed.content_post
      : parsed) as Record<string, unknown>;
    const sections = [
      textValue(post.title ?? (Array.isArray(post.titles) ? post.titles[0] : "")),
      textValue(post.hook),
      textValue(post.body ?? post.body_markdown ?? post.content),
      textValue(post.cta),
      textValue(post.hashtags ?? post.tags),
    ].filter(Boolean);
    if (sections.length) return sections.join("\n\n");
  } catch {
    // Plain text and Markdown are the normal canvas output.
  }

  return source.split(/\n\s*[-*_#\s]*(?:配图(?:规划|方案|提示词)|image plan|visual plan)[-*_:#：\s]*(?:\n|$)/i, 1)[0].trim();
}

export function contentImageMarkersValid(raw: string, count: number): boolean {
  if (!Number.isInteger(count) || count < 1) return false;
  const markers = [...publishSource(raw).matchAll(/(?:【配图\s*(\d+)】|\[Image\s+(\d+)\])/gi)].map(match => Number(match[1] || match[2]));
  return markers.length === count && markers.every((value, index) => value === index + 1);
}

function cleanMarkdown(value: string) {
  return value
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+]\s+/, "• ")
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, "$1$2")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1（$2）")
    .trim();
}

function imageMarker(value: string) {
  const match = value.trim().match(/^(?:【|\[)?(?:配图|image)\s*(\d+)(?:】|])?$/i);
  return match ? Number(match[1]) : 0;
}

function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

export function socialPublishText(raw: string) {
  return publishSource(raw)
    .split(/\n\s*\n/)
    .map((section) => section
      .split("\n")
      .map((line) => cleanMarkdown(line))
      .filter((line) => line && !imageMarker(line) && !/^(?:正文|body)\s*[:：]?$/i.test(line))
      .join("\n"))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function socialPublishHTML(raw: string, imageURLs: string[]) {
  const source = publishSource(raw);
  if (!source && imageURLs.length === 0) return "";

  type Block = { kind: "title" | "text" | "image"; value: string; imageIndex?: number };
  const blocks: Block[] = [];
  let hasImageMarkers = false;
  for (const rawLine of source.split(/\n+/).map((line) => line.trim()).filter(Boolean)) {
    const parts = rawLine.split(/((?:【|\[)(?:配图|image)\s*\d+(?:】|]))/gi).filter(Boolean);
    for (const part of parts) {
      const marker = imageMarker(part);
      if (marker) {
        hasImageMarkers = true;
        if (imageURLs[marker - 1]) blocks.push({ kind: "image", value: imageURLs[marker - 1], imageIndex: marker });
        continue;
      }
      const text = cleanMarkdown(part).replace(/^(?:正文|body)\s*[:：]\s*/i, "").trim();
      if (!text) continue;
      const isTitle = blocks.length === 0 || /^(?:标题|title)\s*[:：]/i.test(text);
      blocks.push({ kind: isTitle ? "title" : "text", value: text.replace(/^(?:标题|title)\s*[:：]\s*/i, "") });
    }
  }

  if (!hasImageMarkers && imageURLs.length > 0) {
    const textIndexes = blocks.map((block, index) => block.kind === "text" ? index : -1).filter((index) => index >= 0);
    const insertions = new Map<number, Block[]>();
    imageURLs.forEach((url, index) => {
      const slot = textIndexes.length
        ? textIndexes[Math.min(textIndexes.length - 1, Math.max(0, Math.ceil(((index + 1) * textIndexes.length) / imageURLs.length) - 1))]
        : blocks.length - 1;
      insertions.set(slot, [...(insertions.get(slot) || []), { kind: "image", value: url, imageIndex: index + 1 }]);
    });
    const distributed: Block[] = [];
    blocks.forEach((block, index) => {
      distributed.push(block, ...(insertions.get(index) || []));
    });
    if (blocks.length === 0) distributed.push(...(insertions.get(-1) || []));
    blocks.splice(0, blocks.length, ...distributed);
  } else if (hasImageMarkers) {
    const used = new Set(blocks.filter((block) => block.kind === "image").map((block) => block.imageIndex));
    imageURLs.forEach((url, index) => {
      if (!used.has(index + 1)) blocks.push({ kind: "image", value: url, imageIndex: index + 1 });
    });
  }

  const body = blocks.map((block) => {
    if (block.kind === "title") return `<h1 style="margin:0 0 24px;font-size:24px;line-height:1.5;font-weight:700;color:#111827;">${escapeHTML(block.value)}</h1>`;
    if (block.kind === "image") return `<p style="margin:24px 0;text-align:center;"><img src="${escapeHTML(block.value)}" alt="配图 ${block.imageIndex || ""}" style="display:block;width:100%;max-width:100%;height:auto;margin:0 auto;border-radius:8px;" /></p>`;
    return `<p style="margin:0 0 16px;font-size:16px;line-height:1.9;color:#374151;white-space:pre-wrap;">${escapeHTML(block.value)}</p>`;
  }).join("");
  return `<article style="max-width:100%;word-break:break-word;">${body}</article>`;
}
