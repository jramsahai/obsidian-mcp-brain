/**
 * Minimal read-only YAML frontmatter parser.
 *
 * The vault's frontmatter is flat: scalars, inline arrays (`topics: [a, b]`),
 * and block lists. We deliberately never re-serialize frontmatter — writes go
 * through targeted line edits — so a full YAML library would only add bundle
 * weight and round-trip reformatting risk.
 */

export type FrontmatterValue = string | number | boolean | null | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export interface ParsedNote {
  /** Raw frontmatter block text, without the `---` fences. Empty when absent. */
  raw: string;
  data: Frontmatter;
  /** Body text after the closing fence. */
  body: string;
  /** Line index (0-based) at which the body starts within the full file. */
  bodyStartLine: number;
}

const KV_LINE_RE = /^([A-Za-z0-9_][A-Za-z0-9_ -]*):\s*(.*)$/;

/**
 * Index of the closing `---`, or -1 when the note has no frontmatter.
 *
 * A leading `---` is not proof on its own: a note may open with a horizontal
 * rule, and treating the prose between two rules as YAML silently drops it from
 * every read. The block only counts when its interior actually looks like YAML.
 * Prose containing a colon is still indistinguishable from a key — that
 * ambiguity is inherent to the syntax, and erring toward "frontmatter" there
 * matches what Obsidian itself does.
 *
 * Exported so `scan.ts` classifies the same lines the same way; when the two
 * disagreed, a heading inside the false frontmatter was invisible to section
 * lookups while still being visible to the body reader.
 */
export function frontmatterEndLine(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return looksLikeFrontmatter(lines.slice(1, i)) ? i : -1;
    }
  }
  return -1;
}

function looksLikeFrontmatter(inner: string[]): boolean {
  for (const line of inner) {
    if (!line.trim()) continue;
    if (line.trimStart().startsWith("#")) continue; // YAML comment
    if (/^\s*-\s+/.test(line)) continue; // block-list item under a key
    if (!KV_LINE_RE.test(line)) return false;
  }
  // An empty block is unambiguous frontmatter, not a pair of rules.
  return true;
}

export function parseNote(content: string): ParsedNote {
  const lines = content.split("\n");
  const end = frontmatterEndLine(lines);
  if (end === -1) {
    return { raw: "", data: {}, body: content, bodyStartLine: 0 };
  }
  const raw = lines.slice(1, end).join("\n");
  return {
    raw,
    data: parseFrontmatter(raw),
    body: lines.slice(end + 1).join("\n"),
    bodyStartLine: end + 1,
  };
}

export function parseFrontmatter(raw: string): Frontmatter {
  const data: Frontmatter = {};
  const lines = raw.split("\n");
  let currentKey: string | null = null;
  let block: string[] | null = null;

  const flush = () => {
    if (currentKey !== null && block !== null) data[currentKey] = block;
    currentKey = null;
    block = null;
  };

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && block !== null) {
      block.push(scalar(listItem[1]) as string);
      continue;
    }

    const kv = /^([A-Za-z0-9_][A-Za-z0-9_ -]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    flush();
    const [, key, rest] = kv;
    if (rest === "") {
      currentKey = key;
      block = [];
      data[key] = [];
      continue;
    }
    data[key] = parseValue(rest);
  }
  flush();
  return data;
}

function parseValue(rest: string): FrontmatterValue {
  const trimmed = rest.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitInline(inner).map((v) => String(scalar(v)));
  }
  return scalar(trimmed);
}

/** Split an inline array body on commas that are not inside quotes or brackets. */
function splitInline(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buf = "";
  for (const ch of inner) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function scalar(value: string): FrontmatterValue {
  let v = value.trim();
  const comment = /\s+#\s/.exec(v);
  if (comment && !v.startsWith('"') && !v.startsWith("'")) v = v.slice(0, comment.index).trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~" || v === "") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

export function asString(value: FrontmatterValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function asList(value: FrontmatterValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  const s = String(value).trim();
  return s ? [s] : [];
}
