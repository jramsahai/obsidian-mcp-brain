/**
 * Reject rate for the vault's git history: how often a line an automated pass
 * added gets removed again — per ISO week, by file, and by what kind of line
 * it was. See `src/reject-rate.ts` for the measurement itself.
 *
 *   npm run reject-rate -- [vaultPath] [--since YYYY-MM-DD] [--json]
 *
 * Vault resolution mirrors lint-vault-docs.ts: an explicit path, then
 * OBSIDIAN_VAULT, then the first OBSIDIAN_VAULT found in openclaw's config.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { computeRejectRate, formatRejectRateMarkdown } from "../src/reject-rate.ts";

const OPENCLAW_CONFIG = join(homedir(), ".openclaw", "openclaw.json");

/** First OBSIDIAN_VAULT anywhere in openclaw's config, at any nesting depth. */
function fromOpenclawConfig(): string | null {
  if (!existsSync(OPENCLAW_CONFIG)) return null;
  let root: unknown;
  try {
    root = JSON.parse(readFileSync(OPENCLAW_CONFIG, "utf8"));
  } catch {
    return null;
  }
  const seen = new Set<unknown>();
  const walk = (node: unknown): string | null => {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "OBSIDIAN_VAULT" && typeof value === "string" && value) return value;
      const found = walk(value);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

interface Args {
  vault?: string;
  since?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  let vault: string | undefined;
  let since: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--since") since = argv[++i];
    else if (a.startsWith("--since=")) since = a.slice("--since=".length);
    else if (!a.startsWith("--") && vault === undefined) vault = a;
  }
  return { vault, since, json };
}

function resolveVault(candidate?: string): string {
  const value = candidate || process.env.OBSIDIAN_VAULT || fromOpenclawConfig();
  if (!value) {
    console.error(
      `No vault found. Pass one as an argument, set OBSIDIAN_VAULT, or add it to ${OPENCLAW_CONFIG}.`,
    );
    process.exit(2);
  }
  if (!existsSync(value)) {
    console.error(`Vault path does not exist: ${value}`);
    process.exit(2);
  }
  return value;
}

const { vault, since, json } = parseArgs(process.argv.slice(2));
const vaultRoot = resolveVault(vault);

try {
  const report = computeRejectRate(vaultRoot, {
    since,
    gitBinary: process.env.VAULT_GIT_BIN || "/usr/bin/git",
  });
  console.log(json ? JSON.stringify(report, null, 2) : formatRejectRateMarkdown(report));
} catch (error) {
  console.error(`reject-rate failed: ${(error as Error).message}`);
  process.exit(1);
}
