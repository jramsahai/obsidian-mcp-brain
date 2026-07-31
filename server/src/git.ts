import { execFileSync } from "node:child_process";
import { config, ToolError } from "./config.ts";

/**
 * Git runs inside this process via execFile — argv only, no shell. It never
 * touches OpenClaw's exec approval path, which is the whole reason the vault's
 * git snapshots stopped completing.
 */
function git(args: string[]): string {
  const cfg = config();
  try {
    return execFileSync(cfg.gitBinary, ["-C", cfg.vaultRoot, ...args], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new ToolError(`git ${args[0]} failed: ${(err.stderr || err.message || "").trim()}`);
  }
}

export function gitAvailable(): boolean {
  if (!config().gitEnabled) return false;
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Why git is unusable, in a sentence the model can act on — or null when it
 * works. `git_dirty: null` alone read exactly like a healthy clean vault, so a
 * broken git was invisible until vault_snapshot threw git's own fatal text
 * hours later, in the middle of an unattended run.
 */
export function gitDiagnosis(): string | null {
  const cfg = config();
  if (!cfg.gitEnabled) return null;
  if (gitAvailable()) return null;
  return `git is enabled (VAULT_GIT=1) but unusable: "${cfg.vaultRoot}" is not a git repository, or the binary at VAULT_GIT_BIN="${cfg.gitBinary}" is missing. Snapshots will fail until this is fixed.`;
}

/**
 * `-uall` lists files inside a new directory individually. Without it an entire
 * untracked folder collapses to one `?? dir/` entry, so a pass that created
 * three notes in two new folders reported "1 file changed" — the number that is
 * supposed to make the pass reviewable was wrong precisely when it did most.
 */
export function statusPorcelain(paths: string[] = []): string[] {
  const args = ["status", "--porcelain", "-uall"];
  if (paths.length) args.push("--", ...paths);
  return git(args).split("\n").filter(Boolean);
}

export function isDirty(): boolean {
  return statusPorcelain().length > 0;
}

export interface SnapshotResult {
  committed: boolean;
  sha?: string;
  files_changed: number;
  message: string;
}

/**
 * Stage and commit. A clean tree is success, not an error.
 *
 * `paths` scopes the commit to what this server actually wrote. Staging the
 * whole worktree swept in whatever the user had uncommitted in Obsidian —
 * including deletions — so reverting a bad machine pass also discarded the
 * user's own work, and "one reviewable commit per pass" was not true.
 */
export function snapshot(label: string, paths?: string[]): SnapshotResult {
  const cfg = config();
  if (!cfg.gitEnabled) {
    throw new ToolError("git snapshots are disabled; set VAULT_GIT=1 in the server env to enable.");
  }
  const broken = gitDiagnosis();
  if (broken) throw new ToolError(broken);

  const scoped = paths !== undefined;
  if (scoped && paths!.length === 0) {
    return {
      committed: false,
      files_changed: 0,
      message: "nothing to commit — this server has written no notes since the last snapshot",
    };
  }
  const dirty = statusPorcelain(scoped ? paths! : []);
  if (dirty.length === 0) {
    return { committed: false, files_changed: 0, message: "nothing to commit — vault already clean" };
  }
  git(scoped ? ["add", "-A", "--", ...paths!] : ["add", "-A"]);
  git(["commit", "-m", label]);
  const sha = git(["rev-parse", "--short", "HEAD"]);
  return {
    committed: true,
    sha,
    files_changed: dirty.length,
    message: `committed ${dirty.length} file(s) as ${sha}`,
  };
}

export function changedSince(since: string): string[] {
  return git(["log", `--since=${since}`, "--name-only", "--pretty=format:"])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}
