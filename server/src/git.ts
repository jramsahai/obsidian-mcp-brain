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

export function statusPorcelain(): string[] {
  return git(["status", "--porcelain"]).split("\n").filter(Boolean);
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

/** `git add -A` + commit. A clean tree is success, not an error. */
export function snapshot(label: string): SnapshotResult {
  if (!config().gitEnabled) {
    throw new ToolError("git snapshots are disabled; set VAULT_GIT=1 in the server env to enable.");
  }
  const dirty = statusPorcelain();
  if (dirty.length === 0) {
    return { committed: false, files_changed: 0, message: "nothing to commit — vault already clean" };
  }
  git(["add", "-A"]);
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
