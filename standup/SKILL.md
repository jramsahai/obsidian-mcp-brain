---
name: standup
description: >
  Generate a standup summary from Obsidian project/task state, on demand or by
  cron: active projects, overdue and due-soon tasks, waiting states, stale
  items, pending conversations. Read-mostly synthesis. NOT for: changing task
  or project state (task-tracking / project-tracking).
---

# Standup

Generate a useful standup for the user by inspecting the Obsidian second brain, especially project and task state. This skill synthesizes; it should not mutate project or task source files unless the user explicitly asks. It may update `Standup.md` with the generated summary.

## Data Source

Use the shared vault conventions and the `obsidian__*` tool surface from `second-brain`.

Read from:

- Task state: `obsidian__task_query`, not a hand-read of `Tasks.md` — `overdue=true` for overdue tasks, `due_before="YYYY-MM-DD"` (today plus 5 days) for due-soon, `section="Waiting On Me"` for tasks waiting on the user, `status="waiting"` for tasks waiting on others. Fall back to `obsidian__vault_read note="Tasks"` only when a section's full wording or layout matters beyond what the query fields give you.
- `Projects/*/[Project Name].md` for project status (frontmatter `status:`), blockers, decisions, waiting items, and related tasks.
- `People/*.md` only when pending conversations or waiting-on people need context.
- `Inbox.md` for unprocessed actionable captures.
- The most recent `Syntheses/YYYY-MM-DD.md` for overnight observations worth surfacing.
- Recent `Daily/YYYY-MM-DD.md` notes only when project/task context is thin.
- `Standup.md` from the previous run for continuity and diff context.

A missing note or an empty result is the answer, not a malfunction — no daily note on a quiet day and no synthesis before the first nightly run are both normal. Skip the section and move on.

## Workflow

When asked to run standup, or when invoked by cron:

1. `obsidian__vault_status` — today's local date, note counts, the latest synthesis and daily dates, task counts, and what changed recently. This replaces the old exploratory preamble; do not rediscover any of it by hand.
2. `obsidian__task_query overdue=true` for overdue tasks; `obsidian__task_query due_after="YYYY-MM-DD" due_before="YYYY-MM-DD"` (today through today plus 5 days) for due-soon tasks; `obsidian__task_query section="Waiting On Me"` for tasks waiting on the user; `obsidian__task_query status="waiting"` for tasks waiting on others.
3. `obsidian__vault_list type="project" status="Active"` for the active projects, then `obsidian__vault_read` each one worth reporting on.
4. Reconcile projects and tasks by exact project name / wikilink.
5. `obsidian__vault_read` the latest synthesis named by step 1, if there is one.
6. `obsidian__vault_links direction="unresolved"` — the nightly hands over any candidate whose `times_surfaced` has reached 3. Those are names it has proposed repeatedly and cannot resolve on its own; surface them under **Decisions Needed** so the user can settle each one. Nothing else picks them up, so a candidate you skip here is a candidate nobody ever acts on.
7. Identify the highest-signal items:
   - active projects and their current state
   - overdue tasks
   - tasks due in the next 3-5 days
   - tasks waiting on the user
   - tasks waiting on other people
   - blocked projects or tasks
   - stale active tasks with no visible update for more than 7 days
   - stale active projects with no visible update for more than 14 days
   - Staleness must come from dated evidence in the notes (due dates, `since` dates, `✅` completions, Conversation Log / Waiting On dates, synthesis mentions). No dated evidence for an item -> leave it out of Stale rather than guessing.
   - pending conversations or follow-ups
   - unprocessed inbox items that look actionable
8. `obsidian__standup_write content="…"` with the generated standup. This is the one note in the vault that is replaced rather than appended to.
9. Reply in the current channel with the same standup, trimmed for readability.

Five or six tool calls should cover a normal standup. If you find yourself making twenty, re-read step 1 — the information is already in hand.

## Relationship Rules

- Treat `Tasks.md` as the source for task state.
- Treat `Projects/[Project Name]/[Project Name].md` as the source for project state.
- If task/project state conflicts, report the inconsistency instead of silently resolving it.
- Do not mark tasks done, change project status, or create tasks while running standup unless the user explicitly asks; route those changes to `task-tracking` or `project-tracking`.

## Standup Shape

Use this structure unless the user asks for a different format. When an active project carries a `goal:` field, group its **Projects** line under that goal's name (`obsidian__vault_list type="project" goal="Goal Name"` finds the rest); projects with no goal go last under "Unassigned".

```markdown
**Standup — YYYY-MM-DD**

**Focus**
- The 1-3 things most worth the user's attention today.

**Projects**
- Project Name: current status, recent movement, next obvious action.

**Tasks**
- Overdue: specific task, due date, project.
- Due soon: specific task, due date, project.
- Waiting on the user: specific task and why.
- Waiting on others: who, what, since when.

**Stale / Blocked**
- Item and why it needs attention.

**Overnight**
- Notable observation from the latest synthesis, if any.

**Decisions Needed**
- Name the nightly has proposed 3+ times: create a note for it, or retire it. One line each.

**Pending Conversations**
- Person/topic and project context.
```

Omit empty sections. If there is not enough data, say so briefly and list the notes checked.

## Tone

Be concise, practical, and specific. Prefer action-oriented phrasing over status theater. Do not invent dates, owners, or project states when the vault does not say them. When unsure, mark an item as unclear and include the source note name.

## Updating `Standup.md`

`Standup.md` is derived from the projects, tasks, and people notes, so yesterday's copy is not history worth keeping — it is the only note in the vault that is regenerated rather than appended to. `obsidian__standup_write` is the only tool that replaces a note body, and it works on nothing else. Do not reach for a native file write; the global rule in `second-brain` still holds everywhere, including here.

```
obsidian__standup_write content="**Focus**\n- …" date="2026-07-31"
```

It writes the title and keeps the frontmatter; `content` is everything below the title. `date` defaults to today in the vault's timezone, which `obsidian__vault_status` also reports.

## Cron Invocation

For scheduled runs, use the same workflow as an on-demand run. Deliver the concise standup to the configured source channel. If a tool returns an error, report it plainly — the message names the fix — rather than retrying the same call or falling back to shell commands. There is no shell fallback for vault work.
