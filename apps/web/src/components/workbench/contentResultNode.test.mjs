import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import postcss from "postcss";
import tailwind from "tailwindcss";
import { socialPublishHTML, socialPublishText } from "./contentCreationResult.ts";

const source = ts.createSourceFile("canvas.tsx", readFileSync(new URL("./InfiniteCanvasWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ContentResultNode").getText(source);
function renderer() {
  const values = [], deps = [];
  let cursor = 0, effects = [];
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    useState: initial => { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], next => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useEffect: (callback, next) => { const index = cursor++; if (!deps[index] || next.some((value, i) => !Object.is(value, deps[index][i]))) effects.push(callback); deps[index] = next; },
    useI18n: () => ({ t: key => key }), socialPublishHTML, socialPublishText,
    NodeFrame: "frame", MessageSquareText: "icon", ChevronDown: "icon", Check: "icon", Copy: "icon", Download: "icon",
  };
  vm.runInNewContext(ts.transpileModule(component, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return data => {
    cursor = 0; effects = [];
    const tree = context.ContentResultNode({ id: "result", data });
    if (effects.length) { effects.forEach(callback => callback()); cursor = 0; effects = []; return context.ContentResultNode({ id: "result", data }); }
    return tree;
  };
}
function descendants(tree) { return !tree || typeof tree !== "object" ? [] : [tree, ...(tree.children || []).flat(Infinity).flatMap(descendants)]; }

test("results auto-open on arrival and history restore, while manual collapse stays until new content", () => {
  const render = renderer();
  assert.equal(render({}).props.headerActions.props["aria-expanded"], false);
  const data = { outputText: "标题：完成\n正文：这是一段内容。", outputUrls: [] };
  let tree = render(data);
  assert.equal(tree.props.headerActions.props["aria-expanded"], true);
  tree.props.headerActions.props.onClick();
  assert.equal(render({ ...data, outputUrls: [] }).props.headerActions.props["aria-expanded"], false);
  assert.equal(render({ ...data, outputText: "新的结果" }).props.headerActions.props["aria-expanded"], true);
  assert.equal(renderer()(data).props.headerActions.props["aria-expanded"], true);
  assert.equal(renderer()({ outputUrls: ["a.png"] }).props.headerActions.props["aria-expanded"], true);
});

test("dark preview overrides clipboard inline colors without altering copied rich text", async () => {
  const data = { outputText: "标题：创作结果\n\n正文：深色模式下的正文应当清晰可读。\n\n标签：#内容创作 #画布" };
  const preview = descendants(renderer()(data)).find(node => node.props?.dangerouslySetInnerHTML);
  const classes = preview.props.className;
  const { css } = await postcss([tailwind({ content: [{ raw: classes }], darkMode: "class", corePlugins: { preflight: false } })]).process("@tailwind utilities;", { from: undefined });
  assert.match(css, /color: rgb\(229 231 235[^;]*!important/);
  assert.match(css, /color: rgb\(255 255 255[^;]*!important/);
  assert.match(socialPublishHTML(data.outputText, []), /color:#374151/);
  if (process.env.CANVAS_QA_HTML) {
    writeFileSync(process.env.CANVAS_QA_HTML, `<html lang="zh"><meta charset="utf-8"><style>${css}</style><body style="margin:0;padding:40px;font-family:sans-serif;background:#111827"><div class="dark" style="width:380px;background:#111827"><div class="${classes}">${preview.props.dangerouslySetInnerHTML.__html}</div></div></body></html>`, "utf8");
  }
});
