---
name: knowledge-base
description: >
  Capture and organize evergreen reference notes in the Obsidian vault: facts,
  how-tos, techniques, recipes, product research, captured articles/videos/links.
  Use when info is reusable beyond today and not tied to a specific project,
  person, or day. NOT for: tasks or reminders (task-tracking), project state
  (project-tracking), diary entries (daily-journal), or conversations
  (people-notes).
---

# Knowledge Base

Use this skill for the user's personal knowledge base: factual, evergreen, or reference information that should live in Obsidian but is not primarily a project update, task, person note, or daily journal entry.

## Coordinate With

- Use `second-brain` for shared vault location, routing, frontmatter, and linking conventions.
- Use `nightly-consolidation` for the nightly pass; this skill's review workflow below is the KB-specific portion of that pass.
- Use the Obsidian CLI for search, read, move, backlinks, and properties. Write note bodies (create, multi-line append) via direct file write — CLI `content=` args with multi-line/escaped text force an exec approval (see `second-brain` -> Vault).

## Vault Area

- Vault config (name, path, CLI binary, timezone): see `second-brain` -> Vault. Examples assume vault name `Obsidian Vault`.
- Root folder: `Knowledge Base/`
- Inbox note: `Knowledge Base/Inbox.md`
- Index: `Knowledge Base/README.md`

## What Belongs Here

Use `Knowledge Base/` for arbitrary information the user decides to keep for future reference:

- Facts, concepts, definitions, frameworks, instructions, techniques, recipes, maintenance procedures, product research, tools, links, videos, articles, and summaries.
- Learning notes that are useful beyond a single day.
- Reference material that may support projects but is not itself project state.

Do not use this skill as the primary home for:

- Active tasks, reminders, or due dates -> `task-tracking`.
- Project decisions, blockers, docs, or meeting notes -> `project-tracking`.
- Personal diary entries, mood, food, purchases, or day logs -> `daily-journal`.
- Conversations or relationship context -> `people-notes`.

If a capture crosses boundaries, write the evergreen reference here and cross-link from the relevant project/task/person/daily note only when useful.

## Capture Workflow

When the user asks to remember, record, save, or note arbitrary factual/reference material:

1. Decide whether it clearly belongs in the knowledge base.
2. Search the existing `Knowledge Base/` area for a matching topic before creating a new note.
3. If there is an obvious existing note, append the new item there.
4. If there is an obvious topic but no note, create a short topic note in a reasonable folder.
5. If the topic is unclear, append to `Knowledge Base/Inbox.md` for nightly organization.
6. Preserve source links exactly when provided.
7. Do not invent facts not supplied by the user or present in the captured source context.

For quick raw capture, prefer a compact format:

```markdown
- YYYY-MM-DD: [Title or description](URL) — why it may be useful, if known.
```

For a more substantial note, use:

```markdown
---
type: knowledge
topic: Topic/Subtopic
topics: [topic, subtopic]
source: URL if applicable
created: YYYY-MM-DD
---

# Clear Note Title

## Summary

Brief factual summary.

## Details

Useful notes, instructions, or facts.

## Sources

- URL or citation

## Related

- [[Other Note]] — why it is related
```

Wikilink mentions of known projects, people, and other knowledge notes inside the body. Cross-links are what make the knowledge base explorable.

## Organization Model

Organize by stable topic, not by capture date or source platform.

Preferred structure:

```text
Knowledge Base/
  Inbox.md
  README.md
  Cycling/
    Cycling MOC.md
    Repair/
      YouTube - Video Title.md
      Drivetrain Maintenance.md
    Gear/
  Cooking/
  Technology/
  Business/
```

Guidelines:

- Use clear human folder names with title case.
- Avoid over-nesting until there are enough notes to justify it.
- Prefer `Topic/Subtopic/Note.md` when the topic is obvious.
- Use source type in filenames only when helpful, such as `YouTube - Bike Chain Replacement.md`.
- If a note starts as a link-only capture, it can remain short; do not pad it with invented summary.
- Keep related links together when they serve the same fact pattern or topic.

## Maps of Content (MOCs)

A MOC is a hub note that links every note on a topic, making the topic navigable from one place (and giving the graph a hub node). Managed primarily by `nightly-consolidation`:

- When a topic folder accumulates roughly 5+ notes, create `[Topic] MOC.md` in that folder with frontmatter `type: moc`, `topic: [Topic]`.
- Body: short description of the topic, then a linked list of the topic's notes grouped however makes sense, each with a few words of context.
- Keep MOCs updated when notes are added, moved, or merged.
- Link the MOC from `Knowledge Base/README.md`.

## Nightly Review Workflow

Invoked as part of `nightly-consolidation`:

1. Read `Knowledge Base/Inbox.md` if it exists.
2. Search/list existing notes under `Knowledge Base/`.
3. Group inbox items and loose notes into coherent topics.
4. Move or merge items into the most logical existing topic folder/file — write to the destination first, then remove the routed line from the inbox (see `second-brain` Edit Policy).
5. Create new folders only when a topic has enough weight or a clearly stable category.
6. Add `## Related` links and update MOCs where useful.
7. Leave uncertain items in `Knowledge Base/Inbox.md` with a short `Needs routing:` note.
8. Append a short dated review entry to the `## Review Log` in `Knowledge Base/README.md` — this is the only place the KB review log lives; never write review logs into project, people, or daily notes. Keep only the ~20 newest entries; trimming older ones is sanctioned bookkeeping (see `second-brain` Edit Policy).
9. If nothing changed, skip the log entry entirely; do not accumulate "nothing happened" entries.

Do not spend the nightly review polishing prose for its own sake. The goal is findability and sensible structure.

## Safety

- Do not fabricate summaries for source links that were not inspected or described.
- Do not move project, task, people, or daily journal material into the knowledge base unless it is reusable reference material.
- Preserve user-provided wording and source URLs.
- Avoid deleting captures. If merging, move the content into the destination note and leave no information behind.
