#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const input = process.argv[2];
const output = process.argv[3] || input?.replace(/\.json$/i, ".clean.en-US.json");

if (!input || !output) {
  console.error("Usage: node scripts/clean-ui-translation-overrides.js <input.json> [output.json]");
  process.exit(1);
}

const hasCJK = (value) => /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ""));
const isModelName = (key) => /^model\..*\.name$/.test(String(key || ""));
const isBrandTag = (key) => /^model\..*\.tag\.(MiniMax|TTS|Gemini)$/.test(String(key || ""));
const isUsefulEnglishValue = (row) => {
  const value = String(row?.value || "").trim();
  if (!value) return false;
  if (hasCJK(value)) return false;
  if (isModelName(row?.key) || isBrandTag(row?.key)) return false;
  return true;
};

const raw = JSON.parse(fs.readFileSync(input, "utf8"));
if (!Array.isArray(raw)) {
  console.error("Input must be a JSON array.");
  process.exit(1);
}

const seen = new Map();
const stats = {
  total: raw.length,
  kept: 0,
  droppedZhCN: 0,
  droppedChineseValue: 0,
  droppedEmpty: 0,
  droppedModelOrBrand: 0,
  droppedOtherLocale: 0,
};

for (const item of raw) {
  const locale = String(item?.locale || "").trim();
  const key = String(item?.key || "").trim();
  const value = String(item?.value || "").trim();
  if (locale === "zh-CN") {
    stats.droppedZhCN++;
    continue;
  }
  if (locale !== "en-US") {
    stats.droppedOtherLocale++;
    continue;
  }
  if (!value) {
    stats.droppedEmpty++;
    continue;
  }
  if (hasCJK(value)) {
    stats.droppedChineseValue++;
    continue;
  }
  if (isModelName(key) || isBrandTag(key)) {
    stats.droppedModelOrBrand++;
    continue;
  }
  if (!key || !isUsefulEnglishValue({ key, value })) continue;
  seen.set(key, {
    locale: "en-US",
    key,
    zh_label: String(item?.zh_label || ""),
    value,
    enabled: item?.enabled !== false,
  });
}

const cleaned = Array.from(seen.values()).sort((a, b) => a.key.localeCompare(b.key));
stats.kept = cleaned.length;

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(cleaned, null, 2) + "\n", "utf8");

console.log(JSON.stringify({ output, ...stats }, null, 2));
