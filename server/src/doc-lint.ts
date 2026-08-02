import type { SectionShape } from "./sections.ts";

/**
 * The half of the drift lint that needs the vault.
 *
 * `test/skill-references.test.ts` checks the SKILL.md files against the tool
 * *schemas* — that named tools exist, that arguments are real, that enum values
 * are members. It cannot check them against the vault, and that is the hole the
 * knowledge-base review-log contradiction sat in: the docs prescribed a flat
 * dated bullet through section_append for `## Review Log`, which had held
 * `### YYYY-MM-DD` blocks since 2026-07-09. Every schema check passed. The
 * keep_newest on it had never once fired.
 *
 * So this rule compares the prose to what the sections actually hold. It is
 * pure — the caller supplies the shapes — so the rule itself is unit-tested in
 * CI even though CI can never see the vault.
 */

const TOOL_MENTION = /obsidian__([a-z_]+)/g;
const NAMED_ARG = /\b([a-z_]{2,})\s*=\s*(?:"([^"]*)"|(\S+))/g;

/** Resolve a note reference and section name to the section's shape, or null. */
export type ShapeResolver = (note: string, section: string) => SectionShape | null;

export interface DocProblem {
  line: number;
  call: string;
  message: string;
}

/**
 * A placeholder stands for whatever the model fills in, so it names no real
 * section and cannot drift. Brackets and angle brackets cover `[Project Name]`
 * and `<note>`; a bare YYYY-MM-DD template does the same for dates.
 */
function isLiteral(value: string): boolean {
  return value.length > 0 && !/[[\]<>{}]/.test(value) && !value.startsWith("YYYY");
}

/** A dated section name and the notes carrying it. */
export interface DatedSectionUse {
  name: string;
  notes: string[];
}

export interface VaultProblem {
  section: string;
  notes: string[];
  message: string;
}

/**
 * Does this line both name the section and reach for log_append? Requiring the
 * two together is deliberate: a section name in one paragraph and the tool in
 * another is not guidance a model reliably connects, and putting them on one
 * line is better prose anyway.
 *
 * The forms are the ones the docs actually use. A bare substring match would
 * let a section called "Log" be satisfied by any line containing the word.
 */
function documents(line: string, name: string): boolean {
  if (!line.includes("obsidian__log_append")) return false;
  return (
    line.includes(`section="${name}"`) || line.includes(`## ${name}`) || line.includes(`\`${name}\``)
  );
}

/**
 * Dated sections in the vault that no skill tells the model how to write to.
 *
 * The mirror of lintDocAgainstVault. That one catches a doc naming the wrong
 * tool for a section; this catches a section no doc mentions at all — where the
 * model has nothing to go on, reaches for section_append, and drops a bare line
 * above the first date heading. The original bug, on a section the docs never
 * covered.
 */
export function lintVaultAgainstDocs(
  sections: DatedSectionUse[],
  docs: { file: string; content: string }[],
): VaultProblem[] {
  const lines = docs.flatMap((d) => d.content.split("\n"));
  return sections
    .filter((s) => !lines.some((line) => documents(line, s.name)))
    .map((s) => ({
      section: s.name,
      notes: s.notes,
      message: `"${s.name}" holds ### YYYY-MM-DD blocks in ${s.notes.length} note${
        s.notes.length === 1 ? "" : "s"
      } (e.g. ${s.notes[0]}) but no SKILL.md names it alongside obsidian__log_append. With nothing to go on the model reaches for section_append, which drops a bare line above the first date heading.`,
    }));
}

/** Documentation calls that name a section whose real shape contradicts them. */
export function lintDocAgainstVault(content: string, resolve: ShapeResolver): DocProblem[] {
  const problems: DocProblem[] = [];

  content.split("\n").forEach((line, index) => {
    const mentions = [...line.matchAll(TOOL_MENTION)];
    if (mentions.length === 0) return;

    // Attribute each argument to the nearest tool named before it, matching
    // how the schema lint reads a line that mentions two tools.
    const args = new Map<number, Map<string, string>>();
    for (const arg of line.matchAll(NAMED_ARG)) {
      const owner = [...mentions].reverse().find((m) => m.index! < arg.index!);
      if (!owner) continue;
      const [, name, quoted, bare] = arg;
      const value = quoted ?? bare;
      if (value === undefined) continue;
      if (!args.has(owner.index!)) args.set(owner.index!, new Map());
      args.get(owner.index!)!.set(name, value);
    }

    for (const mention of mentions) {
      const tool = mention[1];
      if (tool !== "section_append" && tool !== "log_append") continue;
      const own = args.get(mention.index!);
      const note = own?.get("note");
      const section = own?.get("section");
      if (!note || !section || !isLiteral(note) || !isLiteral(section)) continue;

      const shape = resolve(note, section);
      // A note or section that does not exist is not drift — it may be about
      // to, or may live only in an example vault.
      if (shape === null) continue;

      const call = `obsidian__${tool} note="${note}" section="${section}"`;
      if (shape === "dated" && tool === "section_append") {
        problems.push({
          line: index + 1,
          call,
          message: `"${section}" in ${note} holds ### YYYY-MM-DD blocks; section_append drops a bare line above the first date heading and its keep_newest counts nothing there. Use obsidian__log_append.`,
        });
      }
      if (shape !== "dated" && tool === "log_append") {
        problems.push({
          line: index + 1,
          call,
          message: `"${section}" in ${note} is ${shape === "table" ? "a table" : "a flat list"}, not a dated log; log_append would write a ### date heading into it. Use obsidian__section_append.`,
        });
      }
    }
  });

  return problems;
}
