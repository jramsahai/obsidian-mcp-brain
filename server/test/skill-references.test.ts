import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { TOOLS, TOOLS_BY_NAME } from "../src/tools.ts";

/**
 * Drift lint. The SKILL.md files are the only place the tool contract is
 * restated in prose; this fails the build the moment a rename makes one of
 * those references a lie.
 */
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOOL_MENTION = /obsidian__([a-z_]+)/;
const NAMED_ARG = /\b([a-z_]{2,})\s*=/g;

/** Every bad tool name or bad argument name in one skill document. */
export function lintSkillDocument(content: string): string[] {
  const problems: string[] = [];
  for (const line of content.split("\n")) {
    const mention = TOOL_MENTION.exec(line);
    if (!mention) continue;
    const tool = TOOLS_BY_NAME.get(mention[1]);
    if (!tool) {
      problems.push(`unknown tool obsidian__${mention[1]}`);
      continue;
    }
    const schema = tool.inputSchema as { properties?: Record<string, unknown> };
    const properties = Object.keys(schema.properties ?? {});
    for (const arg of line.matchAll(NAMED_ARG)) {
      if (!properties.includes(arg[1])) {
        problems.push(`obsidian__${mention[1]} has no argument "${arg[1]}"`);
      }
    }
  }
  return problems;
}

function skillFiles(): { path: string; content: string }[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "server" && !e.name.startsWith("."))
    .map((e) => join(SKILLS_DIR, e.name, "SKILL.md"))
    .flatMap((path) => {
      try {
        return [{ path, content: readFileSync(path, "utf8") }];
      } catch {
        return [];
      }
    });
}

describe("skill tool references", () => {
  test("finds the skills to lint", () => {
    const files = skillFiles();
    assert.ok(files.length >= 10, `expected the sibling skills, found ${files.length}`);
    assert.ok(files.some((f) => f.content.includes("obsidian__")), "no skill references the tools yet");
  });

  test("every tool and argument named in a SKILL.md is real", () => {
    const problems = skillFiles().flatMap((f) =>
      lintSkillDocument(f.content).map((p) => `${f.path.replace(SKILLS_DIR, "")}: ${p}`),
    );
    assert.deepEqual(
      problems,
      [],
      `Known tools: ${TOOLS.map((t) => t.name).join(", ")}`,
    );
  });

  test("catches a renamed tool", () => {
    assert.deepEqual(lintSkillDocument("Call `obsidian__task_create` to add a task."), [
      "unknown tool obsidian__task_create",
    ]);
  });

  test("catches a renamed argument", () => {
    assert.deepEqual(lintSkillDocument('`obsidian__vault_links direction=in dir=out`'), [
      'obsidian__vault_links has no argument "dir"',
    ]);
  });

  test("passes a correct reference", () => {
    assert.deepEqual(lintSkillDocument('`obsidian__task_add text="x" project="Y" due="2026-08-01"`'), []);
  });
});
