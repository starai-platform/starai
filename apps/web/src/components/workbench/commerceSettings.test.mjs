import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("commerce channel, audience and visual controls share one settings menu", () => {
  const source = readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /code === "ecommerce_image" \? "auto" : "main_image"/, "ecommerce should let AI infer the output scene by default");
  const start = source.indexOf('title={ts("电商设置")}');
  const end = source.indexOf("{isComicDrama ?", start);
  assert.ok(start > 0 && end > start, "commerce settings menu not found");
  const menu = source.slice(start, end);
  assert.equal((menu.match(/<MediaOptionMenu\b/g) || []).length, 1, "shared styled selector template missing");
  assert.equal((menu.match(/<select\b/g) || []).length, 0, "native selects do not match the toolbar theme");
  assert.match(menu, /<MediaMenuOption selected=\{!commerceBrief\[setting.key\]\}/, "automatic option is missing");
  for (const field of ['key:"channel"', 'key:"audience"', 'key:"visual"']) assert.match(menu, new RegExp(field));
  assert.match(menu, /setCreativeMode\("free"\)/, "free creation mode is missing");
  assert.match(menu, /setCreativeMode\("precise"\)/, "precise creation mode is missing");
  assert.ok(source.includes('{isDetailPageScene && <MediaOptionMenu icon={<Settings2 size={14}/>} title={ts("详情页模块数")}'), "detail modules should only appear after choosing detail-page output");
  assert.match(source, /detail_section_count_locked: isDetailPageScene \? detailSectionCountLocked : false/, "manual count choice must be sent to the workflow");
  assert.match(source, /setDetailSectionCountLocked\(true\)/, "explicit module selection must lock the count");
  assert.match(source, /allowAutoRatio=\{typeof generationImageRuntime\.allow_auto_ratio === "boolean" \? generationImageAllowsAutoRatio : code === "ecommerce_image"\}/, "ecommerce should use the model capability when available and otherwise default to a scene-aware ratio");
  for (const line of ["发布渠道：${commerceBrief.channel}", "目标受众：${commerceBrief.audience}", "视觉风格：${commerceBrief.visual}"]) assert.ok(source.includes(line), `${line} is not submitted`);
});
