const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "infra", "migrations");
const files = fs.readdirSync(dir);
const ups = files.filter((name) => name.endsWith(".up.sql")).sort();
const downs = new Set(files.filter((name) => name.endsWith(".down.sql")));
const errors = [];

for (const up of ups) {
  const down = up.replace(/\.up\.sql$/, ".down.sql");
  if (!downs.has(down)) errors.push(`missing rollback migration: ${down}`);
}

const legacyDuplicateNumbers = new Set(["018", "020"]);
const byNumber = new Map();
for (const up of ups) {
  const number = up.match(/^(\d+)_/)?.[1];
  if (!number) {
    errors.push(`invalid migration name: ${up}`);
    continue;
  }
  const grouped = byNumber.get(number) || [];
  grouped.push(up);
  byNumber.set(number, grouped);
}
for (const [number, grouped] of byNumber) {
  if (grouped.length > 1 && !legacyDuplicateNumbers.has(number)) {
    errors.push(`duplicate migration number ${number}: ${grouped.join(", ")}`);
  }
}

const manifestPath = path.join(dir, "checksums.sha256");
const manifest = new Map(
  fs.readFileSync(manifestPath, "utf8").trim().split(/\r?\n/).map((line) => {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+\.up\.sql)$/);
    if (!match) throw new Error(`invalid checksum line: ${line}`);
    return [match[2], match[1]];
  })
);
for (const up of ups) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, up))).digest("hex");
  if (!manifest.has(up)) errors.push(`missing checksum entry: ${up}`);
  else if (manifest.get(up) !== actual) errors.push(`migration checksum changed: ${up}`);
}
for (const name of manifest.keys()) {
  if (!ups.includes(name)) errors.push(`stale checksum entry: ${name}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Verified ${ups.length} migration pairs, numbers, and checksums.`);
