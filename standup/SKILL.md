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

Use the shared vault conventions from `second-brain`.

- Vault config (name, path, CLI binary, timezone): see `second-brain` -> Vault. Examples assume vault name `Obsidian Vault`.
- If the CLI returns `Vault not found`, follow the `second-brain` recovery steps (`open -g "obsidian://open?vault=Obsidian%20Vault"`, wait ~5s, retry up to 3x) before falling back.
- Only after recovery fails, fall back to direct read-only file inspection under the vault path. Use bare commands like `cat "<path>"` — no redirects (`2>&1` included), pipes, chains, or globs; each triggers a manual exec approval (see `second-brain` Fallback Hygiene).

Read from:

- `Tasks.md` for checkbox tasks: due dates (`📅`), priorities (`⏫🔼🔽`), waiting states, project wikilinks. CLI shortcut: `tasks todo verbose`.
- `Projects/*/[Project Name].md` for project status (frontmatter `status:`), blockers, decisions, waiting items, and related tasks.
- `People/*.md` only when pending conversations or waiting-on people need context.
- `Inbox.md` for unprocessed actionable captures.
- The most recent `Syntheses/YYYY-MM-DD.md` for overnight observations and candidates worth surfacing. Find it with `files vault="Obsidian Vault" folder="Syntheses" ext=md` — filenames are dates, so the max filename is the latest. An empty listing means no syntheses exist yet; skip the section, never re-check with shell `ls`.
- `Daily/YYYY-MM-DD.md` and recent daily notes only when they appear relevant or project/task context is thin. A missing daily note is normal (nothing was logged that day) — a CLI `File not found` is authoritative; skip it, never re-check with shell reads.
- `Standup.md` from the previous run for continuity and diff context.

## Workflow

When asked to run standup, or when invoked by cron:

1. Determine today's date in the local timezone.
2. Read `Tasks.md`.
3. Inspect active project notes under `Projects/*/`.
4. Reconcile projects and tasks by exact project name / wikilink where possible.
5. Check the latest synthesis note for observations or candidates worth flagging.
6. Identify the highest-signal items:
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
7. Write or replace `Standup.md` with the generated standup and timestamp.
8. Reply in the current channel with the same standup, trimmed for readability.

## Relationship Rules

- Treat `Tasks.md` as the source for task state.
- Treat `Projects/[Project Name]/[Project Name].md` as the source for project state.
- If task/project state conflicts, report the inconsistency instead of silently resolving it.
- Do not mark tasks done, change project status, or create tasks while running standup unless the user explicitly asks; route those changes to `task-tracking` or `project-tracking`.

## Standup Shape

Use this structure unless the user asks for a different format:

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
- Notable observation or candidate from the latest synthesis, if any.

**Pending Conversations**
- Person/topic and project context.
```

Omit empty sections. If there is not enough data, say so briefly and list the files checked.

## Tone

Be concise, practical, and specific. Prefer action-oriented phrasing over status theater. Do not invent dates, owners, or project states when the vault does not say them. When unsure, mark an item as unclear and include the source file name.

## Updating `Standup.md`

When writing `Standup.md`, include:

```markdown
# Standup

Generated: YYYY-MM-DD HH:mm TZ

[standup content]
```

`TZ` is the local timezone abbreviation from the `second-brain` vault config (e.g. ET for `America/New_York`).

## Cron Invocation

For scheduled runs, use the same workflow as an on-demand run. Deliver the concise standup to the configured source channel. If the vault cannot be read, report the failure plainly with the command or file path that failed.
