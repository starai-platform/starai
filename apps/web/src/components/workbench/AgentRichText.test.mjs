import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("./AgentRichText.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: createRequire(import.meta.url) });
const render = (content, sources) => renderToStaticMarkup(createElement(exports.AgentRichText, { content, sources }));

test("stream prefixes retain heading and paragraph structure as body text arrives", () => {
  const text = "# 租赁合同\n\n## 第三条 租赁期限\n\n租期三年，\n按合同约定执行。\n\n签订日期：2026年4月30日。";
  for (const end of [text.indexOf("租期") + 2, text.indexOf("签订") + 2, text.length]) {
    const html = render(text.slice(0, end));
    assert.match(html, /<h1[^>]*><span>租赁合同<\/span><\/h1>/);
    assert.match(html, /<h2[^>]*><span>第三条 租赁期限<\/span><\/h2>/);
  }
  assert.equal((render(text).match(/<p\b/g) || []).length, 2, "soft line breaks must not split a paragraph");
  const legacy = render("租赁合同\n第三条租赁期限\n租赁期限三年。\n\n请遵守第三条规定。");
  assert.match(legacy, /<h1/);
  assert.match(legacy, /<h2/);
  assert.match(legacy, /<p[^>]*><span>请遵守第三条规定。/);
  const wrappedList = render("1. 甲方将房屋出租\n给乙方使用。\n2. 第二项。");
  assert.equal((wrappedList.match(/<ol\b/g) || []).length, 1);
  assert.match(wrappedList, /出租\n给乙方使用。<\/span><\/li>/);
});

test("unfinished code stays literal and lists, citations and untrusted text remain safe", () => {
  const html = render("### 注意事项\n\n3. **三年** [1]\n4. `原编号`\n\n> 需核对原件\n\n```txt\n# 这里不是标题\n<script>alert(1)</script>", [{ title: "原文", url: "https://example.com/source" }]);
  assert.match(html, /<ol[^>]*start="3"/);
  assert.match(html, /<li value="4"/);
  assert.match(html, /<strong/);
  assert.match(html, /<blockquote/);
  assert.match(html, /href="https:\/\/example.com\/source"/);
  assert.match(html, /<pre[^>]*><code># 这里不是标题/);
  assert.doesNotMatch(html, /<script>|<h1/);
  assert.doesNotMatch(render("[1]", [{ title: "无效", url: "javascript:alert(1)" }]), /<a\b/);
});

test("comparison tables render during streaming without swallowing adjacent paragraphs", () => {
  const prefix = "比较如下：\n| 格式 | 优点 |\n| --- | :---: |\n| Word | **可编辑** |\n";
  const html = render(prefix + "| PDF | <script>恶意</script> |\n\n结论正文");
  assert.match(render(prefix), /<table/);
  assert.match(html, /<thead/);
  assert.equal((html.match(/<td\b/g) || []).length, 4);
  assert.match(html, /text-center/);
  assert.match(html, /<strong[^>]*>可编辑/);
  assert.match(html, /<p[^>]*><span>结论正文/);
  assert.doesNotMatch(html, /<script>/);
});
