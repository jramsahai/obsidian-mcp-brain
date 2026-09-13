import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  test("filters by frontmatter type, leaving templates out", () => {
    // The template carries type: project and status: Active, so including it
    // would report it as a live project in every standup.
    const result = call("vault_list", { type: "project" });
    assert.deepEqual(result.notes.map((n: { title: string }) => n.title), ["Example Project"]);
  });

  test("include_templates opts the template back in", () => {
    const result = call("vault_list", { type: "project", include_templates: true });
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
    assert.equal(call("vault_list", { status: "Active" }).total, 1);
    assert.equal(call("vault_list", { status: "Active", include_templates: true }).total, 2);
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
    assert.match(message, /must be one of: in, out, unresolved, ignored, orphans, deadends/);
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
    assert.equal(result.last_review_week, null); // fixture vault has no Reviews/ yet
    // Fixture Tasks.md: 4 open (Active x2, Waiting On Me x1, Waiting On Others
    // x1), 1 done. Only "Draft the onboarding deck" (due 2026-08-04) is dated
    // and open, and it is already in the past — permanently overdue, never
    // due_in_7_days. Only "Confirm the vendor quote" carries a waiting_on.
    assert.deepEqual(result.tasks, { open: 4, overdue: 1, due_in_7_days: 0, waiting: 1 });
  });

  test("last_review_week reports the latest review note", () => {
    call("note_create", { type: "review", name: "2026-W30" });
    call("note_create", { type: "review", name: "2026-W31" });
    assert.equal(call("vault_status").last_review_week, "2026-W31");
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
      section: "Retrospective",
      content: "- something",
    });
    assert.match(message, /section "Retrospective" not found/);
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
    assert.ok(doc.indexOf("## Related Tasks") < doc.indexOf("## Activity Log"));
    assert.ok(doc.indexOf("## Activity Log") < doc.indexOf("## Related\n"));
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

describe("log_append", () => {
  const PATH = "Projects/Example Project/Example Project.md";

  /** A project note whose Activity Log already holds two dated blocks. */
  function withLog(): void {
    writeFileSync(
      join(root, PATH),
      read(root, PATH).replace(
        "## Related\n",
        "## Activity Log\n\n### 2026-07-07\n\n- Kickoff held.\n\n### 2026-04-27\n\n- Scoping call.\n\n## Related\n",
      ),
    );
  }

  test("writes the date heading itself, above the existing blocks", () => {
    withLog();
    const result = call("log_append", {
      note: "Example Project",
      section: "Activity Log",
      content: "Proposal sent.",
      date: "2026-08-01",
    });
    assert.equal(result.appended, true);
    assert.equal(result.block_created, true);
    assert.equal(result.blocks, 3);
    const doc = read(root, PATH);
    assert.match(doc, /## Activity Log\n\n### 2026-08-01\n\n- Proposal sent\.\n\n### 2026-07-07/);
  });

  test("a second entry the same day joins that day's block", () => {
    withLog();
    const args = { note: "Example Project", section: "Activity Log", date: "2026-07-07" };
    const result = call("log_append", { ...args, content: "Follow-up scheduled." });
    assert.equal(result.block_created, false);
    assert.equal(result.blocks, 2);
    const doc = read(root, PATH);
    assert.equal(doc.match(/### 2026-07-07/g)?.length, 1);
    assert.match(doc, /### 2026-07-07\n\n- Kickoff held\.\n- Follow-up scheduled\.\n/);
  });

  test("is idempotent — a second identical entry changes nothing", () => {
    withLog();
    const args = {
      note: "Example Project",
      section: "Activity Log",
      content: "Proposal sent.",
      date: "2026-08-01",
    };
    call("log_append", args);
    const after = read(root, PATH);
    const second = call("log_append", args);
    assert.equal(second.appended, false);
    assert.match(second.reason, /already present/);
    assert.equal(read(root, PATH), after);
  });

  test("a back-dated entry is filed in date order, not on top", () => {
    withLog();
    call("log_append", {
      note: "Example Project",
      section: "Activity Log",
      content: "Contract signed.",
      date: "2026-05-01",
    });
    const lines = read(root, PATH).split("\n");
    assert.ok(
      lines.indexOf("### 2026-07-07") < lines.indexOf("### 2026-05-01"),
      "the back-dated block must sit below the newer one",
    );
    assert.ok(
      lines.indexOf("### 2026-05-01") < lines.indexOf("### 2026-04-27"),
      "the back-dated block must sit above the older one",
    );
  });

  test("bullets a plain line and leaves an existing marker alone", () => {
    withLog();
    call("log_append", {
      note: "Example Project",
      section: "Activity Log",
      content: "Plain prose.\n- Already a bullet.",
      date: "2026-08-01",
    });
    assert.match(read(root, PATH), /### 2026-08-01\n\n- Plain prose\.\n- Already a bullet\.\n/);
  });

  test("a missing section lists the sections that exist", () => {
    const message = callFails("log_append", {
      note: "Example Project",
      section: "Activity Log",
      content: "Proposal sent.",
    });
    assert.match(message, /section "Activity Log" not found/);
    assert.match(message, /sections present: .*Key Decisions/);
  });

  test("create_section puts the log in template position and opens it with a date block", () => {
    const result = call("log_append", {
      note: "Example Project",
      section: "Activity Log",
      content: "Proposal sent.",
      date: "2026-08-01",
      create_section: true,
    });
    assert.equal(result.section_created, true);
    const doc = read(root, PATH);
    assert.ok(doc.indexOf("## Related Tasks") < doc.indexOf("## Activity Log"));
    assert.ok(doc.indexOf("## Activity Log") < doc.indexOf("## Related\n"));
    assert.match(doc, /## Activity Log\n\n### 2026-08-01\n\n- Proposal sent\.\n/);
  });

  test("a table section is refused, naming its columns and section_append", () => {
    const message = callFails("log_append", {
      note: "Example Project",
      section: "Conversation Log",
      content: "Spoke with Jane.",
    });
    assert.match(message, /is a table \(Date \| Who \| Summary\)/);
    assert.match(message, /section_append/);
  });

  test("keep_newest caps the log at its newest dated blocks", () => {
    withLog();
    const result = call("log_append", {
      note: "Example Project",
      section: "Activity Log",
      content: "Proposal sent.",
      date: "2026-08-01",
      keep_newest: 2,
    });
    assert.equal(result.dropped, 1);
    assert.equal(result.blocks, 2);
    // Scope to the section: the note's own `created:` frontmatter carries a
    // date, so a substring search over the file is not evidence of absence.
    const doc = read(root, PATH);
    const log = doc.slice(doc.indexOf("## Activity Log"), doc.indexOf("## Related\n"));
    assert.deepEqual(
      log.split("\n").filter((l) => l.startsWith("### ")),
      ["### 2026-08-01", "### 2026-07-07"],
    );
  });

  test("leaves frontmatter byte-identical after a body edit", () => {
    withLog();
    const before = read(root, PATH).split("\n---\n")[0];
    call("log_append", { note: "Example Project", section: "Activity Log", content: "Proposal sent." });
    assert.equal(read(root, PATH).split("\n---\n")[0], before);
  });
});

describe("task reads on a vault with no Tasks.md", () => {
  test("vault_status and task_query return empty answers, not errors", () => {
    const root = useVault();
    rmSync(join(root, "Tasks.md"));
    assert.deepEqual(call("vault_status").tasks, { open: 0, overdue: 0, due_in_7_days: 0, waiting: 0 });
    assert.equal(call("task_query").count, 0);
    cleanupVault();
  });
});
