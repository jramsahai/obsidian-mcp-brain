import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { call, callFails, cleanupVault, read, useVault } from "./helpers.ts";

let root: string;
beforeEach(() => {
  root = useVault();
});
afterEach(cleanupVault);

const CORRECTION = {
  skill: "task-tracking",
  did: "marked the task done from a status update",
  wanted: "wait for explicit completion language",
};

describe("correction_log", () => {
  test("first call creates Corrections.md with the right frontmatter and section", () => {
    const result = call("correction_log", CORRECTION);
    assert.equal(result.logged, true);
    assert.equal(result.path, "Corrections.md");

    const content = read(root, "Corrections.md");
    assert.match(content, /^---\ntype: index\ncreated: \d{4}-\d{2}-\d{2}\n---\n\n# Corrections/);
    assert.match(content, /## Log/);
    assert.match(content, /\| Date \| Skill \| What happened \| What was wanted \| Rule \|/);
    assert.ok(content.includes(CORRECTION.skill));
    assert.ok(content.includes(CORRECTION.did));
    assert.ok(content.includes(CORRECTION.wanted));
  });

  test("a second call appends a row without duplicating the header", () => {
    call("correction_log", CORRECTION);
    call("correction_log", {
      skill: "daily-journal",
      did: "rewrote a sentence in the user's journal entry",
      wanted: "preserve the user's own wording",
    });

    const lines = read(root, "Corrections.md").split("\n");
    const headers = lines.filter((l) => l.startsWith("| Date | Skill |"));
    assert.equal(headers.length, 1, "the table header must appear exactly once");
    assert.ok(lines.some((l) => l.includes("task-tracking")));
    assert.ok(lines.some((l) => l.includes("daily-journal")));
  });

  test("same-day, different-text corrections both land", () => {
    call("correction_log", { ...CORRECTION, date: "2026-08-05" });
    call("correction_log", {
      skill: "task-tracking",
      did: "invented a due date the user never gave",
      wanted: "leave an unclear date in notes instead of guessing",
      date: "2026-08-05",
    });

    const content = read(root, "Corrections.md");
    assert.ok(content.includes(CORRECTION.did));
    assert.ok(content.includes("invented a due date the user never gave"));
  });

  test("an exact repeat is skipped", () => {
    call("correction_log", { ...CORRECTION, date: "2026-08-05" });
    const repeat = call("correction_log", { ...CORRECTION, date: "2026-08-05" });
    assert.equal(repeat.logged, false);

    const rows = read(root, "Corrections.md")
      .split("\n")
      .filter((l) => l.includes(CORRECTION.did));
    assert.equal(rows.length, 1);
  });

  test("rejects a skill that is not kebab-case", () => {
    assert.match(
      callFails("correction_log", { ...CORRECTION, skill: "Task Tracking" }),
      /kebab-case/,
    );
  });

  test("rejects an empty did or wanted", () => {
    assert.match(
      callFails("correction_log", { ...CORRECTION, did: "   " }),
      /did is empty/,
    );
    assert.match(
      callFails("correction_log", { ...CORRECTION, wanted: "   " }),
      /wanted is empty/,
    );
  });
});

describe("corrections_summary", () => {
  test("returns zeros on a vault without the note", () => {
    assert.deepEqual(call("corrections_summary"), { total: 0, by_skill: [], recent: [] });
  });

  test("groups by skill and rule, sorted by count", () => {
    call("correction_log", {
      skill: "task-tracking",
      did: "a",
      wanted: "b",
      rule: "wait for explicit completion language",
      date: "2026-08-01",
    });
    call("correction_log", {
      skill: "task-tracking",
      did: "c",
      wanted: "d",
      rule: "wait for explicit completion language",
      date: "2026-08-02",
    });
    call("correction_log", {
      skill: "daily-journal",
      did: "e",
      wanted: "f",
      rule: "preserve the user's own wording",
      date: "2026-08-03",
    });

    const summary = call("corrections_summary");
    assert.equal(summary.total, 3);
    assert.equal(summary.by_skill.length, 2);
    assert.equal(summary.by_skill[0].skill, "task-tracking");
    assert.equal(summary.by_skill[0].count, 2);
    assert.equal(summary.by_skill[0].last_date, "2026-08-02");
    assert.deepEqual(summary.by_skill[0].rules, [
      { rule: "wait for explicit completion language", count: 2 },
    ]);
    assert.equal(summary.by_skill[1].skill, "daily-journal");
    assert.equal(summary.by_skill[1].count, 1);
  });

  test("honours since and skill filters", () => {
    call("correction_log", { skill: "task-tracking", did: "a", wanted: "b", date: "2026-08-01" });
    call("correction_log", { skill: "daily-journal", did: "c", wanted: "d", date: "2026-08-10" });

    assert.equal(call("corrections_summary", { since: "2026-08-05" }).total, 1);
    assert.equal(call("corrections_summary", { skill: "task-tracking" }).total, 1);
    assert.equal(call("corrections_summary", { skill: "daily-journal" }).by_skill[0].count, 1);
  });

  test("recent holds the 5 most recent rows, newest first", () => {
    for (let i = 1; i <= 6; i++) {
      call("correction_log", {
        skill: "task-tracking",
        did: `did ${i}`,
        wanted: `wanted ${i}`,
        date: `2026-08-0${i}`,
      });
    }
    const summary = call("corrections_summary");
    assert.equal(summary.recent.length, 5);
    assert.equal(summary.recent[0].date, "2026-08-06");
    assert.equal(summary.recent[4].date, "2026-08-02");
  });
});

describe("vault_status", () => {
  test("reports corrections_count", () => {
    assert.equal(call("vault_status").corrections_count, 0);
    call("correction_log", CORRECTION);
    assert.equal(call("vault_status").corrections_count, 1);
  });
});
