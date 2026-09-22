import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("commerce channel, audience and visual controls share one settings menu", () => {
  const source = readFileSync(new URL("./AgentWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /useState\("main_image"\)/, "ecommerce should open on the product main image scene");
  assert.doesNotMatch(source, /setSelectedScene\(code === "ecommerce_image" \? "auto"/, "workspace initialization overrides the product main image default");
  const start = source.indexOf('title={ts("电商设置")}');
  const end = source.indexOf("{isComicDrama ?", start);
  assert.ok(start > 0 && end > start, "commerce settings menu not found");
  const menu = source.slice(start, end);
  assert.equal((menu.match(/<MediaOptionMenu\b/g) || []).length, 1, "shared styled selector template missing");
  assert.equal((menu.match(/<select\b/g) || []).length, 0, "native selects do not match the toolbar theme");
  assert.match(menu, /<MediaMenuOption selected=\{!commerceBrief\[setting.key\]\}/, "automatic option is missing");
  for (const field of ['key:"channel"', 'key:"audience"', 'key:"visual"']) assert.match(menu, new RegExp(field));
  for (const line of ["发布渠道：${commerceBrief.channel}", "目标受众：${commerceBrief.audience}", "视觉风格：${commerceBrief.visual}"]) assert.ok(source.includes(line), `${line} is not submitted`);
});
