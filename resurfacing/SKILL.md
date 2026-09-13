---
name: resurfacing
description: >
  Monthly pass (on demand or by cron) that finds projects, people, and
  knowledge notes that have gone quiet — no dated entry in 90+ days — and asks
  the user what to do with each: keep, archive, or link elsewhere. Read-mostly
  until the user answers; only then archives or links the specific notes
  named, and nothing else. NOT for: weekly project staleness at 14 days
  (weekly-review's Quiet Projects), who to reach out to at 60 days
  (people-notes -> Cadence), or nightly linking and inbox triage
  (nightly-consolidation).
---

# Resurfacing

Once a month (or on demand), surface the notes nobody has touched in a long time and let the user decide their fate. This skill never decides on its own — it proposes, the user answers, and only the answered notes change. Read `second-brain` for shared vault conventions and the `obsidian__*` tool surface.

## Data Source

- `obsidian__vault_list type="project" stale_days=90`, `obsidian__vault_list type="person" stale_days=90`, and `obsidian__vault_list type="knowledge" stale_days=90` — each returns notes with no dated entry at all, or one older than 90 days. `last_entry_date` is the note's own dated content (an Activity Log block, a Conversation History row), not file `modified` time, so a consolidation pass touching a file cannot hide a genuinely quiet note.
- Daily, synthesis, review, index, and MOC notes are deliberately out of scope — do not list them here even if `vault_list` would return them for one of those types. A daily note has no dated entries of its own to log against, a synthesis or review is a point-in-time record that is supposed to age, and an index/MOC is a hub, not a thread that goes quiet. None of them can sensibly be "kept, archived, or linked elsewhere."

## Workflow

1. `obsidian__vault_status` first, for today's date and orientation.
2. Run the three `vault_list` calls above. Merge the results into one list.
3. Sort oldest first: a null `last_entry_date` (never logged at all) sorts ahead of every real date — it is the quietest a note can be.
4. Cap the run at 15 items. If more exist, say in the reply how many were left out.
5. For each note, read enough of it to propose exactly one action:
   - **keep** — still plausibly relevant despite no dated entry (created recently, or referenced from other active notes).
   - **archive** — nothing suggests it is still live: no recent references, no open pending topics, the described work reads finished or abandoned.
   - **link to [[X]]** — a specific other note in the vault now clearly covers the same ground (a merged project, a renamed topic), and this one should point at it rather than stand alone.
   Never invent a reason for archiving or linking. When none of the three is clearly right, propose **keep** and say why the note is uncertain rather than guessing archive — archiving is the one action here that changes the note's status, so it gets the benefit of the doubt.
6. Reply to the invoking channel with one line per note: name as a wikilink, its `last_entry_date` (or "no dated entry"), and the proposed action. Write nothing to the vault in this step.
7. Wait for the user's answers. Apply only what they actually said, one note at a time:
   - Archive -> `obsidian__note_set_field note="[Note Name]" field="status" value="Archived"`.
   - Link to another note -> `obsidian__relate note="[Note Name]" target="[Other Note]" reason="why they're now the same thread"`.
   - Keep -> no write; the note is unchanged.
   - An answer that does not map onto one of these two write tools: do not invent a call. Say so in the reply instead of leaving it silently unresolved.
8. Never write to a note the user did not name in their answer, and never act on more than the 15 items proposed in that run.

## Output Shape

```markdown
**Resurfacing — YYYY-MM-DD**

1. [[Note Name]] — last entry 2026-05-02 — proposed: archive
2. [[Other Note]] — no dated entry — proposed: keep
3. [[Third Note]] — last entry 2026-04-11 — proposed: link to [[Related Note]]

Reply with each number's answer (keep / archive / link to a note) and I'll apply it.
```

## Safety

- Never set `status: Archived` or call `obsidian__relate` for a note without an explicit answer from the user naming that note.
- Do not infer "no answer" as agreement to archive — silence changes nothing.
- Do not invent facts about why a note is stale beyond what the note itself and its links show.
- Follow `second-brain` permission guardrails; this skill has no delete or move capability regardless.

## Cron Invocation

Scheduled monthly, the 15th at 09:00. Use the same workflow as an on-demand run. Deliver the list to the configured channel and stop — a scheduled run proposes for the next conversation to answer; it never assumes anything about notes the user has not yet responded to.
