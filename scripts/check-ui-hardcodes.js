const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "apps", "web", "node_modules", "typescript"));
const sourceRoot = path.join(root, "apps", "web", "src");
const cjk = /[\u4e00-\u9fff]/;
const translatedCalls = new Set(["t", "td", "ts"]);

function files(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["i18n", ".next", "node_modules"].includes(entry.name)) files(full, result);
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) result.push(full);
  }
  return result;
}

function callName(node) {
  return ts.isIdentifier(node.expression) ? node.expression.text : "";
}

function isTranslated(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current) && translatedCalls.has(callName(current))) return true;
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return false;
  }
  return false;
}

function isStructural(node) {
  const parent = node.parent;
  return ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
    || ts.isPropertyAssignment(parent)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isTypeLiteralNode(parent) || ts.isLiteralTypeNode(parent))
    || ts.isBinaryExpression(parent)
    || (ts.isCaseClause(parent) && parent.expression === node);
}

function isLogicArgument(node) {
  const parent = node.parent;
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(node)) return false;
  return !["alert", "setError", "setNotice", "setMessage", "setStatus", "toast", ...translatedCalls].includes(callName(parent));
}

function isTranslatedCollection(node) {
  for (let current = node.parent; current && !ts.isFunctionLike(current) && !ts.isSourceFile(current); current = current.parent) {
    if (!ts.isArrayLiteralExpression(current)) continue;
    for (let consumer = current.parent; consumer && !ts.isFunctionLike(consumer) && !ts.isSourceFile(consumer); consumer = consumer.parent) {
      if (!ts.isCallExpression(consumer) || !ts.isPropertyAccessExpression(consumer.expression) || consumer.expression.name.text !== "map") continue;
      return consumer.arguments.some((argument) => ts.isFunctionLike(argument) && /\b(?:t|td|ts)\s*\(/.test(argument.getText()));
    }
    return false;
  }
  return false;
}

function isUserVisible(node) {
  for (let current = node; current && !ts.isFunctionLike(current) && !ts.isSourceFile(current); current = current.parent) {
    if (ts.isJsxAttribute(current) || ts.isJsxExpression(current) || ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) return true;
    if (ts.isCallExpression(current) && ["alert", "setError", "setNotice", "setMessage", "setStatus", "toast"].includes(callName(current))) return true;
  }
  return false;
}

const findings = [];
for (const file of files(sourceRoot)) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && cjk.test(node.text) && !isStructural(node) && !isLogicArgument(node) && !isTranslated(node) && !isTranslatedCollection(node) && isUserVisible(node)) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      findings.push({ file: path.relative(root, file).replace(/\\/g, "/"), line: position.line + 1, value: node.text, start: node.getStart(source), end: node.getEnd(), node, source });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const byFile = new Map();
for (const finding of findings) byFile.set(finding.file, (byFile.get(finding.file) || 0) + 1);
for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`${count}\t${file}`);
if (process.argv.includes("--details")) {
  for (const finding of findings) console.log(`${finding.file}:${finding.line}\t${finding.value}`);
}
if (process.argv.includes("--fix-safe")) {
  const edits = new Map();
  for (const finding of findings) {
    let translator = "";
    for (let current = finding.node.parent; current; current = current.parent) {
      if (!ts.isFunctionLike(current) || !current.body) continue;
      const hook = current.body.getText(finding.source).match(/const\s*\{([^}]+)\}\s*=\s*useI18n\(\)/);
      if (!hook) continue;
      const names = hook[1].split(",").map((name) => name.trim().split(/\s+as\s+/)[0]);
      translator = names.includes("ts") ? "ts" : names.includes("t") ? "t" : "";
      if (translator) break;
    }
    if (!translator) continue;
    const replacement = `${translator}(${JSON.stringify(finding.value)})`;
    const parent = finding.node.parent;
    const text = ts.isJsxAttribute(parent) && parent.initializer === finding.node ? `{${replacement}}` : replacement;
    const fileEdits = edits.get(finding.file) || [];
    fileEdits.push({ start: finding.start, end: finding.end, text });
    edits.set(finding.file, fileEdits);
  }
  let changed = 0;
  for (const [file, fileEdits] of edits) {
    const absolute = path.join(root, file);
    let content = fs.readFileSync(absolute, "utf8");
    for (const edit of fileEdits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
    fs.writeFileSync(absolute, content);
    changed += fileEdits.length;
  }
  console.log(`Safely localized literals: ${changed}`);
}
console.log(`Untranslated visible literals: ${findings.length}`);
if (process.argv.includes("--check") && findings.length) process.exit(1);
