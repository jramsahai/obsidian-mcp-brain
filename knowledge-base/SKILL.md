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
- Every read and write goes through the `obsidian__*` tools; see `second-brain` -> Tools.

## Tools

The server derives every path from `type` plus `topic`, so never construct one.

| Need | Call |
|---|---|
| Create a knowledge note | `obsidian__note_create type="knowledge" name="Chain Wear" topic="Cycling/Repair"` |
| Create a topic hub | `obsidian__note_create type="moc" topic="Cycling"` |
| Fill a section | `obsidian__section_append note="Chain Wear" section="Details" content="…"` |
| Find existing notes on a topic | `obsidian__vault_search query="chain" type="knowledge"` |
| List a topic folder | `obsidian__vault_list folder="Knowledge Base"` |
| Record a connection | `obsidian__relate note="Chain Wear" target="Drivetrain Maintenance" reason="…"` |
| Route an inbox item | `obsidian__inbox_route line="…" destination_note="…" source_note="Knowledge Base/Inbox.md"` |
| Drop an inbox line already captured | `obsidian__inbox_clear line="…" captured_as="Chain Wear" source_note="Knowledge Base/Inbox.md"` |

Vault area: root folder `Knowledge Base/`, inbox note `Knowledge Base/Inbox.md`, index `Knowledge Base/README.md`.

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
2. Search first: `obsidian__vault_search query="…" type="knowledge"`. Do not create a second note on a topic that already has one.
3. If an obvious note exists, add to it with `obsidian__section_append`.
4. If the topic is obvious but the note does not exist, create it — passing a source URL through `fields` — then fill `## Summary`, `## Details`, and `## Sources` with `obsidian__section_append`:

   ```
   obsidian__note_create type="knowledge" name="Chain Wear" topic="Cycling/Repair" fields={"source":"https://example.com"}
   ```
5. If the topic is unclear, append to `Knowledge Base/Inbox.md` for nightly organization.
6. Preserve source links exactly when provided.
7. Do not invent facts not supplied by the user or present in the captured source context.

For quick raw capture, prefer a compact format:

```markdown
- YYYY-MM-DD: [Title or description](URL) — why it may be useful, if known.
```

A substantial note gets the standard shape — `## Summary`, `## Details`, `## Sources`, `## Related` — which `obsidian__note_create type="knowledge"` lays out along with the frontmatter. You do not write frontmatter; pass extra values through `fields`.

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

- When a topic folder accumulates roughly 5+ notes, `obsidian__note_create type="moc" topic="Cycling"` — the note is titled `Cycling MOC` and placed in that folder. It takes no `name`.
- Body: short description of the topic, then a linked list of the topic's notes grouped however makes sense, each with a few words of context.
- Keep MOCs updated when notes are added, moved, or merged.
- Link the MOC from `Knowledge Base/README.md`.

## Nightly Review Workflow

Invoked as part of `nightly-consolidation`:

1. Read `Knowledge Base/Inbox.md` if it exists.
2. Search/list existing notes under `Knowledge Base/`.
3. Group inbox items and loose notes into coherent topics.
4. Move each item with `obsidian__inbox_route`, which writes the destination, verifies it landed, and only then removes the inbox line — so an item can never end up nowhere. When the item is better captured by creating a note or a task, do that first and then clear the line with `obsidian__inbox_clear line="chain wear" captured_as="Chain Wear" source_note="Knowledge Base/Inbox.md"`.
5. Create new folders only when a topic has enough weight or is a clearly stable category.
6. Add connections with `obsidian__relate` and update MOCs where useful.
7. Leave uncertain items in `Knowledge Base/Inbox.md` with a short `Needs routing:` note.
8. Append a dated review entry to the `## Review Log` in the KB index:

   ```
   obsidian__log_append note="Knowledge Base/README.md" section="Review Log" content="Routed 3 inbox items, added Cycling MOC" keep_newest=20
   ```

   The `## Review Log` is built from `### YYYY-MM-DD` blocks, and the server writes that heading itself — pass the entry text only, with no date prefix and no bullet marker. Today's block goes at the top, and a second entry the same night joins it rather than starting another. `keep_newest` caps the log at its 20 newest dated blocks in the same write, so it never needs trimming by hand. If the index does not exist yet, create it with `obsidian__note_create type="index" name="Knowledge Base"`. This is the only place the KB review log lives; never write review logs into project, people, or daily notes.
9. If nothing changed, skip the log entry entirely; do not accumulate "nothing happened" entries.

Do not spend the nightly review polishing prose for its own sake. The goal is findability and sensible structure.

## Safety

- Do not fabricate summaries for source links that were not inspected or described.
- Do not move project, task, people, or daily journal material into the knowledge base unless it is reusable reference material.
- Preserve user-provided wording and source URLs.
- Avoid deleting captures. If merging, move the content into the destination note and leave no information behind.
