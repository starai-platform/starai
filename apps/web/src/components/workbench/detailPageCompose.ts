/** Optional, local long-image assembly. Original module images remain untouched. */
export async function composeDetailPage(urls: string[]): Promise<Blob> {
  if (urls.length < 2) throw new Error("至少需要两张已完成的详情图");
  const images: ImageBitmap[] = [];
  try {
    for (const url of urls) {
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) throw new Error("详情图读取失败，请检查图片地址后重试");
      images.push(await createImageBitmap(await response.blob()));
    }
    const width = Math.min(1600, Math.max(...images.map(image => image.width)));
    const heights = images.map(image => Math.round(image.height * width / image.width));
    const overlaps = heights.slice(1).map((height, i) => Math.max(0, Math.min(96, height - 1, heights[i] - 1, Math.max(24, Math.round(Math.min(height, heights[i]) * 0.06)))));
    const height = heights.reduce((sum, item) => sum + item, 0) - overlaps.reduce((sum, item) => sum + item, 0);
    if (width * height > 80_000_000) throw new Error("详情长图尺寸过大，请减少模块后再合成");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器暂不支持图片合成");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    let y = 0;
    images.forEach((image, index) => {
      const imageHeight = heights[index];
      const overlap = index === 0 ? 0 : overlaps[index - 1];
      y -= overlap;
      if (overlap) {
        // Feather only the join. Both full-resolution modules stay available separately.
        for (let row = 0; row < overlap; row++) {
          ctx.globalAlpha = (row + 1) / overlap;
          ctx.drawImage(image, 0, row * image.height / imageHeight, image.width, image.height / imageHeight, 0, y + row, width, 1);
        }
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(image, 0, overlap * image.height / imageHeight, image.width, image.height * (imageHeight - overlap) / imageHeight, 0, y + overlap, width, imageHeight - overlap);
      y += imageHeight;
    });
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("长图导出失败，请稍后重试")), "image/jpeg", 0.92));
  } finally {
    images.forEach(image => image.close());
  }
}
