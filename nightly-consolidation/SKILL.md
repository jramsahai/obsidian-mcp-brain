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

Use `second-brain` for vault conventions, frontmatter standards, linking rules, and the machine Edit Policy. Use `knowledge-base` for the KB-specific review steps.

## Data Source

- Vault config (name, path, CLI binary, timezone): see `second-brain` -> Vault. Examples assume vault name `Obsidian Vault`.
- Synthesis notes: `Syntheses/YYYY-MM-DD.md` (create the folder on first use).
- If the CLI returns `Vault not found`, follow the `second-brain` recovery steps (`open -g "obsidian://open?vault=Obsidian%20Vault"`, wait ~5s, retry up to 3x) before falling back.
- Only after recovery fails, fall back to direct file reads — bare commands only, no redirects (`2>&1` included), pipes, chains, or globs (see `second-brain` Fallback Hygiene); report plainly if writes were skipped.

## Edit Policy (binding)

- Inline edits limited to entity linking: converting a plain-text mention of an existing person, project, or knowledge note into a `[[wikilink]]` — identical words, only brackets/alias added. Never linkify inside headings, code blocks, URLs, frontmatter values, or text already inside a link.
- Idempotent re-runs: before adding a link, `## Related` entry, or MOC line, check it is not already present. A re-run over the same notes must change nothing.
- All other additions are append-only: `## Related` sections, MOC updates, frontmatter properties, synthesis notes, review-log entries.
- Never rewrite, reorder, summarize, or "improve" user prose. Daily notes especially: linkify mentions, touch nothing else.
- Never delete or merge-with-loss.
- Do not create person or project notes from mentions; leave unresolved wikilinks as candidates and list them in the report.

## Git Snapshots (required around writes)

The vault is a git repo (see `second-brain` -> Vault); these snapshots are the undo story for machine edits. Run each git command separately — no `&&`, pipes, or redirects.

Before the first write of a run:

1. `git -C "<vault path>" status --porcelain` — if it lists changes, snapshot the user's state first:
2. `git -C "<vault path>" add -A`
3. `git -C "<vault path>" commit -m "pre-consolidation snapshot YYYY-MM-DD"`

After the run's last write:

1. `git -C "<vault path>" add -A`
2. `git -C "<vault path>" commit -m "nightly consolidation YYYY-MM-DD"`

This makes every night's machine edits one reviewable, revertible commit. "Nothing to commit" is fine — skip, don't retry. If git itself fails, proceed with the run but say so in the report. A read-only run (no changes) needs no commits.

## Workflow

### 1. Find what changed

- Watermark: the newest note in `Syntheses/` (list with `files folder="Syntheses"`, take the max filename) marks the last run that had something to say. Process everything changed since that date; if no synthesis exists yet, use the last 48 hours. Quiet nights write no synthesis, so the window may span several days — the idempotency rule makes reprocessing safe.
- List changed files with CLI `recents`. Fallback per Fallback Hygiene only: bare `ls -lt "<dir>"` per directory, no globs.
- Read the last 2-3 synthesis notes for continuity and candidate history.
- If nothing meaningful changed, skip to step 7 and report "no changes"; write nothing to the vault.

### 2. Inbox triage

- Route items in `Inbox.md` per `second-brain` routing (tasks -> `Tasks.md`, reference -> `Knowledge Base/`, etc.). Routing is a move: write to the destination first, then remove the routed line from the inbox (see `second-brain` Edit Policy). Leave genuinely ambiguous items with a short `Needs routing:` note.
- Run the `knowledge-base` nightly review for `Knowledge Base/Inbox.md` and loose KB notes.

### 3. Entity linking

Build the known-entity list once per run: project names (`Projects/*/`), people (`People/*.md`), knowledge note titles. Reuse it for every note below.

For each changed note:

- Find plain-text mentions of known entities and convert them to wikilinks per the Edit Policy. First mention per note is enough; do not link every repetition.
- Track new unresolved links (e.g., a `[[Name]]` with no note) as candidates for the report — do not create the notes.

### 4. Related-notes pass

For each changed note (skip trivial ones):

- Search the vault (`search`, `backlinks`, `links`, tags, shared topics) for genuinely related notes.
- Append or extend a `## Related` section: `- [[Other Note]] — one line on why it is related.` Skip targets already linked there.
- The "why" is mandatory; a bare link without a reason is noise.
- Cap at ~5 related links per note per night. Quality over density.
- Mirror strong connections: if A relates to B, B's `## Related` should usually link A too.

### 5. MOC and index maintenance

- Per `knowledge-base`: topics with roughly 5+ notes get a `[Topic] MOC.md`; update existing MOCs with new notes.
- Keep `Knowledge Base/README.md` pointing at MOCs and top-level topics.

### 6. Graph hygiene

- `orphans` (no incoming links): stitch each into the graph via an entity link, a `## Related` entry, or a MOC — or list it in the report if unclear where it belongs.
- `deadends` (no outgoing links): add outgoing links where honest connections exist.
- `unresolved` links: report as candidate notes (people/projects/topics the user may want to create).
- Missing frontmatter on touched notes: add it per `second-brain` standards.

### 7. Synthesis

Only when there is something real to say — cross-domain patterns, not restated file lists. Look for:

- Themes recurring across daily notes, projects, and captures (e.g., three notes this week touch video playback latency).
- Journal or conversation items that quietly relate to an active project.
- Stale threads: pending topics, waiting-on items, or projects nothing has touched in a while.
- Clusters forming in the knowledge base that suggest a new topic or MOC.

Write `Syntheses/YYYY-MM-DD.md`:

```markdown
---
type: synthesis
date: YYYY-MM-DD
created: YYYY-MM-DD
---

# Synthesis — YYYY-MM-DD

## Observations

- Pattern or connection, with [[wikilinks]] to the notes involved and one line on why it matters.

## Changes Made Tonight

- Entity links added: N (notes touched)
- Related links added: N
- Inbox items routed: N
- MOCs created/updated: [[Topic MOC]]

## Candidates

- [[Unresolved Name]] — mentioned in [[2026-07-04]], no person note yet.
```

No observations and no changes -> no synthesis note. Never write "nothing happened" notes into the vault.

### 8. Report

Reply to the invoking channel with a concise summary: what was routed, how many links were added, notable observations, candidates needing the user's decision, and anything that failed. Keep it a few lines; the synthesis note holds the detail.

## Volume and Restraint

- This job's value compounds from small, correct connections nightly — not from bulk linking. When unsure whether two notes are related, they are not.
- Do not manufacture observations to fill the synthesis. An empty night is a fine outcome.
- Do not nudge or re-surface the same candidate more than twice; after that, leave it to standup. Count appearances via the `## Candidates` sections of the last 3 synthesis notes — that is the candidate memory.

## Safety

- Follow `second-brain` permission guardrails; never delete, never restore history, never touch plugins.
- Do not expose private journal or people-note details in the channel report beyond what is needed to describe a connection.
- If a change feels risky or ambiguous, skip it and list it in the report instead.
