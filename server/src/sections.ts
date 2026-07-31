import { ToolError } from "./config.ts";

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

/** All headings in a note, ignoring anything inside a fenced code block. */
export function listSections(content: string): Section[] {
  const lines = content.split("\n");
  const headings: { name: string; level: number; line: number }[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (heading) headings.push({ name: heading[2], level: heading[1].length, line: i });
  }

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

export function findSection(content: string, name: string): Section | null {
  const target = normalizeHeading(name).toLowerCase();
  const sections = listSections(content);
  return sections.find((s) => s.name.toLowerCase() === target) ?? null;
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

/** Last non-blank line index within a section, or -1 when the section is empty. */
function lastContentLine(lines: string[], section: Section): number {
  for (let i = section.end - 1; i >= section.start; i--) {
    if (lines[i].trim() !== "") return i;
  }
  return -1;
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
  options: { dedupe?: boolean; notePath?: string } = {},
): AppendResult {
  const { dedupe = true, notePath = "note" } = options;
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

  const last = lastContentLine(lines, section);
  const insertAt = last === -1 ? section.start : last + 1;
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);

  // Keep exactly one blank line between the heading and content when the
  // section was empty, and none between consecutive list/table lines.
  const block: string[] = [];
  if (last === -1 && before[before.length - 1]?.trim() !== "") block.push("");
  block.push(insertion);

  return {
    content: [...before, ...block, ...after].join("\n"),
    changed: true,
    asTableRow: Boolean(table),
  };
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
