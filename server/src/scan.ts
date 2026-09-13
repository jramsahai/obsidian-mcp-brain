/**
 * One markdown scanner, shared by everything that has to know where it is
 * allowed to look. Before this existed the fence state machine was written
 * twice (section listing, link extraction) and linkify would have made three —
 * three chances for the same off-by-one to disagree with itself.
 */

import { isDate } from "./config.ts";
import { frontmatterEndLine } from "./frontmatter.ts";

export interface Line {
  text: string;
  /** 0-based line index within the file. */
  index: number;
  /** Inside the opening/closing `---` fences of YAML frontmatter, or on them. */
  inFrontmatter: boolean;
  /** Inside a fenced code block, or on its ``` / ~~~ delimiter. */
  inFence: boolean;
  heading: { level: number; name: string } | null;
}

const FENCE_RE = /^\s*(```+|~~~+)/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;

/** Classify every line of a note once. */
export function scanLines(content: string): Line[] {
  const lines = content.split("\n");
  const frontmatterEnd = frontmatterEndLine(lines);
  let fence: string | null = null;
  const out: Line[] = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (i <= frontmatterEnd) {
      out.push({ text, index: i, inFrontmatter: true, inFence: false, heading: null });
      continue;
    }
    const fenceMatch = FENCE_RE.exec(text);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      out.push({ text, index: i, inFrontmatter: false, inFence: true, heading: null });
      continue;
    }
    if (fence !== null) {
      out.push({ text, index: i, inFrontmatter: false, inFence: true, heading: null });
      continue;
    }
    const heading = HEADING_RE.exec(text);
    out.push({
      text,
      index: i,
      inFrontmatter: false,
      inFence: false,
      heading: heading ? { level: heading[1].length, name: heading[2] } : null,
    });
  }
  return out;
}

export interface Range {
  start: number;
  /** Exclusive. */
  end: number;
}

const PROTECTED_PATTERNS = [
  /`[^`\n]*`/g, // inline code
  /\[\[[^\][\n]*\]\]/g, // existing wikilinks
  /\[[^\][\n]*\]\([^)\n]*\)/g, // markdown links and images
  /(?:https?:\/\/|www\.)[^\s)\]]+/g, // bare URLs
  // Obsidian inline tags. `#` is not a word character, so without this a tag
  // body reads as a bare mention and linkify brackets it in place — turning
  // `#Wayfinder` into `#[[Wayfinder]]`, which is no longer a tag at all.
  /(?:^|\s)#[\w/-]+/g,
] as const;

/**
 * Character ranges within a single line that machine edits must not touch:
 * inline code, existing links of either syntax, and bare URLs. Headings,
 * fences, and frontmatter are whole-line exclusions and come from `scanLines`.
 */
export function protectedRanges(line: string): Range[] {
  const ranges: Range[] = [];
  for (const pattern of PROTECTED_PATTERNS) {
    for (const match of line.matchAll(pattern)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return merge(ranges);
}

function merge(ranges: Range[]): Range[] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [sorted[0]];
  for (const range of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push(range);
  }
  return out;
}

export function overlapsProtected(ranges: Range[], start: number, end: number): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

/**
 * Word-boundary test that treats anything other than a letter, digit, or
 * underscore as a boundary. `\b` is not usable here: entity names contain
 * spaces and apostrophes, so the boundary has to be checked at the ends of the
 * whole match rather than inside a regex.
 */
export function isWordBoundary(line: string, start: number, end: number): boolean {
  const before = start > 0 ? line[start - 1] : "";
  const after = end < line.length ? line[end] : "";
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(ch: string): boolean {
  return ch !== "" && /[\p{L}\p{N}_]/u.test(ch);
}

const DATE_TEXT_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The latest dated entry actually written into a note's body: a
 * `### YYYY-MM-DD` log heading (`obsidian__log_append`) or a table row whose
 * first cell is a date (`obsidian__section_append` into a Date-first table).
 * Frontmatter (`created`, `date`, `started`) is excluded on purpose — those
 * describe when a note was made or what day it covers, not when someone last
 * added to it, and a consolidation pass touches a file's mtime without adding
 * real content. This is the field `vault_list`'s `stale_days` filter trusts
 * instead of mtime.
 *
 * Computed once per index build rather than per call: every note's content is
 * already read into memory to parse frontmatter, so this is one more linear
 * scan of text already in hand, and the index itself is rebuilt at most once
 * per `CACHE_MS` regardless of how many callers ask — cheaper than re-reading
 * the file on every `vault_list` call, and no more expensive than the
 * frontmatter parse it rides alongside.
 */
export function lastEntryDate(content: string): string | null {
  let latest: string | null = null;
  for (const line of scanLines(content)) {
    if (line.inFrontmatter || line.inFence) continue;
    let candidate: string | null = null;
    if (line.heading && DATE_TEXT_RE.test(line.heading.name.trim())) {
      candidate = line.heading.name.trim();
    } else if (!line.heading) {
      const trimmed = line.text.trim();
      if (trimmed.startsWith("|")) {
        const firstCell = trimmed.slice(1).split("|")[0]?.trim() ?? "";
        if (DATE_TEXT_RE.test(firstCell)) candidate = firstCell;
      }
    }
    if (candidate && isDate(candidate) && (!latest || candidate > latest)) latest = candidate;
  }
  return latest;
}
