const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "apps", "web", "src");
const outputFile = path.join(root, "docs", "i18n-missing-web-zh.md");
const includeExt = new Set([".ts", ".tsx"]);
const exclude = [
  path.join("apps", "web", "src", "i18n", "dictionaries.ts"),
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, files);
    } else if (includeExt.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function isExcluded(file) {
  const relative = rel(file);
  return exclude.some((item) => relative === item.replace(/\\/g, "/"));
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

const matches = [];
for (const file of walk(srcDir)) {
  if (isExcluded(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  const re = /[\u4e00-\u9fff][^`'"\n\r<>{}]{0,80}/g;
  let m;
  while ((m = re.exec(text))) {
    const value = m[0].trim();
    if (!value) continue;
    if (/^[\u4e00-\u9fff]{1,2}$/.test(value)) continue;
    matches.push({ file: rel(file), line: lineNumber(text, m.index), value });
  }
}

const grouped = new Map();
for (const item of matches) {
  if (!grouped.has(item.file)) grouped.set(item.file, []);
  grouped.get(item.file).push(item);
}

let out = `# 前台 i18n 硬编码中文扫描\n\n`;
out += `> 自动生成。命令：\`node scripts/scan-i18n-missing-web.js\`\n\n`;
out += `共发现 ${matches.length} 处疑似硬编码中文，按文件分组如下。\n\n`;
for (const [file, items] of grouped) {
  out += `## ${file}\n\n`;
  for (const item of items.slice(0, 80)) {
    out += `- L${item.line}: \`${item.value.replace(/`/g, "\\`")}\`\n`;
  }
  if (items.length > 80) out += `- ... 还有 ${items.length - 80} 条\n`;
  out += "\n";
}

fs.writeFileSync(outputFile, out, "utf8");
console.log(`Wrote ${rel(outputFile)} (${matches.length} matches)`);
