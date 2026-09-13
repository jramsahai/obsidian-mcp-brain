// Builds the system prompt a scenario sees: second-brain/SKILL.md plus each
// skill the scenario lists, in that order, each wrapped with a header naming
// it, then a short fixed instruction. This mirrors what a real harness
// concatenates for the model — the skills are prose the model obeys, not
// documentation about it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./scenario.ts";

const FIXED_INSTRUCTION =
  "You are the user's second-brain agent. Use the tools to file the capture correctly. " +
  "Stop calling tools once the capture is fully filed — do not narrate or ask questions unless the skills say to.";

function readSkill(name: string): string {
  return readFileSync(join(REPO_ROOT, name, "SKILL.md"), "utf8");
}

function section(name: string, content: string): string {
  return `# Skill: ${name}\n\n${content.trim()}\n`;
}

/** Concatenate second-brain plus the scenario's skills into one system prompt. */
export function buildSystemPrompt(skills: string[]): string {
  const parts = ["second-brain", ...skills].map((name) => section(name, readSkill(name)));
  parts.push(FIXED_INSTRUCTION);
  return parts.join("\n---\n\n");
}
