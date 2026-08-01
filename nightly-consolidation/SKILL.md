---
name: nightly-consolidation
description: >
  Nightly Obsidian vault consolidation (cron or on demand): triage inboxes,
  wikilink entity mentions, add related-note links, maintain MOCs, write a
  synthesis note. Connects and organizes existing notes only. NOT for: creating
  new facts, tasks, projects, or people, or any user-initiated capture (route
  those to the specialized skills).
---

# Nightly Consolidation

The second brain's sleep cycle. Runs nightly (cron) or on demand. Reads what changed recently, strengthens connections between notes, and surfaces patterns — the way a brain consolidates memory. It connects and organizes; it does not create new facts, tasks, projects, or people.

Use `second-brain` for vault conventions, frontmatter standards, and linking rules. Use `knowledge-base` for the KB-specific review steps.

## What This Job Is Actually For

The mechanical half of this run is enforced by tools and needs no vigilance from you. The valuable half is judgment, and it is the only reason the job exists:

**Find how ideas and topics relate to each other, and make the connection explicit.** A pattern across three notes that nobody wrote down. A journal entry that quietly bears on an active project. A knowledge cluster that has become a topic. That is the work. Link volume is not the score.

`obsidian__linkify` is deliberately dumb — it marks mentions that already exist in the prose. `obsidian__relate` is where you contribute: the tool enforces the shape of a connection, you decide which connections are worth making and say why in your own words.

## Data Source

- Vault config: see `second-brain` -> Vault. All work goes through `obsidian__*` tools; there is no CLI and no shell.
- Synthesis notes: `Syntheses/YYYY-MM-DD.md`, created with `obsidian__note_create`.

## Edit Policy (rationale)

Why the run is shaped the way it is. Each rule names the tool that enforces it, so it needs no vigilance from you.

- Inline edits are limited to entity linking — identical words, only brackets added. *Enforced by `obsidian__linkify`, which is the only tool that edits inside prose and cannot do anything else.*
- Everything else is append-only. *Enforced by the tool surface: `obsidian__section_append`, `obsidian__relate`, and `obsidian__checklist_set` only ever add.*
- Re-runs are idempotent. *Enforced by every write tool skipping content that is already present. A second pass over the same notes changes nothing.*
- Never rewrite, reorder, summarize, or "improve" user prose — daily notes especially.
- Never delete. *Enforced by the tool surface: nothing exposed deletes a note, and only two tools remove a line — `obsidian__inbox_route`, which removes the source line only after verifying the destination write, and `obsidian__inbox_clear`, which removes an inbox line only when the note that captured it exists. Both are bounded to inboxes.*
- Completing a task moves it, sub-items included, rather than removing it. *Enforced by `obsidian__task_update`, which moves a task's whole block between sections.*
- Do not create person or project notes from mentions. Leave unresolved wikilinks as candidates and list them in the report.

## Git Snapshots (required around writes)

The vault is a git repo; these snapshots are the undo story for machine edits.

1. Before the first write: `obsidian__vault_snapshot label="pre-consolidation YYYY-MM-DD" scope="all"` — `scope="all"` parks whatever the user left uncommitted in Obsidian in its own commit, so it is not entangled with the machine's.
2. After the last write: `obsidian__vault_snapshot label="nightly consolidation YYYY-MM-DD"` — the default `scope="machine"` commits only the notes this run wrote. That is what makes the pass revertible on its own: reverting it cannot discard the user's work.

"Nothing to commit" is success, not an error — a clean vault means there was nothing of the user's to protect. A read-only run still costs nothing to snapshot.

Check `git_error` in step 1's `obsidian__vault_status` before relying on any of this. When it is non-null, git is enabled but unusable and every snapshot will fail; report that and stop rather than writing an unprotected pass.

## Workflow

### 1. Find what changed

- `obsidian__vault_status` answers today's date, git state, the last synthesis date, unresolved and orphan counts, and what changed in the last 24 hours — in one call. Start here, always.
- The last synthesis date is the watermark. Process everything changed since then with `obsidian__vault_list changed_since="YYYY-MM-DD"`; if there is no synthesis yet, use the last 48 hours. Quiet nights write no synthesis, so the window may span several days — idempotency makes reprocessing safe.
- Read the last 2-3 synthesis notes for continuity and candidate history.
- If nothing meaningful changed, skip to step 7 and report "no changes"; write nothing to the vault.

### 2. Inbox triage

- Route items out of `Inbox.md` per `second-brain` routing with `obsidian__inbox_route`. It writes the destination, verifies it, and only then removes the inbox line, so an item can never be lost.
- Items that are really tasks go through `obsidian__task_add` instead. Then clear the inbox line with `obsidian__inbox_clear line="…" captured_as="Tasks"` — it removes the line only after checking that the note you named exists, and it refuses to touch anything that is not an inbox. Do not use `obsidian__inbox_route` for this: it always writes the item somewhere before removing it, so routing an already-captured task would file a stray copy into the destination.
- Leave genuinely ambiguous items where they are, with a short `Needs routing:` note.
- Run the `knowledge-base` nightly review for `Knowledge Base/Inbox.md` and loose KB notes.

### 3. Entity linking

One call: `obsidian__linkify since="YYYY-MM-DD"` over the window from step 1, or `obsidian__linkify note="Note Name"` for a single note.

The tool builds the entity list, skips headings, code, URLs, inline tags, frontmatter, and existing links, and links only the first mention per note. A name that two notes answer to is skipped entirely — deciding which one was meant is your job, through `obsidian__relate`, not a guess the linker is allowed to make. Review its report rather than re-checking its work. Pass `dry_run` as true first if you want to see the proposal before it lands.

If the result carries `notes_failed`, some notes could not be written; the rest landed. `obsidian__linkify` is idempotent, so calling it again retries only what is missing.

New unresolved links it surfaces are candidates for the report — do not create the notes.

### 4. Related-notes pass

This is the judgment step. For each note worth connecting:

- Look for genuinely related notes with `obsidian__vault_search`, `obsidian__vault_links`, shared topics, and what you read in step 1.
- `obsidian__relate note="A" target="B" reason="one line on why"` — the reason is mandatory and is the point; a bare link is noise. Add `mirror` when the connection reads as true in both directions.
- Already-linked targets are skipped automatically, so you cannot double up.
- The tool caps new links per note per night, and a mirrored link counts against the target's cap too — so a hub note cannot quietly collect a dozen inbound links in one run. When the target is full the mirror is skipped and the result says so. That cap is a restraint on volume, not on originality. If you keep hitting it with links you believe in, say so in the report.

### 5. MOC and index maintenance

- Per `knowledge-base`: topics with roughly 5+ notes get a MOC, created with `obsidian__note_create type="moc"`. Update existing MOCs with new notes via `obsidian__section_append`.
- Keep `Knowledge Base/README.md` pointing at MOCs and top-level topics, and append the dated review entry there with `keep_newest=20` (see `knowledge-base`). If that index note does not exist yet, create it with `obsidian__note_create type="index" name="Knowledge Base"`.

### 6. Graph hygiene

- `obsidian__vault_links direction="orphans"`: stitch each orphan into the graph via an entity link, a related entry, or a MOC — or list it in the report if it is unclear where it belongs.
- `obsidian__vault_links direction="deadends"`: add outgoing links where honest connections exist.
- `obsidian__vault_links direction="unresolved"`: report as candidate notes the user may want to create. Each entry carries `times_surfaced` — how many past syntheses already proposed it. At 3 or more, stop reporting it and hand it to standup. A name that will never be a note (an OS, a card in a deck list, a passing brand) is not a candidate at all: retire it with `obsidian__link_ignore`, giving the reason in your own words.

### 7. Synthesis

Only when there is something real to say — cross-domain patterns, not restated file lists. Look for:

- Themes recurring across daily notes, projects, and captures.
- Journal or conversation items that quietly relate to an active project.
- Stale threads: pending topics, waiting-on items, projects nothing has touched in a while.
- Clusters forming in the knowledge base that suggest a new topic or MOC.

Create the note with `obsidian__note_create type="synthesis"`, which lays out `## Observations`, `## Changes Made Tonight`, and `## Candidates`. Fill them with `obsidian__section_append`:

- **Observations** — a pattern or connection, with wikilinks to the notes involved and one line on why it matters. This is prose you write, not a template to fill.
- **Changes Made Tonight** — counts: entity links added, related links added, inbox items routed, MOCs touched.
- **Candidates** — unresolved names worth a note, with where they were mentioned. Write the names as plain text, never as `[[wikilinks]]`: a bracketed candidate is a real unresolved link, so proposing one would count as fresh evidence that the user wants it.

No observations and no changes -> no synthesis note. Never write "nothing happened" notes into the vault.

### 8. Report

Reply to the invoking channel with a concise summary: what was routed, how many links were added, notable observations, candidates needing the user's decision, and anything that failed. Keep it a few lines; the synthesis note holds the detail.

## Volume and Restraint

- This job's value compounds from small, correct connections nightly — not from bulk linking. When unsure whether two notes are related, they are not.
- Do not manufacture observations to fill the synthesis. An empty night is a fine outcome.
- Do not re-surface a candidate whose `times_surfaced` has reached 3; standup carries it from there. The server counts for you — do not reconstruct the history by reading old synthesis notes, and do not restate a dropped candidate in the report, which is how the same twelve names survived a rule meant to retire them.

## Safety

- Follow `second-brain` permission guardrails.
- Do not expose private journal or people-note details in the channel report beyond what is needed to describe a connection.
- If a change feels risky or ambiguous, skip it and list it in the report instead.
- Tool errors state the fix. Act on the message rather than retrying the same call; if a tool is genuinely unavailable, stop and say so in the report rather than finding another way in.
