const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "packages/shared-types/src/index.ts");
const dictionaryPath = path.join(root, "apps/web/src/i18n/dictionaries.ts");
const outputPath = path.join(root, "services/api/internal/service/ui_translation_catalog.json");
const source = fs.readFileSync(sourcePath, "utf8");
const start = source.indexOf("export const UI_TRANSLATION_ZH_LABELS");
if (start < 0) throw new Error("UI_TRANSLATION_ZH_LABELS not found");
const block = source.slice(start, source.indexOf("\n};", start) + 3);
const catalog = {};
for (const match of block.matchAll(/^\s*("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*")\s*,?$/gm)) {
  catalog[JSON.parse(match[1])] = JSON.parse(match[2]);
}

// The shared label map only contains keys used by configuration-driven UI.
// Include every canonical Web i18n key as well, otherwise valid t("...")
// calls that only exist in dictionaries.ts never enter the AI backfill queue.
const dictionarySource = fs.readFileSync(dictionaryPath, "utf8");
const zhStart = dictionarySource.indexOf("const zh:");
const zhEnd = dictionarySource.indexOf("\n};", zhStart);
if (zhStart < 0 || zhEnd < 0) throw new Error("zh UI dictionary not found");
const zhBlock = dictionarySource.slice(zhStart, zhEnd + 3);
for (const match of zhBlock.matchAll(/^\s*("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*")\s*,?$/gm)) {
  catalog[JSON.parse(match[1])] = JSON.parse(match[2]);
}

function sourceKey(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `source.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function addSourceValue(rawValue) {
  const value = rawValue.trim();
  if (value.length < 2 || !/[\u4e00-\u9fff]/.test(value) || value.includes("${")) return;
  const key = sourceKey(value);
  if (catalog[key] && catalog[key] !== value) throw new Error(`source key collision: ${key}`);
  catalog[key] = value;
}

const webSrc = path.join(root, "apps/web/src");
const excluded = new Set([
  "i18n/dictionaries.ts", "i18n/I18nProvider.tsx", "lib/static-i18n.ts", "lib/notificationText.ts",
]);
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) {
      const relative = path.relative(webSrc, full).replace(/\\/g, "/");
      if (excluded.has(relative)) continue;
      const text = fs.readFileSync(full, "utf8");
      // Preserve the entire literal, including ASCII prefixes/suffixes such as
      // "AI 大模型聚合平台". The broad fallback scan below intentionally finds
      // JSX fragments too, but by itself would hash only the Chinese suffix.
      for (const match of text.matchAll(/"([^"\n]*[\u4e00-\u9fff][^"\n]*)"|'([^'\n]*[\u4e00-\u9fff][^'\n]*)'|`([^`\n]*[\u4e00-\u9fff][^`\n]*)`/g)) {
        addSourceValue(match[1] || match[2] || match[3] || "");
      }
      for (const match of text.matchAll(/>([^<>{}\n]*[\u4e00-\u9fff][^<>{}\n]*)</g)) {
        addSourceValue(match[1] || "");
      }
      for (const match of text.matchAll(/[\u4e00-\u9fff][^`'"\n\r<>{}]{0,120}/g)) {
        addSourceValue(match[0]);
      }
    }
  }
}
walk(webSrc);
if (!Object.keys(catalog).length) throw new Error("UI translation catalog is empty");
fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(root, outputPath)} (${Object.keys(catalog).length} keys)`);
