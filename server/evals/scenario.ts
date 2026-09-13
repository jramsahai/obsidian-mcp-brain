// Scenario schema, loading, and validation for the behavioral evals harness.
// Kept separate from run.ts so the unit test (evals-scenarios.test.ts) can
// validate every scenario file without pulling in the model-calling code.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../src/tools.ts";
import { isDate } from "../src/config.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");
export const SCENARIOS_DIR = join(HERE, "scenarios");

export interface ExpectCall {
  tool: string;
  /** Partial match against the call's args. Extra args on the call are ignored. */
  args?: Record<string, unknown>;
  /** When true, this call must land after every other `ordered` entry listed before it. */
  ordered?: boolean;
}

export interface ExpectFile {
  /** Vault-relative path, e.g. "Tasks.md" or "Projects/Example Project/Example Project.md". */
  path: string;
  /** Regex patterns the file's final content must each match. See compilePattern() for the syntax. */
  matches: string[];
}

export interface Scenario {
  name: string;
  /** Skills beyond second-brain (always included) to concatenate into the system prompt. */
  skills: string[];
  user: string;
  /** Fixes the date every `today()` call in the tool handlers sees, for this scenario's run. */
  today?: string;
  expect_calls: ExpectCall[];
  forbid_calls?: string[];
  expect_files?: ExpectFile[];
  max_steps?: number;
  /** The file this scenario was loaded from, for error messages. Not part of the JSON. */
  file: string;
}

export const DEFAULT_MAX_STEPS = 6;

/** Directories that carry a SKILL.md — the universe of valid `skills` entries. */
export function listSkillNames(): string[] {
  return readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "server" && !e.name.startsWith("."))
    .filter((e) => existsSync(join(REPO_ROOT, e.name, "SKILL.md")))
    .map((e) => e.name);
}

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

/**
 * Validate a raw parsed JSON scenario, throwing with the file name and a
 * specific complaint on the first problem found. Scenarios are edited by
 * hand, so a vague "invalid scenario" is not good enough.
 */
export function validateScenario(raw: unknown, file: string): Scenario {
  const knownSkills = listSkillNames();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(file, "must be a JSON object.");
  }
  const s = raw as Record<string, unknown>;

  if (typeof s.name !== "string" || s.name.trim() === "") {
    fail(file, `"name" must be a non-empty string.`);
  }
  if (!Array.isArray(s.skills) || s.skills.some((v) => typeof v !== "string")) {
    fail(file, `"skills" must be an array of strings.`);
  }
  for (const skill of s.skills as string[]) {
    if (skill === "second-brain") {
      fail(file, `"skills" should not list "second-brain" — it is always included first.`);
    }
    if (!knownSkills.includes(skill)) {
      fail(file, `"skills" names "${skill}", which has no SKILL.md. Known skills: ${knownSkills.join(", ")}.`);
    }
  }
  if (typeof s.user !== "string" || s.user.trim() === "") {
    fail(file, `"user" must be a non-empty string.`);
  }
  if (s.today !== undefined && (typeof s.today !== "string" || !isDate(s.today))) {
    fail(file, `"today" must be an exact YYYY-MM-DD date; got ${JSON.stringify(s.today)}.`);
  }
  if (s.max_steps !== undefined && (!Number.isInteger(s.max_steps) || (s.max_steps as number) < 1)) {
    fail(file, `"max_steps" must be a whole number of at least 1; got ${JSON.stringify(s.max_steps)}.`);
  }

  if (!Array.isArray(s.expect_calls) || s.expect_calls.length === 0) {
    fail(file, `"expect_calls" must be a non-empty array — a scenario that proves nothing is not a scenario.`);
  }
  const expectCalls: ExpectCall[] = (s.expect_calls as unknown[]).map((raw, i) => {
    if (typeof raw !== "object" || raw === null) fail(file, `expect_calls[${i}] must be an object.`);
    const c = raw as Record<string, unknown>;
    if (typeof c.tool !== "string" || !TOOL_NAMES.has(c.tool)) {
      fail(
        file,
        `expect_calls[${i}].tool "${c.tool}" is not a real tool. Known tools: ${[...TOOL_NAMES].join(", ")}.`,
      );
    }
    if (c.args !== undefined && (typeof c.args !== "object" || c.args === null || Array.isArray(c.args))) {
      fail(file, `expect_calls[${i}].args must be a flat object.`);
    }
    if (c.ordered !== undefined && typeof c.ordered !== "boolean") {
      fail(file, `expect_calls[${i}].ordered must be a boolean.`);
    }
    return { tool: c.tool as string, args: c.args as Record<string, unknown> | undefined, ordered: c.ordered as boolean | undefined };
  });

  let forbidCalls: string[] | undefined;
  if (s.forbid_calls !== undefined) {
    if (!Array.isArray(s.forbid_calls) || s.forbid_calls.some((v) => typeof v !== "string")) {
      fail(file, `"forbid_calls" must be an array of tool names.`);
    }
    for (const tool of s.forbid_calls as string[]) {
      if (!TOOL_NAMES.has(tool)) fail(file, `forbid_calls names "${tool}", which is not a real tool.`);
    }
    forbidCalls = s.forbid_calls as string[];
  }

  let expectFiles: ExpectFile[] | undefined;
  if (s.expect_files !== undefined) {
    if (!Array.isArray(s.expect_files)) fail(file, `"expect_files" must be an array.`);
    expectFiles = (s.expect_files as unknown[]).map((raw, i) => {
      if (typeof raw !== "object" || raw === null) fail(file, `expect_files[${i}] must be an object.`);
      const f = raw as Record<string, unknown>;
      if (typeof f.path !== "string" || f.path.trim() === "") {
        fail(file, `expect_files[${i}].path must be a non-empty string.`);
      }
      if (!Array.isArray(f.matches) || f.matches.length === 0 || f.matches.some((v) => typeof v !== "string")) {
        fail(file, `expect_files[${i}].matches must be a non-empty array of regex strings.`);
      }
      for (const pattern of f.matches as string[]) {
        try {
          compilePattern(pattern);
        } catch (error) {
          fail(file, `expect_files[${i}].matches has an invalid regex "${pattern}": ${(error as Error).message}`);
        }
      }
      return { path: f.path as string, matches: f.matches as string[] };
    });
  }

  return {
    name: s.name as string,
    skills: s.skills as string[],
    user: s.user as string,
    today: s.today as string | undefined,
    expect_calls: expectCalls,
    forbid_calls: forbidCalls,
    expect_files: expectFiles,
    max_steps: (s.max_steps as number | undefined) ?? DEFAULT_MAX_STEPS,
    file,
  };
}

/** Load and validate every scenario in server/evals/scenarios/. */
export function loadScenarios(): Scenario[] {
  const files = readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => {
    const path = join(SCENARIOS_DIR, f);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`${f}: invalid JSON — ${(error as Error).message}`);
    }
    return validateScenario(raw, f);
  });
}

/**
 * A string is a regex when wrapped `/pattern/flags` (flags optional); a bare
 * string is still compiled as a regex pattern with no flags, since
 * expect_files.matches is documented as regex throughout — the slash form
 * exists only to reach flags like `s` for a whole-content check.
 */
export function compilePattern(raw: string): RegExp {
  const wrapped = /^\/(.*)\/([a-z]*)$/s.exec(raw);
  if (wrapped) return new RegExp(wrapped[1], wrapped[2]);
  return new RegExp(raw);
}

/**
 * Match one expected arg value against the actual value from a recorded call.
 * A string wrapped `/pattern/flags` matches as a regex against the actual
 * value's string form; any other string matches exactly; non-strings match
 * with strict equality.
 */
export function matchArgValue(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "string") {
    const wrapped = /^\/(.*)\/([a-z]*)$/s.exec(expected);
    if (wrapped) return new RegExp(wrapped[1], wrapped[2]).test(String(actual ?? ""));
    return actual === expected;
  }
  return actual === expected;
}

/** Does a recorded call's args satisfy an expect_calls entry's partial args? */
export function argsMatch(expected: Record<string, unknown> | undefined, actual: Record<string, unknown>): boolean {
  if (!expected) return true;
  return Object.entries(expected).every(([key, value]) => matchArgValue(value, actual[key]));
}
