import assert from "node:assert/strict";
import test from "node:test";
import { pollAsync } from "./pollAsync.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("polling waits for completion, recovers after failure and aborts without rescheduling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let release;
  let signal;
  const stop = pollAsync(async (currentSignal) => {
    signal = currentSignal;
    calls += 1;
    if (calls === 1) await new Promise((resolve) => { release = resolve; });
    else throw new Error("temporary network failure");
  }, 100);
  t.after(stop);
  t.mock.timers.tick(99);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  assert.equal(calls, 1);
  t.mock.timers.tick(1000);
  assert.equal(calls, 1);
  release();
  await settle();
  t.mock.timers.tick(100);
  await settle();
  assert.equal(calls, 2);
  t.mock.timers.tick(100);
  await settle();
  assert.equal(calls, 3);
  stop();
  assert.equal(signal.aborted, true);
  t.mock.timers.tick(1000);
  assert.equal(calls, 3);
});

test("stopping an in-flight poll prevents a late response from restarting it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release;
  let calls = 0;
  let signal;
  const stop = pollAsync(async (currentSignal) => {
    calls++;
    signal = currentSignal;
    await new Promise((resolve) => { release = resolve; });
  }, 100, true);
  t.mock.timers.tick(0);
  stop();
  release();
  await settle();
  t.mock.timers.tick(1000);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test("polling pauses in hidden tabs and refreshes immediately when visible", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalDocument = globalThis.document;
  const fakeDocument = new EventTarget();
  fakeDocument.hidden = true;
  globalThis.document = fakeDocument;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });

  let calls = 0;
  const stop = pollAsync(async () => { calls++; }, 100, true);
  t.after(stop);
  t.mock.timers.tick(500);
  await settle();
  assert.equal(calls, 0);

  fakeDocument.hidden = false;
  fakeDocument.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(0);
  await settle();
  assert.equal(calls, 1);
});
