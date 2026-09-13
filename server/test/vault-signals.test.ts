import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { call, cleanupVault, useVault } from "./helpers.ts";

let root: string;

function git(...args: string[]): string {
  return execFileSync("/usr/bin/git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

/** Commit everything currently on disk, with a controlled author/committer date. */
function commit(message: string, isoDate: string): void {
  git("add", "-A");
  execFileSync("/usr/bin/git", ["-C", root, "commit", "-q", "-m", message], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
}

afterEach(cleanupVault);

describe("vault_signals", () => {
  test("reject_rate reflects a temp git vault's machine commit and a human revert", () => {
    root = useVault({ git: true });
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    commit("fixture", "2026-07-01T09:00:00-04:00");

    const projectFile = join(root, "Projects", "Example Project", "Example Project.md");
    const before = readFileSync(projectFile, "utf8");
    const afterAdd = before.replace(
      "## Related\n\n- [[Onboarding Playbook]] — source material for the deck",
      "## Related\n\n- [[Onboarding Playbook]] — source material for the deck\n- [[Pricing Models]] — referenced in the pricing call",
    );

    writeFileSync(projectFile, afterAdd);
    commit("nightly consolidation 2026-07-02", "2026-07-02T23:30:00-04:00");

    // A human commit within the 14-day rejection window reverts the new bullet.
    writeFileSync(projectFile, before);
    commit("Manual cleanup", "2026-07-04T10:00:00-04:00");

    const result = call("vault_signals", { since: "2020-01-01" });

    assert.equal(result.reject_rate_unavailable, null);
    assert.ok(result.reject_rate, "expected a reject_rate section");
    assert.equal(result.reject_rate.machine_commits, 1);
    assert.equal(result.reject_rate.added, 1);
    assert.equal(result.reject_rate.rejected, 1);

    const related = result.reject_rate.by_category.find((c: { category: string }) => c.category === "Related bullet");
    assert.ok(related, "expected the new bullet classified as a Related bullet");
    assert.equal(related.rejected, 1);
    assert.equal(typeof result.elapsed_ms, "number");
  });

  test("git disabled: reject_rate is null with a reason naming the fix; the other sections still populate", () => {
    root = useVault({ git: false });
    const result = call("vault_signals");

    assert.equal(result.reject_rate, null);
    assert.match(result.reject_rate_unavailable, /VAULT_GIT=1/);

    assert.ok(result.calibration);
    assert.equal(typeof result.calibration.pairs_scored, "number");
    assert.equal(typeof result.calibration.threshold, "number");

    // The fixture vault ships with no Corrections.md or Ignored Links.md.
    assert.deepEqual(result.corrections, { total: 0, by_skill: [], recent: [] });
    assert.deepEqual(result.ignored_links, { count: 0, rows: [] });
  });

  test("since filters corrections and ignored links", () => {
    root = useVault({ git: false });

    call("correction_log", {
      skill: "task-tracking",
      did: "marked the task done from a status update",
      wanted: "wait for explicit completion language",
      date: "2026-07-01",
    });
    call("correction_log", {
      skill: "daily-journal",
      did: "rewrote a sentence in the user's journal entry",
      wanted: "preserve the user's own wording",
      date: "2026-08-10",
    });

    // Server-owned shape from ignored.ts's initialContent(), written directly
    // so each row can carry a distinct Since date (link_ignore always stamps
    // today).
    writeFileSync(
      join(root, "Ignored Links.md"),
      [
        "---",
        "type: index",
        "created: 2026-07-01",
        "---",
        "",
        "# Ignored Links",
        "",
        "Names deliberately left uncreated — the nightly stops proposing them.",
        "",
        "## Ignored",
        "",
        "| Target | Reason | Since |",
        "| --- | --- | --- |",
        "| Old Candidate | retired earlier | 2026-07-01 |",
        "| New Candidate | retired this month | 2026-08-10 |",
        "",
      ].join("\n"),
    );

    const result = call("vault_signals", { since: "2026-08-01" });

    assert.equal(result.corrections.total, 1);
    assert.equal(result.corrections.by_skill.length, 1);
    assert.equal(result.corrections.by_skill[0].skill, "daily-journal");

    assert.equal(result.ignored_links.count, 1);
    assert.equal(result.ignored_links.rows[0].target, "New Candidate");
  });

  test("window_days must be a whole number of at least 1", () => {
    root = useVault({ git: false });
    let message = "";
    try {
      call("vault_signals", { window_days: 0 });
    } catch (error) {
      message = (error as Error).message;
    }
    assert.match(message, /window_days must be a whole number/);
  });
});
