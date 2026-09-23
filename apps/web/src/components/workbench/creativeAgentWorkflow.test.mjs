import assert from "node:assert/strict";
import test from "node:test";
import { workflowMaterials, finalWorkflowMedia, workflowOutputIssue, workflowSuccessMessage, updateWorkflowMessages } from "./creativeAgentWorkflow.ts";

const run = {
  public_id: "workflow-a", status: "succeeded",
  outputs: {
    thumbnail: "cover.jpg", final_video_url: "final.mp4",
    keyframes: [{ image_url: "frame.jpg" }, { image_url: "frame.jpg" }],
    segments: Array.from({ length: 6 }, (_, i) => ({ id: `S${i}`, video_url: `part-${i}.mp4` })),
    narrations: [{ audio_url: "voice.wav" }, { status: "skipped", audio_url: "" }],
  },
};

test("all process materials survive, including segments after the fourth and narration", () => {
  const media = workflowMaterials(run);
  assert.deepEqual(media.images, ["frame.jpg"]);
  assert.equal(media.videos.length, 6);
  assert.deepEqual(media.audios, ["voice.wav"]);
  assert.ok(!media.videos.includes("final.mp4"));
});

test("success message contains only final video, never cover, frames or narration", () => {
  assert.deepEqual(finalWorkflowMedia(run), { images: [], videos: ["final.mp4"], audios: [] });
  const result = workflowSuccessMessage(run);
  assert.equal(result.content, "视频生成完成。");
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.videos, ["final.mp4"]);
  assert.equal(result.workflow, undefined);
});

test("early compose output or failed run cannot announce success", () => {
  for (const status of ["running", "failed", "pending", "waiting_confirm", "canceled", "cancelled"]) {
    assert.equal(workflowSuccessMessage({ ...run, status }), null);
  }
  assert.equal(workflowSuccessMessage({ ...run, outputs: {} }), null);
});

test("polling retains the original material card and adds one separate result", () => {
  const messages = [{ role: "user", content: "做一个长视频" }];
  const running = updateWorkflowMessages(messages, { ...run, status: "running" });
  const done = updateWorkflowMessages(running, run);
  assert.equal(done.length, 3);
  assert.equal(done[1].workflow.status, "succeeded");
  assert.equal(done[2].resultRunId, run.public_id);
  assert.deepEqual(updateWorkflowMessages(done, run), done);
});

test("multiple workflows keep their own material and result messages", () => {
  const first = updateWorkflowMessages([], run);
  const second = updateWorkflowMessages(first, { ...run, public_id: "workflow-b" });
  assert.equal(second.filter((message) => message.workflow).length, 2);
  assert.equal(second.filter((message) => message.resultRunId).length, 2);
  assert.deepEqual(second.slice(0, 2), first);
});

test("history round-trip and retry preserve material cards without premature results", () => {
  const failed = { ...run, status: "failed" };
  const restored = JSON.parse(JSON.stringify(updateWorkflowMessages([], failed)));
  const retried = updateWorkflowMessages(restored, { ...run, status: "pending" });
  assert.equal(retried.length, 1);
  assert.equal(workflowMaterials(retried[0].workflow).videos.length, 6);
  const done = updateWorkflowMessages(retried, run);
  assert.equal(done.length, 2);
  assert.equal(done[0].workflow.public_id, run.public_id);
  assert.deepEqual(done[1].images, []);
});

test("legacy nested history and failed materials remain separated", () => {
  const legacy = { ...run, outputs: { comic_drama: { ...run.outputs, segments: [
    { video_url: "part.mp4" }, { video_url: "bad.mp4", status: "failed" }, { video_url: "final.mp4" },
  ] } } };
  assert.deepEqual(workflowMaterials(legacy).videos, ["part.mp4"]);
  assert.deepEqual(workflowMaterials(legacy).audios, ["voice.wav"]);
  assert.deepEqual(workflowSuccessMessage(legacy).videos, ["final.mp4"]);
});

test("content image workflow returns publishable copy and final card images", () => {
  const contentRun = {
    public_id: "content-a",
    workflow_code: "content_image_post",
    status: "succeeded",
    outputs: {
      content_post: {
        title: "秋季护肤指南",
        hook: "换季别焦虑",
        body: "三步建立稳定的护肤节奏。",
        hashtags: ["#秋季护肤", "#生活方式"],
        cards: [
          { image_url: "cover.png" },
          { image_url: "point.png" },
        ],
      },
      media_tasks: [{ type: "image", status: "succeeded", output: { image_url: "cover.png" } }],
    },
  };
  assert.deepEqual(finalWorkflowMedia(contentRun), { images: ["cover.png", "point.png"], videos: [], audios: [] });
  assert.deepEqual(workflowMaterials(contentRun).images, ["cover.png"]);
  const message = workflowSuccessMessage(contentRun);
  assert.match(message.content, /秋季护肤指南/);
  assert.match(message.content, /#秋季护肤/);
  assert.deepEqual(message.images, ["cover.png", "point.png"]);
});

test("generic workflows surface image and audio outputs without workflow-specific code", () => {
  const generic = {
    public_id: "generic-a", workflow_code: "photo_studio", status: "succeeded",
    outputs: { results: [{ image_url: "portrait.webp" }], voice: { audio_url: "intro.mp3" } },
  };
  assert.deepEqual(finalWorkflowMedia(generic), { images: ["portrait.webp"], videos: [], audios: ["intro.mp3"] });
  const message = workflowSuccessMessage(generic);
  assert.equal(message.content, "图片生成完成。");
});

test("a succeeded media workflow without its expected final output is reported honestly", () => {
  const emptyImage = { public_id: "empty-image", status: "succeeded", inputs: { _agent_expected_output: "image" }, outputs: {} };
  assert.match(workflowOutputIssue(emptyImage), /未返回预期图片/);
  assert.equal(workflowSuccessMessage(emptyImage), null);
  assert.equal(workflowOutputIssue({ ...emptyImage, outputs: { result: { image_url: "done.png" } } }), "");
  assert.equal(workflowOutputIssue({ ...emptyImage, inputs: { _agent_expected_output: "workflow" } }), "");
});
