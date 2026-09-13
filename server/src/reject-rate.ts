/**
 * Reject rate: how often a line a machine pass wrote gets removed again.
 *
 * A machine commit is one whose subject is a `vault_snapshot` label the
 * skills use for an automated pass — `nightly-consolidation/SKILL.md`'s
 * "pre-consolidation YYYY-MM-DD" and "nightly consolidation YYYY-MM-DD".
 * Everything else in the vault's history is a human commit. This treats a
 * "pre-consolidation" snapshot as machine too, even though its content is
 * whatever the user left uncommitted (`scope="all"` parks it before the
 * pass writes) — the label is what a later reader has to go on, and the
 * two nightly labels are the only signal this script has.
 *
 * A line an automated pass added is *rejected* if a later commit — anyone's,
 * within a window — removes that exact line from that file. That is the
 * closest a git history gets to "the user didn't want this."
 */
import { execFileSync } from "node:child_process";

export const REJECT_WINDOW_DAYS = 14;

export type LineCategory =
  | "wikilink insertion"
  | "Related bullet"
  | "synthesis note line"
  | "task line"
  | "other";

export interface AddedLine {
  sha: string;
  timestamp: string;
  date: string;
  file: string;
  text: string;
  category: LineCategory;
  rejected: boolean;
  rejectedBy?: string;
}

export interface CountStat {
  added: number;
  rejected: number;
  rate: number;
}

export interface WeekStat extends CountStat {
  week: string;
}

export interface FileStat {
  file: string;
  added: number;
  rejected: number;
}

export interface CategoryStat extends CountStat {
  category: LineCategory;
}

export interface RejectRateReport {
  vaultRoot: string;
  since?: string;
  windowDays: number;
  machineCommits: number;
  overall: CountStat;
  byWeek: WeekStat[];
  topFiles: FileStat[];
  byCategory: CategoryStat[];
  lines: AddedLine[];
}

export interface RejectRateOptions {
  since?: string;
  windowDays?: number;
  gitBinary?: string;
  topFilesLimit?: number;
}

/** Snapshot labels the skills write for an automated pass. See git.ts for the commit shape. */
const MACHINE_LABEL_RE = /^(pre-consolidation|nightly consolidation) \d{4}-\d{2}-\d{2}$/;

const RECORD_SEP = "\u0001";
const FIELD_SEP = "\u001f";

interface CommitDiff {
  sha: string;
  timestamp: string;
  date: string;
  subject: string;
  added: Map<string, string[]>;
  removed: Map<string, string[]>;
}

function git(vaultRoot: string, gitBinary: string, args: string[]): string {
  return execFileSync(gitBinary, ["-C", vaultRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * `--unified=0` patches, one commit per `%x01`-delimited record. Restricted to
 * `.md` files — the vault holds nothing else worth measuring, and a stray
 * `.obsidian` config diff would otherwise pollute every classification.
 */
function parseLog(raw: string): CommitDiff[] {
  const commits: CommitDiff[] = [];
  for (const block of raw.split(RECORD_SEP).slice(1)) {
    const nl = block.indexOf("\n");
    const header = nl === -1 ? block : block.slice(0, nl);
    const patch = nl === -1 ? "" : block.slice(nl + 1);
    const [sha, timestamp, subject] = header.split(FIELD_SEP);
    const added = new Map<string, string[]>();
    const removed = new Map<string, string[]>();
    let file: string | null = null;
    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) {
        file = null;
        continue;
      }
      // Git appends a trailing tab to disambiguate a path that contains a
      // space (every project/person note does) — strip it or `.endsWith
      // (".md")` silently drops every such file from the whole measurement.
      const target = /^\+\+\+ b\/(.+)$/.exec(line);
      if (target) {
        file = target[1].replace(/\t$/, "");
        continue;
      }
      if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
      if (!file || !file.endsWith(".md")) continue;
      if (line.startsWith("+")) {
        const text = line.slice(1);
        if (text.trim()) pushTo(added, file, text);
      } else if (line.startsWith("-")) {
        const text = line.slice(1);
        if (text.trim()) pushTo(removed, file, text);
      }
    }
    commits.push({ sha, timestamp, date: timestamp.slice(0, 10), subject, added, removed });
  }
  return commits;
}

function stripWikilinkBrackets(line: string): string {
  return line.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_m, target: string) => target);
}

const RELATED_BULLET_RE = /^-\s+\[\[[^\]]+\]\]\s*[-—]/;
const TASK_LINE_RE = /^-\s*\[[ xX]\]/;

/**
 * `removedPool` is this commit's own removed lines for the same file — mutated
 * as pairs are consumed so one removed line cannot back two different added
 * lines. A pairing (stripping the added line's brackets reproduces a line this
 * same commit removed) is exactly what `obsidian__linkify` does: replace a
 * plain mention with the bracketed one, same words.
 */
function classify(file: string, text: string, removedPool: string[]): LineCategory {
  const trimmed = text.trim();
  const stripped = stripWikilinkBrackets(trimmed);
  if (stripped !== trimmed) {
    const idx = removedPool.findIndex((r) => r.trim() === stripped);
    if (idx !== -1) {
      removedPool.splice(idx, 1);
      return "wikilink insertion";
    }
  }
  if (file === "Tasks.md" && TASK_LINE_RE.test(trimmed)) return "task line";
  if (file.startsWith("Syntheses/")) return "synthesis note line";
  if (RELATED_BULLET_RE.test(trimmed)) return "Related bullet";
  return "other";
}

/** ISO-8601 week label, e.g. `2026-W31`. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function aggregate(lines: readonly AddedLine[]): CountStat {
  const added = lines.length;
  const rejected = lines.filter((l) => l.rejected).length;
  return { added, rejected, rate: added ? rejected / added : 0 };
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function computeRejectRate(vaultRoot: string, options: RejectRateOptions = {}): RejectRateReport {
  const windowDays = options.windowDays ?? REJECT_WINDOW_DAYS;
  const gitBinary = options.gitBinary ?? "/usr/bin/git";
  const topFilesLimit = options.topFilesLimit ?? 5;

  const logArgs = ["log", "--reverse", "-p", "--unified=0", `--pretty=format:${RECORD_SEP}%H${FIELD_SEP}%aI${FIELD_SEP}%s`];
  if (options.since) logArgs.push(`--since=${options.since}`);
  const commits = parseLog(git(vaultRoot, gitBinary, logArgs));

  const lines: AddedLine[] = [];
  for (const commit of commits) {
    if (!MACHINE_LABEL_RE.test(commit.subject.trim())) continue;
    for (const [file, addedLines] of commit.added) {
      const removedPool = [...(commit.removed.get(file) ?? [])];
      for (const text of addedLines) {
        lines.push({
          sha: commit.sha,
          timestamp: commit.timestamp,
          date: commit.date,
          file,
          text: text.trim(),
          category: classify(file, text, removedPool),
          rejected: false,
        });
      }
    }
  }

  // A later commit — anyone's — removing the exact line within the window.
  for (const record of lines) {
    const recordTime = new Date(record.timestamp).getTime();
    for (const commit of commits) {
      if (commit.sha === record.sha) continue;
      const deltaDays = (new Date(commit.timestamp).getTime() - recordTime) / 86_400_000;
      if (deltaDays <= 0 || deltaDays > windowDays) continue;
      const removedHere = commit.removed.get(record.file);
      if (removedHere?.some((r) => r.trim() === record.text)) {
        record.rejected = true;
        record.rejectedBy = commit.sha;
        break;
      }
    }
  }

  const byWeek = [...groupBy(lines, (l) => isoWeek(l.date))]
    .map(([week, ls]) => ({ week, ...aggregate(ls) }))
    .sort((a, b) => a.week.localeCompare(b.week));

  const topFiles = [...groupBy(lines, (l) => l.file)]
    .map(([file, ls]) => ({ file, added: ls.length, rejected: ls.filter((l) => l.rejected).length }))
    .filter((f) => f.rejected > 0)
    .sort((a, b) => b.rejected - a.rejected)
    .slice(0, topFilesLimit);

  const byCategory = [...groupBy(lines, (l) => l.category)].map(([category, ls]) => ({
    category: category as LineCategory,
    ...aggregate(ls),
  }));

  return {
    vaultRoot,
    since: options.since,
    windowDays,
    machineCommits: commits.filter((c) => MACHINE_LABEL_RE.test(c.subject.trim())).length,
    overall: aggregate(lines),
    byWeek,
    topFiles,
    byCategory,
    lines,
  };
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatRejectRateMarkdown(report: RejectRateReport): string {
  const out: string[] = [];
  out.push("# Reject rate");
  out.push("");
  out.push(`Vault: \`${report.vaultRoot}\`${report.since ? ` (since ${report.since})` : ""}`);
  out.push(`Machine commits: ${report.machineCommits}. Rejection window: ${report.windowDays} days.`);
  out.push("");
  out.push("| Added | Rejected | Rate |");
  out.push("|---|---|---|");
  out.push(`| ${report.overall.added} | ${report.overall.rejected} | ${pct(report.overall.rate)} |`);
  out.push("");
  out.push("## By week");
  out.push("");
  out.push("| Week | Added | Rejected | Rate |");
  out.push("|---|---|---|---|");
  if (report.byWeek.length === 0) out.push("| (none) | 0 | 0 | 0.0% |");
  for (const w of report.byWeek) out.push(`| ${w.week} | ${w.added} | ${w.rejected} | ${pct(w.rate)} |`);
  out.push("");
  out.push("## Top files by rejections");
  out.push("");
  if (report.topFiles.length === 0) {
    out.push("No file has a rejected line.");
  } else {
    out.push("| File | Rejected | Added |");
    out.push("|---|---|---|");
    for (const f of report.topFiles) out.push(`| ${f.file} | ${f.rejected} | ${f.added} |`);
  }
  out.push("");
  out.push("## Classification breakdown");
  out.push("");
  out.push("| Category | Added | Rejected | Rate |");
  out.push("|---|---|---|---|");
  for (const c of report.byCategory) out.push(`| ${c.category} | ${c.added} | ${c.rejected} | ${pct(c.rate)} |`);
  return out.join("\n") + "\n";
}
