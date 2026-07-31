import { findNote, getIndex, readNote, stripWikilink, type Note } from "./vault.ts";

const WIKILINK_RE = /\[\[([^\][\n]+)\]\]/g;

/**
 * Extract wikilink targets from note content. Links inside fenced or inline
 * code are ignored; links inside frontmatter are kept, because frontmatter
 * wikilinks are real graph edges in Obsidian.
 */
export function extractLinks(content: string): string[] {
  const targets: string[] = [];
  let fence: string | null = null;
  for (const line of content.split("\n")) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const stripped = line.replace(/`[^`]*`/g, " ");
    for (const match of stripped.matchAll(WIKILINK_RE)) {
      const target = stripWikilink(match[1]);
      if (target) targets.push(target);
    }
  }
  return targets;
}

export interface Graph {
  /** note path → outgoing link targets (raw, de-duplicated). */
  out: Map<string, string[]>;
  /** note path → paths of notes linking to it. */
  incoming: Map<string, string[]>;
  /** target text → paths of notes linking to it, for targets with no note. */
  unresolved: Map<string, string[]>;
}

export function buildGraph(): Graph {
  const idx = getIndex();
  const out = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();
  for (const note of idx.notes) incoming.set(note.path, []);

  for (const note of idx.notes) {
    const { content } = readNote(note);
    const targets = [...new Set(extractLinks(content))];
    out.set(note.path, targets);
    for (const target of targets) {
      let resolved: Note | null = null;
      try {
        resolved = findNote(target);
      } catch {
        resolved = null; // ambiguous target — treat as unresolved for graph purposes
      }
      if (resolved && resolved.path !== note.path) {
        incoming.get(resolved.path)?.push(note.path);
      } else if (!resolved) {
        const list = unresolved.get(target);
        if (list) list.push(note.path);
        else unresolved.set(target, [note.path]);
      }
    }
  }
  return { out, incoming, unresolved };
}

export interface SearchHit {
  path: string;
  title: string;
  type?: string;
  matches: { line: number; text: string }[];
}

export function searchVault(
  query: string,
  options: { type?: string; folder?: string; limit?: number } = {},
): SearchHit[] {
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
    const titleHit =
      note.title.toLowerCase().includes(needle) ||
      note.aliases.some((a) => a.toLowerCase().includes(needle));
    content.split("\n").forEach((line, i) => {
      if (matches.length < 5 && line.toLowerCase().includes(needle)) {
        matches.push({ line: i + 1, text: line.trim().slice(0, 240) });
      }
    });
    if (matches.length || titleHit) {
      hits.push({ path: note.path, title: note.title, type: note.type, matches });
    }
    if (hits.length >= limit) break;
  }
  return hits;
}
