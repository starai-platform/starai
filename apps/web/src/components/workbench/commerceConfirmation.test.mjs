import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("agent.tsx", readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let confirm, restore;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "confirmStep") confirm = node.initializer.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("commerceParamsProjectRef.current")) restore = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
function callback(code, context) {
  return vm.runInNewContext(ts.transpileModule("(" + code + ")", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

test("commerce confirmation sends the current image controls; other workflows keep their payload", async () => {
  for (const code of ["ecommerce_image", "general_image"]) {
    const calls = [];
    const ctx = {
      code, project: { public_id: "project" }, confirmPrompt: "坐姿俯拍", selectedCandidateId: "B",
      count: 3, imageRatio: "9:16", imageSize: "2K", detailSectionCount: 6, detailSectionCountLocked: true,
      setError: message => assert.equal(message, ""), setProject: () => {}, startPolling: () => {},
      buildImageGenerationParams: value => {
        assert.deepEqual(JSON.parse(JSON.stringify(value)), { count: 3, ratio: "9:16", imageSize: "2K" });
        return { count: 3, n: 3, aspect_ratio: "9:16", image_size: "2K", size: "1440x2560" };
      },
      api: async (url, options) => { if (options) calls.push(JSON.parse(options.body)); return { public_id: "project" }; },
    };
    await callback(confirm, ctx)();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.prompt, "坐姿俯拍");
    if (code === "ecommerce_image") assert.deepEqual(calls[0].payload.params, { count: 3, n: 3, aspect_ratio: "9:16", image_size: "2K", size: "1440x2560", detail_section_count: 6, detail_section_count_locked: true });
    else assert.equal(calls[0].payload.params, undefined);
  }
});

test("opening history restores saved confirmation controls without resetting live edits on polling", () => {
  const values = {};
  const ctx = {
    code: "ecommerce_image",
    project: { public_id: "history", inputs: { count: 4, aspect_ratio: "1:1", image_size: "1K", creative_mode: "precise" }, outputs: { confirmation_payload: { params: { count: 2, aspect_ratio: "9:16", image_size: "2K", detail_section_count: 6 } } } },
    commerceParamsProjectRef: { current: "" },
    setCount: value => { values.count = value; }, setImageRatio: value => { values.ratio = value; },
    setImageSize: value => { values.tier = value; }, setDetailSectionCount: value => { values.sections = value; },
    setDetailSectionCountLocked: value => { values.sectionsLocked = value; },
    setCreativeMode: value => { values.creativeMode = value; },
    normalizeCreativeMode: value => value === "render_text" || value === "precise" ? value : "free",
  };
  const run = callback(restore, ctx);
  run();
  assert.deepEqual(values, { count: 2, ratio: "9:16", tier: "2K", sections: 6, sectionsLocked: false, creativeMode: "precise" });
  values.ratio = "16:9";
  run();
  assert.equal(values.ratio, "16:9");
  ctx.project = { public_id: "other", inputs: { count: 3, aspect_ratio: "4:3", image_size: "4K" } };
  run();
  assert.deepEqual(values, { count: 3, ratio: "4:3", tier: "4K", sections: 5, sectionsLocked: false, creativeMode: "free" });
});
