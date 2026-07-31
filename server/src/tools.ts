import { assertDate, config, ToolError, today } from "./config.ts";
import { parseNote } from "./frontmatter.ts";
import { buildGraph, searchVault } from "./links.ts";
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
      count: notes.length,
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
      limit: { type: "number", description: "Maximum notes to return. Default 20." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: (args) => {
    const hits = searchVault(req(args, "query"), {
      type: str(args, "type"),
      folder: str(args, "folder"),
      limit: num(args, "limit") ?? 20,
    });
    return { count: hits.length, results: hits };
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
      return { note: note.path, direction, count: links.length, links: links.slice(0, limit) };
    }
    if (direction === "unresolved") {
      const entries = [...graph.unresolved.entries()].map(([target, sources]) => ({
        target,
        linked_from: sources,
      }));
      return { direction, count: entries.length, unresolved: entries.slice(0, limit) };
    }
    const notes = getIndex().notes.filter((n) => !n.path.endsWith("Template.md"));
    const list =
      direction === "orphans"
        ? notes.filter((n) => (graph.incoming.get(n.path) ?? []).length === 0)
        : notes.filter((n) => (graph.out.get(n.path) ?? []).length === 0);
    return { direction, count: list.length, notes: list.slice(0, limit).map((n) => n.path) };
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

export const TOOLS: ToolDef[] = [
  vaultStatus,
  vaultList,
  vaultRead,
  vaultSearch,
  vaultLinks,
  sectionAppend,
  taskAdd,
  taskUpdate,
  vaultSnapshot,
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
