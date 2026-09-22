import assert from "node:assert/strict";
import test from "node:test";
import { apiCached, apiForLocaleCached, clearApiCache } from "./api.ts";

const response = (data) => new Response(JSON.stringify({ code: 0, data }));

test("metadata reads coalesce, isolate locales and retry failures", async (t) => {
  clearApiCache();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => response(++calls));
  const values = await Promise.all([apiForLocaleCached("/models", "zh-CN"), apiForLocaleCached("/models", "zh-CN")]);
  assert.deepEqual(values, [1, 1]);
  assert.equal(await apiForLocaleCached("/models", "en-US"), 2);
  globalThis.fetch.mock.mockImplementationOnce(async () => { throw new Error("offline"); });
  await assert.rejects(apiCached("/retry"), /offline/);
  assert.equal(await apiCached("/retry"), 3);
});

test("a failed request from before cache invalidation cannot evict the new response", async (t) => {
  clearApiCache();
  let rejectOld;
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return calls === 1 ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve(response("new"));
  });
  const old = apiCached("/same");
  const rejected = assert.rejects(old, /old failure/);
  clearApiCache();
  assert.equal(await apiCached("/same"), "new");
  rejectOld(new Error("old failure"));
  await rejected;
  assert.equal(await apiCached("/same"), "new");
  assert.equal(calls, 2);
});

test("metadata cache expires entries and caps retained responses", async (t) => {
  clearApiCache();
  let now = 1000;
  let calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => response(++calls));
  assert.equal(await apiCached("/expires", 10), 1);
  now += 11;
  assert.equal(await apiCached("/expires", 10), 2);
  clearApiCache();
  for (let i = 0; i < 129; i++) await apiCached(`/model/${i}`);
  const previous = calls;
  await apiCached("/model/0");
  assert.equal(calls, previous + 1);
  await apiCached("/model/128");
  assert.equal(calls, previous + 1);
});
