import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { resolveDateExpression } from "../src/dates.ts";
import { call, callFails, cleanupVault, useVault } from "./helpers.ts";

/**
 * Two `from` dates on purpose: 2026-09-11 is a Friday (exercises "bare
 * weekday said on that weekday" and the this/next-week boundary), and
 * 2026-01-31 is the last day of a month (exercises month-arithmetic
 * clamping). Anything that only works from one kind of day would pass a
 * single-`from` suite and still be wrong.
 */
const FRIDAY = "2026-09-11";
const MONTH_END = "2026-01-31";

describe("resolveDateExpression — relative day forms", () => {
  const cases: [string, string, string][] = [
    [FRIDAY, "today", "2026-09-11"],
    [FRIDAY, "TODAY", "2026-09-11"], // case-insensitive
    [FRIDAY, "tomorrow", "2026-09-12"],
    [FRIDAY, "yesterday", "2026-09-10"],
    [FRIDAY, "day after tomorrow", "2026-09-13"],
    [MONTH_END, "today", "2026-01-31"],
    [MONTH_END, "tomorrow", "2026-02-01"],
    [MONTH_END, "yesterday", "2026-01-30"],
    [MONTH_END, "day after tomorrow", "2026-02-02"],
  ];
  for (const [from, expr, want] of cases) {
    test(`"${expr}" from ${from} -> ${want}`, () => {
      assert.equal(resolveDateExpression(expr, from).date, want);
    });
  }
});

describe("resolveDateExpression — weekday forms", () => {
  test("a bare weekday said on that same weekday means next week, not today", () => {
    assert.equal(resolveDateExpression("friday", FRIDAY).date, "2026-09-18");
  });
  test("a bare weekday resolves to the next occurrence strictly after from", () => {
    assert.equal(resolveDateExpression("monday", FRIDAY).date, "2026-09-14");
  });
  test('"this <weekday>" is this calendar week\'s occurrence, even if already past', () => {
    // Monday of the week containing 2026-09-11 (Fri) is 2026-09-07.
    assert.equal(resolveDateExpression("this monday", FRIDAY).date, "2026-09-07");
  });
  test('"this <weekday>" for a day later in the same week', () => {
    assert.equal(resolveDateExpression("this sunday", FRIDAY).date, "2026-09-13");
  });
  test('"next <weekday>" is the occurrence in the following calendar week', () => {
    assert.equal(resolveDateExpression("next friday", FRIDAY).date, "2026-09-18");
    assert.equal(resolveDateExpression("next monday", FRIDAY).date, "2026-09-14");
  });
  test("weekday forms from the last day of a month", () => {
    // 2026-01-31 is a Saturday.
    assert.equal(resolveDateExpression("saturday", MONTH_END).date, "2026-02-07");
    assert.equal(resolveDateExpression("this saturday", MONTH_END).date, "2026-01-31");
    assert.equal(resolveDateExpression("next saturday", MONTH_END).date, "2026-02-07");
  });
});

describe("resolveDateExpression — offsets", () => {
  const cases: [string, string, string][] = [
    [FRIDAY, "in 3 days", "2026-09-14"],
    [FRIDAY, "3 days from now", "2026-09-14"],
    [FRIDAY, "in 1 day", "2026-09-12"],
    [FRIDAY, "in 2 weeks", "2026-09-25"],
    [FRIDAY, "2 weeks from now", "2026-09-25"],
    [FRIDAY, "in 1 month", "2026-10-11"],
    [FRIDAY, "in 2 months", "2026-11-11"],
    [MONTH_END, "in 1 month", "2026-02-28"], // clamped: Feb has no 31st
    [MONTH_END, "in 2 months", "2026-03-31"], // March has a 31st again
    ["2026-12-31", "in 2 months", "2027-02-28"], // crosses a year boundary and clamps
  ];
  for (const [from, expr, want] of cases) {
    test(`"${expr}" from ${from} -> ${want}`, () => {
      assert.equal(resolveDateExpression(expr, from).date, want);
    });
  }
});

describe("resolveDateExpression — week/month/year anchors", () => {
  const cases: [string, string, string][] = [
    [FRIDAY, "end of week", "2026-09-13"], // Sunday
    [FRIDAY, "end of the week", "2026-09-13"],
    [FRIDAY, "end of month", "2026-09-30"],
    [FRIDAY, "end of the month", "2026-09-30"],
    [FRIDAY, "end of year", "2026-12-31"],
    [FRIDAY, "next week", "2026-09-14"], // next Monday
    [FRIDAY, "start of next week", "2026-09-14"],
    [FRIDAY, "next month", "2026-10-01"],
    [FRIDAY, "start of next month", "2026-10-01"],
    [MONTH_END, "end of month", "2026-01-31"], // already the last day
    [MONTH_END, "end of week", "2026-02-01"], // Sunday of the week containing the 31st
    [MONTH_END, "next month", "2026-02-01"],
  ];
  for (const [from, expr, want] of cases) {
    test(`"${expr}" from ${from} -> ${want}`, () => {
      assert.equal(resolveDateExpression(expr, from).date, want);
    });
  }
});

describe("resolveDateExpression — explicit and month/day forms", () => {
  const cases: [string, string, string][] = [
    [FRIDAY, "2026-12-25", "2026-12-25"],
    [FRIDAY, "september 13", "2026-09-13"], // on `from`, so this year
    [FRIDAY, "september 5", "2027-09-05"], // already past `from` this year -> next year
    [FRIDAY, "13 september", "2026-09-13"],
    [FRIDAY, "sep 13", "2026-09-13"],
    [FRIDAY, "Sep 13", "2026-09-13"],
    [FRIDAY, "september 13, 2027", "2027-09-13"],
    [FRIDAY, "9/13", "2026-09-13"],
    [FRIDAY, "9/13/2027", "2027-09-13"],
    [MONTH_END, "february 1", "2026-02-01"],
  ];
  for (const [from, expr, want] of cases) {
    test(`"${expr}" from ${from} -> ${want}`, () => {
      assert.equal(resolveDateExpression(expr, from).date, want);
    });
  }
});

describe("resolveDateExpression — tolerated surrounding words", () => {
  test('"on friday"', () => {
    assert.equal(resolveDateExpression("on friday", FRIDAY).date, "2026-09-18");
  });
  test('"by next friday"', () => {
    assert.equal(resolveDateExpression("by next friday", FRIDAY).date, "2026-09-18");
  });
  test('"by the end of the month"', () => {
    assert.equal(resolveDateExpression("by the end of the month", FRIDAY).date, "2026-09-30");
  });
});

describe("resolveDateExpression — interpretation and weekday", () => {
  test("interpretation names the phrase, the from date and weekday, and the result", () => {
    const r = resolveDateExpression("next friday", FRIDAY);
    assert.equal(r.interpretation, '"next friday" from 2026-09-11 (Fri) is 2026-09-18');
  });
  test("weekday is the resolved date's own weekday name", () => {
    assert.equal(resolveDateExpression("next friday", FRIDAY).weekday, "Friday");
    assert.equal(resolveDateExpression("end of month", FRIDAY).weekday, "Wednesday");
  });
});

describe("resolveDateExpression — errors", () => {
  test("an unsupported phrase names the supported forms in the error", () => {
    assert.throws(
      () => resolveDateExpression("next fortnight", FRIDAY),
      /"next fortnight" is not a date expression I can resolve\. Supported forms: today, tomorrow/,
    );
  });
  test("an empty expression is refused", () => {
    assert.throws(() => resolveDateExpression("   ", FRIDAY), /expression is empty/);
  });
  test("an impossible calendar date is refused", () => {
    assert.throws(() => resolveDateExpression("february 30", FRIDAY), /not a real calendar date/);
  });
  test("an invalid from is refused the same way assertDate refuses it", () => {
    assert.throws(() => resolveDateExpression("today", "2026-02-31"), /not a real calendar date/);
  });
});

describe("resolveDateExpression — never reads the clock", () => {
  test("the same call returns the same answer regardless of the real date", () => {
    const a = resolveDateExpression("next friday", FRIDAY);
    const RealDate = Date;
    class OtherDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(0);
        // @ts-expect-error forwarding a variadic constructor call
        else super(...args);
      }
      static now() {
        return 0;
      }
    }
    // @ts-expect-error intentional global override, restored below
    globalThis.Date = OtherDate;
    let b;
    try {
      b = resolveDateExpression("next friday", FRIDAY);
    } finally {
      globalThis.Date = RealDate;
    }
    assert.deepEqual(a, b);
  });
});

describe("date_resolve tool", () => {
  beforeEach(() => {
    useVault();
  });
  afterEach(cleanupVault);

  test("resolves against a supplied from", () => {
    const result = call("date_resolve", { expression: "next friday", from: "2026-09-11" });
    assert.equal(result.date, "2026-09-18");
    assert.equal(result.from, "2026-09-11");
    assert.equal(result.weekday, "Friday");
    assert.equal(result.interpretation, '"next friday" from 2026-09-11 (Fri) is 2026-09-18');
  });

  test("defaults from to today in the vault's timezone", () => {
    const result = call("date_resolve", { expression: "today" });
    assert.equal(typeof result.from, "string");
    assert.match(result.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(result.date, result.from);
  });

  test("expression is required", () => {
    assert.match(callFails("date_resolve", {}), /expression is required/);
  });

  test("an unsupported phrase fails with the supported-forms message", () => {
    assert.match(
      callFails("date_resolve", { expression: "next fortnight" }),
      /is not a date expression I can resolve/,
    );
  });

  test("an invalid from is refused before resolution runs", () => {
    assert.match(
      callFails("date_resolve", { expression: "today", from: "2026-13-01" }),
      /from "2026-13-01" is not a real calendar date/,
    );
  });
});
