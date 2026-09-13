import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { computeRejectRate, formatRejectRateMarkdown, isoWeek } from "../src/reject-rate.ts";

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "reject-rate-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  mkdirSync(join(root, "Projects", "Example Project"), { recursive: true });
  mkdirSync(join(root, "People"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("computeRejectRate", () => {
  test("classifies added lines and marks the one a human commit reverts as rejected", () => {
    // Baseline: a plain-text mention nightly consolidation will later wikilink.
    writeFileSync(join(root, "People", "Jane Doe.md"), "# Jane Doe\n\nTalked to Jane Doe about the roadmap.\n");
    writeFileSync(
      join(root, "Projects", "Example Project", "Example Project.md"),
      "# Example Project\n\n## Related\n\n",
    );
    writeFileSync(root + "/Tasks.md", "# Tasks\n\n");
    commit("Initial fixture", "2026-07-01T09:00:00-04:00");

    // Machine commit one: a wikilink insertion, a Related bullet, a task line, and an "other" line.
    writeFileSync(join(root, "People", "Jane Doe.md"), "# Jane Doe\n\nTalked to [[Jane Doe]] about the roadmap.\n\n- New fact about Jane.\n");
    writeFileSync(
      join(root, "Projects", "Example Project", "Example Project.md"),
      "# Example Project\n\n## Related\n\n- [[Onboarding Playbook]] — source material for the deck\n",
    );
    writeFileSync(root + "/Tasks.md", "# Tasks\n\n- [ ] Draft the onboarding deck\n");
    commit("nightly consolidation 2026-07-02", "2026-07-02T23:30:00-04:00");

    // Machine commit two: a second, unrelated nightly-labelled commit.
    writeFileSync(root + "/Inbox.md", "- 2026-07-03: a quick capture\n");
    commit("pre-consolidation 2026-07-03", "2026-07-03T09:00:00-04:00");

    // Human commit within the 14-day window: reverts the Related bullet only.
    writeFileSync(
      join(root, "Projects", "Example Project", "Example Project.md"),
      "# Example Project\n\n## Related\n\n",
    );
    commit("Manual cleanup", "2026-07-04T10:00:00-04:00");

    const report = computeRejectRate(root);

    assert.equal(report.machineCommits, 2);
    assert.equal(report.overall.added, 5);
    assert.equal(report.overall.rejected, 1);

    const wikilink = report.lines.find((l) => l.category === "wikilink insertion");
    assert.ok(wikilink, "expected a wikilink insertion to be classified");
    assert.equal(wikilink!.text, "Talked to [[Jane Doe]] about the roadmap.");
    assert.equal(wikilink!.rejected, false);

    const related = report.lines.find((l) => l.category === "Related bullet");
    assert.ok(related, "expected a Related bullet to be classified");
    assert.equal(related!.rejected, true);

    const task = report.lines.find((l) => l.category === "task line");
    assert.ok(task, "expected a task line to be classified");
    assert.equal(task!.rejected, false);

    const other = report.lines.find((l) => l.category === "other");
    assert.ok(other, "expected the unclassified line to fall back to other");

    const byCategory = new Map(report.byCategory.map((c) => [c.category, c]));
    assert.equal(byCategory.get("Related bullet")?.rejected, 1);
    assert.equal(byCategory.get("wikilink insertion")?.rejected, 0);

    assert.deepEqual(
      report.topFiles.map((f) => f.file),
      ["Projects/Example Project/Example Project.md"],
    );

    const week = isoWeek("2026-07-02");
    const weekStat = report.byWeek.find((w) => w.week === week);
    assert.ok(weekStat, "expected the machine commit's week to be reported");

    const markdown = formatRejectRateMarkdown(report);
    assert.match(markdown, /# Reject rate/);
    assert.match(markdown, /Related bullet/);
  });

  test("does not count a revert outside the rejection window", () => {
    writeFileSync(
      join(root, "Projects", "Example Project", "Example Project.md"),
      "# Example Project\n\n## Related\n\n",
    );
    commit("Initial fixture", "2026-07-01T09:00:00-04:00");

    writeFileSync(
      join(root, "Projects", "Example Project", "Example Project.md"),
      "# Example Project\n\n## Related\n\n- [[Onboarding Playbook]] — source material for the deck\n",
    );
    commit("nightly consolidation 2026-07-02", "2026-07-02T23:30:00-04:00");

    // 20 days later — outside the default 14-day window.
    writeFileSync(
      join(root, "Projects", "Example Project", "Example Project.md"),
      "# Example Project\n\n## Related\n\n",
    );
    commit("Manual cleanup", "2026-07-22T10:00:00-04:00");

    const report = computeRejectRate(root);
    assert.equal(report.overall.added, 1);
    assert.equal(report.overall.rejected, 0);
  });

  test("human commits contribute no added lines", () => {
    writeFileSync(root + "/Inbox.md", "- 2026-07-01: a capture\n");
    commit("Human capture", "2026-07-01T09:00:00-04:00");
    const report = computeRejectRate(root);
    assert.equal(report.machineCommits, 0);
    assert.equal(report.overall.added, 0);
    assert.equal(report.overall.rejected, 0);
    assert.deepEqual(report.lines, []);
  });

  test("--since limits which commits are analyzed", () => {
    writeFileSync(root + "/Inbox.md", "- x\n");
    commit("Initial fixture", "2026-01-01T09:00:00-04:00");
    writeFileSync(root + "/Tasks.md", "# Tasks\n\n- [ ] old task\n");
    commit("nightly consolidation 2026-01-02", "2026-01-02T09:00:00-04:00");
    writeFileSync(root + "/Tasks.md", "# Tasks\n\n- [ ] old task\n- [ ] new task\n");
    commit("nightly consolidation 2026-08-01", "2026-08-01T09:00:00-04:00");

    const report = computeRejectRate(root, { since: "2026-06-01" });
    assert.equal(report.machineCommits, 1);
    assert.equal(report.overall.added, 1);
  });
});
