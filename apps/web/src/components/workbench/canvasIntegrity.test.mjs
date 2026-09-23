import * as canvasGraph from "./canvasGraph.ts";
import { documentPageTextInputs, documentPageParams } from "./documentImagePages.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { canvasAnalysisMediaKinds, supportsMediaAnalysis } from "./canvasModelCapabilities.ts";
import { canvasImageReferenceLimit, referenceSheetPrompt } from "./canvasReferenceSheet.ts";
import { canvasMediaAwaitingReview, canvasQualityModel, canvasStrictQuality, canvasQualityResult, storyAssetPlan, storyV2VideoFrameLimit, storySubtitleInstruction } from "./videoCreationWorkflow.ts";
import { canvasAgentResult, canvasAgentState } from "./canvasAgentExecution.ts";
import { STORY_ASSET_INSTRUCTION, canvasEnhanceTarget, syncStoryAssetNodes, storyReviewBlockForMode, storyReviewBlock, storyWholeGeneration, storyAssets, storyShotAssets, CANVAS_NODE_RUNTIME_KEYS, canvasNodeConfiguration, pauseCanvasAfterStep, canvasChatMediaParams, canvasJSONValue, storyTimingInstruction, storyStoryboardSegments, STORY_AUDIO_REFERENCE_INSTRUCTION, configureVideoAudio, storyVideoMode, viralStoryboardSegments, viralShotContext } from "./videoCreationWorkflow.ts";
import { storySpeechInstruction, STORY_PLANNING_INSTRUCTION, SHOT_SPEECH_INSTRUCTION, videoAudioInstruction, shotSpeeches, needsLipSync, verifyShotSpeechPlan, syncTaskParams } from "./shotSpeech.ts";
import { canvasNodeMedium, canvasRolePrompt, canvasMediaPrompt, canvasInputConstraints, normalizeCanvasRoleData } from "./canvasRoles.ts";
import { normalizeFramePairShots } from "./framePairWorkflow.ts";
import { storyUserContext, canvasPortraitRejection, canvasManagedRetryableTask } from "./videoCreationWorkflow.ts";
import { storyShotDurations, storySubtitleCues, STORY_LOCATION_ASSET_INSTRUCTION } from "./videoCreationWorkflow.ts";
import { speechContentSignature } from "./shotSpeech.ts";
import { storyLocksSpeech, storySpeechRepairInstruction, storyConstraintRetryPatch, storyConstraintRepairInstruction, storyPromptTargetDuration, stampViralSource, VIRAL_SOURCE_INSTRUCTION } from "./videoCreationWorkflow.ts";

// Exercise the actual editor callbacks with controlled network responses, without paid jobs.
const source = ts.createSourceFile("canvas.tsx", readFileSync(new URL("./InfiniteCanvasWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name)) declarations.set(node.name.text, node);
  ts.forEachChild(node, visit);
}
visit(source);
const helpers = ["indexedCanvasEdges", "hasGraphCycle", "validCanvasDocument", "validateCompositorNode", "collectDownstreamIDs", "collectUpstreamNodes", "stableValue", "compactSignature", "contentSourceContext", "nodeRunSignature", "nodeHasResult", "nodeHasReconcilableTask", "nodeResultReusable", "nodeResultConsumable", "taskVideoSamples", "orderedGeneratorNodes", "collectURLs", "extractMedia", "runningProgress", "canvasTaskStatusHint", "truncateCanvasTitle", "automaticCanvasTitle", "storyNodeNeedsReset"];
const noop = () => {};
const plain = value => JSON.parse(JSON.stringify(value));
const node = (id, type = "generator", data = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { mediaKind: "text", status: "succeeded", outputText: id, ...data } });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target });
function environment(callbacks = [], overrides = {}) {
  const notices = [];
  const ctx = {
    ...canvasGraph,
    documentPageTextInputs, documentPageParams,
    storyLocksSpeech, storySpeechRepairInstruction, storyConstraintRetryPatch, storyConstraintRepairInstruction, storyPromptTargetDuration, stampViralSource, VIRAL_SOURCE_INSTRUCTION,
    syncStoryDuration: noop, syncStoryDurationRef: { current: null },
    storyUserContext, canvasPortraitRejection, canvasManagedRetryableTask,
    storyShotDurations, storySubtitleCues, storySubtitleInstruction, STORY_LOCATION_ASSET_INSTRUCTION, speechContentSignature,
    canvasAgentResult,
    storyReviewBlockForMode, storyReviewBlock, storyWholeGeneration, storyAssets, storyShotAssets,
    configureVideoAudio, storyVideoMode, storyStoryboardSegments, storyTimingInstruction, viralStoryboardSegments, viralShotContext,
    storySpeechInstruction, STORY_PLANNING_INSTRUCTION, SHOT_SPEECH_INSTRUCTION, videoAudioInstruction, shotSpeeches, needsLipSync, verifyShotSpeechPlan, syncTaskParams,
    canvasAnalysisMediaKinds, supportsMediaAnalysis, canvasImageReferenceLimit, referenceSheetPrompt, canvasMediaAwaitingReview, canvasQualityModel, canvasStrictQuality, canvasQualityResult, storyAssetPlan, storyV2VideoFrameLimit, STORY_ASSET_INSTRUCTION, canvasEnhanceTarget, syncStoryAssetNodes, canvasChatMediaParams, canvasJSONValue,
    CANVAS_NODE_RUNTIME_KEYS, canvasNodeConfiguration, canvasNodeMedium, canvasRolePrompt, canvasMediaPrompt, canvasInputConstraints, normalizeCanvasRoleData, pauseCanvasAfterStep,
    normalizeFramePairShots,
    notices,
    nodesRef: { current: [] }, edgesRef: { current: [] }, executionActiveRef: { current: false }, executionWakeRef: { current: null }, stopExecutionRef: { current: false },
    canvasLoadRef: { current: null }, setLoadingCanvasID: noop, pendingSavesRef: { current: 0 }, saveQueueRef: { current: Promise.resolve(true) },
    AbortController, initialCanvasRequestRef: { current: null },
    historyRequestRef: { current: null }, historyFetchedAtRef: { current: 0 },
    setHistoryLoading: noop, setHistoryError: noop, setHistoryPage: noop, setHistoryHasMore: noop, setReconcilingTasks: noop,
    titleRef: { current: "Canvas" }, titleManuallyEditedRef: { current: true }, workflowNameRef: { current: "Canvas" },
    submittedAtRef: { current: "" }, canvasIDRef: { current: "" }, authenticated: true,
    workspaceRuntime: {}, workspaceRuntimeRef: { current: {} }, workflowCode: "infinite_canvas", draftStorageKey: "draft",
    chatModels: [], imageModels: [], videoModels: [], audioModels: [],
    setNodes: noop, setEdges: noop, setNotice: value => notices.push(value), setRunningAll: noop, setExecutionProgress: noop, setSaving: noop,
    setCanvasID: noop, setTitle: noop, setHistory: noop, refreshHistory: noop, sessionStorage: { setItem: noop, removeItem: noop },
    checkpointCanvasRef: { current: async () => true }, wait: async () => {}, t: key => key,
    commitCanvasRef: { current: async () => true }, reconcileCanvasTasks: async () => ({ running: 0, unavailable: 0 }),
    executionPausedRef: { current: false }, changeExecutionPaused: noop,
    executionModeRef: { current: "auto" }, modelsForKind: () => [{ code: "text" }],
    ...overrides,
  };
  const code = helpers.filter(name => !(name in canvasGraph)).map(name => declarations.get(name).getText(source)).join("\n") + callbacks.map(name => {
    const expression = declarations.get(name).initializer.arguments[0].getText(source);
    return `\nglobalThis.${name} = ${expression};`;
  }).join("\n");
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  return ctx;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("video sampling falls back to authenticated task media when the source blocks browser reads", async () => {
  const sampled = [];
  const proxied = [];
  const revoked = [];
  const ctx = environment([], {
    storyVideoSamples: async (url, ratios) => {
      sampled.push([url, ratios]);
      if (url === "https://cdn.example/video.mp4") throw new Error("CORS blocked");
      return ["data:image/jpeg;base64,frame"];
    },
    apiBlob: async path => { proxied.push(path); return {}; },
    URL: {
      createObjectURL: () => "blob:task-media",
      revokeObjectURL: url => revoked.push(url),
    },
  });

  const samples = await ctx.taskVideoSamples("https://cdn.example/video.mp4", "task/a", [1]);
  assert.deepEqual(Array.from(samples), ["data:image/jpeg;base64,frame"]);
  assert.deepEqual(proxied, ["/api/tasks/task%2Fa/media"]);
  assert.deepEqual(sampled, [["https://cdn.example/video.mp4", [1]], ["blob:task-media", [1]]]);
  assert.deepEqual(revoked, ["blob:task-media"]);
});

test("import rejects malformed nodes, dangling links, duplicate IDs and cycles before replacing a canvas", async () => {
  const ctx = environment(["importCanvas"]);
  const valid = { nodes: [node("a"), node("b")], edges: [edge("a", "b")] };
  assert.equal(ctx.validCanvasDocument(valid), true);
  assert.equal(ctx.validCanvasDocument({ nodes: [], edges: [] }), true); // Agent bootstrap
  const invalid = [null, {}, { nodes: null, edges: [] },
    { ...valid, nodes: [node("a"), node("a")] },
    { ...valid, nodes: [null] }, { ...valid, nodes: [node("a", "unknown")] },
    { ...valid, nodes: [{ ...node("a"), data: null }] },
    { ...valid, edges: [edge("a", "missing")] },
    { ...valid, edges: [edge("a", "b"), edge("b", "a")] },
    { ...valid, edges: [edge("a", "b"), edge("a", "b")] },
    { ...valid, viewport: { x: 0, y: 0, zoom: -1 } },
  ];
  ctx.nodesRef.current = [node("keep")];
  for (const document of invalid) {
    assert.equal(ctx.validCanvasDocument(document), false);
    await ctx.importCanvas({ size: 100, text: async () => JSON.stringify(document) });
    assert.equal(ctx.nodesRef.current[0].id, "keep");
  }
});

test("signatures track transitive input and legacy single assets, excluding runtime progress", () => {
  const ctx = environment();
  const nodes = [node("input", "imageInput", { assetUrl: "old.png", assetId: "asset-a" }), node("middle"), node("end")];
  const edges = [edge("input", "middle"), edge("middle", "end")];
  const signature = ctx.nodeRunSignature("end", nodes, edges);
  nodes[1].data.progress = 70;
  assert.equal(ctx.nodeRunSignature("end", nodes, edges), signature);
  nodes[0].data.assetUrl = "new.png";
  assert.notEqual(ctx.nodeRunSignature("end", nodes, edges), signature);
  assert.equal(ctx.nodeHasResult(node("media", "generator", { mediaKind: "image", outputUrls: ["a.png"] })), true);
});

test("frame-pair planning uses independent shot nodes and preserves shots when only final duration changes", () => {
  const ctx = environment();
  const input = node("plan", "framePairInput", { prompt: "story", modelCode: "veo-fl", framePairTargetDuration: 15, framePairGroupID: "group", framePairRole: "input", outputText: "" });
  const shot = node("shot-1", "generator", { mediaKind: "video", modelCode: "veo-fl", framePairGroupID: "group", framePairRole: "shot", framePairSegmentIndex: 1, firstFrameUrl: "first.jpg", lastFrameUrl: "last.jpg", outputText: "" });
  const final = node("final", "compositor", { framePairGroupID: "group", framePairRole: "final", targetDuration: 15, outputText: "" });
  const edges = [edge("plan", "shot-1"), edge("shot-1", "final")];
  assert.equal(ctx.validCanvasDocument({ nodes: [input, shot, final], edges }), true);
  const signature = ctx.nodeRunSignature("shot-1", [input, shot, final], edges);
  input.data.prompt = "updated story";
  assert.notEqual(ctx.nodeRunSignature("shot-1", [input, shot, final], edges), signature);
  const editedSignature = ctx.nodeRunSignature("shot-1", [input, shot, final], edges);
  input.data.framePairTargetDuration = 20;
  assert.equal(ctx.nodeRunSignature("shot-1", [input, shot, final], edges), editedSignature);
});

test("video script requests carry uploaded and linked audio, and failed audio analysis cannot succeed", async () => {
  const requests = [];
  let output = "音频1在0到2秒有掌声，开场用近景表现庆祝。";
  const ctx = environment(["update", "run"], {
    canvasChatMediaParams, canvasJSONValue, storyTimingInstruction, STORY_AUDIO_REFERENCE_INSTRUCTION,
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    api: async (url, options) => { assert.equal(url, "/api/chat/completions"); requests.push(JSON.parse(options.body)); return { content: output, cost: 1 }; },
  });
  ctx.nodesRef.current = [
    node("input", "textInput", { storyRole: "input", referenceAudioUrls: ["uploaded.mp3", "uploaded.mp3"], outputText: "", prompt: "根据声音创作视频" }),
    node("asset", "imageInput", { mediaKind: "audio", assetUrl: "library.wav", outputText: "" }),
    node("script", "generator", { storyRole: "script", modelCode: "text", prompt: "生成脚本", storySegmentCount: 1, storySegmentDuration: 8, outputText: "" }),
    node("unrelated", "textInput", { referenceAudioUrls: ["unused.mp3"] }),
  ];
  ctx.edgesRef.current = [edge("input", "script"), edge("asset", "script")];
  await ctx.run("script");
  assert.deepEqual(requests[0].params.reference_audios, ["uploaded.mp3", "library.wav"]);
  assert.match(requests[0].messages[1].content, /先实际聆听/);
  assert.match(requests[0].messages[1].content, /audio_reference/);
  assert.equal(ctx.nodesRef.current.find(n => n.id === "script").data.status, "succeeded");
  output = '{"error":"音频无法读取"}';
  await ctx.run("script");
  assert.equal(ctx.nodesRef.current.find(n => n.id === "script").data.status, "failed");
  assert.match(ctx.nodesRef.current.find(n => n.id === "script").data.error, /音频无法读取/);
});

test("saved audio-reference results are invalidated when upgrading the audio pipeline", () => {
  const ctx = environment();
  const nodes = [node("input", "textInput", { referenceAudioUrls: ["a.mp3"] }), node("script")];
  const edges = [edge("input", "script")];
  const upgraded = ctx.nodeRunSignature("script", nodes, edges);
  // Recompute the exact old implementation, which did not include audioReferenceVersion.
  const oldCode = declarations.get("nodeRunSignature").getText(source).replace(/\s*\.\.\.\(\[node, \.\.\.upstream\][\s\S]*?audioReferenceVersion: 1 \} : \{\}\),/, "");
  vm.runInNewContext(ts.transpileModule(oldCode, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  assert.notEqual(ctx.nodeRunSignature("script", nodes, edges), upgraded);
});

test("scene generation receives the current shot's audio evidence from the storyboard", async () => {
  const requests = [];
  const ctx = environment(["update", "run"], {
    storyStoryboardSegments, storyTimingInstruction,
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    inferSeedanceMaterialMode: () => "text", normalizeCanvasParamsForModel: params => params,
    canvasImageReferenceLimit: () => 4,
    api: async (url, options) => { assert.equal(url, "/api/tasks"); requests.push(JSON.parse(options.body)); return { status: "failed", task_no: "test-only" }; },
  });
  const shot = { segment_index: 1, scene: "庆祝", camera: "近景", image_prompt: "人物拍手", video_prompt: "跟随掌声节奏拍手", audio_reference: { reference_index: 1, start: 0, end: 2, observation: "两次掌声" } };
  ctx.nodesRef.current = [node("board", "generator", { storyRole: "storyboard", prompt: "人物均为原创虚构角色，采用环境中景", outputText: JSON.stringify([shot]) }), node("frame", "generator", { mediaKind: "image", storyRole: "keyframe", storySegmentIndex: 1, modelCode: "text", prompt: "画当前镜头" })];
  ctx.edgesRef.current = [edge("board", "frame")];
  await ctx.run("frame");
  assert.equal(requests.length, 1, ctx.nodesRef.current[1].data.error);
  assert.match(requests[0].prompt, /"audio_reference":\{"reference_index":1,"start":0,"end":2,"observation":"两次掌声"\}/);
  assert.match(requests[0].prompt, /人物拍手/);
  assert.match(requests[0].prompt, /人物均为原创虚构角色，采用环境中景/);
  assert.match(requests[0].prompt, /当前节点执行要求（明确修改优先于分镜中的同类描述）/);
});

test("document page images receive only their own page draft, not the whole document", async () => {
  const requests = [];
  const ctx = environment(["update", "run"], {
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    inferSeedanceMaterialMode: () => "text", normalizeCanvasParamsForModel: params => params,
    api: async (url, options) => { assert.equal(url, "/api/tasks"); requests.push(JSON.parse(options.body)); return { status: "failed", task_no: "test-only" }; },
  });
  ctx.nodesRef.current = [
    node("source", "textInput", { prompt: "整份原文不可进入绘图", outputText: "", contentRole: "source" }),
    node("outline", "generator", { outputText: "全部页面目录", contentRole: "publish_copy" }),
    node("page", "generator", { outputText: "本页短句与米白纸手绘风格", contentRole: "page_copy" }),
    node("image", "generator", { mediaKind: "image", contentRole: "publish_image", params: { content_layout: "document_pages" }, modelCode: "text", prompt: "只画本页" }),
  ];
  ctx.edgesRef.current = [edge("source", "outline"), edge("outline", "page"), edge("page", "image")];
  await ctx.run("image");
  assert.equal(requests.length, 1, ctx.nodesRef.current[3].data.error);
  assert.match(requests[0].prompt, /本页短句与米白纸手绘风格/);
  assert.doesNotMatch(requests[0].prompt, /整份原文不可进入绘图|全部页面目录/);
});

test("document page constraint conflicts stop the page without automatic retry", async () => {
  let calls = 0;
  const ctx = environment(["update", "run"], {
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    api: async (url, options) => {
      calls++;
      assert.equal(url, "/api/chat/completions");
      assert.equal(JSON.parse(options.body).params._agent_plan_output_limit, 8192);
      return { content: '{"error":"全文无法放入一页，请调整页数或范围"}', cost: 1 };
    },
  });
  ctx.nodesRef.current = [node("page", "generator", { contentRole: "page_copy", modelCode: "text", prompt: "编排第1页", outputText: "" })];
  await ctx.run("page");
  assert.equal(calls, 1);
  assert.equal(ctx.nodesRef.current[0].data.status, "failed");
  assert.match(ctx.nodesRef.current[0].data.error, /全文无法放入一页/);
  assert.equal(ctx.nodesRef.current[0].data.actualCost, 1);
});

test("batch deletion invalidates every remaining dependent and retains unrelated results", () => {
  const ctx = environment(["markDirtyFrom", "remove", "deleteSelected"]);
  ctx.nodesRef.current = [{ ...node("input", "textInput"), selected: true }, node("a"), node("b"), node("unrelated")];
  ctx.edgesRef.current = [edge("input", "a"), edge("a", "b")];
  ctx.deleteSelected();
  assert.deepEqual(plain(ctx.nodesRef.current.map(n => [n.id, n.data.status])), [["a", "stale"], ["b", "stale"], ["unrelated", "succeeded"]]);
  assert.deepEqual(plain(ctx.edgesRef.current), [edge("a", "b")]);
});

test("deleting a planned image invalidates its copy and remaining illustrations", () => {
  const ctx = environment(["markDirtyFrom", "remove"]);
  ctx.nodesRef.current = [node("copy", "generator", { contentRole: "publish_copy" }), node("a"), node("b")];
  ctx.edgesRef.current = [edge("copy", "a"), edge("copy", "b")];
  ctx.remove("a");
  assert.deepEqual(plain(ctx.nodesRef.current.map(n => n.data.status)), ["stale", "stale"]);
});

test("late results cannot mark changed inputs complete or unlock downstream work", () => {
  const ctx = environment(["update"]);
  ctx.nodesRef.current = [node("a", "textInput", { prompt: "before" }), node("b"), node("c")];
  ctx.edgesRef.current = [edge("a", "b"), edge("b", "c")];
  const signature = ctx.nodeRunSignature("b", ctx.nodesRef.current, ctx.edgesRef.current);
  ctx.update("a", { prompt: "after" });
  ctx.update("b", { status: "succeeded", outputText: "old response", lastRunSignature: signature, dirty: false });
  const b = ctx.nodesRef.current.find(n => n.id === "b");
  assert.equal(b.data.status, "stale");
  assert.equal(b.data.dirty, true);
  assert.equal(ctx.nodeResultReusable(b, ctx.nodesRef.current, ctx.edgesRef.current), false);
});

test("double click while reconciling stops preparation without duplicate submissions", async () => {
  const gate = deferred();
  let reconciliations = 0;
  let submissions = 0;
  const ctx = environment(["executeNodes"], {
    reconcileCanvasTasks: async () => { reconciliations++; return gate.promise; },
    commitCanvasRef: { current: async () => { submissions++; return true; } },
    modelsForKind: () => [{ code: "text" }],
  });
  ctx.nodesRef.current = [node("a", "generator", { modelCode: "text", prompt: "hello" })];
  ctx.chatModels = [{ code: "text" }];
  const first = ctx.executeNodes();
  assert.equal(ctx.executionActiveRef.current, true);
  await ctx.executeNodes();
  gate.resolve({ running: 0, unavailable: 0 });
  await first;
  assert.equal(reconciliations, 1);
  assert.equal(submissions, 0);
  assert.equal(ctx.executionActiveRef.current, false);
  assert.ok(!ctx.notices.some(notice => /not defined|Failed|generationFailed/.test(notice)), ctx.notices.join("; "));
});

test("Agent retry follows an existing task to completion and only runs its unfinished dependents", async () => {
  let polls = 0;
  const generated = [];
  const states = [];
  const ctx = environment(["update", "reconcileNodeTasks", "reconcileCanvasTasks", "executeNodes", "continueAgentCanvas"], {
    api: async url => {
      assert.equal(url, "/api/tasks/existing");
      return ++polls < 3 ? { status: "running" } : { status: "succeeded", output: { image_url: "frame.png" } };
    },
    imageModels: [{ code: "image", category: "image" }],
    modelsForKind: () => [{ code: "image" }],
    run: async id => {
      generated.push(id);
      ctx.update(id, { status: "succeeded", dirty: false, outputKind: "image", outputUrl: "final.png", lastRunSignature: ctx.nodeRunSignature(id, ctx.nodesRef.current, ctx.edgesRef.current) });
    },
    setRunningAll: running => { states.push(canvasAgentState(ctx.nodesRef.current, ctx.edgesRef.current, running).status); },
  });
  ctx.nodesRef.current = [
    node("frame", "generator", { status: "running", mediaKind: "image", outputText: "", taskNo: "existing", modelCode: "image", prompt: "参考帧" }),
    node("final", "generator", { status: "blocked", dirty: true, mediaKind: "image", outputText: "", modelCode: "image", prompt: "成品" }),
  ];
  ctx.edgesRef.current = [edge("frame", "final")];
  await ctx.continueAgentCanvas();
  assert.equal(polls, 3, ctx.notices.join("; "));
  assert.deepEqual(generated, ["final"], ctx.notices.join("; "));
  assert.equal(states.at(-1), "succeeded");
  assert.deepEqual(canvasAgentState(ctx.nodesRef.current, ctx.edgesRef.current, false).media.images, ["final.png"]);
  // A delayed click from the old Agent retry button must not generate anything.
  await ctx.continueAgentCanvas();
  assert.equal(polls, 3);
  assert.deepEqual(generated, ["final"]);
});

test("Agent can stop polling a resumed task without creating another job", async () => {
  const gate = deferred();
  let polls = 0;
  const ctx = environment(["executeNodes", "continueAgentCanvas"], {
    reconcileCanvasTasks: async () => { polls++; return { running: 1, unavailable: 0 }; },
    wait: () => gate.promise,
    commitCanvasRef: { current: async () => true },
    run: async () => assert.fail("stopping must not submit"),
    chatModels: [{ code: "text" }],
  });
  ctx.nodesRef.current = [node("frame", "generator", { status: "running", modelCode: "text", prompt: "frame", outputText: "", taskNo: "existing" })];
  const resume = ctx.continueAgentCanvas();
  await new Promise(resolve => setImmediate(resolve));
  await ctx.continueAgentCanvas("stop");
  gate.resolve();
  await resume;
  assert.equal(polls, 1);
  assert.equal(ctx.executionActiveRef.current, false);
  assert.ok(ctx.notices.includes("canvas.executionStopped"));
});

test("concurrent saves create one canvas and preserve title edits made in flight", async () => {
  const gate = deferred();
  const calls = [];
  const ctx = environment(["save"], {
    documentSnapshot: () => ({ version: 1, nodes: [], edges: [] }),
    api: async (url, options) => {
      calls.push({ url, ...options });
      if (calls.length === 1) await gate.promise;
      return { public_id: "saved", title: JSON.parse(options.body).title };
    },
  });
  const first = ctx.save(true, true);
  const second = ctx.save(true, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  ctx.titleRef.current = "Edited during save";
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(calls.map(call => [call.url, call.method]), [["/api/canvases?summary=true", "POST"], ["/api/canvases/saved?summary=true", "PUT"]]);
  assert.equal(JSON.parse(calls[1].body).title, "Edited during save");
  assert.equal(ctx.pendingSavesRef.current, 0);
});

test("failed initial submission retains a recoverable draft and releases the save queue", async () => {
  const drafts = [];
  const ctx = environment(["save"], {
    api: async () => { throw new Error("offline"); },
    documentSnapshot: () => ({ version: 1, nodes: [node("keep")], edges: [] }),
    sessionStorage: { setItem: (key, value) => drafts.push(JSON.parse(value)) },
  });
  assert.equal(await ctx.save(true, true), false);
  assert.equal(ctx.submittedAtRef.current, "");
  assert.equal(ctx.pendingSavesRef.current, 0);
  assert.equal(drafts[0].document.nodes[0].id, "keep");
});

test("compositor validation counts material items rather than source nodes", () => {
  const ctx = environment();
  const source = node("source", "imageInput", { mediaKind: "video", assetUrls: ["a.mp4", "b.mp4"] });
  const final = node("final", "compositor", { composeMode: "concat" });
  assert.equal(ctx.validateCompositorNode(final, [source, final], [edge("source", "final")]), "");
  source.data.assetUrls = ["a.mp4"];
  assert.equal(ctx.validateCompositorNode(final, [source, final], [edge("source", "final")]), "canvas.compositor.concatInvalid");
});

function executor(mode = "auto", failID = "") {
  const executed = [];
  const ctx = environment(["update", "executeNodes"], { executionModeRef: { current: mode }, chatModels: [{ code: "text" }] });
  ctx.run = async id => {
    executed.push(id);
    const signature = ctx.nodeRunSignature(id, ctx.nodesRef.current, ctx.edgesRef.current);
    ctx.update(id, id === failID ? { status: "failed", dirty: true } : { status: "succeeded", dirty: false, lastRunSignature: signature, outputText: `result ${id}` });
  };
  const pending = id => node(id, "generator", { modelCode: "text", prompt: "task", status: "idle", outputText: "" });
  return { ctx, executed, pending };
}

test("step mode resumes the next node and reuses completed ancestors", async () => {
  const { ctx, executed, pending } = executor("step");
  ctx.nodesRef.current = [node("input", "textInput", { prompt: "brief" }), pending("a"), pending("b")];
  ctx.edgesRef.current = [edge("input", "a"), edge("a", "b")];
  await ctx.executeNodes();
  assert.deepEqual(executed, ["a"]);
  await ctx.executeNodes();
  assert.deepEqual(executed, ["a", "b"]);
  await ctx.executeNodes();
  assert.deepEqual(executed, ["a", "b"]);
});

test("one failed branch blocks its descendants while independent work completes", async () => {
  const { ctx, executed, pending } = executor("auto", "a");
  ctx.nodesRef.current = [pending("a"), pending("b"), pending("c"), pending("d")];
  ctx.edgesRef.current = [edge("a", "c"), edge("b", "d")];
  await ctx.executeNodes();
  assert.deepEqual(executed, ["a", "b", "d"]);
  assert.equal(ctx.nodesRef.current.find(n => n.id === "c").data.status, "blocked");
  assert.equal(ctx.nodesRef.current.find(n => n.id === "d").data.status, "succeeded");
});

test("scoped execution rejects a dirty ancestor even when its old output exists", async () => {
  const { ctx, executed, pending } = executor();
  ctx.nodesRef.current = [node("a", "generator", { dirty: true, modelCode: "text" }), pending("b")];
  ctx.edgesRef.current = [edge("a", "b")];
  await ctx.executeNodes(new Set(["b"]));
  assert.deepEqual(executed, []);
  assert.equal(ctx.nodesRef.current[1].data.status, "blocked");
  assert.equal(ctx.nodesRef.current[1].data.error, "canvas.upstreamNotReady");
});

test("completed paid media remains usable after edits until the user explicitly retries it", async () => {
  const { ctx, executed, pending } = executor();
  ctx.nodesRef.current = [
    node("clip-1", "generator", { mediaKind: "video", outputText: "", outputUrl: "clip-1.mp4", outputKind: "video", status: "stale", dirty: true, modelCode: "text" }),
    { ...pending("clip-2"), data: { ...pending("clip-2").data, mediaKind: "video" } },
  ];
  ctx.videoModels = [{ code: "text" }];
  ctx.parseVideoRuntime = () => ({});
  ctx.edgesRef.current = [edge("clip-1", "clip-2")];
  await ctx.executeNodes(new Set(["clip-2"]));
  assert.deepEqual(executed, ["clip-2"]);
  assert.equal(ctx.nodesRef.current[1].data.status, "succeeded");
  assert.equal(ctx.nodesRef.current[1].data.reuseWarning, "canvas.existingMediaContinued");
});

test("reapplying identical configuration does not falsely dirty a node or its downstream", () => {
  const ctx = environment(["update"]);
  ctx.nodesRef.current = [
    node("a", "generator", { prompt: "same", params: { duration: 8 }, dirty: false }),
    node("b", "generator", { dirty: false }),
  ];
  ctx.edgesRef.current = [edge("a", "b")];
  ctx.update("a", { prompt: "same", params: { duration: 8 } });
  assert.equal(ctx.nodesRef.current[0].data.status, "succeeded");
  assert.equal(ctx.nodesRef.current[0].data.dirty, false);
  assert.equal(ctx.nodesRef.current[1].data.status, "succeeded");
  assert.equal(ctx.nodesRef.current[1].data.dirty, false);
  ctx.update("a", { prompt: "changed" });
  assert.equal(ctx.nodesRef.current[0].data.status, "stale");
  assert.equal(ctx.nodesRef.current[1].data.status, "stale");
});

test("retrying a video recovers its unchanged successful keyframe without generating it again", async () => {
  for (const changed of [false, true]) {
    const queries = [], generated = [];
    const ctx = environment(["update", "reconcileNodeTasks", "reconcileCanvasTasks", "executeNodes", "runOnly"], {
      chatModels: [{ code: "text" }],
      api: async url => { queries.push(url); return { status: "succeeded", output: { image_url: "saved.png" } }; },
    });
    ctx.nodesRef.current = [
      node("frame", "generator", { mediaKind: "image", storyRole: "keyframe", modelCode: "text", prompt: "original", outputUrl: "saved.png", taskNo: "saved", qualityStatus: "passed", status: "idle", dirty: true }),
      node("clip", "generator", { modelCode: "text", prompt: "animate", status: "blocked", outputText: "" }),
    ];
    ctx.edgesRef.current = [edge("frame", "clip")];
    ctx.nodesRef.current[0].data.lastRunSignature = ctx.nodeRunSignature("frame", ctx.nodesRef.current, ctx.edgesRef.current);
    if (changed) ctx.nodesRef.current[0].data.prompt = "changed";
    ctx.run = async id => {
      generated.push(id);
      ctx.update(id, { status: "succeeded", outputText: "done", dirty: false, lastRunSignature: ctx.nodeRunSignature(id, ctx.nodesRef.current, ctx.edgesRef.current) });
    };
    await ctx.runOnly("clip");
    assert.deepEqual(queries, changed ? [] : ["/api/tasks/saved"]);
    assert.deepEqual(generated, changed ? [] : ["clip"]);
    assert.equal(ctx.nodesRef.current[0].data.outputUrl, "saved.png");
    assert.equal(ctx.nodesRef.current[1].data.status, changed ? "blocked" : "succeeded");
    if (changed) assert.equal(ctx.nodesRef.current[1].data.error, "canvas.upstreamNotReady");
  }
});

test("a ready video starts while another image in the same batch is still generating", async () => {
  const { ctx, executed, pending } = executor();
  const slow = deferred(), fast = deferred();
  ctx.nodesRef.current = [pending("fast"), pending("slow"), { ...pending("video"), data: { ...pending("video").data, mediaKind: "video" } }];
  ctx.videoModels = [{ code: "text" }];
  ctx.parseVideoRuntime = () => ({});
  ctx.edgesRef.current = [edge("fast", "video")];
  ctx.run = async id => {
    executed.push(id);
    if (id === "fast") await fast.promise;
    if (id === "slow") await slow.promise;
    ctx.update(id, { status: "succeeded", dirty: false, outputText: id, lastRunSignature: ctx.nodeRunSignature(id, ctx.nodesRef.current, ctx.edgesRef.current) });
  };
  const execution = ctx.executeNodes();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(executed, ["fast", "slow"]);
  fast.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(executed, ["fast", "slow", "video"]);
  slow.resolve();
  await execution;
});

test("recovering a queued video does not stall an independent frame or submit the video again", async () => {
  const gate = deferred(), calls = [];
  const ctx = environment(["update", "reconcileNodeTasks", "reconcileCanvasTasks", "executeNodes"], {
    chatModels: [{ code: "text" }], wait: () => gate.promise,
    api: async url => { calls.push(url); return { task_no: "existing", status: "running", upstream_status: "queued", created_at: new Date().toISOString() }; },
  });
  ctx.nodesRef.current = [node("queued", "generator", { modelCode: "text", prompt: "video", status: "running", taskNo: "existing", outputText: "" }), node("frame", "generator", { modelCode: "text", prompt: "frame", status: "idle", outputText: "" })];
  const ran = [];
  ctx.run = async id => {
    ran.push(id);
    ctx.update(id, { status: "succeeded", dirty: false, outputText: "ready", lastRunSignature: ctx.nodeRunSignature(id, ctx.nodesRef.current, []) });
  };
  const execution = ctx.executeNodes();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ran, ["frame"]);
  assert.deepEqual(calls, ["/api/tasks/existing"]);
  assert.equal(ctx.nodesRef.current[0].data.status, "running");
  ctx.stopExecutionRef.current = true;
  gate.resolve();
  await execution;
});

test("explicit single-node rerun replaces the selected completed task and bypasses stage approval", async () => {
  const calls = [];
  const ctx = environment(["update", "runOnly", "executeNodes", "run", "reconcileNodeTasks"], {
    executionModeRef: { current: "step" }, chatModels: [{ code: "text" }],
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    api: async (url, options) => {
      calls.push(url);
      if (url === "/api/tasks/old") return { task_no: "old", status: "succeeded", output: { text: "old text" } };
      assert.equal(url, "/api/chat/completions");
      return { content: "new script", cost: 0.1 };
    },
  });
  const role = storyRole => ({ storyRole, storyGroupID: "g" });
  ctx.nodesRef.current = [node("input", "textInput", role("input")), node("copy", "generator", { ...role("copy"), modelCode: "text", storyApproved: false }), node("script", "generator", { ...role("script"), modelCode: "text", prompt: "write", taskNo: "old" }), node("sibling")];
  ctx.edgesRef.current = [edge("input", "copy"), edge("copy", "script")];
  for (const n of ctx.nodesRef.current) n.data.lastRunSignature = ctx.nodeRunSignature(n.id, ctx.nodesRef.current, ctx.edgesRef.current);
  const sibling = plain(ctx.nodesRef.current[3]);
  await ctx.runOnly("script");
  assert.deepEqual(calls, ["/api/tasks/old", "/api/chat/completions"]);
  assert.equal(ctx.nodesRef.current[2].data.outputText, "new script");
  assert.equal(ctx.nodesRef.current[2].data.status, "succeeded");
  assert.deepEqual(plain(ctx.nodesRef.current[3]), sibling);
});

test("single-node rerun never duplicates a task still running after a frontend timeout", async () => {
  const gate = deferred();
  let queries = 0;
  const ctx = environment(["update", "runOnly", "reconcileNodeTasks"], {
    api: async () => { queries++; await gate.promise; return { task_no: "paid", status: "running" }; },
    executeNodes: async () => assert.fail("must not resubmit"),
  });
  ctx.nodesRef.current = [node("video", "generator", { status: "failed", taskNo: "paid", outputText: "", error: "frontend timeout" })];
  const first = ctx.runOnly("video");
  await ctx.runOnly("video");
  gate.resolve();
  await first;
  assert.equal(queries, 1);
  assert.equal(ctx.nodesRef.current[0].data.status, "running");
  assert.equal(ctx.nodesRef.current[0].data.taskNo, "paid");
});

for (const pipelineVersion of [1, 2]) test(`V${pipelineVersion} advisory review releases downstream work and the final result before the verdict returns`, async () => {
  const review = deferred(), started = [];
  const ctx = environment(["update", "run", "executeNodes"], {
    chatModels: [{ code: "text" }], imageModels: [{ code: "image" }],
    workspaceRuntimeRef: { current: { quality_model_code: "quality" } },
    modelsForKind: () => [{ code: "image" }, { code: "text" }],
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    normalizeCanvasParamsForModel: params => params, inferSeedanceMaterialMode: () => "text", canvasVisionImages: async urls => urls,
    api: async url => {
      if (url === "/api/tasks") return { task_no: "one", status: "pending" };
      if (url === "/api/tasks/one") return { task_no: "one", status: "succeeded", output: { image_url: "frame.png" } };
      await review.promise;
      throw new Error("review 520");
    },
  });
  ctx.nodesRef.current = [node("frame", "generator", { storyRole: "keyframe", storyPipelineVersion: pipelineVersion, storyQualityMode: "strict", mediaKind: "image", modelCode: "image", prompt: "frame", outputText: "", status: "idle" }), node("next", "generator", { modelCode: "text", prompt: "continue", status: "idle", outputText: "" })];
  ctx.edgesRef.current = [edge("frame", "next")];
  const run = ctx.run;
  ctx.run = async id => {
    started.push(id);
    if (id === "frame") return run(id);
    ctx.update(id, { status: "succeeded", dirty: false, outputText: "final", lastRunSignature: ctx.nodeRunSignature(id, ctx.nodesRef.current, ctx.edgesRef.current) });
  };
  const execution = ctx.executeNodes();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["frame", "next"]);
  assert.equal(ctx.nodesRef.current[0].data.qualityStatus, "checking");
  assert.equal(canvasAgentState(ctx.nodesRef.current, ctx.edgesRef.current, true).status, "succeeded");
  review.resolve();
  await execution;
  assert.equal(ctx.nodesRef.current[0].data.qualityStatus, "unverified");
  assert.equal(ctx.nodesRef.current[0].data.status, "succeeded");
  assert.deepEqual(started, ["frame", "next"]);
});

test("media polling survives the former ten-minute cutoff and temporary query errors", async () => {
  let polls = 0, submissions = 0;
  const ctx = environment(["update", "run"], {
    modelsForKind: () => [{ code: "image" }], parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    normalizeCanvasParamsForModel: params => params, inferSeedanceMaterialMode: () => "text",
    api: async url => {
      if (url === "/api/tasks") { submissions++; return { task_no: "slow", status: "pending" }; }
      polls++;
      if (polls === 3) throw new Error("temporary network failure");
      return { task_no: "slow", status: polls <= 245 ? "running" : "succeeded", upstream_status: "queued", output: polls <= 245 ? {} : { image_url: "saved.png" } };
    },
  });
  ctx.nodesRef.current = [node("image", "generator", { mediaKind: "image", modelCode: "image", prompt: "draw", status: "idle", outputText: "" })];
  await ctx.run("image");
  assert.equal(submissions, 1);
  assert.equal(polls, 246);
  assert.equal(ctx.nodesRef.current[0].data.status, "succeeded");
  assert.equal(ctx.nodesRef.current[0].data.outputUrl, "saved.png");
  assert.match(ctx.canvasTaskStatusHint({ status: "running", upstream_status: "queued", created_at: new Date(Date.now() - 12 * 60000).toISOString() }), /排队.*12 分钟.*查询原任务/);
});

test("recovered single-output tasks keep their ownership when passed to the compositor", async () => {
  const calls = [];
  const ctx = environment(["update", "runCompositor"], {
    api: async (url, options) => {
      if (options) calls.push(JSON.parse(options.body));
      return { task_no: "composed", status: "succeeded", output: { media_kind: "video", video_url: "https://test/final.mp4" } };
    },
  });
  ctx.nodesRef.current = [node("video", "generator", { mediaKind: "video", outputKind: "video", outputUrls: ["https://test/clip.mp4"], taskNo: "restored-task" }), node("final", "compositor")];
  ctx.edgesRef.current = [edge("video", "final")];
  await ctx.runCompositor("final");
  assert.deepEqual(calls[0].sources, [{ kind: "video", url: "https://test/clip.mp4", task_no: "restored-task" }]);
  assert.equal(ctx.nodesRef.current[1].data.status, "succeeded");
});

test("task reconciliation discards responses after the inputs change", async () => {
  const gate = deferred();
  const ctx = environment(["update", "reconcileNodeTasks"], { api: () => gate.promise });
  ctx.nodesRef.current = [node("a", "generator", { mediaKind: "image", taskNo: "old", prompt: "before", status: "idle" })];
  const pending = ctx.reconcileNodeTasks("a");
  ctx.update("a", { prompt: "after" });
  gate.resolve({ status: "succeeded", output: { image_url: "https://test/old.png" } });
  assert.equal(await pending, "stale");
  assert.equal(ctx.nodesRef.current[0].data.outputUrl, undefined);
});

test("narration resumes only tasks belonging to the current input signature", () => {
  const expression = declarations.get("resumableTaskNos").initializer.getText(source);
  const js = ts.transpileModule(`globalThis.result = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const data of [{ activeRunSignature: "current" }, { lastRunSignature: "current" }, { activeRunSignature: "old", lastRunSignature: "old" }]) {
    const ctx = { node: { data: { taskNos: ["speech"], ...data } }, runSignature: "current" };
    vm.runInNewContext(js, ctx);
    assert.deepEqual(plain(ctx.result), Object.values(data).includes("current") ? ["speech"] : []);
  }
});

test("changing only execution mode changes the autosave fingerprint", () => {
  const expression = declarations.get("fingerprint").initializer.getText(source);
  const js = ts.transpileModule(`globalThis.result = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const ctx = { nodes: [], edges: [], title: "Canvas", canvasID: "saved", executionMode: "auto", executionPaused: false };
  vm.runInNewContext(js, ctx);
  const before = ctx.result;
  ctx.executionMode = "step";
  vm.runInNewContext(js, ctx);
  assert.notEqual(ctx.result, before);
});

test("history reuses a recent list and preserves it if refreshing fails", async () => {
  let requests = 0;
  let history = [];
  let error = "";
  const ctx = environment(["refreshHistory"], {
    setHistory: update => { history = typeof update === "function" ? update(history) : update; },
    setHistoryError: value => { error = value; },
    api: async () => { if (++requests > 1) throw new Error("offline"); return { items: [{ public_id: "a" }], has_more: true }; },
  });
  await ctx.refreshHistory();
  await ctx.refreshHistory();
  assert.equal(requests, 1);
  await ctx.refreshHistory(1, true);
  assert.equal(history[0].public_id, "a");
  assert.ok(error);
});

test("opening another history cancels the old request and only applies the latest response", async () => {
  const requests = new Map();
  const applied = [];
  const ctx = environment(["loadCanvas"], {
    api: (url, options) => { const gate = deferred(); requests.set(url, { ...gate, signal: options.signal }); return gate.promise; },
    setCanvasID: id => applied.push(id), normalizeWorkspaceNodes: nodes => nodes,
    changeExecutionMode: noop, setShowEmptyWelcome: noop, setHistoryOpen: noop,
    window: { setTimeout: noop },
  });
  const first = ctx.loadCanvas("a");
  await new Promise(resolve => setImmediate(resolve));
  const second = ctx.loadCanvas("b");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.get("/api/canvases/a").signal.aborted, true);
  requests.get("/api/canvases/b").resolve({ public_id: "b", title: "B", document: { nodes: [node("b")], edges: [] } });
  await second;
  requests.get("/api/canvases/a").resolve({ public_id: "a", title: "A", document: { nodes: [node("a")], edges: [] } });
  await first;
  assert.deepEqual(applied, ["b"]);
  assert.equal(ctx.nodesRef.current[0].id, "b");
});

test("restoring media preserves the result but requires configured quality review", async () => {
  const ctx = environment(["update", "reconcileNodeTasks"], {
    workspaceRuntimeRef: { current: { quality_model_code: "reviewer" } },
    api: async () => ({ status: "succeeded", output: { image_url: "https://test/frame.png" } }),
  });
  ctx.nodesRef.current = [node("frame", "generator", { mediaKind: "image", storyRole: "keyframe", taskNo: "generated", status: "running", actualCost: 1.2 })];
  assert.equal(await ctx.reconcileNodeTasks("frame"), "review");
  const data = ctx.nodesRef.current[0].data;
  assert.equal(data.outputUrl, "https://test/frame.png");
  assert.equal(data.qualityStatus, "checking");
  assert.equal(data.resultTaskNo, "generated");
  assert.equal(data.actualCost, 1.2, "restoring one task must not erase prior generation and review costs");
  assert.equal(data.status, "idle");
  assert.equal(data.dirty, true);
});

test("vision failure and Continue reuse the paid image, falling back only for an unreadable verdict", async () => {
  const calls = [], sheets = [], checkpoints = [];
  let failRead = true;
  const ctx = environment(["update", "run"], {
    workspaceRuntimeRef: { current: { quality_model_code: "backend-default" } },
    chatModels: [{ code: "planning", runtime_rule: { capabilities: { vision: true } } }],
    modelsForKind: () => [{ code: "image", runtime_rule: { image: { max_reference_images: 1 } } }],
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}), normalizeCanvasParamsForModel: params => params,
    inferSeedanceMaterialMode: () => "text",
    createCanvasReferenceSheet: async urls => { sheets.push([...urls]); return {}; },
    uploadAsset: async () => ({ url: "sheet.jpg" }),
    canvasVisionImages: async urls => { if (failRead) throw new Error("500"); return urls; },
    checkpointCanvasRef: { current: async () => { checkpoints.push(plain(ctx.nodesRef.current.at(-1).data)); return true; } },
    api: async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : {};
      calls.push({ url, ...body });
      if (url === "/api/tasks") return { status: "pending", task_no: "paid" };
      if (url === "/api/tasks/paid") return { status: "succeeded", actual_cost: 1, output: { image_url: "result.jpg" } };
      assert.equal(url, "/api/chat/completions");
      assert.deepEqual(body.params.reference_images, ["sheet.jpg", "result.jpg"]);
      return { cost: 0.1, content: JSON.stringify(body.model_code === "quality" ? { checked: false, uncertain: true, reason: "未提供图片" } : { checked: true, uncertain: false, asset_consistency: 95, reason: "一致" }) };
    },
  });
  const role = storyRole => ({ storyRole, storyGroupID: "g" });
  ctx.nodesRef.current = [node("input", "textInput", { ...role("input"), storyQualityMode: "strict", storyQualityModelCode: "quality", referenceImageUrls: ["a.jpg", "b.jpg", "c.jpg"] }), node("board", "generator", { ...role("storyboard"), modelCode: "planning" }), node("asset", "generator", { ...role("asset"), mediaKind: "image", modelCode: "image", prompt: "球衣", referenceImageUrls: ["a.jpg", "b.jpg", "c.jpg"], status: "idle", outputText: "" })];
  ctx.edgesRef.current = [edge("input", "board"), edge("board", "asset")];
  ctx.executionModeRef.current = "step";
  ctx.nodesRef.current[0].data.storyReviewRequired = false;
  await ctx.run("asset");
  let data = ctx.nodesRef.current.at(-1).data;
  assert.equal(data.qualityStatus, "check_failed", data.error);
  assert.equal(data.outputUrl, "result.jpg");
  assert.equal(data.progress, 97);
  assert.ok(checkpoints.some(d => d.outputUrl === "result.jpg" && d.qualityStatus === "checking"));
  failRead = false;
  await ctx.run("asset");
  data = ctx.nodesRef.current.at(-1).data;
  assert.equal(data.status, "succeeded", data.error);
  assert.equal(data.qualityStatus, "passed");
  assert.ok(Math.abs(data.actualCost - 1.2) < 0.0001);
  assert.equal(calls.filter(c => c.url === "/api/tasks").length, 1, "Continue must not regenerate");
  assert.deepEqual(calls.filter(c => c.url === "/api/chat/completions").map(c => c.model_code), ["quality", "planning"]);
  assert.deepEqual(sheets, [["a.jpg", "b.jpg", "c.jpg"]], "reference sheet should be reused");
});

test("asset review uses its own scope; a 520 correction failure preserves the successful task for Continue", async () => {
  for (const failureAt of ["submit", "poll", "contradictory-score"]) {
    let generations = 0, reviews = 0;
    const ctx = environment(["update", "run"], {
      workspaceRuntimeRef: { current: { quality_model_code: "quality" } },
      modelsForKind: () => [{ code: "image" }], parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
      normalizeCanvasParamsForModel: params => params, inferSeedanceMaterialMode: () => "text", canvasVisionImages: async urls => urls,
      api: async (url, options) => {
        const body = options?.body ? JSON.parse(options.body) : {};
        if (url === "/api/tasks") {
          generations++;
          assert.equal(body.params.reference_images, undefined, "football must not inherit unrelated portraits and clothing");
          return { task_no: `task${generations}`, status: generations === 2 && failureAt === "submit" ? "failed" : "pending", error_message: generations === 2 ? "error code: 520" : "" };
        }
        if (url.startsWith("/api/tasks/")) return url.endsWith("task2") ? { task_no: "task2", status: "failed", error_message: "error code: 520" } : { task_no: "task1", status: "succeeded", actual_cost: 1, output: { image_url: "football.png" } };
        assert.equal(url, "/api/chat/completions");
        reviews++;
        assert.deepEqual(body.params.reference_images, ["football.png"]);
        assert.match(body.messages[0].content, /仅验收一张独立资产定稿/);
        assert.match(body.messages[0].content, /禁止因未出现目标之外的人物/);
        return { cost: 0.1, content: JSON.stringify({ checked: true, uncertain: false, asset_consistency: reviews === 1 ? 60 : 95, reason: "足球", defects: reviews === 1 && failureAt !== "contradictory-score" ? ["球体边缘凹陷，目标应为圆球"] : [] }) };
      },
    });
    const role = storyRole => ({ storyRole, storyGroupID: "g", storyQualityMode: "strict" });
    ctx.nodesRef.current = [node("input", "textInput", { ...role("input"), referenceImageUrls: ["person.png", "jersey.png"] }), node("board", "generator", role("storyboard")), node("asset", "generator", { ...role("asset"), modelCode: "image", mediaKind: "image", prompt: "足球", storyAssetDefinition: JSON.stringify({ code: "BALL", name: "足球", type: "prop", visual_prompt: "圆形足球" }), outputText: "", status: "idle" })];
    ctx.edgesRef.current = [edge("input", "board"), edge("board", "asset")];
    ctx.executionModeRef.current = "step";
    ctx.nodesRef.current[0].data.storyReviewRequired = false;
    await ctx.run("asset");
    const failed = ctx.nodesRef.current.at(-1).data;
    assert.equal(failed.taskNo, "task1", failed.error);
    assert.equal(failed.outputUrl, "football.png");
    assert.equal(failed.qualityStatus, "check_failed");
    assert.equal(failed.actualCost, 1.1);
    if (failureAt !== "contradictory-score") { assert.equal(failed.lastAttemptTaskNo, "task2"); assert.match(failed.error, /520.*保留/); }
    const generatedBefore = generations;
    await ctx.run("asset");
    assert.equal(generations, generatedBefore, "Continue must only review the saved image");
    assert.equal(ctx.nodesRef.current.at(-1).data.status, "succeeded", ctx.nodesRef.current.at(-1).data.error);
    assert.equal(generations, failureAt === "contradictory-score" ? 1 : 2);
  }
});

test("advisory review continues with honest warnings, never redraws, and still fails missing media", async () => {
  for (const reviewCase of ["defect", "unavailable", "missing"]) {
    let generations = 0;
    const ctx = environment(["update", "run"], {
      workspaceRuntimeRef: { current: { quality_model_code: "quality" } },
      modelsForKind: () => [{ code: "image" }], parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
      normalizeCanvasParamsForModel: params => params, inferSeedanceMaterialMode: () => "text", canvasVisionImages: async urls => urls,
      api: async url => {
        if (url === "/api/tasks") { generations++; return { task_no: "one", status: "pending" }; }
        if (url === "/api/tasks/one") return { task_no: "one", status: "succeeded", output: reviewCase === "missing" ? {} : { image_url: "saved.png" } };
        if (reviewCase === "unavailable") throw new Error("review 520");
        return { content: JSON.stringify({ checked: true, uncertain: false, asset_consistency: 38, defects: ["包含人物"], reason: "场景有遮挡" }) };
      },
    });
    ctx.nodesRef.current = [node("asset", "generator", { mediaKind: "image", storyRole: "asset", modelCode: "image", prompt: "场景", outputText: "", status: "idle" })];
    await ctx.run("asset");
    const data = ctx.nodesRef.current[0].data;
    assert.equal(generations, 1);
    assert.equal(data.status, reviewCase === "missing" ? "failed" : "succeeded", data.error);
    if (reviewCase !== "missing") {
      assert.equal(data.qualityStatus, reviewCase === "defect" ? "warning" : "unverified");
      assert.equal(ctx.nodeResultReusable(ctx.nodesRef.current[0], ctx.nodesRef.current, []), true);
      assert.equal(canvasQualityResult(ctx.nodesRef.current[0], ctx.nodesRef.current), data.qualityStatus);
      assert.match(canvasAgentState(ctx.nodesRef.current, [], false).content, /视觉提醒或尚未完成验证/);
    }
  }
});

test("advisory recovery accepts an existing failed review only after verifying the successful media task", async () => {
  for (const qualityStatus of ["needs_review", "check_failed"]) {
    let queries = 0;
    const ctx = environment(["update", "reconcileNodeTasks", "configureStory"], {
      workspaceRuntimeRef: { current: { quality_model_code: "quality" } },
      api: async url => { queries++; assert.equal(url, "/api/tasks/saved"); return { status: "succeeded", output: { image_url: "saved.png" } }; },
    });
    ctx.nodesRef.current = [node("input", "textInput", { storyRole: "input", storyGroupID: "g" }), node("asset", "generator", { storyRole: "asset", storyGroupID: "g", status: "failed", mediaKind: "image", taskNo: "saved", outputUrl: "saved.png", outputKind: "image", qualityStatus, warning: "原验收意见", dirty: true })];
    ctx.edgesRef.current = [edge("input", "asset")];
    const asset = ctx.nodesRef.current[1];
    asset.data.activeRunSignature = ctx.nodeRunSignature("asset", ctx.nodesRef.current, ctx.edgesRef.current);
    const signature = asset.data.activeRunSignature;
    assert.equal(await ctx.reconcileNodeTasks("asset"), "succeeded");
    assert.equal(queries, 1);
    assert.equal(ctx.nodesRef.current[1].data.qualityStatus, qualityStatus === "needs_review" ? "warning" : "unverified");
    ctx.configureStory("input", 1, 8, undefined, {}, { qualityMode: "strict" });
    assert.equal(canvasStrictQuality(ctx.nodesRef.current[1], ctx.nodesRef.current), true);
    assert.equal(canvasQualityResult(ctx.nodesRef.current[1], ctx.nodesRef.current), "");
    assert.equal(ctx.nodesRef.current[1].data.outputUrl, "saved.png");
    assert.equal(ctx.nodeRunSignature("asset", ctx.nodesRef.current, ctx.edgesRef.current), signature);
  }
});

test("V2 recovery releases a paid video saved by the old strict review rule", async () => {
  let queries = 0;
  const ctx = environment(["update", "reconcileNodeTasks"], {
    workspaceRuntimeRef: { current: { quality_model_code: "quality" } },
    api: async url => {
      queries++;
      assert.equal(url, "/api/tasks/saved-video");
      return { status: "succeeded", output: { video_url: "saved.mp4" } };
    },
  });
  ctx.nodesRef.current = [
    node("input", "textInput", { storyRole: "input", storyGroupID: "g", storyPipelineVersion: 2, storyQualityMode: "strict" }),
    node("video", "generator", { storyRole: "video", storyGroupID: "g", status: "failed", mediaKind: "video", taskNo: "saved-video", outputUrl: "saved.mp4", outputKind: "video", qualityStatus: "check_failed", error: "旧版视觉验收未完成", dirty: true }),
  ];
  ctx.edgesRef.current = [edge("input", "video")];
  const video = ctx.nodesRef.current[1];
  video.data.activeRunSignature = ctx.nodeRunSignature("video", ctx.nodesRef.current, ctx.edgesRef.current);

  assert.equal(canvasStrictQuality(video, ctx.nodesRef.current, "step"), false);
  assert.equal(await ctx.reconcileNodeTasks("video"), "succeeded");
  assert.equal(queries, 1);
  assert.equal(ctx.nodesRef.current[1].data.status, "succeeded");
  assert.equal(ctx.nodesRef.current[1].data.progress, 100);
  assert.equal(ctx.nodesRef.current[1].data.qualityStatus, "unverified");
  assert.equal(ctx.nodesRef.current[1].data.outputUrl, "saved.mp4");
});

test("mixed original references and generated assets retain upload ordering in the keyframe request", async () => {
  const sheets = [], requests = [];
  const ctx = environment(["update", "run"], {
    modelsForKind: () => [{ code: "image", runtime_rule: { image: { max_reference_images: 1 } } }],
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}), normalizeCanvasParamsForModel: params => params,
    inferSeedanceMaterialMode: () => "text",
    createCanvasReferenceSheet: async urls => { sheets.push([...urls]); return {}; }, uploadAsset: async () => ({ url: "sheet.jpg" }),
    api: async (url, options) => { requests.push(JSON.parse(options.body)); return { status: "failed", task_no: "test-only" }; },
  });
  const role = storyRole => ({ storyRole, storyGroupID: "g" });
  const shot = { segment_index: 1, duration_seconds: 9, scene: "场景", camera: "近景", image_prompt: "参考图2的商品", video_prompt: "运动", assets: [] };
  ctx.nodesRef.current = [node("input", "textInput", { ...role("input"), referenceImageUrls: ["person.jpg", "product.jpg", "shoe.jpg"] }), node("board", "generator", { ...role("storyboard"), outputText: JSON.stringify([shot]) }), node("asset", "generator", { ...role("asset"), storyAssetCode: "BACKGROUND", outputKind: "image", outputUrl: "background.jpg" }), node("frame", "generator", { ...role("keyframe"), mediaKind: "image", modelCode: "image", storySegmentIndex: 1 })];
  ctx.edgesRef.current = [edge("input", "board"), edge("board", "asset"), edge("asset", "frame"), edge("board", "frame")];
  await ctx.run("frame");
  assert.deepEqual(sheets, [["person.jpg", "product.jpg", "shoe.jpg", "background.jpg"]]);
  assert.equal(requests.length, 1, ctx.nodesRef.current.at(-1).data.error);
  assert.deepEqual(requests[0].params.reference_images, ["sheet.jpg"]);
  assert.match(requests[0].prompt, /参考版第2格的商品/);
  assert.match(requests[0].prompt, /参考版第4格 = BACKGROUND/);
});

test("subtitle style changes invalidate only final composition and preserve paid video signatures", () => {
  const ctx = environment(["configureStory"], { normalizeStoryNarrationMode: mode => mode || "auto" });
  const role = storyRole => ({ storyRole, storyGroupID: "g" });
  ctx.nodesRef.current = [node("input", "textInput", { ...role("input"), storySegmentCount: 2, storySegmentDuration: 8 }), node("video", "generator", { ...role("video"), mediaKind: "video", outputUrl: "paid.mp4", taskNo: "paid", actualCost: 10 }), node("final", "compositor", { ...role("final"), outputUrl: "old.mp4" })];
  ctx.edgesRef.current = [edge("input", "video"), edge("video", "final")];
  const signature = ctx.nodeRunSignature("video", ctx.nodesRef.current, ctx.edgesRef.current);
  ctx.configureStory("input", 2, 8, undefined, {}, { subtitleStyle: "soft_box", subtitleTiming: "speech" });
  assert.equal(ctx.nodesRef.current[0].data.storySubtitleStyle, "soft_box");
  assert.equal(ctx.nodesRef.current[1].data.outputUrl, "paid.mp4");
  assert.equal(ctx.nodesRef.current[1].data.taskNo, "paid");
  assert.equal(ctx.nodeRunSignature("video", ctx.nodesRef.current, ctx.edgesRef.current), signature);
  assert.equal(ctx.nodesRef.current[2].data.status, "stale");
  assert.equal(ctx.nodesRef.current[2].data.dirty, true);
  assert.equal(ctx.nodesRef.current[2].data.storySubtitleStyle, "soft_box");
});

test("changing the input reviewer preserves media and generation signatures, and remains branch-local", () => {
  const ctx = environment(["configureStory"], { chatModels: [{ code: "vision", runtime_rule: { capabilities: { vision: true } } }, { code: "text" }] });
  const role = storyRole => ({ storyRole, storyGroupID: "g" });
  ctx.nodesRef.current = [node("input", "textInput", role("input")), node("frame", "generator", { ...role("keyframe"), mediaKind: "image", outputUrl: "saved.jpg", taskNo: "paid", actualCost: 3, qualityStatus: "passed" }), node("other", "generator", { storyGroupID: "other" })];
  ctx.edgesRef.current = [edge("input", "frame")];
  const signature = ctx.nodeRunSignature("frame", ctx.nodesRef.current, ctx.edgesRef.current);
  ctx.configureStory("input", 1, 8, undefined, { quality: "vision" });
  const [input, frame, other] = ctx.nodesRef.current;
  assert.equal(input.data.storyQualityModelCode, "vision");
  assert.equal(frame.data.outputUrl, "saved.jpg");
  assert.equal(frame.data.taskNo, "paid");
  assert.equal(frame.data.actualCost, 3);
  assert.equal(frame.data.qualityStatus, "checking");
  assert.equal(ctx.nodeRunSignature("frame", ctx.nodesRef.current, ctx.edgesRef.current), signature);
  assert.equal(canvasQualityModel(frame, ctx.nodesRef.current, "backend"), "vision");
  assert.equal(canvasQualityModel(other, ctx.nodesRef.current, "backend"), "backend");
  ctx.configureStory("input", 1, 8, undefined, { quality: "text" });
  assert.equal(ctx.nodesRef.current[0].data.storyQualityModelCode, "vision");
  ctx.configureStory("input", 1, 8, undefined, { quality: "" });
  assert.equal(canvasQualityModel(frame, ctx.nodesRef.current, "backend"), "backend");
});

test("asset planning follows actual reuse and validated reference bindings for any shot duration", () => {
  const asset = code => ({ code, type: "prop", name: code, visual_prompt: code });
  for (const count of [1, 2, 5, 13]) {
    const shots = Array.from({ length: count }, (_, i) => ({ duration_seconds: [3, 7, 12, 5][i % 4], assets: [asset("shared"), { ...asset("product"), reference_image_indexes: [2] }, asset(`once-${i}`)] }));
    const plan = storyAssetPlan(shots, 3);
    assert.deepEqual(plan.generated.map(a => a.code), count > 1 ? ["shared"] : []);
    assert.deepEqual(plan.referenced.map(a => a.code), count > 1 ? ["product"] : []);
    if (count > 1) {
      assert.deepEqual(storyAssetPlan(shots, 1).generated.map(a => a.code), ["shared", "product"], "out-of-range indexes cannot waive generation");
      shots[0].assets[1].reference_image_indexes = [1];
      assert.deepEqual(storyAssetPlan(shots, 3).generated.map(a => a.code), ["shared", "product"], "conflicting bindings cannot silently swap products");
    }
  }
});

test("both workflows generate native dialogue without requiring an audio or lip-sync model", async () => {
  for (const workflow of ["story", "viral"]) for (const useAudioModel of [undefined, false]) {
    const requests = [];
    const shot = { segment_index: 1, index: 1, duration_seconds: 8, duration: 8, scene: "人物说话", camera: "近景", image_prompt: "起点", keyframe_prompt: "起点", video_prompt: "先旁白，再人物说你好", speeches: [{ text: "他来了", speaker_code: "NARRATOR", speech_type: "narration" }, { text: "你好", speaker_code: "A", speech_type: "dialogue" }] };
    const role = value => workflow === "story" ? { storyRole: value, storyGroupID: "g", storySegmentCount: 1, storySegmentIndex: 1 } : { viralRole: value === "storyboard" ? "analysis" : value, viralGroupID: "g", viralSegmentCount: 1, viralSegmentIndex: 1 };
    const ctx = environment(["update", "run"], {
      modelsForKind: () => [{ code: "video", default_params: { generate_audio: false } }],
      parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
      inferSeedanceMaterialMode: () => "text", normalizeCanvasParamsForModel: params => params,
      buildVideoTaskParams: params => params, canvasImageReferenceLimit: () => 4,
      api: async (url, options) => { assert.equal(url, "/api/tasks"); requests.push(JSON.parse(options.body)); return { status: "failed", task_no: "test-only" }; },
    });
    ctx.nodesRef.current = [node("board", "generator", { ...role("storyboard"), outputText: JSON.stringify(workflow === "story" ? [shot] : { segments: [shot] }) }), node("frame", "generator", { ...role("keyframe"), outputKind: "image", outputUrl: "frame.png" }), node("video", "generator", { ...role("video"), mediaKind: "video", modelCode: "video", useAudioModel, prompt: "当前镜头改成环境中景" }), node("brief", "textInput", { ...role(workflow === "story" ? "input" : "brief"), prompt: "人物为原创虚构主播，全程蓝衣，保留产品标志" })];
    ctx.edgesRef.current = [edge("brief", "board"), edge("board", "frame"), edge("frame", "video")];
    await ctx.run("video");
    assert.equal(requests.length, 1, ctx.nodesRef.current[2].data.error);
    assert.equal(requests[0].params.generate_audio, true);
    assert.match(requests[0].prompt, /由视频模型同时生成画面与原声音轨/);
    assert.doesNotMatch(requests[0].prompt, /配音由音频模型另行生成/);
    assert.match(requests[0].prompt, /人物为原创虚构主播，全程蓝衣，保留产品标志/);
    assert.match(requests[0].prompt, /当前镜头改成环境中景/);
  }
});

test("native final composition preserves each shot's duration and never calls TTS or lip sync", async () => {
  for (const workflow of ["story", "viral"]) for (const useAudioModel of [undefined, false]) {
    const requests = [];
    const role = value => workflow === "story" ? { storyRole: value, storyGroupID: "g" } : { viralRole: value === "storyboard" ? "analysis" : value, viralGroupID: "g" };
    const shots = [1, 2].map(index => ({ index, segment_index: index, duration: 8, ...(workflow === "story" ? { duration_seconds: 8 } : {}), scene: "scene", camera: "camera", image_prompt: "still", keyframe_prompt: "still", video_prompt: "motion", speeches: [{ text: "你好", speaker_code: "A", speech_type: "dialogue" }] }));
    const ctx = environment(["update", "runCompositor"], {
      preferredNarrationAudioModel: () => undefined,
      assignStoryVoices: plan => { assert.equal(plan.length, 0); return {}; },
      api: async (url, options) => {
        if (options?.method === "POST") {
          assert.equal(url, "/api/canvases/compose", "native mode submitted an audio or lip-sync task");
          requests.push(JSON.parse(options.body));
        }
        return { status: "succeeded", task_no: `compose-${requests.length}`, output: { video_url: "result.mp4" } };
      },
    });
    ctx.nodesRef.current = [node("board", "generator", { ...role("storyboard"), outputText: JSON.stringify(workflow === "story" ? shots : { segments: shots }) }), ...[1, 2].map(index => node(`v${index}`, "generator", { ...role("video"), mediaKind: "video", outputKind: "video", outputUrl: `v${index}.mp4`, taskNo: `v${index}`, storySegmentIndex: index, viralSegmentIndex: index })), node("final", "compositor", { ...role("final"), useAudioModel, targetDuration: 15 })];
    ctx.edgesRef.current = [edge("v1", "final"), edge("v2", "final")];
    await ctx.runCompositor("final");
    assert.equal(ctx.nodesRef.current.at(-1).data.status, "succeeded", ctx.nodesRef.current.at(-1).data.error);
    assert.deepEqual(requests.map(item => item.mode), ["auto", "auto", "auto"]);
    assert.deepEqual(requests.map(item => item.target_duration_sec), [8, 7, 0]);
    assert.ok(requests.every(item => item.sources.every(source => source.kind === "video")));
  }
});

test("audio switches update both graphs without discarding their scripts or keyframes", () => {
  let nextID = 0;
  const models = { chatModels: [{ code: "chat" }], imageModels: [{ code: "image" }], videoModels: [{ code: "video", default_params: { generate_audio: true } }], audioModels: [{ code: "voice" }] };
  const ctx = environment(["configureStory", "configureViral"], {
    ...models, crypto, MarkerType: { ArrowClosed: "arrow" }, newNodeID: () => `new-${++nextID}`,
    preferredMultimodalChatModel: items => items[0], preferredVideoAnalysisChatModel: items => items[0], preferredVideoModel: items => items[0], preferredNarrationAudioModel: items => items[0], referenceImageModels: items => items,
    normalizeStoryNarrationMode: value => value || "smart", normalizeStoryCreationType: value => value || "story", normalizeStoryPlatform: value => value || "douyin", normalizeStoryAspectRatio: value => value || "9:16",
    storyDurationOptions: () => [8], preferredStoryDuration: () => 8, storyModelSupportsDuration: () => true,
    canvasModelDefaults: (_kind, model) => model?.default_params || {}, aspectRatioParams: (_model, params) => params, normalizeCanvasParamsForModel: params => params, parseVideoRuntime: () => ({}),
  });
  for (const workflow of ["story", "viral"]) {
    const role = value => workflow === "story" ? { storyGroupID: "g", storyRole: value } : { viralGroupID: "g", viralRole: value, viralVariant: "one_click" };
    ctx.nodesRef.current = [node("input", "textInput", role(workflow === "story" ? "input" : "brief")), node("script", "generator", role(workflow === "story" ? "script" : "analysis")), node("final", "compositor", role("final"))];
    ctx.edgesRef.current = [];
    const configure = enabled => workflow === "story" ? ctx.configureStory("input", 2, 8, undefined, {}, { useAudioModel: enabled }) : ctx.configureViral("input", 2, 8, {}, enabled);
    configure();
    assert.equal(ctx.nodesRef.current.find(n => n.id === "input").data.useAudioModel, false);
    assert.equal(ctx.nodesRef.current.find(n => n.id === "final").data.useAudioModel, false);
    assert.ok(ctx.nodesRef.current.filter(n => n.data.storyRole === "video" || n.data.viralRole === "video").every(n => n.data.params.generate_audio === true && n.data.useAudioModel === false));
    assert.ok(!ctx.nodesRef.current.some(n => ["narration", "narrationText"].includes(n.data.storyRole)));
    configure(true);
    configure(); // Explicit opt-in survives later configuration changes.
    assert.equal(ctx.nodesRef.current.find(n => n.id === "input").data.useAudioModel, true);
    for (const n of ctx.nodesRef.current.filter(n => n.type !== "textInput")) Object.assign(n.data, { status: "succeeded", dirty: false, outputText: "saved text", outputUrl: "saved.png" });
    if (workflow === "story") {
      ctx.nodesRef.current.push(node("asset", "generator", { ...role("asset"), outputUrl: "asset.png" }));
      const board = ctx.nodesRef.current.find(n => n.data.storyRole === "storyboard");
      const frame = ctx.nodesRef.current.find(n => n.data.storyRole === "keyframe");
      ctx.edgesRef.current.push(edge(board.id, "asset"), edge("asset", frame.id));
    }
    configure(false);
    ctx.nodesRef.current = plain(ctx.nodesRef.current); // Saved setting survives reload.
    assert.equal(ctx.nodesRef.current.find(n => n.id === "input").data.useAudioModel, false);
    assert.equal(ctx.nodesRef.current.find(n => n.id === "script").data.outputText, "saved text");
    assert.ok(ctx.nodesRef.current.filter(n => n.data.storyRole === "keyframe" || n.data.viralRole === "keyframe").every(n => n.data.outputUrl === "saved.png"));
    assert.ok(ctx.nodesRef.current.filter(n => n.data.storyRole === "video" || n.data.viralRole === "video").every(n => n.data.params.generate_audio === true && n.data.useAudioModel === false));
    assert.equal(ctx.nodesRef.current.find(n => n.id === "final").data.useAudioModel, false);
    if (workflow === "story") {
      assert.ok(!ctx.nodesRef.current.some(n => ["narration", "narrationText"].includes(n.data.storyRole)));
      assert.equal(ctx.nodesRef.current.find(n => n.id === "asset").data.outputUrl, "asset.png");
    }
    configure(true);
    assert.ok(ctx.nodesRef.current.filter(n => n.data.storyRole === "video" || n.data.viralRole === "video").every(n => n.data.params.generate_audio === false));
    if (workflow === "story") assert.ok(ctx.nodesRef.current.some(n => n.data.storyRole === "narration" && n.data.modelCode === "voice"));
  }
});

test("enabled remake dubbing uses the selected audio model and replaces native speech", async () => {
  const requests = [];
  const shot = { index: 1, duration: 8, keyframe_prompt: "起点", video_prompt: "运动", speeches: [{ text: "逐镜旁白", speaker_code: "NARRATOR", speech_type: "narration" }] };
  const ctx = environment(["update", "runCompositor"], {
    audioModels: [{ code: "default-voice" }, { code: "selected-voice" }],
    preferredNarrationAudioModel: items => items[0], canvasModelDefaults: () => ({}),
    assignStoryVoices: () => ({}), buildAudioTaskParams: params => params,
    api: async (url, options) => {
      if (options?.method === "POST") requests.push({ url, ...JSON.parse(options.body) });
      return { status: "succeeded", task_no: `task-${requests.length}`, output: { video_url: "final.mp4", audio_url: "voice.mp3" } };
    },
  });
  ctx.nodesRef.current = [node("board", "generator", { viralGroupID: "g", viralRole: "analysis", outputText: JSON.stringify({ segments: [shot] }) }), node("video", "generator", { viralGroupID: "g", viralRole: "video", viralSegmentIndex: 1, outputKind: "video", outputUrl: "v.mp4", taskNo: "v" }), node("final", "compositor", { viralGroupID: "g", viralRole: "final", useAudioModel: true, viralAudioModelCode: "selected-voice", targetDuration: 8 })];
  ctx.edgesRef.current = [edge("video", "final")];
  await ctx.runCompositor("final");
  assert.equal(ctx.nodesRef.current.at(-1).data.status, "succeeded", ctx.nodesRef.current.at(-1).data.error);
  assert.deepEqual(requests.filter(item => item.url === "/api/tasks").map(item => [item.model_code, item.prompt]), [["selected-voice", "逐镜旁白"]]);
  assert.deepEqual(requests.filter(item => item.url === "/api/canvases/compose").map(item => item.mode), ["speech", "auto"]);
});

test("task recovery runs at most four queries concurrently and saves one checkpoint", async () => {
  let active = 0, peak = 0, saves = 0;
  const ctx = environment(["reconcileCanvasTasks"], {
    reconcileNodeTasks: async (_id, persist) => {
      assert.equal(persist, false);
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      return "succeeded";
    },
    checkpointCanvasRef: { current: async () => { saves++; return true; } },
  });
  ctx.nodesRef.current = Array.from({ length: 12 }, (_, i) => node(`${i}`, "generator", { mediaKind: "image", taskNo: `t${i}`, status: "idle", outputText: "" }));
  const result = await ctx.reconcileCanvasTasks();
  assert.equal(result.restored, 12);
  assert.equal(peak, 4);
  assert.equal(saves, 1);
});

test("500-node graph traversal reads edges linearly and retains dependency order", () => {
  const ctx = environment();
  const nodes = Array.from({ length: 500 }, (_, i) => node(`${i}`));
  let reads = 0;
  const edges = nodes.slice(1).map((_, i) => ({ id: `e${i}`, get source() { reads++; return `${i}`; }, get target() { reads++; return `${i + 1}`; } }));
  assert.equal(ctx.collectUpstreamNodes("499", nodes, edges).length, 499);
  assert.equal(ctx.collectDownstreamIDs("0", edges).size, 499);
  assert.deepEqual(plain(ctx.orderedGeneratorNodes(nodes, edges).map(n => n.id)), nodes.map(n => n.id));
  assert.ok(reads < edges.length * 12, `too many edge reads: ${reads}`);
});


function productionCanvas(callbacks, overrides = {}) {
  let id = 0;
  return environment(callbacks, {
    crypto, MarkerType: { ArrowClosed: "arrow" }, newNodeID: () => "new-" + ++id,
    chatModels: [{ code: "chat" }], imageModels: [{ code: "image" }], audioModels: [],
    videoModels: [{ code: "seedance", default_params: { duration: 8, generate_audio: true }, runtime_rule: { upload_profile: "seedance_2" } }, { code: "veo", default_params: { duration: 8, generate_audio: true }, runtime_rule: { upload_profile: "veo_reference" } }],
    preferredMultimodalChatModel: items => items[0], preferredVideoModel: items => items[0], preferredNarrationAudioModel: items => items[0],
    normalizeStoryNarrationMode: value => value || "smart", normalizeStoryCreationType: value => value || "story", normalizeStoryPlatform: value => value || "douyin", normalizeStoryAspectRatio: value => value || "9:16",
    storyDurationOptions: model => model?.code === "seedance" ? [8, 15] : [8], preferredStoryDuration: () => 8, storyModelSupportsDuration: () => true,
    canvasModelDefaults: (_kind, model) => model?.default_params || {}, aspectRatioParams: (_model, params) => params, normalizeCanvasParamsForModel: params => params, parseVideoRuntime: rule => rule || {},
    ...overrides,
  });
}

test("15-second production keeps all storyboard frames, switches channel strategy, and skips supplied copy", () => {
  const ctx = productionCanvas(["configureStory"]);
  const role = value => ({ storyGroupID: "g", storyRole: value });
  ctx.nodesRef.current = [node("input", "textInput", { ...role("input"), storyContinuityMode: "video_tail", storySegmentCount: 2, storySegmentDuration: 8 }), node("script", "generator", role("script")), node("final", "compositor", role("final"))];
  ctx.configureStory("input", 2, 8, undefined, {}, { targetDuration: 15 });
  const byRole = role => ctx.nodesRef.current.filter(n => n.data.storyRole === role);
  assert.equal(byRole("copy").length, 1);
  assert.equal(byRole("keyframe").length, 2);
  assert.equal(byRole("video").length, 1);
  assert.equal(byRole("video")[0].data.params.duration, 15);
  assert.equal(byRole("video")[0].data.storyWholeVideo, true);
  assert.equal(ctx.edgesRef.current.filter(e => e.target === byRole("video")[0].id).length, 2);
  ctx.configureStory("input", 2, 8, undefined, { video: "veo" });
  assert.equal(byRole("video").length, 2);
  assert.ok(byRole("video").every(n => n.data.params.duration === 8 && !n.data.storyWholeVideo));
  assert.equal(byRole("final")[0].data.targetDuration, 15);
  assert.equal(byRole("storyboard")[0].data.params.target_duration_sec, 15);
  ctx.configureStory("input", 2, 8, undefined, {}, { scriptProvided: true });
  assert.equal(byRole("copy").length, 0);
  assert.ok(ctx.edgesRef.current.some(e => e.source === "input" && e.target === "script"));
  assert.equal(ctx.validCanvasDocument(plain({ nodes: ctx.nodesRef.current, edges: ctx.edgesRef.current })), true);
});

test("whole-video request includes every shot and frame; composition retains 15 seconds without TTS", async () => {
  const requests = [];
  const shots = [1, 2].map(i => ({ segment_index: i, duration_seconds: i === 1 ? 8 : 7, scene: "场景" + i, camera: "近景", image_prompt: "静态" + i, video_prompt: "动作" + i, speeches: [{ text: "台词" + i, speaker_code: "A", speech_type: "dialogue" }] }));
  const role = value => ({ storyGroupID: "g", storyRole: value, storySegmentCount: 2 });
  const ctx = productionCanvas(["update", "run", "runCompositor"], {
    modelsForKind: () => [{ code: "seedance", default_params: { duration: 8, generate_audio: true }, runtime_rule: { upload_profile: "seedance_2" } }],
    parseAudioRuntime: () => ({}), inferSeedanceMaterialMode: () => "reference", buildVideoTaskParams: params => params,
    assignStoryVoices: plan => { assert.equal(plan.length, 0); return {}; },
    api: async (url, options) => { if (options?.method === "POST") requests.push({ url, ...JSON.parse(options.body) }); return { status: url === "/api/tasks" ? "failed" : "succeeded", task_no: "mock", output: { video_url: "joined.mp4" } }; },
  });
  ctx.nodesRef.current = [node("board", "generator", { ...role("storyboard"), outputText: JSON.stringify(shots) }), ...[1, 2].map(i => node("f" + i, "generator", { ...role("keyframe"), storySegmentIndex: i, outputKind: "image", outputUrl: "f" + i + ".png" })), node("video", "generator", { ...role("video"), storyWholeVideo: true, mediaKind: "video", modelCode: "seedance", params: { duration: 15 }, storySegmentIndex: 1 })];
  ctx.edgesRef.current = [edge("board", "f1"), edge("board", "f2"), edge("f1", "video"), edge("f2", "video")];
  ctx.nodesRef.current.at(-1).data.prompt = "整段采用固定镜头，人物是原创虚构主播";
  await ctx.run("video");
  assert.equal(requests.length, 1, ctx.nodesRef.current.at(-1).data.error);
  assert.equal(requests[0].params.duration, 15);
  assert.match(requests[0].prompt, /整段采用固定镜头，人物是原创虚构主播/);
  for (const value of ["动作1", "动作2", "台词1", "台词2"]) assert.ok(requests[0].prompt.includes(value));
  Object.assign(ctx.nodesRef.current.at(-1).data, { status: "succeeded", dirty: false, outputKind: "video", outputUrl: "native.mp4" });
  ctx.nodesRef.current.push(node("final", "compositor", { ...role("final"), storyWholeVideo: true, targetDuration: 15 }));
  ctx.edgesRef.current.push(edge("video", "final"));
  await ctx.runCompositor("final");
  assert.equal(ctx.nodesRef.current.at(-1).data.status, "succeeded", ctx.nodesRef.current.at(-1).data.error);
  assert.deepEqual(requests.slice(1).map(r => [r.url, r.mode, r.target_duration_sec]), [["/api/canvases/compose", "auto", 15], ["/api/canvases/compose", "auto", 0]]);
});

test("story video sends only connected keyframes and never finalized asset images", async () => {
  const requests = [];
  const actor = { code: "ACTOR", type: "character", name: "主持人", visual_prompt: "深色西装" };
  const studio = { code: "STUDIO", type: "location", name: "演播室", visual_prompt: "财经演播室" };
  const shot = { segment_index: 1, duration_seconds: 8, scene: "演播室", camera: "中景", image_prompt: "主持人讲解", video_prompt: "主持人自然讲解", assets: [actor, studio], speeches: [] };
  const videoModel = { code: "veo", default_params: {}, input_schema: {}, runtime_rule: { upload_profile: "veo_reference" } };
  const ctx = environment(["update", "run"], {
    videoModels: [videoModel],
    modelsForKind: () => [videoModel],
    parseVideoRuntime: rule => rule || {}, parseAudioRuntime: () => ({}),
    normalizeCanvasParamsForModel: params => params, inferSeedanceMaterialMode: () => "reference",
    buildVideoTaskParams: (params, media) => ({ ...params, reference_images: media.reference_images.map(item => item.url) }),
    api: async (url, options) => {
      assert.equal(url, "/api/tasks");
      requests.push(JSON.parse(options.body));
      return { status: "failed", task_no: "stop-after-request", error_message: "test complete" };
    },
  });
  const role = storyRole => ({ storyRole, storyGroupID: "g" });
  ctx.nodesRef.current = [
    node("input", "textInput", { ...role("input"), prompt: "人物是原创虚构主播TK，保持蓝色外套" }),
    node("board", "generator", { ...role("storyboard"), prompt: "不要面部特写，采用环境中景", outputText: JSON.stringify([shot]) }),
    node("actor", "generator", { ...role("asset"), storyAssetCode: "ACTOR", outputKind: "image", outputUrl: "actor.png" }),
    node("studio", "generator", { ...role("asset"), storyAssetCode: "STUDIO", outputKind: "image", outputUrl: "studio.png" }),
    node("frame", "generator", { ...role("keyframe"), storySegmentIndex: 1, outputKind: "image", outputUrl: "keyframe.png" }),
    node("video", "generator", { ...role("video"), storySegmentIndex: 1, mediaKind: "video", modelCode: "veo", status: "idle", outputText: "" }),
  ];
  ctx.edgesRef.current = [edge("input", "board"), edge("board", "actor"), edge("board", "studio"), edge("actor", "frame"), edge("studio", "frame"), edge("board", "frame"), edge("frame", "video")];
  await ctx.run("video", true);
  assert.deepEqual(requests[0].params.reference_images, ["keyframe.png"]);
  assert.ok(!JSON.stringify(requests[0]).includes("actor.png"));
  assert.ok(!JSON.stringify(requests[0]).includes("studio.png"));
  assert.match(requests[0].prompt, /人物是原创虚构主播TK，保持蓝色外套/);
  assert.match(requests[0].prompt, /不要面部特写，采用环境中景/);
  ctx.update("video", { prompt: "当前修改：固定镜头，不推近" });
  await ctx.run("video", true);
  assert.match(requests[1].prompt, /当前修改：固定镜头，不推近/);
  assert.match(requests[1].prompt, /人物是原创虚构主播TK/);
  assert.deepEqual(requests[1].params.reference_images, ["keyframe.png"]);
});

test("V2 videos use the first keyframe, then previous tail to current keyframe, without asset images", async () => {
  const requests = [];
  const actor = { code: "ACTOR", type: "character", name: "主持人", visual_prompt: "深色西装" };
  const studio = { code: "STUDIO", type: "location", name: "演播室", visual_prompt: "财经演播室" };
  const shots = [1, 2].map(segment_index => ({ segment_index, duration_seconds: 8, scene: "演播室", camera: "中景", image_prompt: "主持人讲解", video_prompt: "主持人自然讲解", assets: [actor, studio], speeches: [] }));
  const videoModel = { code: "veo-fl", default_params: {}, input_schema: {}, runtime_rule: { video: { upload_profile: "veo_frame_pair", max_total_images: 2 } } };
  const ctx = environment(["update", "run"], {
    videoModels: [videoModel], modelsForKind: () => [videoModel],
    parseVideoRuntime: rule => rule.video || {}, parseAudioRuntime: () => ({}),
    normalizeCanvasParamsForModel: params => params, inferSeedanceMaterialMode: () => "reference",
    buildVideoTaskParams: (params, media) => ({ ...params, first_frame: media.first_frame?.url, last_frame: media.last_frame?.url, reference_images: media.reference_images.map(item => item.url) }),
    api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { status: "failed", task_no: "stop-after-request", error_message: "test complete" }; },
  });
  const role = storyRole => ({ storyRole, storyGroupID: "g" });
  ctx.nodesRef.current = [
    node("input", "textInput", { ...role("input"), storyPipelineVersion: 2, storyQualityMode: "strict", storyContinuityMode: "video_tail" }),
    node("board", "generator", { ...role("storyboard"), outputText: JSON.stringify(shots) }),
    node("actor", "generator", { ...role("asset"), storyAssetCode: "ACTOR", outputKind: "image", outputUrl: "actor.png" }),
    node("studio", "generator", { ...role("asset"), storyAssetCode: "STUDIO", outputKind: "image", outputUrl: "studio.png" }),
    node("frame1", "generator", { ...role("keyframe"), storySegmentIndex: 1, outputKind: "image", outputUrl: "keyframe1.png" }),
    node("frame2", "generator", { ...role("keyframe"), storySegmentIndex: 2, outputKind: "image", outputUrl: "keyframe2.png" }),
    node("video1", "generator", { ...role("video"), storySegmentIndex: 1, mediaKind: "video", modelCode: "veo-fl", status: "idle", outputText: "" }),
    node("video2", "generator", { ...role("video"), storySegmentIndex: 2, mediaKind: "video", modelCode: "veo-fl", status: "idle", outputText: "" }),
  ];
  ctx.edgesRef.current = [edge("input", "board"), edge("board", "frame1"), edge("board", "frame2"), edge("actor", "frame1"), edge("studio", "frame1"), edge("actor", "frame2"), edge("studio", "frame2"), edge("frame1", "video1"), edge("frame2", "video2"), edge("video1", "video2"), edge("actor", "video1")];
  await ctx.run("video1", true);
  assert.equal(requests[0].params.first_frame, "keyframe1.png");
  assert.equal(requests[0].params.last_frame, undefined);
  assert.deepEqual(requests[0].params.reference_images, []);
  assert.ok(!JSON.stringify(requests[0]).includes("actor.png"));
  Object.assign(ctx.nodesRef.current.find(item => item.id === "video1").data, { status: "succeeded", dirty: false, outputKind: "video", outputUrl: "clip1.mp4", storyTailFrameSource: "clip1.mp4", storyTailFrameURL: "tail1.png" });
  await ctx.run("video2", true);
  assert.equal(requests[1].params.first_frame, "tail1.png");
  assert.equal(requests[1].params.last_frame, "keyframe2.png");
  assert.deepEqual(requests[1].params.reference_images, []);
  assert.match(requests[1].prompt, /上一片段的实际尾帧/);
  assert.match(requests[1].prompt, /No generated subtitles, captions, title cards or text overlays/);
  assert.match(requests[1].prompt, /最后一段必须结束观点/);
  assert.doesNotMatch(requests[1].prompt, /85%-95%/);
});

test("V2 keyframe excludes unrelated uploads and prefers canonical generated assets", async () => {
  const requests = [];
  const actor = { code: "ACTOR", type: "character", name: "主持人", visual_prompt: "深色西装" };
  const product = { code: "PRODUCT", type: "prop", name: "产品", visual_prompt: "银色产品", reference_image_indexes: [2] };
  const shot = { segment_index: 1, duration_seconds: 8, scene: "演播室", camera: "中景", image_prompt: "主持人展示产品", video_prompt: "主持人自然展示", assets: [actor, product], speeches: [] };
  const imageModel = { code: "image-ref", default_params: {}, input_schema: {}, runtime_rule: {} };
  const ctx = environment(["update", "run"], {
    imageModels: [imageModel], modelsForKind: () => [imageModel],
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}), canvasImageReferenceLimit: () => 4,
    normalizeCanvasParamsForModel: params => params, inferSeedanceMaterialMode: () => "reference",
    api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { status: "failed", task_no: "stop-after-request", error_message: "test complete" }; },
  });
  const role = storyRole => ({ storyRole, storyGroupID: "g" });
  ctx.nodesRef.current = [
    node("input", "textInput", { ...role("input"), storyPipelineVersion: 2, referenceImageUrls: ["actor-original.png", "product.png", "unused.png"] }),
    node("board", "generator", { ...role("storyboard"), outputText: JSON.stringify([shot, { ...shot, segment_index: 2 }]) }),
    node("actor", "generator", { ...role("asset"), storyAssetCode: "ACTOR", outputKind: "image", outputUrl: "actor-canonical.png" }),
    node("frame", "generator", { ...role("keyframe"), storySegmentIndex: 2, mediaKind: "image", modelCode: "image-ref", status: "idle", outputText: "" }),
  ];
  ctx.edgesRef.current = [edge("input", "board"), edge("board", "frame"), edge("actor", "frame")];
  await ctx.run("frame", true);
  assert.deepEqual(requests[0].params.reference_images, ["actor-canonical.png", "product.png"]);
  assert.ok(!JSON.stringify(requests[0]).includes("actor-original.png"));
  assert.ok(!JSON.stringify(requests[0]).includes("unused.png"));
  assert.match(requests[0].prompt, /当前片段的目标尾帧/);
  assert.match(requests[0].prompt, /成片字幕由后期合成统一添加/);
  assert.match(requests[0].prompt, /严禁图片模型和视频模型/);
});

test("story enhancement receives the brief, current shot and provider failure", async () => {
  const requests = [];
  const ctx = environment(["update", "enhance"], {
    api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: "虚构主播使用中景，保留蓝衣" }; },
  });
  ctx.nodesRef.current = [
    node("input", "textInput", { storyRole: "input", prompt: "原创虚构主播，蓝衣" }),
    node("board", "generator", { storyRole: "storyboard", prompt: "不要面部特写", outputText: JSON.stringify([{ segment_index: 1, scene: "演播室", camera: "近景", image_prompt: "蓝衣主播", video_prompt: "主播挥手" }]) }),
    node("frame", "generator", { storyRole: "keyframe", storySegmentIndex: 1, prompt: "改成环境中景", error: "图片中可能包含人物肖像" }),
  ];
  ctx.edgesRef.current = [edge("input", "board"), edge("board", "frame")];
  await ctx.enhance("frame");
  assert.equal(requests[0].prompt, "改成环境中景");
  assert.match(requests[0].workflow_context, /原创虚构主播，蓝衣/);
  assert.match(requests[0].workflow_context, /不要面部特写/);
  assert.match(requests[0].workflow_context, /蓝衣主播/);
  assert.match(requests[0].workflow_context, /图片中可能包含人物肖像/);
  assert.equal(ctx.nodesRef.current[2].data.prompt, "虚构主播使用中景，保留蓝衣");
});

test("asset and copy approval is invalidated by edits without altering completed sibling media", async () => {
  const ctx = environment(["update", "approveStory"], { executeNodes: async () => {} });
  const role = value => ({ storyGroupID: "g", storyRole: value });
  ctx.nodesRef.current = [node("a", "generator", { ...role("asset"), mediaKind: "image", outputUrl: "a.png" }), node("f"), node("other")];
  ctx.edgesRef.current = [edge("a", "f")];
  ctx.nodesRef.current[0].data.lastRunSignature = ctx.nodeRunSignature("a", ctx.nodesRef.current, ctx.edgesRef.current);
  await ctx.approveStory("a");
  assert.equal(ctx.nodesRef.current[0].data.storyApproved, true);
  ctx.update("a", { outputUrl: "replacement.png" });
  assert.equal(ctx.nodesRef.current[0].data.storyApproved, false);
  assert.equal(ctx.nodesRef.current[1].data.dirty, true);
  assert.equal(ctx.nodesRef.current[2].data.dirty, undefined);
});


test("production execution pauses at three review stages and resumes without duplicate work", async () => {
  const ran = [];
  const asset = { code: "A", type: "character", name: "主角", visual_prompt: "蓝衣短发" };
  const shots = [1, 2].map(i => ({ segment_index: i, duration_seconds: 8, scene: "场景", camera: "近景", image_prompt: "静态", video_prompt: "动作", assets: [asset], continuity: i === 2 ? "continuous" : "cut" }));
  const ctx = productionCanvas(["configureStory", "update", "executeNodes", "approveStory"], {
    executionModeRef: { current: "step" },
    modelsForKind: () => [{ code: "chat" }, { code: "image" }, { code: "seedance" }], syncStoryAssetNodes,
    run: async id => {
      const current = ctx.nodesRef.current.find(n => n.id === id);
      ran.push(current.data.storyRole);
      const outputText = current.data.storyRole === "storyboard" ? JSON.stringify(shots) : current.data.mediaKind === "text" ? "定稿文案" : "";
      ctx.update(id, { outputText, outputUrl: current.data.mediaKind === "text" ? "" : id + ".media", outputKind: current.data.mediaKind || "video", taskNo: "task-" + id, status: "succeeded", dirty: false, lastRunSignature: ctx.nodeRunSignature(id, ctx.nodesRef.current, ctx.edgesRef.current) });
    },
  });
  const role = value => ({ storyGroupID: "g", storyRole: value, status: "idle", dirty: true });
  ctx.nodesRef.current = [node("input", "textInput", { ...role("input"), storyContinuityMode: "video_tail", storySegmentCount: 2, storySegmentDuration: 8 }), node("script", "generator", role("script")), node("final", "compositor", role("final"))];
  ctx.configureStory("input", 2, 8, undefined, {}, { targetDuration: 15, generationStrategy: "shots" });
  await ctx.executeNodes();
  assert.deepEqual(ran, ["copy"]);
  await ctx.approveStory(ctx.nodesRef.current.find(n => n.data.storyRole === "copy").id);
  assert.deepEqual(ran, ["copy", "script"]);
  await ctx.executeNodes();
  assert.deepEqual(ran, ["copy", "script", "storyboard"]);
  await ctx.approveStory(ctx.nodesRef.current.find(n => n.data.storyRole === "storyboard").id);
  assert.deepEqual(ran, ["copy", "script", "storyboard", "asset"]);
  await ctx.approveStory(ctx.nodesRef.current.find(n => n.data.storyRole === "asset").id);
  for (let step = 0; step < 4; step++) await ctx.executeNodes();
  assert.deepEqual(ran, ["copy", "script", "storyboard", "asset", "keyframe", "video", "keyframe", "video", "final"]);
  assert.equal(ctx.nodesRef.current.find(n => n.id === "final").data.status, "succeeded");
});

test("continuous keyframe uses a cached actual video tail and excludes video from image inputs", async () => {
  const requests = [];
  const shots = [1, 2].map(i => ({ segment_index: i, duration_seconds: 8, scene: "场景", camera: "近景", image_prompt: "静态", video_prompt: "动作", continuity: "continuous" }));
  const role = value => ({ storyGroupID: "g", storyRole: value, storySegmentCount: 2 });
  const ctx = environment(["update", "run"], {
    modelsForKind: () => [{ code: "image", default_params: {} }], parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    inferSeedanceMaterialMode: () => "image", normalizeCanvasParamsForModel: params => params, canvasImageReferenceLimit: () => 4,
    storyVideoSamples: () => { throw Error("cached tail should not be extracted again"); },
    api: async (url, options) => { requests.push(JSON.parse(options.body)); return { status: "failed", task_no: "mock" }; },
  });
  ctx.nodesRef.current = [node("b", "generator", { ...role("storyboard"), outputText: JSON.stringify(shots) }), node("prev", "generator", { ...role("video"), mediaKind: "video", outputKind: "video", outputUrl: "previous.mp4", storyTailFrameSource: "previous.mp4", storyTailFrameURL: "tail.jpg", storySegmentIndex: 1 }), node("f", "generator", { ...role("keyframe"), mediaKind: "image", modelCode: "image", storySegmentIndex: 2 })];
  ctx.edgesRef.current = [edge("b", "f"), edge("prev", "f")];
  await ctx.run("f");
  assert.equal(requests.length, 1, ctx.nodesRef.current.at(-1).data.error);
  assert.ok(JSON.stringify(requests[0]).includes("tail.jpg"));
  assert.ok(!JSON.stringify(requests[0]).includes("previous.mp4"));
  assert.match(requests[0].prompt, /实际尾帧/);
});


test("editing one storyboard shot preserves unrelated asset and frame signatures", () => {
  const ctx = environment();
  const shots = [1, 2].map(i => ({ segment_index: i, duration_seconds: 8, scene: "scene", camera: "camera", image_prompt: "image" + i, video_prompt: "video" + i }));
  const role = value => ({ storyGroupID: "g", storyRole: value });
  const nodes = [node("b", "generator", { ...role("storyboard"), outputText: JSON.stringify(shots) }), node("a", "generator", { ...role("asset"), storyAssetDefinition: "unchanged", mediaKind: "image", outputUrl: "asset.png" }), node("f1", "generator", { ...role("keyframe"), storySegmentIndex: 1 }), node("f2", "generator", { ...role("keyframe"), storySegmentIndex: 2 })];
  const edges = [edge("b", "a"), edge("a", "f1"), edge("b", "f1"), edge("b", "f2")];
  const signatures = nodes.slice(1).map(n => ctx.nodeRunSignature(n.id, nodes, edges));
  shots[1].video_prompt = "changed";
  nodes[0].data.outputText = JSON.stringify(shots);
  assert.equal(ctx.nodeRunSignature("a", nodes, edges), signatures[0]);
  assert.equal(ctx.nodeRunSignature("f1", nodes, edges), signatures[1]);
  assert.notEqual(ctx.nodeRunSignature("f2", nodes, edges), signatures[2]);
});

test("rerunning a shot includes the whole-sequence video that consumes it", async () => {
  let scope;
  const ctx = environment(["runStorySegment"], { executeNodes: async ids => { scope = [...ids]; } });
  const role = value => ({ storyGroupID: "g", storyRole: value });
  ctx.nodesRef.current = [node("b", "generator", { ...role("storyboard"), storyReviewRequired: false }), node("f2", "generator", { ...role("keyframe"), storySegmentIndex: 2 }), node("whole", "generator", { ...role("video"), storySegmentIndex: 1, storyWholeVideo: true }), node("final", "compositor", role("final"))];
  await ctx.runStorySegment("b", 2);
  assert.ok(scope.includes("whole"));
});


test("Agent stop and continue are idempotent commands, never opposite actions", async () => {
  let runs = 0, paused = false;
  const ctx = environment(["continueAgentCanvas"], { executeNodes: async () => { runs++; }, changeExecutionPaused: value => { paused = value; } });
  ctx.nodesRef.current = [node("unfinished", "generator", { status: "idle" })];
  ctx.executionActiveRef.current = true;
  await ctx.continueAgentCanvas("continue");
  assert.equal(ctx.stopExecutionRef.current, false);
  assert.equal(runs, 0);
  await ctx.continueAgentCanvas("stop");
  assert.equal(paused, true);
  assert.equal(ctx.stopExecutionRef.current, true);
  ctx.executionActiveRef.current = false;
  await ctx.continueAgentCanvas("stop");
  assert.equal(runs, 0);
  await ctx.continueAgentCanvas("continue");
  assert.equal(runs, 1);
});

test("stopping media polling retains its submitted task for reconciliation", async () => {
  const gate = deferred();
  let submissions = 0, polls = 0;
  const ctx = environment(["update", "run"], {
    modelsForKind: () => [{ code: "image", default_params: {} }], parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    inferSeedanceMaterialMode: () => "image", normalizeCanvasParamsForModel: params => params,
    wait: () => gate.promise,
    api: async (_url, options) => { if (options?.method === "POST") submissions++; else polls++; return { task_no: "existing-upstream", status: "running" }; },
  });
  ctx.nodesRef.current = [node("image", "generator", { mediaKind: "image", modelCode: "image", status: "idle", prompt: "test" })];
  const running = ctx.run("image");
  await new Promise(resolve => setImmediate(resolve));
  ctx.stopExecutionRef.current = true;
  gate.resolve();
  await running;
  assert.equal(submissions, 1);
  assert.equal(polls, 0);
  const result = ctx.nodesRef.current[0];
  assert.equal(result.data.taskNo, "existing-upstream");
  assert.equal(ctx.nodeHasReconcilableTask(result, ctx.nodesRef.current, []), true);
});

test("waiting time cannot fabricate a media completion percentage", () => {
  const ctx = environment();
  assert.equal(ctx.runningProgress(undefined, 200), 0);
  assert.equal(ctx.runningProgress(40, 200), 40);
});


test("video enhancement and upstream writing use the same preserve-or-repair rules", async () => {
  const requests = [];
  const ctx = environment(["update", "run", "enhance"], {
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    api: async (url, options) => { requests.push({ url, ...JSON.parse(options.body) }); return { content: "保留正文", cost: 1 }; },
  });
  ctx.nodesRef.current = [node("input", "textInput", { storyRole: "input", storyGroupID: "g", prompt: "拍摄对话", storySegmentCount: 2, storySegmentDuration: 8, storyTargetDuration: 15, storyNarrationMode: "smart" }), ...["copy", "script"].map(role => node(role, "generator", { storyRole: role, modelCode: "text", prompt: "完成本阶段" }))];
  ctx.edgesRef.current = [edge("input", "copy"), edge("copy", "script")];
  await ctx.enhance("input");
  assert.equal(requests[0].prompt, "拍摄对话");
  assert.ok(requests[0].workflow_context.includes(STORY_PLANNING_INSTRUCTION));
  assert.match(requests[0].workflow_context, /15 秒/);
  for (const role of ["copy", "script"]) {
    await ctx.run(role);
    assert.equal(ctx.nodesRef.current.find(n => n.id === role).data.status, "succeeded");
    assert.ok(requests.at(-1).messages[1].content.includes(STORY_PLANNING_INSTRUCTION));
    assert.match(requests.at(-1).messages[1].content, /15 秒/);
  }
});

test("explicit duration sync respects manual overrides and rejects AI duration drift", async () => {
  const requests = [];
  let enhanced = "生成20秒的财经短视频";
  const ctx = productionCanvas(["update", "configureStory", "syncStoryDuration", "enhance"], {
    api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: enhanced }; },
  });
  const role = storyRole => ({ storyRole, storyGroupID: "g" });
  ctx.nodesRef.current = [node("input", "textInput", { ...role("input"), prompt: "生成15秒的美国女性财经博主口播短视频", storyTargetDuration: 32, storySegmentCount: 4, storySegmentDuration: 8 }), node("script", "generator", role("script")), node("final", "compositor", role("final"))];
  const input = () => ctx.nodesRef.current.find(n => n.id === "input");
  ctx.syncStoryDuration("input");
  assert.equal(input().data.storyTargetDuration, 15);
  assert.equal(input().data.storySegmentCount, 2);
  ctx.configureStory("input", 3, 8, undefined, {}, { targetDuration: 20 });
  ctx.update("input", { prompt: "生成15秒的美国女性财经博主口播短视频，改成蓝衣" });
  ctx.syncStoryDuration("input");
  assert.equal(input().data.storyTargetDuration, 20, "unchanged prompt duration must not undo a manual setting");
  await ctx.enhance("input");
  assert.match(requests[0].workflow_context, /成片总时长 20 秒/);
  assert.equal(input().data.prompt, enhanced);
  ctx.syncStoryDuration("input");
  assert.equal(input().data.storyTargetDuration, 20);
  ctx.update("input", { prompt: "生成24秒的财经视频" });
  enhanced = "生成50秒的财经视频";
  await ctx.enhance("input");
  assert.equal(input().data.storyTargetDuration, 24, "enhance must synchronize before building timing constraints");
  assert.match(requests[1].workflow_context, /成片总时长 24 秒/);
  assert.equal(input().data.prompt, "生成24秒的财经视频");
  assert.match(ctx.notices.at(-1), /擅自改变/);
  ctx.update("input", { prompt: "生成30-50秒的视频" });
  ctx.syncStoryDuration("input");
  assert.equal(input().data.storyTargetDuration, 24);
});

test("all remake variants synchronize explicit duration through planning and composition, retaining manual choices and edited prompts", async () => {
  for (const variant of ["one_click", "video", "viral"]) {
    const requests = [];
    let enhanced = "生成15秒的产品视频，环境中景";
    const ctx = productionCanvas(["update", "configureViral", "syncStoryDuration", "enhance"], {
      preferredVideoAnalysisChatModel: items => items[0], referenceImageModels: items => items,
      api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: enhanced }; },
    });
    const role = viralRole => ({ viralRole, viralGroupID: "g", viralVariant: variant });
    ctx.nodesRef.current = [node("brief", "textInput", { ...role("brief"), prompt: "生成15秒的产品视频", viralSegmentCount: 3, viralSegmentDuration: 8, referenceVideoDuration: 30 }), node("analysis", "generator", { ...role("analysis"), prompt: "保留我指定的蓝色背景" }), node("final", "compositor", role("final")), node("ref", "imageInput", role("reference")), node("brand", "imageInput", role("brand"))];
    const brief = () => ctx.nodesRef.current.find(n => n.id === "brief").data;
    ctx.syncStoryDuration("brief");
    assert.equal(brief().viralTargetDuration, 15);
    assert.equal(brief().viralSegmentCount, 2);
    assert.equal(ctx.nodesRef.current.find(n => n.id === "final").data.targetDuration, 15);
    assert.equal(ctx.nodesRef.current.find(n => n.id === "analysis").data.prompt, "保留我指定的蓝色背景");
    await ctx.enhance("brief");
    assert.match(requests[0].workflow_context, /成片总时长 15 秒/);
    assert.match(requests[0].workflow_context, /第2镜实际保留7秒/);
    assert.equal(brief().prompt, enhanced);
    const frame = ctx.nodesRef.current.find(n => n.data.viralRole === "keyframe");
    ctx.update(frame.id, { prompt: "穿蓝衣、不要特写", firstFrameUrl: "first.png" });
    ctx.update("brief", { viralTimingMode: "manual", viralTargetDuration: 0, storyDurationPromptSeconds: 15 });
    ctx.configureViral("brief", 3, 8);
    ctx.update("brief", { prompt: "生成15秒的产品视频，添加光影" });
    ctx.syncStoryDuration("brief");
    assert.equal(brief().viralSegmentCount, 3);
    assert.equal(brief().viralTargetDuration, 0);
    assert.equal(ctx.nodesRef.current.find(n => n.id === frame.id).data.prompt, "穿蓝衣、不要特写");
    enhanced = "生成24秒的产品视频";
    await ctx.enhance("brief");
    assert.match(requests.at(-1).workflow_context, /成片总时长 24 秒/);
    ctx.syncStoryDuration("brief");
    assert.equal(brief().viralTimingMode, "manual", "AI-added duration cannot undo the user's manual choice");
    ctx.update("brief", { prompt: "生成17秒的产品视频" });
    enhanced = "生成50秒的产品视频";
    await ctx.enhance("brief");
    assert.equal(brief().viralSegmentCount, 3);
    assert.equal(brief().viralTargetDuration, 17);
    assert.equal(ctx.nodesRef.current.find(n => n.id === "final").data.targetDuration, 17);
    assert.equal(brief().prompt, "生成17秒的产品视频");
    assert.match(ctx.notices.at(-1), /擅自改变/);
  }
});

test("remake retry reads saved error and draft, repairs malformed source fields, and can shorten generated speech", async () => {
  for (const variant of ["one_click", "video", "viral"]) for (const locked of [false, true]) {
    const requests = [];
    const plan = length => JSON.stringify({ segments: [{ index: 1, duration: 8, keyframe_prompt: "产品中景", video_prompt: "主播介绍产品", source_start: 0, source_end: 8, source_observation: "桌上产品", speeches: [{ speaker_code: "A", speech_type: "dialogue", text: "甲".repeat(length), start_sec: 0.2, end_sec: 7.4 }] }] });
    const oldDraft = '{"segments":[]}';
    const ctx = environment(["update", "run", "runOnly"], {
      parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}), supportsVideoAnalysis: () => true,
      executeNodes: async (_scope, id) => ctx.run(id, true),
      api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: requests.length === 1 ? plan(76) : plan(28), cost: 1 }; },
    });
    ctx.nodesRef.current = [node("brief", "textInput", { viralRole: "brief", prompt: locked ? "逐字保留台词" : "按原片节奏复刻，适当精简", referenceVideoUrls: ["source.mp4"] }), node("analysis", "generator", { viralRole: "analysis", viralVariant: variant, modelCode: "text", prompt: "分析分镜", status: "failed", error: "旧分镜缺少 source_observation", outputText: oldDraft, actualCost: 2, viralSegmentCount: 1, viralSegmentDuration: 8 })];
    ctx.edgesRef.current = [edge("brief", "analysis")];
    await ctx.runOnly("analysis");
    assert.equal(requests[0].messages[2].content, oldDraft);
    assert.match(requests[0].messages.at(-1).content, /旧分镜缺少 source_observation/);
    assert.equal(requests.length, locked ? 3 : 2);
    assert.match(requests[1].messages.at(-1).content, locked ? /逐字保留/ : /精简重复和冗余表达/);
    const data = ctx.nodesRef.current[1].data;
    assert.equal(data.status, locked ? "failed" : "succeeded", data.error);
    assert.equal(data.actualCost, 2 + requests.length);
    assert.deepEqual(requests[1].params.reference_videos, ["source.mp4"]);
    if (!locked) assert.deepEqual(JSON.parse(data.outputText).source_media, ["source.mp4"]);
    // Invalid structure must enter the same repair loop, keeping the actual video attached.
    if (!locked) {
      requests.length = 0;
      ctx.api = async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: requests.length === 1 ? oldDraft : plan(28), cost: 1 }; };
      await ctx.run("analysis");
      assert.equal(requests.length, 2);
      assert.match(requests[1].messages.at(-1).content, /source_observation/);
      assert.equal(ctx.nodesRef.current[1].data.status, "succeeded");
    }
  }
});

test("frame-pair and remake enhancement retain global requirements, current shot, errors and fixed duration", async () => {
  for (const workflow of ["frame_pair", "one_click", "video", "viral"]) {
    const requests = [];
    const pair = workflow === "frame_pair";
    const inputRole = pair ? { framePairGroupID: "g", framePairRole: "input", framePairTargetDuration: 15 } : { viralGroupID: "g", viralRole: "brief", viralVariant: workflow, viralSegmentCount: 2, viralSegmentDuration: 8, viralTargetDuration: 15 };
    const shotRole = pair ? { framePairGroupID: "g", framePairRole: "shot", framePairSegmentIndex: 2, framePairSegmentDuration: 8 } : { viralGroupID: "g", viralRole: "video", viralVariant: workflow, viralSegmentCount: 2, viralSegmentIndex: 2 };
    const ctx = environment(["update", "enhance"], { api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: "保持蓝衣和环境中景" }; } });
    const segments = [1, 2].map(index => ({ index, duration: 8, keyframe_prompt: "产品中景", video_prompt: `第${index}镜转身`, source_start: (index - 1) * 8, source_end: index * 8, source_observation: "产品展台" }));
    ctx.nodesRef.current = [node("input", pair ? "framePairInput" : "textInput", { ...inputRole, prompt: "原创虚构角色，穿蓝衣，保持产品标志" }), node("analysis", "generator", { viralGroupID: "g", viralRole: "analysis", outputText: JSON.stringify({ segments }) }), node("shot", "generator", { ...shotRole, mediaKind: "video", prompt: "环境中景", error: "人物肖像审核失败", firstFrameUrl: "first.png", lastFrameUrl: "last.png" })];
    ctx.edgesRef.current = pair ? [edge("input", "shot")] : [edge("input", "analysis"), edge("analysis", "shot")];
    await ctx.enhance("shot");
    const context = requests[0].workflow_context;
    assert.match(context, /原创虚构角色，穿蓝衣，保持产品标志/);
    assert.match(context, /人物肖像审核失败/);
    assert.match(context, /15 秒/);
    assert.match(context, pair ? /第 2 镜/ : /第2镜转身/);
    assert.equal(ctx.nodesRef.current.find(n => n.id === "shot").data.firstFrameUrl, "first.png");
    assert.equal(ctx.nodesRef.current.find(n => n.id === "shot").data.lastFrameUrl, "last.png");
  }
});

test("frame-pair enhancement rejects duration drift and results based on obsolete planning", async () => {
  const requests = [];
  const ctx = environment(["update", "enhance"], { api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: "生成50秒的视频" }; } });
  ctx.nodesRef.current = [node("input", "framePairInput", { prompt: "生成15秒的视频", framePairTargetDuration: 20, storyDurationPromptSeconds: 15 })];
  await ctx.enhance("input");
  assert.match(requests[0].workflow_context, /固定为 20 秒/);
  assert.equal(ctx.nodesRef.current[0].data.prompt, "生成15秒的视频");
  assert.match(ctx.notices.at(-1), /擅自改变/);
  ctx.api = async () => { ctx.update("input", { framePairTargetDuration: 30 }); return { content: "生成20秒的视频" }; };
  await ctx.enhance("input");
  assert.match(ctx.notices.at(-1), /设置已改变/);
  assert.equal(ctx.nodesRef.current[0].data.prompt, "生成15秒的视频");
});

test("planning enhancement includes upstream writing and retry diagnosis without replacing the current prompt", async () => {
  const requests = [];
  const ctx = environment(["update", "enhance"], { api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: "按当前台词预算调整分镜" }; } });
  ctx.nodesRef.current = [node("input", "textInput", { storyRole: "input", prompt: "生成15秒视频", storyTargetDuration: 15, storySegmentCount: 2, storySegmentDuration: 8 }), node("script", "generator", { storyRole: "script", outputKind: "text", outputText: "这是用户确认过的上游拍摄安排" }), node("board", "generator", { storyRole: "storyboard", modelCode: "text", prompt: "本节点要求保持中景", storyRetryError: "台词超过7秒", storyRetryDraft: "这是失败的旧分镜草稿", rolePrompt: "不要添加未说明的事实" })];
  ctx.edgesRef.current = [edge("input", "script"), edge("script", "board")];
  await ctx.enhance("board");
  assert.equal(requests[0].prompt, "本节点要求保持中景");
  assert.match(requests[0].workflow_context, /这是用户确认过的上游拍摄安排/);
  assert.match(requests[0].workflow_context, /台词超过7秒/);
  assert.match(requests[0].workflow_context, /这是失败的旧分镜草稿/);
  assert.match(requests[0].workflow_context, /不要添加未说明的事实/);
});

test("reference video duration detection never overrides an explicit or manual remake duration", async () => {
  const ctx = environment(["update", "detectOneClickVideoDuration"]);
  for (const mode of ["manual", "prompt", "auto"]) {
    ctx.nodesRef.current = [node("brief", "textInput", { viralVariant: "one_click", viralTimingMode: mode, viralTargetDuration: 15 })];
    await ctx.detectOneClickVideoDuration("brief", "source.mp4", 50);
    assert.equal(ctx.nodesRef.current[0].data.referenceVideoDuration, 50);
    assert.equal(ctx.nodesRef.current[0].data.viralTimingMode, mode);
    assert.equal(ctx.nodesRef.current[0].data.viralTargetDuration, 15);
  }
});

test("manual storyboard retry sends the saved failure and draft instead of starting blind", async () => {
  const requests = [];
  const shot = text => ({ segment_index: 1, duration_seconds: 8, scene: "室内", camera: "中景", image_prompt: "主播", video_prompt: "主播讲解", speeches: [{ speaker_code: "A", speech_type: "dialogue", text, start_sec: 0.2, end_sec: 7.4 }] });
  const previous = JSON.stringify([shot("甲".repeat(76))]);
  const revised = JSON.stringify([shot("甲".repeat(28))]);
  const ctx = environment(["update", "run", "runOnly"], {
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    executeNodes: async (_scope, id) => ctx.run(id, true),
    api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: revised, cost: 1 }; },
  });
  ctx.nodesRef.current = [node("input", "textInput", { storyRole: "input", prompt: "生成8秒的视频，介绍市场" }), node("board", "generator", { storyRole: "storyboard", modelCode: "text", prompt: "生成分镜", status: "failed", error: "76字台词超出时长，需要精简", outputText: previous, actualCost: 2, storySegmentCount: 1, storySegmentDuration: 8, params: { target_duration_sec: 8 } })];
  ctx.edgesRef.current = [edge("input", "board")];
  await ctx.runOnly("board");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages[2].content, previous);
  assert.match(requests[0].messages.at(-1).content, /76字台词超出时长/);
  assert.match(requests[0].messages.at(-1).content, /精简重复和冗余表达/);
  const board = ctx.nodesRef.current[1].data;
  assert.equal(board.status, "succeeded", board.error);
  assert.equal(board.outputText, revised);
  assert.equal(board.storyRetryError, "");
  assert.equal(board.actualCost, 3);
});

test("automatic speech repair can shorten generated copy but keeps locked scripts verbatim", async () => {
  const shot = text => JSON.stringify([{ segment_index: 1, duration_seconds: 8, scene: "室内", camera: "中景", image_prompt: "主播", video_prompt: "主播讲解", speeches: [{ speaker_code: "A", speech_type: "dialogue", text, start_sec: 0.2, end_sec: 7.4 }] }]);
  for (const locked of [false, true]) {
    const requests = [];
    const ctx = environment(["update", "run"], {
      parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
      api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: shot("甲".repeat(requests.length === 1 ? 76 : 28)), cost: 1 }; },
    });
    ctx.nodesRef.current = [node("input", "textInput", { storyRole: "input", storyScriptProvided: locked, prompt: "生成8秒的视频" }), node("board", "generator", { storyRole: "storyboard", modelCode: "text", prompt: "生成分镜", storySegmentCount: 1, storySegmentDuration: 8, params: { target_duration_sec: 8 } })];
    ctx.edgesRef.current = [edge("input", "board")];
    await ctx.run("board");
    assert.equal(ctx.nodesRef.current[1].data.status, locked ? "failed" : "succeeded");
    assert.equal(requests.length, locked ? 3 : 2);
    assert.match(requests[1].messages.at(-1).content, locked ? /逐字保留/ : /必须按当前成片时长精简/);
    if (!locked) assert.ok(!requests[1].messages.some(message => message.content.includes("正文签名：")));
  }
});

test("storyboard repairs invalid drafts, skips valid ones, and retains failures and total cost", async () => {
  const say = (speaker, speech_type = "dialogue") => ({ speaker_code: speaker, speech_type, text: speaker + "的台词" });
  const shot = (index, speeches) => ({ segment_index: index, duration_seconds: 8, scene: "室内", camera: "近景", image_prompt: "人物", video_prompt: "人物表演", assets: [], speech_fill_mode: "intentional_pause", speeches: speeches.map((speech, i) => ({ ...speech, start_sec: i * 2, end_sec: i * 2 + 1 })) });
  const valid = JSON.stringify([shot(1, [say("A")]), shot(2, [say("B")])]);
  const mixed = JSON.stringify([shot(1, [say("A"), say("B")]), shot(2, [])]);
  const narrationMixed = JSON.stringify([shot(1, [say("A"), say("NARRATOR", "narration")]), shot(2, [])]);
  const narrationValid = JSON.stringify([shot(1, [say("A")]), shot(2, [say("NARRATOR", "narration")])]);
  const deleted = JSON.stringify([shot(1, [say("A")]), shot(2, [])]);
  for (const outputs of [[valid], [JSON.stringify({ error: "误判镜头约束冲突" }), valid], [mixed, valid], [narrationMixed, narrationValid], ["[]", valid], [mixed, deleted, valid], [mixed, mixed, mixed], [mixed, new Error("修正请求失败")]]) {
    const requests = [];
    const ctx = environment(["update", "run"], {
      parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
      api: async (url, options) => {
        assert.equal(url, "/api/chat/completions");
        requests.push(JSON.parse(options.body));
        const content = outputs[requests.length - 1];
        if (content instanceof Error) throw content;
        assert.equal(typeof content, "string", "unexpected extra repair");
        return { content, cost: 2 };
      },
    });
    ctx.nodesRef.current = [node("input", "textInput", { storyRole: "input", storyScriptProvided: true, prompt: "逐字保留，镜头中允许长停顿", useAudioModel: true, referenceImageUrls: ["ref.png"], referenceVideoUrls: ["ref.mp4"] }), node("board", "generator", { storyRole: "storyboard", modelCode: "text", prompt: "生成分镜", storySegmentCount: 2, storySegmentDuration: 8, params: { target_duration_sec: 16 } })];
    ctx.edgesRef.current = [edge("input", "board")];
    await ctx.run("board");
    const data = ctx.nodesRef.current.find(n => n.id === "board").data;
    assert.equal(requests.length, outputs.length, data.error);
    const succeeds = [valid, narrationValid].includes(outputs.at(-1));
    assert.equal(data.status, succeeds ? "succeeded" : "failed", data.error);
    assert.equal(data.outputText, succeeds ? outputs.at(-1) : mixed);
    assert.equal(data.actualCost, 2 * outputs.filter(x => typeof x === "string").length);
    if (succeeds) assert.equal(data.warning, "");
    if (outputs.length === 3 && !succeeds) assert.match(data.error, /两次.*说话人/);
    if (requests.length > 1) {
      assert.ok(data.storyValidationErrors.length > 0, "repair history must remain visible after success");
      assert.deepEqual(requests[1].params.reference_images, ["ref.png"]);
      assert.deepEqual(requests[1].params.reference_videos, ["ref.mp4"]);
      assert.match(requests[1].messages.at(-1).content, /校验/);
      assert.equal(requests[1].messages[2].content, outputs[0]);
    }
  }
});


test("one native-audio segment retains sequential narration and dialogue without lip-sync restrictions", async () => {
  const requests = [];
  const shot = { segment_index: 1, duration_seconds: 8, scene: "室内", camera: "连续镜头", image_prompt: "人物静立", video_prompt: "00:01-00:05画外旁白，00:05-00:07角色对白，先后发声", speech_fill_mode: "intentional_pause", speeches: [
    { text: "旁白正文", speaker_code: "NARRATOR", speech_type: "narration", start_sec: 1, end_sec: 5 },
    { text: "角色回答", speaker_code: "A", speech_type: "dialogue", start_sec: 5, end_sec: 7 },
  ] };
  const ctx = environment(["update", "run"], {
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    api: async (url, options) => { requests.push(JSON.parse(options.body)); return { content: JSON.stringify([shot]), cost: 1 }; },
  });
  ctx.nodesRef.current = [node("input", "textInput", { storyRole: "input", useAudioModel: false, storySegmentCount: 1, storySegmentDuration: 8 }), node("script", "generator", { storyRole: "script", outputText: shot.video_prompt }), node("board", "generator", { storyRole: "storyboard", modelCode: "text", storySegmentCount: 1, storySegmentDuration: 8 })];
  ctx.edgesRef.current = [edge("input", "script"), edge("script", "board")];
  await ctx.run("board");
  const data = ctx.nodesRef.current.find(n => n.id === "board").data;
  assert.equal(data.status, "succeeded", data.error);
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(data.outputText)[0].speeches, shot.speeches);
  assert.ok(requests[0].messages[1].content.includes(storySpeechInstruction(false, true)));
  assert.ok(!requests[0].messages[1].content.includes(storySpeechInstruction(true, true)));
});


test("storyboard follows the upstream audio checkbox on every rerun, including unchecked legacy inputs", async () => {
  const requests = [];
  const shot = { segment_index: 1, duration_seconds: 8, scene: "室内", camera: "近景", image_prompt: "人物", video_prompt: "先旁白再对白", speech_fill_mode: "intentional_pause", speeches: [
    { text: "旁白", speaker_code: "NARRATOR", speech_type: "narration", start_sec: 1, end_sec: 3 },
    { text: "对白", speaker_code: "A", speech_type: "dialogue", start_sec: 4, end_sec: 6 },
  ] };
  const ctx = environment(["update", "run"], {
    parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
    api: async (url, options) => { requests.push(JSON.parse(options.body)); return { content: JSON.stringify([shot]), cost: 1 }; },
  });
  ctx.nodesRef.current = [node("input", "textInput", { storyRole: "input", storySegmentCount: 1, storySegmentDuration: 8 }), node("script", "generator", { storyRole: "script" }), node("board", "generator", { storyRole: "storyboard", modelCode: "text", storySegmentCount: 1, storySegmentDuration: 8 })];
  ctx.edgesRef.current = [edge("input", "script"), edge("script", "board")];
  for (const checked of [true, false, undefined, true]) {
    const input = ctx.nodesRef.current.find(n => n.id === "input");
    const board = ctx.nodesRef.current.find(n => n.id === "board");
    const previousSignature = ctx.nodeRunSignature("board", ctx.nodesRef.current, ctx.edgesRef.current);
    input.data.useAudioModel = checked;
    board.data.useAudioModel = checked !== true; // A stale downstream value must never override the checkbox.
    if (checked !== undefined) assert.notEqual(ctx.nodeRunSignature("board", ctx.nodesRef.current, ctx.edgesRef.current), previousSignature);
    requests.length = 0;
    await ctx.run("board");
    const result = ctx.nodesRef.current.find(n => n.id === "board").data;
    assert.equal(requests.length, checked === true ? 3 : 1, result.error);
    assert.equal(result.status, checked === true ? "failed" : "succeeded", result.error);
    for (const request of requests) {
      assert.ok(request.messages[1].content.includes(storySpeechInstruction(checked === true, true)));
      if (request.messages.length > 2 && request.messages.at(-1).content.includes("程序校验")) assert.ok(request.messages.at(-1).content.includes(storySpeechInstruction(checked === true, true)));
    }
  }
});


test("manual storyboard retry resolves short locked copy with explicit staging constraints and retains them on repair", async () => {
  for (const locked of [false, true]) {
    const requests = [];
    const original = "这双蓝紫配色，上脚真的很抓眼。";
    const valid = JSON.stringify([1, 2].map(index => ({ segment_index: index, duration_seconds: 8, scene: "展示鞋子", camera: "近景", image_prompt: "鞋子细节", video_prompt: "0到4秒自然说话，4到8秒展示鞋面细节", assets: [], speech_fill_mode: "intentional_pause", speeches: [{ speaker_code: "HOST", speech_type: "dialogue", text: index === 1 ? original : "细节给你看。喜欢就点开看看。", start_sec: 0.2, end_sec: 4 }] })));
    const ctx = environment(["update", "run", "runOnly"], {
      parseVideoRuntime: () => ({}), parseAudioRuntime: () => ({}),
      executeNodes: async (_scope, id) => ctx.run(id, true),
      api: async (_url, options) => { requests.push(JSON.parse(options.body)); return { content: requests.length === 1 ? "[]" : valid, cost: 1 }; },
    });
    ctx.nodesRef.current = [node("input", "textInput", { storyRole: "input", storyScriptProvided: locked, prompt: "蓝紫鞋，成片16秒" }), node("board", "generator", { storyRole: "storyboard", modelCode: "text", storySegmentCount: 2, storySegmentDuration: 8, status: "failed", error: "分镜约束无法兼容：台词34字不满足发声覆盖率", outputText: '{"error":"台词太短"}', actualCost: 2, params: { target_duration_sec: 16 } }), node("video", "generator", { storyRole: "video", outputUrl: "old.mp4" })];
    ctx.edgesRef.current = [edge("input", "board"), edge("board", "video")];
    const inputBefore = JSON.stringify(ctx.nodesRef.current[0]);
    await ctx.runOnly("board");
    const board = ctx.nodesRef.current.find(n => n.id === "board").data;
    assert.equal(board.status, "succeeded", board.error);
    assert.equal(board.storyConstraintRepair, true);
    assert.equal(board.actualCost, 4);
    assert.equal(board.storyRetryError, "");
    assert.equal(JSON.stringify(ctx.nodesRef.current[0]), inputBefore);
    assert.equal(ctx.nodesRef.current.find(n => n.id === "video").data.dirty, true);
    for (const request of requests) {
      assert.match(request.messages[1].content, /覆盖上游 AI 文案/);
      assert.match(request.messages.at(-1).content, /intentional_pause/);
      assert.match(request.messages.at(-1).content, locked ? /原文已锁定，逐字保留/ : /原文未锁定/);
      assert.match(request.messages.at(-1).content, /镜头数量、实际保留时长/);
    }
    assert.deepEqual(JSON.parse(board.outputText).map(s => s.speeches[0].text), [original, "细节给你看。喜欢就点开看看。"]);
  }
});

test("constraint relaxation is scoped to manual retries of failed storyboards", () => {
  for (const data of [{ storyRole: "storyboard", status: "succeeded", error: "台词太短" }, { storyRole: "storyboard", status: "failed", error: "网络错误" }, { viralRole: "analysis", status: "failed", error: "分镜错误" }]) {
    assert.deepEqual(storyConstraintRetryPatch(node("test", "generator", data)), {});
  }
  assert.equal(storyConstraintRepairInstruction(false, true), "");
});
