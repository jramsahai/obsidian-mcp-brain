import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { buildEntities, linkifyContent } from "../src/linkify.ts";
import { call, cleanupVault, lineOf, read, useVault } from "./helpers.ts";

let root = "";
beforeEach(() => {
  root = useVault();
});
afterEach(cleanupVault);

describe("linkify entity selection", () => {
  test("takes projects, people, and knowledge notes, and skips templates", () => {
    const phrases = buildEntities().map((e) => e.phrase);
    assert.ok(phrases.includes("Example Project"));
    assert.ok(phrases.includes("Jane Doe"));
    assert.ok(phrases.includes("Pricing Models"));
    assert.ok(phrases.includes("Wayfinder"));
    assert.ok(!phrases.includes("Template"));
  });

  test("orders longest first so a longer name wins over a shorter one it contains", () => {
    const lengths = buildEntities().map((e) => e.phrase.length);
    assert.deepEqual(lengths, [...lengths].sort((a, b) => b - a));
  });

  test("drops single-word names that read as ordinary English", () => {
    // The "a person named Will, a project named Video" false positive.
    const notes = [
      { title: "Will", type: "person", aliases: [], path: "People/Will.md" },
      { title: "Video", type: "project", aliases: [], path: "Projects/Video/Video.md" },
      { title: "Ann", type: "person", aliases: [], path: "People/Ann.md" },
      { title: "Wayfinder", type: "knowledge", aliases: [], path: "KB/Wayfinder.md" },
    ] as any;
    assert.deepEqual(
      buildEntities(notes).map((e) => e.phrase),
      ["Wayfinder"],
    );
  });
});

describe("linkify exclusion zones", () => {
  const ENTITIES = [{ phrase: "Jane Doe", title: "Jane Doe", path: "People/Jane Doe.md" }];

  function unchanged(content: string): void {
    const result = linkifyContent(content, "Daily/x.md", ENTITIES);
    assert.deepEqual(result.changes, [], `should not have linkified:\n${content}`);
    assert.equal(result.content, content);
  }

  test("leaves headings alone", () => unchanged("## Jane Doe and the scope call\n"));
  test("leaves fenced code alone", () => unchanged("```\nJane Doe\n```\n"));
  test("leaves tilde-fenced code alone", () => unchanged("~~~\nJane Doe\n~~~\n"));
  test("leaves inline code alone", () => unchanged("Ran `Jane Doe` as a query.\n"));
  test("leaves URLs alone", () => unchanged("See https://example.com/Jane Doe now.\n"));
  test("leaves markdown links alone", () => unchanged("[Jane Doe](https://example.com/j) wrote in.\n"));
  test("leaves existing wikilinks alone", () => unchanged("Spoke to [[Jane Doe]] today.\n"));
  test("leaves frontmatter alone", () =>
    unchanged("---\ntype: daily\nattendee: Jane Doe\n---\n\nNothing else here.\n"));

  test("requires a word boundary, so it never lands mid-word", () => {
    unchanged("The Jane Doeson report is unrelated.\n");
  });

  test("is case-sensitive, so lowercase prose is not a mention", () => {
    unchanged("we talked about jane doe policy.\n");
  });

  test("a filename reference is not a mention", () => {
    // Caught live: `role-proposal-draft.md` in a synthesis note became
    // `[[role-proposal-draft]].md`, a link to a slug followed by an extension.
    unchanged("Entity links added across Jane Doe.md and elsewhere.\n");
  });

  test("a slug title is never an entity — its human alias is", () => {
    const notes = [
      {
        title: "role-proposal-draft",
        type: "knowledge",
        aliases: ["Role Proposal Draft"],
        path: "Projects/X/Docs/role-proposal-draft.md",
      },
    ] as any;
    assert.deepEqual(
      buildEntities(notes).map((e) => e.phrase),
      ["Role Proposal Draft"],
    );
  });

  test("every zone in one real note leaves the note byte-identical", () => {
    const before = read(root, "Daily/2026-07-27.md");
    const result = call("linkify", { note: "2026-07-27" });
    assert.equal(result.notes_changed, 0);
    assert.equal(read(root, "Daily/2026-07-27.md"), before);
  });
});

describe("linkify writes", () => {
  test("adds brackets and nothing else", () => {
    call("linkify", { note: "2026-07-28" });
    assert.equal(
      lineOf(read(root, "Daily/2026-07-28.md"), "Good day"),
      "Good day. [[Jane Doe]] was happy with where [[Example Project]] landed.",
    );
  });

  test("links only the first mention in a note", () => {
    call("linkify", { note: "2026-07-28" });
    const content = read(root, "Daily/2026-07-28.md");
    assert.equal(lineOf(content, "second mention"), "Jane Doe said it again later, and this second mention must stay plain.");
  });

  test("is idempotent — a second pass changes nothing", () => {
    call("linkify", { note: "2026-07-28" });
    const after = read(root, "Daily/2026-07-28.md");
    const second = call("linkify", { note: "2026-07-28" });
    assert.equal(second.notes_changed, 0);
    assert.equal(read(root, "Daily/2026-07-28.md"), after);
  });

  test("leaves frontmatter byte-identical", () => {
    const before = read(root, "Daily/2026-07-28.md").split("---")[1];
    call("linkify", { note: "2026-07-28" });
    assert.equal(read(root, "Daily/2026-07-28.md").split("---")[1], before);
  });

  test("never edits Tasks.md, where the first wikilink is the task's project", () => {
    const before = read(root, "Tasks.md");
    call("linkify", {});
    assert.equal(read(root, "Tasks.md"), before);
  });

  test("never edits Standup.md, which is regenerated every morning", () => {
    const before = read(root, "Standup.md");
    assert.match(before, /Jane Doe is waiting/); // a mention it would otherwise link
    const result = call("linkify", { dry_run: true });
    assert.ok(!result.changes.some((c: { note: string }) => c.note === "Standup.md"));
    call("linkify", {});
    assert.equal(read(root, "Standup.md"), before);
  });

  test("a note is never linked to itself", () => {
    const before = read(root, "People/Jane Doe.md");
    call("linkify", { note: "Jane Doe" });
    assert.equal(read(root, "People/Jane Doe.md"), before);
  });
});

describe("linkify dry_run", () => {
  test("reports what it would do and writes nothing", () => {
    const before = read(root, "Daily/2026-07-28.md");
    const result = call("linkify", { note: "2026-07-28", dry_run: true });
    assert.equal(result.dry_run, true);
    assert.equal(result.links_added, 0);
    assert.equal(result.notes_changed, 1);
    assert.deepEqual(
      result.changes.map((c: { entity: string }) => c.entity).sort(),
      ["Example Project", "Jane Doe"],
    );
    assert.match(result.changes[0].preview, /\[\[/);
    assert.equal(read(root, "Daily/2026-07-28.md"), before);
  });

  test("a truncated report says how much it withheld", () => {
    const result = call("linkify", { dry_run: true, limit: 1 });
    assert.ok(result.total > 1, "the fixture vault should propose more than one link");
    assert.equal(result.returned, 1);
    assert.equal(result.truncated, true);
    assert.match(result.note, /more proposed links exist/);
    assert.equal(result.changes.length, 1);
  });
});

describe("linkify scope", () => {
  test("since narrows the pass to recently modified notes", () => {
    const wide = call("linkify", { dry_run: true });
    const future = call("linkify", { dry_run: true, since: "2099-01-01" });
    assert.equal(future.notes_scanned, 0);
    assert.ok(wide.notes_scanned > 0);
  });
});
