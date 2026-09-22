import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { canvasAnalysisMediaKinds, supportsMediaAnalysis, supportsVideoAnalysis } from "./canvasModelCapabilities.ts";

test("video analysis support requires explicit capabilities, never model names", () => {
  assert.equal(supportsVideoAnalysis({ code: "custom", runtime_rule: { capabilities: { video_analysis: true } } }), true);
  assert.equal(supportsVideoAnalysis({ code: "gemini-3-5-flash" }), false);
  assert.equal(supportsVideoAnalysis({ code: "text-only-chat" }), false);
});

test("image, video and audio declarations are independent and explicit false takes precedence", () => {
  const model = capabilities => ({ code: "custom", runtime_rule: { capabilities } });
  assert.equal(supportsMediaAnalysis(undefined, "image"), false);
  for (const kind of ["video", "audio"]) {
    for (const key of ["analysis", "input", "understanding"]) {
      assert.equal(supportsMediaAnalysis(model({ [`${kind}_${key}`]: true }), kind), true);
      assert.equal(supportsMediaAnalysis(model({ [`${kind}_${key}`]: "true" }), kind), false);
    }
  }
  assert.equal(supportsMediaAnalysis(model({ vision: true }), "image"), true);
  assert.equal(supportsMediaAnalysis(model({ vision: true }), "audio"), false);
  assert.equal(supportsVideoAnalysis(model({ multimodal: true })), false);
  assert.equal(supportsMediaAnalysis(model({ image_input: false, vision: true }), "image"), true);
  assert.equal(supportsMediaAnalysis(model({ vision: false, image_analysis: true, image_input: true, multimodal: true }), "image"), false);
});

function findNode(node, predicate) {
  return predicate(node) ? node : ts.forEachChild(node, child => findNode(child, predicate));
}
function sourceAt(path) {
  return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function evaluate(expression, context) {
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

test("canvas capability warnings exactly match admin checkbox values, including conflicting legacy fields", () => {
  const source = sourceAt("../../../../admin/src/app/admin/models/page.tsx");
  const declaration = findNode(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === "getCaps");
  const getCaps = evaluate(declaration.initializer.getText(source), { safeParseJson: JSON.parse });
  for (const [kind, canonical, keys] of [
    ["image", "vision", ["vision", "image_input", "multimodal", "image_analysis", "image_understanding"]],
    ["video", "video_analysis", ["video_analysis", "video_input", "video_understanding"]],
    ["audio", "audio_analysis", ["audio_analysis", "audio_input", "audio_understanding"]],
  ]) {
    for (let combination = 0; combination < 3 ** keys.length; combination++) {
      const capabilities = Object.fromEntries(keys.map((key, index) => [key, [undefined, false, true][Math.floor(combination / 3 ** index) % 3]]));
      const runtime_rule = { capabilities };
      assert.equal(supportsMediaAnalysis({ code: "gemini-vision-video", display_name: "GPT 多模态", tags: ["vision"], runtime_rule }, kind), getCaps(JSON.stringify(runtime_rule))[canonical], JSON.stringify(capabilities));
    }
  }
});

test("returning to canvas refreshes one cached model catalog request and removes event listeners", async () => {
  const source = sourceAt("./InfiniteCanvasWorkspace.tsx");
  const effect = findNode(source, node => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("setModelCatalogReady(false)"));
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = "visible";
  let enabled = true, chatModels, requests = [];
  const cleanup = evaluate(effect.arguments[0].getText(source), {
    window, document, AbortController, locale: "zh-CN", isMultiCollabModel: () => false,
    setModelCatalogReady: () => {}, setImageModels: () => {}, setVideoModels: () => {}, setAudioModels: () => {},
    setChatModels: models => { chatModels = models; },
    apiForLocaleCached: async (path, locale) => {
      requests.push({ kind: "cached", path, locale });
      return [{ code: "custom", category: "chat", runtime_rule: { capabilities: { vision: enabled, video_analysis: enabled } } }];
    },
    apiForLocale: async (path, locale, options) => {
      requests.push({ kind: "fresh", path, locale, options });
      return [{ code: "custom", category: "chat", runtime_rule: { capabilities: { vision: enabled, video_analysis: enabled } } }];
    },
  })();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  assert.equal(supportsMediaAnalysis(chatModels[0], "image"), true);
  enabled = false;
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(requests.length, 2, "focus and visibility events share one in-flight refresh");
  assert.equal(supportsMediaAnalysis(chatModels[0], "image"), false);
  assert.equal(supportsMediaAnalysis(chatModels[0], "video"), false);
  assert.deepEqual(requests.map(request => request.kind), ["cached", "fresh"]);
  assert.ok(requests.every(request => request.path === "/api/models" && request.locale === "zh-CN"));
  assert.equal(requests[1].options.cache, "no-store");
  cleanup();
  window.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.signal.aborted, true);
});

test("media detection includes uploads, asset imports and generated upstream media", () => {
  const media = (...data) => canvasAnalysisMediaKinds(data.map(data => ({ data })));
  assert.deepEqual(media({ prompt: "text", referenceImageUrls: [] }), []);
  assert.deepEqual(media({ referenceImageUrls: ["a.png"], referenceAudioUrls: ["a.mp3"] }), ["image", "audio"]);
  assert.deepEqual(media({ mediaKind: "video", assetUrl: "a.mp4" }), ["video"]);
  assert.deepEqual(media({ mediaKind: "image", assetUrls: ["a.png"] }, { outputKind: "video", outputUrl: "b.mp4" }), ["image", "video"]);
  assert.deepEqual(media({ referenceImageUrls: [""], mediaKind: "audio", assetUrls: [] }), []);
});
