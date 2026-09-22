import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./agentPolling.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { nextAgentPollDelay } = module.exports;

test("agent polling stays responsive first and backs off for unchanged or failed jobs", () => {
  assert.equal(nextAgentPollDelay(0), 2000);
  assert.equal(nextAgentPollDelay(5), 4000);
  assert.equal(nextAgentPollDelay(15), 8000);
  assert.equal(nextAgentPollDelay(0, 1), 4000);
  assert.equal(nextAgentPollDelay(0, 4), 20000);
  assert.equal(nextAgentPollDelay(0, 20), 20000);
});
