import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { call, callFails, cleanupVault, read, useVault } from "./helpers.ts";

let root: string;
beforeEach(() => {
  root = useVault();
});
afterEach(cleanupVault);

/** A synthesis note is the only place a wikilink is a report about the graph. */
function writeSynthesis(date: string, sections: { observations?: string; candidates?: string }): void {
  writeFileSync(
    join(root, "Syntheses", `${date}.md`),
    [
      "---",
      "type: synthesis",
      `date: ${date}`,
      `created: ${date}`,
      "---",
      "",
      `# ${date}`,
      "",
      "## Observations",
      "",
      sections.observations ?? "- Nothing of note.",
      "",
      "## Candidates",
      "",
      sections.candidates ?? "- Nothing to propose.",
      "",
    ].join("\n"),
    "utf8",
  );
}

const unresolvedTargets = (): string[] =>
  call("vault_links", { direction: "unresolved" }).unresolved.map((u: { target: string }) => u.target);

describe("candidates are reports, not demand", () => {
  test("a candidate wikilink in a synthesis note is not an unresolved link", () => {
    writeSynthesis("2026-07-25", { candidates: "- [[Alex Rivera]] — mentioned in a daily note." });
    assert.ok(
      !unresolvedTargets().includes("Alex Rivera"),
      "reporting a candidate must not manufacture evidence for it",
    );
  });

  test("the same name outside the Candidates section still counts", () => {
    writeSynthesis("2026-07-25", {
      observations: "- [[Alex Rivera]] came up again this week.",
      candidates: "- [[Alex Rivera]] — worth a note?",
    });
    assert.ok(
      unresolvedTargets().includes("Alex Rivera"),
      "a real mention elsewhere is still demand, even if it is also a candidate",
    );
  });

  test("a candidate link is still an outgoing link of the synthesis note", () => {
    writeSynthesis("2026-07-25", { candidates: "- [[Alex Rivera]] — mentioned in a daily note." });
    const out = call("vault_links", { direction: "out", note: "Syntheses/2026-07-25.md" });
    assert.ok(out.links.includes("Alex Rivera"), "the link is real, it is just not demand");
  });

  test("times_surfaced counts past proposals, wikilinked or plain", () => {
    writeSynthesis("2026-07-25", { candidates: "- [[Alex Rivera]] — worth a note?" });
    writeSynthesis("2026-07-26", { candidates: "- Alex Rivera — worth a note?" });
    writeSynthesis("2026-07-27", {
      observations: "- [[Alex Rivera]] again.",
      candidates: "- Alex Rivera — still unresolved.",
    });
    const entry = call("vault_links", { direction: "unresolved" }).unresolved.find(
      (u: { target: string }) => u.target === "Alex Rivera",
    );
    assert.equal(entry.times_surfaced, 3);
  });
});

describe("link_ignore", () => {
  const args = { target: "Frobnix", reason: "OS the user runs, not a topic tracked here" };

  test("retires a target out of unresolved and into ignored", () => {
    writeSynthesis("2026-07-25", { observations: "- Flashed [[Frobnix]] on the old phone." });
    assert.ok(unresolvedTargets().includes("Frobnix"));

    call("link_ignore", args);
    assert.ok(!unresolvedTargets().includes("Frobnix"));
    const ignored = call("vault_links", { direction: "ignored" }).ignored;
    assert.deepEqual(
      ignored.map((i: { target: string }) => i.target),
      ["Frobnix"],
    );
  });

  test("suppression is never silent", () => {
    writeSynthesis("2026-07-25", { observations: "- Flashed [[Frobnix]] on the old phone." });
    call("link_ignore", args);
    assert.equal(call("vault_status").ignored_count, 1);
    assert.equal(call("vault_links", { direction: "unresolved" }).ignored_excluded, 1);
  });

  test("appending the same target twice changes nothing", () => {
    call("link_ignore", args);
    assert.equal(call("link_ignore", args).added, false);
    const rows = read(root, "Ignored Links.md")
      .split("\n")
      .filter((l) => l.includes("Frobnix"));
    assert.equal(rows.length, 1);
  });

  test("the ignore list stores plain text and contributes no links", () => {
    call("link_ignore", { target: "[[Gizmo]]", reason: "part in a [[Widget Kit]] parts list" });
    const content = read(root, "Ignored Links.md");
    assert.ok(!content.includes("[["), "a bracketed row would re-create the problem this solves");
    assert.match(content, /\| Gizmo \| part in a Widget Kit parts list \|/);
    // The row named Gizmo, so Gizmo must not now be an unresolved link.
    assert.ok(!unresolvedTargets().includes("Gizmo"));
    assert.ok(!unresolvedTargets().includes("Widget Kit"));
  });

  test("refuses a name that already resolves, naming the note", () => {
    assert.match(callFails("link_ignore", { target: "Jane Doe", reason: "no" }), /People\/Jane Doe\.md/);
  });

  test("refuses an empty reason", () => {
    assert.match(callFails("link_ignore", { target: "Frobnix", reason: "  " }), /reason is empty/);
  });

  test("the list is created with the frontmatter the vault expects", () => {
    call("link_ignore", args);
    const content = read(root, "Ignored Links.md");
    assert.match(content, /^---\ntype: index\ncreated: \d{4}-\d{2}-\d{2}\n---\n\n# Ignored Links/);
  });
});
