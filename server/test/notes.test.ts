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
    // A collision is a result the caller can branch on, not an error — the
    // description tells the model to check `created`, so it has to get one.
    const result = call("note_create", { type: "person", name: "Jane Doe" });
    assert.equal(result.created, false);
    assert.match(result.reason, /already exists/);
    assert.match(result.reason, /section_append/);
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
      "Activity Log",
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

describe("note_create review type", () => {
  test("derives Reviews/YYYY-Www.md from the ISO week", () => {
    const result = call("note_create", { type: "review", name: "2026-W37" });
    assert.equal(result.path, "Reviews/2026-W37.md");
    assert.ok(existsSync(join(root, result.path)));
  });

  test("frontmatter carries type, week, and created", () => {
    call("note_create", { type: "review", name: "2026-W37" });
    const content = read(root, "Reviews/2026-W37.md");
    const frontmatter = content.split("---")[1].trim().split("\n");
    assert.deepEqual(frontmatter, ["type: review", "week: 2026-W37", `created: ${today()}`]);
  });

  test("sections are laid out in order, Answers last for the user to fill in", () => {
    const result = call("note_create", { type: "review", name: "2026-W37" });
    assert.deepEqual(result.sections, [
      "Shipped",
      "Slipped",
      "Quiet Projects",
      "Observations",
      "Questions for you",
      "Answers",
    ]);
  });

  test("a repeat call changes nothing", () => {
    call("note_create", { type: "review", name: "2026-W37" });
    const first = read(root, "Reviews/2026-W37.md");
    const result = call("note_create", { type: "review", name: "2026-W37" });
    assert.equal(result.created, false);
    assert.equal(read(root, "Reviews/2026-W37.md"), first);
  });

  test("rejects a name that is not an ISO week, showing the expected form", () => {
    const message = callFails("note_create", { type: "review", name: "2026-09-12" });
    assert.match(message, /ISO week/);
    assert.match(message, /2026-W37/);
  });

  test("rejects an out-of-range week number", () => {
    const message = callFails("note_create", { type: "review", name: "2026-W99" });
    assert.match(message, /ISO week/);
  });
});

describe("note_create goal type", () => {
  test("derives Goals/X.md so [[X]] resolves", () => {
    const result = call("note_create", { type: "goal", name: "Ship the Handheld" });
    assert.equal(result.path, "Goals/Ship the Handheld.md");
    assert.ok(existsSync(join(root, result.path)));
  });

  test("frontmatter defaults status to active and carries created", () => {
    call("note_create", { type: "goal", name: "Ship the Handheld" });
    const content = read(root, "Goals/Ship the Handheld.md");
    const frontmatter = content.split("---")[1].trim().split("\n");
    assert.deepEqual(frontmatter, ["type: goal", "status: active", `created: ${today()}`]);
  });

  test("horizon is optional free text, carried through fields", () => {
    call("note_create", {
      type: "goal",
      name: "Ship the Handheld",
      fields: { horizon: "2026-Q4" },
    });
    assert.match(read(root, "Goals/Ship the Handheld.md"), /horizon: 2026-Q4/);
  });

  test("a passed status overrides the active default", () => {
    call("note_create", { type: "goal", name: "Ship the Handheld", fields: { status: "achieved" } });
    assert.match(read(root, "Goals/Ship the Handheld.md"), /status: achieved/);
  });

  test("sections are laid out in order", () => {
    const result = call("note_create", { type: "goal", name: "Ship the Handheld" });
    assert.deepEqual(result.sections, ["Why", "What done looks like", "Projects", "Log"]);
  });

  test("a repeat call changes nothing", () => {
    call("note_create", { type: "goal", name: "Ship the Handheld" });
    const first = read(root, "Goals/Ship the Handheld.md");
    const result = call("note_create", { type: "goal", name: "Ship the Handheld" });
    assert.equal(result.created, false);
    assert.equal(read(root, "Goals/Ship the Handheld.md"), first);
  });
});

describe("note_set_field goal field", () => {
  test("quotes the goal as a single wikilink and back-links the project once", () => {
    call("note_create", { type: "goal", name: "Ship the Handheld" });
    const result = call("note_set_field", {
      note: "Example Project",
      field: "goal",
      value: "Ship the Handheld",
    });
    assert.equal(result.changed, true);
    assert.equal(result.goal_backlink, "added");
    assert.match(
      read(root, "Projects/Example Project/Example Project.md"),
      /goal: "\[\[Ship the Handheld\]\]"/,
    );
    assert.match(
      read(root, "Goals/Ship the Handheld.md"),
      /## Projects\n\n- \[\[Example Project\]\]/,
    );

    // Setting the same value again is a no-op, so the back-link is not doubled.
    const again = call("note_set_field", {
      note: "Example Project",
      field: "goal",
      value: "Ship the Handheld",
    });
    assert.equal(again.changed, false);
    const occurrences =
      read(root, "Goals/Ship the Handheld.md").match(/\[\[Example Project\]\]/g) ?? [];
    assert.equal(occurrences.length, 1);
  });

  test("a goal that does not exist yet still sets the field, as an unresolved link", () => {
    const result = call("note_set_field", {
      note: "Example Project",
      field: "goal",
      value: "Not Yet Created",
    });
    assert.equal(result.changed, true);
    assert.equal(result.goal_backlink, "goal note not found; goal set as an unresolved link");
    assert.match(
      read(root, "Projects/Example Project/Example Project.md"),
      /goal: "\[\[Not Yet Created\]\]"/,
    );
  });
});

describe("vault_list goal filter", () => {
  test("finds projects working toward one goal by exact name", () => {
    call("note_create", { type: "goal", name: "Ship the Handheld" });
    call("note_set_field", { note: "Example Project", field: "goal", value: "Ship the Handheld" });
    const result = call("vault_list", { type: "project", goal: "Ship the Handheld" });
    assert.equal(result.total, 1);
    assert.equal(result.notes[0].title, "Example Project");
    assert.equal(call("vault_list", { type: "project", goal: "No Such Goal" }).total, 0);
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
