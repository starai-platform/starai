import { memo, type ReactNode } from "react";

type Source = { title: string; url: string };

function inline(text: string, sources: Source[]): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[\d{1,3}\])/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em] dark:bg-white/10">{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold text-gray-950 dark:text-white">{part.slice(2, -2)}</strong>;
    const citation = part.match(/^\[(\d{1,3})\]$/);
    const source = citation && sources[Number(citation[1]) - 1];
    if (source && /^https?:\/\//i.test(source.url)) return <a key={index} href={source.url} target="_blank" rel="noreferrer" title={source.title} className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-semibold leading-none text-primary hover:bg-primary/20">{citation[1]}</a>;
    return <span key={index}>{part}</span>;
  });
}

function heading(line: string): { level: number; text: string } | null {
  const markdown = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
  if (markdown) return { level: markdown[1].length, text: markdown[2] };
  // Older contract replies may have no Markdown markers. Only recognize
  // standalone titles, never promote a sentence containing a clause reference.
  if (/^[\p{Script=Han}]{0,16}(?:合同|协议)(?:书)?$/u.test(line)) return { level: 1, text: line };
  if (/^第[一二三四五六七八九十百零〇\d]+[条章]\s*[^\s。！？；：:，,]{1,20}$/.test(line)) return { level: 2, text: line };
  return null;
}

const bullet = /^[-*+•]\s+(.+)$/;
const numbered = /^(\d+)[.)、]\s*(.+)$/;
const rule = /^(?:-{3,}|\*{3,}|_{3,})$/;
const tableSeparator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const tableCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
const headingSizes = ["text-2xl leading-9", "text-xl leading-8", "text-lg leading-7", "text-base leading-7", "text-[15px] leading-7", "text-sm leading-6"];

export const AgentRichText = memo(function AgentRichText({ content, sources = [] }: { content: string; sources?: Source[] }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  const isTableStart = (index: number) => lines[index]?.includes("|") && tableSeparator.test(lines[index + 1] || "");
  const startsBlock = (line: string) => heading(line) || /^(?:```|~~~|>)/.test(line) || bullet.test(line) || numbered.test(line) || rule.test(line);
  for (let i = 0; i < lines.length;) {
    const key = i;
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const fence = /^(\x60{3,}|~{3,})/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      // The last block may still be streaming and have no closing fence yet.
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      if (i < lines.length) i++;
      nodes.push(<pre key={key} className="my-4 overflow-x-auto rounded-xl bg-gray-950 px-4 py-3 text-sm leading-6 text-gray-100"><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const title = heading(line);
    if (title) {
      const Tag = `h${title.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      nodes.push(<Tag key={key} className={`${headingSizes[title.level - 1]} mb-3 mt-6 font-bold tracking-tight text-gray-950 first:mt-0 dark:text-white`}>{inline(title.text, sources)}</Tag>);
      i++;
      continue;
    }
    if (isTableStart(i)) {
      const headers = tableCells(lines[i]);
      const alignment = tableCells(lines[i + 1]).map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "text-center" : cell.endsWith(":") ? "text-right" : "text-left");
      i += 2;
      const rows: ReactNode[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const cells = tableCells(lines[i]);
        rows.push(<tr key={i}>{cells.map((cell, column) => <td key={column} className={`border-t border-gray-200 px-3 py-2 align-top dark:border-white/10 ${alignment[column] || "text-left"}`}>{inline(cell, sources)}</td>)}</tr>);
        i++;
      }
      nodes.push(<div key={key} className="my-4 max-w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10"><table className="w-full text-sm leading-6"><thead className="bg-gray-50 dark:bg-white/5"><tr>{headers.map((cell, column) => <th key={column} scope="col" className={`px-3 py-2 font-semibold ${alignment[column]}`}>{inline(cell, sources)}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>);
      continue;
    }
    if (rule.test(line)) { nodes.push(<hr key={key} className="my-5 border-gray-200 dark:border-white/10" />); i++; continue; }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) quote.push(lines[i++].trim().replace(/^>\s?/, ""));
      nodes.push(<blockquote key={key} className="my-4 border-l-4 border-primary/40 bg-primary/5 px-4 py-2 text-gray-600 dark:text-gray-300">{inline(quote.join("\n"), sources)}</blockquote>);
      continue;
    }
    const ordered = numbered.exec(line);
    if (ordered || bullet.test(line)) {
      const items: ReactNode[] = [];
      const pattern = ordered ? numbered : bullet;
      let match: RegExpExecArray | null;
      while (i < lines.length && (match = pattern.exec(lines[i].trim()))) {
        const itemKey = i;
        const value = ordered ? Number(match[1]) : undefined;
        const body = [match[ordered ? 2 : 1]];
        i++;
        while (i < lines.length && lines[i].trim() && !startsBlock(lines[i].trim()) && !isTableStart(i)) body.push(lines[i++]);
        items.push(<li key={itemKey} value={value}>{inline(body.join("\n"), sources)}</li>);
      }
      const className = "my-3 space-y-1.5 pl-6 marker:text-gray-500 dark:marker:text-gray-400";
      nodes.push(ordered ? <ol key={key} start={Number(ordered[1])} className={`list-decimal ${className}`}>{items}</ol> : <ul key={key} className={`list-disc ${className}`}>{items}</ul>);
      continue;
    }
    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i].trim()) && !isTableStart(i)) paragraph.push(lines[i++]);
    nodes.push(<p key={key} className="my-3 first:mt-0 last:mb-0">{inline(paragraph.join("\n"), sources)}</p>);
  }
  return <div className="agent-rich-text min-w-0 break-words text-[15px] leading-8 text-gray-700 dark:text-gray-200">{nodes}</div>;
});
