import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lastEntryDate } from "../src/scan.ts";

describe("lastEntryDate", () => {
  test("null when the body has no dated heading or table row", () => {
    assert.equal(
      lastEntryDate("---\ntype: knowledge\ncreated: 2026-06-01\n---\n\n# X\n\nJust prose.\n"),
      null,
    );
  });

  test("reads a date from a ### YYYY-MM-DD log heading", () => {
    const content = "# X\n\n## Activity Log\n\n### 2026-07-07\n\n- Kickoff held.\n";
    assert.equal(lastEntryDate(content), "2026-07-07");
  });

  test("reads a date from the first cell of a table row", () => {
    const content =
      "# X\n\n## Conversation Log\n\n| Date | Who | Summary |\n|------|-----|---------|\n| 2026-07-20 | Jane | Call |\n";
    assert.equal(lastEntryDate(content), "2026-07-20");
  });

  test("the latest of several entries wins, across headings and tables alike", () => {
    const content = [
      "# X",
      "",
      "## Key Decisions",
      "",
      "| Date | Decision | Reasoning |",
      "|------|----------|-----------|",
      "| 2026-07-01 | Ship the deck | Fastest feedback |",
      "",
      "## Activity Log",
      "",
      "### 2026-08-15",
      "",
      "- Renewed scope.",
      "",
      "### 2026-06-01",
      "",
      "- Kickoff.",
      "",
    ].join("\n");
    assert.equal(lastEntryDate(content), "2026-08-15");
  });

  test("ignores frontmatter dates entirely", () => {
    const content = "---\ntype: project\ncreated: 2026-09-01\nstarted: 2026-09-01\n---\n\n# X\n\nNo entries yet.\n";
    assert.equal(lastEntryDate(content), null);
  });

  test("ignores dated-looking text inside a fenced code block", () => {
    const content = "# X\n\n```\n### 2026-09-01\n| 2026-09-01 | not real | not real |\n```\n\nProse.\n";
    assert.equal(lastEntryDate(content), null);
  });

  test("rejects a heading or row that is not a real calendar date", () => {
    const content = "# X\n\n### 2026-02-31\n\n- Not a real day.\n";
    assert.equal(lastEntryDate(content), null);
  });

  test("a table header/divider row is not itself an entry", () => {
    const content = "# X\n\n## Conversation Log\n\n| Date | Who | Summary |\n|------|-----|---------|\n";
    assert.equal(lastEntryDate(content), null);
  });
});
