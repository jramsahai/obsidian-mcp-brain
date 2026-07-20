---
name: daily-journal
description: >
  Capture personal daily diary entries in the Obsidian vault: mood, energy,
  exercise, food, media, purchases, random thoughts. Use for "today I..."
  personal logs and observations. NOT for: reusable reference facts
  (knowledge-base), actionable work (task-tracking), project updates
  (project-tracking), or durable person context (people-notes).
---

# Daily Journal

Capture daily notes in the user's Obsidian second brain without turning personal journaling into project management. Use `second-brain` for shared vault conventions.

## Data Source

- Vault config (name, path, CLI binary, timezone): see `second-brain` -> Vault. Examples assume vault name `Obsidian Vault`.
- Daily note path: `Daily/YYYY-MM-DD.md`
- Use the local timezone (see `second-brain` vault config) for dates unless the user explicitly refers to another date.

## Daily Note Template

```markdown
---
type: daily
date: YYYY-MM-DD
created: YYYY-MM-DD
---

# Daily Note — YYYY-MM-DD

## Mood / Energy

## Weather

## Exercise

## Media

## Food

## Purchases

## Random Thoughts
```

Create missing daily notes with this template, but do not force every section to have content.

## Workflow

When logging a journal item:

1. Determine the target date from the user's wording; default to today in the local timezone.
2. Create `Daily/YYYY-MM-DD.md` if it does not exist.
3. Choose the best section from the template.
4. Insert the entry at the end of the chosen section — read the note, then edit; file-level `append` would land it after the last section instead (see `second-brain` -> Writing Into Notes). Minimal cleanup, preserve the user's wording and tone.
5. Wikilink mentions of known people (`[[First Last]]`), projects (`[[Project Name]]`), and knowledge notes inline — same words, only brackets added. This is what connects journal entries into the graph.
6. Do not create project or task records from journal text unless the user clearly asks.

## Section Guidance

- Mood, energy, sleep, stress -> `## Mood / Energy`.
- Weather observations -> `## Weather`.
- Workouts, walks, sports, health activity -> `## Exercise`.
- Books, shows, films, music, games, articles -> `## Media`.
- Meals, snacks, restaurants, cooking -> `## Food`.
- Things bought, subscriptions, notable spending -> `## Purchases`.
- Ideas, personal reflections, memories, stray notes -> `## Random Thoughts`.

If no section fits, add a short section that matches the user's wording.

## Relationship to Other Skills

- If the journal entry contains a clear task, ask whether to add it or route to `task-tracking` when intent is explicit.
- If the journal entry contains a project decision, route to `project-tracking` when intent is explicit.
- If the journal entry records a conversation or person-specific context, route to `people-notes` when it should be durable outside the daily note.
- Keep journaling capture-first; do not over-process personal notes. The `nightly-consolidation` skill handles deeper linking later.

## Privacy and Tone

- Treat journal content as private.
- Do not repeat sensitive journal details outside the current direct channel unless necessary.
- Keep confirmations brief: say what date and section were updated.
