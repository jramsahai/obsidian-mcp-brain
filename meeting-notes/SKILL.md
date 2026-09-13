---
name: meeting-notes
description: >
  Turn a meeting transcript, dictated recap, or bullet notes (including voice
  bridge output) into a meeting note, project decisions, action items, and
  person conversation history. Owns ingestion of raw meeting/voice material
  only. NOT for: the meeting note's own shape or the project's sections
  (project-tracking), the person note's shape (people-notes), or task
  mechanics beyond adding the item (task-tracking).
---

# Meeting and Voice Ingestion

Turn raw meeting material into vault writes through the existing tools. This skill owns *ingestion* — deciding what a transcript contains and where each piece goes. It does not define note shapes: read `project-tracking` for the meeting note template and the project's `## Key Decisions` / `## Conversation Log`, and `people-notes` for the person note's `## Conversation History` row shape, before using either. Use `second-brain` for the tool surface and the `Inbox.md` capture convention.

## Inputs

Three shapes of raw material, all handled the same way from here on:

- A verbatim transcript.
- A dictated recap (spoken summary of a meeting that already happened).
- Bullet notes typed or pasted in.

## Voice-Specific Handling

Material from the voice bridge needs cleanup before anything is written, not literal transcription into the vault:

- It arrives lowercase and unpunctuated. Never paste it into a note as-is — summarize into normal sentences and title case where a heading or wikilink needs it.
- Names are frequently misheard ("alex riviera" for an existing "Alex Rivera", or a name with no match at all). Treat a heard name as a candidate, not a fact — confirm it against the vault before writing anything under it.
- Dates are relative ("next friday", "end of month"). Call `obsidian__vault_status` first in every capture and resolve every relative date against its `today` field to `YYYY-MM-DD` before any `obsidian__task_add` — the tool rejects anything else, and an unresolved "next friday" is not a valid `due`.

## Workflow

1. **Orient.** `obsidian__vault_status` — get today's date for resolving relative dates.

2. **Identify the project.** `obsidian__vault_list type="project"` and match the meeting's project by exact name (case-insensitive; do not fuzzy-guess a misheard project name the way you would a person's). If it matches, proceed normally. If nothing matches, do not invent a project note — `obsidian__note_create type="meeting"` has no way to leave `project` unset, so there is no partial meeting note to create. Route the whole capture, summarized, to the inbox and stop there for this capture:

   ```
   obsidian__inbox_add content="dictated recap mentioning 'Riverside kickoff'" context="no matching project note; route once one exists"
   ```

   `obsidian__inbox_add` dates the line and creates `Inbox.md` if it does not exist yet; `obsidian__inbox_route` then moves the line out once a matching project exists.

3. **Resolve attendees.** For each name heard, check `obsidian__vault_list type="person"` and `obsidian__vault_search query="…" type="person"` before deciding. A confirmed match gets wikilinked in the meeting note's `## Attendees`. A name heard once with no match — including a plausible mishearing of an existing name that still doesn't check out — goes under a `## Unresolved` section on the meeting note (append with `create_section` set, since it is not part of the standard template). Never create a person note from a single meeting mention.

4. **Create the meeting note**, per `project-tracking`:

   ```
   obsidian__note_create type="meeting" name="2026-08-03 Example Project Sync" project="Example Project" fields={"people":"Jane Doe"}
   ```

   `obsidian__note_create` never overwrites — if it returns `created: false`, the note already exists; append to it instead of retrying the create.

5. **Fill the meeting note.** Attendees, a short Discussion summary, and its own Decisions / Action Items — brief, in your own words. Quote the transcript verbatim only for the wording of a decision when the exact phrasing matters, and even then keep it to a short fragment; everything else is a summary.

6. **Route decisions to the project.** Every decision also gets a row in the project's `## Key Decisions` (not just the meeting note — that table is the source project state reads from):

   ```
   obsidian__section_append note="Example Project" section="Key Decisions" content="| 2026-08-03 | Delay launch by one week | Accommodate legal review |"
   ```

7. **Route action items to tasks.** One `obsidian__task_add` per concrete action item, with the project wikilink and a due date only when one was actually stated — an unclear date goes in `notes`, never invented. When the item is owed *to* the user by someone present, use `waiting_on` with their resolved person name:

   ```
   obsidian__task_add text="Send the vendor quote" project="Example Project" notes="Alex Rivera (name unconfirmed)"
   obsidian__task_add text="Review the contract" project="Example Project" due="2026-08-07" waiting_on="Jane Doe"
   ```

8. **Route open questions to the meeting note.** Anything raised but not settled goes under a `## Open Questions` section on the meeting note (append with `create_section` set), not into the project or a task.

9. **Log the conversation.** For the project: a `## Conversation Log` row pointing at the meeting note. For each matched attendee: one `## Conversation History` row on their person note (the people-notes row shape) — never more than one row per attendee per meeting.

   ```
   obsidian__section_append note="Example Project" section="Conversation Log" content="| 2026-08-03 | Jane Doe | [[2026-08-03 Example Project Sync]] — decisions and action items logged |"
   obsidian__section_append note="Jane Doe" section="Conversation History" content="| 2026-08-03 | Example Project sync | Reviewing the contract; due 2026-08-07 |"
   ```

10. **Reply.** One paragraph: what was written, as wikilinks to the notes touched, and what was left unresolved (unmatched names, undated action items, open questions). No transcript dump.

## Worked Example

Dictated recap (voice bridge, as received):

> "recap of the example project sync today with jane doe and a guy named alex riviera we decided to delay the launch by one week to accommodate legal review alex is going to send the vendor quote no date given jane is going to review the contract by next friday open question is whether legal needs to sign off before we send it"

`obsidian__vault_status` reports `today: "2026-08-03"`, so "next friday" resolves to `2026-08-07`.

```
obsidian__vault_status
obsidian__vault_list type="project"
obsidian__vault_list type="person"
obsidian__vault_search query="alex" type="person"
obsidian__note_create type="meeting" name="2026-08-03 Example Project Sync" project="Example Project" fields={"people":"Jane Doe"}
obsidian__section_append note="2026-08-03 Example Project Sync" section="Attendees" content="- [[Jane Doe]]"
obsidian__section_append note="2026-08-03 Example Project Sync" section="Unresolved" content="- Heard 'Alex Riviera' once; no matching person note via vault_list or vault_search — left unresolved, no person note created." create_section=true
obsidian__section_append note="2026-08-03 Example Project Sync" section="Discussion" content="- Launch timeline and contract review status."
obsidian__section_append note="2026-08-03 Example Project Sync" section="Decisions" content="- Delay launch by one week to accommodate legal review."
obsidian__section_append note="2026-08-03 Example Project Sync" section="Action Items" content="- Send the vendor quote (Alex Rivera, unconfirmed) — no date given.\n- Review the contract (Jane Doe) — due 2026-08-07."
obsidian__section_append note="2026-08-03 Example Project Sync" section="Open Questions" content="- Does legal need to sign off before the contract goes out?" create_section=true
obsidian__section_append note="Example Project" section="Key Decisions" content="| 2026-08-03 | Delay launch by one week | Accommodate legal review |"
obsidian__section_append note="Example Project" section="Conversation Log" content="| 2026-08-03 | Jane Doe | [[2026-08-03 Example Project Sync]] — decisions and action items logged |"
obsidian__task_add text="Send the vendor quote" project="Example Project" notes="Alex Rivera (name unconfirmed)"
obsidian__task_add text="Review the contract" project="Example Project" due="2026-08-07" waiting_on="Jane Doe"
obsidian__section_append note="Jane Doe" section="Conversation History" content="| 2026-08-03 | Example Project sync | Reviewing the contract; due 2026-08-07 |"
```

Reply: "Logged [[2026-08-03 Example Project Sync]] for [[Example Project]]: decided to delay launch a week for legal review, added a Conversation Log entry and a Key Decisions row, and filed two tasks (vendor quote — no date given; contract review, due 2026-08-07, waiting on [[Jane Doe]]). 'Alex Riviera' didn't match an existing person note, so attendance is under Unresolved rather than a new person file. One open question — legal sign-off — is on the meeting note."

## Safety

- Do not invent a project, a person, a decision, or a date. An unresolved name, an unstated due date, and an unmatched project are all facts to surface, not gaps to fill in.
- Do not create a person note from a single meeting mention — that is `people-notes`' call to make from durable, non-meeting-first-contact information.
- Do not paste transcript text at length into any note. A short verbatim fragment on a decision is the one exception, and only when the exact wording matters.
