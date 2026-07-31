import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { TOOLS, TOOLS_BY_NAME } from "../src/tools.ts";

/**
 * Drift lint. The SKILL.md files are the only place the tool contract is
 * restated in prose; this fails the build the moment one of those references
 * becomes a lie.
 *
 * The first version of this lint only inspected lines that already contained
 * `obsidian__`, so the six skills that named no tool at all were invisible to
 * it — and those were exactly the six still carrying pre-migration prose. A
 * green lint meant nothing. It now also checks enum values, required
 * arguments, and that every skill actually names the tools it needs.
 */
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOOL_MENTION = /obsidian__([a-z_]+)/g;
const NAMED_ARG = /\b([a-z_]{2,})\s*=\s*(?:"([^"]*)"|(\S+))/g;

interface Property {
  enum?: string[];
}

function schemaOf(name: string): { properties: Record<string, Property>; required: string[] } {
  const schema = TOOLS_BY_NAME.get(name)!.inputSchema as {
    properties?: Record<string, Property>;
    required?: string[];
  };
  return { properties: schema.properties ?? {}, required: schema.required ?? [] };
}

/**
 * Instructions written against the removed obsidian-cli. These succeeded as
 * prose long after the binary was gone, and a model following them either
 * shelled out to nothing or invented a tool name.
 */
const DEAD_CLI_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /obsidian-cli/i, what: "the removed obsidian-cli" },
  { pattern: /\bsearch:context\b/, what: "the removed CLI verb search:context" },
  { pattern: /\bformat=json\b/, what: "the removed CLI flag format=json" },
  { pattern: /\bvault=/, what: "the removed CLI argument vault=" },
  // Backtick-anchored: "mark tasks done" is ordinary English, `tasks done` was
  // a CLI verb.
  { pattern: /`tasks (todo|add|done)\b/, what: "a removed CLI tasks verb" },
  { pattern: /`obsidian\s/, what: "a shelled-out obsidian command" },
  { pattern: /\bdirect file write\b/i, what: "a direct file write, which bypasses every guard" },
];

/** Every bad tool reference in one skill document. */
export function lintSkillDocument(content: string): string[] {
  const problems: string[] = [];

  content.split("\n").forEach((line) => {
    const mentions = [...line.matchAll(TOOL_MENTION)];
    if (mentions.length === 0) return;

    for (const mention of mentions) {
      if (!TOOLS_BY_NAME.has(mention[1])) {
        problems.push(`unknown tool obsidian__${mention[1]}`);
      }
    }

    // Attribute each argument to the nearest tool mentioned before it, so a
    // line naming two tools no longer blames the first for the second's args.
    for (const arg of line.matchAll(NAMED_ARG)) {
      const owner = [...mentions].reverse().find((m) => m.index! < arg.index!);
      if (!owner || !TOOLS_BY_NAME.has(owner[1])) continue;
      const { properties } = schemaOf(owner[1]);
      const [, name, quoted] = arg;
      if (!(name in properties)) {
        problems.push(`obsidian__${owner[1]} has no argument "${name}"`);
        continue;
      }
      const allowed = properties[name].enum;
      if (allowed && quoted !== undefined && !allowed.includes(quoted)) {
        problems.push(
          `obsidian__${owner[1]} ${name}="${quoted}" is not one of: ${allowed.join(", ")}`,
        );
      }
    }

    // A backticked call that passes arguments is a worked example, so it has
    // to be callable — a missing required argument fails at runtime.
    for (const span of line.matchAll(/`([^`]*obsidian__[^`]*)`/g)) {
      const call = span[1];
      const tool = /obsidian__([a-z_]+)/.exec(call);
      if (!tool || !TOOLS_BY_NAME.has(tool[1])) continue;
      if (!/\w+\s*=/.test(call)) continue;
      const { required } = schemaOf(tool[1]);
      const passed = new Set([...call.matchAll(NAMED_ARG)].map((m) => m[1]));
      for (const name of required) {
        if (!passed.has(name)) {
          problems.push(`obsidian__${tool[1]} example is missing required argument "${name}"`);
        }
      }
    }
  });

  for (const { pattern, what } of DEAD_CLI_PATTERNS) {
    const match = pattern.exec(content);
    if (match) problems.push(`references ${what}: "${match[0]}"`);
  }
  return problems;
}

function skillFiles(): { path: string; name: string; content: string }[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "server" && !e.name.startsWith("."))
    .flatMap((e) => {
      const path = join(SKILLS_DIR, e.name, "SKILL.md");
      try {
        return [{ path, name: e.name, content: readFileSync(path, "utf8") }];
      } catch {
        return [];
      }
    });
}

describe("skill tool references", () => {
  test("finds the skills to lint", () => {
    const files = skillFiles();
    assert.ok(files.length >= 10, `expected the sibling skills, found ${files.length}`);
  });

  test("every tool, argument, and enum value named in a SKILL.md is real", () => {
    const problems = skillFiles().flatMap((f) =>
      lintSkillDocument(f.content).map((p) => `${f.name}/SKILL.md: ${p}`),
    );
    assert.deepEqual(problems, [], `Known tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  });

  test("every skill names the tools it works through", () => {
    // The gap that made the old lint meaningless: a skill mentioning no tool
    // was silently exempt from every check above.
    const silent = skillFiles()
      .filter((f) => !f.content.includes("obsidian__"))
      .map((f) => f.name);
    assert.deepEqual(silent, [], "these skills reference no tool at all");
  });

  test("catches a renamed tool", () => {
    assert.deepEqual(lintSkillDocument("Call `obsidian__task_create` to add a task."), [
      "unknown tool obsidian__task_create",
    ]);
  });

  test("catches a renamed argument", () => {
    assert.deepEqual(lintSkillDocument('`obsidian__vault_links direction="in" dir="out"`'), [
      'obsidian__vault_links has no argument "dir"',
    ]);
  });

  test("catches an enum value that would fail at runtime", () => {
    assert.deepEqual(lintSkillDocument('`obsidian__daily_log section="Key Conversations" content="x"`'), [
      'obsidian__daily_log section="Key Conversations" is not one of: Mood / Energy, Weather, Exercise, Media, Food, Purchases, Random Thoughts',
    ]);
    assert.deepEqual(lintSkillDocument('`obsidian__note_create type="blogpost" name="x"`'), [
      `obsidian__note_create type="blogpost" is not one of: project, person, meeting, doc, daily, synthesis, knowledge, moc, shopping, idea, index`,
    ]);
    assert.deepEqual(lintSkillDocument('`obsidian__vault_links direction="backlinks"`'), [
      'obsidian__vault_links direction="backlinks" is not one of: in, out, unresolved, orphans, deadends',
    ]);
  });

  test("catches a worked example missing a required argument", () => {
    assert.deepEqual(lintSkillDocument('`obsidian__relate note="A" target="B"`'), [
      'obsidian__relate example is missing required argument "reason"',
    ]);
  });

  test("attributes arguments to the right tool on a two-tool line", () => {
    assert.deepEqual(
      lintSkillDocument(
        'Call `obsidian__vault_read note="X"` then `obsidian__daily_log section="Food" content="y"`',
      ),
      [],
    );
  });

  test("catches leftover obsidian-cli instructions", () => {
    assert.deepEqual(lintSkillDocument('Run `tasks todo path="Shopping/Home Depot.md"`'), [
      'references a removed CLI tasks verb: "`tasks todo"',
    ]);
    // ...but ordinary prose about tasks is not a CLI reference.
    assert.deepEqual(lintSkillDocument("Do not mark tasks done while running standup."), []);
    assert.deepEqual(lintSkillDocument("Search with `search:context` and format=json."), [
      'references the removed CLI verb search:context: "search:context"',
      'references the removed CLI flag format=json: "format=json"',
    ]);
  });

  test("passes a correct reference", () => {
    assert.deepEqual(
      lintSkillDocument('`obsidian__task_add text="x" project="Y" due="2026-08-01"`'),
      [],
    );
  });
});
