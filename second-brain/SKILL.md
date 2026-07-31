---
name: second-brain
description: >
  Shared coordination layer for all Obsidian vault work: vault config, routing
  rules, frontmatter standards, wikilink conventions, CLI usage and recovery,
  permission guardrails, machine edit policy. Use alongside any second-brain
  skill and to decide which specialized skill handles a capture.
---

# Second Brain

Use this skill as the shared Obsidian/vault coordination layer. Keep workflow-specific procedures in the specialized skills.

## Vault

Single source of truth for vault config. Edit these values for your setup; the other second-brain skills reference this block.

- Vault name: `Obsidian Vault`
- Vault path: `~/Documents/Obsidian Vault/`
- CLI: `/usr/local/bin/obsidian` (obsidian-cli talking to the running Obsidian app)
- Local timezone: `America/New_York` (used for daily notes and date defaults)
- The vault is a git repository (branch `main`). Git is the recovery mechanism for machine edits — prefer `/usr/bin/git -C "/Users/you/Documents/Obsidian Vault"` inspection/revert over `sync:restore` or `history:restore`. Automated passes snapshot before and after edits (see `nightly-consolidation`). Run git commands one at a time; never chain with `&&`.
- Invoke every binary by absolute path: `/usr/bin/git`, `/usr/local/bin/obsidian`, `/bin/cat`, `/bin/ls`. A bare command name (`git`, `cat`) does not match the exec allowlist and is denied outright. Do not pass the vault path as `~/Documents/Obsidian\ Vault` — use the quoted absolute form `"/Users/you/Documents/Obsidian Vault"`.
- Always pass `vault="Obsidian Vault"` to Obsidian CLI commands.
- If your vault is named differently, substitute the name in every `vault=` argument shown across these skills.
- Use command order: `/usr/local/bin/obsidian <command> vault="Obsidian Vault" ...`
- CLI `file=`/`path=` arguments are vault-relative. Never pass an absolute filesystem path — the CLI treats it as relative and silently creates a nested `Users/...` mirror tree inside the vault.
- Prefer the Obsidian CLI for search, read, move, rename, properties, links, tags, and backlinks — operations whose arguments are simple paths and queries that pass exec approval cleanly.
- Write note bodies with the native file write/edit tools directly under `~/Documents/Obsidian Vault/` — never as a CLI `content=` argument. Multi-line or escaped content (`\n`/`\u{A}` escapes, `$`, backticks, backslashes) trips OpenClaw's dynamic-argument detection and forces a manual exec approval every time, even though the CLI binary is allowlisted. This covers `create` and any multi-line `append`/`prepend`. Obsidian picks up filesystem changes automatically. Exception: a short single-line plain-text `append`/`prepend` (e.g. an Inbox capture line) is fine via CLI.
- Shell file fallback (`cat`, `ls`) only when the CLI is unreachable after the recovery steps below.

### CLI Errors Are Authoritative

A CLI `File not found`, empty search result, or empty `files` listing is the answer, not a malfunction: the note or folder content does not exist. Do not re-verify with shell reads or `ls` — that burns an exec approval to confirm what the CLI already said. Missing notes are normal (e.g., no daily note on a day with no entries, no synthesis before the first nightly run); skip and move on. Shell fallback exists only for the case below, where the CLI itself is unreachable. To find the newest note in a folder of date-named files, list with `files folder="..."` and take the max filename — never shell `ls -lt`.

### "Vault not found" Recovery

The CLI talks to the running Obsidian app. `Vault not found` means the vault window is closed, still loading, or suspended (App Nap) — NOT a vault name/path problem. Even `version` and `help` return it. Do not retry vault-name variants; recover instead:

1. Run `open -g "obsidian://open?vault=Obsidian%20Vault"` (launches app and/or opens the vault window in background).
2. Wait ~5 seconds, retry the command.
3. Still failing: retry up to 3 times total — a freshly opened or napping window wakes progressively (vault resolves before all commands register; `Command not found. It may require a plugin` right after a wake is also transient).
4. Only after 3 failed retries, fall back to direct file operations and report that the CLI was unreachable.

### Fallback Hygiene

Direct-file fallback commands go through OpenClaw's exec approval. Allowlisted binaries auto-run only for simple invocations — redirects (`2>/dev/null`), pipes (`| head`), and globs (`*.md`) each force a manual approval prompt. In non-interactive runs (cron) there is nobody to approve, so a prompt is a hard denial. In fallback mode:

- Always use the absolute binary path with no shell decoration: `/bin/cat "<absolute path>"`, `/bin/ls -lt "<dir>"`. A bare `cat` or `ls` may miss the allowlist and be denied.
- No redirects of any kind — `2>&1` and `2>/dev/null` both count and force a prompt. Errors surface fine without them; never add one to capture stderr.
- Never chain with `&&` or `;`, never pipe, never glob (`*.md`) — list the directory first, then read explicit paths.
- Prefer native file read/list tools over shell when available.

Useful commands:

```bash
/usr/local/bin/obsidian read vault="Obsidian Vault" file="Tasks"
/usr/local/bin/obsidian read vault="Obsidian Vault" path="Projects/Example Project/Example Project.md"
/usr/local/bin/obsidian search vault="Obsidian Vault" query="Status: Active" format=json
/usr/local/bin/obsidian append vault="Obsidian Vault" file="Inbox" content="- YYYY-MM-DD: capture"
/usr/local/bin/obsidian files vault="Obsidian Vault" folder="Projects" ext=md
/usr/local/bin/obsidian backlinks vault="Obsidian Vault" file="Example Project"
/usr/local/bin/obsidian orphans vault="Obsidian Vault"
/usr/local/bin/obsidian unresolved vault="Obsidian Vault"
/usr/local/bin/obsidian property:set vault="Obsidian Vault" file="Note" name="status" value="Active"
```

## Permission Guardrails

Routine second-brain work can use the approved Obsidian CLI path without asking first:

- Inspecting vault state: `version`, `vault`, `vaults`, `files`, `folders`, `read`, `search`, `search:context`, `outline`, `wordcount`.
- Inspecting note relationships: `tags`, `aliases`, `links`, `backlinks`, `unresolved`, `orphans`, `deadends`, `properties`, `property:read`.
- Managing normal notes: `move`, `rename`, `property:set`, `property:remove`, normal `daily:*` note operations, short single-line `append`/`prepend`, and direct file writes/edits of note bodies (see Vault rules).
- Managing tasks through Obsidian's task commands when the user's intent is explicit.

Ask the user before destructive, app-level, or code-execution operations:

- Permanent deletion, broad deletion, or any delete where intent is ambiguous.
- Plugin/theme/snippet install, uninstall, enable, or disable.
- Restricted mode changes.
- `sync:restore`, `history:restore`, `restart`, developer/debug commands, or arbitrary `eval`.

Direct Markdown writes/edits under `~/Documents/Obsidian Vault/` via the native file tools need no exec approval and are the default for note bodies. CLI `content=` arguments carrying multi-line or escaped text force a manual exec approval — avoid them (see Vault).

## Vault Structure

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
Ideas/[Idea Name].md            pre-project idea notes with scorecards (folder if research accumulates)
Syntheses/YYYY-MM-DD.md         nightly consolidation synthesis notes
Schedule/                       future calendar-related notes
Tasks.md                        centralized checkbox task list
Inbox.md                        quick capture for unprocessed items
Standup.md                      generated standup output
README.md                       system documentation
```

Naming rule: name the note after the thing so wikilinks resolve. Project note = `Projects/[Project Name]/[Project Name].md`. Person note = `People/[First Last].md`. Never create a second `Overview.md`-style generic filename; ambiguous filenames break wikilink resolution.

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

When touching an existing note that lacks frontmatter, add it. Use `property:set` or a direct edit at the top of the file.

## Writing Into Notes

CLI `append`/`prepend` operate on the whole file. That is correct for short single-line additions to flat list files (`Inbox.md`, `Shopping/*.md`, `Knowledge Base/Inbox.md`); multi-line additions (e.g. a brand-new section at the end of a note) go through direct file edit instead — multi-line `content=` args force an exec approval (see Vault). File-level append is wrong for adding content under an existing heading of a templated note (daily sections, `## Conversation History` tables, `## Pending Topics`, `## Related`) — file-level append dumps the content after the last section instead. For section-targeted additions: read the note, then edit it so the new line lands at the end of the correct section.

## Linking Rules (Wikilinks First)

Links are the graph — backlinks, graph view, and any future UI all come from wikilinks. Every cross-reference between notes must be a wikilink, never plain text:

- Project mentions -> `[[Project Name]]` (resolves to `Projects/[Project Name]/[Project Name].md`).
- Person mentions -> `[[First Last]]`.
- Daily note references -> `[[YYYY-MM-DD]]`.
- Knowledge notes -> `[[Note Title]]`, and link them from projects, tasks, daily notes, and people notes when they contain reusable reference.
- Tasks in `Tasks.md` link their project with `[[Project Name]]` inline in the task line.
- A wikilink to a note that does not exist yet is fine — it is an intentional "unresolved link" that marks a candidate note and still shows in the graph. Do not create the target note just to satisfy the link.

Other shared rules:

- Use exact project names consistently between the project note and task lines in `Tasks.md`.
- Reference tasks from project files by clear task text under `## Related Tasks`.
- Do not turn a knowledge-base capture into a task, project decision, journal entry, or people note unless the user's wording clearly calls for that extra routing.
- Do not infer task completion from project status, or project status from task completion, unless the user says so explicitly.
- Preserve user wording when logging journal or conversation notes, then add concise structure around it.

## Edit Policy for Machine Changes

What automated passes (nightly consolidation, entity linking) may do to existing notes:

- Allowed inline: converting a plain-text mention of an existing person, project, or knowledge note into a wikilink — exact same words, only brackets added. Never linkify inside headings, code blocks, URLs, frontmatter values (other than the designated wikilink properties), or text already inside a link.
- Everything else is append-only: `## Related` sections, MOC updates, synthesis notes, review-log entries.
- Idempotent re-runs: before adding a link, `## Related` entry, or MOC line, check it is not already present. Re-running a pass over the same notes must change nothing.
- Never rewrite, reorder, or summarize user prose, especially in `Daily/` notes.
- Never delete. Merging means all content lands in the destination.
- Inbox routing is the one sanctioned move: route an item out of `Inbox.md` or `Knowledge Base/Inbox.md` by writing it to its destination first, then removing the routed line from the inbox. Never remove before the destination write succeeded; never leave the item in both places.
- Trimming `## Review Log` entries beyond the ~20 newest is sanctioned bookkeeping, not content deletion.

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
