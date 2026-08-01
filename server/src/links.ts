import { IGNORED_FILE, ignoredTargets } from "./ignored.ts";
import { scanLines } from "./scan.ts";
import { findSection } from "./sections.ts";
import { findNote, getIndex, isTemplate, readNote, stripWikilink, type Note } from "./vault.ts";

const WIKILINK_RE = /\[\[([^\][\n]+)\]\]/g;

/**
 * Extract wikilink targets from note content. Links inside fenced or inline
 * code are ignored; links inside frontmatter are kept, because frontmatter
 * wikilinks are real graph edges in Obsidian.
 *
 * `skipLines` drops links on specific lines. Used for the one place where a
 * link is a report about the graph rather than a part of it — see
 * `candidateLines`.
 */
export function extractLinks(content: string, options: { skipLines?: Set<number> } = {}): string[] {
  const { skipLines } = options;
  const targets: string[] = [];
  for (const line of scanLines(content)) {
    if (line.inFence) continue;
    if (skipLines?.has(line.index)) continue;
    const stripped = line.text.replace(/`[^`]*`/g, " ");
    for (const match of stripped.matchAll(WIKILINK_RE)) {
      const target = stripWikilink(match[1]);
      if (target) targets.push(target);
    }
  }
  return targets;
}

export const CANDIDATES_SECTION = "Candidates";

function isSynthesis(note: Note): boolean {
  return note.type === "synthesis" || note.path.startsWith("Syntheses/");
}

/**
 * Lines of a synthesis note's `## Candidates` section.
 *
 * A candidate is a note the user might want to create, and the nightly reports
 * it by writing `[[Name]]`. That is a real unresolved link, so every report
 * manufactured fresh evidence for itself: `Alex Rivera` reached six sources,
 * five of which were the nightly's own reports of it. The count could only ever
 * grow, and the skill's "stop after twice" rule re-surfaced the candidate in the
 * very line that announced it was being dropped.
 *
 * These links stay clickable in Obsidian. They just stop counting as demand.
 */
function candidateLines(note: Note, content: string): Set<number> | null {
  if (!isSynthesis(note)) return null;
  const section = findSection(content, CANDIDATES_SECTION);
  if (!section) return null;
  const lines = new Set<number>();
  for (let i = section.start; i < section.end; i++) lines.add(i);
  return lines;
}

export interface Graph {
  /** note path → outgoing link targets (raw, de-duplicated). */
  out: Map<string, string[]>;
  /** note path → paths of notes linking to it. */
  incoming: Map<string, string[]>;
  /** target text → paths of notes linking to it, for targets with no note. */
  unresolved: Map<string, string[]>;
  /** Unresolved targets withheld because the user retired them. Never hidden. */
  ignored: Map<string, string[]>;
}

export function buildGraph(): Graph {
  const idx = getIndex();
  const out = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();
  const ignored = new Map<string, string[]>();
  const retired = ignoredTargets();
  for (const note of idx.notes) incoming.set(note.path, []);

  for (const note of idx.notes) {
    const { content } = readNote(note);
    const targets = [...new Set(extractLinks(content))];
    out.set(note.path, targets);
    // Reported-not-demanded links: present in `out`, absent from `unresolved`.
    const skipLines = candidateLines(note, content);
    const demanded = skipLines ? new Set(extractLinks(content, { skipLines })) : null;
    for (const target of targets) {
      let resolved: Note | null = null;
      try {
        resolved = findNote(target);
      } catch {
        resolved = null; // ambiguous target — treat as unresolved for graph purposes
      }
      if (resolved && resolved.path !== note.path) {
        incoming.get(resolved.path)?.push(note.path);
      } else if (!resolved && !isTemplate(note)) {
        // A template's `[[First Last]]` and `[[Project Name]]` are placeholders,
        // not candidate notes. Counting them made every nightly report three
        // permanent phantoms the user could never resolve. Templates are
        // already excluded from orphans and deadends; this closes the gap.
        //
        // The ignore list is the same kind of note about the graph rather than
        // part of it: its rows name targets deliberately left uncreated.
        if (note.path === IGNORED_FILE) continue;
        if (demanded && !demanded.has(target)) continue;
        const bucket = retired.has(target.toLowerCase()) ? ignored : unresolved;
        const list = bucket.get(target);
        if (list) list.push(note.path);
        else bucket.set(target, [note.path]);
      }
    }
  }
  return { out, incoming, unresolved, ignored };
}

/**
 * How many synthesis notes have already surfaced each target as a candidate.
 *
 * This is the candidate memory the nightly used to reconstruct by hand, by
 * counting appearances across the last three synthesis notes — a rule it
 * demonstrably could not follow. The server counts instead, over the whole
 * history, and the skill reads a number.
 *
 * Matched as text, not as links, so it keeps working after candidates stop
 * being written as wikilinks: `[[Morgan Reyes]]` and `Morgan Reyes` both count.
 */
export function candidateHistory(targets: Iterable<string>): Map<string, number> {
  const wanted = [...targets];
  const counts = new Map<string, number>(wanted.map((t) => [t, 0]));
  for (const note of getIndex().notes) {
    if (!isSynthesis(note)) continue;
    const { content } = readNote(note);
    const section = findSection(content, CANDIDATES_SECTION);
    if (!section) continue;
    const body = content.split("\n").slice(section.start, section.end).join("\n").toLowerCase();
    for (const target of wanted) {
      if (body.includes(target.toLowerCase())) counts.set(target, counts.get(target)! + 1);
    }
  }
  return counts;
}

const MATCHES_PER_NOTE = 5;

export interface SearchHit {
  path: string;
  title: string;
  type?: string;
  matches: { line: number; text: string }[];
  /** Matching lines beyond the ones returned for this note. */
  more_matches?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Notes that matched in total, whether or not they were returned. */
  total: number;
  truncated: boolean;
}

/**
 * Always scans the whole vault, then truncates — never stops early. A search
 * that quietly stopped looking would report a total it had not actually
 * counted, and the caller would read partial evidence as complete. At ~120
 * notes the full scan costs milliseconds.
 */
export function searchVault(
  query: string,
  options: { type?: string; folder?: string; limit?: number } = {},
): SearchResult {
  const { type, folder, limit = 20 } = options;
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];

  for (const note of getIndex().notes) {
    if (type && note.type?.toLowerCase() !== type.toLowerCase()) continue;
    if (folder && !note.path.toLowerCase().startsWith(folder.toLowerCase().replace(/\/$/, "") + "/")) {
      continue;
    }
    const { content } = readNote(note);
    const matches: { line: number; text: string }[] = [];
    let extra = 0;
    const titleHit =
      note.title.toLowerCase().includes(needle) ||
      note.aliases.some((a) => a.toLowerCase().includes(needle));
    content.split("\n").forEach((line, i) => {
      if (!line.toLowerCase().includes(needle)) return;
      if (matches.length < MATCHES_PER_NOTE) matches.push({ line: i + 1, text: line.trim().slice(0, 240) });
      else extra++;
    });
    if (matches.length || titleHit) {
      const hit: SearchHit = { path: note.path, title: note.title, type: note.type, matches };
      if (extra > 0) hit.more_matches = extra;
      hits.push(hit);
    }
  }
  return { hits: hits.slice(0, limit), total: hits.length, truncated: hits.length > limit };
}
