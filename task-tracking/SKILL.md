---
name: task-tracking
description: >
  Manage centralized checkbox tasks in the Obsidian vault's Tasks.md: add,
  update, and complete tasks with due dates, priorities, waiting states, and
  project wikilinks. Use for anything actionable with an owner or deadline.
  NOT for: project status changes (project-tracking), store shopping items
  (shopping-list), or idea capture (idea-pipeline).
---

# Task Tracking

Manage centralized tasks in the user's Obsidian second brain. Use `second-brain` for shared vault conventions and `project-tracking` when project state must be created or changed.

## Data Source

- Vault config (name, path, CLI binary, timezone): see `second-brain` -> Vault. Examples assume vault name `Obsidian Vault`.
- Task file: `Tasks.md`
- Project files: `Projects/[Project Name]/[Project Name].md`
- The CLI understands checkbox tasks natively: `tasks`, `tasks todo`, `tasks done`, `task ref=<path:line> done`.

## Tasks.md Structure

Tasks are markdown checkboxes (not tables) so Obsidian and the CLI can query them and so project links are real wikilinks.

```markdown
---
type: index
created: YYYY-MM-DD
---

# Tasks

## Active

- [ ] Task text [[Project Name]] 📅 2026-07-10 ⏫ — optional notes

## Waiting On Me

- [ ] Task text [[Project Name]] — what the user owes and to whom

## Waiting On Others

- [ ] Task text [[Project Name]] (waiting on: [[First Last]] since YYYY-MM-DD)

## Done

- [x] Task text [[Project Name]] ✅ YYYY-MM-DD
```

Line format, in order:

1. Checkbox and task text (preserve the user's wording, keep it actionable).
2. `[[Project Name]]` wikilink when the task belongs to a project. Omit for standalone tasks.
3. `📅 YYYY-MM-DD` due date, when known.
4. Priority: `⏫` high, `🔼` medium, `🔽` low; omit for normal.
5. `(waiting on: [[First Last]] since YYYY-MM-DD)` for Waiting On Others.
6. `✅ YYYY-MM-DD` completion date on done tasks.
7. `— notes` after an em-dash for anything else.

These markers are compatible with the Obsidian Tasks plugin but do not require it.

## Workflow

When adding a task:

1. Read `Tasks.md`.
2. Check for an existing task covering the same work; if a near-duplicate exists, update that line instead of adding a second one.
3. Determine the correct section: `Active`, `Waiting On Me`, or `Waiting On Others`.
4. Write the task line per the format above. Only include due date, priority, project, and notes when known.
5. If a project is named, match it to an existing `Projects/[Project Name]/[Project Name].md` and use the exact name in the wikilink.
6. Add a related task reference to the project note's `## Related Tasks` when the task belongs to a project and the project exists.

When updating a task:

1. Locate the task by exact text or the closest unambiguous match (`tasks todo verbose` gives file/line refs).
2. Update due date, priority, project link, waiting person, or notes as requested.
3. Move the line to the appropriate section if the status or waiting state changes.
4. On completion, mark `[x]`, append `✅ YYYY-MM-DD` (local date), and move it to `## Done`.
5. If the task update changes project context, update `## Related Tasks` in the project note or call out the needed project update.

## Task-Project Relationship

- Treat `Tasks.md` as the source of task state.
- Treat `Projects/[Project Name]/[Project Name].md` as the source of project state.
- The task's project wikilink must exactly match the project note name.
- If a task belongs to a project, add or preserve a concise reference under that project's `## Related Tasks`.
- Do not duplicate project status in task notes unless it is necessary context.
- Do not create a new project just because a task mentions a possible project name unless the user clearly wants it tracked as a project.
- Do not mark a project `Done`, `Blocked`, or `On Hold` only because a task changed; route explicit project state changes to `project-tracking`.
- If task state and project state conflict, preserve source data and surface the inconsistency.

## Due Dates and Waiting States

- Parse dates relative to the local timezone (see `second-brain` vault config).
- Put tasks assigned to the user or requiring the user's action in `Active` or `Waiting On Me` depending on wording.
- Put tasks blocked by someone else in `Waiting On Others` with the person's wikilink in the `(waiting on: ...)` marker.
- Preserve unclear dates as `— notes` rather than inventing a date.

## Nudging Logic

Use this logic when asked to review or when another skill needs task signals:

- Overdue: `📅` date before today and task not `[x]`.
- Due soon: due in the next 3-5 days.
- Idle: active task with no visible update for more than 7 days — judged only from dated evidence (due dates, `since` dates, completion dates, dated notes). Skip idle detection for items with no dates; do not guess.
- Waiting on others: waiting for more than 5 days per the `since` date.

Do not nudge the same item twice in less than 48 hours if prior nudge data is available.

## Safety

- Do not silently delete tasks.
- Do not infer completion from conversational optimism; require explicit completion language.
- Ask or capture to `Inbox.md` when a task has multiple plausible projects or owners.
