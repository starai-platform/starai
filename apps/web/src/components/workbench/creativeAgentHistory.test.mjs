import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("a successful workflow retry replaces the Agent failure and returns the same final media", () => {
  const source = ts.createSourceFile("agent.tsx", readFileSync(new URL("./CreativeAgentWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "onCanvasState") callback = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  let messages = [{ role: "assistant", canvasId: "canvas", content: "验收超时", canvasState: { status: "failed" } }];
  let media;
  const ctx = {
    conversationId: "conversation", canvasControls: { current: {} },
    canvasConversations: { current: { canvas: "conversation" } }, canvasStateSignatures: { current: {} },
    canvasOrderByConversation: { current: { conversation: ["canvas"] } }, canvasResults: { current: {} },
    setStoppingCanvasIds: () => {}, setMessages: update => { messages = update(messages); },
    setLatestGeneratedMedia: next => { media = next; },
  };
  vm.runInNewContext(ts.transpileModule(`globalThis.onCanvasState = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  const continuation = async () => {};
  ctx.onCanvasState("canvas", { status: "running", content: "正在恢复原任务" }, continuation);
  assert.equal(messages[0].canvasState.status, "running");
  ctx.onCanvasState("canvas", { status: "succeeded", content: "视频已完成", media: { images: [], videos: ["final.mp4"], audios: [] } }, continuation);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].canvasState.status, "succeeded");
  assert.equal(messages[0].content, "视频已完成");
  assert.deepEqual(messages[0].videos, ["final.mp4"]);
  assert.equal(messages[0].resultRunId, "canvas");
  assert.deepEqual(media.videos, ["final.mp4"]);
});

test("Agent history shows text before slow media, deduplicates tasks and blocks duplicate opens", async () => {
  const source = ts.createSourceFile("agent.tsx", readFileSync(new URL("./CreativeAgentWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "loadHistory") callback = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  let release;
  const slowAsset = new Promise(resolve => { release = resolve; });
  const calls = [];
  const displayed = [];
  const errors = [];
  const noop = () => {};
  const emptyMedia = () => ({ images: [], videos: [], audios: [] });
  const ctx = {
    busy: false, historyRestoreRef: { current: false }, sessionEpoch: { current: 0 }, draftRef: { current: null },
    chatModelCode: "chat", MESSAGE_PAGE_SIZE: 20, restoringSelection: { current: false }, assetsChangedRef: { current: false },
    setBusy: noop, setHistoryLoadingId: noop, setHistoryOpen: noop, setError: value => errors.push(value),
    setMessages: value => displayed.push(value), setVisibleMessageCount: noop, setConversationId: noop,
    setCanvasVisible: noop, setTask: noop, setLatestGeneratedMedia: noop, setBottom: noop, setPendingRetry: noop,
    storedPlan: () => null, storedEvent: JSON.parse, taskMedia: emptyMedia, taskReferences: emptyMedia,
    finalWorkflowMedia: emptyMedia, runMedia: emptyMedia, workflowSuccessMessage: () => null,
    api: async url => {
      calls.push(url);
      if (url.startsWith("/api/chat/conversations/")) return { messages: [
        { role: "user", content: "可以先阅读的历史正文" },
        { role: "system", content: JSON.stringify({ type: "creative_agent_assets", asset_ids: ["asset"] }) },
        ...Array.from({ length: 2 }, () => ({ role: "system", content: JSON.stringify({ type: "creative_agent_generation", task_no: "same-task" }) })),
        { role: "user", content: "把上面的内容做成文档" },
        { role: "assistant", content: "文档完整正文" },
        { role: "user", content: "谢谢，Word和PDF有什么区别？" },
        { role: "assistant", content: "普通解释正文" },
      ] };
      if (url.startsWith("/api/creative-agent/state/")) return { slots: {}, status: "draft" };
      if (url === "/api/tasks/status") return { items: [{ task_no: "same-task", status: "succeeded", output: {} }] };
      if (url === "/api/assets/batch") return slowAsset;
      throw new Error(`unexpected request ${url}`);
    },
  };
  const exportHelper = readFileSync(new URL("./agentDocumentExport.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/m, "").replace(/^export /gm, "");
  vm.runInNewContext(ts.transpileModule(exportHelper + `\nglobalThis.loadHistory = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  const opening = ctx.loadHistory("conversation");
  await ctx.loadHistory("duplicate-click");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0][0].content, "可以先阅读的历史正文");
  assert.equal(displayed[0].find(item => item.content === "文档完整正文").documentRequested, true);
  assert.equal(displayed[0].find(item => item.content === "普通解释正文").documentRequested, false);
  assert.equal(calls.filter(url => url.startsWith("/api/tasks/")).length, 1);
  assert.equal(calls.filter(url => url.startsWith("/api/chat/conversations/")).length, 1);
  assert.ok(calls.includes("/api/chat/conversations/conversation?limit=200"));
  assert.ok(calls.includes("/api/assets/batch"));
  release({ items: [{ public_id: "asset", kind: "image", url: "https://test/image.png" }] });
  await opening;
  assert.equal(displayed.length, 2);
  assert.equal(displayed[1][0].images[0], "https://test/image.png");
  assert.equal(ctx.historyRestoreRef.current, false);
  assert.ok(!errors.some(Boolean));
});
