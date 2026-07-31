import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
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
    const result = call("vault_snapshot", {
      label: "nightly consolidation 2026-07-31 (post)",
      scope: "all",
    });
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

  test("does not sweep the user's own uncommitted edits into the machine's commit", () => {
    // The user, working in Obsidian: an edit and a deletion the server never made.
    appendFileSync(join(root, "Inbox.md"), "- 2026-07-31: typed in the app\n");
    rmSync(join(root, "People", "Jane Doe.md"));
    call("task_add", { text: "A task the machine added" });

    const result = call("vault_snapshot", { label: "nightly (post)" });
    assert.equal(result.committed, true);
    const files = git("show", "--name-only", "--pretty=format:", "HEAD").split("\n").filter(Boolean);
    assert.deepEqual(files, ["Tasks.md"], "the machine's commit must contain only the machine's write");
    // The user's work is still uncommitted, and still there.
    assert.match(git("status", "--porcelain"), /Inbox\.md/);
    assert.match(readFileSync(join(root, "Inbox.md"), "utf8"), /typed in the app/);
  });

  test("counts every file in a newly created folder, not the folder as one entry", () => {
    call("note_create", { type: "project", name: "Alpha Thing" });
    call("note_create", { type: "meeting", name: "Alpha Kickoff", project: "Alpha Thing" });
    const result = call("vault_snapshot", { label: "created a project" });
    const files = git("show", "--name-only", "--pretty=format:", "HEAD").split("\n").filter(Boolean);
    assert.equal(result.files_changed, files.length);
    assert.equal(result.files_changed, 2);
  });

  test("scope=machine with nothing written commits nothing", () => {
    appendFileSync(join(root, "Inbox.md"), "- 2026-07-31: only the user wrote this\n");
    const result = call("vault_snapshot", { label: "nightly (post)" });
    assert.equal(result.committed, false);
    assert.match(result.message, /written no notes/);
  });
});

describe("git enabled but unusable", () => {
  test("vault_status reports the failure instead of looking clean", () => {
    cleanupVault();
    root = useVault({ git: true }); // git:true, but never `git init`ed
    const status = call("vault_status");
    assert.equal(status.git_enabled, true);
    assert.equal(status.git_dirty, null);
    assert.match(status.git_error, /not a git repository|VAULT_GIT_BIN/);
  });

  test("vault_snapshot names the vault and the binary rather than leaking a git fatal", () => {
    cleanupVault();
    root = useVault({ git: true });
    const message = callFails("vault_snapshot", { label: "x" });
    assert.match(message, /not a git repository|VAULT_GIT_BIN/);
    assert.ok(message.includes(root), "the error should name the vault path");
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
