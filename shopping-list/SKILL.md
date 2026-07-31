---
name: shopping-list
description: >
  Manage per-store shopping lists in the Obsidian vault. Use when: (1) adding
  items to buy at a store, (2) checking what's on a store's list, (3) marking
  items bought, (4) creating a list for a new store, (5) recurring shopping
  routines. NOT for: work projects, people tracking, general tasks with due
  dates (use task-tracking), or general note-taking.
---

# Shopping Lists

Track per-store shopping lists so the user can recall what they wanted when they're at that store. Use `second-brain` for shared vault conventions.

## Tools

One file per store, at `Shopping/[Store Name].md`. The server derives the path from the store name.

| Need | Call |
|---|---|
| Create a store list | `obsidian__note_create type="shopping" name="Home Depot"` |
| Add or update an item | `obsidian__checklist_set note="Home Depot" item="Wood screws" detail="2 inch"` |
| Mark an item bought | `obsidian__checklist_set note="Home Depot" item="Wood screws" checked=true` |
| Read the list | `obsidian__vault_read note="Home Depot"` |

A store list is deliberately a flat list of checkboxes with no sections — `obsidian__checklist_set` needs a `section` argument only for notes that have sections, so keeping the file sectionless is what makes every later add a one-argument call.

`obsidian__checklist_set` adds the item if it is missing, merges new detail into the line if it is already there, and checks or unchecks it. It never removes a line, so a repeat capture is always safe.

## Workflow

Adding an item ("add X to the Home Depot list", "I need to grab X next time I'm at Costco"):

1. `obsidian__checklist_set note="Home Depot" item="Wood screws" detail="2 inch"`. Preserve the user's wording in `item`.
2. If the store has no list yet, `obsidian__note_create type="shopping" name="Home Depot"` first, then add the item.
3. Merging is automatic: a repeat capture of the same item folds new detail into the existing line rather than adding a second one.
4. If the item relates to a project, include the `[[Project Name]]` wikilink in the item text.

Checking a list ("what do I need at Home Depot?"):

- `obsidian__vault_read note="Home Depot"` and report the unchecked items.

Marking bought:

- `obsidian__checklist_set note="Home Depot" item="Wood screws" checked=true`. A checked item stays on the list as the record that it was bought; nothing removes it.

No store specified:

- If the item clearly maps to a store the user already has a list for, use that list.
- Otherwise ask, or put it in `Inbox.md` if it's ambiguous between a shopping item and a task.

## Boundaries

- Errands with deadlines ("buy X before Friday") also get a task in `Tasks.md` via `task-tracking`, linking the store list if useful.
- Trip/event expense tracking is out of scope here; capture to `Inbox.md` if the user asks for it.
- Recurring staples: keep them in a separate note, e.g. `obsidian__note_create type="shopping" name="Costco Staples"`, and copy items across on request. Do not add a `## Staples` heading to a store list — a store file with any section makes `section` required on every later `obsidian__checklist_set`, and a one-off purchase then gets filed into the staples list by mistake.
