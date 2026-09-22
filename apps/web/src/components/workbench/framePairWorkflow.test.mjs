import assert from "node:assert/strict";
import test from "node:test";
import { framePairSegmentCount, framePairTaskParams, framePairVideoSize, normalizeFramePairShots, supportsFramePair, validateFramePairShots } from "./framePairWorkflow.ts";

test("normalizes and validates professional frame-pair shots", () => {
  const shots = normalizeFramePairShots([{ id: "a", prompt: "push in", firstFrameUrl: "first.jpg", lastFrameUrl: "last.jpg", duration: 8 }]);
  assert.equal(validateFramePairShots(shots), "");
  assert.equal(validateFramePairShots([{ ...shots[0], lastFrameUrl: "" }]), "");
  assert.equal(validateFramePairShots([{ ...shots[0], firstFrameUrl: "" }]), "");
  assert.match(validateFramePairShots([{ ...shots[0], firstFrameUrl: "", lastFrameUrl: "" }]), /镜头 1/);
});

test("builds explicit first and last frame params", () => {
  const model = { runtime_rule: { video: { upload_profile: "veo_frame_pair" } } };
  const [shot] = normalizeFramePairShots([{ prompt: "move", firstFrameUrl: "first.jpg", lastFrameUrl: "last.jpg", duration: 5 }]);
  const params = framePairTaskParams(model, { size: "1280x720" }, shot);
  assert.equal(params.first_frame, "first.jpg");
  assert.equal(params.last_frame, "last.jpg");
  assert.equal(params.user_prompt, "move");
  assert.equal(supportsFramePair(model), true);
});

test("sets first-last mode for multimodal video models", () => {
  const model = { runtime_rule: { video: { upload_profile: "minimax_h3", mode_param: "generation_mode" } } };
  const [shot] = normalizeFramePairShots([{ prompt: "move", firstFrameUrl: "first.jpg", lastFrameUrl: "last.jpg", duration: 8 }]);
  assert.equal(framePairTaskParams(model, {}, shot).generation_mode, "first_last");
  const lastOnly = framePairTaskParams(model, { first_frame: "stale.jpg" }, { ...shot, firstFrameUrl: "" });
  assert.equal(lastOnly.generation_mode, "last_frame");
  assert.equal(lastOnly.first_frame, undefined);
  assert.equal(lastOnly.last_frame, "last.jpg");
});

test("honors model-specific frame parameter keys", () => {
  const model = { runtime_rule: { video: { upload_profile: "frame_pair", frames: { first: { key: "start_image" }, last: { key: "end_image" } } } } };
  const [shot] = normalizeFramePairShots([{ prompt: "move", firstFrameUrl: "first.jpg", lastFrameUrl: "last.jpg", duration: 5 }]);
  const params = framePairTaskParams(model, { duration: "5s" }, shot);
  assert.equal(params.start_image, "first.jpg");
  assert.equal(params.end_image, "last.jpg");
  assert.equal(params.duration, "5s");
});

test("plans frame-pair shot count from target and model duration", () => {
  assert.equal(framePairSegmentCount(15, 8), 2);
  assert.equal(framePairSegmentCount(15, 10), 2);
  assert.equal(framePairSegmentCount(16, 8), 2);
  assert.equal(framePairSegmentCount(17, 8), 3);
});

test("finds the model video-size control and default", () => {
  const model = { input_schema: { properties: { size: { enum: ["1280x720", "720x1280"], default: "720x1280" } } }, default_params: { size: "1280x720" } };
  assert.deepEqual(framePairVideoSize(model), {
    options: [
      { value: "1280x720", label: "横屏 · 720P", params: { size: "1280x720" } },
      { value: "720x1280", label: "竖屏 · 720P", params: { size: "720x1280" } },
    ],
    value: "1280x720",
    params: { size: "1280x720" },
  });
});

test("combines model ratio and quality into video-size choices", () => {
  const model = {
    input_schema: { properties: {
      ratio: { enum: ["16:9", "9:16"], default: "9:16" },
      resolution: { enum: ["720P", "1080P"], default: "720P" },
    } },
    default_params: { ratio: "16:9", resolution: "1080P" },
  };
  const control = framePairVideoSize(model);
  assert.equal(control.options.length, 4);
  assert.deepEqual(control.options[1], {
    value: "ratio=16:9|resolution=1080P",
    label: "横屏 · 1080P",
    params: { ratio: "16:9", resolution: "1080P" },
  });
  assert.equal(control.value, "ratio=16:9|resolution=1080P");
});
