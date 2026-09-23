import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("reference picker preserves draft selection during parent renders and snapshots on reopen", () => {
  const source = ts.createSourceFile("BottomBar.tsx", readFileSync(new URL("./BottomBar.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("setPickedRefs(")) effect = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect, "missing picker initialization effect");
  let previous, picked;
  const context = {
    assetOpen: false, referencePickMode: true, referenceAssetsOnly: false, referenceImages: [], referenceImagesRef: { current: [] },
    setAssetTab() {}, setGalleryMode() {}, setGalleryPage() {}, setReferencePage() {}, setGalleryQuery() {}, setAssetKind() {}, setAssetType() {},
    setPickedRefs(value) { picked = value; },
    useEffect(fn, deps) {
      if (!previous || deps.some((value, i) => value !== previous[i])) fn();
      previous = deps;
    },
  };
  const script = ts.transpileModule(effect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const render = () => vm.runInNewContext(script, context);
  render();
  context.assetOpen = true;
  render();
  picked = [{ url: "selected-in-dialog" }];
  // The carousel gives the child a fresh array on every parent render.
  context.referenceImages = [];
  context.referenceImagesRef.current = context.referenceImages;
  render();
  assert.equal(picked[0].url, "selected-in-dialog");
  context.assetOpen = false;
  render();
  context.referenceImagesRef.current = [{ url: "latest-confirmed" }];
  context.assetOpen = true;
  render();
  assert.equal(picked[0].url, "latest-confirmed");
});

test("shared asset library opens my assets, then defaults inspiration to reference cases", () => {
  const source = readFileSync(new URL("./BottomBar.tsx", import.meta.url), "utf8");
  const pagination = readFileSync(new URL("./AssetPagination.tsx", import.meta.url), "utf8");
  assert.match(source, /const ASSET_PAGE_SIZE = 18/);
  assert.match(source, /if \(referencePickMode\) \{\s*setAssetTab\("mine"\)/);
  assert.match(source, /onClick=\{\(\) => \{\s*setAssetTab\("mine"\);\s*setGalleryMode\("reference"\);\s*setAssetOpen\(true\)/, "opening must select my assets before the modal paints");
  assert.match(source, /setGalleryMode\("reference"\)/);
  assert.match(source, /gallery\.referenceCases[\s\S]*gallery\.communityWorks/);
  assert.match(source, /page_size=\$\{ASSET_PAGE_SIZE\}/, "community pages must load on demand");
  assert.match(source, /loadReferenceGalleryManifest\(\)/, "reference cases must be available in the shared picker");
  assert.match(pagination, /pageSize = 18/);
});

test("main inspiration gallery defaults to references and pages both sources by 18", () => {
  const source = readFileSync(new URL("./GalleryPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /useState<"reference" \| "community">\("reference"\)/);
  assert.match(source, /const GALLERY_PAGE_SIZE = 18/);
  assert.match(source, /page=\$\{communityPage\}&page_size=\$\{GALLERY_PAGE_SIZE\}/);
  assert.match(source, /referenceItems\.slice\(\(referencePage - 1\) \* GALLERY_PAGE_SIZE, referencePage \* GALLERY_PAGE_SIZE\)/);
  assert.match(source, /<AssetPagination page=\{communityPage\}/);
});

test("all workbench asset pickers share the system dialog", () => {
  const dialog = readFileSync(new URL("./SystemAssetLibraryDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /const PAGE_SIZE = 18/);
  assert.match(dialog, /useState<"mine" \| "gallery">\("mine"\)/);
  assert.match(dialog, /"all" \| "role" \| "prop" \| "scene" \| "image" \| "video" \| "audio" \| "doc"/);
  assert.match(dialog, /type: categoryConfig\?\.type/);
  assert.match(dialog, /setTab\("mine"\)/);
  assert.match(dialog, /setGalleryMode\("reference"\)/);
  for (const file of ["BottomBar.tsx", "AgentWorkspace.tsx", "ProductRefineWorkspace.tsx", "VideoUpscaleWorkspace.tsx", "InfiniteCanvasWorkspace.tsx", "NovelWorkshopLanding.tsx"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(source, /SystemAssetLibraryDialog/, `${file} must use the shared system asset dialog`);
  }
});

test("model workspace keeps upload controls before the prompt instead of the top parameter row", () => {
  const source = readFileSync(new URL("./ModelWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /<ChatTopTools value=\{bottom\} onChange=\{setBottom\} showUpload=\{false\} \/>/);
  assert.match(source, /showAssets=\{false\} showRole=\{false\}/);
  assert.match(source, /uploadVariant="card"/);
  assert.match(source, /isVideo \? \([\s\S]*?<VideoUploadArea[\s\S]*?<textarea/);
  assert.match(source, /isImage \? \([\s\S]*?type="file"[\s\S]*?<textarea/);
  assert.match(source, /isAudio \? \([\s\S]*?<AudioUploadButton[\s\S]*?<textarea/);
});
