import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("agent retry falls back to workflow retry for unsupported failed nodes", async () => {
  const source = ts.createSourceFile("agent.tsx", readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "retry") callback = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);

  const calls = [];
  const errors = [];
  const ctx = {
    project: { public_id: "project", node_runs: [{ node_id: "analysis", status: "failed" }] },
    comicSettings: { image_model_code: "image", video_model_code: "video" },
    ts: value => value,
    setError: value => errors.push(value),
    startPolling: id => calls.push(`poll:${id}`),
    api: async (url, options) => calls.push({ url, options }),
  };
  vm.runInNewContext(ts.transpileModule(`globalThis.retry = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);

  await ctx.retry();
  assert.equal(calls[0].url, "/api/agent-projects/project/retry");
  assert.equal(calls[1], "poll:project");

  calls.length = 0;
  ctx.project.node_runs[0].node_id = "generate";
  await ctx.retry();
  assert.equal(calls[0].url, "/api/agent-projects/project/retry-node");
  assert.equal(JSON.parse(calls[0].options.body).node_id, "generate");

  ctx.api = async () => { throw new Error("retry unavailable"); };
  await ctx.retry();
  assert.equal(errors.at(-1), "重试失败");
});
