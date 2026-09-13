---
name: goals
description: >
  Track what a project or set of projects is working toward: create a goal
  note, link a project to it, mark a goal achieved or dropped, and answer "how
  is <goal> going" by listing its projects and their status. Use when the
  user talks about a purpose or outcome, not just a piece of work. NOT for:
  project status, decisions, or blockers (project-tracking), or individual
  tasks (task-tracking).
---

# Goals

Projects say what they are; a goal says what they are for. Manage goal notes in the user's Obsidian second brain and the `goal:` link that projects carry back to them. Use `second-brain` for shared vault conventions, `project-tracking` for project state, and `task-tracking` for action items.

## Data Source

- Goal note: `Goals/[Goal Name].md` — named after the goal so `[[Goal Name]]` wikilinks resolve. Created with `obsidian__note_create type="goal"`; the path is derived, never hand-constructed.
- A project's `goal:` frontmatter field holds one quoted wikilink to the goal it serves. The goal note's own `## Projects` section lists every project pointed at it — the two are kept in sync by one tool call, not two.

## Goal Note Template

```markdown
---
type: goal
status: active
created: YYYY-MM-DD
horizon: 2026-Q4
---

# [Goal Name]

## Why

## What done looks like

## Projects

- [[Project Name]]

## Log

### YYYY-MM-DD

- What happened
```

`status` is `active`, `achieved`, or `dropped` — your judgment; the tool does not enforce the enum. `horizon` is optional free text like `2026-Q4` or `H1`; omit it when the user gave no timeframe.

## Workflow

### Creating a goal

1. `obsidian__note_create type="goal" name="Ship the Handheld"`. Pass a horizon when the user gave one: `fields={"horizon":"2026-Q4"}`.
2. Fill `## Why` and `## What done looks like` with `obsidian__section_append note="Ship the Handheld" section="Why" content="…"` — use the user's own words; do not invent a rationale or a definition of done they did not give.
3. If the user already named a project this goal covers, link it in the same turn (below).
4. If the note already exists, `note_create` returns `created=false` — add to the existing note instead of recreating it.

### Linking a project to a goal

1. The goal note must exist first — create it above if it does not.
2. `obsidian__note_set_field note="Example Project" field="goal" value="Ship the Handheld"`. This sets the project's `goal:` property to a quoted wikilink and lists the project under the goal's own `## Projects` section in the same call — the edge is visible from both sides without a second write to remember.
3. If the goal note does not exist yet, the property is still set as an unresolved wikilink (the tool reports this) — create the goal note and re-run the call to pick up the back-link.
4. Repeat once per project when several projects serve one goal.

### Marking a goal achieved or dropped

1. `obsidian__note_set_field note="Ship the Handheld" field="status" value="achieved"` (or `value="dropped"`). Only when the user says so explicitly — never infer this from a project finishing.
2. Record why with a dated entry: `obsidian__log_append note="Ship the Handheld" section="Log" content="Marked achieved — shipped to the first 50 users"`.

### "How is `<goal>` going"

1. `obsidian__vault_read note="Ship the Handheld"` for `## Why`, `## What done looks like`, and its `## Log`.
2. `obsidian__vault_list type="project" goal="Ship the Handheld"` for every project linked to it.
3. Read each linked project for its `status` and most recent dated activity, then report project-by-project: name, status, and the latest dated evidence of movement. No dated evidence for a project is not "stalled" — say it looks quiet rather than guessing.

## Relationship to Projects

- A project holds one `goal:` value at a time. Pointing it at a new goal overwrites the old value in frontmatter, but nothing here removes the old bullet from the previous goal's `## Projects` section — mention that to the user if it would otherwise look stale.
- Do not create a goal for a single one-off task; a goal is for a purpose worth tracking across projects or across a stretch of time.
- Project state itself — status, decisions, blockers — stays in `project-tracking`. This skill only writes the goal note and its `## Log`, plus the one `note_set_field` call that links a project to a goal.

## Safety

- Do not invent a goal's rationale or its "done" definition — use the user's own words, or ask.
- Do not mark a goal achieved or dropped unless the user says so explicitly.
- Do not infer a goal is achieved just because every project linked to it is marked Done.
