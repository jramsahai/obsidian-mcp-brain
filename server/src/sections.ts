import { ToolError } from "./config.ts";
import { scanLines } from "./scan.ts";

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
  options: { dedupe?: boolean; notePath?: string; keepNewest?: number } = {},
): AppendResult {
  const { dedupe = true, notePath = "note", keepNewest } = options;
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
    const existing = lines.slice(section.start, section.end).map(compare);
    if (existing.includes(compare(insertion))) {
      return {
        content,
        changed: false,
        reason: `already present in "${normalizeHeading(sectionName)}" — nothing appended`,
        asTableRow: Boolean(table),
      };
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

function compare(line: string): string {
  return line.trim().replace(/\s+/g, " ").toLowerCase();
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
