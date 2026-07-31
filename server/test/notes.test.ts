import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { today } from "../src/config.ts";
import { DAILY_SECTIONS } from "../src/notes.ts";
import { call, callFails, cleanupVault, read, useVault } from "./helpers.ts";

let root = "";
beforeEach(() => {
  root = useVault();
});
afterEach(cleanupVault);

describe("note_create paths", () => {
  test("derives Projects/X/X.md so [[X]] resolves", () => {
    const result = call("note_create", { type: "project", name: "Wayfinder Rollout" });
    assert.equal(result.path, "Projects/Wayfinder Rollout/Wayfinder Rollout.md");
    assert.ok(existsSync(join(root, result.path)));
  });

  test("derives People/First Last.md", () => {
    assert.equal(call("note_create", { type: "person", name: "Sam Lee" }).path, "People/Sam Lee.md");
  });

  test("derives Daily and Syntheses notes from the date, not a name", () => {
    assert.equal(call("note_create", { type: "daily", date: "2026-08-02" }).path, "Daily/2026-08-02.md");
    assert.equal(
      call("note_create", { type: "synthesis", date: "2026-08-02" }).path,
      "Syntheses/2026-08-02.md",
    );
  });

  test("derives knowledge and MOC paths from the topic", () => {
    assert.equal(
      call("note_create", { type: "knowledge", name: "Chain Wear", topic: "Cycling/Repair" }).path,
      "Knowledge Base/Cycling/Repair/Chain Wear.md",
    );
    assert.equal(
      call("note_create", { type: "moc", topic: "Cycling/Repair" }).path,
      "Knowledge Base/Cycling/Repair/Repair MOC.md",
    );
  });

  test("puts a meeting note inside its project", () => {
    const result = call("note_create", {
      type: "meeting",
      name: "2026-08-02 Scope Review",
      project: "Example Project",
    });
    assert.equal(result.path, "Projects/Example Project/Meeting Notes/2026-08-02 Scope Review.md");
  });

  test("puts a project doc in the project's Docs folder", () => {
    const result = call("note_create", {
      type: "doc",
      name: "vendor-comparison",
      project: "Example Project",
      body: "Three vendors, one table.",
    });
    assert.equal(result.path, "Projects/Example Project/Docs/vendor-comparison.md");
    const content = read(root, result.path);
    assert.match(content, /^type: doc$/m);
    assert.match(content, /^project: "\[\[Example Project\]\]"$/m);
    assert.match(content, /Three vendors, one table\./);
  });

  test("a project doc gets no section skeleton — research has no fixed shape", () => {
    const result = call("note_create", {
      type: "doc",
      name: "market-scan",
      project: "Example Project",
    });
    assert.deepEqual(result.sections, []);
    assert.ok(!read(root, result.path).includes("## "));
  });

  test("a doc still refuses the generic names that made the INDEX.md collisions", () => {
    const message = callFails("note_create", {
      type: "doc",
      name: "INDEX",
      project: "Example Project",
    });
    assert.match(message, /too generic/);
  });

  test("refuses a doc with no project — a doc has to belong to one", () => {
    assert.match(
      callFails("note_create", { type: "doc", name: "stray-notes" }),
      /project is required/,
    );
  });

  test("refuses a meeting whose project has no note, naming the fix", () => {
    const message = callFails("note_create", {
      type: "meeting",
      name: "Kickoff",
      project: "Ghost Project",
    });
    assert.match(message, /has no project note/);
    assert.match(message, /note_create/);
  });
});

describe("note_create guards", () => {
  test("refuses a generic name — this is the Overview.md error class", () => {
    const message = callFails("note_create", { type: "project", name: "Overview" });
    assert.match(message, /too generic/);
    assert.ok(!existsSync(join(root, "Projects/Overview/Overview.md")));
  });

  test("refuses a name that is actually a path", () => {
    assert.match(
      callFails("note_create", { type: "project", name: "Projects/Thing/Thing.md" }),
      /not a path/,
    );
  });

  test("refuses to overwrite a note that already has content", () => {
    const message = callFails("note_create", { type: "person", name: "Jane Doe" });
    assert.match(message, /already exists/);
    assert.match(message, /section_append/);
    // The existing note is untouched.
    assert.match(read(root, "People/Jane Doe.md"), /Prefers written summaries/);
  });

  test("requires a topic for knowledge notes", () => {
    assert.match(callFails("note_create", { type: "knowledge", name: "Chain Wear" }), /topic is required/);
  });

  test("rejects a type outside the enum, listing the valid ones", () => {
    assert.match(callFails("note_create", { type: "blog", name: "X" }), /must be one of: project, person/);
  });
});

describe("note_create frontmatter contract", () => {
  test("project frontmatter carries the documented keys in order", () => {
    call("note_create", {
      type: "project",
      name: "Wayfinder Rollout",
      fields: { people: "Jane Doe", topics: "onboarding, pricing", description: "Roll it out." },
    });
    const content = read(root, "Projects/Wayfinder Rollout/Wayfinder Rollout.md");
    const frontmatter = content.split("---")[1].trim().split("\n");
    assert.deepEqual(frontmatter, [
      "type: project",
      "status: Active",
      `created: ${today()}`,
      `started: ${today()}`,
      'people: ["[[Jane Doe]]"]',
      "topics: [onboarding, pricing]",
    ]);
    assert.match(content, /\*\*Description:\*\* Roll it out\./);
  });

  test("quotes wikilinks in list properties and leaves plain lists plain", () => {
    call("note_create", {
      type: "person",
      name: "Sam Lee",
      fields: { role: "Vendor", projects: "Example Project" },
    });
    const content = read(root, "People/Sam Lee.md");
    assert.match(content, /^role: Vendor$/m);
    assert.match(content, /^projects: \["\[\[Example Project\]\]"\]$/m);
  });

  test("a meeting note links its project as a quoted wikilink", () => {
    call("note_create", {
      type: "meeting",
      name: "Scope Review",
      project: "Example Project",
      date: "2026-08-02",
    });
    const content = read(root, "Projects/Example Project/Meeting Notes/Scope Review.md");
    assert.match(content, /^project: "\[\[Example Project\]\]"$/m);
    assert.match(content, /^date: 2026-08-02$/m);
  });
});

describe("note_create bodies", () => {
  test("emits the sections the type is supposed to have", () => {
    const result = call("note_create", { type: "project", name: "Wayfinder Rollout" });
    assert.deepEqual(result.sections, [
      "Stakeholders",
      "Key Decisions",
      "Conversation Log",
      "Waiting On",
      "Related Tasks",
      "Related",
    ]);
  });

  test("table sections come with their header row, so section_append can add rows", () => {
    call("note_create", { type: "project", name: "Wayfinder Rollout" });
    const appended = call("section_append", {
      note: "Wayfinder Rollout",
      section: "Conversation Log",
      content: "| 2026-08-02 | [[Jane Doe]] | Agreed on scope |",
    });
    assert.equal(appended.as_table_row, true);
  });

  test("body is the opening prose and the sections are still emitted", () => {
    call("note_create", { type: "idea", name: "Fleet Router", body: "A router for fleets." });
    const content = read(root, "Ideas/Fleet Router.md");
    const lines = content.split("\n");
    assert.equal(lines[lines.indexOf("# Fleet Router") + 2], "A router for fleets.");
    assert.match(content, /^## Scorecard$/m);
    assert.match(content, /^\| Criterion \| Score \(1-5\) \| Notes \|$/m);
  });

  test("a shopping list has no sections, so items go straight in the body", () => {
    const result = call("note_create", { type: "shopping", name: "Costco" });
    assert.deepEqual(result.sections, []);
    assert.equal(call("checklist_set", { note: "Costco", item: "Paper towels" }).action, "added");
    assert.match(read(root, "Shopping/Costco.md"), /^- \[ \] Paper towels$/m);
  });

  test("a daily note matches the seven journal sections", () => {
    const result = call("note_create", { type: "daily", date: "2026-08-02" });
    assert.deepEqual(result.sections, [...DAILY_SECTIONS]);
  });
});

describe("daily_log", () => {
  test("creates the daily note from the template when it is missing", () => {
    const result = call("daily_log", {
      date: "2026-08-02",
      section: "Food",
      content: "Made carbonara.",
    });
    assert.equal(result.note_created, true);
    assert.equal(result.path, "Daily/2026-08-02.md");
    const content = read(root, "Daily/2026-08-02.md");
    assert.match(content, /^type: daily$/m);
    assert.match(content, /## Food\n\nMade carbonara\./);
    // Every journal section exists even though only one was written to.
    for (const section of DAILY_SECTIONS) assert.match(content, new RegExp(`^## ${escape(section)}$`, "m"));
  });

  test("appends into an existing daily note without creating it again", () => {
    const result = call("daily_log", { date: "2026-07-28", section: "Food", content: "Toast." });
    assert.equal(result.note_created, false);
    assert.equal(result.section_created, true); // 2026-07-28 has no Food section yet
    const content = read(root, "Daily/2026-07-28.md");
    assert.match(content, /Good day\. Jane Doe was happy/);
    assert.match(content, /## Food\n\nToast\./);
  });

  test("a new section lands in template position, not at the end of the file", () => {
    call("daily_log", { date: "2026-07-28", section: "Weather", content: "Rain all day." });
    const headings = read(root, "Daily/2026-07-28.md")
      .split("\n")
      .filter((l) => l.startsWith("## "));
    assert.deepEqual(headings, ["## Mood / Energy", "## Weather", "## Random Thoughts"]);
  });

  test("re-logging the same entry changes nothing", () => {
    call("daily_log", { date: "2026-08-02", section: "Food", content: "Made carbonara." });
    const first = read(root, "Daily/2026-08-02.md");
    const second = call("daily_log", { date: "2026-08-02", section: "Food", content: "Made carbonara." });
    assert.equal(second.appended, false);
    assert.equal(read(root, "Daily/2026-08-02.md"), first);
  });

  test("rejects a section outside the seven, listing them", () => {
    const message = callFails("daily_log", {
      date: "2026-08-02",
      section: "Key Conversations",
      content: "Talked to Jane about scope.",
    });
    assert.match(message, /must be one of: Mood \/ Energy, Weather, Exercise/);
    // The misrouted content did not create a note as a side effect.
    assert.ok(!existsSync(join(root, "Daily/2026-08-02.md")));
  });

  test("defaults to today when no date is given", () => {
    const result = call("daily_log", { section: "Mood / Energy", content: "Steady." });
    assert.equal(result.date, today());
    assert.equal(result.path, `Daily/${today()}.md`);
  });
});

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
