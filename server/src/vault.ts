import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { config, ToolError } from "./config.ts";
import { asList, asString, parseNote, type Frontmatter } from "./frontmatter.ts";

const SKIP_DIRS = new Set([".git", ".obsidian", ".trash", "node_modules", ".DS_Store"]);
/** Filenames that must never be created or resolved to — they break wikilinks. */
export const GENERIC_NAMES = new Set([
  "overview",
  "index",
  "notes",
  "note",
  "readme",
  "untitled",
  "new note",
  "misc",
  "temp",
  "doc",
]);

export interface Note {
  /** Vault-relative path with forward slashes, e.g. `Projects/Wayfinder/Wayfinder.md`. */
  path: string;
  /** Filename without extension — the wikilink target. */
  title: string;
  /** Top-level folder, e.g. `Projects`. Empty string for vault-root notes. */
  folder: string;
  type?: string;
  status?: string;
  aliases: string[];
  frontmatter: Frontmatter;
  mtimeMs: number;
  size: number;
}

interface Index {
  notes: Note[];
  byPath: Map<string, Note>;
  byTitle: Map<string, Note[]>;
  builtAt: number;
}

let index: Index | null = null;
const CACHE_MS = 3000;

export function invalidateIndex(): void {
  index = null;
}

export function getIndex(): Index {
  if (index && Date.now() - index.builtAt < CACHE_MS) return index;
  index = buildIndex();
  return index;
}

function buildIndex(): Index {
  const root = config().vaultRoot;
  const notes: Note[] = [];
  walk(root, root, notes);
  notes.sort((a, b) => a.path.localeCompare(b.path));

  const byPath = new Map<string, Note>();
  const byTitle = new Map<string, Note[]>();
  for (const note of notes) {
    byPath.set(note.path.toLowerCase(), note);
    for (const key of [note.title, ...note.aliases]) {
      const k = key.toLowerCase();
      const list = byTitle.get(k);
      if (list) list.push(note);
      else byTitle.set(k, [note]);
    }
  }
  return { notes, byPath, byTitle, builtAt: Date.now() };
}

function walk(root: string, dir: string, out: Note[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, out);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    out.push(describe(root, full));
  }
}

function describe(root: string, full: string): Note {
  const stat = statSync(full);
  const parsed = parseNote(readFileSync(full, "utf8"));
  const relPath = relative(root, full).split(sep).join("/");
  return {
    path: relPath,
    title: basename(relPath, ".md"),
    folder: relPath.includes("/") ? relPath.slice(0, relPath.indexOf("/")) : "",
    type: asString(parsed.data.type),
    status: asString(parsed.data.status),
    aliases: asList(parsed.data.aliases ?? parsed.data.alias),
    frontmatter: parsed.data,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

/**
 * Resolve a note reference the way a wikilink does. Accepts a bare target
 * (`Wayfinder`), a wikilink (`[[Wayfinder]]`), or a vault-relative path with or
 * without the `.md` extension. Never accepts an absolute filesystem path.
 */
export function resolveNote(ref: string): Note {
  const cleaned = stripWikilink(ref);
  if (!cleaned) throw new ToolError("note reference is empty.");
  const found = findNote(cleaned);
  if (found) return found;

  const near = nearestTitles(cleaned);
  const hint = near.length
    ? ` Closest existing notes: ${near.join(", ")}.`
    : ` Use vault_search or vault_list to find the right note title.`;
  throw new ToolError(`note "${cleaned}" not found in the vault.${hint}`);
}

/** Titles closest to a miss — substring hits first, then near-misspellings. */
export function nearestTitles(ref: string, limit = 5): string[] {
  const needle = stripWikilink(ref).replace(/\.md$/i, "").toLowerCase();
  if (!needle) return [];
  const scored: { title: string; score: number }[] = [];
  for (const note of getIndex().notes) {
    const title = note.title.toLowerCase();
    if (title.includes(needle) || needle.includes(title)) {
      scored.push({ title: note.title, score: 0 });
      continue;
    }
    const distance = editDistance(needle, title);
    if (distance <= Math.max(2, Math.floor(Math.max(needle.length, title.length) * 0.3))) {
      scored.push({ title: note.title, score: distance });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.title);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 12) return Number.MAX_SAFE_INTEGER;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** Like resolveNote but returns null instead of throwing. */
export function findNote(ref: string): Note | null {
  const cleaned = stripWikilink(ref);
  if (!cleaned) return null;
  const idx = getIndex();

  const asPath = cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
  const byPath = idx.byPath.get(asPath.toLowerCase());
  if (byPath) return byPath;

  const titleKey = cleaned.replace(/\.md$/i, "").toLowerCase();
  const byTitle = idx.byTitle.get(titleKey);
  if (byTitle && byTitle.length === 1) return byTitle[0];
  if (byTitle && byTitle.length > 1) {
    // Prefer the canonical `Folder/Name/Name.md` shape over stray duplicates.
    const canonical = byTitle.find((n) => basename(dirname(n.path)) === n.title);
    if (canonical) return canonical;
    throw new ToolError(
      `note "${cleaned}" is ambiguous — ${byTitle.length} notes share that name: ${byTitle
        .map((n) => n.path)
        .join(", ")}. Pass the full vault-relative path instead.`,
    );
  }
  return null;
}

export function stripWikilink(ref: string): string {
  let value = ref.trim();
  const link = /^\[\[([^\]]+)\]\]$/.exec(value);
  if (link) value = link[1];
  // `Target|display` and `Target#section` both resolve on the target.
  value = value.split("|")[0].split("#")[0].trim();
  return value;
}

export function absolutePath(note: Note | string): string {
  const relPath = typeof note === "string" ? note : note.path;
  const root = config().vaultRoot;
  const full = resolve(root, relPath);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new ToolError(`path "${relPath}" escapes the vault root.`);
  }
  return full;
}

export function readNote(note: Note | string): { content: string; mtimeMs: number; path: string } {
  const full = absolutePath(note);
  try {
    const content = readFileSync(full, "utf8");
    return { content, mtimeMs: statSync(full).mtimeMs, path: full };
  } catch {
    throw new ToolError(`could not read "${typeof note === "string" ? note : note.path}".`);
  }
}

/**
 * Write a note back only if it has not changed since it was read. Obsidian may
 * be editing the same file; a mismatch is a retryable condition, not a reason
 * to clobber the user's edit.
 */
export function writeNoteGuarded(
  relPath: string,
  expectedMtimeMs: number,
  content: string,
): void {
  const full = absolutePath(relPath);
  const current = statSync(full).mtimeMs;
  if (Math.abs(current - expectedMtimeMs) > 1) {
    throw new ToolError(
      `"${relPath}" changed on disk while this edit was being prepared (likely the Obsidian app). Nothing was written — call the same tool again.`,
    );
  }
  writeFileSync(full, content, "utf8");
  invalidateIndex();
}

/** Read → transform → guarded write, in one call. */
export function editNote(ref: string, transform: (content: string, note: Note) => string): Note {
  const note = resolveNote(ref);
  const { content, mtimeMs } = readNote(note);
  const next = transform(content, note);
  if (next !== content) writeNoteGuarded(note.path, mtimeMs, next);
  return note;
}
