# Second Brain Skills

A set of agent skills for running a personal "second brain" in an [Obsidian](https://obsidian.md) vault: capture, routing, linking, and nightly consolidation, driven by an AI agent instead of manual filing.

## The skills

| Skill | Role |
|-------|------|
| `second-brain` | Shared coordination layer: vault config, routing rules, frontmatter standards, linking conventions, CLI guardrails, machine edit policy. Read this first. |
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

Design principles baked in: folder notes so `[[wikilinks]]` resolve naturally, frontmatter on every note, append-only machine edits (except adding wikilink brackets), and explicit routing rules so each capture lands in exactly one home.

## Prerequisites

- **Obsidian** with a vault, and the app running (the CLI talks to the live app).
- **obsidian-cli** installed at `/usr/local/bin/obsidian` (adjust the path in `second-brain` if yours differs).
- **macOS** for the `open -g "obsidian://..."` vault-wake recovery flow; on other platforms substitute your OS's URL-opener.
- **Git in the vault** — `git init` the vault once (ignore `.obsidian/workspace*`, cache, `.trash/`). Nightly consolidation commits a snapshot before and after its edits, so every automated change is reviewable and revertible. Without git, enable Obsidian's File Recovery plugin at minimum.
- An agent harness that loads these as skills (e.g. OpenClaw, Claude Code). A few guardrails reference OpenClaw's exec-approval behavior (avoid pipes/redirects/globs in fallback shell commands); harmless elsewhere.

## Setup

1. Edit the **Vault** section of `second-brain/SKILL.md` — vault name, path, CLI binary, timezone. That block is the single source of truth; the other skills reference it.
2. If your vault is not named `Obsidian Vault`, substitute your name in the `vault=` argument of the CLI examples throughout.
3. Optional: schedule `nightly-consolidation` (e.g. nightly cron) and `standup` (e.g. weekday mornings) in your harness.

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
