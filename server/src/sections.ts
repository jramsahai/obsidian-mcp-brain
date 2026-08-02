import { isDate, ToolError } from "./config.ts";
import { scanLines } from "./scan.ts";
import { excerpt, findSimilar } from "./similar.ts";

export interface Section {
  /** Heading text without the leading `#`s, e.g. `Conversation History`. */
  name: string;
  level: number;
  /** Index of the heading line itself. */
  headingLine: number;
  /** First line of section content (heading + 1). */
  start: number;
  /** Exclusive end — the next heading of the same or higher level, or EOF. */
  end: number;
}

/** All headings in a note, ignoring fenced code blocks and frontmatter. */
export function listSections(content: string): Section[] {
  const lines = content.split("\n");
  const headings = scanLines(content)
    .filter((l) => l.heading !== null)
    .map((l) => ({ name: l.heading!.name, level: l.heading!.level, line: l.index }));

  return headings.map((h, i) => {
    let end = lines.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        end = headings[j].line;
        break;
      }
    }
    return { name: h.name, level: h.level, headingLine: h.line, start: h.line + 1, end };
  });
}

export function normalizeHeading(name: string): string {
  return name.replace(/^#+\s*/, "").trim();
}

/**
 * Find a section by name. Level matters: a `### Notes` nested inside
 * `## Overview` used to win over the real `## Notes` simply by appearing first,
 * so an append landed under the wrong heading and still reported success. An
 * explicit `## Name` in the request picks that level; otherwise the shallowest
 * match wins, and ties go to document order.
 */
export function findSection(content: string, name: string): Section | null {
  const explicitLevel = /^(#+)\s/.exec(name.trim())?.[1].length;
  const target = normalizeHeading(name).toLowerCase();
  const matches = listSections(content).filter((s) => s.name.toLowerCase() === target);
  if (matches.length === 0) return null;
  if (explicitLevel) {
    const exact = matches.find((s) => s.level === explicitLevel);
    if (exact) return exact;
  }
  return matches.reduce((best, s) => (s.level < best.level ? s : best));
}

export function requireSection(content: string, name: string, notePath: string): Section {
  const section = findSection(content, name);
  if (section) return section;
  const present = listSections(content)
    .map((s) => s.name)
    .join(", ");
  throw new ToolError(
    `section "${normalizeHeading(name)}" not found in ${notePath}; sections present: ${
      present || "(none)"
    }.`,
  );
}

export interface TableShape {
  /** Column headers in order. */
  columns: string[];
  /** Line index of the header row. */
  headerLine: number;
}

/** Detect a markdown table inside a section, if the section is table-shaped. */
export function detectTable(content: string, section: Section): TableShape | null {
  const lines = content.split("\n");
  for (let i = section.start; i < section.end - 1; i++) {
    const header = lines[i]?.trim();
    const divider = lines[i + 1]?.trim();
    if (
      header?.startsWith("|") &&
      divider?.startsWith("|") &&
      /^\|[\s:|-]+\|$/.test(divider)
    ) {
      return { columns: splitRow(header), headerLine: i };
    }
  }
  return null;
}

export function splitRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Last non-blank line index in `[start, end)`, or -1 when there is none. */
function lastContentLine(lines: string[], start: number, end: number): number {
  for (let i = end - 1; i >= start; i--) {
    if (lines[i].trim() !== "") return i;
  }
  return -1;
}

/**
 * Where a section's *own* content ends — at its first sub-heading, not at the
 * end of everything nested beneath it. `## Related` followed by `### See Also`
 * spans both, so appending at the end of the span put the new link inside the
 * sub-list rather than in the list the reader actually looks at.
 */
function ownContentEnd(content: string, section: Section): number {
  for (const s of listSections(content)) {
    if (s.headingLine > section.headingLine && s.headingLine < section.end) return s.headingLine;
  }
  return section.end;
}

/**
 * First line after the contiguous run of `|` rows that starts at the table
 * header. A row appended after trailing prose renders as literal pipe text
 * outside the table, which is invisible in the very table the section exists
 * to hold.
 */
function tableEnd(lines: string[], table: TableShape, limit: number): number {
  let i = table.headerLine;
  while (i < limit && lines[i]?.trim().startsWith("|")) i++;
  return i;
}

export interface AppendResult {
  content: string;
  changed: boolean;
  reason?: string;
  /** True when the appended text was formatted as a table row. */
  asTableRow: boolean;
}

/**
 * Append a line at the end of a named section — not the end of the file. When
 * the section holds a markdown table the text is appended as a table row, which
 * is the single most common way section appends get mangled by hand.
 */
export function appendToSection(
  content: string,
  sectionName: string,
  text: string,
  options: { dedupe?: boolean; notePath?: string; keepNewest?: number; allowSimilar?: boolean } = {},
): AppendResult {
  const { dedupe = true, notePath = "note", keepNewest, allowSimilar = false } = options;
  const section = requireSection(content, sectionName, notePath);
  const lines = content.split("\n");
  const table = detectTable(content, section);
  const payload = text.trim();
  if (!payload) throw new ToolError("content is empty; nothing to append.");

  let insertion: string;
  if (table) {
    insertion = toTableRow(payload, table, normalizeHeading(sectionName), notePath);
  } else {
    insertion = payload;
  }

  if (dedupe) {
    const body = lines.slice(section.start, section.end);
    if (body.map(compare).includes(compare(insertion))) {
      return {
        content,
        changed: false,
        reason: `already present in "${normalizeHeading(sectionName)}" — nothing appended`,
        asTableRow: Boolean(table),
      };
    }
    // Only tables. A table row has a shape — a key cell and a fixed number of
    // fields — and across the vault's 4007 co-located rows the near-duplicate
    // guard rejects none of them. Free bullets have no shape, and the same
    // guard over the vault's 44949 co-located bullets would reject 79 real
    // ones: repeated file paths, checklist items, research lines differing by a
    // percentage. Those are a section_append caller's normal output, so
    // guarding them would cost more writes than it saved.
    if (!allowSimilar && table) {
      assertNotSimilar(insertion, body, `"${normalizeHeading(sectionName)}"`, notePath);
    }
  }

  // Insert within the section's own content, not at the end of everything
  // nested under it — and for a table, directly after the last row.
  const bodyEnd = ownContentEnd(content, section);
  const last = lastContentLine(lines, section.start, bodyEnd);
  const insertAt = table ? tableEnd(lines, table, bodyEnd) : last === -1 ? section.start : last + 1;
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);

  // Keep exactly one blank line between the heading and content when the
  // section was empty, and none between consecutive list/table lines.
  const block: string[] = [];
  if (last === -1 && before[before.length - 1]?.trim() !== "") block.push("");
  block.push(insertion);

  const appended = [...before, ...block, ...after];
  return {
    content: keepNewest ? trimSection(appended, sectionName, keepNewest, table) : appended.join("\n"),
    changed: true,
    asTableRow: Boolean(table),
  };
}

/**
 * Keep only the newest `keep` entries in a section — a bounded log, appended
 * to and trimmed in one write. Without this the only way to cap a review log
 * was a whole-file edit outside the tool surface, on an unattended run.
 * Entries are dropped from the top, which is the oldest end for an append-only
 * log; a table's header and divider are never counted or dropped.
 */
function trimSection(
  lines: string[],
  sectionName: string,
  keep: number,
  table: TableShape | null,
): string {
  const content = lines.join("\n");
  const section = findSection(content, sectionName);
  if (!section) return content;
  const bodyEnd = ownContentEnd(content, section);
  const first = table ? table.headerLine + 2 : section.start;

  const entries: number[] = [];
  for (let i = first; i < bodyEnd; i++) {
    if (lines[i].trim() !== "") entries.push(i);
  }
  if (entries.length <= keep) return content;
  const drop = new Set(entries.slice(0, entries.length - keep));
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

/**
 * Strict on purpose. `### 2026-03-18: Comprehensive Research Initiative` and
 * `### 2026-03-18 Conversation with Devon` are headings a human wrote over real
 * content, not log blocks: reading them as blocks would append a same-day entry
 * into the middle of an essay, and keep_newest would delete it as "an old
 * entry". `### 2026-02-31` is rejected for the same reason assertDate exists.
 */
function dateHeading(name: string): string | null {
  const trimmed = name.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) && isDate(trimmed) ? trimmed : null;
}

/** One `### YYYY-MM-DD` block inside a dated log section. */
export interface DateBlock {
  date: string;
  /** Index of the `### <date>` heading line. */
  headingLine: number;
  /** Exclusive end — the next heading at that level or higher, clamped to the section. */
  end: number;
}

/** The `### YYYY-MM-DD` blocks directly inside a section, in document order. */
export function dateBlocks(content: string, section: Section): DateBlock[] {
  const out: DateBlock[] = [];
  for (const s of listSections(content)) {
    if (s.headingLine <= section.headingLine || s.headingLine >= section.end) continue;
    // Exactly one level down. A `#### 2026-01-01` nested inside a block is part
    // of that block's body, not a sibling block.
    if (s.level !== section.level + 1) continue;
    const date = dateHeading(s.name);
    if (date) out.push({ date, headingLine: s.headingLine, end: Math.min(s.end, section.end) });
  }
  return out;
}

/** True when a section is built from `### YYYY-MM-DD` blocks. */
export function isDatedLog(content: string, section: Section): boolean {
  return dateBlocks(content, section).length > 0;
}

/** What a section holds, which decides the tool that may write to it. */
export type SectionShape = "table" | "dated" | "flat";

/**
 * Classify a section by what it already holds. `dated` takes precedence: a
 * table nested inside one date block must not make the whole log look
 * table-shaped, which is why the table check is scoped to the section's own
 * content rather than everything under it.
 */
export function sectionShape(content: string, section: Section): SectionShape {
  if (isDatedLog(content, section)) return "dated";
  const own = { ...section, end: ownContentEnd(content, section) };
  return detectTable(content, own) ? "table" : "flat";
}

/**
 * A log entry is a flat bullet list — that is what every dated section in the
 * vault holds, without exception. Unbulleted prose renders as a paragraph glued
 * to the bullets above it, and a `###` smuggled through `content` would create a
 * second date heading that nothing here can order or dedupe against.
 */
function entryLines(text: string, sectionName: string, notePath: string): string[] {
  const raw = text.replace(/\r/g, "").split("\n").map((l) => l.trimEnd());
  while (raw.length && raw[0].trim() === "") raw.shift();
  while (raw.length && raw[raw.length - 1].trim() === "") raw.pop();
  if (raw.length === 0) throw new ToolError("content is empty; nothing to append.");
  return raw.map((line) => {
    if (/^#{1,6}\s/.test(line.trim())) {
      throw new ToolError(
        `content for "${sectionName}" in ${notePath} contains a heading ("${line.trim()}"); the date heading is written for you. Pass the entry text only.`,
      );
    }
    if (line.trim() === "") return "";
    if (/^\s/.test(line)) return line; // an indented continuation line
    if (/^([-*+]\s|\d+[.)]\s|>\s|\|)/.test(line)) return line; // already carries a marker
    return `- ${line}`;
  });
}

export interface DatedAppendResult {
  content: string;
  changed: boolean;
  reason?: string;
  /** True when a new `### <date>` heading was written. */
  blockCreated: boolean;
  /** `### <date>` blocks in the section after the write. */
  blocks: number;
  /** Blocks dropped by keepNewest. */
  dropped: number;
}

/**
 * Append an entry to a section built from `### YYYY-MM-DD` blocks. The date
 * heading is the server's to write: appendToSection on such a section finds an
 * empty own-content span, falls through to `section.start`, and prepends a bare
 * line directly under the `##` heading above every dated block — which is what
 * every hand-written "add today's entry" call did before this existed.
 */
export function appendDatedEntry(
  content: string,
  sectionName: string,
  date: string,
  text: string,
  options: { dedupe?: boolean; notePath?: string; keepNewest?: number; allowSimilar?: boolean } = {},
): DatedAppendResult {
  const { dedupe = true, notePath = "note", keepNewest, allowSimilar = false } = options;
  const section = requireSection(content, sectionName, notePath);
  const name = normalizeHeading(sectionName);

  // A table and a dated log are different section shapes, and the wrong one
  // writes literal pipe text under a date heading. Look only at the section's
  // own body: a table inside one date block must not make the log table-shaped.
  const table = detectTable(content, { ...section, end: ownContentEnd(content, section) });
  if (table) {
    throw new ToolError(
      `section "${name}" in ${notePath} is a table (${table.columns.join(
        " | ",
      )}), not a dated log. Use section_append with a pipe-delimited row.`,
    );
  }

  const entry = entryLines(text, name, notePath);
  const lines = content.split("\n");
  const blocks = dateBlocks(content, section);
  const existing = blocks.find((b) => b.date === date);

  if (existing) {
    const bodyStart = existing.headingLine + 1;
    const body = lines.slice(bodyStart, existing.end);
    const seen = new Set(body.map(compare));
    const fresh = dedupe ? entry.filter((l) => l.trim() === "" || !seen.has(compare(l))) : entry;
    if (dedupe && !allowSimilar) {
      for (const line of fresh) {
        if (line.trim()) assertNotSimilar(line, body, `"### ${date}" in "${name}"`, notePath);
      }
    }
    if (!fresh.some((l) => l.trim() !== "")) {
      return {
        content,
        changed: false,
        reason: `already present under "### ${date}" in "${name}" — nothing appended`,
        blockCreated: false,
        blocks: blocks.length,
        dropped: 0,
      };
    }
    const last = lastContentLine(lines, bodyStart, existing.end);
    const insertAt = last === -1 ? bodyStart : last + 1;
    // One blank line after a bare `### <date>`, none between consecutive
    // bullets. A block's own style is left alone — several notes write their
    // bullets flush under the heading and should stay that way.
    const block = last === -1 && lines[insertAt - 1]?.trim() !== "" ? ["", ...fresh] : fresh;
    return settle(
      [...lines.slice(0, insertAt), ...block, ...lines.slice(insertAt)],
      sectionName,
      keepNewest,
      false,
    );
  }

  // Newest first — and a back-dated entry lands where its date belongs rather
  // than on top of newer ones. Always-on-top writes 2026-05-01 above 2026-07-07
  // and the log stops reading in order.
  const anchor =
    blocks.find((b) => b.date < date)?.headingLine ??
    (blocks.length ? blocks[blocks.length - 1].end : ownContentEnd(content, section));

  const before = lines.slice(0, anchor);
  while (before.length && before[before.length - 1].trim() === "") before.pop();
  const rest = lines.slice(anchor);
  const next = [...before, "", `${"#".repeat(section.level + 1)} ${date}`, "", ...entry];
  if (rest.some((l) => l.trim() !== "")) {
    let i = 0;
    while (i < rest.length && rest[i].trim() === "") i++;
    next.push("", ...rest.slice(i));
  }
  return settle(next, sectionName, keepNewest, true);
}

export interface RemoveResult {
  content: string;
  /** The entry lines removed, in document order. */
  removed: string[];
}

/**
 * Remove entries from one `### YYYY-MM-DD` block by substring match.
 *
 * The only deletion in the tool surface, and it exists because its absence was
 * itself a hazard: an append-only server has no way to undo an append, so the
 * 2026-08-02 cleanup of duplicate entries was done with openclaw's native `edit`
 * tool writing straight into the vault — outside every guard here, and outside
 * the one-reviewable-commit discipline. Scoped to a single dated block, matching
 * on a caller-supplied substring, so it can never become a general file edit.
 */
export function removeDatedEntries(
  content: string,
  sectionName: string,
  date: string,
  match: string,
  options: { notePath?: string } = {},
): RemoveResult {
  const { notePath = "note" } = options;
  const needle = match.trim();
  if (!needle) throw new ToolError("match is empty; nothing would be removed.");
  const section = requireSection(content, sectionName, notePath);
  const name = normalizeHeading(sectionName);
  const block = dateBlocks(content, section).find((b) => b.date === date);
  if (!block) {
    throw new ToolError(
      `no "### ${date}" block in "${name}" of ${notePath}. Dates present: ${
        dateBlocks(content, section)
          .map((b) => b.date)
          .join(", ") || "none"
      }.`,
    );
  }

  const lines = content.split("\n");
  const needleCmp = compare(needle);
  const drop = new Set<number>();
  for (let i = block.headingLine + 1; i < block.end; i++) {
    if (lines[i].trim() && compare(lines[i]).includes(needleCmp)) drop.add(i);
  }
  if (!drop.size) {
    throw new ToolError(
      `no entry under "### ${date}" in "${name}" of ${notePath} contains "${excerpt(needle)}". Nothing was removed.`,
    );
  }

  const removed = [...drop].sort((a, b) => a - b).map((i) => lines[i].trim());
  let out = lines.filter((_, i) => !drop.has(i));

  // A block emptied of every entry is a bare date heading claiming a day that
  // now has no history — drop the heading with it.
  const after = out.join("\n");
  const stillThere = findSection(after, sectionName);
  const emptied =
    stillThere &&
    dateBlocks(after, stillThere)
      .filter((b) => b.date === date)
      .find((b) => !out.slice(b.headingLine + 1, b.end).some((l) => l.trim()));
  if (emptied) out = out.filter((_, i) => i < emptied.headingLine || i >= emptied.end);

  while (out.length > 1 && out[out.length - 1] === "" && out[out.length - 2].trim() === "") out.pop();
  if (out[out.length - 1] !== "") out.push("");
  return { content: out.join("\n"), removed };
}

function settle(
  lines: string[],
  sectionName: string,
  keepNewest: number | undefined,
  blockCreated: boolean,
): DatedAppendResult {
  let out = [...lines];
  let dropped = 0;
  if (keepNewest) ({ lines: out, dropped } = trimDatedLog(out, sectionName, keepNewest));
  // Exactly one trailing newline, whether or not the file had one and wherever
  // the block landed. The 2026-08-01 CLI fallback left one of these notes with
  // none, and a dropped trailing block takes the final newline with it.
  while (out.length > 1 && out[out.length - 1] === "" && out[out.length - 2].trim() === "") out.pop();
  if (out[out.length - 1] !== "") out.push("");
  const content = out.join("\n");
  const section = findSection(content, sectionName);
  return {
    content,
    changed: true,
    blockCreated,
    blocks: section ? dateBlocks(content, section).length : 0,
    dropped,
  };
}

/**
 * Cap a dated log at its `keep` newest `### <date>` blocks. Blocks are ranked by
 * date, not by position: the vault's logs are a mix of descending, ascending,
 * and scrambled, so dropping from the top would delete the newest entries in a
 * third of them. A whole block goes at once — heading, body, and the blank line
 * that separated it from the next heading.
 */
function trimDatedLog(
  lines: string[],
  sectionName: string,
  keep: number,
): { lines: string[]; dropped: number } {
  const content = lines.join("\n");
  const section = findSection(content, sectionName);
  if (!section) return { lines, dropped: 0 };
  const blocks = dateBlocks(content, section);
  if (blocks.length <= keep) return { lines, dropped: 0 };
  const ranked = [...blocks].sort((a, b) =>
    a.date === b.date ? a.headingLine - b.headingLine : b.date.localeCompare(a.date),
  );
  const drop = new Set<number>();
  for (const block of ranked.slice(keep)) {
    for (let i = block.headingLine; i < block.end; i++) drop.add(i);
  }
  return { lines: lines.filter((_, i) => !drop.has(i)), dropped: ranked.length - keep };
}

function compare(line: string): string {
  return line.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * An error, not a silent skip. A silent skip would report `appended: false` and
 * let a model that has lost track of its own turn keep going; the 2026-08-02
 * turn re-read the note, saw its own entry, and appended a third wording anyway.
 * Naming the entry it collides with is what stops that loop, and `allow_similar`
 * exists so a genuinely close entry is still one argument away.
 */
function assertNotSimilar(line: string, body: readonly string[], where: string, notePath: string) {
  const match = findSimilar(line, body);
  if (!match) return;
  throw new ToolError(
    `entry is too similar (${match.score.toFixed(2)}) to one already in ${where} of ${notePath}: "${excerpt(
      match.text,
    )}". If you already logged this in an earlier step, it is recorded — do not write it again. Pass allow_similar=true only if this is genuinely a separate event.`,
  );
}

function toTableRow(
  payload: string,
  table: TableShape,
  sectionName: string,
  notePath: string,
): string {
  if (payload.startsWith("|")) {
    const cells = splitRow(payload);
    if (cells.length !== table.columns.length) {
      throw new ToolError(
        `section "${sectionName}" in ${notePath} is a table with ${table.columns.length} columns (${table.columns.join(
          " | ",
        )}); the row provided has ${cells.length}. Provide exactly ${table.columns.length} cells.`,
      );
    }
    return `| ${cells.join(" | ")} |`;
  }
  throw new ToolError(
    `section "${sectionName}" in ${notePath} is a table with columns: ${table.columns.join(
      " | ",
    )}. Pass content as a pipe-delimited row, e.g. "| ${table.columns
      .map(() => "…")
      .join(" | ")} |".`,
  );
}

/**
 * Insert a new `## Section` heading. Template order decides placement when the
 * note follows one; otherwise the section goes at the end of the file.
 */
export function insertSection(
  content: string,
  sectionName: string,
  templateOrder: string[] = [],
): string {
  const name = normalizeHeading(sectionName);
  if (findSection(content, name)) return content;
  const lines = content.split("\n");
  const sections = listSections(content).filter((s) => s.level === 2);
  const heading = `## ${name}`;

  const orderIndex = templateOrder.findIndex((t) => t.toLowerCase() === name.toLowerCase());
  if (orderIndex !== -1) {
    for (const section of sections) {
      const pos = templateOrder.findIndex((t) => t.toLowerCase() === section.name.toLowerCase());
      if (pos > orderIndex) {
        const before = lines.slice(0, section.headingLine);
        while (before.length && before[before.length - 1].trim() === "") before.pop();
        return [...before, "", heading, "", ...lines.slice(section.headingLine)].join("\n");
      }
    }
  }

  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return [...lines, "", heading, ""].join("\n");
}
