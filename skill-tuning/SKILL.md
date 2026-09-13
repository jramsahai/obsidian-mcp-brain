---
name: skill-tuning
description: >
  Monthly pass (cron on the 1st at 09:00, or on demand) that reviews
  accumulated corrections, review answers, and retired link candidates, then
  proposes concrete SKILL.md wording changes for the user to review.
  Read-only: writes nothing to the vault and edits no skill file itself. NOT
  for: correcting a skill in the moment, nightly connection work
  (nightly-consolidation), or day-to-day vault writes (the specialized
  skills).
---

# Skill Tuning

The self-improvement loop's monthly half: turn a month of friction into a short list of specific, evidenced proposals. The measurement is the deliverable — not the edit. This skill never rewrites a SKILL.md, a cron prompt, or any vault note. It reads, clusters, and proposes; the user decides whether a proposal becomes a change.

Use `second-brain` for the shared tool surface and conventions.

## Data Sources

Start with `obsidian__vault_signals since="<first day of last month>"` — one read-only call, no shell needed, that returns four measurements for that window in one shot:

- **`reject_rate`** — added/rejected/rate for machine commits, broken down by line kind (wikilink insertion, Related bullet, synthesis note line, task line, other) and by top file. `reject_rate: null` with `reject_rate_unavailable` naming the fix (git disabled, or the vault is not a git repo) is a normal, reportable outcome for this one section — the other three still populate.
- **`calibration`** — similarity pair counts, the current threshold, how many pairs sit at or above it, the gap between the threshold and the highest score that stays under it, and the highest-scoring pair's own texts. A proposal to move `SIMILARITY_THRESHOLD` must cite this gap.
- **`corrections`** — the same shape as `obsidian__corrections_summary`: counts grouped by skill and rule, plus the most recent rows. Zero means no correction has been logged yet.
- **`ignored_links`** — rows added to `Ignored Links.md` on or after `since`.

Two more sources aren't in `vault_signals` and still need their own read, both read-only, through `obsidian__*` tools; a missing note is a normal outcome for either — report it as "nothing recorded yet," not as a failure:

- **Corrections log, full wording** — `obsidian__vault_read note="Corrections"` has the full table (`| Date | Skill | What happened | What was wanted | Rule |`) when a cluster needs a row's exact wording that the summary counts don't carry.
- **Recent reviews** — `obsidian__vault_list folder="Reviews"`. Results are sorted the way every `vault_list` call is: date-named notes come back oldest first, so the last four entries in the returned list are the four most recent. An empty result means no review notes exist yet.

## Workflow

1. Call `vault_signals`, then read the Reviews folder and (when a cluster needs exact wording) the full Corrections table. Treat each missing, empty, or unavailable signal as a normal, reportable outcome and move on — do not stop the pass because one is absent.
2. Cluster the Corrections rows by `Skill` and `Rule`. A rule that recurs against the same skill — worded the same way or differently — is a candidate; a single correction, however sharp, is not enough on its own. Read the Reviews entries, the reject rate by line kind, and the recent Ignored Links rows for the same shape of pattern (a review that keeps asking "why did it do that," a line kind with a high reject rate, or the same kind of name retired more than once) and count that as supporting evidence for a cluster that already has a correction behind it.
3. For each cluster that clears that bar, open the named skill file and find the exact current wording the corrections are pushing against. A proposal must point at real, quoted text — do not propose a rewrite of a paragraph you have not read in the file.
4. Reply with at most three proposals, the ones with the most and clearest evidence first. If nothing repeats, say so in one line and stop; do not invent a third proposal to fill the slot.

## Proposal Format

Each proposal, in the reply, carries exactly these parts:

- **Skill file:** the path, e.g. `nightly-consolidation/SKILL.md`.
- **Current wording:** the exact text quoted from the file today.
- **Proposed wording:** the exact replacement text.
- **Evidence:** quote the number behind the proposal — a reject rate for a line kind, a calibration gap, or a corrections count — alongside the corrections or review answers it came with, each with its date. E.g. "38% reject rate on Related bullets since 2026-07-01 (`vault_signals`), plus Corrections 2026-07-14 and 2026-08-02, both logged against nightly-consolidation's Related-links step." A proposal to move `SIMILARITY_THRESHOLD` must cite the calibration gap specifically, not just that pairs exist above or below it.
- **Does not change:** one line naming what is deliberately left alone, so the scope of the proposal is visible at a glance.

## What This Pass Never Does

- Never edits a SKILL.md, a cron prompt, or any vault note — every source above is read through `obsidian__vault_signals`, `obsidian__vault_read`, or `obsidian__vault_list`, nothing more.
- Never proposes a change with no evidence, and never more than three proposals in one pass.
- Never applies its own proposals. Proposals are applied by the user, through a pull request that keeps `npm test` and the behavioral evals green — never by this agent, and never as a direct edit to a running skill.

## Safety

- Corrections and review content can carry private wording; quote only as much as the evidence line needs.
- If a tool fails for a reason other than "the note does not exist yet," report the error plainly — its message names the fix — rather than retrying blind or working around it.
