import assert from "node:assert/strict";
import test from "node:test";
import { agentDisplayCategory, AGENT_CATEGORIES } from "./categoryMeta.ts";

test("agent sidebar groups workflows under tools", () => {
  assert.equal(agentDisplayCategory("infinite_canvas", "image"), "tool");
  assert.equal(agentDisplayCategory("ai_photo_studio", "workflow"), "tool");
  assert.equal(agentDisplayCategory("ai_virtual_tryon"), "tool");
  assert.equal(agentDisplayCategory("ai_novel_workshop", "unknown"), "tool");
  assert.equal(agentDisplayCategory("content_image_post", "image"), "tool");
  assert.equal(agentDisplayCategory("video_creation", "video"), "tool");
  assert.equal(agentDisplayCategory("video_creation_v2", "video"), "tool");
  assert.ok(!AGENT_CATEGORIES.some(({ code }) => code === "workflow"));
});
