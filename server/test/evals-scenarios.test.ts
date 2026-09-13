import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { listSkillNames, loadScenarios, SCENARIOS_DIR } from "../evals/scenario.ts";
import { TOOLS } from "../src/tools.ts";

/**
 * The behavioral evals need a model to actually run, so this is the part of
 * P4 that stays in `npm test`: every scenario file must load, validate, and
 * reference only real skills and real tools — and `--dry-run` must succeed
 * end to end, the same way a CI job would check before spending model calls.
 */
const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("evals scenarios", () => {
  test("finds scenario files to validate", () => {
    const files = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 12, `expected at least 12 scenarios, found ${files.length}`);
  });

  test("every scenario file validates", () => {
    // loadScenarios() throws on the first problem; reaching this line is the
    // assertion that none of them do.
    const scenarios = loadScenarios();
    assert.ok(scenarios.length >= 12);
  });

  test("every scenario name is unique", () => {
    const names = loadScenarios().map((s) => s.name);
    assert.deepEqual(names, [...new Set(names)]);
  });

  test("every scenario references only real skills", () => {
    const known = new Set(listSkillNames());
    for (const scenario of loadScenarios()) {
      for (const skill of scenario.skills) {
        assert.ok(known.has(skill), `${scenario.file} references unknown skill "${skill}"`);
      }
    }
  });

  test("every scenario references only real tools", () => {
    const known = new Set(TOOLS.map((t) => t.name));
    for (const scenario of loadScenarios()) {
      for (const expect of scenario.expect_calls) {
        assert.ok(known.has(expect.tool), `${scenario.file} expects unknown tool "${expect.tool}"`);
      }
      for (const tool of scenario.forbid_calls ?? []) {
        assert.ok(known.has(tool), `${scenario.file} forbids unknown tool "${tool}"`);
      }
    }
  });

  test("the required scenario shapes from the plan are present", () => {
    // A loose proxy for coverage: each of these substrings should show up in
    // at least one scenario's name, so the plan's required list stays covered
    // as scenarios are added or renamed.
    const names = loadScenarios().map((s) => s.name);
    const required = [
      "relative-due-date",
      "shopping-existing",
      "shopping-new",
      "person-fact",
      "knowledge-fact",
      "idea-capture",
      "daily-journal",
      "read-only",
      "project-decision",
      "ambiguous",
      "duplicate",
    ];
    for (const fragment of required) {
      assert.ok(
        names.some((n) => n.includes(fragment)),
        `no scenario name contains "${fragment}"`,
      );
    }
  });

  test("--dry-run validates every scenario, calls no model, and exits 0", () => {
    const result = spawnSync(process.execPath, ["evals/run.ts", "--dry-run"], {
      cwd: SERVER_ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /scenario\(s\) valid\. No model was called\./);
  });

  test("--only selects a single scenario in --dry-run", () => {
    const [first] = loadScenarios();
    const result = spawnSync(process.execPath, ["evals/run.ts", "--dry-run", "--only", first.name], {
      cwd: SERVER_ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`DRY-RUN ${first.name}:`));
    assert.equal(result.stdout.match(/^DRY-RUN /gm)?.length, 1);
  });

  test("running without EVAL_MODEL and without --dry-run fails loudly", () => {
    const result = spawnSync(process.execPath, ["evals/run.ts"], {
      cwd: SERVER_ROOT,
      encoding: "utf8",
      env: { ...process.env, EVAL_MODEL: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EVAL_MODEL is required/);
  });
});
