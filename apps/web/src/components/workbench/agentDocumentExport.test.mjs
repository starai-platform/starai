import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("document downloads send the entire reply and use the actual returned bytes", async () => {
  const source = readFileSync(new URL("./agentDocumentExport.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/m, "").replace(/^export /gm, "");
  const text = "完整合同\n" + "未改条款\n".repeat(3000) + "签署日期：2026年4月30日";
  let request, blob, clicked = false, removed = false, revoked;
  const link = { click() { clicked = true; }, remove() { removed = true; } };
  const context = {
    apiBlob: async (path, options) => { request = { path, body: JSON.parse(options.body), accept: options.headers.Accept }; return new Blob(["%PDF-test"], { type: "application/pdf" }); },
    atob, Uint8Array, Blob,
    URL: { createObjectURL: value => { blob = value; return "blob:test"; }, revokeObjectURL: value => { revoked = value; } },
    document: { createElement: () => link, body: { appendChild() {} } },
    window: { setTimeout: fn => fn() },
  };
  vm.runInNewContext(ts.transpileModule(source + "\nglobalThis.download = downloadAgentDocument;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.download(text, "pdf");
  assert.equal(request.path, "/api/creative-agent/export-document");
  assert.deepEqual(request.body, { content: text, format: "pdf" });
  assert.equal(request.accept, "application/octet-stream");
  assert.equal(await blob.text(), "%PDF-test");
  assert.equal(blob.type, "application/pdf");
  assert.equal(link.download, "文档.pdf");
  assert.ok(clicked && removed);
  assert.equal(revoked, "blob:test");
  context.apiBlob = async () => new Blob([JSON.stringify({ code: 0, data: { mime_type: "application/pdf", data_base64: Buffer.from("%PDF-legacy").toString("base64") } })], { type: "application/json" });
  await context.download(text, "pdf");
  assert.equal(await blob.text(), "%PDF-legacy");
  context.apiBlob = async () => new Blob(["gateway error"], { type: "text/html" });
  clicked = false;
  await assert.rejects(context.download(text, "pdf"), /未收到有效/);
  assert.equal(clicked, false);
  context.apiBlob = async () => { throw new Error("导出失败"); };
  clicked = false;
  await assert.rejects(context.download(text, "docx"), /导出失败/);
  assert.equal(clicked, false);
});

test("download buttons require an explicit document request in the current user turn", () => {
  const source = readFileSync(new URL("./agentDocumentExport.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/m, "").replace(/^export /gm, "");
  const ctx = {};
  vm.runInNewContext(ts.transpileModule(source + "\nglobalThis.requested = requestsAgentDocument;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  for (const text of ["帮我生成文档", "把上面的内容做成文档", "请生成一份Word文档", "导出PDF", "把这份合同转为docx", "帮我整理成可下载的文件", "给我Word版本", "文档导出一下", "能帮我生成PDF吗？", "不要联网，帮我生成PDF", "不用PDF，给我Word文件", "请写一份Word文档", "把操作步骤做成文档", "PDF下载不了，重新生成PDF"]) {
    assert.equal(ctx.requested(text), true, text);
  }
  for (const text of ["你好", "写一篇文章", "帮我修改合同第三条", "总结上传的PDF", "Word和PDF有什么区别？", "怎么生成PDF？", "能生成PDF吗？", "生成PDF会不会占用服务器？", "PDF文档下载不了", "不要生成文档", "只要正文，不用导出Word", "生成PDF，不要文档了，只要文字", "解释“生成PDF”是什么意思", "> 请生成PDF", "```txt\n生成PDF\n```", "谢谢", "继续解释一下", "帮我解释生成PDF的原理", "我刚才生成的PDF下载不了", "生成PDF需要安装什么"]) {
    assert.equal(ctx.requested(text), false, text);
  }
});
