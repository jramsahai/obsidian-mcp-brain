import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertDate, ToolError, today } from "./config.ts";
import { frontmatterEndLine } from "./frontmatter.ts";
import {
  absolutePath,
  findNote,
  GENERIC_NAMES,
  invalidateIndex,
  isTemplate,
  recordWrite,
} from "./vault.ts";

/**
 * The frontmatter contract and folder layout, in code. This is the table from
 * `second-brain/SKILL.md` — the skills no longer restate it, so this file is
 * the only definition and the tests below it are the only guard.
 */

export const NOTE_TYPES = [
  "project",
  "person",
  "meeting",
  "doc",
  "daily",
  "synthesis",
  "knowledge",
  "moc",
  "shopping",
  "idea",
  "index",
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/** Section order for `Daily/`. There is no template note to derive it from. */
export const DAILY_SECTIONS = [
  "Mood / Energy",
  "Weather",
  "Exercise",
  "Media",
  "Food",
  "Purchases",
  "Random Thoughts",
] as const;

const SYNTHESIS_SECTIONS = ["Observations", "Changes Made Tonight", "Candidates"];

/** Frontmatter keys whose values are lists of quoted wikilinks. */
const WIKILINK_LIST_KEYS = new Set(["people", "projects"]);
/** Frontmatter keys whose values are plain string lists. */
const PLAIN_LIST_KEYS = new Set(["topics", "aliases", "tags"]);

export interface CreateSpec {
  type: NoteType;
  name?: string;
  project?: string;
  date?: string;
  topic?: string;
  fields?: Record<string, string>;
  /** Opening prose placed under the title, above the first section heading. */
  body?: string;
}

export interface CreatedNote {
  path: string;
  title: string;
  type: NoteType;
  sections: string[];
  content: string;
}

export function buildNote(spec: CreateSpec): CreatedNote {
  const fields = spec.fields ?? {};
  const created = today();
  const date = spec.date ? assertDate(spec.date, "date") : created;

  switch (spec.type) {
    case "project": {
      const name = requireName(spec, "project");
      return assemble({
        path: `Projects/${name}/${name}.md`,
        title: name,
        type: "project",
        heading: name,
        frontmatter: [
          ["type", "project"],
          ["status", fields.status ?? "Active"],
          ["created", created],
          ["started", fields.started ?? date],
          ["people", fields.people ?? ""],
          ["topics", fields.topics ?? ""],
        ],
        sections: [
          "Stakeholders",
          "Key Decisions|Date,Decision,Reasoning",
          "Conversation Log|Date,Who,Summary",
          "Waiting On|What,Who,Since",
          "Related Tasks",
          "Related",
        ],
        fields,
        body: spec.body,
      });
    }
    case "person": {
      const name = requireName(spec, "person");
      return assemble({
        path: `People/${name}.md`,
        title: name,
        type: "person",
        heading: name,
        frontmatter: [
          ["type", "person"],
          ["role", fields.role ?? "Other"],
          ["created", created],
          ["projects", fields.projects ?? ""],
        ],
        sections: [
          "General Notes",
          "Conversation History|Date,Context,Summary",
          "Pending Topics",
          "Associated Projects",
        ],
        fields,
        body: spec.body,
      });
    }
    case "meeting": {
      const name = requireName(spec, "meeting");
      const project = requireProject(spec, "meeting");
      return assemble({
        path: `Projects/${project}/Meeting Notes/${name}.md`,
        title: name,
        type: "meeting",
        heading: name,
        frontmatter: [
          ["type", "meeting"],
          ["project", `"[[${project}]]"`],
          ["date", date],
          ["created", created],
          ["people", fields.people ?? ""],
        ],
        sections: ["Attendees", "Discussion", "Decisions", "Action Items"],
        fields,
        body: spec.body,
      });
    }
    case "doc": {
      const name = requireName(spec, "doc");
      const project = requireProject(spec, "doc");
      return assemble({
        path: `Projects/${project}/Docs/${name}.md`,
        title: name,
        type: "doc",
        heading: fields.title ?? name,
        frontmatter: [
          ["type", "doc"],
          ["project", `"[[${project}]]"`],
          ["created", created],
        ],
        // Drafts, research, and references have no fixed shape — imposing
        // sections on them would be the server deciding what the writing is.
        sections: [],
        fields,
        body: spec.body,
      });
    }
    case "daily":
      return assemble({
        path: `Daily/${date}.md`,
        title: date,
        type: "daily",
        heading: `Daily Note — ${date}`,
        frontmatter: [
          ["type", "daily"],
          ["date", date],
          ["created", created],
        ],
        sections: [...DAILY_SECTIONS],
        fields,
        body: spec.body,
      });
    case "synthesis":
      return assemble({
        path: `Syntheses/${date}.md`,
        title: date,
        type: "synthesis",
        heading: `Synthesis — ${date}`,
        frontmatter: [
          ["type", "synthesis"],
          ["date", date],
          ["created", created],
        ],
        sections: SYNTHESIS_SECTIONS,
        fields,
        body: spec.body,
      });
    case "knowledge": {
      const name = requireName(spec, "knowledge");
      const topic = requireTopic(spec);
      return assemble({
        path: `Knowledge Base/${topic}/${name}.md`,
        title: name,
        type: "knowledge",
        heading: name,
        frontmatter: [
          ["type", "knowledge"],
          ["topic", topic],
          ["topics", fields.topics ?? ""],
          ...(fields.source ? [["source", fields.source] as [string, string]] : []),
          ["created", created],
        ],
        sections: ["Summary", "Details", "Sources", "Related"],
        fields,
        body: spec.body,
      });
    }
    case "moc": {
      const topic = requireTopic(spec);
      const leaf = topic.split("/").pop()!;
      return assemble({
        path: `Knowledge Base/${topic}/${leaf} MOC.md`,
        title: `${leaf} MOC`,
        type: "moc",
        heading: `${leaf} MOC`,
        frontmatter: [
          ["type", "moc"],
          ["topic", topic],
          ["created", created],
        ],
        sections: ["Overview", "Notes", "Related"],
        fields,
        body: spec.body,
      });
    }
    case "shopping": {
      const name = requireName(spec, "shopping");
      return assemble({
        path: `Shopping/${name}.md`,
        title: name,
        type: "shopping",
        heading: name,
        frontmatter: [
          ["type", "shopping"],
          ["store", name],
          ["created", created],
        ],
        // Items are plain top-level checkboxes; a store list has no sections.
        sections: [],
        fields,
        body:
          spec.body ??
          `Items to pick up next time at ${name}. Check off when bought; clear checked items periodically.`,
      });
    }
    case "index": {
      // A folder's own README. The vault already uses `type: index` for
      // Inbox.md and Standup.md; without a way to create one, the Knowledge
      // Base review log had no file to live in and was silently never written.
      const folder = requireName(spec, "index");
      return assemble({
        path: `${folder}/README.md`,
        title: "README",
        type: "index",
        heading: `${folder}`,
        frontmatter: [
          ["type", "index"],
          ["created", created],
        ],
        sections: ["Overview", "Review Log"],
        fields,
        body: spec.body,
      });
    }
    case "idea": {
      const name = requireName(spec, "idea");
      return assemble({
        path: `Ideas/${name}.md`,
        title: name,
        type: "idea",
        heading: name,
        frontmatter: [
          ["type", "idea"],
          ["status", fields.status ?? "candidate"],
          ["created", created],
          ["topics", fields.topics ?? ""],
        ],
        sections: [
          "Concept",
          "Target User",
          "Problem",
          "Wedge",
          "Why It Might Work",
          "Monetization Thoughts",
          "Risks",
          "Open Questions",
          "Next Validation Step",
          "Scorecard|Criterion,Score (1-5),Notes",
          "Related",
        ],
        fields,
        body: spec.body,
      });
    }
  }
}

function requireName(spec: CreateSpec, type: string): string {
  const raw = (spec.name ?? "").trim();
  if (!raw) {
    throw new ToolError(`name is required for a ${type} note — the note is named after the thing it is about.`);
  }
  if (raw.includes("/") || raw.includes("\\")) {
    throw new ToolError(
      `name must be the plain note name, not a path; got "${raw}". The folder is derived from type.`,
    );
  }
  const name = raw.replace(/\.md$/i, "").trim();
  // Characters Obsidian forbids in a note name because they end a wikilink
  // early. `stripWikilink` truncates at the first `#` or `|`, so a note whose
  // filename contains one is written to disk and then unreachable by every
  // tool — not by name and not by path. That is the shape of a reference, so
  // the server owns it rather than asking the model to remember.
  const illegal = /[[\]#|^]/.exec(name);
  if (illegal) {
    throw new ToolError(
      `name may not contain "${illegal[0]}" — it would break the [[wikilink]] to this note; got "${name}". Use a plain name, e.g. "C Sharp Basics" rather than "C# Basics".`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new ToolError(
      `name may not contain line breaks or control characters; got ${JSON.stringify(name)}.`,
    );
  }
  if (GENERIC_NAMES.has(name.toLowerCase())) {
    throw new ToolError(
      `"${name}" is too generic to be a note name — a wikilink to it would be ambiguous. Name the note after the thing it is about, e.g. the project, person, or topic name.`,
    );
  }
  if (/^[^A-Za-z0-9]/.test(name)) {
    throw new ToolError(`name must start with a letter or digit; got "${name}".`);
  }
  return name;
}

function requireProject(spec: CreateSpec, type: string): string {
  const raw = (spec.project ?? "").trim();
  if (!raw) {
    throw new ToolError(
      `project is required for a ${type} note — ${type} notes live inside the project folder.`,
    );
  }
  const note = safeFind(raw);
  if (!note || note.type !== "project") {
    throw new ToolError(
      `project "${raw}" has no project note in the vault, so [[${raw}]] would not resolve. Create the project note first with note_create type="project".`,
    );
  }
  if (isTemplate(note)) {
    throw new ToolError(
      `"${note.title}" is a template, not a real project. Create the project first with note_create type="project", then file the ${type} note under it.`,
    );
  }
  return note.title;
}

function requireTopic(spec: CreateSpec): string {
  const raw = (spec.topic ?? spec.fields?.topic ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!raw) {
    throw new ToolError(
      'topic is required for knowledge and moc notes — it is the Knowledge Base folder path, e.g. "Vehicles" or "Cycling/Repair".',
    );
  }
  // Per segment, not per prefix. `Cycling/../../Daily` resolves inside the
  // vault root so absolutePath's escape guard never fires, yet the note lands
  // outside Knowledge Base entirely; and a `.Archive` segment is skipped by
  // walk(), so the note exists on disk and is invisible to every reader.
  const segments = raw.split("/");
  const bad = segments.find((s) => s === "" || s.startsWith("."));
  if (bad !== undefined) {
    throw new ToolError(
      `topic "${raw}" is not a valid folder path — "${bad || "(empty)"}" is not a usable folder name. Use plain folder names, e.g. "Vehicles" or "Cycling/Repair".`,
    );
  }
  return raw;
}

function safeFind(ref: string) {
  try {
    return findNote(ref);
  } catch {
    return null;
  }
}

interface Assembly {
  path: string;
  title: string;
  type: NoteType;
  heading: string;
  frontmatter: [string, string][];
  /** `Name` or `Name|Col,Col` when the section holds a table. */
  sections: string[];
  fields: Record<string, string>;
  body?: string;
}

function assemble(a: Assembly): CreatedNote {
  const declared = new Set(a.frontmatter.map(([k]) => k));
  const extra = Object.entries(a.fields).filter(
    ([k]) => !declared.has(k) && k !== "description" && k !== "topic",
  );
  const pairs = [...a.frontmatter, ...extra];

  const lines = ["---"];
  for (const [key, value] of pairs) lines.push(`${key}: ${renderValue(key, value)}`);
  lines.push("---", "", `# ${a.heading}`);

  const description = a.fields.description?.trim();
  if (description) lines.push("", `**Description:** ${description}`);
  const intro = a.body?.trim();
  if (intro) lines.push("", intro);

  const sections: string[] = [];
  for (const spec of a.sections) {
    const [name, columns] = spec.split("|");
    sections.push(name);
    lines.push("", `## ${name}`);
    if (columns) {
      const cols = columns.split(",");
      lines.push("", `| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`);
    }
  }
  return { path: a.path, title: a.title, type: a.type, sections, content: lines.join("\n") + "\n" };
}

/**
 * Frontmatter is emitted, never re-serialized. Wikilinks in list properties are
 * quoted because Obsidian only reads them as graph edges when they are.
 */
export function renderValue(key: string, value: string): string {
  if (value.startsWith("[") || value.startsWith('"')) return value;
  if (WIKILINK_LIST_KEYS.has(key)) return `[${splitList(value).map(quoteLink).join(", ")}]`;
  if (PLAIN_LIST_KEYS.has(key)) return `[${splitList(value).join(", ")}]`;
  return quoteScalar(value);
}

/**
 * A scalar that YAML would read as anything other than a plain string gets
 * quoted. Emitting `status: Blocked: waiting on legal` raw is a YAML error, so
 * Obsidian discards the *whole* property block — the note loses type, created,
 * people and topics in the Properties UI and in Dataview — while this server's
 * own line-based parser still reads them. Server and app then disagree about
 * what is in the vault, silently.
 */
function quoteScalar(value: string): string {
  if (value === "") return value;
  const needsQuote =
    /:\s/.test(value) ||
    value.endsWith(":") ||
    /\s#/.test(value) ||
    /^[#[\]{}&*!|>%@`'"?,-]/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function quoteLink(value: string): string {
  const inner = value.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
  return `"[[${inner}]]"`;
}

/**
 * Frontmatter keys a tool may change on an existing note. `type`, `created`,
 * `date`, `project`, `topic`, and `store` are excluded: they decide where the
 * note lives and what it is, so changing one would make the frontmatter
 * disagree with the note's own path.
 */
export const SETTABLE_FIELDS = [
  "status",
  "role",
  "started",
  "due",
  "source",
  "topics",
  "people",
  "projects",
  "aliases",
  "tags",
] as const;
export type SettableField = (typeof SETTABLE_FIELDS)[number];

const FM_KEY_RE = /^([A-Za-z0-9_][A-Za-z0-9_ -]*):/;

export interface FieldEdit {
  content: string;
  changed: boolean;
  before?: string;
}

/**
 * Set or clear one frontmatter key by targeted line edit — the block is never
 * re-serialized, so every other key keeps its exact bytes. Which status a
 * project has is the model's judgment; getting the YAML right (quoting a
 * wikilink list so Obsidian still counts it as a graph edge) is mechanism, and
 * that is the half this owns.
 */
export function setFrontmatterField(
  content: string,
  key: string,
  value: string | null,
): FieldEdit {
  const lines = content.split("\n");
  const end = frontmatterEndLine(lines);
  if (end === -1) {
    throw new ToolError(
      "this note has no frontmatter block, so there is no field to set. Notes created by note_create always have one.",
    );
  }

  let at = -1;
  for (let i = 1; i < end; i++) {
    const match = FM_KEY_RE.exec(lines[i]);
    if (match && match[1].trim().toLowerCase() === key.toLowerCase()) {
      at = i;
      break;
    }
  }
  // A block-list value spans its `- item` continuation lines.
  let stop = at + 1;
  if (at !== -1) while (stop < end && /^\s*-\s+/.test(lines[stop])) stop++;

  const before = at === -1 ? undefined : lines.slice(at, stop).join("\n");
  const rendered = value === null ? null : `${key}: ${renderValue(key, value)}`;

  if (at === -1) {
    if (rendered === null) return { content, changed: false };
    const next = [...lines];
    next.splice(end, 0, rendered);
    return { content: next.join("\n"), changed: true };
  }
  if (rendered === before) return { content, changed: false, before };
  const next = [...lines];
  next.splice(at, stop - at, ...(rendered === null ? [] : [rendered]));
  return { content: next.join("\n"), changed: true, before };
}

export interface CreateResult {
  created: boolean;
  path: string;
  title: string;
  type: NoteType;
  sections: string[];
  reason?: string;
}

/**
 * Write a new note. An existing note with content is never overwritten — the
 * whole point of routing creation through here is that a second capture on the
 * same subject appends instead of replacing.
 */
export function createNote(spec: CreateSpec): CreateResult {
  const note = buildNote(spec);
  const full = absolutePath(note.path);
  if (existsSync(full)) {
    const existing = readFileSync(full, "utf8");
    if (existing.trim() !== "") {
      return {
        created: false,
        path: note.path,
        title: note.title,
        type: note.type,
        sections: note.sections,
        reason: `"${note.path}" already exists. Add to it with section_append instead of recreating it.`,
      };
    }
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, note.content, "utf8");
  recordWrite(note.path);
  invalidateIndex();
  return {
    created: true,
    path: note.path,
    title: note.title,
    type: note.type,
    sections: note.sections,
  };
}

/** Ensure `Daily/<date>.md` exists, creating it from the template if not. */
export function ensureDailyNote(date: string): CreateResult {
  assertDate(date, "date");
  const result = createNote({ type: "daily", date });
  if (!result.created && !existsSync(absolutePath(result.path))) {
    throw new ToolError(`could not create ${result.path}.`);
  }
  return result;
}
