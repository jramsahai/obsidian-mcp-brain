---
name: vault-recall
description: >
  Answer questions from the Obsidian vault: "what do I know about X", "what did
  I discuss with [person]", "when/why did we decide Y", "summarize my week",
  project or topic history. Read-only search, reading, and synthesis across
  notes, links, and syntheses. NOT for: capturing or changing anything (use the
  routing skills), daily standup (standup), or vault reorganization
  (nightly-consolidation).
---

# Vault Recall

Answer the user's questions from what the second brain already holds. Read-only: recall never mutates the vault. If the answer prompts a change ("actually, mark that done"), route it to the owning skill afterwards.

Use `second-brain` for vault conventions and the shared tool surface. An empty search result and a "not found" are authoritative answers, not errors — see `second-brain` -> Tools.

## Tools

Every tool here is read-only. Never construct a file path: pass the note name as it appears in a wikilink and the server resolves it.

| Need | Call |
|---|---|
| Read a note | `obsidian__vault_read note="Wayfinder"` |
| Read one section | `obsidian__vault_read note="Jane Doe" section="Conversation History"` |
| Full-text search | `obsidian__vault_search query="pricing"` |
| Narrow a search | `obsidian__vault_search query="pricing" type="knowledge"` |
| Notes by type, folder, status, or change date | `obsidian__vault_list type="project" status="Active"` |
| Newest note in a dated folder | `obsidian__vault_list folder="Syntheses" latest=true` |
| Backlinks — what links here | `obsidian__vault_links direction="in" note="Wayfinder"` |
| Outgoing links | `obsidian__vault_links direction="out" note="Wayfinder"` |
| Orientation before a broad question | `obsidian__vault_status` |

## Search Strategy (layered — stop as soon as the question is answered)

1. **Named entity first.** If the question names a person, project, store, topic, or idea, read its note directly with `obsidian__vault_read note="…"`. The note and its tables usually answer the question outright.
2. **Search.** `obsidian__vault_search` on the key terms; try 2-3 phrasings before concluding absence. Narrow with `type` or `folder` when you know where the answer lives.
3. **Follow the graph one hop.** `obsidian__vault_links direction="in"` and `direction="out"` on the notes found, then read their `## Related` sections. This catches context that keyword search missed.
4. **Time questions use time sources.** For a date range, list the daily and synthesis notes in range with `obsidian__vault_list folder="Daily" changed_since="2026-07-01"`, then read them — plus completed tasks and dated table rows.

A search that returns nothing has answered the question. Do not re-run it a third way.

## Recipes by Question Shape

- **"What do I know about TOPIC"** -> `obsidian__vault_search query="TOPIC" type="knowledge"`, then the topic's MOC note, then the notes it lists. Answer from the notes and name the ones used.
- **"What did PERSON and I discuss / what's pending with them"** -> `obsidian__vault_read note="First Last" section="Conversation History"` and `section="Pending Topics"`, then `obsidian__vault_links direction="in" note="First Last"` for project notes that mention them.
- **"Why/when did we decide X"** -> the project note's `## Key Decisions` table first, then `obsidian__vault_search`.
- **"Summarize my week/month"** -> daily notes and syntheses in range, tasks completed in range, project `## Conversation Log` rows in range.
- **"What am I waiting on / what's stale"** -> that is `standup`'s shape. Run `standup` rather than reinventing it.

## Answer Style

- Answer first, then sources: name the notes used so the user can jump in.
- Quote the user's own recorded wording for decisions and journal content; do not paraphrase it into new claims.
- "The vault says nothing about this" is a real answer — say which places were checked. Distinguish it from "found but thin."
- Never fill a gap from general knowledge without labelling it as outside the vault.

## Privacy

Journal and people-note content is sensitive: answer in the current direct channel only, include the minimum detail that answers the question, and never surface private details in group or public channels.
