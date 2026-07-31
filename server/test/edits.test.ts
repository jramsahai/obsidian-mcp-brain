import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { RELATE_CAP } from "../src/relate.ts";
import { call, callFails, cleanupVault, lineOf, read, useVault } from "./helpers.ts";

let root = "";
beforeEach(() => {
  root = useVault();
});
afterEach(cleanupVault);

describe("checklist_set", () => {
  test("adds an item to a sectionless list", () => {
    const result = call("checklist_set", { note: "Test Store", item: "Drywall screws" });
    assert.equal(result.action, "added");
    assert.equal(result.line, "- [ ] Drywall screws");
    assert.match(read(root, "Shopping/Test Store.md"), /- \[ \] Drywall screws\n$/);
  });

  test("merges new detail into an existing item instead of duplicating it", () => {
    const result = call("checklist_set", { note: "Test Store", item: "Large nuts", detail: "M12" });
    assert.equal(result.action, "updated");
    const content = read(root, "Shopping/Test Store.md");
    assert.equal(content.split("\n").filter((l) => l.includes("Large nuts")).length, 1);
    assert.equal(lineOf(content, "Large nuts"), "- [ ] Large nuts — M12");
  });

  test("keeps an existing detail and adds the new one alongside", () => {
    call("checklist_set", { note: "Test Store", item: "Paint roller", detail: "nap 3/8" });
    assert.equal(
      lineOf(read(root, "Shopping/Test Store.md"), "Paint roller"),
      "- [x] Paint roller — 9 inch; nap 3/8",
    );
  });

  test("checking an item off rewrites the box and never removes the line", () => {
    const result = call("checklist_set", { note: "Test Store", item: "Large nuts", checked: true });
    assert.equal(result.action, "updated");
    assert.equal(lineOf(read(root, "Shopping/Test Store.md"), "Large nuts"), "- [x] Large nuts");
  });

  test("a repeated capture with no new detail changes nothing", () => {
    const before = read(root, "Shopping/Test Store.md");
    assert.equal(call("checklist_set", { note: "Test Store", item: "Large nuts" }).action, "unchanged");
    assert.equal(read(root, "Shopping/Test Store.md"), before);
  });

  test("adds to a named section of a sectioned note", () => {
    call("checklist_set", { note: "Jane Doe", item: "Renewal timing", section: "Pending Topics" });
    const content = read(root, "People/Jane Doe.md");
    assert.match(content, /## Pending Topics\n\n- \[ \] Revised scope\n- \[ \] Renewal timing/);
  });

  test("a sectioned note requires a section and lists the options", () => {
    const message = callFails("checklist_set", { note: "Jane Doe", item: "Renewal timing" });
    assert.match(message, /section is required/);
    assert.match(message, /General Notes, Conversation History, Pending Topics/);
  });

  test("matching ignores punctuation and case, so wording drift does not duplicate", () => {
    assert.equal(
      call("checklist_set", { note: "Test Store", item: "large  NUTS!", checked: true }).action,
      "updated",
    );
    assert.equal(read(root, "Shopping/Test Store.md").split("\n").filter((l) => /nuts/i.test(l)).length, 1);
  });
});

describe("relate", () => {
  test("appends the documented shape to ## Related", () => {
    const result = call("relate", {
      note: "Example Project",
      target: "Pricing Models",
      reason: "the deck's pricing section draws on it",
    });
    assert.equal(result.added, true);
    assert.match(
      read(root, "Projects/Example Project/Example Project.md"),
      /- \[\[Pricing Models\]\] — the deck's pricing section draws on it/,
    );
  });

  test("is idempotent — a second run adds nothing and does not spend budget", () => {
    const args = { note: "Example Project", target: "Pricing Models", reason: "shared pricing material" };
    call("relate", args);
    const after = read(root, "Projects/Example Project/Example Project.md");
    const second = call("relate", args);
    assert.equal(second.added, false);
    assert.match(second.reason_skipped, /already listed/);
    assert.equal(read(root, "Projects/Example Project/Example Project.md"), after);
    assert.equal(second.remaining_today, RELATE_CAP - 1);
  });

  test("respects a link that was already in the file before this run", () => {
    const before = read(root, "Knowledge Base/Pricing/Pricing Models.md");
    const result = call("relate", {
      note: "Pricing Models",
      target: "Wayfinder",
      reason: "a reason the existing hand-written line already covers",
    });
    assert.equal(result.added, false);
    assert.equal(read(root, "Knowledge Base/Pricing/Pricing Models.md"), before);
  });

  test("mirror writes the reciprocal entry without spending the target's budget", () => {
    const result = call("relate", {
      note: "Example Project",
      target: "Pricing Models",
      reason: "shared pricing material",
      mirror: true,
    });
    assert.equal(result.mirrored, true);
    assert.match(
      read(root, "Knowledge Base/Pricing/Pricing Models.md"),
      /- \[\[Example Project\]\] — shared pricing material/,
    );
  });

  test("creates ## Related when the note has none", () => {
    call("relate", {
      note: "2026-07-28",
      target: "Pricing Models",
      reason: "the day's mood was about the pricing call",
    });
    assert.match(read(root, "Daily/2026-07-28.md"), /## Related\n\n- \[\[Pricing Models\]\] —/);
  });

  test("refuses a note related to itself", () => {
    assert.match(
      callFails("relate", {
        note: "Example Project",
        target: "Example Project",
        reason: "it is obviously itself",
      }),
      /cannot be related to itself/,
    );
  });

  test("refuses a target with no note, naming the near misses", () => {
    const message = callFails("relate", {
      note: "Example Project",
      target: "Pricing Modles",
      reason: "a typo that must not become a dead link",
    });
    assert.match(message, /not found in the vault/);
    assert.match(message, /Pricing Models/);
  });

  test("refuses a reason too short to be worth reading", () => {
    assert.match(
      callFails("relate", { note: "Example Project", target: "Pricing Models", reason: "related" }),
      /too short/,
    );
  });

  test(`stops at ${RELATE_CAP} new links per note per day`, () => {
    const targets = ["Pricing Models", "Wayfinder", "Jane Doe", "Tasks", "Inbox", "2026-07-27"];
    for (let i = 0; i < RELATE_CAP; i++) {
      assert.equal(
        call("relate", {
          note: "Example Project",
          target: targets[i],
          reason: `connection number ${i} worth recording`,
        }).added,
        true,
      );
    }
    const message = callFails("relate", {
      note: "Example Project",
      target: targets[RELATE_CAP],
      reason: "one connection past the nightly cap",
    });
    assert.match(message, new RegExp(`already taken its ${RELATE_CAP} new related links today`));
  });
});

describe("inbox_route", () => {
  const ITEM = "vendor's SLA terms";

  test("writes the destination and only then removes the source line", () => {
    const result = call("inbox_route", {
      line: ITEM,
      destination_note: "Pricing Models",
      destination_section: "Details",
    });
    assert.equal(result.routed, true);
    assert.equal(result.to, "Knowledge Base/Pricing/Pricing Models.md");
    // Landed at the destination...
    assert.match(read(root, "Knowledge Base/Pricing/Pricing Models.md"), /2026-07-29: look into the vendor/);
    // ...and left the inbox.
    assert.ok(!read(root, "Inbox.md").includes("SLA terms"));
  });

  test("the list marker is stripped but the user's wording is kept", () => {
    const result = call("inbox_route", {
      line: ITEM,
      destination_note: "Pricing Models",
      destination_section: "Details",
    });
    assert.equal(result.written, "2026-07-29: look into the vendor's SLA terms");
  });

  test("content overrides what is written without changing what is removed", () => {
    const result = call("inbox_route", {
      line: ITEM,
      destination_note: "Pricing Models",
      destination_section: "Details",
      content: "- Vendor SLA terms need a read before renewal.",
    });
    assert.match(read(root, "Knowledge Base/Pricing/Pricing Models.md"), /need a read before renewal/);
    assert.equal(result.removed_line, "- 2026-07-29: look into the vendor's SLA terms");
  });

  test("a sectionless destination takes the item at the end", () => {
    call("inbox_route", { line: ITEM, destination_note: "Test Store" });
    assert.match(read(root, "Shopping/Test Store.md"), /vendor's SLA terms\n$/);
    assert.ok(!read(root, "Inbox.md").includes("SLA terms"));
  });

  test("a sectioned destination demands a section rather than guessing", () => {
    const message = callFails("inbox_route", { line: ITEM, destination_note: "Pricing Models" });
    assert.match(message, /destination_section is required/);
    assert.match(message, /Summary, Details, Sources, Related/);
    // Nothing moved.
    assert.match(read(root, "Inbox.md"), /SLA terms/);
  });

  test("a failed destination write leaves the item in the inbox", () => {
    // The failure mode that matters: losing the item. Make the destination
    // unwritable so the first step throws, and prove the source survived.
    chmodSync(join(root, "Knowledge Base/Pricing/Pricing Models.md"), 0o444);
    try {
      const message = callFails("inbox_route", {
        line: ITEM,
        destination_note: "Pricing Models",
        destination_section: "Details",
      });
      assert.match(message, /EACCES|permission denied/i);
    } finally {
      chmodSync(join(root, "Knowledge Base/Pricing/Pricing Models.md"), 0o644);
    }
    assert.match(read(root, "Inbox.md"), /2026-07-29: look into the vendor's SLA terms/);
  });

  test("an ambiguous fragment routes nothing", () => {
    const message = callFails("inbox_route", { line: "e", destination_note: "Test Store" });
    assert.match(message, /matches \d+ lines|no line in/);
    assert.match(read(root, "Inbox.md"), /SLA terms/);
  });

  test("a fragment that matches nothing says how to find the wording", () => {
    const message = callFails("inbox_route", {
      line: "quarterly forecast",
      destination_note: "Test Store",
    });
    assert.match(message, /no line in Inbox\.md/);
  });

  test("refuses to route a note into itself", () => {
    assert.match(
      callFails("inbox_route", { line: ITEM, destination_note: "Inbox" }),
      /same note/,
    );
  });
});
