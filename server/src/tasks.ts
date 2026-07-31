import { ToolError } from "./config.ts";
import { listSections, type Section } from "./sections.ts";

export const TASKS_FILE = "Tasks.md";
export const TASK_SECTIONS = ["Active", "Waiting On Me", "Waiting On Others", "Done"] as const;
export type TaskSection = (typeof TASK_SECTIONS)[number];

export const PRIORITIES = ["high", "medium", "low", "none"] as const;
export type Priority = (typeof PRIORITIES)[number];

const PRIORITY_MARKER: Record<Exclude<Priority, "none">, string> = {
  high: "⏫",
  medium: "🔼",
  low: "🔽",
};
const MARKER_PRIORITY: Record<string, Priority> = {
  "⏫": "high",
  "🔼": "medium",
  "🔽": "low",
};

export interface Task {
  /** Line index within Tasks.md. */
  line: number;
  raw: string;
  section: string;
  /** Leading whitespace, preserved so a sub-task stays a sub-task. */
  indent: string;
  done: boolean;
  text: string;
  project?: string;
  due?: string;
  priority: Priority;
  waitingOn?: string;
  waitingSince?: string;
  completed?: string;
  notes?: string;
}

const CHECKBOX_RE = /^(\s*)- \[( |x|X)\]\s+(.*)$/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const DONE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const WAITING_RE = /\(waiting on:\s*\[\[([^\]]+)\]\](?:\s*since\s*(\d{4}-\d{2}-\d{2}))?\)/i;
/**
 * The project link is the one in the project *slot* — trailing, after the text
 * and before the markers. Taking the first wikilink anywhere on the line pulled
 * `[[Jane Doe]]` out of "Ask [[Jane Doe]] about pricing" and re-emitted it at
 * the end, destroying the user's sentence and swapping the two links on every
 * subsequent edit.
 */
const TRAILING_LINK_RE = /\s*\[\[([^\][\n]+)\]\]\s*$/;
const NOTES_RE = /\s+—\s+(.*)$/;

/**
 * Parse one task line. Marker order in existing lines is inconsistent (some
 * pre-date the documented grammar), so markers are extracted positionally-
 * agnostically and re-emitted in documented order on any write.
 */
export function parseTaskLine(raw: string, line: number, section: string): Task | null {
  const match = CHECKBOX_RE.exec(raw);
  if (!match) return null;
  let rest = match[3];
  const done = match[2].toLowerCase() === "x";

  const notesMatch = NOTES_RE.exec(rest);
  const notes = notesMatch ? notesMatch[1].trim() : undefined;
  if (notesMatch) rest = rest.slice(0, notesMatch.index);

  const waitingMatch = WAITING_RE.exec(rest);
  const waitingOn = waitingMatch ? waitingMatch[1].split("|")[0].trim() : undefined;
  const waitingSince = waitingMatch ? waitingMatch[2] : undefined;
  if (waitingMatch) rest = rest.replace(WAITING_RE, " ");

  const dueMatch = DUE_RE.exec(rest);
  const due = dueMatch ? dueMatch[1] : undefined;
  if (dueMatch) rest = rest.replace(DUE_RE, " ");

  const completedMatch = DONE_RE.exec(rest);
  const completed = completedMatch ? completedMatch[1] : undefined;
  if (completedMatch) rest = rest.replace(DONE_RE, " ");

  let priority: Priority = "none";
  for (const [marker, name] of Object.entries(MARKER_PRIORITY)) {
    if (rest.includes(marker)) {
      priority = name;
      rest = rest.split(marker).join(" ");
    }
  }

  rest = rest.trimEnd();
  const linkMatch = TRAILING_LINK_RE.exec(rest);
  const project = linkMatch ? linkMatch[1].split("|")[0].trim() : undefined;
  if (linkMatch) rest = rest.slice(0, linkMatch.index);

  const text = rest.replace(/\s+/g, " ").trim();
  return {
    line,
    raw,
    section,
    indent: match[1],
    done,
    text,
    project,
    due,
    priority,
    waitingOn,
    waitingSince,
    completed,
    notes,
  };
}

/**
 * Compose a task line in the documented order:
 * `- [ ] text [[Project]] 📅 due <priority> (waiting on: [[Who]] since date) ✅ done — notes`
 */
export function composeTaskLine(task: Omit<Task, "line" | "raw" | "section" | "indent"> & { indent?: string }): string {
  const parts: string[] = [`${task.indent ?? ""}- [${task.done ? "x" : " "}]`, task.text.trim()];
  if (task.project) parts.push(`[[${task.project}]]`);
  if (task.due) parts.push(`📅 ${task.due}`);
  if (task.priority && task.priority !== "none") {
    parts.push(PRIORITY_MARKER[task.priority as Exclude<Priority, "none">]);
  }
  if (task.waitingOn) {
    parts.push(
      task.waitingSince
        ? `(waiting on: [[${task.waitingOn}]] since ${task.waitingSince})`
        : `(waiting on: [[${task.waitingOn}]])`,
    );
  }
  if (task.completed) parts.push(`✅ ${task.completed}`);
  let line = parts.join(" ");
  if (task.notes) line += ` — ${task.notes.trim()}`;
  return line;
}

export interface TasksDoc {
  lines: string[];
  sections: Map<string, Section>;
  tasks: Task[];
}

export function parseTasksDoc(content: string): TasksDoc {
  const lines = content.split("\n");
  const sections = new Map<string, Section>();
  for (const section of listSections(content)) {
    if (section.level === 2) sections.set(section.name.toLowerCase(), section);
  }
  const tasks: Task[] = [];
  for (const [, section] of sections) {
    for (let i = section.start; i < section.end; i++) {
      const task = parseTaskLine(lines[i], i, section.name);
      if (task) tasks.push(task);
    }
  }
  tasks.sort((a, b) => a.line - b.line);
  return { lines, sections, tasks };
}

export function requireTaskSection(doc: TasksDoc, name: string): Section {
  const section = doc.sections.get(name.toLowerCase());
  if (!section) {
    throw new ToolError(
      `section "${name}" not found in ${TASKS_FILE}; sections present: ${[...doc.sections.values()]
        .map((s) => s.name)
        .join(", ")}.`,
    );
  }
  return section;
}

export function normalizeTaskText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Conservative near-duplicate check: identical text, or one fully containing
 * the other. Completed tasks are ignored — a finished task no longer covers the
 * work, so re-adding a recurring one is legitimate.
 */
export function findDuplicate(tasks: Task[], text: string): Task | undefined {
  const needle = normalizeTaskText(text);
  if (!needle) return undefined;
  return tasks.filter((t) => !t.done).find((t) => {
    const other = normalizeTaskText(t.text);
    if (other === needle) return true;
    if (needle.length >= 16 && other.length >= 16) {
      return other.includes(needle) || needle.includes(other);
    }
    return false;
  });
}

/** Insert task lines at the end of a section, keeping section spacing intact. */
export function insertTaskLine(
  doc: TasksDoc,
  sectionName: string,
  line: string | string[],
): string[] {
  const payload = Array.isArray(line) ? line : [line];
  const section = requireTaskSection(doc, sectionName);
  const lines = [...doc.lines];
  let insertAt = section.start;
  for (let i = section.end - 1; i >= section.start; i--) {
    if (lines[i].trim() !== "") {
      insertAt = i + 1;
      break;
    }
  }
  const block =
    insertAt === section.start && lines[insertAt - 1]?.trim() !== "" ? ["", ...payload] : payload;
  lines.splice(insertAt, 0, ...block);
  return lines;
}

function indentWidth(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;
}

/**
 * Exclusive end of a task's block: the task line plus the run of more-indented
 * lines beneath it. Moving a single line left a completed parent's sub-items
 * behind in the old section, re-parented under whatever task happened to
 * precede them — a silent corruption the result object never mentioned.
 */
export function taskBlockEnd(lines: string[], fromLine: number): number {
  const base = indentWidth(lines[fromLine]);
  let end = fromLine + 1;
  while (end < lines.length && lines[end].trim() !== "" && indentWidth(lines[end]) > base) end++;
  return end;
}

/** Remove a task and its sub-items, and re-insert them in the target section. */
export function moveTaskLine(
  lines: string[],
  fromLine: number,
  newText: string,
  toSection: string | null,
): string[] {
  const next = [...lines];
  if (!toSection) {
    next[fromLine] = newText;
    return next;
  }
  const blockEnd = taskBlockEnd(next, fromLine);
  const children = next.slice(fromLine + 1, blockEnd);
  next.splice(fromLine, blockEnd - fromLine);
  const doc = parseTasksDoc(next.join("\n"));
  return insertTaskLine(doc, toSection, [newText, ...children]);
}
