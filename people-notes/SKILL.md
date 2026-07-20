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

## Data Source

- Vault config (name, path, CLI binary, timezone): see `second-brain` -> Vault. Examples assume vault name `Obsidian Vault`.
- People path: `People/[First Last].md` — spaces, not underscores, so `[[First Last]]` wikilinks resolve naturally.
- Conversation rows, pending topics, and project links are mid-file section edits: read the note, then edit in place — do not use file-level `append` (see `second-brain` -> Writing Into Notes).

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

`projects:` holds quoted wikilinks: `projects: ["[[Project Name]]"]`. Keep it in sync with `## Associated Projects`.

## Workflow

When creating a person note:

1. Name the file `People/First Last.md` unless another convention already exists for that person.
2. Create the file from the template.
3. Populate only known role, general notes, conversations, pending topics, and associated projects.
4. Do not infer sensitive personal details.

When logging a conversation:

1. Determine the person and date in the local timezone.
2. Add a row to `## Conversation History` with date, context, and concise summary. Wikilink any projects (`[[Project Name]]`) or other people (`[[First Last]]`) mentioned in the summary.
3. If the conversation belongs to a project, add or preserve the project in `## Associated Projects` and frontmatter `projects:`, and route project-specific content to `project-tracking`.
4. If the conversation creates action items, route concrete tasks to `task-tracking`.
5. If it was just a daily-life note, optionally route a brief note to `daily-journal` when the user's wording suggests journaling.

## Pending Topics

- Use `## Pending Topics` for things the user wants to discuss with a person later.
- Check off or remove pending topics only when the user says they were handled.
- If a pending topic is tied to a project, include the `[[Project Name]]` wikilink in the topic text.

## Relationship to Projects and Tasks

- People files link to projects under `## Associated Projects` and in frontmatter `projects:`.
- Project files should hold project decisions, blockers, and waiting items, and link back to people via `people:` frontmatter and `[[First Last]]` stakeholder links — this is what makes person-project connections visible in the graph from both sides.
- Task files should hold actionable work, due dates, and waiting states.
- Do not use people files as the only place for project blockers or task commitments; route those to `project-tracking` or `task-tracking` as well.

## Privacy and Tone

- Treat people notes as sensitive private context.
- Keep notes factual and useful; avoid judgmental phrasing unless the user explicitly gives that wording.
- Do not expose people-note details in group chats or public channels.
