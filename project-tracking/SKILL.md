---
name: project-tracking
description: >
  Track work projects in the Obsidian vault: create/update project notes,
  status, key decisions, blockers, meeting notes, docs, and stakeholder links.
  Use for project state and project conversations. NOT for: individual tasks
  (task-tracking), pre-project ideas (idea-pipeline), or evergreen reference
  (knowledge-base).
---

# Project Tracking

Manage project records in the user's Obsidian second brain. Use `second-brain` for shared vault conventions and `task-tracking` when task state must be created or changed.

## Data Source

- Vault config (path, timezone): see `second-brain` -> Vault.
- Project note: `Projects/[Project Name]/[Project Name].md` — named after the project so `[[Project Name]]` wikilinks resolve to it. Created with `obsidian__note_create type="project"`; the path is derived, never hand-constructed.
- Central task file: `Tasks.md`, written through `obsidian__task_add` and `obsidian__task_update`.
- Adding a table row or a line under a heading is `obsidian__section_append`, which targets the named section rather than the end of the file.

## Project Note Template

```markdown
---
type: project
status: Active
created: YYYY-MM-DD
started: YYYY-MM-DD
people: []
topics: []
---

# [Project Name]

**Description:** One-line description

## Stakeholders

- [[First Last]] — Role
- Org or team name — Role (plain text for orgs; wikilinks for people)

## Key Decisions

| Date | Decision | Reasoning |
|------|----------|-----------|

## Conversation Log

| Date | Who | Summary |
|------|-----|---------|

## Waiting On

| What | Who | Since |
|------|-----|-------|

## Related Tasks

- Task text (see [[Tasks]])

## Related

- [[Knowledge note or other related note]] — why it is related
```

Status values: `Active`, `On Hold`, `Blocked`, `Done`. Status lives in frontmatter (`status:`), not in the body, so Bases and queries can read it.

`people:` holds quoted wikilinks to person notes: `people: ["[[First Last]]"]`. `topics:` holds plain topic strings: `topics: [video, playback]`.

## Workflow

When creating a project:

1. Normalize the project name to Title Case unless the user gives exact casing.
2. Create `Projects/[Project Name]/` and `Projects/[Project Name]/[Project Name].md` from the template.
3. Populate known frontmatter, description, stakeholders, blockers, decisions, and related tasks. Use `[[First Last]]` wikilinks for every person named.
4. If the user also gives actionable work, route to `task-tracking` to add tasks to `Tasks.md`.

When updating a project:

1. Read the existing project note.
2. Update only the relevant section; keep frontmatter `status`/`people`/`topics` in sync with body changes.
3. Add dates using the local timezone.
4. Preserve existing tables and user wording where possible.
5. Wikilink people in the `Who` columns of Conversation Log and Waiting On.
6. If task state changes are implied but not explicit, mention the possible task update instead of changing `Tasks.md` silently.

## Project-Task Relationship

- Treat the project note as the source of project state.
- Treat `Tasks.md` as the source of task state.
- Tasks link to the project with a `[[Project Name]]` wikilink that exactly matches the project note name.
- Use `## Related Tasks` in the project note to reference important tasks by exact task text.
- Do not duplicate full task lists inside project files; keep task state centralized in `Tasks.md`.
- When a project is marked `Done`, do not automatically complete all related tasks unless the user explicitly asks.
- When all related tasks are done, do not automatically mark the project `Done` unless the user explicitly asks.
- If project status and task status conflict, preserve both and call out the inconsistency.

## Meeting Notes and Docs

Both are created with `obsidian__note_create`, which derives the folder from the type and the project and writes the frontmatter. Never place these files by hand.

Meeting notes — `obsidian__note_create type="meeting" name="YYYY-MM-DD BriefDescription" project="Project Name"`:

- Include attendees (as `[[First Last]]` wikilinks), discussion points, decisions, and action items when available.
- Add a brief entry to the project note's `## Conversation Log` pointing to the meeting note with a wikilink.
- Route action items to `task-tracking` when they are concrete tasks.

Docs — `obsidian__note_create type="doc" name="vendor-comparison" project="Project Name"` — for drafts, research, and references:

- Name files descriptively: `draft-proposal`, `vendor-comparison`. Generic names are refused, which is why the older `Docs/INDEX.md` files could never be linked to.
- A doc gets no section skeleton; its shape is yours. Pass the opening prose as `body` and fill the rest with `obsidian__section_append`.
- Add a concise docs note to the project note when useful.

## Conversations and Waiting Items

- Log project conversations in `## Conversation Log` with date, who (wikilinked), and summary.
- For person-specific relationship context, also route to `people-notes`.
- Add blockers and external dependencies to `## Waiting On` with what, who (wikilinked), and since date.
- If a waiting item should be tracked as work, route to `task-tracking` and use `Waiting On Others`.

## Safety

- Do not invent project metadata.
- Do not create tasks without clear actionable wording.
- Do not create a project from a vague idea unless the user asks to track it as a project; otherwise capture it to `Inbox.md` or use the idea pipeline if appropriate.
