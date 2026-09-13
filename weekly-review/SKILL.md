---
name: weekly-review
description: >
  Once-a-week pass over the Obsidian second brain: what shipped, what
  slipped, which projects went quiet, and three specific questions for the
  user. On demand ("run my weekly review") or by cron. Read-mostly, like
  standup, plus applying the user's own answers from last week's review. NOT
  for: daily status (standup), nightly linking and inbox triage
  (nightly-consolidation), or creating tasks/projects from scratch
  (task-tracking / project-tracking).
---

# Weekly Review

Generate the week's review by inspecting the Obsidian second brain, then ask the user three specific questions. This is the main feedback channel that tunes the rest of the system, so the questions matter more than the prose around them. Read `second-brain` for shared vault conventions and the `obsidian__*` tool surface; this skill matches `standup`'s shape and tone, but runs weekly and writes a permanent note instead of replacing one.

## Data Source

- Task state, via `obsidian__task_query` — `completed_since="YYYY-MM-DD"` (the week's Monday) with `status="done"` for what shipped, `overdue=true` for what slipped, `due_before="YYYY-MM-DD"` (today) with `status="open"` for the rest of what's due this week and not done. Fall back to `obsidian__vault_read note="Tasks"` only when a task's full wording or layout matters beyond what the query fields give you.
- `Projects/*/[Project Name].md` for status and recent activity — list active projects with `obsidian__vault_list type="project" status="Active"`.
- `Syntheses/YYYY-MM-DD.md` notes from the last 7 days for overnight observations worth carrying into the review.
- Notes changed in the last 7 days, via `obsidian__vault_list changed_since="YYYY-MM-DD"`, to see where the week's activity actually landed.
- Last week's review note, if any — `obsidian__vault_status` reports `last_review_week`; read it with `obsidian__vault_read note="YYYY-Www"`. Its `## Answers` section is what the user wrote in reply to last week's three questions.

A missing note or an empty result is the answer, not a malfunction — no synthesis notes in a quiet week and no prior review before the first run are both normal. Skip the section and move on.

## Workflow

When asked to run the weekly review, or when invoked by cron:

1. `obsidian__vault_status` for today's local date and `last_review_week`. Derive this week's ISO week from today's date — ISO weeks run Monday to Sunday and week 1 is the week containing 4 January — and format it `YYYY-Www`, e.g. `2026-W37`.
2. If a review for this week already exists, this is a re-run: read it and continue from what it already has rather than starting over.
3. `obsidian__task_query status="done" completed_since="YYYY-MM-DD"` (this week's Monday) for what shipped; `obsidian__task_query overdue=true` and `obsidian__task_query status="open" due_before="YYYY-MM-DD"` (today) for what slipped.
4. `obsidian__vault_list type="project" status="Active"` for active projects, then read each one worth reporting on.
   Quiet Projects itself comes from `obsidian__vault_list type="project" status="Active" stale_days=14` — `last_entry_date` is the note's own dated evidence (an Activity Log block, a table row), not mtime, so a consolidation pass touching a file cannot make a quiet project look active.
5. `obsidian__vault_list changed_since="YYYY-MM-DD"` (7 days back) to see what actually moved this week.
6. Read this week's `Syntheses/YYYY-MM-DD.md` notes, if any, for observations already surfaced overnight.
7. If `last_review_week` names a note, read it and look at its `## Answers` section. Apply what it says, using only the tools this system exposes:
   - A task the user marked "drop" — complete it so it stops surfacing: `obsidian__task_update match="…" done=true`.
   - A project the user said to park — `obsidian__note_set_field note="[Project Name]" field="status" value="On Hold"`.
   - A project the user said to push or keep going — no state change; carry it forward instead of asking again.
   - An answer that does not map onto an existing tool: do not invent one. Note it in the reply instead of leaving it silently unapplied.
   Never touch task or project state for any other reason during a review — this is the one exception to "read-mostly," and it is bounded to acting on the user's own explicit prior answer.
8. Work out the sections:
   - **Shipped** — tasks completed this week (`✅` dates falling in the last 7 days) and any project whose status changed. Name the task or project with a wikilink.
   - **Slipped** — tasks overdue, or due this week and not done. Name the task, its due date, and its project.
   - **Quiet Projects** — `obsidian__vault_list type="project" status="Active" stale_days=14`. Show each with its `last_entry_date` (or "no dated entry yet" when null) so the reader sees the evidence, not just the label.
   - **Observations** — at most five. Each one names a note with a wikilink and gives a one-line reason it is worth surfacing. Fewer is fine; padding to five is not the goal.
   - **Questions for you** — exactly three questions, drawn from Slipped and Quiet Projects, each specific enough to answer in a sentence, e.g. "[[Example Project]] has been quiet 21 days — park it or push it?" Do not ask a question the vault already answers.
9. `obsidian__note_create type="review" name="YYYY-Www"` for this week, then `obsidian__section_append` once per section in order (Shipped, Slipped, Quiet Projects, Observations, Questions for you). Leave `## Answers` empty — that is the user's section to fill in, not this skill's.
10. Reply in the current channel with the same content, trimmed for readability.

Empty sections are fine and expected some weeks — an empty Slipped section is good news, not a gap to fill with something else.

## Review Shape

Use this structure unless the user asks for a different format:

```markdown
**Weekly Review — YYYY-Www**

**Shipped**
- Task or project, with a wikilink.

**Slipped**
- Task, due date, project.

**Quiet Projects**
- Project — last entry 2026-07-20 (or "no dated entry yet").

**Observations**
- Up to five, each with a wikilink and a one-line reason.

**Questions for you**
1. Specific question drawn from Slipped or Quiet Projects.
2. …
3. …
```

## Tone

Be concise and specific — this note is read by the same person every week, so repeating boilerplate wastes their attention. Do not invent shipped work, slipped dates, or quiet status when the vault does not say so. When a section would otherwise be empty, say so briefly rather than stretching another section to fill the gap.

## Relationship Rules

- Treat `Tasks.md` as the source for task state and `Projects/[Project Name]/[Project Name].md` as the source for project state, same as `standup`.
- Never mutate task or project state except to apply an explicit answer the user wrote in last week's `## Answers` — everything else about this review is synthesis, not action.
- Do not create tasks or projects from a review's own observations; if something needs tracking, say so as a question or observation and let the user (or a follow-up to `task-tracking` / `project-tracking`) act on it.

## Cron Invocation

For scheduled runs, use the same workflow as an on-demand run. Deliver the concise review to the configured channel. If a tool returns an error, report it plainly — the message names the fix — rather than retrying the same call or falling back to shell commands. There is no shell fallback for vault work.
