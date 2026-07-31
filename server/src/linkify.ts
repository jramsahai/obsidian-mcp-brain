import { extractLinks } from "./links.ts";
import { isWordBoundary, overlapsProtected, protectedRanges, scanLines } from "./scan.ts";
import { getIndex, GENERIC_NAMES, readNote, type Note } from "./vault.ts";

/**
 * Mechanical entity linking. This tool is deliberately stupid: it converts a
 * literal plain-text mention of a note that already exists into a wikilink,
 * same words, brackets only. It is not allowed to decide that two things are
 * related — that judgment belongs to the model, via `relate`. Every guard here
 * exists to stop it from accidentally exercising judgment.
 */

/** Note types whose titles are worth linking when they appear in prose. */
const LINKABLE_TYPES = new Set(["project", "person", "knowledge", "moc", "idea"]);

/** Notes never edited by a linkify pass. */
function isProtectedNote(note: Note): boolean {
  return (
    note.path.endsWith("Template.md") ||
    // Tasks.md has a positional grammar: the first wikilink on a line is the
    // task's project. Inserting a person link ahead of it would silently
    // reassign every task it touched.
    note.path === "Tasks.md" ||
    // Standup.md is regenerated every morning, so any link added here is
    // overwritten within hours — pure nightly diff churn.
    note.path === "Standup.md"
  );
}

const MIN_ENTITY_LENGTH = 4;

/**
 * Single-word entity names that read as ordinary English. A person named
 * "Will" or a project named "Video" is the canonical false positive: the word
 * appears constantly in prose and almost never means the note.
 */
const COMMON_WORDS = new Set([
  "will", "video", "audio", "notes", "note", "home", "work", "team", "data", "call", "calls",
  "plan", "plans", "code", "test", "tests", "time", "week", "year", "days", "food", "media",
  "money", "price", "sales", "email", "phone", "house", "space", "board", "brand", "focus",
  "goal", "goals", "hope", "idea", "ideas", "list", "lists", "mail", "main", "make", "mark",
  "next", "page", "pages", "part", "post", "read", "room", "site", "type", "user", "users",
  "view", "well", "wind", "wood", "word", "words", "grace", "hope", "joy", "may", "june",
  "april", "march", "sunday", "monday", "friday", "summer", "winter", "spring", "autumn",
]);

export interface Entity {
  /** Literal text to look for. Matched case-sensitively. */
  phrase: string;
  /** Wikilink target — the note's real title. */
  title: string;
  path: string;
}

export function buildEntities(notes: Note[] = getIndex().notes): Entity[] {
  const entities: Entity[] = [];
  for (const note of notes) {
    if (!note.type || !LINKABLE_TYPES.has(note.type)) continue;
    if (note.path.endsWith("Template.md")) continue;
    for (const phrase of [note.title, ...note.aliases]) {
      if (eligible(phrase)) entities.push({ phrase, title: note.title, path: note.path });
    }
  }
  // Longest first, so "Example Project" wins over "Example" and the shorter
  // name is then inside a protected wikilink when its turn comes.
  return entities.sort((a, b) => b.phrase.length - a.phrase.length);
}

function eligible(phrase: string): boolean {
  const value = phrase.trim();
  if (value.length < MIN_ENTITY_LENGTH) return false;
  if (GENERIC_NAMES.has(value.toLowerCase())) return false;
  if (/^\d/.test(value)) return false; // date-named and numeric titles
  if (!/[A-Za-z]/.test(value)) return false;
  const multiWord = /\s/.test(value);
  if (!multiWord && COMMON_WORDS.has(value.toLowerCase())) return false;
  // A slug title like `role-proposal-draft` only ever appears in prose as a
  // filename. Such notes carry a human alias, and that alias is what should
  // get the brackets.
  if (!multiWord && /[-_]/.test(value) && value === value.toLowerCase()) return false;
  return true;
}

/** Extensions that make a match a filename reference rather than a mention. */
const FILE_EXTENSION_RE = /^\.(md|markdown|txt|png|jpe?g|gif|pdf|json|ya?ml|csv|html?|tsx?|jsx?|py|sh)\b/i;

export interface LinkifyChange {
  note: string;
  entity: string;
  matched: string;
  line: number;
  preview: string;
}

export interface LinkifyNoteResult {
  changes: LinkifyChange[];
  content: string;
}

/** Compute the linkification of one note without writing it. */
export function linkifyContent(content: string, notePath: string, entities: Entity[]): LinkifyNoteResult {
  const scanned = scanLines(content);
  const lines = scanned.map((l) => l.text);
  const linked = new Set(extractLinks(content).map((t) => t.toLowerCase()));
  const changes: LinkifyChange[] = [];

  for (const entity of entities) {
    if (entity.path === notePath) continue;
    // First mention per note: if the note already links the entity anywhere,
    // there is nothing left to do for it.
    if (linked.has(entity.title.toLowerCase())) continue;

    for (const line of scanned) {
      if (line.inFrontmatter || line.inFence || line.heading) continue;
      const text = lines[line.index];
      const at = findMention(text, entity.phrase);
      if (at === -1) continue;
      const replacement =
        entity.phrase === entity.title ? `[[${entity.title}]]` : `[[${entity.title}|${entity.phrase}]]`;
      const next = text.slice(0, at) + replacement + text.slice(at + entity.phrase.length);
      lines[line.index] = next;
      linked.add(entity.title.toLowerCase());
      changes.push({
        note: notePath,
        entity: entity.title,
        matched: entity.phrase,
        line: line.index + 1,
        preview: next.trim().slice(0, 200),
      });
      break;
    }
  }
  return { changes, content: lines.join("\n") };
}

/** First case-sensitive, word-bounded, unprotected occurrence of `phrase`. */
function findMention(text: string, phrase: string): number {
  if (!text.includes(phrase)) return -1;
  const ranges = protectedRanges(text);
  let from = 0;
  for (;;) {
    const at = text.indexOf(phrase, from);
    if (at === -1) return -1;
    const end = at + phrase.length;
    if (
      isWordBoundary(text, at, end) &&
      !overlapsProtected(ranges, at, end) &&
      !FILE_EXTENSION_RE.test(text.slice(end))
    ) {
      return at;
    }
    from = at + 1;
  }
}

export interface LinkifyPlan {
  notes: { path: string; mtimeMs: number; content: string; changes: LinkifyChange[] }[];
  scanned: number;
  entities: number;
}

/** Plan a pass over a set of notes. Nothing is written here. */
export function planLinkify(targets: Note[], entities: Entity[]): LinkifyPlan {
  const notes: LinkifyPlan["notes"] = [];
  let scanned = 0;
  for (const note of targets) {
    if (isProtectedNote(note)) continue;
    scanned++;
    const { content, mtimeMs } = readNote(note);
    const result = linkifyContent(content, note.path, entities);
    if (result.changes.length > 0) {
      notes.push({ path: note.path, mtimeMs, content: result.content, changes: result.changes });
    }
  }
  return { notes, scanned, entities: entities.length };
}
