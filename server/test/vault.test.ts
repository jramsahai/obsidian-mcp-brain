import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { call, callFails, cleanupVault, read, useVault } from "./helpers.ts";

let root: string;
beforeEach(() => {
  root = useVault();
});
afterEach(cleanupVault);

describe("vault_read", () => {
  test("resolves a bare wikilink target to its nested path", () => {
    const result = call("vault_read", { note: "Example Project" });
    assert.equal(result.path, "Projects/Example Project/Example Project.md");
    assert.equal(result.frontmatter.status, "Active");
    assert.deepEqual(result.frontmatter.topics, ["onboarding", "pricing"]);
  });

  test("accepts wikilink syntax and a vault-relative path equally", () => {
    const viaLink = call("vault_read", { note: "[[Jane Doe]]" });
    const viaPath = call("vault_read", { note: "People/Jane Doe.md" });
    assert.equal(viaLink.path, viaPath.path);
  });

  test("reads a single section", () => {
    const result = call("vault_read", { note: "Example Project", section: "Stakeholders" });
    assert.match(result.content, /^## Stakeholders/);
    assert.match(result.content, /Jane Doe/);
    assert.doesNotMatch(result.content, /Key Decisions/);
  });

  test("a missing note names close candidates instead of failing blankly", () => {
    const message = callFails("vault_read", { note: "Example Projekt" });
    assert.match(message, /not found in the vault/);
    assert.match(message, /Example Project/);
  });

  test("ignores headings inside fenced code blocks", () => {
    const result = call("vault_read", { note: "2026-07-30" });
    assert.deepEqual(result.sections, ["2026-07-30", "Log", "Notes"]);
  });
});

describe("vault_list", () => {
  test("filters by frontmatter type", () => {
    const result = call("vault_list", { type: "project" });
    assert.deepEqual(
      result.notes.map((n: { title: string }) => n.title).sort(),
      ["Example Project", "Project Template"],
    );
  });

  test("latest returns only the newest date-named note", () => {
    const result = call("vault_list", { folder: "Syntheses", latest: true });
    assert.equal(result.total, 1);
    assert.equal(result.notes[0].title, "2026-07-22");
  });

  test("filters by status", () => {
    assert.equal(call("vault_list", { status: "Active" }).total, 2);
  });

  test("says so when a cap hides notes", () => {
    const result = call("vault_list", { limit: 2 });
    assert.equal(result.returned, 2);
    assert.ok(result.total > 2);
    assert.equal(result.truncated, true);
    assert.match(result.note, /more notes exist/);
    assert.equal(result.notes.length, 2);
  });

  test("does not claim truncation when everything fits", () => {
    const result = call("vault_list", { type: "project" });
    assert.equal(result.truncated, false);
    assert.equal(result.note, undefined);
    assert.equal(result.returned, result.total);
  });
});

describe("ambiguous note names", () => {
  test("a bare date is the daily note, not the synthesis of the same day", () => {
    // Every synthesis written on a day that also has a journal entry creates
    // this collision, so it has to resolve by convention rather than error.
    const result = call("vault_read", { note: "2026-07-20" });
    assert.equal(result.path, "Daily/2026-07-20.md");
  });

  test("the synthesis is still reachable by path", () => {
    assert.equal(call("vault_read", { note: "Syntheses/2026-07-20" }).path, "Syntheses/2026-07-20.md");
    assert.equal(call("vault_read", { note: "Daily/2026-07-20" }).path, "Daily/2026-07-20.md");
  });

  test("a bare name means the note at the vault root", () => {
    assert.equal(call("vault_read", { note: "Inbox" }).path, "Inbox.md");
    assert.equal(call("vault_read", { note: "Knowledge Base/Inbox" }).path, "Knowledge Base/Inbox.md");
  });

  test("a collision with no convention to appeal to still errors, listing the paths", () => {
    const message = callFails("vault_read", { note: "Overlap" });
    assert.match(message, /ambiguous — 2 notes share that name/);
    assert.match(message, /Knowledge Base\/Pricing\/Overlap\.md/);
    assert.match(message, /Knowledge Base\/Tools\/Overlap\.md/);
    assert.match(message, /Pass the full vault-relative path/);
  });

  test("wikilink and alias forms resolve the same way", () => {
    assert.equal(call("vault_read", { note: "[[2026-07-20]]" }).path, "Daily/2026-07-20.md");
    assert.equal(call("vault_read", { note: "[[2026-07-20|that day]]" }).path, "Daily/2026-07-20.md");
  });
});

describe("vault_search", () => {
  test("returns matching lines with line numbers", () => {
    const result = call("vault_search", { query: "vendor quote" });
    const paths = result.results.map((r: { path: string }) => r.path);
    assert.ok(paths.includes("Tasks.md"));
    assert.ok(result.results[0].matches[0].line > 0);
  });

  test("scopes to a folder", () => {
    const result = call("vault_search", { query: "Example Project", folder: "People" });
    assert.deepEqual(
      result.results.map((r: { path: string }) => r.path),
      ["People/Jane Doe.md"],
    );
  });

  test("reports the true match count even when the limit hides notes", () => {
    const all = call("vault_search", { query: "Example Project" });
    assert.ok(all.total_matching_notes > 1, "fixture should match several notes");
    assert.equal(all.truncated, false);

    const capped = call("vault_search", { query: "Example Project", limit: 1 });
    // The count must describe the vault, not the page — this is the bug that
    // made partial evidence look complete.
    assert.equal(capped.total_matching_notes, all.total_matching_notes);
    assert.equal(capped.returned, 1);
    assert.equal(capped.truncated, true);
    assert.match(capped.note, /more notes matched/);
  });

  test("reports matching lines hidden within a single note", () => {
    const result = call("vault_search", { query: "-" });
    const busiest = result.results.find((r: { more_matches?: number }) => r.more_matches);
    assert.ok(busiest, "a note with more than 5 matching lines should report the remainder");
    assert.ok(busiest.more_matches > 0);
    assert.equal(busiest.matches.length, 5);
  });
});

describe("vault_links", () => {
  test("backlinks include links made from frontmatter", () => {
    const result = call("vault_links", { note: "Example Project", direction: "in" });
    assert.ok(result.links.includes("People/Jane Doe.md"));
    assert.ok(result.links.includes("Tasks.md"));
  });

  test("unresolved lists link targets that have no note", () => {
    const result = call("vault_links", { direction: "unresolved" });
    const targets = result.unresolved.map((u: { target: string }) => u.target);
    assert.ok(targets.includes("Onboarding Playbook"));
    // Links inside code fences are not real edges.
    assert.ok(!targets.includes("Not A Real Link"));
    assert.ok(!targets.includes("Also Not A Link"));
    // Nor are template placeholders. Counting `[[First Last]]` from
    // Projects/Project Template.md put a phantom candidate in every report
    // that the user had no way to ever resolve.
    assert.ok(!targets.includes("First Last"));
  });

  test("reports the true orphan count when the list is capped", () => {
    const result = call("vault_links", { direction: "orphans", limit: 1 });
    assert.equal(result.returned, 1);
    assert.ok(result.total >= 1);
    assert.equal(result.truncated, result.total > 1);
  });

  test("in and out require a note and say so", () => {
    assert.match(callFails("vault_links", { direction: "out" }), /note is required/);
  });

  test("rejects a direction outside the enum, listing the valid ones", () => {
    const message = callFails("vault_links", { direction: "sideways" });
    assert.match(message, /must be one of: in, out, unresolved, orphans, deadends/);
  });
});

describe("vault_status", () => {
  test("reports orientation without any exploratory reads", () => {
    const result = call("vault_status");
    assert.match(result.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(result.last_synthesis_date, "2026-07-22");
    assert.equal(result.last_daily_date, "2026-07-30");
    assert.equal(result.counts_by_type.project, 2);
    assert.ok(result.unresolved_count >= 1);
    assert.equal(result.git_dirty, null); // git disabled in the fixture config
  });
});

describe("section_append", () => {
  test("appends a row to a table section, not a bullet", () => {
    const result = call("section_append", {
      note: "Jane Doe",
      section: "Conversation History",
      content: "| 2026-07-31 | Call | Agreed on scope |",
    });
    assert.equal(result.as_table_row, true);
    const doc = read(root, "People/Jane Doe.md");
    const lines = doc.split("\n");
    const rowAt = lines.findIndex((l) => l.includes("Agreed on scope"));
    const nextHeadingAt = lines.findIndex((l) => l === "## Pending Topics");
    assert.equal(lines[rowAt], "| 2026-07-31 | Call | Agreed on scope |");
    assert.ok(rowAt < nextHeadingAt, "row must land inside the section, not after it");
  });

  test("a table section refuses prose and states the column layout", () => {
    const message = callFails("section_append", {
      note: "Jane Doe",
      section: "Conversation History",
      content: "Agreed on scope",
    });
    assert.match(message, /is a table with columns: Date \| Context \| Summary/);
    assert.match(message, /pipe-delimited row/);
  });

  test("a row with the wrong column count is rejected", () => {
    const message = callFails("section_append", {
      note: "Jane Doe",
      section: "Conversation History",
      content: "| 2026-07-31 | Call |",
    });
    assert.match(message, /3 columns .* the row provided has 2/);
  });

  test("appends to a bullet section at the end of that section", () => {
    call("section_append", {
      note: "Example Project",
      section: "Related",
      content: "- [[Jane Doe]] — sponsor context",
    });
    const doc = read(root, "Projects/Example Project/Example Project.md");
    const lines = doc.split("\n");
    assert.equal(lines[lines.findIndex((l) => l.includes("sponsor context"))], "- [[Jane Doe]] — sponsor context");
    assert.ok(doc.indexOf("Onboarding Playbook") < doc.indexOf("sponsor context"));
  });

  test("is idempotent — a second identical append changes nothing", () => {
    const args = {
      note: "Example Project",
      section: "Related",
      content: "- [[Jane Doe]] — sponsor context",
    };
    call("section_append", args);
    const after = read(root, "Projects/Example Project/Example Project.md");
    const second = call("section_append", args);
    assert.equal(second.appended, false);
    assert.match(second.reason, /already present/);
    assert.equal(read(root, "Projects/Example Project/Example Project.md"), after);
  });

  test("a missing section lists the sections that exist", () => {
    const message = callFails("section_append", {
      note: "Example Project",
      section: "Activity Log",
      content: "- something",
    });
    assert.match(message, /section "Activity Log" not found/);
    assert.match(message, /sections present: .*Key Decisions/);
  });

  test("create_section inserts the heading in template position", () => {
    call("section_append", {
      note: "Example Project",
      section: "Activity Log",
      content: "- 2026-07-31: reviewed",
      create_section: true,
    });
    const doc = read(root, "Projects/Example Project/Example Project.md");
    assert.ok(doc.indexOf("## Related\n") < doc.indexOf("## Activity Log"));
    assert.match(doc, /## Activity Log\n\n- 2026-07-31: reviewed/);
  });

  test("leaves frontmatter byte-identical after a body edit", () => {
    const path = "Projects/Example Project/Example Project.md";
    const before = read(root, path).split("\n---\n")[0];
    call("section_append", { note: "Example Project", section: "Related", content: "- [[Tasks]] — x" });
    assert.equal(read(root, path).split("\n---\n")[0], before);
  });

  test("does not treat a heading inside a code fence as a section", () => {
    assert.match(
      callFails("section_append", { note: "2026-07-30", section: "Not A Real Section", content: "- x" }),
      /not found/,
    );
  });
});
