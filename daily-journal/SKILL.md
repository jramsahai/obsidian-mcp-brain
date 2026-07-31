---
name: daily-journal
description: >
  Capture personal daily diary entries in the Obsidian vault: mood, energy,
  weather, exercise, food, media, purchases, random thoughts. Use for "today
  I..." personal logs and observations. NOT for: reusable reference facts
  (knowledge-base), actionable work (task-tracking), project updates or
  conversation notes (project-tracking), or durable person context
  (people-notes).
---

# Daily Journal

Capture daily notes in the user's Obsidian second brain without turning personal journaling into project management. Use `second-brain` for shared vault conventions.

## The Daily Note Is a Journal, Not a Work Log

This is the distinction that decides almost every routing question here.

> "Key conversations and action items are intended to be related to projects and tasks, whereas I want the journal to be more reflective of my day."

- **How the user felt about something** is journal content. "Frustrated with how the pricing call went" belongs in `## Mood / Energy`.
- **What was decided, said, or owed** is not. "Talked to Sam about Wayfinder, he'll send the quote Friday" is a project conversation plus a task — route it to `project-tracking` and `task-tracking`, and write nothing to the daily note.

Older daily notes contain `## Key Conversations` and `## Action Items` sections. That content was misrouted; its real homes are the project note and `Tasks.md`. Do not add to those sections, and do not rewrite or migrate the ones that exist — old prose stays exactly where it is.

## Writing an Entry

Use `obsidian__daily_log`. It resolves the date, creates `Daily/YYYY-MM-DD.md` from the template if today has no note yet, and appends inside the section you name:

```text
obsidian__daily_log section="Food" content="Made carbonara, first time with guanciale."
obsidian__daily_log section="Mood / Energy" content="Low energy all afternoon." date="2026-07-30"
```

- Omit `date` for today. Only pass it when the user refers to another day.
- Preserve the user's wording and tone. Minimal cleanup, no summarizing.
- Repeat entries are skipped rather than duplicated, so a retry is safe.
- Wikilink people, projects, and knowledge notes you mention — same words, only brackets added. This is what connects journal entries into the graph. `nightly-consolidation` will catch anything you miss.

## Sections

`section` is a fixed list of seven. There is no eighth, and no free-text section: a journal with a stable shape is one the user can actually read back.

| The entry is about | Section |
|---|---|
| Mood, energy, sleep, stress | `Mood / Energy` |
| Weather observations | `Weather` |
| Workouts, walks, sports, health activity | `Exercise` |
| Books, shows, films, music, games, articles | `Media` |
| Meals, snacks, restaurants, cooking | `Food` |
| Things bought, subscriptions, notable spending | `Purchases` |
| Reflections, memories, stray notes, anything else | `Random Thoughts` |

If nothing else fits, it is a `Random Thoughts` entry. If it does not fit *there* either, it is probably not journal content — re-read the boundary above and route it.

## Relationship to Other Skills

- A journal entry that contains a clear task: route to `task-tracking`. Do not create tasks from journal text on your own inference.
- A journal entry that records a decision or project fact: route to `project-tracking`.
- A journal entry that records a conversation or durable person context: route to `people-notes`.
- Keep journaling capture-first. `nightly-consolidation` does the deeper linking later.

## Privacy and Tone

- Treat journal content as private.
- Do not repeat sensitive journal details outside the current direct channel unless necessary.
- Keep confirmations brief: say what date and section were updated.
