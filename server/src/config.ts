import { resolve } from "node:path";

export interface Config {
  vaultRoot: string;
  timezone: string;
  gitEnabled: boolean;
  gitBinary: string;
}

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = env.OBSIDIAN_VAULT;
  if (!raw) {
    throw new Error(
      "OBSIDIAN_VAULT is not set. Set it to the absolute vault path in the MCP server env block.",
    );
  }
  return {
    vaultRoot: resolve(raw),
    timezone: env.VAULT_TZ || "America/New_York",
    gitEnabled: env.VAULT_GIT === "1",
    gitBinary: env.VAULT_GIT_BIN || "/usr/bin/git",
  };
}

export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** For tests: point the process at a fixture vault. */
export function setConfig(next: Config): void {
  cached = next;
}

/** Today's date as YYYY-MM-DD in the vault's local timezone. */
export function today(cfg: Config = config(), now: Date = new Date()): string {
  return formatDate(now, cfg.timezone);
}

export function formatDate(when: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(when);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * A file's mtime as a YYYY-MM-DD date in the vault's timezone — the only date a
 * caller should ever see for it. Formatting mtime with toISOString() reports a
 * note edited at 20:00 EDT as modified tomorrow, contradicting vault_status's
 * `today` in the same breath; comparing raw epochs against a host-parsed
 * midnight breaks the moment the host timezone and VAULT_TZ differ. ISO dates
 * compare lexically, so filtering needs no epoch math at all.
 */
export function modifiedOn(mtimeMs: number, cfg: Config = config()): string {
  return formatDate(new Date(mtimeMs), cfg.timezone);
}

/** Current local time as HH:mm for timestamped output. */
export function localTime(cfg: Config = config(), now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: cfg.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/** Local timestamp with offset, e.g. `2026-07-31T15:30:00-04:00`. */
export function localTimestamp(cfg: Config = config(), now: Date = new Date()): string {
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone: cfg.timezone, timeZoneName: "longOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  return `${formatDate(now, cfg.timezone)}T${localTime(cfg, now)}:00${offset.replace("GMT", "") || "+00:00"}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Shape *and* calendar. The shape check alone let "2026-02-31" and "2026-99-99"
 * through into date-named note paths, and nothing in the tool surface can
 * delete the junk note that results — so the only place to stop it is here.
 */
export function assertDate(value: string, field: string): string {
  const match = DATE_RE.exec(value);
  if (!match) {
    throw new ToolError(
      `${field} must be an exact date in YYYY-MM-DD form; got "${value}". Resolve relative dates like "friday" before calling.`,
    );
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const stamp = new Date(Date.UTC(y, m - 1, d));
  if (stamp.getUTCFullYear() !== y || stamp.getUTCMonth() !== m - 1 || stamp.getUTCDate() !== d) {
    throw new ToolError(
      `${field} "${value}" is not a real calendar date. Check the month and day.`,
    );
  }
  return value;
}

/** True when `value` is a real calendar date in YYYY-MM-DD form. */
export function isDate(value: string): boolean {
  try {
    assertDate(value, "date");
    return true;
  } catch {
    return false;
  }
}

/** An error whose message is meant to be read by the model and acted on. */
export class ToolError extends Error {}
