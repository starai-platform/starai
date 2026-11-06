import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_VIDEO_MEDIA, buildVideoTaskParams, supportsVideoPromptReferences, videoPromptReferences, videoReferenceToken, reconcileVideoReferences, invalidVideoReferences, videoMentionQuery } from "./videoModel.ts";

const item = url => ({ url, name: url });
const rule = adapter => ({ upstream: { adapter }, template_key: "zex_seedance_2_0", video: { upload_profile: adapter === "zex_video" ? "gateway_reference" : "seedance_2" } });
const media = { ...EMPTY_VIDEO_MEDIA, first_frame: item("first"), last_frame: item("last"), reference_images: [item("a"), item("b"), item("c")], reference_videos: [item("v")], reference_audios: [item("s")] };

test("Omni submits only active image slots and clears imported gateway aliases", () => {
  const stale = { reference_images: ["old"], first_frame: "old", videos: ["old"], images: ["old"], audios: ["old"], input_reference: ["old"], first_last_frame: true };
  for (const adapter of ["omni_reference_v1", "octopus_sd_mini_v1"]) {
    const runtime = { upstream: { adapter }, video: { upload_profile: "omni_reference" } };
    assert.deepEqual(buildVideoTaskParams({ ...stale, generation_mode: "text" }, media, runtime), { generation_mode: "text" });
    assert.deepEqual(buildVideoTaskParams({ ...stale, generation_mode: "reference" }, media, runtime), { generation_mode: "reference", reference_images: ["a", "b", "c"] });
  }
  const frames = buildVideoTaskParams(stale, media, { upstream: { adapter: "omni_frame_pair_v1" }, video: { upload_profile: "veo_frame_pair" } });
  assert.deepEqual(frames, { first_frame: "first", last_frame: "last" });
});

test("verified Seedance/MiniMax channels expose only submitted media and clear hidden stale params", () => {
  for (const adapter of ["zex_video", "volcengine_seedance_2", "topenrouter_seedance_2", "minimax_h3_v2"]) {
    const runtime = rule(adapter);
    if (adapter === "minimax_h3_v2") runtime.video.upload_profile = "minimax_h3";
    assert.equal(supportsVideoPromptReferences({ runtime_rule: runtime }), true);
    const references = videoPromptReferences({ generation_mode: "image_video_audio" }, media, runtime);
    assert.deepEqual(references.map(item => [item.kind, item.index, item.url]), [["image", 1, "a"], ["image", 2, "b"], ["image", 3, "c"], ["video", 1, "v"], ["audio", 1, "s"]]);
    assert.deepEqual(videoPromptReferences({ generation_mode: "text" }, media, runtime), []);
    assert.deepEqual(videoPromptReferences({ generation_mode: "first_last" }, media, runtime).map(item => item.url), ["first", "last"]);
    const params = buildVideoTaskParams({ generation_mode: "text", reference_images: ["stale"], first_frame: "old" }, media, runtime);
    assert.equal(params.reference_images, undefined);
    assert.equal(params.first_frame, undefined);
  }
  assert.equal(supportsVideoPromptReferences({ code: "grok-imagine-video-1.5", runtime_rule: { upstream: { adapter: "zex_video" } } }), false);
  assert.equal(supportsVideoPromptReferences({ code: "seedance-2.0", runtime_rule: { upstream: { adapter: "unknown" } } }), false);
});

test("mention identity survives deleting/reordering media, and deleted mentions cannot silently switch assets", () => {
  const before = videoPromptReferences({ generation_mode: "image_video_audio" }, media, rule("zex_video"));
  const after = videoPromptReferences({ generation_mode: "image_video_audio" }, { ...media, reference_images: [item("c"), item("b")] }, rule("zex_video"));
  const prompt = "用@图片2 的角色，参考@image3 和@视频1，配乐@音频1；删除的是@图片1";
  const rewritten = reconcileVideoReferences(prompt, before, after);
  assert.equal(rewritten, "用@图片2 的角色，参考@image1 和@视频1，配乐@音频1；删除的是@图片?");
  assert.deepEqual(invalidVideoReferences(rewritten, after), ["@图片?"]);
  assert.deepEqual(invalidVideoReferences("@图片0 @image99 x@image4.com @音频2", before), ["@图片0", "@image99", "@音频2"]);
  assert.equal(reconcileVideoReferences("@image1", [{ kind: "image", index: 1, url: "signed-old", public_id: "asset" }], [{ kind: "image", index: 2, url: "signed-new", public_id: "asset" }]), "@image2");
});

test("native deduplication and portrait prefix match the upstream content numbering", () => {
  const params = { generation_mode: "image_video", portrait_asset_id: "asset://person", portrait_asset_type: "image" };
  const references = videoPromptReferences(params, { ...media, reference_images: [item("a"), item("a")] }, rule("volcengine_seedance_2"));
  assert.deepEqual(references.map(item => [item.kind, item.index, item.url]), [["image", 1, "asset://person"], ["image", 2, "a"], ["video", 1, "v"]]);
  assert.equal(videoPromptReferences({ generation_mode: "image" }, { ...media, reference_images: [item("a"), item("a")] }, rule("zex_video")).length, 2);
  assert.deepEqual(videoPromptReferences({ generation_mode: "last_frame" }, media, rule("minimax_h3_v2")).map(item => item.url), ["last"]);
});

test("caret query and canonical tokens work across UI languages and mid-prompt insertion", () => {
  assert.deepEqual(videoMentionQuery("开头 @图片 后文", 6), { start: 3, end: 6, query: "图片" });
  assert.equal(videoMentionQuery("没有引用", 4), null);
  assert.equal(videoMentionQuery("@图片1 ", 5), null);
  assert.equal(videoReferenceToken({ kind: "audio", index: 2 }, "zh-CN"), "@音频2");
  assert.equal(videoReferenceToken({ kind: "image", index: 1 }, "ja-JP"), "@image1");
});

test("adjacent references are all checked while email addresses remain plain text", () => {
  const references = videoPromptReferences({ generation_mode: "image" }, media, rule("zex_video"));
  assert.deepEqual(invalidVideoReferences("@图片1@图片99 @image?@audio9 x@image9.com 123@image9.com @image9suffix", references), ["@图片99", "@image?", "@audio9"]);
  assert.equal(reconcileVideoReferences("@图片1@图片2", references, references.slice(1).map((item, i) => ({ ...item, index: i + 1 }))), "@图片?@图片1");
});

test("repeated media retain their occurrence numbers when unrelated parameters change", () => {
  const references = videoPromptReferences({ generation_mode: "image" }, { ...media, reference_images: [item("a"), item("a")] }, rule("zex_video"));
  assert.equal(reconcileVideoReferences("@图片2", references, [...references]), "@图片2");
});
