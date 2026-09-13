import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { similarity, SIMILARITY_THRESHOLD } from "../src/similar.ts";
import { call, callFails, cleanupVault, read, useVault } from "./helpers.ts";

let root: string;
beforeEach(() => {
  root = useVault();
});
afterEach(cleanupVault);

/** A note whose section is nothing but `### YYYY-MM-DD` blocks. */
function datedLog(name: string, body: string): void {
  mkdirSync(join(root, "Ideas"), { recursive: true });
  writeFileSync(join(root, "Ideas", `${name}.md`), `---\ntype: idea\n---\n\n# ${name}\n\n${body}`);
}

const DAY = "2026-08-02";
const log = (name: string) => datedLog(name, `## Activity Log\n\n### ${DAY}\n\n- Kickoff held.\n`);

/**
 * The 2026-08-02 defect: inside one continuous turn the model wrote the same
 * board purchase three times and the same conversation twice, each time in
 * different words, and the exact-match dedupe let all of it through.
 *
 * These keep the exact shape of the strings it wrote — same clauses moved,
 * dropped, and traded for a URL — with the product, vendor, and people swapped
 * for stand-ins. Measured against the real function they score 0.981, 0.846,
 * 0.863 and 0.716, the same band as the originals (0.708, 0.839, 0.969). If
 * any of these stops failing, the guard has stopped guarding.
 */
const BOARD = [
  "Purchased the Lumen DK7 round display dev kit — expected delivery today (from the supplier). Also found a printable enclosure on a model site (model 4471) for the Lumen DK7; may need a more robust design later when adding a battery.",
  "Purchased Lumen DK7 round display dev kit from the supplier — expected delivery today. Found a printable enclosure on a model site (model 4471) for the Lumen DK7; may need a more robust design later when adding a battery.",
  "Ordered the Lumen DK7 round display dev kit from the supplier (https://example.com/dk7). Found a printable enclosure on a model site (model 4471) for initial housing; may need a more robust design later when adding battery.",
];

const MEETING = [
  "Discussed market positioning, target audience (florists as strong candidate, plumbers weak fit), competitor landscape (one established app), AI-savvy user problem, brand exercise/onboarding wizard concept. Next steps: research target industries, build intake flow, revisit targeting together.",
  "Deep dive on market positioning: competitors exist (one established app), target market unresolved, florists as strong archetype, plumbers weak fit, AI-savvy user problem, brand exercise wizard concept. Agreed on research pass on target industries + build intake flow.",
];

describe("similarity scoring", () => {
  test("the three real board rewordings all clear the threshold", () => {
    assert.ok(similarity(BOARD[0], BOARD[1]) >= SIMILARITY_THRESHOLD);
    assert.ok(similarity(BOARD[0], BOARD[2]) >= SIMILARITY_THRESHOLD);
    assert.ok(similarity(BOARD[1], BOARD[2]) >= SIMILARITY_THRESHOLD);
  });

  test("the two conversation rewordings clear the threshold", () => {
    assert.ok(similarity(MEETING[0], MEETING[1]) >= SIMILARITY_THRESHOLD);
  });

  /**
   * Real same-day pairs from the vault. Across all 1273 entries that already
   * share a dated block, the closest genuine pair scored 0.583 — so these must
   * stay clear of the line. A guard that blocks real entries is worse than the
   * duplicates it prevents, because the entry is simply lost.
   */
  test("genuinely different entries from the same day stay below it", () => {
    const pairs: [string, string][] = [
      [
        "Project set up from a written technical brief; full spec captured in [[technical-brief]]",
        "Ordered the Lumen DK7 round display dev kit from the supplier — expected delivery today.",
      ],
      [
        "Sent prototype samples to [[Jordan Lee]] for feedback — he's off through July, expect response in August.",
        'Name conflict discovered: "Acme Notes" collides with an existing product. Renaming needed.',
      ],
      [
        "Flash the custom firmware and connect the board to Wi-Fi",
        "Verify that the display, microphones and speaker all work",
      ],
    ];
    for (const [a, b] of pairs) {
      assert.ok(
        similarity(a, b) < SIMILARITY_THRESHOLD,
        `expected below threshold, got ${similarity(a, b).toFixed(3)} for: ${a.slice(0, 45)}`,
      );
    }
  });

  test("entries too short to judge are left to the exact-match guard", () => {
    assert.equal(similarity("Board arrived", "Board shipped"), 0);
  });
});

describe("log_append rejects a reworded repeat", () => {
  test("the second wording of the same event is refused, naming the first", () => {
    log("Board");
    call("log_append", { note: "Board", section: "Activity Log", content: BOARD[0], date: DAY });
    const message = callFails("log_append", {
      note: "Board",
      section: "Activity Log",
      content: BOARD[1],
      date: DAY,
    });
    assert.match(message, /too similar/);
    assert.match(message, /Purchased the Lumen/);
    assert.match(message, /allow_similar/);
    assert.equal(read(root, "Ideas/Board.md").match(/DK7/g)?.length, 2);
  });

  test("the third wording is refused too — it resembles what is already there", () => {
    log("Board");
    call("log_append", { note: "Board", section: "Activity Log", content: BOARD[0], date: DAY });
    assert.match(
      callFails("log_append", {
        note: "Board",
        section: "Activity Log",
        content: BOARD[2],
        date: DAY,
      }),
      /too similar/,
    );
  });

  test("allow_similar is the way through for a genuinely separate event", () => {
    log("Board");
    call("log_append", { note: "Board", section: "Activity Log", content: BOARD[0], date: DAY });
    const result = call("log_append", {
      note: "Board",
      section: "Activity Log",
      content: BOARD[1],
      date: DAY,
      allow_similar: true,
    });
    assert.equal(result.appended, true);
    assert.equal(read(root, "Ideas/Board.md").match(/DK7/g)?.length, 4);
  });

  test("a different day is a different block and never collides", () => {
    log("Board");
    call("log_append", { note: "Board", section: "Activity Log", content: BOARD[0], date: DAY });
    const result = call("log_append", {
      note: "Board",
      section: "Activity Log",
      content: BOARD[1],
      date: "2026-08-03",
    });
    assert.equal(result.appended, true);
  });

  test("an unrelated entry the same day still goes in", () => {
    log("Board");
    call("log_append", { note: "Board", section: "Activity Log", content: BOARD[0], date: DAY });
    const result = call("log_append", {
      note: "Board",
      section: "Activity Log",
      content: "Drafted the Phase 1 firmware bring-up checklist and picked a serial console",
      date: DAY,
    });
    assert.equal(result.appended, true);
  });
});

describe("section_append rejects a reworded repeat", () => {
  test("the duplicated conversation row is refused", () => {
    const row = (summary: string) => `| ${DAY} | Example Project | ${summary} |`;
    call("section_append", {
      note: "Jane Doe",
      section: "Conversation History",
      content: row(MEETING[0]),
    });
    assert.match(
      callFails("section_append", {
        note: "Jane Doe",
        section: "Conversation History",
        content: row(MEETING[1]),
      }),
      /too similar/,
    );
  });

  /**
   * The guard stops at tables on purpose. Over the vault's 44949 co-located
   * bullets it would reject 79 real ones — repeated paths, checklist items,
   * research lines differing by a number — against 0 of 4007 table rows and 0
   * of 1273 dated entries. If someone extends it to bullets, this test is where
   * they find out what that costs.
   */
  test("a similar free bullet is deliberately left alone", () => {
    call("section_append", {
      note: "Jane Doe",
      section: "General Notes",
      content: `- ${MEETING[0]}`,
    });
    const result = call("section_append", {
      note: "Jane Doe",
      section: "General Notes",
      content: `- ${MEETING[1]}`,
    });
    assert.equal(result.appended, true);
  });

  test("an unrelated row still appends", () => {
    call("section_append", {
      note: "Jane Doe",
      section: "Conversation History",
      content: `| ${DAY} | Example Project | ${MEETING[0]} |`,
    });
    const result = call("section_append", {
      note: "Jane Doe",
      section: "Conversation History",
      content: `| ${DAY} | Onboarding | Walked through the invoicing handover and agreed a cutover date |`,
    });
    assert.equal(result.appended, true);
  });
});

describe("log_remove", () => {
  test("removes the entry it was pointed at and leaves the rest", () => {
    log("Board");
    call("log_append", { note: "Board", section: "Activity Log", content: BOARD[0], date: DAY });
    const result = call("log_remove", {
      note: "Board",
      section: "Activity Log",
      date: DAY,
      match: "Purchased the Lumen",
    });
    assert.equal(result.removed, 1);
    const after = read(root, "Ideas/Board.md");
    assert.ok(!after.includes("Lumen"));
    assert.ok(after.includes("Kickoff held."));
  });

  test("emptying a block takes its date heading with it", () => {
    datedLog("Solo", `## Activity Log\n\n### ${DAY}\n\n- Only entry here.\n`);
    call("log_remove", {
      note: "Solo",
      section: "Activity Log",
      date: DAY,
      match: "Only entry",
    });
    assert.ok(!read(root, "Ideas/Solo.md").includes(`### ${DAY}`));
  });

  test("only the named day is touched", () => {
    datedLog("Two", `## Activity Log\n\n### ${DAY}\n\n- Shared wording here.\n\n### 2026-07-07\n\n- Shared wording here.\n`);
    call("log_remove", { note: "Two", section: "Activity Log", date: DAY, match: "Shared wording" });
    const after = read(root, "Ideas/Two.md");
    assert.ok(after.includes("### 2026-07-07"));
    assert.equal(after.match(/Shared wording/g)?.length, 1);
  });

  test("a match that hits nothing is an error, not a silent no-op", () => {
    log("Board");
    assert.match(
      callFails("log_remove", {
        note: "Board",
        section: "Activity Log",
        date: DAY,
        match: "something that is not there",
      }),
      /Nothing was removed/,
    );
  });

  test("a date with no block names the dates that do exist", () => {
    log("Board");
    assert.match(
      callFails("log_remove", {
        note: "Board",
        section: "Activity Log",
        date: "2026-01-01",
        match: "Kickoff",
      }),
      new RegExp(DAY),
    );
  });

  test("templates stay unwritable through the removal path too", () => {
    assert.match(
      callFails("log_remove", {
        note: "Project Template",
        section: "Activity Log",
        date: DAY,
        match: "anything",
      }),
      /template/i,
    );
  });
});
