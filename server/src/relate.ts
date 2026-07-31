import { today } from "./config.ts";
import { findSection } from "./sections.ts";
import { stripWikilink } from "./vault.ts";

export const RELATED_SECTION = "Related";

/**
 * How many `## Related` links one note may collect in a day. A restraint on
 * volume, not on originality: the reason text is the model's contribution and
 * has no shape imposed on it. If good links keep hitting this, raise it.
 */
export const RELATE_CAP = 5;

const spent = new Map<string, number>();

export function relateBudgetRemaining(notePath: string, date: string = today()): number {
  return RELATE_CAP - (spent.get(`${date}:${notePath}`) ?? 0);
}

export function spendRelateBudget(notePath: string, date: string = today()): void {
  const key = `${date}:${notePath}`;
  spent.set(key, (spent.get(key) ?? 0) + 1);
}

/** For tests, and for a server restart's benefit — the cap is in-memory only. */
export function resetRelateBudget(): void {
  spent.clear();
}

/** Wikilink targets already listed under `## Related`. */
export function relatedTargets(content: string): string[] {
  const section = findSection(content, RELATED_SECTION);
  if (!section) return [];
  const body = content.split("\n").slice(section.start, section.end).join("\n");
  return [...body.matchAll(/\[\[([^\][\n]+)\]\]/g)].map((m) => stripWikilink(m[1]));
}

export function relatedLine(target: string, reason: string): string {
  return `- [[${target}]] — ${reason.trim()}`;
}
