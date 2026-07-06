import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface ChangelogEntry {
  version: string;
  date?: string;
  items: string[];
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

function compareVersionsDesc(a: string, b: string) {
  const left = a.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^##\s+(.+?)(?:\s+-\s+(.+))?$/);
    if (heading) {
      current = { version: heading[1].trim().replace(/^v/i, ""), date: heading[2]?.trim(), items: [] };
      entries.push(current);
      continue;
    }

    const item = line.match(/^[-*]\s+(.+)$/);
    if (item && current) {
      current.items.push(item[1].trim());
    }
  }

  return entries.sort((a, b) => {
    const versionDiff = compareVersionsDesc(a.version, b.version);
    if (versionDiff !== 0) return versionDiff;
    return String(b.date || "").localeCompare(String(a.date || ""));
  });
}

async function readChangelog() {
  const candidates = [
    path.join(process.cwd(), "apps", "admin", "CHANGELOG.md"),
    path.join(process.cwd(), "CHANGELOG.md"),
    path.join(process.cwd(), "..", "apps", "admin", "CHANGELOG.md"),
  ];

  for (const file of candidates) {
    try {
      return await readFile(file, "utf8");
    } catch {
      /* try next path */
    }
  }

  throw new Error("CHANGELOG.md not found");
}

export async function GET() {
  try {
    const changelog = parseChangelog(await readChangelog());
    const version = changelog[0]?.version || "0.0.0";
    return NextResponse.json(
      { version, changelog },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json(
      { version: "0.0.0", changelog: [{ version: "0.0.0", items: ["暂无更新记录。"] }] },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
