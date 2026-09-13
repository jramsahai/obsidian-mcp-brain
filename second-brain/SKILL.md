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

- The vault path and local timezone are the server's configuration (`OBSIDIAN_VAULT`, `VAULT_TZ`), not this file's. Never assume either; `obsidian__vault_status` reports today's date in the vault's timezone.
- The vault is a git repository (branch `main`). Git is the recovery mechanism for machine edits; automated passes snapshot before and after with `obsidian__vault_snapshot`.

All vault work goes through the `obsidian__*` tools. They talk to the vault filesystem directly — the Obsidian app does not need to be running, and no shell command is involved. Never shell out for vault work: not to a command-line vault client, not to `git`, `cat`, or `ls`. Those paths are gone, and the tools cover what they did.

## Tools

Call `obsidian__vault_status` first in any scheduled or exploratory run. It answers today's date, git dirty state, note counts by type, latest synthesis and daily note, unresolved/orphan counts, and what changed in the last 24 hours — in one call, replacing a dozen exploratory reads.

| Need | Tool |
|---|---|
| Orientation, today's date, git state | `obsidian__vault_status` |
| Find notes by type, folder, status, or change date | `obsidian__vault_list` |
| Read a note or one of its sections | `obsidian__vault_read` |
| Full-text search | `obsidian__vault_search` |
| Backlinks, outgoing links, unresolved, orphans, deadends | `obsidian__vault_links` |
| Create a new note of any kind | `obsidian__note_create` |
| Add a line under a specific heading | `obsidian__section_append` |
| Add a dated entry to a running log | `obsidian__log_append` |
| Add a task | `obsidian__task_add` |
| Change or complete a task | `obsidian__task_update` |
| Log a personal journal entry | `obsidian__daily_log` |
| Add, merge, or check off a checkbox item | `obsidian__checklist_set` |
| Record that two notes are connected | `obsidian__relate` |
| Log a correction the user made | `obsidian__correction_log` |
| See correction counts and patterns | `obsidian__corrections_summary` |
| Capture a line into the inbox | `obsidian__inbox_add` |
| Move an item out of an inbox | `obsidian__inbox_route` |
| Drop an inbox line already captured elsewhere | `obsidian__inbox_clear` |
| Change one frontmatter field | `obsidian__note_set_field` |
| Turn plain-text mentions into wikilinks | `obsidian__linkify` |
| Regenerate `Standup.md` | `obsidian__standup_write` |
| Commit the vault | `obsidian__vault_snapshot` |

Two rules matter more than the rest:

- **Never construct a file path.** `obsidian__vault_read` takes the note name as it appears in a wikilink — `Wayfinder`, `First Last` — and resolves the path itself. Passing a path you assembled by hand is how notes end up in the wrong place.
- **An empty result is the answer.** No search hits, an empty listing, or a missing daily note means the content does not exist. Do not re-check it another way; move on.

Never write a vault file with the native file write/edit tools. `obsidian__note_create` derives the path, emits the frontmatter, and lays out the sections; `obsidian__section_append` fills them in.

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
Corrections.md                  log of corrections the user made, for counting patterns
Inbox.md                        quick capture for unprocessed items
Standup.md                      generated standup output
README.md                       system documentation
```

Naming rule: name the note after the thing so wikilinks resolve. Project note = `Projects/[Project Name]/[Project Name].md`. Person note = `People/[First Last].md`. Never create a generic `Overview.md`-style filename; ambiguous filenames break wikilink resolution.

## Frontmatter Standards

Every note gets YAML frontmatter — it is the queryable data model for Obsidian Bases and any future UI, and wikilinks inside it count as graph edges.

You do not write it. `obsidian__note_create` emits the correct keys for the type you ask for, quotes wikilinks in properties, and stamps `created`. The `type` enum in its schema is the list of note kinds; its `fields` argument takes anything extra (`{"status":"On Hold","people":"Jane Doe"}`).

To change a property on a note that already exists, use `obsidian__note_set_field` — it edits that one line and leaves every other byte of the block alone. Which value is right is your judgment; the YAML is not, so do not hand-write it. Keys that decide where a note lives (`type`, `created`, `date`, `project`, `topic`) cannot be changed this way; the field enum lists what can.

Existing notes that predate this and lack frontmatter are left as they are. `obsidian__section_append` never touches frontmatter.

## Writing Into Notes

- **A new note of any kind** -> `obsidian__note_create`. It derives the path from type and name, so `[[Wikilinks]]` to it resolve. It never overwrites a note that already has content — the call succeeds with `created: false` and a reason, so branch on that and append instead. It refuses generic names like `Overview`, and names containing `#`, `|`, `[`, or `]`, which would break the wikilink to the note.
- Template notes (frontmatter `template: true`) are not writable by any tool. A write to one is refused, because every note later created from it would inherit the contamination.
- **Content under an existing heading** -> `obsidian__section_append`. It appends at the end of the *named section*, so content cannot land after the wrong heading or at the bottom of the file. When the section holds a table it appends a table row; pass the content pipe-delimited (`| 2026-07-31 | Topic | Summary |`) and it names the columns if you get it wrong.
- **A dated entry in a running log** -> `obsidian__log_append`. A project note's `## Activity Log` and an index note's `## Review Log` are built from `### YYYY-MM-DD` blocks; it writes that heading for you, keeps the newest date at the top, and merges a same-day second entry into that day's block. Pass the entry text only. `obsidian__section_append` on such a section drops a bare line above the first date heading, which is not an entry and is not where a reader looks.
- **A journal entry** -> `obsidian__daily_log`. **A checkbox item** -> `obsidian__checklist_set`. **A task** -> `obsidian__task_add`.

Repeat calls are safe: identical content is skipped, and in a dated log block or a table a *reworded* repeat is refused too, quoting the entry it resembles.

Treat that refusal as information about yourself, not an obstacle. It means you already wrote this earlier in the turn — the write landed, and the reply you have not sent yet is the only thing still missing. Rewording and retrying is what produced three copies of one board purchase and two of one conversation on 2026-08-02. `allow_similar=true` is for a genuinely separate event that reads alike; `obsidian__log_remove` is how a mistaken entry comes back out, so no vault fix ever needs a direct file edit.

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

- Allowed inline: converting a plain-text mention of an existing person, project, or knowledge note into a wikilink — exact same words, only brackets added. *Enforced by `obsidian__linkify`, the only tool that edits inside prose. It skips headings, code, URLs, frontmatter, and existing links, and links only the first mention per note.*
- Everything else is append-only: `## Related` sections, MOC updates, synthesis notes, review-log entries. *Enforced by `obsidian__section_append`, `obsidian__log_append`, and `obsidian__relate`, which only ever append.*
- Idempotent re-runs: re-running a pass over the same notes must change nothing. *Enforced by every write tool skipping content already present — `obsidian__section_append` dedupes, `obsidian__log_append` joins the day's existing block instead of starting another, `obsidian__task_add` rejects near-duplicates, `obsidian__relate` skips linked targets, `obsidian__checklist_set` merges into the existing line, `obsidian__linkify` sees its own brackets.*
- Never rewrite, reorder, or summarize user prose, especially in `Daily/` notes.
- Never delete. Merging means all content lands in the destination. *Enforced by the tool surface: nothing exposed deletes a note, and only two tools remove a line at all — both bounded to inboxes, and both requiring the content to exist elsewhere first.*
- Inbox routing is the one sanctioned move. *Enforced by `obsidian__inbox_route`, which writes the destination, verifies it, and only then removes the source line — so the item cannot end up nowhere. `obsidian__inbox_clear` covers the other half: an item already captured by `obsidian__task_add` or `obsidian__note_create` is cleared by naming the note that took it.*
- Connections between notes are the model's judgment, not the server's. `obsidian__relate` fixes the shape of a connection and caps how many one note takes in a night — inbound mirrored links included; deciding *which* notes are related, and writing the reason, is yours.
- A bounded log stays bounded in the same write: `obsidian__log_append` with `keep_newest=20` caps a `## Review Log` at its 20 newest dated blocks as it appends. `obsidian__section_append`'s own `keep_newest` covers flat lists only, and refuses a dated section by name rather than deleting whole days around a line it cannot count. This is the only sanctioned trimming, and it is not content deletion.
- `Standup.md` is the one generated note, replaced whole each morning by `obsidian__standup_write`. No other note can be replaced, and the native write tools remain off-limits everywhere including here.
- Snapshot around any automated pass with `obsidian__vault_snapshot`: `scope="all"` first to park the user's own uncommitted edits, then the default `scope="machine"` after, which commits only what the pass wrote. One reviewable commit per pass is the recovery story, and scoping is what keeps reverting it from discarding the user's work.

## Routing

Route to the narrowest matching skill:

- Standup/status synthesis -> use `standup`.
- Questions answered from vault content ("what do I know about X", "what did Sam and I discuss", "summarize my week") -> use `vault-recall`. Read-only; route any resulting changes to the owning skill.
- Project creation, project status, decisions, blockers, project docs, meeting notes, project conversations -> use `project-tracking`.
- A meeting transcript, a dictated recap, or bullet notes from a call/meeting (including voice bridge captures) -> use `meeting-notes` to ingest it; it routes the results into `project-tracking`, `task-tracking`, and `people-notes`.
- Task creation, status changes, due dates, waiting states, priorities, completion -> use `task-tracking`.
- Daily note entries, mood, energy, food, purchases, media consumed as a personal diary item, exercise, personal observations -> use `daily-journal`.
- Person notes, conversations, pending topics, relationship context, project associations -> use `people-notes`.
- Arbitrary facts, reference material, evergreen information, learning notes, how-to links, factual web/video/article captures, and topic notes that are not tied to a project/person/journal -> use `knowledge-base`.
- Nightly linking, inbox triage, MOC maintenance, synthesis -> use `nightly-consolidation`.
- "Pick up X at [store]" / store shopping items -> use `shopping-list` (writes to `Shopping/[Store Name].md`). Errands with deadlines also get a task via `task-tracking`.
- Product/startup idea capture, scoring, comparison, promote-to-project decisions -> use `idea-pipeline` (writes to `Ideas/`).
- Quick captures that are not clearly classifiable -> when no rule fits or the capture is ambiguous, `obsidian__inbox_add` it rather than guessing.

When a request crosses boundaries, use each relevant skill in order. Example: `I talked to Sam about Project X and need to send the proposal Friday` should update people notes, project tracking, and task tracking.

## When The User Corrects You

If the user corrects something the agent did, log it before doing anything else: `obsidian__correction_log skill="task-tracking" did="marked the task done from a status update" wanted="wait for explicit completion language"`. One call per correction — `did` and `wanted` in plain words, naming the skill that was in play. Then apply the fix. Never re-litigate: the correction is recorded, so there is nothing left to argue.

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

Use `obsidian__inbox_add` for unprocessed captures — it dates the entry and creates `Inbox.md` if needed, so triage can see staleness. Do not let items sit there when the user clearly gave enough information to route them into a project, task, daily note, person file, or knowledge-base note.

## Safety

- Do not invent owners, dates, decisions, blockers, relationships, or factual claims.
- If a project/person/task/topic does not exist, create it only when the user's intent is clear. Otherwise, capture to `Inbox.md` with a note about the ambiguity.
- Keep private/personally sensitive material inside the vault; do not repeat unnecessary personal details in public or shared channels.
