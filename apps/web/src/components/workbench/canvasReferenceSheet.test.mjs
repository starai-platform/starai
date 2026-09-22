import assert from "node:assert/strict";
import test from "node:test";
import { canvasVisionImages, canvasReferenceImageURL, canvasImageReferenceLimit, createCanvasReferenceSheet, referenceSheetLayout, referenceSheetPrompt } from "./canvasReferenceSheet.ts";
import { canvasMediaAwaitingReview } from "./videoCreationWorkflow.ts";
import { comicAssetProgress } from "./comicProgress.ts";
import { canvasAgentState } from "./canvasAgentExecution.ts";

test("vision receives image bytes for local uploads and remote storage, in comparison order", async t => {
  const oldWindow = globalThis.window;
  globalThis.window = { location: { origin: "http://localhost:3000" } };
  const requested = [];
  t.mock.method(globalThis, "fetch", async url => {
    requested.push(url);
    if (url.startsWith("https://")) throw new TypeError("CORS");
    return new Response(new Blob([url.startsWith("http://localhost:9000") ? "reference" : "candidate"], { type: "image/jpeg" }));
  });
  try {
    const images = await canvasVisionImages(["http://localhost:9000/sheet.jpg", "https://storage.example.com/result.jpg", "data:image/png;base64,YQ=="]);
    assert.deepEqual(images, ["data:image/jpeg;base64,cmVmZXJlbmNl", "data:image/jpeg;base64,Y2FuZGlkYXRl", "data:image/png;base64,YQ=="]);
    assert.equal(requested.length, 3);
    assert.match(requested[2], /^\/_next\/image\?/);
    t.mock.method(globalThis, "fetch", async () => new Response("not an image"));
    await assert.rejects(canvasVisionImages(["/broken.jpg"]), /格式不支持/);
  } finally { globalThis.window = oldWindow; }
});

test("transient image loader 500 retries the read and keeps reference order", async t => {
  const oldWindow = globalThis.window;
  globalThis.window = { location: { origin: "http://localhost:3000" } };
  t.mock.method(globalThis, "setTimeout", fn => { fn(); return 0; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? new Response("failed", { status: 500 }) : new Response(new Blob(["ok"], { type: "image/png" })));
  try {
    assert.deepEqual(await canvasVisionImages(["/image.png"]), ["data:image/png;base64,b2s="]);
    assert.equal(calls, 2);
    t.mock.method(globalThis, "fetch", async () => new Response("failed", { status: 500 }));
    await assert.rejects(canvasVisionImages(["/image.png"]), /第 1 张.*500.*无需重新生图/);
  } finally { globalThis.window = oldWindow; }
});

test("a review service failure reuses generated media only while its inputs match", () => {
  const data = { outputUrl: "saved.jpg", taskNo: "paid-task", qualityStatus: "check_failed", activeRunSignature: "original", dirty: true, status: "failed" };
  assert.equal(canvasMediaAwaitingReview(data, "original"), true);
  assert.equal(canvasMediaAwaitingReview({ ...data, status: "idle" }, "original"), true);
  assert.equal(canvasMediaAwaitingReview(data, "changed-prompt"), false);
  assert.equal(canvasMediaAwaitingReview({ ...data, qualityStatus: "needs_review" }, "original"), true);
  assert.equal(canvasMediaAwaitingReview({ ...data, outputUrl: "" }, "original"), false);
});

test("single-reference models retain all three workflow assets in a numbered sheet", async t => {
  assert.equal(canvasImageReferenceLimit({ runtime_rule: { image: { max_reference_images: 1 } }, default_params: { max_reference_images: 4 } }), 1);
  assert.equal(canvasImageReferenceLimit({}), 4);
  assert.equal(canvasImageReferenceLimit({ default_params: { max_reference_images: 0 } }), 0);
  const loaded = [], drawn = [], labels = [];
  t.mock.method(globalThis, "fetch", async url => new Response(new Blob([url], { type: "image/jpeg" })));
  const context = { fillRect() {}, drawImage(img, ...rect) { drawn.push([img.src, ...rect]); }, fillText(label) { labels.push(label); } };
  const canvas = { getContext() { return context; }, toBlob(callback) { callback(new Blob(["jpeg"], { type: "image/jpeg" })); } };
  t.mock.method(globalThis, "setTimeout", () => 0);
  t.mock.method(globalThis, "clearTimeout", () => {});
  const oldImage = globalThis.Image, oldDocument = globalThis.document, oldWindow = globalThis.window;
  globalThis.window = { location: { origin: "http://localhost:3000" } };
  globalThis.Image = class {
    naturalWidth = 1024; naturalHeight = 1536;
    set src(url) { this.url = url; if (url) { loaded.push(url); queueMicrotask(() => this.onload?.()); } }
    get src() { return this.url; }
  };
  globalThis.document = { createElement: () => canvas };
  try {
    const file = await createCanvasReferenceSheet(["character.jpg", "phone.jpg", "ui.jpg"]);
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(loaded, ["character.jpg", "phone.jpg", "ui.jpg"].map(url => `data:image/jpeg;base64,${Buffer.from(url).toString("base64")}`));
    assert.deepEqual(drawn.map(item => item[0]), loaded);
    assert.deepEqual(labels, ["1", "2", "3"]);
    assert.equal(canvas.width, 1536);
    assert.equal(canvas.height, 1536);
    assert.match(canvasReferenceImageURL("https://storage.example.com/image.png", "http://localhost:3000"), /^\/_next\/image\?url=https%3A/);
    assert.ok(drawn.every(([, x, y, width, height]) => x >= 0 && y >= 0 && x + width <= canvas.width && y + height <= canvas.height));
    for (const n of [1, 3, 9, 20]) {
      const layout = referenceSheetLayout(n);
      assert.ok(layout.columns * layout.rows >= n && layout.width <= 2048 && layout.height <= 2048);
    }
    assert.match(referenceSheetPrompt("参考图1=小王；参考图2=手机；参考图3=界面", 3), /参考版第1格=小王；参考版第2格=手机；参考版第3格=界面/);
    await assert.rejects(createCanvasReferenceSheet([]), /1～20/);
  } finally { globalThis.Image = oldImage; globalThis.document = oldDocument; globalThis.window = oldWindow; }
});

test("comic progress locates legacy asset timeout before keyframes and counts reused assets", () => {
  const output = { current_step: "storyboard_confirm", consistency_assets: [
    { status: "failed", error_message: "等待上游响应超时" },
    { metadata: { reference_urls: ["saved.jpg"] } },
  ], comic_drama: { storyboards: [{ character_codes: ["A", "B"], prop_codes: ["P"], location_code: "L" }] } };
  const progress = comicAssetProgress(output, "资产定稿失败：所有可用线路均调用失败");
  assert.equal(progress.step, "consistency_assets");
  assert.equal(progress.total, 4);
  assert.equal(progress.completed, 1);
  assert.equal(progress.failed.length, 1);
  assert.equal(comicAssetProgress(output).step, "storyboard_confirm");
});

test("agent canvas distinguishes upstream queueing from active generation", () => {
  const edges = [];
  const queued = canvasAgentState([{ id: "image", type: "generator", data: { status: "pending", label: "生成图片", progress: 6 } }], edges, true);
  assert.match(queued.content, /等待上游接单/);
  const running = canvasAgentState([{ id: "video", type: "generator", data: { status: "running", label: "生成视频", progress: 48, progressStage: "canvas.progress.generating" } }], edges, true);
  assert.match(running.content, /上游正在生成视频 · 上游报告 48%/);
});
