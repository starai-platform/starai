import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("commerce workspace enhances prompts without inventing product facts", () => {
  const source = readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /const enhanceCommercePrompt = async \(\) =>/);
  assert.match(source, /"\/api\/canvases\/enhance-prompt"/);
  assert.match(source, /target_kind: selectedSceneMeta\.code/);
  assert.match(source, /clientScenePrompt\(selectedSceneMeta\.code, selectedSceneMeta\.label, generationType\)/);
  assert.match(source, /不得虚构商品功效、参数、材质、品牌/);
  assert.match(source, /信息互相冲突时，必须在增强结果中标记需确认/);
  assert.match(source, /current\.trim\(\) === original \? enhanced : current/, "an async response must not overwrite newer user edits");
  assert.match(source, /aria-label=\{ts\("增强提示词"\)\}/);
  assert.ok(source.includes('{usesCompactCommerceInput && <button type="button"'), "both commerce workspaces should expose the enhance icon");
  assert.match(source, /absolute bottom-2 right-3/, "enhance icon should live inside the text area at bottom right");
  assert.match(source, /disabled=\{!prompt\.trim\(\) \|\| promptEnhancing\}/);
  assert.doesNotMatch(source, /\{promptEnhancing \? ts\("增强中…"\) : ts\("增强提示词"\)\}/, "the old toolbar text button should be removed");
});

test("image workspaces share a readable inline reference area", () => {
  const source = readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /relative flex min-w-0 items-start/);
  assert.match(source, /code === "ecommerce_image" \|\| code === "ecommerce_video"/);
  assert.match(source, /usesInlineReferenceInput = usesCompactCommerceInput \|\| code === "general_image"/);
  assert.match(source, /max-w-\[52%\].*currentComicReferences/s);
  assert.match(source, /group\/img relative h-16 w-16/, "reference thumbnails should not collapse back to tiny icon-sized controls");
  assert.match(source, /code === "general_image" && supportReferenceImage.*productImage/s);
  assert.match(source, /code === "ecommerce_video".*max-h-\[88px\] max-w-\[52%\].*<VideoUploadArea/s);
  assert.match(source, /左侧可上传主体、背面、细节或包装参考图/);
  assert.match(source, /左侧可按当前模型上传商品参考图、首尾帧、参考视频或音频/);
  assert.match(source, /描述想生成的画面；左侧可上传参考图/);
  assert.doesNotMatch(source, /首图为商品主体，可补充背面、细节、包装/);
  assert.match(source, /relative z-10 shrink-0 px-3 pb-2 pt-1 sm:px-6 sm:pb-3/);
});

test("comic source mode sits between the asset library and help on one row", () => {
  const source = readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8");
  const row = source.slice(source.indexOf('scroll-x-only grid grid-cols-[1fr_auto_1fr] items-center gap-2 overflow-x-auto'), source.indexOf('<div className="flex min-h-[92px]'));
  const library = row.indexOf('openComicImageLibrary("references")');
  const sourceMode = row.indexOf('checked={comicSourceMode}');
  const help = row.indexOf('setHelpOpen(true)');
  assert.ok(library >= 0 && sourceMode > library && help > sourceMode);
  assert.match(row, /justify-self-start/);
  assert.match(row, /justify-self-center/);
  assert.match(row, /justify-self-end/);
  assert.doesNotMatch(source, /px-4 pt-3 text-xs.*checked=\{comicSourceMode\}/s, "source mode should not occupy its own row");
});
