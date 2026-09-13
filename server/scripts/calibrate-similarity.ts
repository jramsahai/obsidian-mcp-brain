/**
 * Re-run the similarity-threshold measurement documented in `src/similar.ts`
 * against the current vault. See `src/calibrate.ts` for the measurement
 * itself.
 *
 *   npm run calibrate -- [vaultPath] [--json]
 *
 * Vault resolution mirrors lint-vault-docs.ts: an explicit path, then
 * OBSIDIAN_VAULT, then the first OBSIDIAN_VAULT found in openclaw's config.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { computeCalibration, formatCalibrationMarkdown } from "../src/calibrate.ts";

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
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  let vault: string | undefined;
  let json = false;
  for (const a of argv) {
    if (a === "--json") json = true;
    else if (!a.startsWith("--") && vault === undefined) vault = a;
  }
  return { vault, json };
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

const { vault, json } = parseArgs(process.argv.slice(2));
const vaultRoot = resolveVault(vault);

try {
  const report = computeCalibration(vaultRoot, { timezone: process.env.VAULT_TZ });
  console.log(json ? JSON.stringify(report, null, 2) : formatCalibrationMarkdown(report));
} catch (error) {
  console.error(`calibrate failed: ${(error as Error).message}`);
  process.exit(1);
}
