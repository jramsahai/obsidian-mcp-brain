import { assertDate, config, ToolError, today } from "./config.ts";
import { setChecklistItem } from "./checklist.ts";
import { parseNote } from "./frontmatter.ts";
import { buildEntities, planLinkify } from "./linkify.ts";
import { buildGraph, searchVault } from "./links.ts";
import {
  createNote,
  DAILY_SECTIONS,
  ensureDailyNote,
  NOTE_TYPES,
  type NoteType,
} from "./notes.ts";
import {
  RELATE_CAP,
  RELATED_SECTION,
  relateBudgetRemaining,
  relatedLine,
  relatedTargets,
  spendRelateBudget,
} from "./relate.ts";
import {
  appendToSection,
  findSection,
  insertSection,
  listSections,
  normalizeHeading,
  requireSection,
} from "./sections.ts";
import {
  composeTaskLine,
  findDuplicate,
  insertTaskLine,
  moveTaskLine,
  parseTasksDoc,
  PRIORITIES,
  requireTaskSection,
  TASK_SECTIONS,
  TASKS_FILE,
  type Priority,
  type Task,
} from "./tasks.ts";
import {
  findNote,
  getIndex,
  nearestTitles,
  readNote,
  resolveNote,
  writeNoteGuarded,
  type Note,
} from "./vault.ts";
import { gitAvailable, isDirty, snapshot, statusPorcelain } from "./git.ts";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => unknown;
}

// ---------------------------------------------------------------- arg helpers

function str(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new ToolError(`${key} is required.`);
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ToolError(`${key} must be a string; got ${typeof value}.`);
  }
  return value;
}

function req(args: Record<string, unknown>, key: string): string {
  return str(args, key, true)!;
}

function bool(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ToolError(`${key} must be true or false.`);
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ToolError(`${key} must be a number.`);
  return n;
}

function enumArg<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  required = false,
): T | undefined {
  const value = str(args, key, required);
  if (value === undefined) return undefined;
  const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  if (!match) {
    throw new ToolError(`${key} must be one of: ${allowed.join(", ")}; got "${value}".`);
  }
  return match;
}

function templateOrder(note: Note): string[] {
  const template = note.folder ? findNoteSafe(`${note.folder}/Template.md`) : null;
  if (!template) return [];
  const { content } = readNote(template);
  return listSections(content)
    .filter((s) => s.level === 2)
    .map((s) => s.name);
}

function findNoteSafe(ref: string): Note | null {
  try {
    return findNote(ref);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------- tools

const vaultStatus: ToolDef = {
  name: "vault_status",
  description:
    "Vault orientation in one call: today's local date, git dirty state, note counts by type, latest synthesis and daily note, unresolved/orphan link counts, and notes changed in the last 24 hours. Call this first in any standup or nightly run instead of exploring the vault by hand.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: () => {
    const cfg = config();
    const idx = getIndex();
    const counts: Record<string, number> = {};
    for (const note of idx.notes) {
      const key = note.type ?? "(untyped)";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const graph = buildGraph();
    const orphans = idx.notes.filter(
      (n) => (graph.incoming.get(n.path) ?? []).length === 0 && !n.path.endsWith("Template.md"),
    );
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const changed = idx.notes.filter((n) => n.mtimeMs >= cutoff).map((n) => n.path);
    const latestIn = (folder: string) =>
      idx.notes
        .filter((n) => n.path.startsWith(`${folder}/`) && /\d{4}-\d{2}-\d{2}/.test(n.title))
        .map((n) => n.title)
        .sort()
        .pop() ?? null;

    return {
      today: today(cfg),
      timezone: cfg.timezone,
      total_notes: idx.notes.length,
      counts_by_type: counts,
      last_synthesis_date: latestIn("Syntheses"),
      last_daily_date: latestIn("Daily"),
      unresolved_count: graph.unresolved.size,
      orphan_count: orphans.length,
      changed_last_24h: changed,
      git_enabled: cfg.gitEnabled,
      git_dirty: cfg.gitEnabled && gitAvailable() ? isDirty() : null,
      git_dirty_files: cfg.gitEnabled && gitAvailable() ? statusPorcelain() : [],
    };
  },
};

const vaultList: ToolDef = {
  name: "vault_list",
  description:
    "List notes, filtered by frontmatter type, top-level folder, frontmatter status, or modification date. Set latest=true to get only the newest date-named note in a folder (use this instead of listing a folder and eyeballing the max filename).",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "Frontmatter type filter, e.g. project, person, daily, synthesis, knowledge.",
      },
      folder: { type: "string", description: "Top-level folder, e.g. Projects, People, Syntheses." },
      status: { type: "string", description: "Frontmatter status filter, e.g. Active, Done." },
      changed_since: {
        type: "string",
        description: "YYYY-MM-DD. Only notes modified on or after this date.",
      },
      latest: {
        type: "boolean",
        description: "Return only the single newest note by filename. Use for date-named folders.",
      },
      limit: { type: "number", description: "Maximum notes to return. Default 100." },
    },
    additionalProperties: false,
  },
  handler: (args) => {
    const type = str(args, "type");
    const folder = str(args, "folder");
    const status = str(args, "status");
    const changedSince = str(args, "changed_since");
    const latest = bool(args, "latest");
    const limit = num(args, "limit") ?? 100;

    let notes = getIndex().notes;
    if (type) notes = notes.filter((n) => n.type?.toLowerCase() === type.toLowerCase());
    if (status) notes = notes.filter((n) => n.status?.toLowerCase() === status.toLowerCase());
    if (folder) {
      const prefix = folder.replace(/\/$/, "").toLowerCase() + "/";
      notes = notes.filter((n) => n.path.toLowerCase().startsWith(prefix));
    }
    if (changedSince) {
      assertDate(changedSince, "changed_since");
      const cutoff = new Date(`${changedSince}T00:00:00`).getTime();
      notes = notes.filter((n) => n.mtimeMs >= cutoff);
    }
    if (latest) {
      const newest = [...notes].sort((a, b) => a.title.localeCompare(b.title)).pop();
      notes = newest ? [newest] : [];
    }
    return {
      ...truncation(notes.length, Math.min(notes.length, limit), "notes"),
      notes: notes.slice(0, limit).map((n) => ({
        path: n.path,
        title: n.title,
        type: n.type,
        status: n.status,
        modified: new Date(n.mtimeMs).toISOString().slice(0, 10),
      })),
    };
  },
};

/**
 * A capped list must say it was capped. A bare `count` next to a short array
 * reads as "this is everything" to a caller that is not comparing lengths.
 */
function truncation(total: number, returned: number, unit: string) {
  const truncated = returned < total;
  return {
    total,
    returned,
    truncated,
    ...(truncated
      ? { note: `${total - returned} more ${unit} exist. Raise limit to see them.` }
      : {}),
  };
}

const vaultRead: ToolDef = {
  name: "vault_read",
  description:
    "Read a note by wikilink target (e.g. \"Wayfinder\") or vault-relative path. Never construct file paths by hand — the plain note name is enough. Pass section to read only one section.",
  inputSchema: {
    type: "object",
    properties: {
      note: {
        type: "string",
        description: 'Note name as it appears in a wikilink, e.g. "Wayfinder" or "First Last".',
      },
      section: {
        type: "string",
        description: 'Optional heading to read, e.g. "Current Status". Omit for the whole note.',
      },
    },
    required: ["note"],
    additionalProperties: false,
  },
  handler: (args) => {
    const note = resolveNote(req(args, "note"));
    const { content } = readNote(note);
    const parsed = parseNote(content);
    const sectionName = str(args, "section");
    const sections = listSections(content)
      .filter((s) => s.level <= 3)
      .map((s) => s.name);

    if (sectionName) {
      const section = requireSection(content, sectionName, note.path);
      const lines = content.split("\n").slice(section.headingLine, section.end);
      return {
        path: note.path,
        title: note.title,
        section: section.name,
        content: lines.join("\n").trimEnd(),
      };
    }
    return {
      path: note.path,
      title: note.title,
      frontmatter: parsed.data,
      sections,
      content: parsed.body.trim(),
    };
  },
};

const vaultSearch: ToolDef = {
  name: "vault_search",
  description:
    "Full-text search across note titles, aliases, and bodies. Returns matching notes with the matching lines. Narrow with type or folder when you know where the answer lives.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text to find. Case-insensitive substring match." },
      type: { type: "string", description: "Restrict to notes with this frontmatter type." },
      folder: { type: "string", description: "Restrict to a top-level folder." },
      limit: {
        type: "number",
        description:
          "Maximum notes to return. Default 20. The whole vault is always searched; when more matched than were returned the result says so.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: (args) => {
    const { hits, total, truncated } = searchVault(req(args, "query"), {
      type: str(args, "type"),
      folder: str(args, "folder"),
      limit: num(args, "limit") ?? 20,
    });
    return {
      total_matching_notes: total,
      returned: hits.length,
      truncated,
      ...(truncated
        ? { note: `${total - hits.length} more notes matched. Raise limit or narrow the query to see them.` }
        : {}),
      results: hits,
    };
  },
};

const DIRECTIONS = ["in", "out", "unresolved", "orphans", "deadends"] as const;

const vaultLinks: ToolDef = {
  name: "vault_links",
  description:
    "Inspect the wikilink graph. direction=in gives backlinks to a note, out gives its outgoing links, unresolved lists link targets with no note, orphans lists notes nothing links to, deadends lists notes that link to nothing. note is required for in and out only.",
  inputSchema: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: [...DIRECTIONS],
        description: "Which relationship to report.",
      },
      note: { type: "string", description: "Note name. Required when direction is in or out." },
      limit: { type: "number", description: "Maximum entries to return. Default 100." },
    },
    required: ["direction"],
    additionalProperties: false,
  },
  handler: (args) => {
    const direction = enumArg(args, "direction", DIRECTIONS, true)!;
    const limit = num(args, "limit") ?? 100;
    const graph = buildGraph();

    if (direction === "in" || direction === "out") {
      const ref = str(args, "note");
      if (!ref) throw new ToolError(`note is required when direction is "${direction}".`);
      const note = resolveNote(ref);
      const links =
        direction === "in" ? (graph.incoming.get(note.path) ?? []) : (graph.out.get(note.path) ?? []);
      return {
        note: note.path,
        direction,
        ...truncation(links.length, Math.min(links.length, limit), "links"),
        links: links.slice(0, limit),
      };
    }
    if (direction === "unresolved") {
      const entries = [...graph.unresolved.entries()].map(([target, sources]) => ({
        target,
        linked_from: sources,
      }));
      return {
        direction,
        ...truncation(entries.length, Math.min(entries.length, limit), "unresolved targets"),
        unresolved: entries.slice(0, limit),
      };
    }
    const notes = getIndex().notes.filter((n) => !n.path.endsWith("Template.md"));
    const list =
      direction === "orphans"
        ? notes.filter((n) => (graph.incoming.get(n.path) ?? []).length === 0)
        : notes.filter((n) => (graph.out.get(n.path) ?? []).length === 0);
    return {
      direction,
      ...truncation(list.length, Math.min(list.length, limit), "notes"),
      notes: list.slice(0, limit).map((n) => n.path),
    };
  },
};

const sectionAppend: ToolDef = {
  name: "section_append",
  description:
    "Append content at the end of a named section of a note — never at the end of the file. If the section holds a markdown table the content must be a pipe-delimited row and is appended as a row. Repeats are skipped by default, so re-running is safe.",
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", description: "Note name or vault-relative path." },
      section: {
        type: "string",
        description: 'Heading to append under, e.g. "Activity Log" or "## Related".',
      },
      content: {
        type: "string",
        description:
          'Text to append. One line or block. For a table section, a pipe-delimited row: "| 2026-07-31 | Topic | Summary |".',
      },
      dedupe: {
        type: "boolean",
        description: "Skip the append if identical content already exists in the section. Default true.",
      },
      create_section: {
        type: "boolean",
        description: "Create the section if it does not exist, in template position. Default false.",
      },
    },
    required: ["note", "section", "content"],
    additionalProperties: false,
  },
  handler: (args) => {
    const ref = req(args, "note");
    const sectionName = normalizeHeading(req(args, "section"));
    const content = req(args, "content");
    const dedupe = bool(args, "dedupe") ?? true;
    const create = bool(args, "create_section") ?? false;

    const note = resolveNote(ref);
    const current = readNote(note);
    let working = current.content;
    let created = false;

    if (!findSection(working, sectionName)) {
      if (!create) requireSection(working, sectionName, note.path);
      working = insertSection(working, sectionName, templateOrder(note));
      created = true;
    }

    const result = appendToSection(working, sectionName, content, {
      dedupe,
      notePath: note.path,
    });
    if (!result.changed && !created) {
      return { path: note.path, section: sectionName, appended: false, reason: result.reason };
    }
    writeNoteGuarded(note.path, current.mtimeMs, result.content);
    return {
      path: note.path,
      section: sectionName,
      appended: result.changed,
      section_created: created,
      as_table_row: result.asTableRow,
    };
  },
};

function resolveProject(name: string): string {
  const note = findNoteSafe(name);
  if (note) return note.title;
  const projects = getIndex()
    .notes.filter((n) => n.type === "project" && n.title !== "Template")
    .map((n) => n.title);
  const near = nearestTitles(name, 10).filter((t) => projects.includes(t));
  const list = (near.length ? near : projects).slice(0, 10).join(", ");
  throw new ToolError(
    `project "${name}" has no note in the vault, so [[${name}]] would not resolve. Use an exact existing project name (${list}), or omit project for a standalone task.`,
  );
}

const taskAdd: ToolDef = {
  name: "task_add",
  description:
    "Add a task to Tasks.md. Composes the task line in the documented order and files it in the right section — do not write task lines by hand. Rejects near-duplicates of existing tasks. Setting waiting_on files the task under Waiting On Others automatically.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The task itself, in the user's wording. No markers." },
      project: {
        type: "string",
        description: "Exact existing project name. Becomes a [[wikilink]]. Omit for standalone tasks.",
      },
      due: { type: "string", description: "Due date as YYYY-MM-DD. Omit if unknown." },
      priority: {
        type: "string",
        enum: [...PRIORITIES],
        description: "Task priority. Omit or use none for normal.",
      },
      section: {
        type: "string",
        enum: ["Active", "Waiting On Me", "Waiting On Others"],
        description: "Where the task belongs. Defaults to Active, or Waiting On Others if waiting_on is set.",
      },
      waiting_on: { type: "string", description: "Person's note name when blocked by someone else." },
      waiting_since: {
        type: "string",
        description: "YYYY-MM-DD the wait started. Defaults to today when waiting_on is set.",
      },
      notes: { type: "string", description: "Short trailing note. Appended after an em dash." },
    },
    required: ["text"],
    additionalProperties: false,
  },
  handler: (args) => {
    const text = req(args, "text");
    const project = str(args, "project");
    const due = str(args, "due");
    const waitingOn = str(args, "waiting_on");
    const waitingSince = str(args, "waiting_since");
    const priority = enumArg(args, "priority", PRIORITIES) ?? "none";
    const section =
      enumArg(args, "section", ["Active", "Waiting On Me", "Waiting On Others"] as const) ??
      (waitingOn ? "Waiting On Others" : "Active");
    if (due) assertDate(due, "due");
    if (waitingSince) assertDate(waitingSince, "waiting_since");

    const tasksNote = resolveNote(TASKS_FILE);
    const current = readNote(tasksNote);
    const doc = parseTasksDoc(current.content);

    const duplicate = findDuplicate(doc.tasks, text);
    if (duplicate) {
      throw new ToolError(
        `a task covering this already exists in "${duplicate.section}": "${duplicate.raw.trim()}". Use task_update with match="${duplicate.text.slice(
          0,
          40,
        )}" instead of adding a second line.`,
      );
    }

    const line = composeTaskLine({
      done: false,
      text,
      project: project ? resolveProject(project) : undefined,
      due,
      priority: priority as Priority,
      waitingOn: waitingOn ? resolveWaitingPerson(waitingOn) : undefined,
      waitingSince: waitingOn ? (waitingSince ?? today()) : undefined,
      notes: str(args, "notes"),
    });

    requireTaskSection(doc, section);
    const lines = insertTaskLine(doc, section, line);
    writeNoteGuarded(tasksNote.path, current.mtimeMs, lines.join("\n"));
    return { added: true, section, line };
  },
};

/** Waiting-on targets are people; an unresolved person wikilink is acceptable but flagged. */
function resolveWaitingPerson(name: string): string {
  const note = findNoteSafe(name);
  return note ? note.title : name;
}

const taskUpdate: ToolDef = {
  name: "task_update",
  description:
    "Update an existing task in Tasks.md, found by a distinctive fragment of its text. Recomposes the whole line in documented order and moves it between sections as needed. done=true checks the box, stamps the completion date, and moves the task to Done.",
  inputSchema: {
    type: "object",
    properties: {
      match: {
        type: "string",
        description: "Distinctive fragment of the existing task text. Must match exactly one task.",
      },
      done: { type: "boolean", description: "true completes the task; false reopens it." },
      text: { type: "string", description: "Replacement task text. Omit to keep the current wording." },
      project: { type: "string", description: "Exact existing project name, or empty string to clear." },
      due: { type: "string", description: "New due date YYYY-MM-DD, or empty string to clear." },
      priority: { type: "string", enum: [...PRIORITIES], description: "New priority; none clears it." },
      section: {
        type: "string",
        enum: [...TASK_SECTIONS],
        description: "Move the task to this section.",
      },
      waiting_on: { type: "string", description: "Person blocking the task, or empty string to clear." },
      waiting_since: { type: "string", description: "YYYY-MM-DD the wait started." },
      notes: { type: "string", description: "Replacement trailing note, or empty string to clear." },
    },
    required: ["match"],
    additionalProperties: false,
  },
  handler: (args) => {
    const match = req(args, "match");
    const tasksNote = resolveNote(TASKS_FILE);
    const current = readNote(tasksNote);
    const doc = parseTasksDoc(current.content);

    const needle = match.toLowerCase().trim();
    let candidates = doc.tasks.filter((t) => t.text.toLowerCase().includes(needle));
    if (candidates.length === 0) {
      candidates = doc.tasks.filter((t) => t.raw.toLowerCase().includes(needle));
    }
    if (candidates.length === 0) {
      throw new ToolError(
        `no task in ${TASKS_FILE} matches "${match}". Use vault_read on Tasks to see the exact wording.`,
      );
    }
    if (candidates.length > 1) {
      const open = candidates.filter((t) => !t.done);
      if (open.length === 1) candidates = open;
    }
    if (candidates.length > 1) {
      throw new ToolError(
        `"${match}" matches ${candidates.length} tasks: ${candidates
          .map((t) => `"${t.text}"`)
          .join("; ")}. Pass a longer, more distinctive fragment.`,
      );
    }

    const task = candidates[0];
    const next: Task = { ...task };
    const done = bool(args, "done");

    if (has(args, "text")) next.text = req(args, "text");
    if (has(args, "project")) {
      const value = args.project as string;
      next.project = value ? resolveProject(value) : undefined;
    }
    if (has(args, "due")) {
      const value = args.due as string;
      next.due = value ? assertDate(value, "due") : undefined;
    }
    if (has(args, "priority")) next.priority = enumArg(args, "priority", PRIORITIES)!;
    if (has(args, "waiting_on")) {
      const value = args.waiting_on as string;
      next.waitingOn = value ? resolveWaitingPerson(value) : undefined;
      if (!value) next.waitingSince = undefined;
      else next.waitingSince = str(args, "waiting_since") ?? next.waitingSince ?? today();
    } else if (has(args, "waiting_since")) {
      next.waitingSince = assertDate(req(args, "waiting_since"), "waiting_since");
    }
    if (has(args, "notes")) {
      const value = args.notes as string;
      next.notes = value ? value : undefined;
    }

    let targetSection = enumArg(args, "section", TASK_SECTIONS) as string | undefined;
    if (done === true) {
      next.done = true;
      next.completed = next.completed ?? today();
      targetSection = targetSection ?? "Done";
    } else if (done === false) {
      next.done = false;
      next.completed = undefined;
      targetSection = targetSection ?? (next.waitingOn ? "Waiting On Others" : "Active");
    } else if (!targetSection && next.waitingOn && task.section === "Active") {
      targetSection = "Waiting On Others";
    }

    const line = composeTaskLine(next);
    const move = targetSection && targetSection !== task.section ? targetSection : null;
    if (move) requireTaskSection(doc, move);
    const lines = moveTaskLine(doc.lines, task.line, line, move);
    writeNoteGuarded(tasksNote.path, current.mtimeMs, lines.join("\n"));
    return {
      updated: true,
      section: move ?? task.section,
      moved: Boolean(move),
      before: task.raw.trim(),
      after: line,
    };
  },
};

function has(args: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key) && args[key] !== null;
}

const vaultSnapshot: ToolDef = {
  name: "vault_snapshot",
  description:
    "Commit the current vault state to git with a label. Call once before an automated editing pass and once after, so the night's changes are reviewable and revertible. A clean vault is success, not an error.",
  inputSchema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: 'Commit message, e.g. "nightly consolidation 2026-07-31 (pre)".',
      },
    },
    required: ["label"],
    additionalProperties: false,
  },
  handler: (args) => snapshot(req(args, "label")),
};

// ------------------------------------------------------------------- capture

const noteCreate: ToolDef = {
  name: "note_create",
  description:
    "Create a new note of a given type. The server derives the folder and filename from type plus name, emits the required frontmatter, and lays out the standard sections — never construct a path or write frontmatter by hand. Fill the sections afterwards with section_append. An existing note is never overwritten; the result says so and you should append instead.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...NOTE_TYPES],
        description:
          "project -> Projects/X/X.md; person -> People/First Last.md; meeting -> the project's Meeting Notes folder; doc -> the project's Docs folder, for drafts, research, and references; daily -> Daily/DATE.md; synthesis -> Syntheses/DATE.md; knowledge and moc -> Knowledge Base/TOPIC/; shopping -> Shopping/Store.md; idea -> Ideas/X.md.",
      },
      name: {
        type: "string",
        description:
          "The plain name of the thing — project name, person's full name, store, idea, or knowledge note title. Not a path, not a generic name like Overview. Omit for daily and synthesis, which are named by date.",
      },
      project: {
        type: "string",
        description: "Exact existing project name. Required for type=meeting and type=doc.",
      },
      date: { type: "string", description: "YYYY-MM-DD. Used by daily, synthesis, and meeting. Defaults to today." },
      topic: {
        type: "string",
        description:
          'Knowledge Base folder path for type=knowledge or moc, e.g. "Vehicles" or "Cycling/Repair".',
      },
      fields: {
        type: "object",
        additionalProperties: { type: "string" },
        description:
          'Extra frontmatter values as a flat map of strings, e.g. {"status":"On Hold","people":"Jane Doe, Sam Lee","description":"One line"}. people and projects become quoted wikilinks; topics becomes a plain list.',
      },
      body: {
        type: "string",
        description:
          "Opening prose placed under the title, above the first section. The standard sections for the type are always emitted regardless.",
      },
    },
    required: ["type"],
    additionalProperties: false,
  },
  handler: (args) => {
    const type = enumArg(args, "type", NOTE_TYPES, true)! as NoteType;
    const result = createNote({
      type,
      name: str(args, "name"),
      project: str(args, "project"),
      date: str(args, "date"),
      topic: str(args, "topic"),
      fields: flatMap(args, "fields"),
      body: str(args, "body"),
    });
    if (!result.created) throw new ToolError(result.reason!);
    return result;
  },
};

function flatMap(args: Record<string, unknown>, key: string): Record<string, string> | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError(`${key} must be a flat map of string values.`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") {
      throw new ToolError(`${key}.${k} must be a string; nested objects and arrays are not supported.`);
    }
    out[k] = String(v);
  }
  return out;
}

const dailyLog: ToolDef = {
  name: "daily_log",
  description:
    "Add an entry to the personal daily journal, creating Daily/DATE.md from the template if it does not exist. The daily note is a diary — mood, weather, exercise, media, food, purchases, stray thoughts. Project facts, decisions, meeting notes, and follow-ups do not belong here: route those to section_append on the project note and to task_add. Feelings about a project are journal; the facts about it are not.",
  inputSchema: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: [...DAILY_SECTIONS],
        description:
          "Mood / Energy for mood, energy, sleep, stress. Weather for weather. Exercise for workouts, walks, sports. Media for books, shows, films, music, games, articles. Food for meals, snacks, restaurants, cooking. Purchases for things bought and notable spending. Random Thoughts for reflections, memories, and stray notes.",
      },
      content: {
        type: "string",
        description: "The entry, in the user's own wording. One line or a short block.",
      },
      date: { type: "string", description: "YYYY-MM-DD. Defaults to today in the vault's timezone." },
    },
    required: ["section", "content"],
    additionalProperties: false,
  },
  handler: (args) => {
    const section = enumArg(args, "section", DAILY_SECTIONS, true)!;
    const content = req(args, "content");
    const date = str(args, "date") ? assertDate(req(args, "date"), "date") : today();

    const daily = ensureDailyNote(date);
    const note = resolveNote(daily.path);
    const current = readNote(note);

    let working = current.content;
    let created = false;
    if (!findSection(working, section)) {
      working = insertSection(working, section, [...DAILY_SECTIONS]);
      created = true;
    }
    const result = appendToSection(working, section, content, { notePath: note.path });
    if (!result.changed && !created) {
      return { path: note.path, section, appended: false, reason: result.reason };
    }
    writeNoteGuarded(note.path, current.mtimeMs, result.content);
    return {
      path: note.path,
      date,
      section,
      appended: result.changed,
      note_created: daily.created,
      section_created: created,
    };
  },
};

const checklistSet: ToolDef = {
  name: "checklist_set",
  description:
    "Add, update, or check off a checkbox item in a note — shopping lists, a person's Pending Topics, any `- [ ]` list. Adds the item if it is missing, merges new detail into the existing line if it is already there, and checks or unchecks it. It never removes a line. For work items with dates or priorities use task_add instead.",
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", description: 'Note name, e.g. "Home Depot" or "Jane Doe".' },
      item: { type: "string", description: "The item text, in the user's wording. No checkbox markers." },
      section: {
        type: "string",
        description:
          'Heading the item lives under, e.g. "Pending Topics". Required when the note has sections.',
      },
      detail: {
        type: "string",
        description: "Optional detail — size, brand, why. Merged into an existing line rather than duplicated.",
      },
      checked: { type: "boolean", description: "true marks the item done, false reopens it." },
    },
    required: ["note", "item"],
    additionalProperties: false,
  },
  handler: (args) => {
    const note = resolveNote(req(args, "note"));
    const current = readNote(note);
    const result = setChecklistItem(current.content, {
      item: req(args, "item"),
      section: str(args, "section"),
      detail: str(args, "detail"),
      checked: bool(args, "checked"),
      notePath: note.path,
    });
    if (result.action !== "unchanged") {
      writeNoteGuarded(note.path, current.mtimeMs, result.content);
    }
    return { path: note.path, action: result.action, line: result.line };
  },
};

// -------------------------------------------------------------- machine edits

const relate: ToolDef = {
  name: "relate",
  description:
    "Record that two notes are connected, as a line in the target note's `## Related` section. One connection per call. The reason is yours to write and is the point of the tool — a bare link with no reason is noise. Already-linked targets are skipped, so re-running is safe. Capped at " +
    RELATE_CAP +
    " new links per note per day.",
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", description: "The note that gains the `## Related` entry." },
      target: { type: "string", description: "The related note. Must already exist." },
      reason: {
        type: "string",
        description: "One line on why they are related, in your own words. Required.",
      },
      mirror: {
        type: "boolean",
        description: "Also add the reciprocal entry to the target's `## Related`. Default false.",
      },
    },
    required: ["note", "target", "reason"],
    additionalProperties: false,
  },
  handler: (args) => {
    const note = resolveNote(req(args, "note"));
    const target = resolveNote(req(args, "target"));
    const reason = req(args, "reason").trim();
    const mirror = bool(args, "mirror") ?? false;

    if (note.path === target.path) {
      throw new ToolError(`"${note.title}" cannot be related to itself.`);
    }
    if (reason.replace(/\s/g, "").length < 8) {
      throw new ToolError(
        `reason is too short to be useful ("${reason}"). Say in one line what connects ${note.title} and ${target.title}.`,
      );
    }

    const added = addRelated(note, target.title, reason);
    const result: Record<string, unknown> = {
      note: note.path,
      target: target.title,
      added: added.added,
      remaining_today: relateBudgetRemaining(note.path),
      ...(added.reason ? { reason_skipped: added.reason } : {}),
    };
    if (mirror) {
      // The mirror is the same edge seen from the other end, so it does not
      // consume the target's own daily budget.
      const back = addRelated(target, note.title, reason, { charge: false });
      result.mirrored = back.added;
      if (back.reason) result.mirror_skipped = back.reason;
    }
    return result;
  },
};

function addRelated(
  note: Note,
  target: string,
  reason: string,
  options: { charge?: boolean } = {},
): { added: boolean; reason?: string } {
  const charge = options.charge ?? true;
  const current = readNote(note);
  const existing = relatedTargets(current.content).map((t) => t.toLowerCase());
  if (existing.includes(target.toLowerCase())) {
    return { added: false, reason: `[[${target}]] is already listed under ## ${RELATED_SECTION}` };
  }
  if (charge && relateBudgetRemaining(note.path) <= 0) {
    throw new ToolError(
      `"${note.path}" has already taken its ${RELATE_CAP} new related links today. Stop adding links to this note; keep the strongest remaining connection for tomorrow.`,
    );
  }
  let working = current.content;
  if (!findSection(working, RELATED_SECTION)) {
    working = insertSection(working, RELATED_SECTION, templateOrder(note));
  }
  const result = appendToSection(working, RELATED_SECTION, relatedLine(target, reason), {
    notePath: note.path,
  });
  writeNoteGuarded(note.path, current.mtimeMs, result.content);
  if (charge) spendRelateBudget(note.path);
  return { added: true };
}

const inboxRoute: ToolDef = {
  name: "inbox_route",
  description:
    "Move one line out of an inbox note into the note where it belongs. The destination is written and verified before the source line is removed, so the item can never be lost — at worst it is briefly in both places. Use task_add for items that are really tasks, then route nothing.",
  inputSchema: {
    type: "object",
    properties: {
      line: {
        type: "string",
        description: "Distinctive fragment of the inbox line to route. Must match exactly one line.",
      },
      destination_note: { type: "string", description: "Note name the item belongs in." },
      destination_section: {
        type: "string",
        description: "Heading in the destination to append under. Required when the destination has sections.",
      },
      content: {
        type: "string",
        description:
          "What to write at the destination. Defaults to the inbox line's own text, preserving the user's wording.",
      },
      source_note: {
        type: "string",
        description: 'Inbox to route out of. Defaults to "Inbox". Use "Knowledge Base/Inbox.md" for the KB inbox.',
      },
    },
    required: ["line", "destination_note"],
    additionalProperties: false,
  },
  handler: (args) => {
    const fragment = req(args, "line").trim();
    const source = resolveNote(str(args, "source_note") ?? "Inbox.md");
    const destination = resolveNote(req(args, "destination_note"));
    if (source.path === destination.path) {
      throw new ToolError(`source and destination are the same note (${source.path}).`);
    }

    const sourceRead = readNote(source);
    const sourceLines = sourceRead.content.split("\n");
    const needle = fragment.toLowerCase();
    const matches = sourceLines
      .map((text, index) => ({ text, index }))
      .filter((l) => l.text.trim() !== "" && !l.text.trimStart().startsWith("#"))
      .filter((l) => l.text.toLowerCase().includes(needle));
    if (matches.length === 0) {
      throw new ToolError(
        `no line in ${source.path} contains "${fragment}". Read the note first to get the exact wording.`,
      );
    }
    if (matches.length > 1) {
      throw new ToolError(
        `"${fragment}" matches ${matches.length} lines in ${source.path}: ${matches
          .map((m) => `"${m.text.trim()}"`)
          .join("; ")}. Pass a longer fragment.`,
      );
    }
    const match = matches[0];
    const payload = str(args, "content") ?? stripListMarker(match.text);

    // 1. Write the destination.
    const sectionName = str(args, "destination_section");
    const destRead = readNote(destination);
    let written: string;
    if (sectionName) {
      written = appendToSection(destRead.content, sectionName, payload, {
        notePath: destination.path,
      }).content;
    } else {
      const sections = listSections(destRead.content).filter((s) => s.level === 2);
      if (sections.length > 0) {
        throw new ToolError(
          `${destination.path} has sections, so destination_section is required; sections present: ${sections
            .map((s) => s.name)
            .join(", ")}.`,
        );
      }
      written = `${destRead.content.replace(/\s*$/, "")}\n${payload}\n`;
    }
    writeNoteGuarded(destination.path, destRead.mtimeMs, written);

    // 2. Verify it landed before touching the source.
    const verify = readNote(destination.path);
    if (!verify.content.includes(payload.trim())) {
      throw new ToolError(
        `wrote to ${destination.path} but could not find the routed text afterwards; ${source.path} was left untouched.`,
      );
    }

    // 3. Only now remove the source line.
    const fresh = readNote(source);
    const freshLines = fresh.content.split("\n");
    if (freshLines[match.index] !== match.text) {
      throw new ToolError(
        `the item was written to ${destination.path}, but ${source.path} changed meanwhile so the source line was left in place. Remove it on the next pass.`,
      );
    }
    freshLines.splice(match.index, 1);
    writeNoteGuarded(source.path, fresh.mtimeMs, freshLines.join("\n"));

    return {
      routed: true,
      from: source.path,
      to: destination.path,
      section: sectionName ?? null,
      removed_line: match.text.trim(),
      written: payload,
    };
  },
};

/** `- [ ] 2026-07-29: text` -> `2026-07-29: text`. Wording is otherwise kept. */
function stripListMarker(line: string): string {
  return line.trim().replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "");
}

const linkify: ToolDef = {
  name: "linkify",
  description:
    "Convert plain-text mentions of existing projects, people, knowledge notes, and ideas into wikilinks. Identical words, brackets only — it adds no text and decides nothing about whether two notes are related; use relate for that. Headings, code, URLs, frontmatter, and existing links are left alone, and only the first mention in a note is linked. Run with dry_run=true first to review what it would do.",
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", description: "Limit the pass to one note. Omit to run over the vault." },
      since: {
        type: "string",
        description: "YYYY-MM-DD. Only notes modified on or after this date. Ignored when note is set.",
      },
      dry_run: {
        type: "boolean",
        description: "true reports the links it would add and writes nothing. Default false.",
      },
      limit: { type: "number", description: "Maximum changes to list in the report. Default 100." },
    },
    additionalProperties: false,
  },
  handler: (args) => {
    const ref = str(args, "note");
    const since = str(args, "since");
    const dryRun = bool(args, "dry_run") ?? false;
    const limit = num(args, "limit") ?? 100;

    let targets = ref ? [resolveNote(ref)] : getIndex().notes;
    if (!ref && since) {
      assertDate(since, "since");
      const cutoff = new Date(`${since}T00:00:00`).getTime();
      targets = targets.filter((n) => n.mtimeMs >= cutoff);
    }

    const entities = buildEntities();
    const plan = planLinkify(targets, entities);
    const changes = plan.notes.flatMap((n) => n.changes);

    if (!dryRun) {
      for (const note of plan.notes) writeNoteGuarded(note.path, note.mtimeMs, note.content);
    }
    return {
      dry_run: dryRun,
      notes_scanned: plan.scanned,
      entities_considered: plan.entities,
      notes_changed: plan.notes.length,
      links_added: dryRun ? 0 : changes.length,
      ...truncation(changes.length, Math.min(changes.length, limit), "proposed links"),
      changes: changes.slice(0, limit),
    };
  },
};

export const TOOLS: ToolDef[] = [
  vaultStatus,
  vaultList,
  vaultRead,
  vaultSearch,
  vaultLinks,
  noteCreate,
  sectionAppend,
  taskAdd,
  taskUpdate,
  dailyLog,
  checklistSet,
  relate,
  inboxRoute,
  linkify,
  vaultSnapshot,
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
