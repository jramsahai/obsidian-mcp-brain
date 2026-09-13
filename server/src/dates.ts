/**
 * Relative-date resolution, pure and clock-free.
 *
 * The model does this arithmetic in its head today — "next friday" from a
 * `vault_status` `today` — and a wrong due date is the error nobody notices
 * until the task is missed. `resolveDateExpression` takes the exact same
 * inputs a model would (an expression and a `from` date) and returns the one
 * exact date those words mean, so a captured "end of the month" always lands
 * on the same day regardless of which pass reads it back.
 *
 * Every calendar computation goes through whole-day integers ("epoch days",
 * days since the Unix epoch, always via `Date.UTC`) rather than local Date
 * arithmetic, so nothing here reads a wall clock or a host timezone — `from`
 * is the only notion of "now" this module has.
 */

import { assertDate, ToolError } from "./config.ts";

export interface ResolvedDate {
  date: string;
  interpretation: string;
  weekday: string;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** JS `getUTCDay()` order: Sunday=0 .. Saturday=6. */
const JS_DOW = new Map<string, number>([
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
]);

/** Offset from that calendar week's Monday, for "this/next <weekday>". */
const MONDAY_FIRST_ORDER = new Map<string, number>([
  ["monday", 0],
  ["tuesday", 1],
  ["wednesday", 2],
  ["thursday", 3],
  ["friday", 4],
  ["saturday", 5],
  ["sunday", 6],
]);

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * "september", "sep", and "sept" all map to 9, so one lookup handles every
 * spelling people actually dictate — "sept" is the one four-letter
 * abbreviation in common use.
 */
const MONTH_LOOKUP = new Map<string, number>();
MONTH_NAMES.forEach((name, i) => {
  MONTH_LOOKUP.set(name, i + 1);
  MONTH_LOOKUP.set(name.slice(0, 3), i + 1);
});
MONTH_LOOKUP.set("sept", 9);

// Longest names first so "june" is tried before its own prefix "jun" would be.
const MONTH_PATTERN = [...MONTH_LOOKUP.keys()].sort((a, b) => b.length - a.length).join("|");
const MONTH_DAY_RE = new RegExp(`^(${MONTH_PATTERN}) (\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`);
const DAY_MONTH_RE = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (${MONTH_PATTERN})(?:,?\\s+(\\d{4}))?$`);
const SLASH_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/;

const SUPPORTED_FORMS =
  'today, tomorrow, yesterday, "day after tomorrow"; a weekday name ("friday"), ' +
  '"this <weekday>", "next <weekday>"; "in N days/weeks/months", "N days/weeks from now"; ' +
  '"end of week/month/year", "start of next week/month", "next week", "next month"; ' +
  'an exact YYYY-MM-DD; "Month D" / "D Month" / "Mon D" with or without a year; M/D or M/D/YYYY.';

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

function epochDay(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fromEpochDay(epoch: number): { y: number; m: number; d: number } {
  const dt = new Date(epoch * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function dowOf(epoch: number): number {
  return new Date(epoch * 86_400_000).getUTCDay();
}

function lastDayOfMonth(y: number, m: number): number {
  // Date.UTC(y, m, 0) is one month index past m (0-based), day 0 of which is
  // the last day of the month before it — i.e. 1-indexed month m.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add whole calendar months to a year/month, wrapping the year as needed. */
function shiftMonth(y: number, m: number, n: number): { y: number; m: number } {
  const total = m - 1 + n;
  const newY = y + Math.floor(total / 12);
  const newM = ((total % 12) + 12) % 12 + 1;
  return { y: newY, m: newM };
}

/** True calendar validity, the same check `assertDate` runs on YYYY-MM-DD strings. */
function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const back = fromEpochDay(epochDay(y, m, d));
  return back.y === y && back.m === m && back.d === d;
}

function unsupported(expr: string): ToolError {
  return new ToolError(`"${expr}" is not a date expression I can resolve. Supported forms: ${SUPPORTED_FORMS}`);
}

/**
 * Resolve a relative or explicit date expression against `from` (YYYY-MM-DD).
 * Pure: the only date this function knows about is `from`, injected by the
 * caller — it never reads the system clock, so the same inputs always
 * produce the same output regardless of when or where it runs.
 */
export function resolveDateExpression(expr: string, from: string): ResolvedDate {
  assertDate(from, "from");
  const [fy, fm, fd] = from.split("-").map(Number);
  const fromEpoch = epochDay(fy, fm, fd);
  const fromAbbr = WEEKDAY_ABBR[dowOf(fromEpoch)];

  const raw = expr.trim();
  if (!raw) throw new ToolError("expression is empty. Supported forms: " + SUPPORTED_FORMS);

  let norm = raw.toLowerCase().replace(/\s+/g, " ");
  // Tolerate a leading filler word ("on friday", "by next friday", "by the
  // end of the month") without teaching every branch below about it.
  while (/^(on|by|the)\s+/.test(norm)) {
    norm = norm.replace(/^(on|by|the)\s+/, "");
  }

  const interpret = (targetEpoch: number): ResolvedDate => {
    const { y, m, d } = fromEpochDay(targetEpoch);
    const date = formatYmd(y, m, d);
    return {
      date,
      interpretation: `"${raw}" from ${from} (${fromAbbr}) is ${date}`,
      weekday: WEEKDAY_NAMES[dowOf(targetEpoch)],
    };
  };

  if (norm === "today") return interpret(fromEpoch);
  if (norm === "tomorrow") return interpret(fromEpoch + 1);
  if (norm === "yesterday") return interpret(fromEpoch - 1);
  if (norm === "day after tomorrow") return interpret(fromEpoch + 2);

  const inDays = /^in (\d+) days?$/.exec(norm) ?? /^(\d+) days? from now$/.exec(norm);
  if (inDays) return interpret(fromEpoch + Number(inDays[1]));

  const inWeeks = /^in (\d+) weeks?$/.exec(norm) ?? /^(\d+) weeks? from now$/.exec(norm);
  if (inWeeks) return interpret(fromEpoch + 7 * Number(inWeeks[1]));

  const inMonths = /^in (\d+) months?$/.exec(norm);
  if (inMonths) {
    const n = Number(inMonths[1]);
    const { y, m } = shiftMonth(fy, fm, n);
    const d = Math.min(fd, lastDayOfMonth(y, m));
    return interpret(epochDay(y, m, d));
  }

  // Monday of the calendar week containing `from` (week runs Mon-Sun).
  const mondayOffset = (dowOf(fromEpoch) + 6) % 7;
  const thisMonday = fromEpoch - mondayOffset;

  if (/^end of (?:the )?week$/.test(norm)) return interpret(thisMonday + 6);
  if (norm === "next week" || norm === "start of next week") return interpret(thisMonday + 7);
  if (/^end of (?:the )?month$/.test(norm)) {
    return interpret(epochDay(fy, fm, lastDayOfMonth(fy, fm)));
  }
  if (/^end of (?:the )?year$/.test(norm)) return interpret(epochDay(fy, 12, 31));
  if (norm === "next month" || norm === "start of next month") {
    const { y, m } = shiftMonth(fy, fm, 1);
    return interpret(epochDay(y, m, 1));
  }

  const thisWeekday = /^this (\w+)$/.exec(norm);
  if (thisWeekday && MONDAY_FIRST_ORDER.has(thisWeekday[1])) {
    return interpret(thisMonday + MONDAY_FIRST_ORDER.get(thisWeekday[1])!);
  }
  const nextWeekday = /^next (\w+)$/.exec(norm);
  if (nextWeekday && MONDAY_FIRST_ORDER.has(nextWeekday[1])) {
    return interpret(thisMonday + 7 + MONDAY_FIRST_ORDER.get(nextWeekday[1])!);
  }
  if (JS_DOW.has(norm)) {
    const targetDow = JS_DOW.get(norm)!;
    let diff = (targetDow - dowOf(fromEpoch) + 7) % 7;
    if (diff === 0) diff = 7;
    return interpret(fromEpoch + diff);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    assertDate(raw, "expression");
    const [y, m, d] = raw.split("-").map(Number);
    return interpret(epochDay(y, m, d));
  }

  const resolveMonthDay = (month: number, day: number, year?: number): ResolvedDate => {
    let y = year ?? fy;
    if (!isValidYmd(y, month, day)) {
      throw new ToolError(`"${expr}" is not a real calendar date. Check the month and day.`);
    }
    let epoch = epochDay(y, month, day);
    // No year given: the next occurrence on or after `from`, not a fixed year.
    if (year === undefined && epoch < fromEpoch) {
      y = fy + 1;
      if (!isValidYmd(y, month, day)) {
        throw new ToolError(`"${expr}" is not a real calendar date. Check the month and day.`);
      }
      epoch = epochDay(y, month, day);
    }
    return interpret(epoch);
  };

  const monthDay = MONTH_DAY_RE.exec(norm);
  if (monthDay) {
    return resolveMonthDay(
      MONTH_LOOKUP.get(monthDay[1])!,
      Number(monthDay[2]),
      monthDay[3] ? Number(monthDay[3]) : undefined,
    );
  }
  const dayMonth = DAY_MONTH_RE.exec(norm);
  if (dayMonth) {
    return resolveMonthDay(
      MONTH_LOOKUP.get(dayMonth[2])!,
      Number(dayMonth[1]),
      dayMonth[3] ? Number(dayMonth[3]) : undefined,
    );
  }
  const slash = SLASH_RE.exec(norm);
  if (slash) {
    return resolveMonthDay(
      Number(slash[1]),
      Number(slash[2]),
      slash[3] ? Number(slash[3]) : undefined,
    );
  }

  throw unsupported(expr);
}
