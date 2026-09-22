import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { canvasAudioModeForModel, defaultCanvasRole, canvasRoleCompatible, resolvedCanvasRole } from "./canvasRoles.ts";
import { DOCUMENT_PAGE_PLANNER, documentPageDraftPrompt, documentPageImagePrompt, documentPagesFromParams, documentPageParams } from "./documentImagePages.ts";

// Execute the real template factory without mounting React or starting media jobs.
// Story/viral segment materialization is checked separately below.
const source = ts.createSourceFile("canvas.tsx", readFileSync(new URL("./InfiniteCanvasWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const variables = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) variables.set(node.name.text, node.initializer);
  ts.forEachChild(node, visit);
}
visit(source);
const factory = variables.get("appendTemplate").arguments[0].getText(source);
const factoryJS = ts.transpileModule(`globalThis.appendTemplate = ${factory}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const templateIDs = ["NODE_TEMPLATES", "LIBRARY_TEMPLATES"].flatMap(name => variables.get(name).expression.elements.map(element => element.properties.find(p => p.name.getText(source) === "id").initializer.text));

const expected = {
  "text-image": ["image"], "image-image": ["imageEdit"],
  "text-image-mix": ["publish", "illustration"],
  "content-image-post": ["publish", "illustration", "illustration", "illustration", "illustration"],
  "multi-image": ["image", "image"], "text-video": ["video"], "image-video": ["imageVideo"],
  "frame-pair-long-video": ["video"],
  "story-short-video": ["writer", "storyboard", "speechPlan", "speech"],
  "story-short-video-v2": ["writer", "storyboard", "speechPlan", "speech"],
  "viral-remake": ["reverse"], "one-click-viral-remake": ["reverse"], "video-remake": ["reverse"],
  "ecommerce-visual-pack": ["commerceMain", "commerceDetail"],
  "social-campaign": ["brandPoster", "video"],
  "product-showcase-video": ["commerceMain", "commerceVideo"],
  "brand-visual-kit": ["brandLogo", "brandPoster"], "photo-restoration": ["imageEdit"],
};

function environment() {
  let nextID = 0;
  const noop = () => {};
  const first = models => models[0];
  const ctx = {
    DOCUMENT_PAGE_PLANNER, documentPageDraftPrompt, documentPageImagePrompt, documentPagesFromParams, documentPageParams,
    nodesRef: { current: [] }, edgesRef: { current: [] }, workflowNameRef: {}, titleManuallyEditedRef: {},
    chatModels: [{ code: "text" }], imageModels: [{ code: "image" }], videoModels: [{ code: "video" }],
    audioModels: [{ code: "speech_tts" }, { code: "music" }], workspaceRuntime: {},
    ALL_TEMPLATE_DEFINITIONS: templateIDs.map(id => ({ id, titleKey: id })),
    t: key => key, newNodeID: () => `n${++nextID}`, crypto: { randomUUID: () => `uuid${++nextID}` },
    MarkerType: { ArrowClosed: "arrow" }, canvasModelDefaults: () => ({}), canvasAudioModeForModel,
    preferredVideoModel: first, preferredNarrationAudioModel: first, preferredMultimodalChatModel: first,
    preferredVideoAnalysisChatModel: first, referenceImageModels: models => models,
    storyV2VideoFrameLimit: () => 2,
    supportsFramePair: () => true, framePairVideoSize: () => ({ value: "1280x720", options: [{ value: "1280x720", params: {} }] }),
    storyModelSupportsDuration: () => true, normalizeCanvasParamsForModel: params => params,
    storyDurationOptions: () => [8], preferredStoryDuration: () => 8,
    STORY_SEGMENT_COUNT_OPTIONS: [2, 3, 4, 6, 8], VIRAL_SEGMENT_COUNT_OPTIONS: [3, 4, 6], ONE_CLICK_VIRAL_SEGMENT_COUNT_OPTIONS: [3, 4, 6],
    setTitle: noop, setNodes: noop, setEdges: noop, setShowEmptyWelcome: noop, setNotice: noop,
    configureStory: noop, configureViral: noop, window: { setTimeout: noop },
  };
  vm.runInNewContext(factoryJS, ctx);
  return ctx;
}

test("document teaching pages support one page and one image per page", () => {
  for (const count of [1, 3, 6]) {
    const ctx = environment();
    ctx.appendTemplate("content-image-post", "", { kind: "workflow", template_id: "content-image-post", prompt: "数学原文与排版要求", params: { image_count: count, count, content_layout: "document_pages", image_model_code: "image", analysis_model_code: "text" } });
    const images = ctx.nodesRef.current.filter(n => n.data.contentRole === "publish_image");
    assert.equal(images.length, count);
    assert.ok(images.every(n => n.data.params.count === 1 && n.data.params.n === 1));
    assert.match(images[0].data.prompt, /必须在图片内绘制本页真实教学文字/);
    const planner = ctx.nodesRef.current.find(n => n.data.contentRole === "publish_copy");
    assert.equal(planner.data.prompt, DOCUMENT_PAGE_PLANNER);
    const pages = ctx.nodesRef.current.filter(n => n.data.contentRole === "page_copy");
    assert.equal(pages.length, count);
    pages.forEach((page, index) => {
      assert.equal(page.data.prompt, documentPageDraftPrompt(index + 1, count));
      assert.equal(resolvedCanvasRole(page), "text");
      assert.ok(ctx.edgesRef.current.some(e => e.source === planner.id && e.target === page.id));
      assert.ok(ctx.edgesRef.current.some(e => e.source === page.id && e.target === images[index].id));
      assert.ok(!ctx.edgesRef.current.some(e => e.source === planner.id && e.target === images[index].id));
    });
    assert.match(DOCUMENT_PAGE_PLANNER, /忽略文档中/);
    assert.equal(ctx.nodesRef.current.find(n => n.data.contentRole === "source").data.prompt, "数学原文与排版要求");
  }
});

test("every registered canvas template creates correctly typed professional roles", () => {
  assert.deepEqual(new Set(templateIDs), new Set(Object.keys(expected)));
  for (const id of templateIDs) {
    const ctx = environment();
    ctx.appendTemplate(id);
    const nodes = Array.from(ctx.nodesRef.current).filter(n => n.type === "generator");
    assert.deepEqual(nodes.map(defaultCanvasRole), expected[id], id);
    for (const node of nodes) assert.ok(canvasRoleCompatible(node, resolvedCanvasRole(node)), `${id}: ${node.data.label}`);
  }
  for (const kind of ["speech", "music"]) {
    const ctx = environment();
    ctx.appendTemplate("agent-audio", "", { kind, params: {}, prompt: "test" });
    const node = Array.from(ctx.nodesRef.current).find(n => n.type === "generator");
    assert.equal(resolvedCanvasRole(node), kind);
    assert.equal(canvasAudioModeForModel({ code: node.data.modelCode }), kind);
  }
});

test("approved document catalog creates all pages beyond six without replanning or duplicating source context", () => {
  const ctx = environment();
  const pages = Array.from({ length: 25 }, (_, i) => ({ title: `章节 ${i + 1}`, source: `第${i + 1}页独立原文` }));
  ctx.appendTemplate("content-image-post", "", { kind: "workflow", template_id: "content-image-post", prompt: "整套统一纸张风格", params: {
    image_count: 1, count: 1, content_layout: "document_pages", document_pages: pages, document_page_count: 25, document_outline: "已确认的25页目录",
    asset_ids: ["doc"], asset_context: ["不得转发的整本正文"], image_model_code: "image", analysis_model_code: "text",
  } });
  const nodes = ctx.nodesRef.current;
  const copies = nodes.filter(n => n.data.contentRole === "page_copy");
  const images = nodes.filter(n => n.data.contentRole === "publish_image");
  assert.equal(copies.length, 25);
  assert.equal(images.length, 25);
  const outline = nodes.find(n => n.data.contentRole === "publish_copy");
  assert.equal(outline.type, "textInput");
  assert.equal(outline.data.outputText, "已确认的25页目录");
  for (let i = 0; i < 25; i++) {
    assert.ok(copies[i].data.prompt.includes(pages[i].source));
    assert.ok(!copies[i].data.prompt.includes(pages[(i + 1) % 25].source));
    assert.ok(ctx.edgesRef.current.some(e => e.source === copies[i].id && e.target === images[i].id));
    for (const node of [copies[i], images[i]]) {
      assert.equal(node.data.params.asset_context, undefined);
      assert.equal(node.data.params.asset_ids, undefined);
      assert.equal(node.data.params.document_pages, undefined);
    }
    assert.equal(images[i].data.params.count, 1);
    assert.equal(images[i].data.params.n, 1);
  }
});

test("document execution validates the confirmed total and page capacity", () => {
  for (const count of [3, 5, 7]) {
    const pages = Array.from({ length: count }, (_, i) => ({ title: `第${i + 1}页`, source: `正文${i + 1}` }));
    assert.equal(documentPagesFromParams({ content_layout: "document_pages", document_page_count: count, document_pages: pages }).length, count);
    assert.throws(() => documentPagesFromParams({ content_layout: "document_pages", document_page_count: 11, document_pages: pages }), /确认方案不一致/);
  }
  assert.throws(() => documentPagesFromParams({ content_layout: "document_pages", document_page_count: 1, document_pages: [{ title: "过长", source: "字".repeat(1601) }] }), /单页篇幅/);
});

test("dynamically materialized storyboard and remake nodes keep stills, motion and speech separate", () => {
  const cases = [
    [{ mediaKind: "image", storyRole: "asset" }, "assetVisual"],
    [{ mediaKind: "image", storyRole: "keyframe" }, "keyframe"],
    [{ mediaKind: "video", storyRole: "video" }, "imageVideo"],
    [{ mediaKind: "image", viralRole: "keyframe" }, "keyframe"],
    [{ mediaKind: "video", viralRole: "video" }, "imageVideo"],
    [{ mediaKind: "audio", storyRole: "narration" }, "speech"],
  ];
  for (const [data, role] of cases) assert.equal(resolvedCanvasRole({ type: "generator", data }), role);
});
