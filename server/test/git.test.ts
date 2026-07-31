import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { readNote, writeNoteGuarded } from "../src/vault.ts";
import { call, callFails, cleanupVault, useVault } from "./helpers.ts";

let root: string;

function git(...args: string[]): string {
  return execFileSync("/usr/bin/git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

beforeEach(() => {
  root = useVault({ git: true });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
});
afterEach(cleanupVault);

describe("vault_snapshot", () => {
  test("a clean tree is success, not an error", () => {
    const result = call("vault_snapshot", { label: "nightly (pre)" });
    assert.equal(result.committed, false);
    assert.equal(result.files_changed, 0);
    assert.match(result.message, /nothing to commit/);
  });

  test("commits pending changes and returns the sha", () => {
    appendFileSync(join(root, "Inbox.md"), "- 2026-07-31: another capture\n");
    const result = call("vault_snapshot", { label: "nightly consolidation 2026-07-31 (post)" });
    assert.equal(result.committed, true);
    assert.equal(result.files_changed, 1);
    assert.match(result.sha, /^[0-9a-f]{7,}$/);
    assert.equal(git("log", "-1", "--pretty=%s"), "nightly consolidation 2026-07-31 (post)");
  });

  test("a tool write is visible to the very next snapshot", () => {
    call("task_add", { text: "Something new to snapshot" });
    const result = call("vault_snapshot", { label: "after task_add" });
    assert.equal(result.committed, true);
    assert.match(git("show", "--stat", "HEAD"), /Tasks\.md/);
  });
});

describe("concurrent-edit guard", () => {
  test("refuses to clobber a note the Obsidian app changed mid-edit", () => {
    const path = "Inbox.md";
    const before = readNote(path);
    // Simulate the desktop app saving the file after we read it.
    appendFileSync(join(root, path), "- 2026-07-31: typed in the app\n");
    utimesSync(join(root, path), new Date(), new Date(Date.now() + 5000));

    assert.throws(
      () => writeNoteGuarded(path, before.mtimeMs, "clobbered"),
      /changed on disk while this edit was being prepared/,
    );
    assert.match(readFileSync(join(root, path), "utf8"), /typed in the app/);
  });
});

describe("git disabled", () => {
  test("vault_snapshot says how to turn git on rather than failing opaquely", () => {
    cleanupVault();
    root = useVault({ git: false });
    assert.match(callFails("vault_snapshot", { label: "x" }), /VAULT_GIT=1/);
  });
});
