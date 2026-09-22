import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("detail previews keep typeset output when API hydrates original photo tasks", () => {
  const source = ts.createSourceFile("agent.tsx", readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "resolvedAgentMediaTasks");
  assert.ok(fn);
  const ctx = {};
  vm.runInNewContext(ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  const task = { task_no: "photo", status: "succeeded", progress: 100, output: { image_url: "remote-photo" } };
  const finished = { ...task, output: { source_image_url: "remote-photo", image_url: "local-typeset" } };
  const project = { inputs: { creative_scene: "detail_image" }, media_tasks: [task], outputs: { media_tasks: [finished] } };
  assert.equal(ctx.resolvedAgentMediaTasks(project)[0].output.image_url, "local-typeset");
  assert.equal(task.output.image_url, "remote-photo");
  project.inputs.creative_scene = "auto";
  project.outputs.analysis = { creative_scene: "detail_image" };
  assert.equal(ctx.resolvedAgentMediaTasks(project)[0].output.image_url, "local-typeset");
  delete project.outputs.analysis;
  project.outputs.detail_page = { render_mode: "typeset_modules" };
  assert.equal(ctx.resolvedAgentMediaTasks(project)[0].output.image_url, "local-typeset");
  delete project.outputs.detail_page;
  project.inputs.creative_scene = "detail_image";
  task.status = "failed";
  assert.equal(ctx.resolvedAgentMediaTasks(project)[0].status, "failed");
  project.inputs.creative_scene = "main_image";
  assert.equal(ctx.resolvedAgentMediaTasks(project)[0].output.image_url, "remote-photo");
});

test("commerce autopilot submits the edited confirmation instead of dropping it", async () => {
  const source = ts.createSourceFile("agent.tsx", readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "enableAutopilot") declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration);
  let confirmed = 0, enabled = 0;
  const ctx = { code: "ecommerce_image", project: { status: "waiting_confirm", public_id: "test" }, confirmStep: async () => { confirmed++; }, api: async () => { enabled++; }, startPolling() {} };
  vm.runInNewContext(ts.transpileModule(`var ${declaration.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  await ctx.enableAutopilot();
  assert.equal(confirmed, 1);
  assert.equal(enabled, 0);
  ctx.code = "other_agent";
  await ctx.enableAutopilot();
  assert.equal(enabled, 1);
});

test("fresh agent images bypass the Next image proxy", () => {
  const source = readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8");
  const card = source.slice(source.indexOf("function MediaResultCard"));
  assert.match(card, /<Image unoptimized src=\{url\}/, "result image still depends on the delayed image optimizer");
});

test("detail results prioritize the artifact over workflow chrome", () => {
  const source = readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8");
  const panel = source.slice(source.indexOf("function DetailPagePanel"), source.indexOf("function MediaTaskGrid"));
  const result = source.slice(source.indexOf('project && ('), source.indexOf('<div className="relative z-10 shrink-0 px-3 pb-2 pt-1'));
  assert.match(source, /成品已就绪，可继续核对或下载/);
  assert.doesNotMatch(result, /grid grid-cols-4 gap-2/, "the completed result should not be buried under four stage pills");
  assert.match(panel, /AI 已完成商品详情页/);
  assert.match(panel, /查看模块规划与文案/);
  assert.match(panel, /open=\{!longURL\}/, "module planning should collapse once the final artifact exists");
  assert.doesNotMatch(panel, /max-h-\[620px\] overflow-y-auto/, "the long image should scroll with the result page instead of inside a nested viewport");
  assert.match(result, /!\(detailPage && textOf\(detailPage\.long_image_url\)\)/, "raw module cards should not duplicate a finished long image");
});
