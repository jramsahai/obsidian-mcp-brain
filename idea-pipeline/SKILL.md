---
name: idea-pipeline
description: >
  Capture, compare, score, and pressure-test startup or product ideas before they
  become tracked work projects. Use when: (1) brainstorming candidate ideas, (2)
  comparing multiple directions, (3) building an idea scorecard, (4) evaluating
  whether an idea is worth deeper validation, or (5) deciding whether to promote an
  idea into a tracked project. NOT for: maintaining an active work project, project
  archival, or project-specific research after a tracked project has already been
  established.
---

# Idea Pipeline

Manage uncertainty before an idea becomes a formal tracked project. Ideas live in the Obsidian second brain; use `second-brain` for shared vault conventions.

## Core Principle

Ideas are not work projects.

An idea artifact should support:
- comparison
- scoring
- uncertainty
- iteration
- promotion or discard decisions

Do not force ideas into the same structure as tracked work projects.

## Tools

One note per idea at `Ideas/[Idea Name].md`; the server derives the path from the name.

| Need | Call |
|---|---|
| Capture an idea | `obsidian__note_create type="idea" name="Overlap"` |
| Fill a section | `obsidian__section_append note="Overlap" section="Problem" content="…"` |
| Add a scorecard row | `obsidian__section_append note="Overlap" section="Scorecard" content="\| Pain level \| 4 \| daily friction \|"` |
| Change status | `obsidian__note_set_field note="Overlap" field="status" value="researching"` |
| Cross-link | `obsidian__relate note="Overlap" target="Pricing Models" reason="…"` |
| Compare candidates | `obsidian__vault_list type="idea" status="candidate"` |

`obsidian__note_create type="idea"` lays out every section below and the frontmatter. You do not write frontmatter; `status` afterwards is `obsidian__note_set_field`.

`## Scorecard` is a table, so pass rows pipe-delimited — the tool appends them as rows and names the columns if the shape is wrong.

## Idea Note Shape

```markdown
# [Idea Name]

## Concept

## Target User

## Problem

## Wedge

## Why It Might Work

## Monetization Thoughts

## Risks

## Open Questions

## Next Validation Step

## Scorecard

| Criterion | Score (1-5) | Notes |
|-----------|-------------|-------|
| Pain level | | |
| Frequency | | |
| Urgency | | |
| Audience clarity | | |
| Distribution ease | | |
| MVP complexity | | |
| Monetization plausibility | | |
| Personal excitement | | |

## Related

- [[Related note]] — why
```

`status` values: `candidate` (captured), `researching` (active validation), `promoted` (became a project — link it), `discarded` (keep the note and the reason; dead ideas are still reference).

Only fill sections with real content; leave the rest empty. Wikilink related projects, people, and knowledge notes.

If an idea accumulates research docs, it graduates to `Ideas/[Idea Name]/[Idea Name].md` with docs alongside.

## Screening Questions

Before deeper work, pressure-test each idea with:
- Can the user/problem be explained in one sentence?
- Can we imagine getting the first 10 users?
- Is there a plausible payer?
- Is this solving a pain point rather than just being clever?
- Would it still be worth working on if growth were slow?

## Promotion Rule

Promote an idea into a tracked project only when:
- the concept is concrete enough to execute against
- there is a clear enough scope for tasks and progress tracking
- the next step is no longer just comparison/validation but actual project work

At that point, use `project-tracking` to create the project note, set the idea's status with `obsidian__note_set_field note="[Idea Name]" field="status" value="promoted"`, and cross-link both notes with `obsidian__relate note="Overlap" target="Overlap Rollout" reason="this project came out of the idea" mirror=true`. Move idea-stage research into the project's `Docs/` if it becomes working material.

## Research Hand-off

If an idea deserves deeper structured research before promotion, keep that research with the idea (`Ideas/[Idea Name]/`) as idea-stage validation. Research moves to the project only on promotion. Be deliberate about the boundary.

## Out of Scope

Do not use this skill for:
- routine updates to active work projects -> `project-tracking`
- project archival or status rollups -> `project-tracking` / `standup`
- day-to-day task logging -> `task-tracking`
- evergreen reference capture -> `knowledge-base`
