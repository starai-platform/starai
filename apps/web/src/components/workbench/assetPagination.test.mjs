import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Run the actual loaders with controlled responses; no browser or paid jobs.
function loader(file, name, extra = {}) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  const state = { items: [], page: 1, total: 0, loading: false };
  const context = {
    useCallback: fn => fn, authenticated: true, t: key => key,
    ASSET_PAGE_SIZE: 18,
    assetKind: "all", assetType: "all", assetQuery: "", assetPage: 1, referencePickMode: false,
    assetTargetKind: "image", assetAppliedQuery: { current: "" },
    assetRequest: { current: 0 }, assetFilterKey: { current: "" }, assetCache: { current: new Map() },
    setAssetItems: value => { state.items = value; }, setAssetPage: value => { state.page = value; },
    setAssetTotal: value => { state.total = value; }, setAssetLoading: value => { state.loading = value; },
    setAssetNotice: value => { state.error = value; }, setNotice: value => { state.error = value; }, ...extra,
  };
  vm.runInNewContext(ts.transpileModule(`var ${declaration.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, state, run: context[name] };
}

test("library sends real page queries, resets filters, retains selected metadata and clamps deleted last pages", async () => {
  const requests = [];
  const { context, state, run } = loader("./BottomBar.tsx", "loadAssets", {
    listAssets: async params => { requests.push(params); return { items: [{ public_id: `a${params.page}`, name: `Page ${params.page}` }], total: 41 }; },
  });
  await run();
  context.assetPage = 2;
  await run();
  assert.deepEqual(requests.map(r => [r.page, r.page_size]), [[1, 18], [2, 18]]);
  assert.equal(context.assetCache.current.get("a1").name, "Page 1");
  context.assetQuery = "lesson";
  await run();
  assert.equal(requests.at(-1).page, 1);
  assert.equal(requests.at(-1).q, "lesson");
  context.assetPage = 3;
  context.listAssets = async () => ({ items: [], total: 36 });
  await run();
  assert.equal(state.page, 2);
  assert.equal(state.total, 36);
});

for (const [file, name] of [["./BottomBar.tsx", "loadAssets"]]) {
  test(`${name} ignores stale responses and reports failures`, async () => {
    const pending = [];
    const { context, state, run } = loader(file, name, { listAssets: params => new Promise(resolve => pending.push({ params, resolve })) });
    const first = run();
    const second = run({ q: "new" });
    pending[1].resolve({ items: [{ public_id: "new" }], total: 45 });
    await second;
    pending[0].resolve({ items: [{ public_id: "old" }], total: 1 });
    await first;
    assert.equal(state.items[0].public_id, "new");
    assert.equal(state.total, 45);
    assert.equal(state.loading, false);
    assert.equal(pending[1].params.page_size, 18);
    context.listAssets = async () => { throw new Error("network error"); };
    await run();
    assert.equal(state.items.length, 0);
    assert.equal(state.loading, false);
    assert.ok(state.error);
  });
}
