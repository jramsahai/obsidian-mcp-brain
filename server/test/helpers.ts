import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setConfig, type Config } from "../src/config.ts";
import { resetRelateBudget } from "../src/relate.ts";
import { clearWrittenPaths, invalidateIndex } from "../src/vault.ts";
import { TOOLS_BY_NAME } from "../src/tools.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_VAULT = join(here, "fixtures", "vault");

let active: string | null = null;

/** Copy the golden vault to a temp dir so tests can write freely. */
export function useVault(options: { git?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "obsidian-mcp-"));
  const root = join(dir, "vault");
  cpSync(FIXTURE_VAULT, root, { recursive: true });
  const cfg: Config = {
    vaultRoot: root,
    timezone: "America/New_York",
    gitEnabled: options.git ?? false,
    gitBinary: "/usr/bin/git",
  };
  setConfig(cfg);
  invalidateIndex();
  clearWrittenPaths();
  resetRelateBudget();
  active = dir;
  return root;
}

export function cleanupVault(): void {
  if (active) rmSync(active, { recursive: true, force: true });
  active = null;
}

/** Invoke a tool the way the MCP request handler does. */
export function call(name: string, args: Record<string, unknown> = {}): any {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  invalidateIndex();
  return tool.handler(args);
}

export function callFails(name: string, args: Record<string, unknown> = {}): string {
  try {
    call(name, args);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected ${name} to fail, but it succeeded`);
}

export function read(root: string, relPath: string): string {
  return readFileSync(join(root, relPath), "utf8");
}

export function lineOf(content: string, needle: string): string {
  const line = content.split("\n").find((l) => l.includes(needle));
  if (line === undefined) throw new Error(`no line containing "${needle}"`);
  return line;
}
