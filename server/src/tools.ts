import { assertDate, config, localTimestamp, ToolError, today } from "./config.ts";
import { setChecklistItem } from "./checklist.ts";
import { parseNote } from "./frontmatter.ts";
import {
  ensureIgnoreList,
  IGNORED_FILE,
  IGNORED_SECTION,
  ignoredRows,
  plainText,
} from "./ignored.ts";
import { buildEntities, planLinkify } from "./linkify.ts";
import { buildGraph, candidateHistory, searchVault } from "./links.ts";
import {
  createNote,
  DAILY_SECTIONS,
  ensureDailyNote,
  NOTE_TYPES,
  setFrontmatterField,
  SETTABLE_FIELDS,
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
  clearWrittenPaths,
  findNote,
  getIndex,
  isTemplate,
  nearestTitles,
  readNote,
  resolveNote,
  wikilinkTarget,
  writeNoteGuarded,
  writtenPaths,
  type Note,
} from "./vault.ts";
import { gitDiagnosis, isDirty, snapshot, statusPorcelain } from "./git.ts";

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

/**
 * A limit is a count, so zero and negatives are not "just small". They flowed
 * into Array.slice and silently produced a short list that still reported
 * itself as complete — the exact wrong-conclusion failure `truncation()` exists
 * to prevent.
 */
function limitArg(args: Record<string, unknown>, fallback: number): number {
  const value = num(args, "limit");
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new ToolError(`limit must be a whole number of at least 1; got ${value}.`);
  }
  return value;
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
  if (!note.folder) return [];
  const template = getIndex().notes.find(
    (n) => n.folder === note.folder && isTemplate(n) && n.path !== note.path,
  );
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

/**
 * The one gate every mutating handler resolves through. Which notes may be
 * written at all is the *shape* of a write, so it lives here in code rather
 * than as a paragraph in each skill that the model has to remember — the whole
 * reason these tools exist.
 */
function resolveWritable(ref: string, options: { allowTasks?: boolean } = {}): Note {
  const note = resolveNote(ref);
  if (isTemplate(note)) {
    throw new ToolError(
      `"${note.path}" is a template — writing to it would contaminate every note later created from it. Create the real note with note_create first, then write to that.`,
    );
  }
  if (!options.allowTasks && note.path === TASKS_FILE) {
    throw new ToolError(
      `${TASKS_FILE} has a positional grammar and is owned by task_add and task_update; a line written into it directly is not a task those tools can parse or move. Use task_add to add a task, or task_update to change one.`,
    );
  }
  return note;
}

// ---------------------------------------------------------------------- tools

const vaultStatus: ToolDef = {
  name: "vault_status",
  description:
    "Vault orientation in one call: today's local date, git dirty state, note counts by type, latest synthesis and daily note, unresolved/orphan link counts, and notes changed in the last 24 hours. Call this first in any standup or nightly run instead of exploring the vault by hand. git_error is non-null when git is enabled but unusable — snapshots will fail until it is fixed.",
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
      (n) => (graph.incoming.get(n.path) ?? []).length === 0 && !isTemplate(n),
    );
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const changed = idx.notes.filter((n) => n.mtimeMs >= cutoff).map((n) => n.path);
    const gitError = gitDiagnosis();
    const usable = cfg.gitEnabled && gitError === null;
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
      // Retired candidates are withheld from unresolved but never from the
      // count: a suppression the caller cannot see is a suppression it cannot
      // audit. `vault_links direction="ignored"` lists them.
      ignored_count: graph.ignored.size,
      orphan_count: orphans.length,
      changed_last_24h: changed,
      git_enabled: cfg.gitEnabled,
      // "off" and "on but broken" both used to report git_dirty: null, which
      // reads exactly like a healthy clean vault. git_error separates them.
      git_error: gitError,
      git_dirty: usable ? isDirty() : null,
      git_dirty_files: usable ? statusPorcelain() : [],
    };
  },
};

const vaultList: ToolDef = {
  name: "vault_list",
  description:
    "List notes, filtered by frontmatter type, top-level folder, frontmatter status, or modification date. Template notes are excluded unless include_templates=true. Set latest=true to get only the newest date-named note in a folder (use this instead of listing a folder and eyeballing the max filename).",
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
      include_templates: {
        type: "boolean",
        description:
          "Include template notes. Default false — a template carries the same type and status as the real notes it seeds, so it otherwise shows up as, say, an Active project.",
      },
      limit: { type: "number", minimum: 1, description: "Maximum notes to return. Default 100." },
    },
    additionalProperties: false,
  },
  handler: (args) => {
    const type = str(args, "type");
    const folder = str(args, "folder");
    const status = str(args, "status");
    const changedSince = str(args, "changed_since");
    const latest = bool(args, "latest");
    const limit = limitArg(args, 100);

    let notes = getIndex().notes;
    if (!(bool(args, "include_templates") ?? false)) notes = notes.filter((n) => !isTemplate(n));
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
        minimum: 1,
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
      limit: limitArg(args, 20),
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

const DIRECTIONS = ["in", "out", "unresolved", "ignored", "orphans", "deadends"] as const;

const vaultLinks: ToolDef = {
  name: "vault_links",
  description:
    "Inspect the wikilink graph. direction=in gives backlinks to a note, out gives its outgoing links, unresolved lists link targets with no note, ignored lists targets retired via link_ignore, orphans lists notes nothing links to, deadends lists notes that link to nothing. note is required for in and out only. unresolved and ignored carry times_surfaced — how many synthesis notes have already proposed that target — so you never have to count past reports yourself.",
  inputSchema: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: [...DIRECTIONS],
        description: "Which relationship to report.",
      },
      note: { type: "string", description: "Note name. Required when direction is in or out." },
      limit: { type: "number", minimum: 1, description: "Maximum entries to return. Default 100." },
    },
    required: ["direction"],
    additionalProperties: false,
  },
  handler: (args) => {
    const direction = enumArg(args, "direction", DIRECTIONS, true)!;
    const limit = limitArg(args, 100);
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
    if (direction === "unresolved" || direction === "ignored") {
      const source = direction === "unresolved" ? graph.unresolved : graph.ignored;
      const surfaced = candidateHistory(source.keys());
      const entries = [...source.entries()].map(([target, sources]) => ({
        target,
        linked_from: sources,
        // How many synthesis notes have already proposed this. The nightly used
        // to reconstruct this by hand and got it wrong; now it reads the number.
        times_surfaced: surfaced.get(target) ?? 0,
      }));
      entries.sort((a, b) => b.times_surfaced - a.times_surfaced);
      return {
        direction,
        ...truncation(entries.length, Math.min(entries.length, limit), `${direction} targets`),
        ...(direction === "unresolved" ? { ignored_excluded: graph.ignored.size } : {}),
        [direction]: entries.slice(0, limit),
      };
    }
    const notes = getIndex().notes.filter((n) => !isTemplate(n));
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
    "Append content at the end of a named section of a note — never at the end of the file. If the section holds a markdown table the content must be a pipe-delimited row and is appended as a row. Repeats are skipped by default, so re-running is safe. Use keep_newest to cap a bounded log at N entries.",
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
      keep_newest: {
        type: "number",
        minimum: 1,
        description:
          "Cap the section at this many entries, dropping the oldest. For bounded logs like a review log. Omit to keep everything — most sections are history and should grow.",
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
    const keepNewest = num(args, "keep_newest");
    if (keepNewest !== undefined && (!Number.isInteger(keepNewest) || keepNewest < 1)) {
      throw new ToolError(`keep_newest must be a whole number of at least 1; got ${keepNewest}.`);
    }

    const note = resolveWritable(ref);
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
      keepNewest,
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
    .notes.filter((n) => n.type === "project" && !isTemplate(n))
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
    const text = assertPlainTaskText(req(args, "text"));
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

/**
 * `text` is the task's wording, not a task line. Accepting a pasted line meant
 * composeTaskLine prefixed a second checkbox, and any due date or priority
 * inside the text stayed there instead of populating the fields — so dedupe,
 * nudging, and every later recompose operated on the wrong data. This is the
 * class of rule a prose instruction cannot enforce.
 */
function assertPlainTaskText(text: string): string {
  if (/^\s*[-*+]\s*\[[ xX]\]/.test(text)) {
    throw new ToolError(
      `text must be the task's wording only, not a whole task line; got "${text}". Drop the leading "- [ ]" — the server composes the line.`,
    );
  }
  const marker = /[\u{1F4C5}\u{2705}\u{23EB}\u{1F53C}\u{1F53D}]/u.exec(text);
  if (marker) {
    throw new ToolError(
      `text must not contain task markers; found "${marker[0]}" in "${text}". Pass the date as due="YYYY-MM-DD" and the priority as priority="high|medium|low" instead.`,
    );
  }
  return text.trim();
}

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

    if (has(args, "text")) {
      const replacement = assertPlainTaskText(req(args, "text"));
      // task_add refuses to create a near-duplicate; rewording one task into
      // another's wording produced the same collision by the back door, and
      // left both tasks unaddressable by any match fragment afterwards.
      const clash = findDuplicate(
        doc.tasks.filter((t) => t.line !== task.line),
        replacement,
      );
      if (clash) {
        throw new ToolError(
          `that wording duplicates an existing task in "${clash.section}": "${clash.raw.trim()}". Pick wording that distinguishes them, or complete one with done=true.`,
        );
      }
      next.text = replacement;
    }
    if (has(args, "project")) {
      const value = str(args, "project");
      next.project = value ? resolveProject(value) : undefined;
    }
    if (has(args, "due")) {
      const value = str(args, "due");
      next.due = value ? assertDate(value, "due") : undefined;
    }
    if (has(args, "priority")) next.priority = enumArg(args, "priority", PRIORITIES)!;
    if (has(args, "waiting_on")) {
      const value = str(args, "waiting_on");
      next.waitingOn = value ? resolveWaitingPerson(value) : undefined;
      if (!value) next.waitingSince = undefined;
      else {
        const since = str(args, "waiting_since");
        next.waitingSince = since
          ? assertDate(since, "waiting_since")
          : (next.waitingSince ?? today());
      }
    } else if (has(args, "waiting_since")) {
      next.waitingSince = assertDate(req(args, "waiting_since"), "waiting_since");
    }
    if (has(args, "notes")) {
      const value = str(args, "notes");
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

const SNAPSHOT_SCOPES = ["machine", "all"] as const;

const vaultSnapshot: ToolDef = {
  name: "vault_snapshot",
  description:
    'Commit the vault to git with a label. scope="machine" (the default) commits only the notes this server has written since the last snapshot, so the pass is revertible without discarding edits you made in Obsidian yourself. scope="all" commits everything currently uncommitted — use it once before an automated pass to park your own in-progress edits in their own commit. A clean vault is success, not an error.',
  inputSchema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: 'Commit message, e.g. "nightly consolidation 2026-07-31 (pre)".',
      },
      scope: {
        type: "string",
        enum: [...SNAPSHOT_SCOPES],
        description:
          'machine: only notes written by this server since the last snapshot. all: every uncommitted change in the vault, including your own. Default machine.',
      },
    },
    required: ["label"],
    additionalProperties: false,
  },
  handler: (args) => {
    const scope = enumArg(args, "scope", SNAPSHOT_SCOPES) ?? "machine";
    const result = snapshot(req(args, "label"), scope === "machine" ? writtenPaths() : undefined);
    // Either way the machine's outstanding work is now committed; anything
    // still dirty belongs to the user.
    clearWrittenPaths();
    return { ...result, scope };
  },
};

// ------------------------------------------------------------------- capture

const noteCreate: ToolDef = {
  name: "note_create",
  description:
    "Create a new note of a given type. The server derives the folder and filename from type plus name, emits the required frontmatter, and lays out the standard sections — never construct a path or write frontmatter by hand. Fill the sections afterwards with section_append. An existing note is never overwritten: the call succeeds with created=false and a reason, and you should append to it with section_append instead.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...NOTE_TYPES],
        description:
          "project -> Projects/X/X.md; person -> People/First Last.md; meeting -> the project's Meeting Notes folder; doc -> the project's Docs folder, for drafts, research, and references; daily -> Daily/DATE.md; synthesis -> Syntheses/DATE.md; knowledge and moc -> Knowledge Base/TOPIC/; shopping -> Shopping/Store.md; idea -> Ideas/X.md; index -> a folder's own README, e.g. name=\"Knowledge Base\" gives Knowledge Base/README.md.",
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
    assertApplicableArgs(type, args);
    const result = createNote({
      type,
      name: str(args, "name"),
      project: str(args, "project"),
      date: str(args, "date"),
      topic: str(args, "topic"),
      fields: flatMap(args, "fields"),
      body: str(args, "body"),
    });
    // A collision is a result, not a failure — the description tells the model
    // to branch on `created`, and an isError response never reaches that branch.
    return result;
  },
};

/** Which of the placement arguments each note type actually reads. */
const APPLICABLE_ARGS: Record<NoteType, readonly string[]> = {
  project: ["name"],
  person: ["name"],
  meeting: ["name", "project", "date"],
  doc: ["name", "project"],
  daily: ["date"],
  synthesis: ["date"],
  knowledge: ["name", "topic"],
  moc: ["topic"],
  shopping: ["name"],
  idea: ["name"],
  index: ["name"],
};

const ARG_HINT: Record<string, string> = {
  name: 'a moc is titled after its topic (e.g. "Cycling MOC"), and daily and synthesis notes are titled by date. Use type="knowledge" if you meant a note with its own name',
  project: "only meeting and doc notes live inside a project folder",
  date: "only daily, synthesis, and meeting notes are placed by date",
  topic: "only knowledge and moc notes live under a Knowledge Base topic",
};

/**
 * An argument the chosen type ignores is a misunderstanding, not a no-op.
 * `note_create type="moc" name="Cycling Overview"` silently produced a note
 * titled "Cycling MOC", and the model then wrote a wikilink to a title that
 * never existed.
 */
function assertApplicableArgs(type: NoteType, args: Record<string, unknown>): void {
  const accepted = APPLICABLE_ARGS[type];
  for (const key of ["name", "project", "date", "topic"]) {
    if (accepted.includes(key)) continue;
    if (str(args, key) === undefined) continue;
    throw new ToolError(
      `note_create type="${type}" does not use ${key} — ${ARG_HINT[key]}. Remove ${key} and call again.`,
    );
  }
}

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
    const value = String(v);
    // A newline inside a frontmatter value closes the block early and spills
    // the remainder into the body, above the title.
    if (/[\r\n]/.test(value)) {
      throw new ToolError(
        `${key}.${k} must be a single line — a line break would end the frontmatter block early. Put multi-line prose in body instead.`,
      );
    }
    out[k] = value;
  }
  return out;
}

const dailyLog: ToolDef = {
  name: "daily_log",
  description:
    "Add an entry to the personal daily journal, creating Daily/DATE.md from the template if it does not exist. Repeats of the same text in the same section are skipped unless dedupe=false. The daily note is a diary — mood, weather, exercise, media, food, purchases, stray thoughts. Project facts, decisions, meeting notes, and follow-ups do not belong here: route those to section_append on the project note and to task_add. Feelings about a project are journal; the facts about it are not.",
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
      dedupe: {
        type: "boolean",
        description:
          "Skip the entry if the same text is already in that section today. Default true. Set false to log something that genuinely happened twice.",
      },
    },
    required: ["section", "content"],
    additionalProperties: false,
  },
  handler: (args) => {
    const section = enumArg(args, "section", DAILY_SECTIONS, true)!;
    const content = req(args, "content");
    const dedupe = bool(args, "dedupe") ?? true;
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
    const result = appendToSection(working, section, content, { dedupe, notePath: note.path });
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
    const note = resolveWritable(req(args, "note"));
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
    " new links per note per day; a mirrored link counts against the target's cap too, and is skipped once the target is full.",
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
    const note = resolveWritable(req(args, "note"));
    // The target is only written when mirroring, so it is guarded only then —
    // linking *to* Tasks.md from another note's ## Related is harmless.
    const target = resolveNote(req(args, "target"));
    const reason = req(args, "reason").trim();
    const mirror = bool(args, "mirror") ?? false;
    if (mirror) resolveWritable(target.path);

    if (note.path === target.path) {
      throw new ToolError(`"${note.title}" cannot be related to itself.`);
    }
    if (reason.replace(/\s/g, "").length < 8) {
      throw new ToolError(
        `reason is too short to be useful ("${reason}"). Say in one line what connects ${note.title} and ${target.title}.`,
      );
    }

    const added = addRelated(note, target, reason);
    const result: Record<string, unknown> = {
      note: note.path,
      target: target.title,
      added: added.added,
      remaining_today: relateBudgetRemaining(note.path),
      ...(added.reason ? { reason_skipped: added.reason } : {}),
    };
    if (mirror) {
      // The mirror is a real link the target has to carry, so it spends the
      // target's budget too. Exempting it meant a hub note could take an
      // unbounded number of inbound links in one unattended pass — the exact
      // bulk-linking the cap exists to prevent.
      if (relateBudgetRemaining(target.path) <= 0) {
        result.mirrored = false;
        result.mirror_skipped = `"${target.path}" has already taken its ${RELATE_CAP} related links today`;
      } else {
        const back = addRelated(target, note, reason);
        result.mirrored = back.added;
        if (back.reason) result.mirror_skipped = back.reason;
      }
    }
    return result;
  },
};

function addRelated(
  note: Note,
  target: Note,
  reason: string,
): { added: boolean; reason?: string } {
  const current = readNote(note);
  // Compare by resolved note, not by link text: the same target may already be
  // listed in either the bare or the disambiguated form, and a string compare
  // would miss it and append a duplicate.
  const existing = new Set<string>();
  for (const ref of relatedTargets(current.content)) {
    const found = findNoteSafe(ref);
    existing.add((found ? found.path : ref).toLowerCase());
  }
  if (existing.has(target.path.toLowerCase()) || existing.has(target.title.toLowerCase())) {
    return {
      added: false,
      reason: `[[${target.title}]] is already listed under ## ${RELATED_SECTION}`,
    };
  }
  if (relateBudgetRemaining(note.path) <= 0) {
    throw new ToolError(
      `"${note.path}" has already taken its ${RELATE_CAP} new related links today. Stop adding links to this note; keep the strongest remaining connection for tomorrow.`,
    );
  }
  let working = current.content;
  if (!findSection(working, RELATED_SECTION)) {
    working = insertSection(working, RELATED_SECTION, templateOrder(note));
  }
  const result = appendToSection(
    working,
    RELATED_SECTION,
    relatedLine(wikilinkTarget(target), reason),
    { notePath: note.path },
  );
  writeNoteGuarded(note.path, current.mtimeMs, result.content);
  spendRelateBudget(note.path);
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
    const source = resolveWritable(str(args, "source_note") ?? "Inbox.md");
    const destination = resolveWritable(req(args, "destination_note"));
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
      limit: { type: "number", minimum: 1, description: "Maximum changes to list in the report. Default 100." },
    },
    additionalProperties: false,
  },
  handler: (args) => {
    const ref = str(args, "note");
    const since = str(args, "since");
    const dryRun = bool(args, "dry_run") ?? false;
    const limit = limitArg(args, 100);

    let targets = ref ? [resolveNote(ref)] : getIndex().notes;
    if (!ref && since) {
      assertDate(since, "since");
      const cutoff = new Date(`${since}T00:00:00`).getTime();
      targets = targets.filter((n) => n.mtimeMs >= cutoff);
    }

    const entities = buildEntities();
    const plan = planLinkify(targets, entities);
    const changes = plan.notes.flatMap((n) => n.changes);

    // Write per note and keep going. A bare loop that threw partway through
    // left earlier notes written, returned nothing, and surfaced a raw
    // filesystem error — so the nightly summary under-reported changes that
    // were actually in the vault. linkify is idempotent, so a retry is safe;
    // what the caller needs is to know which notes did not land.
    const written: string[] = [];
    const failed: { note: string; error: string }[] = [];
    if (!dryRun) {
      for (const note of plan.notes) {
        try {
          writeNoteGuarded(note.path, note.mtimeMs, note.content);
          written.push(note.path);
        } catch (error) {
          failed.push({ note: note.path, error: (error as Error).message });
        }
      }
    }
    const applied = dryRun
      ? []
      : changes.filter((c) => written.includes(c.note));
    return {
      dry_run: dryRun,
      notes_scanned: plan.scanned,
      entities_considered: plan.entities,
      notes_changed: dryRun ? plan.notes.length : written.length,
      links_added: applied.length,
      ...(failed.length
        ? {
            notes_failed: failed,
            note: `${failed.length} note(s) could not be written and were left unchanged; the rest were applied. linkify is idempotent — call it again to retry.`,
          }
        : {}),
      ...truncation(changes.length, Math.min(changes.length, limit), "proposed links"),
      changes: changes.slice(0, limit),
    };
  },
};

const noteSetField: ToolDef = {
  name: "note_set_field",
  description:
    "Change one frontmatter field on an existing note — a project's status, a person's role, a note's topics. Which value is right is your call; the server writes the YAML correctly, quoting wikilink lists so Obsidian still counts them as graph edges. Pass an empty value to remove the field. Only these fields can be set: " +
    SETTABLE_FIELDS.join(", ") +
    ". type, created, date, project, and topic decide where the note lives and cannot be changed this way.",
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", description: "Note name or vault-relative path." },
      field: {
        type: "string",
        enum: [...SETTABLE_FIELDS],
        description: "Frontmatter key to set.",
      },
      value: {
        type: "string",
        description:
          'New value. For people and projects, a comma-separated list of note names — they become quoted wikilinks. For topics, aliases, and tags, a comma-separated plain list. Empty string removes the field.',
      },
    },
    required: ["note", "field", "value"],
    additionalProperties: false,
  },
  handler: (args) => {
    const note = resolveWritable(req(args, "note"));
    const field = enumArg(args, "field", SETTABLE_FIELDS, true)!;
    const raw = str(args, "value");
    const current = readNote(note);
    const edit = setFrontmatterField(current.content, field, raw ?? null);
    if (!edit.changed) {
      return { path: note.path, field, changed: false, reason: "already set to that value" };
    }
    writeNoteGuarded(note.path, current.mtimeMs, edit.content);
    return {
      path: note.path,
      field,
      changed: true,
      before: edit.before ?? null,
      cleared: raw === undefined,
    };
  },
};

const STANDUP_FILE = "Standup.md";

const standupWrite: ToolDef = {
  name: "standup_write",
  description:
    "Replace the body of Standup.md with today's standup. This is the one note in the vault that is regenerated rather than appended to — it is derived from the projects, tasks, and people notes, so yesterday's copy is not history worth keeping. Frontmatter is preserved. Nothing else in the vault can be replaced this way.",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description:
          "The standup body in markdown, below the title. Sections and wording are yours to decide.",
      },
      date: { type: "string", description: "YYYY-MM-DD. Defaults to today in the vault's timezone." },
    },
    required: ["content"],
    additionalProperties: false,
  },
  handler: (args) => {
    const body = req(args, "content").trim();
    const date = str(args, "date") ? assertDate(req(args, "date"), "date") : today();
    const note = resolveNote(STANDUP_FILE);
    const current = readNote(note);
    const parsed = parseNote(current.content);
    // The note keeps a frontmatter block even though it is regenerated: without
    // one it is untyped, so every `type=`-filtered query stops seeing it. A
    // whole-file write from outside the tool surface is what stripped it before.
    let next = `---\n${parsed.raw ? `${parsed.raw}\n` : ""}---\n\n# Standup — ${date}\n\n${body}\n`;
    for (const [key, value] of [
      ["type", "standup"],
      ["generated", localTimestamp()],
      ["tz", config().timezone],
    ] as const) {
      next = setFrontmatterField(next, key, value).content;
    }
    if (next === current.content) {
      return { path: note.path, date, replaced: false, reason: "already identical" };
    }
    writeNoteGuarded(note.path, current.mtimeMs, next);
    return { path: note.path, date, replaced: true, bytes: next.length };
  },
};

const inboxClear: ToolDef = {
  name: "inbox_clear",
  description:
    "Remove one line from an inbox note after it has already been captured elsewhere. captured_as must name the note the item now lives in, and that note must exist — this is the only tool that removes a line, and it will not do so on your say-so alone. Use inbox_route when the item still needs writing somewhere; use this only when task_add or note_create has already taken it.",
  inputSchema: {
    type: "object",
    properties: {
      line: {
        type: "string",
        description: "Distinctive fragment of the inbox line to remove. Must match exactly one line.",
      },
      captured_as: {
        type: "string",
        description:
          'The existing note this item was captured into, e.g. "Tasks" after task_add, or the knowledge note you just created.',
      },
      source_note: {
        type: "string",
        description: 'Inbox to clear from. Defaults to "Inbox". Use "Knowledge Base/Inbox.md" for the KB inbox.',
      },
    },
    required: ["line", "captured_as"],
    additionalProperties: false,
  },
  handler: (args) => {
    const fragment = req(args, "line").trim();
    const source = resolveNote(str(args, "source_note") ?? "Inbox.md");
    // Bounded to inboxes on purpose: "remove a line" is safe only where the
    // note is a queue whose whole purpose is to be emptied.
    if (source.title.toLowerCase() !== "inbox") {
      throw new ToolError(
        `inbox_clear only clears inbox notes; "${source.path}" is not one. Nothing else in the vault removes lines.`,
      );
    }
    const captured = resolveNote(req(args, "captured_as"));
    if (captured.path === source.path) {
      throw new ToolError(`captured_as must be the note the item moved to, not ${source.path} itself.`);
    }

    const current = readNote(source);
    const lines = current.content.split("\n");
    const needle = fragment.toLowerCase();
    const matches = lines
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
    lines.splice(match.index, 1);
    writeNoteGuarded(source.path, current.mtimeMs, lines.join("\n"));
    return {
      cleared: true,
      from: source.path,
      captured_as: captured.path,
      removed_line: match.text.trim(),
    };
  },
};

const linkIgnore: ToolDef = {
  name: "link_ignore",
  description:
    "Retire an unresolved link target so it stops being proposed as a candidate — a name that is never going to be a note, like an operating system or a card name inside a deck description. Whether a name is worth a note is your call; the server only remembers the decision. Appending the same target twice changes nothing. Nothing is deleted: to reconsider one, the user removes its row from Ignored Links.md.",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: 'The unresolved link text, exactly as vault_links reports it, e.g. "Frobnix".',
      },
      reason: {
        type: "string",
        description:
          'Why this will never be a note, in your own words, e.g. "product name quoted from a receipt, not a topic the user tracks".',
      },
    },
    required: ["target", "reason"],
    additionalProperties: false,
  },
  handler: (args) => {
    const target = plainText(req(args, "target"));
    const reason = plainText(req(args, "reason"));
    if (!target) throw new ToolError("target is empty after stripping link brackets.");
    if (!reason) throw new ToolError("reason is empty; say why this will never be a note.");

    // Ignoring is for names with no note. A name that resolves is already
    // answered, and retiring it would hide a real edge rather than a phantom.
    const existing = findNoteSafe(target);
    if (existing) {
      throw new ToolError(
        `"${target}" already resolves to ${existing.path}, so it is not an unresolved candidate. link_ignore is for names that will never become notes.`,
      );
    }
    if (ignoredRows().some((r) => r.target.toLowerCase() === target.toLowerCase())) {
      return { path: IGNORED_FILE, target, added: false, reason: "already ignored" };
    }

    ensureIgnoreList();
    const note = resolveNote(IGNORED_FILE);
    const current = readNote(note);
    const result = appendToSection(
      current.content,
      IGNORED_SECTION,
      `| ${target} | ${reason} | ${today()} |`,
      { dedupe: true, notePath: note.path },
    );
    if (!result.changed) {
      return { path: note.path, target, added: false, reason: result.reason };
    }
    writeNoteGuarded(note.path, current.mtimeMs, result.content);
    return { path: note.path, target, added: true, ignored_total: ignoredRows().length };
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
  linkIgnore,
  inboxRoute,
  linkify,
  noteSetField,
  standupWrite,
  inboxClear,
  vaultSnapshot,
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
