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

## Tools

`Tasks.md` has a positional grammar, so it is owned by two tools and nothing else can write to it — `obsidian__section_append` on `Tasks` is refused with an error saying so.

| Need | Call |
|---|---|
| Add a task | `obsidian__task_add text="…"` |
| Change, move, or complete a task | `obsidian__task_update match="…"` |
| See the current list | `obsidian__vault_read note="Tasks"` |
| See one section | `obsidian__vault_read note="Tasks" section="Waiting On Others"` |

`obsidian__task_add` composes the line, files it in the right section, and rejects a near-duplicate of an existing task. `obsidian__task_update` finds the task by a distinctive fragment of its text, recomposes the whole line, and moves it between sections — including any sub-items nested under it.

Pass the parts as arguments; never assemble a task line yourself. `text` is the user's wording only: a leading `- [ ]`, a `📅` date, or a `⏫` priority inside `text` is refused, because those belong in the `due` and `priority` arguments where the tools can read them.

## Adding a Task

```
obsidian__task_add text="Send the revised proposal" project="Wayfinder" due="2026-08-04" priority="high"
```

- `project` must be the exact name of an existing project note. A project with no note is refused rather than written as a dangling link; the error lists the projects that do exist.
- `section` defaults to `Active`, or to `Waiting On Others` when `waiting_on` is set. Use `Waiting On Me` when the user owes someone something.
- `waiting_on` takes a person's note name and files the task under `Waiting On Others` with a dated marker. `waiting_since` defaults to today.
- `notes` is a short trailing note for anything that does not fit the other fields — including a date the user was vague about. Never invent a date to fill `due`.

If the task covers work an open task already covers, `obsidian__task_add` refuses and names the existing task. Update that one instead of adding a second line.

Then, when the task belongs to an existing project, record it on the project note:

```
obsidian__section_append note="Wayfinder" section="Related Tasks" content="- Send the revised proposal"
```

## Updating a Task

```
obsidian__task_update match="revised proposal" due="2026-08-06" priority="medium"
```

- `match` is a distinctive fragment of the existing task text and must identify exactly one task. If it matches several, the error lists them; pass a longer fragment.
- `done=true` checks the box, stamps the completion date, and moves the task to `## Done`. `done=false` reopens it.
- `section` moves the task explicitly. Sub-items indented under a task move with it.
- An empty string clears `project`, `due`, `waiting_on`, or `notes`. `priority="none"` clears the priority.
- Rewording a task into an existing task's wording is refused, for the same reason a duplicate add is.

## Task-Project Relationship

- `Tasks.md` is the source of task state. `Projects/[Project Name]/[Project Name].md` is the source of project state.
- When a task belongs to a project, keep a concise reference under that project's `## Related Tasks`.
- Do not duplicate project status in task notes unless it is necessary context.
- Do not create a project because a task mentions a possible project name, unless the user clearly wants it tracked as one.
- Do not mark a project `Done`, `Blocked`, or `On Hold` because a task changed. Route explicit project state changes to `project-tracking`.
- If task state and project state conflict, preserve both and surface the inconsistency rather than reconciling it yourself.

## Due Dates and Waiting States

- Resolve relative dates ("friday", "end of month") against the vault's local timezone before calling; the tools take exact `YYYY-MM-DD` and refuse anything else, including impossible dates like `2026-02-31`.
- Tasks needing the user's action go in `Active`, or `Waiting On Me` when the user owes it to someone specific.
- Tasks blocked by someone else go in `Waiting On Others` via `waiting_on`.
- Preserve an unclear date in `notes` rather than inventing one.

## Nudging Logic

Use this when asked to review, or when another skill needs task signals:

- **Overdue** — due date before today and the task is not done.
- **Due soon** — due in the next 3-5 days.
- **Idle** — an active task with no visible update for more than 7 days, judged only from dated evidence (due dates, `since` dates, completion dates, dated notes). Skip idle detection for items with no dates; do not guess.
- **Waiting on others** — waiting more than 5 days per the `since` date.

Do not nudge the same item twice in less than 48 hours when prior nudge data is available.

## Safety

- Nothing in the tool surface deletes a task, and completion is a move to `## Done`, not a removal.
- Do not infer completion from conversational optimism; require explicit completion language.
- Ask, or capture to `Inbox.md`, when a task has multiple plausible projects or owners.
