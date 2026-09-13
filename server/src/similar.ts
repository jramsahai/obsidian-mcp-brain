/**
 * Near-duplicate detection for log and section entries.
 *
 * The exact-match dedupe in sections.ts guards against a call being replayed
 * verbatim. It never fired in production, because a model that repeats itself
 * does not repeat itself *verbatim* — it regenerates. On 2026-08-02 a single
 * turn wrote the same board purchase three times ("Purchased the … kit",
 * "Purchased … from the supplier", "Ordered the … from the supplier"), and the
 * same conversation twice, all of it past a guard that was on by default.
 *
 * Threshold chosen from the vault, not from taste. Scored against every pair of
 * entries that already coexist inside one `### YYYY-MM-DD` block — 1273 pairs,
 * the exact population this guard compares against — the three real duplicates
 * scored 0.708, 0.839 and 0.969 while the highest genuine pair scored 0.583.
 * 0.65 sits in that gap: it catches all three and rejects none of the 1273.
 * Re-run the measurement before moving it.
 */

export const SIMILARITY_THRESHOLD = 0.65;

/**
 * Below this many content words, Dice is too coarse to separate "Board arrived"
 * from "Board shipped", so only the exact-match guard applies. Short entries are
 * also the ones a person is most likely to repeat deliberately.
 */
const MIN_TOKENS = 4;

/**
 * Dropped before comparison because they carry no information about *what*
 * happened, and leaving them in lets two unrelated sentences share half their
 * tokens purely by grammar.
 */
const STOP = new Set(
  "the a an and or of to for in on at is are was were be been being it its this that these those with from as by we i he she they them our their his her".split(
    " ",
  ),
);

/**
 * Wikilink targets survive as their display text, URLs are dropped entirely: a
 * reworded entry often keeps the link and drops the URL, or the reverse, and
 * neither difference means the entry is about something new.
 */
export function contentTokens(text: string): Set<string> {
  const words = text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias ?? target)
    .replace(/https?:\/\/\S+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  return new Set(words);
}

function matchAll(text: string, re: RegExp, group = 0): Set<string> {
  return new Set([...text.matchAll(re)].map((m) => m[group].toLowerCase()));
}

function differs(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  if (a.size !== b.size) return true;
  for (const t of a) if (!b.has(t)) return true;
  return false;
}

/** The leading cell of a pipe-delimited row, which is what these tables key on. */
function rowKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const first = trimmed.slice(1).split("|")[0]?.trim().toLowerCase();
  return first || null;
}

/**
 * Two entries that each name something specific, and name different things, are
 * different entries however alike the rest of them reads.
 *
 * Every clause here was put in by a measurement, not by taste — scored against
 * all 50229 pairs of entries that already share a section in the real vault:
 *
 * - **date** — a bounded review log gets "- 2026-08-01: reviewed" one night and
 *   "- 2026-08-02: reviewed" the next, 0.75 alike. Blocking the second would
 *   have broken the nightly job the first time it ran.
 * - **row key** — `Ignored Links.md` rows read "| Jane Doe | <same reason> |
 *   <same date> |" for every name link_ignore has ever been given. 100+ real
 *   rows differ only in that leading cell.
 * - **wikilinks** — a synthesis lists "[[Alex Rivera]] — mentioned in
 *   [[2026-07-05]]…" beside the same sentence about [[Sam Rivera]]. The
 *   shared date link means these sets overlap, so overlap cannot be the test;
 *   any difference in what an entry points at makes it a different entry.
 *
 * A duplicate agrees on all of them: both conversation rows led with 2026-08-02
 * and named exactly [[Example Project]], and the three board entries carried no
 * date, no row key, and no links at all.
 */
function differentSubjects(a: string, b: string): boolean {
  const DATE = /\d{4}-\d{2}-\d{2}/g;
  const LINK = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const [keyA, keyB] = [rowKey(a), rowKey(b)];
  if (keyA && keyB && keyA !== keyB) return true;
  return differs(matchAll(a, DATE), matchAll(b, DATE)) || differs(matchAll(a, LINK, 1), matchAll(b, LINK, 1));
}

/**
 * Sørensen–Dice over content words, in [0, 1].
 *
 * Dice rather than Jaccard because a reworded entry is often longer or shorter
 * than the one it duplicates — the third board entry traded a clause for a URL —
 * and Jaccard penalises that length difference twice.
 */
export function similarity(a: string, b: string): number {
  if (differentSubjects(a, b)) return 0;
  const A = contentTokens(a);
  const B = contentTokens(b);
  if (A.size < MIN_TOKENS || B.size < MIN_TOKENS) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** The most similar of `existing` to `line`, if it clears the threshold. */
export function findSimilar(
  line: string,
  existing: readonly string[],
  threshold = SIMILARITY_THRESHOLD,
): { text: string; score: number } | null {
  let best: { text: string; score: number } | null = null;
  for (const candidate of existing) {
    if (!candidate.trim()) continue;
    const score = similarity(line, candidate);
    if (score >= threshold && (!best || score > best.score)) best = { text: candidate, score };
  }
  return best;
}

/** Trim a line to something readable inside an error message. */
export function excerpt(line: string, max = 90): string {
  const flat = line.trim().replace(/^[-*+]\s+/, "").replace(/\s+/g, " ");
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
