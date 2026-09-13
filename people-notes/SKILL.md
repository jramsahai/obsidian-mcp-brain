---
name: people-notes
description: >
  Track durable per-person notes in the Obsidian vault: conversation history,
  pending topics to discuss, relationship context, project associations. Use
  when info is about a person and worth keeping beyond today. NOT for: one-off
  diary mentions (daily-journal), project decisions (project-tracking), or
  action items (task-tracking).
---

# People Notes

Manage durable person-specific notes in the user's Obsidian second brain. Use `second-brain` for shared vault conventions, `project-tracking` for project state, and `task-tracking` for action items.

## Tools

The server derives the path from the person's name, so never construct one. A person note is `People/[First Last].md` — spaces, not underscores, so `[[First Last]]` resolves.

| Need | Call |
|---|---|
| Create a person note | `obsidian__note_create type="person" name="Jane Doe"` |
| Read one | `obsidian__vault_read note="Jane Doe"` |
| Log a conversation | `obsidian__section_append note="Jane Doe" section="Conversation History" content="\| 2026-07-31 \| Call \| …  \|"` |
| Add general context | `obsidian__section_append note="Jane Doe" section="General Notes" content="…"` |
| Add or check off a pending topic | `obsidian__checklist_set note="Jane Doe" section="Pending Topics" item="…"` |
| Associate a project | `obsidian__section_append note="Jane Doe" section="Associated Projects" content="- [[Wayfinder]]"` |
| Update the `projects:` property | `obsidian__note_set_field note="Jane Doe" field="projects" value="Wayfinder"` |

`obsidian__section_append` appends at the end of the *named section*, so a conversation row cannot land under the wrong heading. `## Conversation History` is a table: pass the content as a pipe-delimited row and the tool appends it as a row — if you pass prose, the error names the columns.

## Person File Template

```markdown
---
type: person
role: Employee / Client / Vendor / Family / Friend / Other
created: YYYY-MM-DD
projects: []
---

# [First Last]

## General Notes

Relevant strengths, preferences, context, or relationship notes.

## Conversation History

| Date | Context | Summary |
|------|---------|---------|

## Pending Topics

- [ ] Topic to discuss

## Associated Projects

- [[Project Name]]
```

`projects:` holds quoted wikilinks: `projects: ["[[Project Name]]"]`. You do not write that syntax — `obsidian__note_set_field note="Jane Doe" field="projects" value="Wayfinder, Atlas"` takes plain names and quotes them, which is what makes Obsidian count them as graph edges. Keep it in sync with `## Associated Projects`.

## Workflow

When creating a person note:

1. `obsidian__note_create type="person" name="First Last"`. Pass a known role as `fields={"role":"Client"}`. The sections above are laid out for you.
2. If the person already has a note, the call returns `created=false` and says so — add to the existing note instead of recreating it.
3. Populate only what is known. Do not infer sensitive personal details.

When logging a conversation:

1. Determine the person and the date in the local timezone.
2. Append the row: `obsidian__section_append note="First Last" section="Conversation History" content="| 2026-07-31 | Kickoff call | Agreed to send pricing |"`. Wikilink any projects or other people named in the summary.
3. If the conversation belongs to a project, add it to `## Associated Projects` and to the `projects:` property, and route project-specific content to `project-tracking`.
4. If the conversation creates action items, route concrete tasks to `task-tracking`.
5. If it was just a daily-life note, optionally route a brief note to `daily-journal` when the user's wording suggests journaling.

## Pending Topics

- Use `## Pending Topics` for things the user wants to discuss with a person later. Add one with `obsidian__checklist_set note="First Last" section="Pending Topics" item="…"`.
- Mark a topic handled with the same call plus `checked=true`, and only when the user says it was handled. Nothing removes the line — a checked topic is the record that it happened.
- If a pending topic is tied to a project, include the `[[Project Name]]` wikilink in the topic text.

## Cadence

On "who haven't I talked to" or "who should I reach out to":

1. `obsidian__vault_list type="person" stale_days=60`, sorted oldest first (a null `last_entry_date` — never logged at all — sorts first, ahead of every real date).
2. For each, read the note and report: the person's name as a wikilink, their `last_entry_date` (or "no logged conversation yet"), and any open items under `## Pending Topics`.
3. This is a suggestion, never a write — do not log a conversation, close a pending topic, or change `status` from a cadence check. The user decides who to reach out to; this skill only surfaces who has gone quiet.

## Relationship to Projects and Tasks

- People files link to projects under `## Associated Projects` and in frontmatter `projects:`.
- Project files should hold project decisions, blockers, and waiting items, and link back to people via `people:` frontmatter and `[[First Last]]` stakeholder links — this is what makes person-project connections visible in the graph from both sides.
- Task files should hold actionable work, due dates, and waiting states.
- Do not use people files as the only place for project blockers or task commitments; route those to `project-tracking` or `task-tracking` as well.

## Privacy and Tone

- Treat people notes as sensitive private context.
- Keep notes factual and useful; avoid judgmental phrasing unless the user explicitly gives that wording.
- Do not expose people-note details in group chats or public channels.
