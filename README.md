# Second Brain Skills

A set of agent skills for running a personal "second brain" in an [Obsidian](https://obsidian.md) vault: capture, routing, linking, and nightly consolidation, driven by an AI agent instead of manual filing.

## The skills

| Skill | Role |
|-------|------|
| `second-brain` | Shared coordination layer: vault config, routing rules, frontmatter standards, linking conventions, the tool surface, machine edit policy. Read this first. |
| `project-tracking` | Project notes: status, decisions, blockers, docs, task links. |
| `task-tracking` | Centralized checkbox tasks in `Tasks.md` with due dates, priorities, waiting states, and project wikilinks. |
| `people-notes` | Durable per-person notes: conversations, pending topics, project associations. |
| `daily-journal` | Lightweight daily notes without turning journaling into project management. |
| `knowledge-base` | Evergreen reference notes: facts, how-tos, captured articles/videos. |
| `shopping-list` | Per-store shopping lists (`Shopping/[Store].md`). |
| `idea-pipeline` | Capture, score, and pressure-test product/startup ideas before promoting them to tracked projects. |
| `standup` | On-demand or scheduled standup synthesized from project/task state. Read-mostly. |
| `vault-recall` | Read-only Q&A over the vault: "what do I know about X", conversation history, decision lookups, week summaries. |
| `nightly-consolidation` | The "sleep cycle": nightly inbox triage, entity wikilinking, MOC maintenance, synthesis notes. Connects and organizes; never invents content. |
| `skill-tuning` | Monthly, read-only: clusters corrections and review answers into at most three evidenced SKILL.md proposals for the user to merge. Never edits a skill itself. |

Design principles baked in: folder notes so `[[wikilinks]]` resolve naturally, frontmatter on every note, append-only machine edits (except adding wikilink brackets), and explicit routing rules so each capture lands in exactly one home.

## The server

The skills do not touch the vault directly. `server/` is an MCP server that exposes a small set of intent-shaped tools (`obsidian__note_create`, `obsidian__section_append`, `obsidian__task_add`, …) over the vault's files.

The split is deliberate, and it is **mechanism vs. judgment, not safety vs. risk**. The server owns the *shape* of a write — where a note goes, what its frontmatter looks like, that a repeat call changes nothing, that nothing is deleted, that a pass lands in one reviewable commit. The model owns the judgment: which notes are worth connecting and why, what a standup should lead with, whether a capture is reference or a task. Conventions the model would otherwise have to remember are enforced in code and in the tool schemas, because prose it can ignore is not a convention.

## Prerequisites

- **Obsidian** with a vault. The app does not need to be running — the server reads and writes the vault's files directly.
- **Node.js 22+** to build the server.
- **Git in the vault** — `git init` the vault once (ignore `.obsidian/workspace*`, cache, `.trash/`). Nightly consolidation snapshots around its edits, so every automated change is reviewable and revertible. Without git, enable Obsidian's File Recovery plugin at minimum.
- An agent harness that loads these as skills and can run an MCP server (e.g. OpenClaw, Claude Code).

## Setup

1. Build the server:

   ```sh
   cd server && npm install && npm run build
   ```

   This produces the bundled `server/dist/obsidian-mcp.mjs`, which is committed, so this step is only needed after changing `server/src`.

2. Register it with your harness as an MCP server named `obsidian`, running `node /path/to/server/dist/obsidian-mcp.mjs` with this environment:

   | Variable | Required | Meaning |
   |---|---|---|
   | `OBSIDIAN_VAULT` | yes | Absolute path to the vault |
   | `VAULT_TZ` | no | IANA timezone for "today". Default `America/New_York` |
   | `VAULT_GIT` | no | `1` enables `obsidian__vault_snapshot` |
   | `VAULT_GIT_BIN` | no | Path to git. Default `/usr/bin/git` — set this to `/opt/homebrew/bin/git` if that is where yours lives |

   If the harness gates tool access by an allowlist, allow `obsidian__*`, and drop shell/file-write tools for the agent that runs these skills — the tools cover what they did, and leaving them enabled reintroduces the unguarded writes this design exists to prevent.

3. Update the **Vault** block of `second-brain/SKILL.md` with your vault path and timezone. That block is the single source of truth for the skills; the server reads its own config from the environment above.

4. Optional: schedule `nightly-consolidation` (e.g. nightly cron) and `standup` (e.g. weekday mornings) in your harness. `cron/jobs.json` holds the prompts and tool allowlists both jobs run with — a scheduled prompt is prose the model obeys exactly like a skill, so it is version-controlled and linted alongside them. Delivery targets are not stored there.

   Two things those jobs depend on, both learned the hard way:

   - **The agent's model decides whether it has any vault tools at all.** MCP servers attach only on models using the `openai-completions` API. A model on the ChatGPT-responses path gets no `obsidian__*` tools, silently, and improvises a shell fallback instead — so pin the agent to a model you have verified, and do not leave a responses-API model in its fallback chain.
   - **A prompt must name the skill files it depends on by full path.** Once shell access is removed there is no directory-listing tool, so an agent can read a path it knows but cannot discover one it does not. A `read` that lands on a directory fails with `EISDIR` and there is no recovery.

## Development

```sh
cd server
npm test          # 198 tests, including a drift lint over every SKILL.md
npm run check     # tsc --noEmit
npm run build     # rebuild dist/obsidian-mcp.mjs
```

The drift lint is the reason the prose and the tools stay in sync: it fails the build when a SKILL.md names a tool, argument, or enum value that does not exist, shows a worked example missing a required argument, or reintroduces an instruction from the pre-server era.

## Self-improvement loop

The model never edits its own instructions in place. Instead the system measures itself three ways, and once a month turns the measurements into proposals the user reviews and merges by hand:

1. **Reject rate** — `npm run reject-rate -- [vaultPath] [--since YYYY-MM-DD] [--json]`. Walks the vault's git history, finds every line an automated pass (a `pre-consolidation`/`nightly consolidation` snapshot) added, and checks whether a later commit removed that exact line within 14 days. Reports added/rejected/rate overall, per ISO week, by file, and by what kind of line it was (a wikilink insertion, a `Related` bullet, a synthesis line, a task line, or other).
2. **Similarity calibration** — `npm run calibrate -- [vaultPath] [--json]`. Reproduces the measurement documented in `server/src/similar.ts`'s header: scores every pair of entries that share one `### YYYY-MM-DD` block, and every pair of rows in one table, across the vault. Reports pair counts, the highest-scoring pair, how many pairs sit at or above `SIMILARITY_THRESHOLD`, and the gap between the threshold and the highest score among the pairs that stay under it — the signal for whether the threshold still fits a vault that has grown since it was chosen.
3. **Corrections and review answers** — the `Corrections` note (written by another tool; a `| Date | Skill | What happened | What was wanted | Rule |` table), the last few `Reviews/` notes, and rows recently added to `Ignored Links.md`. These are read, never generated by a script.

The `skill-tuning` skill runs monthly (cron, the 1st at 09:00) or on demand, reads all three signals, clusters repeated corrections by skill and rule, and replies with at most three proposals — each naming the skill file, the current wording, the proposed wording, the evidence with dates, and what it deliberately leaves alone. It writes nothing to the vault and edits no skill file itself: a proposal becomes real only when the user applies it through a pull request that keeps `npm test` and the behavioral evals green.

## Vault layout the skills expect

```
Vault/
├── Inbox.md            # unrouted captures
├── Tasks.md            # central checkbox tasks
├── Standup.md          # last generated standup
├── Daily/YYYY-MM-DD.md
├── Projects/[Name]/[Name].md
├── People/[First Last].md
├── Knowledge Base/
├── Ideas/
├── Shopping/[Store].md
└── Syntheses/YYYY-MM-DD.md
```

Folders are created on first use; no scaffolding step required.
