import { ToolError } from "./config.ts";
import { listSections, normalizeHeading, requireSection, type Section } from "./sections.ts";

const CHECKBOX_RE = /^(\s*)- \[( |x|X)\]\s+(.*)$/;

export interface ChecklistItem {
  line: number;
  raw: string;
  checked: boolean;
  /** Item text with any trailing ` — detail` removed. */
  text: string;
  detail?: string;
}

export function parseItem(raw: string, line: number): ChecklistItem | null {
  const match = CHECKBOX_RE.exec(raw);
  if (!match) return null;
  const rest = match[3];
  const split = /\s+—\s+/.exec(rest);
  return {
    line,
    raw,
    checked: match[2].toLowerCase() === "x",
    text: (split ? rest.slice(0, split.index) : rest).trim(),
    detail: split ? rest.slice(split.index + split[0].length).trim() : undefined,
  };
}

export function normalizeItem(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ChecklistEdit {
  content: string;
  action: "added" | "updated" | "unchanged";
  line: string;
}

/**
 * Add-or-merge, check off, never delete. A repeated capture of the same item
 * folds its new detail into the existing line instead of producing a second
 * one, which is what makes re-running a capture safe.
 */
export function setChecklistItem(
  content: string,
  options: { item: string; section?: string; detail?: string; checked?: boolean; notePath?: string },
): ChecklistEdit {
  const { item, detail, checked, notePath = "note" } = options;
  const text = item.trim();
  if (!text) throw new ToolError("item is empty; nothing to set.");

  const lines = content.split("\n");
  const bounds = itemBounds(content, options.section, notePath);

  const needle = normalizeItem(text);
  let found: ChecklistItem | null = null;
  for (let i = bounds.start; i < bounds.end; i++) {
    const parsed = parseItem(lines[i], i);
    if (parsed && normalizeItem(parsed.text) === needle) {
      // An open item is the one a repeat capture means; only fall back to a
      // checked one when there is no open match at all.
      if (!parsed.checked) {
        found = parsed;
        break;
      }
      found = found ?? parsed;
    }
  }

  if (found) {
    const nextChecked = checked ?? found.checked;
    const nextDetail = mergeDetail(found.detail, detail);
    const line = renderItem(indentOf(found.raw), nextChecked, found.text, nextDetail);
    if (line === found.raw) return { content, action: "unchanged", line };
    const next = [...lines];
    next[found.line] = line;
    return { content: next.join("\n"), action: "updated", line };
  }

  const line = renderItem("", checked ?? false, text, detail?.trim() || undefined);
  const insertAt = lastContentLine(lines, bounds) + 1;
  const next = [...lines];
  next.splice(insertAt, 0, line);
  return { content: next.join("\n"), action: "added", line };
}

interface Bounds {
  start: number;
  end: number;
}

/**
 * Where items live. A note with `##` sections must say which one — silently
 * appending to the bottom of a sectioned note is how content lands under the
 * wrong heading.
 */
function itemBounds(content: string, sectionName: string | undefined, notePath: string): Bounds {
  const lines = content.split("\n");
  if (sectionName) {
    const section: Section = requireSection(content, sectionName, notePath);
    return { start: section.start, end: section.end };
  }
  const sections = listSections(content).filter((s) => s.level === 2);
  if (sections.length > 0) {
    throw new ToolError(
      `${notePath} has sections, so section is required; sections present: ${sections
        .map((s) => s.name)
        .join(", ")}.`,
    );
  }
  const firstHeading = listSections(content)[0];
  return { start: firstHeading ? firstHeading.start : 0, end: lines.length };
}

function lastContentLine(lines: string[], bounds: Bounds): number {
  for (let i = bounds.end - 1; i >= bounds.start; i--) {
    if (lines[i].trim() !== "") return i;
  }
  return bounds.start - 1;
}

function indentOf(raw: string): string {
  return CHECKBOX_RE.exec(raw)?.[1] ?? "";
}

function renderItem(indent: string, checked: boolean, text: string, detail?: string): string {
  const box = checked ? "x" : " ";
  return `${indent}- [${box}] ${text}${detail ? ` — ${detail}` : ""}`;
}

function mergeDetail(existing: string | undefined, incoming: string | undefined): string | undefined {
  const next = incoming?.trim();
  if (!next) return existing;
  if (!existing) return next;
  if (normalizeItem(existing).includes(normalizeItem(next))) return existing;
  return `${existing}; ${next}`;
}
