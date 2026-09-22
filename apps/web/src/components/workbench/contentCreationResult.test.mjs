import { contentImageMarkersValid } from "./contentCreationResult.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { socialPublishHTML, socialPublishText } from "./contentCreationResult.ts";

test("keeps publishable copy and removes the image-generation plan", () => {
  assert.equal(
    socialPublishText("标题：秋日旅行\n\n正文：现在出发。\n\n标签：#旅行\n---配图规划---\n配图1：金色树林"),
    "标题：秋日旅行\n\n正文：现在出发。\n\n标签：#旅行",
  );
  assert.equal(
    socialPublishText("**标题：秋日旅行**\n\n正文内容。\n---\n**---配图规划---**\n配图1：金色树林"),
    "标题：秋日旅行\n\n正文内容。",
  );
});

test("formats legacy structured results for direct social-editor paste", () => {
  assert.equal(
    socialPublishText('```json\n{"content_post":{"title":"新品发布","body":"今天正式上线。","cta":"欢迎体验","hashtags":["#新品","#科技"]},"images":[]}\n```'),
    "新品发布\n\n今天正式上线。\n\n欢迎体验\n\n#新品 #科技",
  );
});

test("keeps ordinary copy unchanged", () => {
  assert.equal(socialPublishText("一段可以直接发布的正文。"), "一段可以直接发布的正文。");
  assert.equal(socialPublishText("  "), "");
});

test("builds safe rich text and inserts visuals at requested positions", () => {
  const html = socialPublishHTML("# 新品发布\n\n第一段 **重点**。\n\n【配图1】\n\n第二段 <script>。", ["https://cdn.example.com/one.png"]);
  assert.match(html, /<h1[^>]*>新品发布<\/h1>/);
  assert.match(html, /第一段 重点。.*<img src="https:\/\/cdn\.example\.com\/one\.png".*第二段 &lt;script&gt;。/);
  assert.doesNotMatch(html, /<script>/);
});

test("distributes legacy visuals when the copy has no image markers", () => {
  const html = socialPublishHTML("标题：示例\n\n第一段。\n\n第二段。", ["a.png", "b.png"]);
  assert.ok(html.indexOf("a.png") > html.indexOf("第一段。"));
  assert.ok(html.indexOf("b.png") > html.indexOf("第二段。"));
});


test("copy contracts support variable image counts and document body fields", () => {
  for (const count of [2, 4, 6]) {
    const text = Array.from({ length: count }, (_, i) => `段落\n【配图${i + 1}】`).join("\n") + "\n---配图规划---\n规划";
    assert.equal(contentImageMarkersValid(text, count), true);
    assert.equal(contentImageMarkersValid(text, count + 1), false);
  }
  assert.equal(contentImageMarkersValid("【配图1】【配图1】", 2), false);
  const text = socialPublishText(JSON.stringify({ titles: ["主标题", "备用"], body_markdown: "这是一段正文内容。" }));
  assert.match(text, /主标题/);
  assert.match(text, /正文/);
  assert.doesNotMatch(text, /备用/);
});
