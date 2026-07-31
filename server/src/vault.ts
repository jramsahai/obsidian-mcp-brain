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

/**
 * Lookup key for a title or path. macOS filesystems are normalization-
 * insensitive but `readdirSync` returns whatever byte form is on disk, so a
 * note stored NFD (a Finder rename, an unzip, an iCloud sync) was invisible to
 * the NFC lookup that Obsidian and the model both emit — while `existsSync`
 * still found it, so note_create refused to create it either. The raw on-disk
 * path is kept on the Note for filesystem calls; only the key is normalized.
 */
function lookupKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

export function invalidateIndex(): void {
  index = null;
}

/**
 * Vault-relative paths this server has written since the last snapshot. A
 * scoped `git add` needs to know what the machine touched, so that a commit
 * labelled as the machine's pass contains only the machine's changes.
 */
const written = new Set<string>();

export function recordWrite(relPath: string): void {
  written.add(relPath);
}

export function writtenPaths(): string[] {
  return [...written];
}

export function clearWrittenPaths(): void {
  written.clear();
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
    byPath.set(lookupKey(note.path), note);
    for (const key of [note.title, ...note.aliases]) {
      const k = lookupKey(key);
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
  const needle = lookupKey(stripWikilink(ref).replace(/\.md$/i, ""));
  if (!needle) return [];
  const scored: { title: string; score: number }[] = [];
  for (const note of getIndex().notes) {
    const title = lookupKey(note.title);
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
  const byPath = idx.byPath.get(lookupKey(asPath));
  if (byPath) return byPath;

  const titleKey = lookupKey(cleaned.replace(/\.md$/i, ""));
  const byTitle = idx.byTitle.get(titleKey);
  if (byTitle && byTitle.length === 1) return byTitle[0];
  if (byTitle && byTitle.length > 1) {
    const preferred = preferAmong(titleKey, byTitle);
    if (preferred) return preferred;
    throw new ToolError(
      `note "${cleaned}" is ambiguous — ${byTitle.length} notes share that name: ${byTitle
        .map((n) => n.path)
        .join(", ")}. Pass the full vault-relative path instead.`,
    );
  }
  return null;
}

const DATE_TITLE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Break a title tie using the vault's own stated conventions, rather than
 * failing on collisions the layout makes inevitable. Anything not covered here
 * still errors, because there is no convention to appeal to.
 */
function preferAmong(titleKey: string, matches: Note[]): Note | null {
  // `[[YYYY-MM-DD]]` means the daily note — second-brain states this outright,
  // and a synthesis that lands on a day with a journal entry would otherwise
  // make the reference ambiguous forever after.
  if (DATE_TITLE_RE.test(titleKey)) {
    const daily = matches.find((n) => n.folder === "Daily");
    if (daily) return daily;
  }
  // The canonical `Folder/Name/Name.md` project shape.
  const canonical = matches.find((n) => basename(dirname(n.path)) === n.title);
  if (canonical) return canonical;
  // A bare name means the top-level note when exactly one lives at the root:
  // `[[Inbox]]` is the vault inbox, not `Knowledge Base/Inbox.md`.
  const root = matches.filter((n) => n.folder === "");
  if (root.length === 1) return root[0];
  return null;
}

/**
 * Templates are declared in frontmatter, not inferred from the filename.
 * Matching a `Template.md` suffix quietly swallowed `Knowledge Base/Procurement/Vendor
 * Query Template.md` — an ordinary knowledge note — excluding it from
 * the link graph and from linkify's entity list with no way to notice.
 */
export function isTemplate(note: Note): boolean {
  return note.frontmatter?.template === true;
}

/** How many notes answer to this title or alias. */
export function titleMatchCount(title: string): number {
  return getIndex().byTitle.get(lookupKey(title))?.length ?? 0;
}

/**
 * The link body to write for a note: the bare title normally, or the
 * disambiguating `Folder/Name|Title` form when the title is shared. Writing a
 * bare `[[Overlap]]` when two notes are called Overlap produces a link this
 * server's own resolver then refuses as ambiguous, and which Obsidian resolves
 * by proximity — so it can silently point at the wrong note.
 */
export function wikilinkTarget(note: Note): string {
  if (titleMatchCount(note.title) <= 1) return note.title;
  return `${note.path.replace(/\.md$/i, "")}|${note.title}`;
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
    // Stat *before* reading. The other order pairs stale content with a fresh
    // mtime when a write lands between the two calls, so writeNoteGuarded's
    // comparison passes and the user's edit is silently overwritten. This way
    // the same race produces a mismatch, which errors and is retryable.
    const mtimeMs = statSync(full).mtimeMs;
    const content = readFileSync(full, "utf8");
    return { content, mtimeMs, path: full };
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
  recordWrite(relPath);
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
