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
