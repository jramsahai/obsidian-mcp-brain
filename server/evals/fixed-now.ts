// Fixes the date every `today()` call sees during a scenario run.
//
// config.ts's `today()` defaults its `now` parameter to `new Date()`, and
// nothing in the server or its tests overrides that — there is no injectable
// clock. Scenarios need a fixed "today" so a relative due date ("in 3 days")
// has one right answer to check against. Rather than add a test seam to
// production code for this one caller, we monkey-patch the global `Date`
// constructor for the span of one scenario's tool-execution loop: every
// argument-less `new Date()` and `Date.now()` returns the fixed instant,
// and any other use of `Date` (e.g. `new Date(str)`) is untouched.

export async function withFixedNow<T>(dateStr: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!dateStr) return fn();

  const RealDate = Date;
  const fixedMs = new RealDate(`${dateStr}T12:00:00Z`).getTime();
  if (Number.isNaN(fixedMs)) throw new Error(`fixed "today" is not a valid date: ${dateStr}`);

  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(fixedMs);
      } else {
        // @ts-expect-error — forwarding a variadic constructor call
        super(...args);
      }
    }
    static now(): number {
      return fixedMs;
    }
  }

  // @ts-expect-error — intentional global override, restored in finally
  globalThis.Date = FixedDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}
