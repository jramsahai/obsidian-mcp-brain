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

## Data Source

- Vault config (name, path, CLI binary, timezone): see `second-brain` -> Vault. Examples assume vault name `Obsidian Vault`.
- Lists: `Shopping/[Store Name].md` — one file per store (e.g. `Shopping/Home Depot.md`, `Shopping/Costco.md`)

## List Template

```markdown
---
type: shopping
store: Store Name
created: YYYY-MM-DD
---

# Store Name

Items to pick up next time at Store Name. Check off when bought; clear checked items periodically.

- [ ] Item — optional detail (size, brand, aisle, why)
```

## Workflow

Adding an item ("add X to the Home Depot list", "I need to grab X next time I'm at Costco"):

1. Find `Shopping/[Store].md`; create it from the template if missing.
2. If the item is already listed unchecked, merge any new detail into that line instead of adding a duplicate.
3. Otherwise append `- [ ] Item` with any detail the user gave. Preserve their wording.
4. If the item relates to a project, add the `[[Project Name]]` wikilink after the item text.

Checking a list ("what do I need at Home Depot?"):

- Read the store file and return unchecked items. The CLI shortcut works too: `tasks todo path="Shopping/Home Depot.md"`.

Marking bought:

- Check the item off (`- [x]`). Do not delete.
- Periodically (or when the user asks to clean up), move checked items to a `## Bought` section at the bottom or clear them if the user says so.

No store specified:

- If the item clearly maps to a store the user already has a list for, use that list.
- Otherwise ask, or put it in `Inbox.md` if it's ambiguous between a shopping item and a task.

## Boundaries

- Errands with deadlines ("buy X before Friday") also get a task in `Tasks.md` via `task-tracking`, linking the store list if useful.
- Trip/event expense tracking is out of scope here; capture to `Inbox.md` if the user asks for it.
- Recurring staples: keep a `## Staples` section in the store file; on request, copy unchecked staples into the active list.
