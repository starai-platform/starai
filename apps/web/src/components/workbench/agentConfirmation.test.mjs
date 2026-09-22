import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("agent.tsx", readFileSync(new URL("./CreativeAgentWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["confirmPlan", "refreshPlan"].includes(node.name.getText(source))) callbacks.set(node.name.getText(source), node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
function setup(name, overrides = {}) {
  const plan = { intent: "workflow", plan_version: 7 };
  const draft = { version: 7, status: "awaiting_confirmation", plan };
  const ctx = {
    busy: false, messages: [{ role: "assistant", plan, planState: "pending" }], conversationId: "old-conversation",
    conversationIdRef: { current: "old-conversation" }, sessionEpoch: { current: 1 },
    draftRef: { current: draft }, confirmationInFlight: { current: false },
    Error, useCallback: fn => fn, t: key => key,
    setBusy: value => { ctx.busy = value; }, setError: value => { ctx.error = value; },
    setMessages: update => { ctx.messages = update(ctx.messages); },
    refreshPlan: async () => ({ changed: false, draft }), api: async () => draft,
    runWorkflow: async () => {}, createGeneration: async () => {}, ...overrides,
  };
  vm.runInNewContext(ts.transpileModule(`var ${callbacks.get(name)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  return ctx;
}

test("rejected submission leaves old conversation confirmable, then successful retry marks submitted", async () => {
  const ctx = setup("confirmPlan", { runWorkflow: async () => { throw new Error("HTTP 400"); } });
  await ctx.confirmPlan(0);
  assert.equal(ctx.messages[0].planState, "pending");
  assert.equal(ctx.draftRef.current.status, "awaiting_confirmation");
  assert.match(ctx.error, /HTTP 400/);
  assert.equal(ctx.busy, false);
  assert.equal(ctx.confirmationInFlight.current, false);
  ctx.runWorkflow = async () => { assert.equal(ctx.messages[0].planState, "pending"); };
  await ctx.confirmPlan(0);
  assert.equal(ctx.messages[0].planState, "submitted");
});

test("unchanged replan restores a prematurely submitted old UI card without creating a new message", async () => {
  const ctx = setup("refreshPlan");
  ctx.messages[0].planState = "submitted";
  ctx.api = async () => ({ changed: false, draft: ctx.draftRef.current });
  await ctx.refreshPlan(true);
  assert.equal(ctx.messages.length, 1);
  assert.equal(ctx.messages[0].planState, "pending");
});

test("preflight changes do not authorize submission and overlapping clicks stay serialized", async () => {
  const ctx = setup("confirmPlan", { refreshPlan: async () => ({ changed: true }), runWorkflow: async () => assert.fail("changed plan submitted") });
  await ctx.confirmPlan(0);
  assert.equal(ctx.messages[0].planState, "pending");
  ctx.confirmationInFlight.current = true;
  ctx.refreshPlan = async () => assert.fail("second concurrent confirmation");
  await ctx.confirmPlan(0);
});
