---
name: second-brain
description: >
  Shared coordination layer for all Obsidian vault work: vault config, routing
  rules, frontmatter standards, wikilink conventions, the obsidian__ tool
  surface, and machine edit policy. Use alongside any second-brain skill and to
  decide which specialized skill handles a capture.
---

# Second Brain

Use this skill as the shared Obsidian/vault coordination layer. Keep workflow-specific procedures in the specialized skills.

## Vault

- Vault name: `Obsidian Vault`
- Vault path: `/Users/you/Documents/Obsidian Vault`
- Local timezone: `America/New_York`
- The vault is a git repository (branch `main`). Git is the recovery mechanism for machine edits; automated passes snapshot before and after with `obsidian__vault_snapshot`.

All vault work goes through the `obsidian__*` tools. They talk to the vault filesystem directly — the Obsidian app does not need to be running, and no shell command is involved. Do not shell out to `obsidian-cli`, `git`, `cat`, or `ls` for vault work; those paths are gone.

## Tools

Call `obsidian__vault_status` first in any scheduled or exploratory run. It answers today's date, git dirty state, note counts by type, latest synthesis and daily note, unresolved/orphan counts, and what changed in the last 24 hours — in one call, replacing a dozen exploratory reads.

| Need | Tool |
|---|---|
| Orientation, today's date, git state | `obsidian__vault_status` |
| Find notes by type, folder, status, or change date | `obsidian__vault_list` |
| Read a note or one of its sections | `obsidian__vault_read` |
| Full-text search | `obsidian__vault_search` |
| Backlinks, outgoing links, unresolved, orphans, deadends | `obsidian__vault_links` |
| Add a line under a specific heading | `obsidian__section_append` |
| Add a task | `obsidian__task_add` |
| Change or complete a task | `obsidian__task_update` |
| Commit the vault | `obsidian__vault_snapshot` |

Two rules matter more than the rest:

- **Never construct a file path.** `obsidian__vault_read` takes the note name as it appears in a wikilink — `Wayfinder`, `First Last` — and resolves the path itself. Passing a path you assembled by hand is how notes end up in the wrong place.
- **An empty result is the answer.** No search hits, an empty listing, or a missing daily note means the content does not exist. Do not re-check it another way; move on.

Note bodies for brand-new notes are still written with the native file write/edit tools, directly under the vault path. Everything else — appending into an existing note, task lines, git — goes through the tools above.

Errors from these tools state the fix. Read the message and act on it rather than retrying the same call: a "not found" names the closest existing notes, a missing section lists the sections that exist, and a table section names its columns.

## Permission Guardrails

The tool surface is the guardrail: it exposes no delete, no move, no rename, no plugin control, and no app-level commands, so those cannot happen by accident. Ask the user before doing any of them by other means:

- Permanent deletion, broad deletion, or any delete where intent is ambiguous.
- Plugin/theme/snippet install, uninstall, enable, or disable.
- Restricted mode changes.
- Sync or history restore, restart, developer/debug commands, or arbitrary `eval`.

## Vault Structure

Orientation only — the tools derive paths, so never hand-construct one.

```text
Projects/                       one folder per project
  [Project Name]/
    [Project Name].md           project note, named after the project so [[Project Name]] resolves
    Meeting Notes/              dated meeting notes
    Docs/                       drafts, research, references
People/[First Last].md          one file per person, named with spaces so [[First Last]] resolves
Daily/YYYY-MM-DD.md             daily journal entries
Knowledge Base/                 personal factual/reference notes, organized by topic
  [Topic]/[Topic] MOC.md        map-of-content hub note once a topic matures
Shopping/[Store Name].md        per-store shopping lists (checkbox items)
Ideas/[Idea Name].md            pre-project idea notes with scorecards
Syntheses/YYYY-MM-DD.md         nightly consolidation synthesis notes
Schedule/                       future calendar-related notes
Tasks.md                        centralized checkbox task list
Inbox.md                        quick capture for unprocessed items
Standup.md                      generated standup output
README.md                       system documentation
```

Naming rule: name the note after the thing so wikilinks resolve. Project note = `Projects/[Project Name]/[Project Name].md`. Person note = `People/[First Last].md`. Never create a generic `Overview.md`-style filename; ambiguous filenames break wikilink resolution.

## Frontmatter Standards

Every note gets YAML frontmatter. Frontmatter is the queryable data model for Obsidian Bases and any future UI; wikilinks inside frontmatter also count as graph edges. Quote wikilinks in properties: `people: ["[[First Last]]"]`.

Shared keys on all notes: `type`, `created` (YYYY-MM-DD).

| type | lives in | extra keys |
|------|----------|------------|
| `project` | `Projects/X/X.md` | `status` (Active/On Hold/Blocked/Done), `started`, `people` (wikilink list), `topics` (plain list) |
| `meeting` | `Projects/X/Meeting Notes/` | `project` (wikilink), `date`, `people` (wikilink list) |
| `person` | `People/` | `role`, `projects` (wikilink list) |
| `daily` | `Daily/` | `date` |
| `knowledge` | `Knowledge Base/` | `topic` (Topic/Subtopic), `source` (URL), `topics` (plain list) |
| `moc` | `Knowledge Base/T/T MOC.md` | `topic` |
| `synthesis` | `Syntheses/` | `date` |
| `shopping` | `Shopping/` | `store` |
| `idea` | `Ideas/` | `status` (candidate/researching/promoted/discarded), `topics` |
| `index` | READMEs, Tasks.md, Inbox.md | — |

When touching an existing note that lacks frontmatter, add it with a direct edit at the top of the file. `obsidian__section_append` never touches frontmatter.

## Writing Into Notes

Use `obsidian__section_append` for anything that belongs under an existing heading — daily sections, `## Conversation History`, `## Pending Topics`, `## Related`, activity logs. It finds the section and appends at the end of it, so content cannot land after the wrong heading or at the bottom of the file. When the section holds a table it appends a table row; pass the content pipe-delimited (`| 2026-07-31 | Topic | Summary |`) and it will tell you the columns if you get it wrong.

Repeat calls are safe: identical content is skipped rather than duplicated.

Whole new notes are written with the native file write tool at the path the naming rules above dictate.

## Linking Rules (Wikilinks First)

Links are the graph — backlinks, graph view, and any future UI all come from wikilinks. Every cross-reference between notes must be a wikilink, never plain text:

- Project mentions -> `[[Project Name]]` (resolves to `Projects/[Project Name]/[Project Name].md`).
- Person mentions -> `[[First Last]]`.
- Daily note references -> `[[YYYY-MM-DD]]`.
- Knowledge notes -> `[[Note Title]]`, and link them from projects, tasks, daily notes, and people notes when they contain reusable reference.
- Tasks in `Tasks.md` link their project with `[[Project Name]]` inline — `obsidian__task_add` does this for you from the `project` argument.
- A wikilink to a note that does not exist yet is fine — it is an intentional "unresolved link" that marks a candidate note and still shows in the graph. Do not create the target note just to satisfy the link. `obsidian__vault_links direction=unresolved` lists them.

Other shared rules:

- Use exact project names consistently between the project note and task lines in `Tasks.md`. `obsidian__task_add` rejects a project with no note rather than creating a dangling link.
- Reference tasks from project files by clear task text under `## Related Tasks`.
- Do not turn a knowledge-base capture into a task, project decision, journal entry, or people note unless the user's wording clearly calls for that extra routing.
- Do not infer task completion from project status, or project status from task completion, unless the user says so explicitly.
- Preserve user wording when logging journal or conversation notes, then add concise structure around it.

## Edit Policy for Machine Changes

What automated passes (nightly consolidation, entity linking) may do to existing notes. Where a tool enforces the rule, it is named — that rule needs no vigilance from you.

- Allowed inline: converting a plain-text mention of an existing person, project, or knowledge note into a wikilink — exact same words, only brackets added. Never linkify inside headings, code blocks, URLs, frontmatter values (other than the designated wikilink properties), or text already inside a link.
- Everything else is append-only: `## Related` sections, MOC updates, synthesis notes, review-log entries. *Enforced by `obsidian__section_append`, which only ever appends.*
- Idempotent re-runs: re-running a pass over the same notes must change nothing. *Enforced by `obsidian__section_append` deduping identical content, and by `obsidian__task_add` rejecting near-duplicate tasks.*
- Never rewrite, reorder, or summarize user prose, especially in `Daily/` notes.
- Never delete. Merging means all content lands in the destination. *Enforced by the tool surface: nothing exposed deletes a note.*
- Inbox routing is the one sanctioned move: write the item to its destination first, verify, then remove the routed line from the inbox. Never remove before the destination write succeeded; never leave the item in both places.
- Trimming `## Review Log` entries beyond the ~20 newest is sanctioned bookkeeping, not content deletion.
- Snapshot before and after any automated pass with `obsidian__vault_snapshot`. One reviewable commit per pass is the recovery story.

## Routing

Route to the narrowest matching skill:

- Standup/status synthesis -> use `standup`.
- Questions answered from vault content ("what do I know about X", "what did Sam and I discuss", "summarize my week") -> use `vault-recall`. Read-only; route any resulting changes to the owning skill.
- Project creation, project status, decisions, blockers, project docs, meeting notes, project conversations -> use `project-tracking`.
- Task creation, status changes, due dates, waiting states, priorities, completion -> use `task-tracking`.
- Daily note entries, mood, energy, food, purchases, media consumed as a personal diary item, exercise, personal observations -> use `daily-journal`.
- Person notes, conversations, pending topics, relationship context, project associations -> use `people-notes`.
- Arbitrary facts, reference material, evergreen information, learning notes, how-to links, factual web/video/article captures, and topic notes that are not tied to a project/person/journal -> use `knowledge-base`.
- Nightly linking, inbox triage, MOC maintenance, synthesis -> use `nightly-consolidation`.
- "Pick up X at [store]" / store shopping items -> use `shopping-list` (writes to `Shopping/[Store Name].md`). Errands with deadlines also get a task via `task-tracking`.
- Product/startup idea capture, scoring, comparison, promote-to-project decisions -> use `idea-pipeline` (writes to `Ideas/`).
- Quick captures that are not clearly classifiable -> append to `Inbox.md` and ask only if routing would be risky.

When a request crosses boundaries, use each relevant skill in order. Example: `I talked to Sam about Project X and need to send the proposal Friday` should update people notes, project tracking, and task tracking.

## Knowledge Base Boundary

Use `Knowledge Base/` for information the user wants to keep as reusable reference, not for active work state or personal diary context.

Examples that belong in the knowledge base:

- A YouTube video about bike repair.
- A note about how espresso grind size affects extraction.
- A reference link about small-business tax deadlines.
- A factual summary of a technique, product category, recipe method, tool, framework, or concept.

Examples that do not primarily belong there:

- `Remind me to buy a chain tool` -> `task-tracking`.
- `I worked on my bike today and felt great` -> `daily-journal`.
- `Use this for the HVAC quoting project` -> `project-tracking`, optionally cross-linked to `Knowledge Base/` if it is reusable reference.
- `I talked to Alex about bike repair` -> `people-notes`, optionally cross-linked if factual reference was captured.

## Inbox

Use `Inbox.md` for unprocessed captures. Date every capture — `- YYYY-MM-DD: item` — so triage can see staleness. Do not let items sit there when the user clearly gave enough information to route them into a project, task, daily note, person file, or knowledge-base note.

## Safety

- Do not invent owners, dates, decisions, blockers, relationships, or factual claims.
- If a project/person/task/topic does not exist, create it only when the user's intent is clear. Otherwise, capture to `Inbox.md` with a note about the ambiguity.
- Keep private/personally sensitive material inside the vault; do not repeat unnecessary personal details in public or shared channels.
