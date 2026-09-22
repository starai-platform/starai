import * as canvasGraph from "./canvasGraph.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { canvasAnalysisMediaKinds, supportsMediaAnalysis } from "./canvasModelCapabilities.ts";

// Execute the real UI callbacks without a browser, network or paid model calls.
const source = ts.createSourceFile("canvas.tsx", readFileSync(new URL("./InfiniteCanvasWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["indexedCanvasEdges", "collectUpstreamNodes", "useAnalysisModelWarning", "CanvasImagePreview"];
const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source)).join("\n");
function environment(state = { nodes: [], edges: [] }) {
  const previews = [];
  const ctx = {
    ...canvasGraph,
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useContext: () => ({ openResultPreview: preview => previews.push(preview) }), CanvasNodeActions: {},
    useI18n: () => ({ t: (key, vars) => `${key}${vars ? `:${vars.kinds}` : ""}` }),
    useStore: selector => selector(state), canvasAnalysisMediaKinds, supportsMediaAnalysis,
  };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, ctx);
  return { ctx, previews };
}

test("image preview opens the original image and stops the canvas click", () => {
  const { ctx, previews } = environment();
  const button = ctx.CanvasImagePreview({ url: "https://assets.test/original.png", title: "参考图片" });
  assert.equal(button.type, "button");
  assert.equal(button.props.type, "button");
  assert.match(button.props.className, /nodrag nopan/);
  assert.match(button.props["aria-label"], /参考图片/);
  let stopped = false;
  button.props.onClick({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(JSON.parse(JSON.stringify(previews)), [{ url: "https://assets.test/original.png", kind: "image", title: "参考图片" }]);
});

test("model warnings follow connected media and disappear when disconnected or removed", () => {
  const state = {
    nodes: [
      { id: "input", data: { referenceImageUrls: ["a.png"], referenceAudioUrls: ["a.mp3"] } },
      { id: "middle", data: {} }, { id: "analysis", data: {} },
      { id: "unrelated", data: { referenceVideoUrls: ["a.mp4"] } },
    ],
    edges: [{ source: "input", target: "middle" }, { source: "middle", target: "analysis" }],
  };
  const { ctx } = environment(state);
  const model = { code: "text" };
  const warning = () => ctx.useAnalysisModelWarning("analysis").suffix(model);
  assert.match(warning(), /image\/canvas.kind.audio/);
  assert.doesNotMatch(warning(), /video/);
  assert.doesNotMatch(ctx.useAnalysisModelWarning("analysis").suffix({ code: "vision", runtime_rule: { capabilities: { vision: true } } }), /image/);
  assert.equal(ctx.useAnalysisModelWarning("analysis", false).suffix(model), "");
  state.nodes[0].data.referenceImageUrls = [];
  assert.doesNotMatch(warning(), /image/);
  state.edges = [];
  assert.equal(warning(), "");
});
