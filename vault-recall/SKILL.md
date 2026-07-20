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

Use `second-brain` for vault config, CLI usage/recovery, and fallback hygiene. Empty search results and `File not found` are authoritative answers, not errors.

## Search Strategy (layered — stop as soon as the question is answered)

1. **Named entity first.** If the question names a person, project, store, topic, or idea, read its note directly (`People/X.md`, `Projects/X/X.md`, `[Topic] MOC.md`, `Ideas/X.md`). The note and its tables usually answer the question.
2. **Search.** `search` / `search:context` with `format=json` on the key terms; try 2-3 phrasings before concluding absence.
3. **Follow the graph one hop.** `backlinks` and `links` on the notes found; read their `## Related` sections. This catches context keyword search missed.
4. **Time questions use time sources.** For date-range questions ("last week", "in June"), read `Daily/` and `Syntheses/` notes in the range, plus `✅`-dated tasks and dated table rows.

## Recipes by Question Shape

- "What do I know about TOPIC" -> KB topic folder + MOC + search; answer from the notes, list the notes used.
- "What did PERSON and I discuss / what's pending with them" -> person note `## Conversation History` and `## Pending Topics`, their backlinks, and project `## Conversation Log` rows naming them.
- "Why/when did we decide X" -> project `## Key Decisions` tables first, then search.
- "Summarize my week/month" -> daily notes + syntheses in range, tasks completed in range, project Conversation Log entries in range.
- "What am I waiting on / what's stale" -> that is `standup`'s shape; run `standup` instead of reinventing it.

## Answer Style

- Answer first, then sources: name the notes used so the user can jump in.
- Quote the user's own recorded wording for decisions and journal content; do not paraphrase it into new claims.
- "The vault says nothing about this" is a real answer — say which places were checked. Distinguish it from "found but thin."
- Never fill gaps from general knowledge without labeling it as outside the vault.

## Privacy

Journal and people-note content is sensitive: answer in the current direct channel only, include the minimum detail that answers the question, and never surface private details in group or public channels.
