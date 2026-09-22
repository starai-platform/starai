import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const workspace = readFileSync(new URL("./CreativeAgentWorkspace.tsx", import.meta.url), "utf8");
const source = workspace.slice(workspace.indexOf("async function streamAgentPlan("), workspace.indexOf("async function copyAgentText("));
const reader = readFileSync(new URL("../../lib/eventStream.ts", import.meta.url), "utf8").replace(/export /g, "");
const compiled = ts.transpileModule(reader + source + "\nglobalThis.run = streamAgentPlan;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const run = (body, events) => {
  const context = { API_URL: "", legacyAuthHeaders: () => ({}), setTimeout, clearTimeout, TextDecoder, fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }) };
  vm.runInNewContext(compiled, context);
  return context.run({}, (event, data) => events.push({ event, ...data }));
};

test("bursty tokens are batched, first token is immediate and final text is lossless", async () => {
  const events = [];
  const chunks = ["# 标题\n", ...Array.from({ length: 1000 }, (_, index) => `正文${index}。`)];
  const body = frame("meta", { conversation_id: "conv" }) + chunks.map(content => frame("delta", { content })).join("") + frame("status", { message: "正在检查回复与任务约束…" }) + frame("done", { plan: { intent: "chat", reply: chunks.join("") } });
  const result = await run(body, events);
  const deltas = events.filter(event => event.event === "delta");
  assert.equal(deltas[0].content, chunks[0]);
  assert.equal(deltas.map(event => event.content).join(""), chunks.join(""));
  assert.ok(deltas.length < 10, `too many renders: ${deltas.length}`);
  assert.equal(result.conversation_id, "conv");
  assert.equal(result.plan.reply, chunks.join(""));
  assert.equal(events.at(-2).event, "status");
  assert.equal(events.at(-1).event, "done");
});

test("slow streams keep updating before done; disconnected streams preserve partial text and fail", async () => {
  const events = [];
  const encoder = new TextEncoder();
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const pending = run(body, events);
  controller.enqueue(encoder.encode(frame("delta", { content: "第一段" })));
  controller.enqueue(encoder.encode(frame("delta", { content: "第二段" })));
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(events.map(event => event.content || "").join(""), "第一段第二段");
  controller.close();
  await assert.rejects(pending, /连接已中断/);
  const errors = [];
  await assert.rejects(run(frame("delta", { content: "半份合同" }) + frame("error", { message: "模型异常" }), errors), /模型异常/);
  assert.equal(errors[0].content, "半份合同");
  await assert.rejects(run(frame("done", {}), []), /未收到完整结果/);
});
