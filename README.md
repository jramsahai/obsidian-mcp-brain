# Second Brain Skills

A set of agent skills for running a personal "second brain" in an [Obsidian](https://obsidian.md) vault: capture, routing, linking, and nightly consolidation, driven by an AI agent instead of manual filing.

This repo is the core of a larger setup — a vault, an agent, and optionally a voice front end and a handheld — described in [The whole system](#the-whole-system) at the end.

## The skills

| Skill | Role |
|-------|------|
| `second-brain` | Shared coordination layer: vault config, routing rules, frontmatter standards, linking conventions, the tool surface, machine edit policy. Read this first. |
| `project-tracking` | Project notes: status, decisions, blockers, docs, task links. |
| `task-tracking` | Centralized checkbox tasks in `Tasks.md` with due dates, priorities, waiting states, and project wikilinks. |
| `people-notes` | Durable per-person notes: conversations, pending topics, project associations. |
| `meeting-notes` | Ingests a meeting transcript, dictated recap, or bullet notes into a meeting note, project decisions, tasks, and people-note history. |
| `daily-journal` | Lightweight daily notes without turning journaling into project management. |
| `knowledge-base` | Evergreen reference notes: facts, how-tos, captured articles/videos. |
| `shopping-list` | Per-store shopping lists (`Shopping/[Store].md`). |
| `idea-pipeline` | Capture, score, and pressure-test product/startup ideas before promoting them to tracked projects. |
| `standup` | On-demand or scheduled standup synthesized from project/task state. Read-mostly. |
| `weekly-review` | Once-a-week pass: what shipped, what slipped, quiet projects, and three questions for the user. Read-mostly, plus applying the user's own prior answers. |
| `vault-recall` | Read-only Q&A over the vault: "what do I know about X", conversation history, decision lookups, week summaries. |
| `nightly-consolidation` | The "sleep cycle": nightly inbox triage, entity wikilinking, MOC maintenance, synthesis notes. Connects and organizes; never invents content. |
| `skill-tuning` | Monthly, read-only: clusters corrections and review answers into at most three evidenced SKILL.md proposals for the user to merge. Never edits a skill itself. |
| `resurfacing` | Monthly pass over projects, people, and knowledge notes that have gone quiet (90+ days with no dated entry): proposes keep/archive/link-elsewhere for each, and writes only what the user answers. |

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

3. The skills carry no vault path or timezone of their own: the environment above is the single source of truth, and the tools report the date and vault state to the model.

4. Optional: schedule `nightly-consolidation` (e.g. nightly cron), `standup` (e.g. weekday mornings), `weekly-review` (e.g. Sunday evening), `skill-tuning` (e.g. monthly), and `resurfacing` (e.g. the 15th of each month) in your harness. `cron/jobs.json` holds the prompts and tool allowlists all five jobs run with — a scheduled prompt is prose the model obeys exactly like a skill, so it is version-controlled and linted alongside them. Delivery targets are not stored there.

   Two things those jobs depend on, both learned the hard way:

   - **The agent's model decides whether it has any vault tools at all.** MCP servers attach only on models using the `openai-completions` API. A model on the ChatGPT-responses path gets no `obsidian__*` tools, silently, and improvises a shell fallback instead — so pin the agent to a model you have verified, and do not leave a responses-API model in its fallback chain.
   - **A prompt must name the skill files it depends on by full path.** Once shell access is removed there is no directory-listing tool, so an agent can read a path it knows but cannot discover one it does not. A `read` that lands on a directory fails with `EISDIR` and there is no recovery.

## Development

```sh
cd server
npm test          # 287 tests, including a drift lint over every SKILL.md
npm run check     # tsc --noEmit
npm run build     # rebuild dist/obsidian-mcp.mjs
npm run evals     # behavioral evals against a model — see below, not part of npm test
```

The drift lint is the reason the prose and the tools stay in sync: it fails the build when a SKILL.md names a tool, argument, or enum value that does not exist, shows a worked example missing a required argument, or reintroduces an instruction from the pre-server era.

### Behavioral evals

The drift lint checks prose against schemas — that a SKILL.md's tool calls would actually run. It proves nothing about whether the model that reads a SKILL.md picks the right tool at all. `server/evals/` is the other half: given a capture, does the model call the right tools with the right arguments, in a fresh copy of the fixture vault? This is the gate every later change to a SKILL.md — and every self-improvement proposal — has to pass before it ships.

Each scenario in `server/evals/scenarios/*.json` names the skills to load (`second-brain` plus whatever the scenario lists, concatenated into one system prompt exactly like a real harness would), a user message, and what must happen: `expect_calls` (tool + a partial match on its arguments — string values match exactly, or as a regex when written `"/pattern/flags"`), `forbid_calls` (tool names that must not be called — e.g. every write tool for a read-only question), and `expect_files` (a vault-relative path plus regex patterns its final content must match). `ordered: true` on an `expect_calls` entry means it must land after every earlier `ordered` entry, so a scenario can pin "create the store list before adding to it" without having to spell out the whole transcript — `expect_calls` should be the minimal set that proves routing, not a full transcript.

Run it against any OpenAI-compatible chat-completions endpoint with tool calling — a local `llama-server`, or a hosted one:

```sh
EVAL_MODEL=your-model-name npm run evals                 # defaults to http://127.0.0.1:8080/v1
EVAL_BASE_URL=https://api.example.com/v1 EVAL_MODEL=... EVAL_API_KEY=sk-... npm run evals
node evals/run.ts --only shopping-new-store               # one scenario
node evals/run.ts --dry-run                                # validate scenarios, print system-prompt size and tool count, call no model
```

Each scenario copies the fixture vault fresh (`test/helpers.ts`'s `useVault()`), runs up to `max_steps` (default 6) assistant turns with every real tool handler wired in — a tool call the model makes actually writes to that scenario's temp vault, the same as it would to the real one — and reports PASS/FAIL, steps taken, and the first mismatch. A full JSON report (every call made, per-scenario pass/fail) is written to `server/evals/last-run.json`, which is gitignored. The run exits 1 if any scenario fails.

To add a scenario: drop a new `*.json` file in `server/evals/scenarios/`, matching the shape above. `server/test/evals-scenarios.test.ts` (part of `npm test`, no model involved) validates every scenario file, checks it references only real skills and real tools, and runs `--dry-run` end to end — so a broken scenario file fails the normal test suite before anyone spends a model call on it.

**Editing a SKILL.md must keep the evals green.** The scenarios are the only thing standing between a rewording that reads fine and one that quietly changes which tool the model reaches for.

**Model note:** the evals harness has no way to reach a model from CI as shipped — it needs `EVAL_MODEL` pointed at a real OpenAI-compatible endpoint (a local `llama-server` is the intended default). Everything except the actual model round-trip is exercised by `--dry-run` and `evals-scenarios.test.ts`.

**Tool naming:** the tools are presented to the model as `obsidian__<name>` — the spelling OpenClaw exposes them under, and the spelling the skills themselves use. A different host may prefix them differently (Claude Code uses `mcp__obsidian__<name>`); the evals do not model that, since they are checking the skills' own prose against tool behavior, not a specific host's wiring.

## Self-improvement loop

The model never edits its own instructions in place. Instead the system measures itself three ways, and once a month turns the measurements into proposals the user reviews and merges by hand. The agent has no shell, so it cannot run the two npm scripts below itself — `obsidian__vault_signals` puts the same three measurements (plus corrections and recently ignored links) behind one read tool it can call directly; the scripts remain for a human at a terminal.

1. **Reject rate** — `npm run reject-rate -- [vaultPath] [--since YYYY-MM-DD] [--json]`. Walks the vault's git history, finds every line an automated pass (a `pre-consolidation`/`nightly consolidation` snapshot) added, and checks whether a later commit removed that exact line within 14 days. Reports added/rejected/rate overall, per ISO week, by file, and by what kind of line it was (a wikilink insertion, a `Related` bullet, a synthesis line, a task line, or other).
2. **Similarity calibration** — `npm run calibrate -- [vaultPath] [--json]`. Reproduces the measurement documented in `server/src/similar.ts`'s header: scores every pair of entries that share one `### YYYY-MM-DD` block, and every pair of rows in one table, across the vault. Reports pair counts, the highest-scoring pair, how many pairs sit at or above `SIMILARITY_THRESHOLD`, and the gap between the threshold and the highest score among the pairs that stay under it — the signal for whether the threshold still fits a vault that has grown since it was chosen.
3. **Corrections and review answers** — the `Corrections` note (written by `obsidian__correction_log` whenever the user corrects the agent, summarized by `obsidian__corrections_summary`), the last few `Reviews/` notes, and rows recently added to `Ignored Links.md`. These are read, never generated by a script.

The `skill-tuning` skill runs monthly (cron, the 1st at 09:00) or on demand, reads all three signals, clusters repeated corrections by skill and rule, and replies with at most three proposals — each naming the skill file, the current wording, the proposed wording, the evidence with dates, and what it deliberately leaves alone. It writes nothing to the vault and edits no skill file itself: a proposal becomes real only when the user applies it through a pull request that keeps `npm test` and the behavioral evals green.

## Vault layout the skills expect

```
Vault/
├── Inbox.md            # unrouted captures
├── Tasks.md            # central checkbox tasks
├── Corrections.md      # log of corrections the user made
├── Standup.md          # last generated standup
├── Daily/YYYY-MM-DD.md
├── Projects/[Name]/[Name].md
├── People/[First Last].md
├── Knowledge Base/
├── Ideas/
├── Shopping/[Store].md
├── Syntheses/YYYY-MM-DD.md
└── Reviews/YYYY-Www.md
```

Folders are created on first use; no scaffolding step required.

## The whole system

The skills and server above are the part that matters: an agent that files, links, and
recalls on your behalf, with every write shaped by code. The rest is how you reach it.

```text
you ── speak ──▶ handheld / phone / laptop
                        │  HTTP, PCM audio
                        ▼
                agent-voice-bridge          local STT, local TTS, one adapter per agent
                        │  text turn
                        ▼
                  agent (OpenClaw, Hermes, or any CLI)
                        │  loads these skills, runs the MCP server
                        ▼
                  obsidian MCP server ──▶ Obsidian vault (git-tracked)
```

| Piece | Repo | Required? |
|---|---|---|
| Skills + Obsidian MCP server | this repo | yes |
| Agent harness that loads skills and runs MCP servers | OpenClaw, Claude Code, Hermes, … | yes, pick one |
| Obsidian vault | yours; never shared | yes |
| Push-to-talk voice bridge (browser client, reference CLI, versioned HTTP API) | [`agent-voice-bridge`](https://github.com/jramsahai/agent-voice-bridge) | no — typing works |
| ESP32-S3 handheld that speaks the voice bridge's API over Tailscale | separate firmware project, not yet published | no |

The voice bridge knows nothing about Obsidian and the skills know nothing about voice.
Their only contact is the agent in the middle: a spoken "add milk to the Costco list" becomes
a text turn, the agent picks the `shopping-list` skill, and `obsidian__checklist_set` does
the write. Swap any layer without touching the others.

## License

MIT — see [LICENSE](./LICENSE).
