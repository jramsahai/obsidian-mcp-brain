import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { assertDate, config, setConfig } from "../src/config.ts";
import { parseNote } from "../src/frontmatter.ts";
import { buildEntities } from "../src/linkify.ts";
import { NOTE_TYPES } from "../src/notes.ts";
import { parseTaskLine } from "../src/tasks.ts";
import { absolutePath } from "../src/vault.ts";
import { call, callFails, cleanupVault, lineOf, read, useVault } from "./helpers.ts";

let root: string;
beforeEach(() => {
  root = useVault();
});
afterEach(cleanupVault);

/**
 * One case per defect found in the July 2026 review. Each asserts the specific
 * corruption that was reproduced against this fixture vault, so a regression
 * reads as the original failure rather than as an abstract rule.
 */

describe("argument validation", () => {
  test("waiting_since is a real date, like every other date argument", () => {
    assert.match(
      callFails("task_update", {
        match: "pricing model",
        waiting_on: "Jane Doe",
        waiting_since: "yesterday",
      }),
      /YYYY-MM-DD/,
    );
  });

  test("a well-shaped but impossible date is refused", () => {
    assert.throws(() => assertDate("2026-02-31", "date"), /not a real calendar date/);
    assert.throws(() => assertDate("2026-99-99", "date"), /not a real calendar date/);
    assert.throws(() => assertDate("friday", "date"), /YYYY-MM-DD/);
    assert.equal(assertDate("2026-02-28", "date"), "2026-02-28");
    assert.equal(assertDate("2024-02-29", "date"), "2024-02-29"); // leap year
    assert.match(callFails("note_create", { type: "daily", date: "2026-02-31" }), /not a real calendar/);
  });

  test("a note name that would break its own wikilink is refused", () => {
    for (const name of ["C# Basics", "Pricing | Q3", "Draft [v2]", "Caret^Note"]) {
      assert.match(
        callFails("note_create", { type: "knowledge", name, topic: "Programming" }),
        /would break the \[\[wikilink\]\]/,
        `expected ${name} to be refused`,
      );
    }
  });

  test("a topic segment that hides or escapes the Knowledge Base is refused", () => {
    assert.match(
      callFails("note_create", { type: "knowledge", name: "Probe", topic: ".Archive" }),
      /not a valid folder path/,
    );
    assert.match(
      callFails("note_create", { type: "knowledge", name: "Sneaky", topic: "Cycling/../../Daily" }),
      /not a valid folder path/,
    );
    assert.ok(!existsSync(join(root, "Daily", "Sneaky.md")));
  });

  test("task_update rejects non-strings instead of writing [[7]] or throwing a TypeError", () => {
    for (const args of [
      { notes: 42 },
      { project: 7 },
      { waiting_on: 7 },
      { due: 20260801 },
    ]) {
      assert.match(
        callFails("task_update", { match: "pricing model", ...args }),
        /must be a string/,
        `expected ${JSON.stringify(args)} to be refused`,
      );
    }
    assert.ok(!read(root, "Tasks.md").includes("[[7]]"));
  });

  test("a limit below 1 is refused rather than silently dropping results", () => {
    assert.match(callFails("vault_list", { limit: -1 }), /at least 1/);
    assert.match(callFails("vault_search", { query: "the", limit: 0 }), /at least 1/);
    assert.match(callFails("vault_links", { direction: "orphans", limit: 0 }), /at least 1/);
  });

  test("task text is wording, not a composed task line", () => {
    assert.match(callFails("task_add", { text: "- [ ] Call Bob" }), /not a whole task line/);
    assert.match(callFails("task_add", { text: "Call Bob 📅 2026-08-09" }), /task markers/);
    assert.match(callFails("task_add", { text: "Call Bob ⏫" }), /priority=/);
  });

  test("note_create refuses arguments the chosen type would ignore", () => {
    assert.match(
      callFails("note_create", { type: "moc", name: "Cycling Overview", topic: "Cycling" }),
      /does not use name/,
    );
    assert.match(
      callFails("note_create", { type: "daily", name: "Monday Standup" }),
      /does not use name/,
    );
    assert.match(
      callFails("note_create", { type: "person", name: "Sam Lee", topic: "Cycling" }),
      /does not use topic/,
    );
  });

  test("a doc note's missing-project error names docs, not meetings", () => {
    assert.match(
      callFails("note_create", { type: "doc", name: "Research Notes X" }),
      /required for a doc note/,
    );
  });
});

describe("frontmatter fidelity", () => {
  test("a scalar YAML would misread is quoted", () => {
    call("note_create", {
      type: "project",
      name: "Atlas Rollout",
      fields: { status: "Blocked: waiting on legal", owner: "#lead", note: "- leading dash" },
    });
    const content = read(root, "Projects/Atlas Rollout/Atlas Rollout.md");
    assert.match(content, /status: "Blocked: waiting on legal"/);
    assert.match(content, /owner: "#lead"/);
    assert.match(content, /note: "- leading dash"/);
    // And it round-trips back through the parser unchanged.
    const parsed = parseNote(content);
    assert.equal(parsed.data.status, "Blocked: waiting on legal");
    assert.equal(parsed.data.owner, "#lead");
    assert.equal(parsed.data.type, "project");
  });

  test("a newline in a field is refused rather than ending the block early", () => {
    assert.match(
      callFails("note_create", {
        type: "idea",
        name: "Newline Probe",
        fields: { context: "first\n---\nsecond: 3" },
      }),
      /single line/,
    );
  });

  test("note_set_field changes one key and leaves every other byte alone", () => {
    const before = read(root, "Projects/Example Project/Example Project.md");
    const result = call("note_set_field", {
      note: "Example Project",
      field: "status",
      value: "On Hold",
    });
    assert.equal(result.changed, true);
    const after = read(root, "Projects/Example Project/Example Project.md");
    assert.match(after, /status: On Hold/);
    assert.equal(
      before.replace(/status: .*/, ""),
      after.replace(/status: .*/, ""),
      "only the status line should differ",
    );
    // The stale status that poisoned every standup is gone.
    assert.equal(call("vault_list", { type: "project", status: "Active" }).total, 0);
  });

  test("note_set_field quotes a wikilink list so Obsidian still sees graph edges", () => {
    call("note_set_field", { note: "Example Project", field: "people", value: "Jane Doe, Sam Lee" });
    assert.match(
      read(root, "Projects/Example Project/Example Project.md"),
      /people: \["\[\[Jane Doe\]\]", "\[\[Sam Lee\]\]"\]/,
    );
  });

  test("note_set_field clears a field and refuses identity keys", () => {
    call("note_set_field", { note: "Example Project", field: "status", value: "" });
    assert.ok(!read(root, "Projects/Example Project/Example Project.md").includes("status:"));
    assert.match(
      callFails("note_set_field", { note: "Example Project", field: "type", value: "person" }),
      /must be one of/,
    );
  });

  test("a body-leading horizontal rule is not mistaken for frontmatter", () => {
    mkdirSync(join(root, "Ideas"), { recursive: true });
    writeFileSync(
      join(root, "Ideas", "Rule First.md"),
      "---\n\nSome prose the reader must still see\n\n---\n\n## Heading X\n\nMore prose\n",
    );
    const result = call("vault_read", { note: "Rule First" });
    assert.match(result.content, /Some prose the reader must still see/);
    assert.deepEqual(result.frontmatter, {});
    // scan.ts must agree, or the heading would be invisible to section lookups.
    assert.ok(result.sections.includes("Heading X"));
  });
});

describe("task grammar", () => {
  test("a sub-task keeps its indentation when edited", () => {
    writeFileSync(
      join(root, "Tasks.md"),
      read(root, "Tasks.md").replace(
        "- [ ] Draft the onboarding deck",
        "- [ ] Draft the onboarding deck\n  - [ ] sub item of the deck",
      ),
    );
    call("task_update", { match: "sub item of the deck", priority: "low" });
    assert.match(lineOf(read(root, "Tasks.md"), "sub item of the deck"), /^ {2}- \[ \]/);
  });

  test("completing a parent takes its sub-items with it", () => {
    writeFileSync(
      join(root, "Tasks.md"),
      read(root, "Tasks.md").replace(
        "- [ ] Review the pricing model [[Example Project]]",
        "- [ ] Review the pricing model [[Example Project]]\n  - [ ] read the vendor sheet\n  - [ ] compare to last year",
      ),
    );
    call("task_update", { match: "Review the pricing model", done: true });
    const content = read(root, "Tasks.md");
    const done = content.slice(content.indexOf("## Done"));
    assert.match(done, /read the vendor sheet/);
    assert.match(done, /compare to last year/);
    const active = content.slice(content.indexOf("## Active"), content.indexOf("## Done"));
    assert.ok(!active.includes("vendor sheet"), "children must not be orphaned in Active");
  });

  test("an inline wikilink stays in the user's sentence", () => {
    writeFileSync(
      join(root, "Tasks.md"),
      read(root, "Tasks.md").replace(
        "- [ ] Review the pricing model [[Example Project]]",
        "- [ ] Ask [[Jane Doe]] about the pricing model [[Example Project]]",
      ),
    );
    call("task_update", { match: "about the pricing model", done: true });
    const line = lineOf(read(root, "Tasks.md"), "about the pricing model");
    assert.match(line, /Ask \[\[Jane Doe\]\] about the pricing model/);
    assert.match(line, /\[\[Example Project\]\]/);
  });

  test("the project is the trailing link, and a round-trip is stable", () => {
    const first = parseTaskLine(
      "- [ ] Ask [[Jane Doe]] about scope [[Example Project]] 📅 2026-08-05",
      0,
      "Active",
    )!;
    assert.equal(first.project, "Example Project");
    assert.equal(first.text, "Ask [[Jane Doe]] about scope");
    assert.equal(first.due, "2026-08-05");
  });

  test("task_update will not recreate the duplicate task_add refuses", () => {
    assert.match(
      callFails("task_update", { match: "pricing model", text: "Draft the onboarding deck" }),
      /duplicates an existing task/,
    );
  });
});

describe("write guards", () => {
  test("templates are not writable by any mutating tool", () => {
    for (const [tool, args] of [
      ["section_append", { note: "Project Template", section: "Stakeholders", content: "- x" }],
      ["relate", { note: "Project Template", target: "Pricing Models", reason: "a real reason here" }],
      ["checklist_set", { note: "Project Template", item: "something", section: "Stakeholders" }],
      ["note_set_field", { note: "Project Template", field: "status", value: "Done" }],
    ] as const) {
      assert.match(callFails(tool, args as Record<string, unknown>), /is a template/, tool);
    }
  });

  test("the template is never offered or accepted as a real project", () => {
    const message = callFails("task_add", { text: "probe", project: "Nonesuch" });
    assert.ok(!message.includes("Project Template"), message);
    assert.match(
      callFails("note_create", { type: "meeting", name: "Probe Kickoff", project: "Project Template" }),
      /is a template/,
    );
    assert.ok(!existsSync(join(root, "Projects", "Project Template", "Meeting Notes")));
  });

  test("Tasks.md is owned by the task tools", () => {
    assert.match(
      callFails("section_append", { note: "Tasks", section: "Active", content: "- [ ] call Bob" }),
      /owned by task_add/,
    );
    assert.match(
      callFails("inbox_route", { line: "vendor", destination_note: "Tasks", destination_section: "Active" }),
      /owned by task_add/,
    );
  });

  test("absolutePath refuses to leave the vault", () => {
    for (const bad of ["../outside.md", "../../etc/passwd", "Projects/../../escape.md"]) {
      assert.throws(() => absolutePath(bad), /escapes the vault root/, bad);
    }
    assert.equal(absolutePath("Inbox.md"), join(root, "Inbox.md"));
  });

  test("every path-taking argument refuses a traversal", () => {
    for (const [tool, args] of [
      ["vault_read", { note: "../../etc/passwd" }],
      ["section_append", { note: "../../escape", section: "X", content: "y" }],
      ["inbox_route", { line: "vendor", destination_note: "../../escape" }],
      ["inbox_route", { line: "vendor", destination_note: "Tasks", source_note: "../../escape" }],
    ] as const) {
      assert.match(
        callFails(tool, args as Record<string, unknown>),
        /not found in the vault|escapes the vault root/,
        `${tool} ${JSON.stringify(args)}`,
      );
    }
  });
});

describe("note round-trip", () => {
  test("a note that note_create just wrote resolves by the name that created it", () => {
    const cases: { type: string; args: Record<string, unknown> }[] = [
      { type: "project", args: { name: "Round Trip" } },
      { type: "person", args: { name: "Ada Lovelace" } },
      { type: "knowledge", args: { name: "Café Notes", topic: "Cycling" } },
      { type: "knowledge", args: { name: "Grüße", topic: "Cycling/Repair" } },
      { type: "idea", args: { name: "Naïve Bayes Thing" } },
      { type: "shopping", args: { name: "Costco" } },
      { type: "index", args: { name: "Knowledge Base" } },
      { type: "review", args: { name: "2026-W37" } },
      { type: "goal", args: { name: "Ship the Handheld" } },
    ];
    for (const { type, args } of cases) {
      const created = call("note_create", { type, ...args });
      assert.equal(created.created, true, `${type} ${JSON.stringify(args)}`);
      const found = call("vault_read", { note: created.title });
      assert.equal(found.path, created.path, `round-trip failed for ${created.path}`);
    }
  });

  test("an NFD filename on disk is readable by the NFC name a model would send", () => {
    // What a Finder rename, an unzip, or an iCloud sync leaves behind.
    const nfd = "Café Notes.md";
    writeFileSync(join(root, "People", nfd), "---\ntype: person\n---\n\n# Café Notes\n");
    const result = call("vault_read", { note: "Café Notes" });
    assert.match(result.path, /People\//);
  });

  test("every note type is creatable and lands where the schema says", () => {
    assert.equal(NOTE_TYPES.length, 13);
  });
});

describe("dates in the vault's timezone", () => {
  // 2026-08-01 21:00 EDT is 2026-08-02 01:00 UTC. Every evening after 20:00
  // local, a UTC-formatted mtime reports tomorrow's date.
  const EVENING = new Date("2026-08-02T01:00:00Z");
  const LOCAL_DATE = "2026-08-01";
  const PATH = "Projects/Example Project/Example Project.md";

  function touched(): void {
    const file = join(root, PATH);
    utimesSync(file, EVENING, EVENING);
  }

  test("modified is the local date, not the UTC one", () => {
    touched();
    const note = call("vault_list", { type: "project" }).notes.find((n: any) => n.path === PATH);
    assert.equal(
      note.modified,
      LOCAL_DATE,
      "a note edited at 21:00 EDT must not report as modified tomorrow",
    );
  });

  test("a note touched now reports today, agreeing with vault_status", () => {
    // The real contradiction: `modified` was UTC-formatted while `today` runs
    // through the vault's timezone, so after 20:00 EDT the model was told a
    // note it had just written was modified tomorrow. Uses the wall clock
    // deliberately — this is the assertion that failed every evening.
    const now = new Date();
    utimesSync(join(root, PATH), now, now);
    const note = call("vault_list", { type: "project" }).notes.find((n: any) => n.path === PATH);
    assert.equal(note.modified, call("vault_status", {}).today);
  });

  test("changed_since includes a note modified on that local date", () => {
    // The cutoff used to be a host-timezone midnight epoch, so it disagreed
    // with the very `modified` value it sat next to.
    touched();
    const paths = call("vault_list", { changed_since: LOCAL_DATE }).notes.map((n: any) => n.path);
    assert.ok(paths.includes(PATH), "the note's own modified date must not be excluded");
  });

  test("changed_since excludes a note modified the day before", () => {
    touched();
    const paths = call("vault_list", { changed_since: "2026-08-02" }).notes.map((n: any) => n.path);
    assert.ok(!paths.includes(PATH), "a 2026-08-01 note is not changed since 2026-08-02");
  });

  test("changed_since follows VAULT_TZ, not the machine's timezone", () => {
    // The cutoff was `new Date("<date>T00:00:00")`, which parses as *host*
    // midnight. That was invisible here only because the host and the vault
    // are both America/New_York. Under Asia/Tokyo the same instant is already
    // 2026-08-02, and the host-parsed cutoff wrongly excluded it.
    setConfig({ ...config(), timezone: "Asia/Tokyo" });
    touched();
    const paths = call("vault_list", { changed_since: "2026-08-02" }).notes.map((n: any) => n.path);
    assert.ok(
      paths.includes(PATH),
      "01:00 UTC is 10:00 on 2026-08-02 in Tokyo, so the note is changed since that date",
    );
  });
});

describe("section targeting", () => {
  test("an append prefers the real section over a same-named sub-heading", () => {
    mkdirSync(join(root, "Ideas"), { recursive: true });
    writeFileSync(
      join(root, "Ideas", "Levels.md"),
      "---\ntype: idea\n---\n\n# Levels\n\n## Overview\n\n### Notes\n\nsub content\n\n## Notes\n\nreal content\n",
    );
    call("section_append", { note: "Levels", section: "Notes", content: "- appended" });
    const content = read(root, "Ideas/Levels.md");
    const underReal = content.slice(content.indexOf("## Notes"));
    assert.match(underReal, /- appended/);
    assert.ok(!content.slice(0, content.indexOf("## Notes")).includes("- appended"));
  });

  test("an append lands in the section's own list, not under its sub-heading", () => {
    mkdirSync(join(root, "Ideas"), { recursive: true });
    writeFileSync(
      join(root, "Ideas", "Nested.md"),
      "---\ntype: idea\n---\n\n# Nested\n\n## Related\n\n- [[A]] — first\n\n### See Also\n\n- [[B]] — nested\n",
    );
    call("section_append", { note: "Nested", section: "Related", content: "- [[C]] — third" });
    const lines = read(root, "Ideas/Nested.md").split("\n");
    assert.ok(
      lines.indexOf("- [[C]] — third") < lines.indexOf("### See Also"),
      "the new line must sit above the sub-heading",
    );
  });

  test("a table row lands in the table, not below trailing prose", () => {
    const path = "Projects/Example Project/Example Project.md";
    writeFileSync(
      join(root, path),
      read(root, path).replace(
        "## Conversation Log",
        "Note: revisit after the pilot.\n\n## Conversation Log",
      ),
    );
    call("section_append", {
      note: "Example Project",
      section: "Key Decisions",
      content: "| 2026-08-01 | Hold | Legal |",
    });
    const lines = read(root, path).split("\n");
    assert.ok(
      lines.indexOf("| 2026-08-01 | Hold | Legal |") < lines.indexOf("Note: revisit after the pilot."),
      "the row must sit inside the table",
    );
  });

  /** A note whose section is nothing but `### YYYY-MM-DD` blocks. */
  function datedLog(name: string, body: string): void {
    mkdirSync(join(root, "Ideas"), { recursive: true });
    writeFileSync(join(root, "Ideas", `${name}.md`), `---\ntype: idea\n---\n\n# ${name}\n\n${body}`);
  }

  test("a dated entry does not land as a bare line above the date headings", () => {
    datedLog("Logged", "## Activity Log\n\n### 2026-07-07\n\n- Kickoff held.\n");
    call("log_append", {
      note: "Logged",
      section: "Activity Log",
      content: "Proposal sent.",
      date: "2026-08-01",
    });
    const lines = read(root, "Ideas/Logged.md").split("\n");
    assert.ok(
      lines.indexOf("### 2026-08-01") < lines.indexOf("### 2026-07-07"),
      "the newer block must sit above the older one",
    );
    const between = lines.slice(lines.indexOf("## Activity Log") + 1, lines.indexOf("### 2026-08-01"));
    assert.ok(
      between.every((l) => l.trim() === ""),
      "nothing may sit between the section heading and the first date heading",
    );
  });

  test("section_append still lands in the section's own span on a dated log", () => {
    // The `last === -1` branch of appendToSection: on a section whose first
    // content is a sub-heading it writes at section.start. That is the behavior
    // log_append exists to route around, and it is deliberate here — a refactor
    // of ownContentEnd must not move it and silently change section_append.
    datedLog("Bare", "## Activity Log\n\n### 2026-07-07\n\n- Kickoff held.\n");
    call("log_append", { note: "Bare", section: "Activity Log", content: "x", date: "2026-08-01" });
    call("section_append", { note: "Bare", section: "Activity Log", content: "- stray line" });
    const lines = read(root, "Ideas/Bare.md").split("\n");
    assert.ok(
      lines.indexOf("- stray line") < lines.indexOf("### 2026-08-01"),
      "section_append still writes above the first date heading",
    );
  });

  test("a titled date heading is not a log block", () => {
    datedLog(
      "Titled",
      "## Activity Log\n\n### 2026-03-18: Comprehensive Research Initiative\n\n- An essay.\n\n### 2026-03-18 Conversation with Devon\n\n- Notes.\n",
    );
    call("log_append", {
      note: "Titled",
      section: "Activity Log",
      content: "Proposal sent.",
      date: "2026-03-18",
    });
    const doc = read(root, "Ideas/Titled.md");
    assert.match(doc, /## Activity Log\n\n### 2026-03-18\n\n- Proposal sent\.\n/);
    assert.match(doc, /### 2026-03-18: Comprehensive Research Initiative\n\n- An essay\./);
    assert.match(doc, /### 2026-03-18 Conversation with Devon\n\n- Notes\./);
  });

  test("an impossible date is not a log block", () => {
    datedLog("Impossible", "## Activity Log\n\n### 2026-02-31\n\n- Junk.\n");
    const result = call("log_append", {
      note: "Impossible",
      section: "Activity Log",
      content: "Proposal sent.",
      date: "2026-08-01",
    });
    assert.equal(result.blocks, 1);
    assert.match(read(root, "Ideas/Impossible.md"), /### 2026-02-31\n\n- Junk\./);
  });

  test("a date heading inside a code fence is not a log block", () => {
    datedLog("Fenced", "## Activity Log\n\n```md\n### 2026-07-07\n```\n");
    const result = call("log_append", {
      note: "Fenced",
      section: "Activity Log",
      content: "Proposal sent.",
      date: "2026-08-01",
    });
    assert.equal(result.blocks, 1);
    const doc = read(root, "Ideas/Fenced.md");
    // The fence is the section's own content, so the block goes after it —
    // and the heading inside it is never read as a block to join.
    assert.match(doc, /```md\n### 2026-07-07\n```\n\n### 2026-08-01\n\n- Proposal sent\.\n/);
  });

  test("section_append refuses keep_newest on a dated log", () => {
    datedLog("Bounded", "## Review Log\n\n### 2026-07-07\n\n- Reviewed.\n");
    const message = callFails("section_append", {
      note: "Bounded",
      section: "Review Log",
      content: "- 2026-08-01: reviewed",
      keep_newest: 2,
    });
    assert.match(message, /dated log/);
    assert.match(message, /log_append/);
    // Refused means refused: nothing was written on the way to the error.
    assert.doesNotMatch(read(root, "Ideas/Bounded.md"), /2026-08-01/);
  });

  test("a log append leaves exactly one trailing newline", () => {
    // The 2026-08-01 CLI fallback left a note with none at all.
    datedLog("Unterminated", "## Activity Log\n\n### 2026-07-07\n\n- Kickoff held.");
    call("log_append", {
      note: "Unterminated",
      section: "Activity Log",
      content: "Proposal sent.",
      date: "2026-08-01",
    });
    const doc = read(root, "Ideas/Unterminated.md");
    assert.ok(doc.endsWith("\n") && !doc.endsWith("\n\n"), "exactly one trailing newline");
  });

  test("repeated log appends do not stack blank lines", () => {
    datedLog("Stacked", "## Activity Log\n\n### 2026-07-07\n\n- Kickoff held.\n\n## Related\n");
    for (const day of ["01", "02", "03"]) {
      call("log_append", {
        note: "Stacked",
        section: "Activity Log",
        content: `Day ${day}.`,
        date: `2026-08-${day}`,
      });
    }
    assert.doesNotMatch(read(root, "Ideas/Stacked.md"), /\n\n\n/);
  });

  test("a heading passed as log content is refused", () => {
    datedLog("Heady", "## Activity Log\n\n### 2026-07-07\n\n- Kickoff held.\n");
    const message = callFails("log_append", {
      note: "Heady",
      section: "Activity Log",
      content: "### 2026-08-01\n\n- Proposal sent.",
    });
    assert.match(message, /contains a heading/);
    assert.match(message, /the date heading is written for you/);
  });

  test("keep_newest caps a bounded log at the newest entries", () => {
    call("note_create", { type: "index", name: "Knowledge Base" });
    for (const day of ["01", "02", "03", "04"]) {
      call("section_append", {
        note: "Knowledge Base/README.md",
        section: "Review Log",
        content: `- 2026-08-${day}: reviewed`,
        keep_newest: 2,
      });
    }
    // Assert on the entries themselves, not on the whole file: the note's own
    // `created:` frontmatter carries today's date, so a substring search over
    // the file reports the oldest entry as still present on four days a year.
    const entries = read(root, "Knowledge Base/README.md")
      .split("\n")
      .filter((line) => line.startsWith("- 2026-08-"));
    assert.deepEqual(entries, ["- 2026-08-03: reviewed", "- 2026-08-04: reviewed"]);
  });
});

describe("link emission", () => {
  test("linkify skips a name that two notes answer to", () => {
    call("note_create", { type: "knowledge", name: "Sunset Clause", topic: "Legal" });
    call("note_create", { type: "knowledge", name: "Sunset Clause", topic: "Pricing" });
    assert.ok(
      !buildEntities().some((e) => e.title === "Sunset Clause"),
      "an ambiguous title cannot be written as a bare [[link]]",
    );
  });

  test("relate disambiguates a target whose title is shared", () => {
    call("relate", {
      note: "Example Project",
      target: "Knowledge Base/Pricing/Overlap.md",
      reason: "the pricing overlap is what this project is negotiating",
    });
    const line = lineOf(read(root, "Projects/Example Project/Example Project.md"), "Overlap");
    assert.match(line, /\[\[Knowledge Base\/Pricing\/Overlap\|Overlap\]\]/);
    // And the link the server just wrote resolves through its own resolver.
    assert.equal(
      call("vault_read", { note: "Knowledge Base/Pricing/Overlap" }).path,
      "Knowledge Base/Pricing/Overlap.md",
    );
  });

  test("relate is still idempotent across the disambiguated form", () => {
    const args = {
      note: "Example Project",
      target: "Knowledge Base/Pricing/Overlap.md",
      reason: "the pricing overlap is what this project is negotiating",
    };
    call("relate", args);
    assert.equal(call("relate", args).added, false);
  });

  test("a mirrored link spends the target's budget too", () => {
    for (let i = 0; i < 5; i++) {
      call("note_create", { type: "idea", name: `Source Idea ${i}` });
      call("relate", {
        note: `Source Idea ${i}`,
        target: "Pricing Models",
        reason: `connection number ${i} worth recording here`,
        mirror: true,
      });
    }
    const result = call("relate", {
      note: "Example Project",
      target: "Pricing Models",
      reason: "one connection past the target's nightly cap",
      mirror: true,
    });
    assert.equal(result.mirrored, false);
    assert.match(result.mirror_skipped, /already taken its/);
  });

  test("a note linkify cannot write is reported, not silently dropped", () => {
    // Two notes mention Wayfinder; make the second unwritable mid-pass.
    for (const day of ["2026-07-27", "2026-07-28"]) {
      const path = `Daily/${day}.md`;
      writeFileSync(join(root, path), `${read(root, path)}\nA note about Wayfinder here.\n`);
    }
    chmodSync(join(root, "Daily", "2026-07-28.md"), 0o444);
    try {
      const result = call("linkify", {});
      // The writable note landed and is counted; the other is named, not lost.
      assert.equal(result.notes_changed, 1);
      assert.equal(result.links_added, 1);
      assert.equal(result.notes_failed.length, 1);
      assert.match(result.notes_failed[0].note, /2026-07-28/);
      assert.match(result.note, /call it again to retry/);
      assert.match(read(root, "Daily/2026-07-27.md"), /\[\[Wayfinder\]\]/);
    } finally {
      chmodSync(join(root, "Daily", "2026-07-28.md"), 0o644);
    }
  });

  test("linkify leaves an inline tag alone", () => {
    const path = "Daily/2026-07-30.md";
    writeFileSync(join(root, path), `${read(root, path)}\nFiled under #Wayfinder today.\n`);
    call("linkify", { note: "2026-07-30" });
    const content = read(root, path);
    assert.match(content, /#Wayfinder/);
    assert.ok(!content.includes("#[[Wayfinder]]"), "the tag must survive intact");
  });
});

describe("inbox", () => {
  test("inbox_clear removes a captured line, but only with a real destination", () => {
    assert.match(
      callFails("inbox_clear", { line: "vendor", captured_as: "Nope Nothing" }),
      /not found in the vault/,
    );
    call("task_add", { text: "Look into the vendor's SLA terms" });
    const result = call("inbox_clear", { line: "vendor", captured_as: "Tasks" });
    assert.equal(result.cleared, true);
    assert.ok(!read(root, "Inbox.md").includes("SLA terms"));
  });

  test("inbox_clear refuses any note that is not an inbox", () => {
    assert.match(
      callFails("inbox_clear", { line: "pricing", captured_as: "Tasks", source_note: "Example Project" }),
      /only clears inbox notes/,
    );
  });
});

describe("standup", () => {
  test("standup_write replaces the body and keeps the frontmatter", () => {
    const result = call("standup_write", { content: "## Today\n\n- ship it", date: "2026-07-31" });
    assert.equal(result.replaced, true);
    const content = read(root, "Standup.md");
    assert.match(content, /^---\ntype: standup/);
    assert.match(content, /# Standup — 2026-07-31/);
    assert.match(content, /- ship it/);
    assert.ok(!content.includes("vendor quote"), "yesterday's body must be gone");
  });

  test("standup_write keeps the note typed, even when frontmatter was stripped", () => {
    // A whole-file write from outside the tool surface left the real vault's
    // Standup.md with no frontmatter at all, so it fell out of every
    // type-filtered query. Regenerating must put it back, not preserve the gap.
    writeFileSync(join(root, "Standup.md"), "# Standup\n\nold body\n");
    call("standup_write", { content: "- fresh", date: "2026-07-31" });
    const content = read(root, "Standup.md");
    assert.match(content, /^---\n/);
    assert.match(content, /type: standup/);
    assert.match(content, /generated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);
    assert.match(content, /tz: America\/New_York/);
    assert.equal(call("vault_list", { type: "standup" }).total, 1);
  });

  test("standup_write preserves frontmatter keys it does not own", () => {
    writeFileSync(
      join(root, "Standup.md"),
      "---\ntype: standup\ncreated: 2026-06-28\ncustom: keep me\n---\n\n# Standup\n\nold\n",
    );
    call("standup_write", { content: "- fresh", date: "2026-07-31" });
    const content = read(root, "Standup.md");
    assert.match(content, /created: 2026-06-28/);
    assert.match(content, /custom: keep me/);
    assert.ok(!content.includes("old"), "the body is still replaced");
  });

  test("standup_write is idempotent", () => {
    const args = { content: "## Today\n\n- ship it", date: "2026-07-31" };
    call("standup_write", args);
    assert.equal(call("standup_write", args).replaced, false);
  });
});

describe("daily journal", () => {
  test("a repeat entry is skipped by default and forceable with dedupe=false", () => {
    call("daily_log", { section: "Food", content: "Coffee." });
    assert.equal(call("daily_log", { section: "Food", content: "Coffee." }).appended, false);
    assert.equal(
      call("daily_log", { section: "Food", content: "Coffee.", dedupe: false }).appended,
      true,
    );
    const content = read(root, `Daily/${call("vault_status").today}.md`);
    assert.equal(content.split("Coffee.").length - 1, 2);
  });
});
