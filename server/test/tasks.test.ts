import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { today } from "../src/config.ts";
import { composeTaskLine, parseTaskLine } from "../src/tasks.ts";
import { call, callFails, cleanupVault, lineOf, read, useVault } from "./helpers.ts";

let root: string;
beforeEach(() => {
  root = useVault();
});
afterEach(cleanupVault);

describe("task line grammar", () => {
  test("composes markers in the documented order", () => {
    const line = composeTaskLine({
      done: false,
      text: "Send the proposal",
      project: "Example Project",
      due: "2026-08-04",
      priority: "high",
      waitingOn: "Jane Doe",
      waitingSince: "2026-07-20",
      notes: "second reminder",
    });
    assert.equal(
      line,
      "- [ ] Send the proposal [[Example Project]] 📅 2026-08-04 ⏫ (waiting on: [[Jane Doe]] since 2026-07-20) — second reminder",
    );
  });

  test("omits every optional marker when unset", () => {
    assert.equal(
      composeTaskLine({ done: false, text: "Standalone task", priority: "none" }),
      "- [ ] Standalone task",
    );
  });

  test("emits the completion marker before the notes", () => {
    assert.equal(
      composeTaskLine({
        done: true,
        text: "Book the kickoff",
        project: "Example Project",
        priority: "none",
        completed: "2026-07-15",
        notes: "done early",
      }),
      "- [x] Book the kickoff [[Example Project]] ✅ 2026-07-15 — done early",
    );
  });

  test("round-trips a line written in legacy marker order", () => {
    const legacy = "- [x] Ship the demo ⏫ [[Example Project]] ✅ 2026-07-19 — shipped late";
    const parsed = parseTaskLine(legacy, 0, "Done");
    assert.ok(parsed);
    assert.equal(parsed.text, "Ship the demo");
    assert.equal(parsed.project, "Example Project");
    assert.equal(parsed.priority, "high");
    assert.equal(parsed.completed, "2026-07-19");
    assert.equal(parsed.notes, "shipped late");
    assert.equal(
      composeTaskLine(parsed),
      "- [x] Ship the demo [[Example Project]] ⏫ ✅ 2026-07-19 — shipped late",
    );
  });

  test("parses every marker combination in the fixture", () => {
    const doc = read(root, "Tasks.md");
    const waiting = parseTaskLine(lineOf(doc, "Confirm the vendor quote"), 0, "Waiting On Others");
    assert.equal(waiting?.waitingOn, "Jane Doe");
    assert.equal(waiting?.waitingSince, "2026-07-20");
    const notes = parseTaskLine(lineOf(doc, "Send Jane the revised scope"), 0, "Waiting On Me");
    assert.equal(notes?.notes, "she asked twice");
  });
});

describe("task_add", () => {
  test("writes the byte-exact line into the requested section", () => {
    const result = call("task_add", {
      text: "Send the proposal",
      project: "Example Project",
      due: "2026-08-09",
      priority: "medium",
      notes: "attach the pricing sheet",
    });
    assert.equal(result.section, "Active");
    const doc = read(root, "Tasks.md");
    assert.equal(
      lineOf(doc, "Send the proposal"),
      "- [ ] Send the proposal [[Example Project]] 📅 2026-08-09 🔼 — attach the pricing sheet",
    );
  });

  test("waiting_on files the task under Waiting On Others and dates the wait", () => {
    const result = call("task_add", { text: "Get the signed SOW", waiting_on: "Jane Doe" });
    assert.equal(result.section, "Waiting On Others");
    const doc = read(root, "Tasks.md");
    assert.equal(
      lineOf(doc, "Get the signed SOW"),
      `- [ ] Get the signed SOW (waiting on: [[Jane Doe]] since ${today()})`,
    );
    // Landed inside the right section, not at the end of the file.
    const lines = doc.split("\n");
    const sectionAt = lines.findIndex((l) => l === "## Waiting On Others");
    const doneAt = lines.findIndex((l) => l === "## Done");
    const taskAt = lines.findIndex((l) => l.includes("Get the signed SOW"));
    assert.ok(taskAt > sectionAt && taskAt < doneAt);
  });

  test("rejects a near-duplicate and names the tool to use instead", () => {
    const message = callFails("task_add", { text: "Draft the onboarding deck" });
    assert.match(message, /already exists in "Active"/);
    assert.match(message, /task_update/);
  });

  test("allows re-adding work whose only match is already completed", () => {
    const result = call("task_add", { text: "Book the kickoff meeting", project: "Example Project" });
    assert.equal(result.section, "Active");
    const occurrences = read(root, "Tasks.md")
      .split("\n")
      .filter((l) => l.includes("Book the kickoff meeting")).length;
    assert.equal(occurrences, 2);
  });

  test("rejects a project with no note, listing real project names", () => {
    const message = callFails("task_add", { text: "New work", project: "Exampel Projct" });
    assert.match(message, /would not resolve/);
    assert.match(message, /Example Project/);
  });

  test("rejects a relative due date instead of guessing", () => {
    const message = callFails("task_add", { text: "New work", due: "friday" });
    assert.match(message, /YYYY-MM-DD/);
  });

  test("leaves Tasks.md frontmatter byte-identical", () => {
    const before = read(root, "Tasks.md").split("---")[1];
    call("task_add", { text: "A brand new unrelated task" });
    assert.equal(read(root, "Tasks.md").split("---")[1], before);
  });
});

describe("task_update", () => {
  test("completing a task stamps the date and moves it to Done", () => {
    const result = call("task_update", { match: "pricing model", done: true });
    assert.equal(result.section, "Done");
    assert.equal(result.moved, true);
    const doc = read(root, "Tasks.md");
    assert.equal(
      lineOf(doc, "Review the pricing model"),
      `- [x] Review the pricing model [[Example Project]] ✅ ${today()}`,
    );
    const lines = doc.split("\n");
    assert.ok(
      lines.findIndex((l) => l.includes("Review the pricing model")) >
        lines.findIndex((l) => l === "## Done"),
    );
  });

  test("preserves markers it was not asked to change", () => {
    call("task_update", { match: "onboarding deck", notes: "slides only" });
    assert.equal(
      lineOf(read(root, "Tasks.md"), "onboarding deck"),
      "- [ ] Draft the onboarding deck [[Example Project]] 📅 2026-08-04 ⏫ — slides only",
    );
  });

  test("clears a marker when passed an empty string", () => {
    call("task_update", { match: "onboarding deck", due: "", priority: "none" });
    assert.equal(
      lineOf(read(root, "Tasks.md"), "onboarding deck"),
      "- [ ] Draft the onboarding deck [[Example Project]]",
    );
  });

  test("setting waiting_on moves an Active task to Waiting On Others", () => {
    const result = call("task_update", {
      match: "onboarding deck",
      waiting_on: "Jane Doe",
      waiting_since: "2026-07-28",
    });
    assert.equal(result.section, "Waiting On Others");
    assert.match(
      lineOf(read(root, "Tasks.md"), "onboarding deck"),
      /\(waiting on: \[\[Jane Doe\]\] since 2026-07-28\)$/,
    );
  });

  test("an ambiguous match refuses to guess and lists the candidates", () => {
    const message = callFails("task_update", { match: "the", done: true });
    assert.match(message, /matches \d+ tasks/);
  });

  test("a match with no candidates says how to find the wording", () => {
    assert.match(callFails("task_update", { match: "nonexistent work" }), /no task in Tasks\.md/);
  });

  test("does not duplicate the task when moving sections", () => {
    call("task_update", { match: "pricing model", done: true });
    const occurrences = read(root, "Tasks.md")
      .split("\n")
      .filter((l) => l.includes("Review the pricing model")).length;
    assert.equal(occurrences, 1);
  });
});
