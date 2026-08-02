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
- A dated entry in the running `## Activity Log` is `obsidian__log_append`, which writes the `### YYYY-MM-DD` heading itself and keeps the newest day at the top. That section is not a `obsidian__section_append` target.

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

## Activity Log

### YYYY-MM-DD

- What happened, newest date first

## Related

- [[Knowledge note or other related note]] — why it is related
```

Status values: `Active`, `On Hold`, `Blocked`, `Done`. Status lives in frontmatter (`status:`), not in the body, so Bases and queries can read it.

`people:` holds quoted wikilinks to person notes: `people: ["[[First Last]]"]`. `topics:` holds plain topic strings: `topics: [video, playback]`.

## Workflow

When creating a project:

1. Normalize the project name to Title Case unless the user gives exact casing.
2. `obsidian__note_create type="project" name="[Project Name]"` — the server creates the folder, the note, the frontmatter, and the standard sections. Pass known values through `fields`, e.g. `fields={"status":"Active","people":"Jane Doe, Sam Lee","description":"One line"}`; `people` becomes quoted wikilinks.
3. If the user supplied a written brief — a spec, a plan, hardware or API details, a phased roadmap, anything with its own headings — **the brief is the deliverable, not raw material for a summary.** Create `obsidian__note_create type="doc" name="technical-brief" project="[Project Name]" body="<the full text>"` first, before filling any section, and wikilink it from `## Related`. A doc note gets no section skeleton precisely so it can hold a document whole. Demote the brief's headings one level so the note keeps a single H1.
4. Fill the project note's sections with `obsidian__section_append`. Use `[[First Last]]` wikilinks for every person named. The sections summarize and point at the doc; they never replace it.
5. If the user also gives actionable work, route to `task-tracking` to add tasks to `Tasks.md`.

When updating a project:

1. Read the existing project note.
2. Append to the relevant section with `obsidian__section_append`, and keep the `status`, `people`, and `topics` properties in sync with `obsidian__note_set_field note="[Project Name]" field="status" value="On Hold"`. Stale frontmatter is not cosmetic: `standup` lists active projects with `obsidian__vault_list type="project" status="Active"`, so a project left `Active` after it stops is reported as live work every weekday until someone notices.
3. Log what happened in the `## Activity Log`:

   ```
   obsidian__log_append note="[Project Name]" section="Activity Log" content="Proposal sent; awaiting response"
   ```

   Pass the entry text only — no date prefix and no bullet marker. Never use `obsidian__section_append` on that section: it drops a bare line above every dated block, which is where the CLI-written entries of 2026-08-01 ended up.

   A project note written before the template carried `## Activity Log` will not have one, and the call fails naming the sections it does have. Add `create_section=true` to that call and the heading is created in template position.

   If the call is refused as **too similar** to an entry already in that day's block, you already logged this — the error quotes the entry it collides with. Do not reword and retry; that is exactly how one turn wrote the same board purchase into a log three times. `allow_similar=true` is for a genuinely separate event that happens to read alike, not for getting past the message.

   To undo an entry this system wrote by mistake, use `obsidian__log_remove note="[Project Name]" section="Activity Log" date="YYYY-MM-DD" match="<text from the entry>"`. It is the only tool here that deletes, it touches one dated block, and it exists so that fixing a bad entry never means editing the file directly. Do not use it on entries the user wrote — if something is merely out of date, log a new entry saying so.
4. Add dates using the local timezone.
5. Preserve existing tables and user wording where possible.
6. Wikilink people in the `Who` columns of Conversation Log and Waiting On.
7. If task state changes are implied but not explicit, mention the possible task update instead of changing `Tasks.md` silently.

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

- **Never compress supplied material to make it fit a section.** The project template has no section shaped like a spec, so a brief pushed into `## Key Decisions` arrives as a table row with the wrong number of cells and the server rejects it. That rejection means the content has no home yet — create the doc note. It does not mean write one summary line and drop the rest. On 2026-08-02 a full ESP32 hardware and API brief became a single decision row this way, and nothing else survived.
- Detail is lost silently. A section that is merely thin looks the same as one the user never filled in, so there is no later signal that anything went missing — the check has to happen while the material is still in front of you.
- Do not invent project metadata.
- Do not create tasks without clear actionable wording.
- Do not create a project from a vague idea unless the user asks to track it as a project; otherwise capture it to `Inbox.md` or use the idea pipeline if appropriate.
