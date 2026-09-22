import assert from "node:assert/strict";
import test from "node:test";
import { canvasAgentResult, canvasAgentState } from "./canvasAgentExecution.ts";

const node = (id, data, type = "generator") => ({ id, type, data: { status: "succeeded", ...data } });

test("document progress counts finished pages instead of internal steps", () => {
  const nodes = [node("copy1", { contentRole: "page_copy", outputText: "编排完成" }), node("image1", { contentRole: "publish_image", params: { content_layout: "document_pages" }, outputKind: "image", outputUrl: "1.png" }), node("copy2", { contentRole: "page_copy", status: "running" }), node("image2", { contentRole: "publish_image", params: { content_layout: "document_pages" }, status: "idle" })];
  const edges = [{ source: "copy1", target: "image1" }, { source: "copy2", target: "image2" }];
  assert.match(canvasAgentState(nodes, edges, true).content, /共 2 页图片，已完成 1 页/);
  nodes[2].data.status = "failed";
  assert.match(canvasAgentState(nodes, edges, false).content, /成功页会保留/);
  nodes[2].data.status = "succeeded";
  Object.assign(nodes[3].data, { status: "succeeded", outputKind: "image", outputUrl: "2.png" });
  assert.match(canvasAgentState(nodes, edges, false).content, /共 2 页图片，已全部完成/);
  assert.deepEqual(canvasAgentState(nodes, edges, false).media.images, ["1.png", "2.png"]);
});

test("Agent gets final canvas media, excluding references and intermediate frames", () => {
  const nodes = [node("reference", { assetUrl: "ref.png" }, "imageInput"), node("frame", { outputKind: "image", outputUrl: "frame.png" }), node("video", { outputKind: "video", outputUrl: "final.mp4" }, "compositor")];
  const edges = [{ source: "reference", target: "frame" }, { source: "frame", target: "video" }];
  assert.deepEqual(canvasAgentResult(nodes, edges), { images: [], videos: ["final.mp4"], audios: [], text: "" });
  assert.equal(canvasAgentState(nodes, edges, false).status, "succeeded");
  assert.equal(canvasAgentState(nodes, edges, true).status, "succeeded");
  assert.deepEqual(canvasAgentResult(JSON.parse(JSON.stringify(nodes)), edges), canvasAgentResult(nodes, edges));
});

test("partial, failed and dirty results never announce success; review stays in chat", () => {
  const nodes = [node("script", { mediaKind: "text", outputText: "待确认分镜" }), node("image", { status: "idle", outputKind: "image" })];
  const edges = [{ source: "script", target: "image" }];
  assert.equal(canvasAgentResult(nodes, edges), null);
  assert.equal(canvasAgentState(nodes, edges, false).review, "待确认分镜");
  nodes[1].data.status = "failed";
  nodes[1].data.error = "上游超时";
  assert.match(canvasAgentState(nodes, edges, false).content, /上游超时/);
  nodes[1].data.status = "succeeded";
  nodes[1].data.outputUrl = "final.png";
  nodes[1].data.dirty = true;
  assert.equal(canvasAgentResult(nodes, edges), null);
});

test("content workflow returns publishable copy and all final images; text-only results work", () => {
  const nodes = [node("copy", { contentRole: "publish_copy", mediaKind: "text", outputText: "标题与正文" }), node("cards", { outputKind: "image", outputUrls: ["a.png", "b.png", "a.png"] }), node("display", {}, "contentResult")];
  const edges = [{ source: "copy", target: "cards" }, { source: "cards", target: "display" }];
  assert.deepEqual(canvasAgentResult(nodes, edges), { images: ["a.png", "b.png"], videos: [], audios: [], text: "标题与正文" });
  assert.equal(canvasAgentState(nodes.slice(0, 1), [], false).content, "标题与正文");
});

test("speech and music return every audio result and survive history restore", () => {
  for (const audioMode of ["speech", "music"]) {
    const nodes = [node("input", { referenceAudioUrls: ["ref.wav"] }, "textInput"), node("audio", { audioMode, outputKind: "audio", outputUrls: ["first.mp3", "second.mp3"] })];
    const edges = [{ source: "input", target: "audio" }];
    const state = canvasAgentState(JSON.parse(JSON.stringify(nodes)), edges, false);
    assert.equal(state.status, "succeeded");
    assert.deepEqual(state.media.audios, ["first.mp3", "second.mp3"]);
    assert.deepEqual(state.media.images, []);
  }
});

test("video and audio steps can be reviewed without becoming final results", () => {
  const nodes = [node("video", { outputKind: "video", outputUrl: "segment.mp4" }), node("music", { outputKind: "audio", outputUrl: "music.mp3" }), node("final", { status: "idle" }, "compositor")];
  const edges = [{ source: "video", target: "final" }, { source: "music", target: "final" }];
  const state = canvasAgentState(nodes, edges, false);
  assert.equal(state.status, "waiting_confirm");
  assert.deepEqual(state.media.videos, ["segment.mp4"]);
  assert.deepEqual(state.media.audios, ["music.mp3"]);
  assert.equal(canvasAgentResult(nodes, edges), null);
});


test("paused workflow is distinct from an upstream job still processing", () => {
  const nodes = [node("video", { status: "running", mediaKind: "video", progress: 0 }), node("final", { status: "blocked" })];
  const state = canvasAgentState(nodes, [], false, "", true);
  assert.equal(state.status, "paused");
  assert.equal(state.canContinue, true);
  assert.match(state.content, /上游任务可能仍在处理/);
  assert.equal(canvasAgentState(nodes, [], true, "", true).canContinue, false);
  assert.doesNotMatch(canvasAgentState(nodes, [], false).content, /92%/);
});

test("automatic history resumes unfinished work without asking for step approval", () => {
  const nodes = [node("video1", { outputKind: "video", outputUrl: "clip1.mp4" }), node("video2", { status: "idle" })];
  const edges = [{ source: "video1", target: "video2" }];
  const state = canvasAgentState(nodes, edges, false, "", false, "auto");
  assert.equal(state.status, "paused");
  assert.equal(state.canContinue, true);
  assert.match(state.content, /无需逐步确认/);
  assert.equal(canvasAgentState(nodes, edges, false, "", false, "step").status, "waiting_confirm");
});
