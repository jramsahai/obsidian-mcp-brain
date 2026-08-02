/**
 * Check every SKILL.md against the shapes of the sections it names.
 *
 * An operator check, not CI — deliberately. The vault is not in the repo, and
 * OBSIDIAN_VAULT lives in openclaw's MCP env block rather than the shell, so a
 * test gated on it would skip on every run and report green. That is exactly
 * how the original drift lint became meaningless: it only inspected lines that
 * already named a tool, so the six skills naming none were invisible to it.
 * A check that cannot fail is worse than no check, because it is believed.
 *
 *   npm run lint:vault            # resolves the vault automatically
 *   npm run lint:vault -- <path>  # or point it at one
 *
 * Exits 1 when the docs and the vault disagree.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setConfig, type Config } from "../src/config.ts";
import {
  lintDocAgainstVault,
  lintVaultAgainstDocs,
  type DatedSectionUse,
  type ShapeResolver,
} from "../src/doc-lint.ts";
import { findSection, listSections, sectionShape } from "../src/sections.ts";
import { getIndex, invalidateIndex, isTemplate, readNote, resolveNote } from "../src/vault.ts";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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

function resolveVault(): string {
  const candidate = process.argv[2] || process.env.OBSIDIAN_VAULT || fromOpenclawConfig();
  if (!candidate) {
    console.error(
      `No vault found. Pass one as an argument, set OBSIDIAN_VAULT, or add it to ${OPENCLAW_CONFIG}.`,
    );
    process.exit(2);
  }
  if (!existsSync(candidate)) {
    console.error(`Vault path does not exist: ${candidate}`);
    process.exit(2);
  }
  return candidate;
}

const vaultRoot = resolveVault();
const cfg: Config = {
  vaultRoot,
  timezone: process.env.VAULT_TZ || "America/New_York",
  gitEnabled: false,
  gitBinary: "/usr/bin/git",
};
setConfig(cfg);
invalidateIndex();

const shapeOf: ShapeResolver = (noteRef, sectionName) => {
  try {
    const { content } = readNote(resolveNote(noteRef));
    const section = findSection(content, sectionName);
    return section ? sectionShape(content, section) : null;
  } catch {
    // An unresolvable note is not drift — the docs may name an example.
    return null;
  }
};

const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "server" && !e.name.startsWith("."))
  .map((e) => join(e.name, "SKILL.md"))
  .filter((rel) => existsSync(join(SKILLS_DIR, rel)))
  .map((rel) => ({ file: rel, content: readFileSync(join(SKILLS_DIR, rel), "utf8") }));

let total = 0;

// Direction one: a doc naming the wrong tool for a section's real shape.
const forward = skills
  .map((skill) => ({ skill, problems: lintDocAgainstVault(skill.content, shapeOf) }))
  .filter((r) => r.problems.length > 0);
if (forward.length) {
  console.error("\nDocs that contradict the vault");
  for (const { skill, problems } of forward) {
    console.error(`\n  ${skill.file}`);
    for (const problem of problems) {
      console.error(`    line ${problem.line}: ${problem.call}`);
      console.error(`      ${problem.message}`);
    }
    total += problems.length;
  }
}

/**
 * Every dated section in the vault, by name. Templates are excluded because a
 * template's `### YYYY-MM-DD` is a placeholder rather than a log, and `doc`
 * notes because note_create deliberately gives them no section skeleton —
 * a dated block inside a research doc is prose, not a convention to document.
 */
function datedSections(): DatedSectionUse[] {
  const found = new Map<string, string[]>();
  for (const note of getIndex().notes) {
    if (isTemplate(note) || note.type === "doc") continue;
    let content: string;
    try {
      ({ content } = readNote(note));
    } catch {
      continue;
    }
    for (const section of listSections(content)) {
      if (section.level !== 2) continue;
      if (sectionShape(content, section) !== "dated") continue;
      if (!found.has(section.name)) found.set(section.name, []);
      found.get(section.name)!.push(note.path);
    }
  }
  return [...found.entries()].map(([name, notes]) => ({ name, notes }));
}

// Direction two: a dated section no skill tells the model how to write to.
const sections = datedSections();
const reverse = lintVaultAgainstDocs(sections, skills);
if (reverse.length) {
  console.error("\nDated sections no skill documents");
  for (const problem of reverse) {
    console.error(`\n  ## ${problem.section}  (${problem.notes.length} notes)`);
    console.error(`    ${problem.message}`);
  }
  total += reverse.length;
}

console.error(
  total === 0
    ? `\nlint:vault — ${skills.length} skills and ${sections.length} dated section${
        sections.length === 1 ? "" : "s"
      } checked against ${vaultRoot}, no drift.`
    : `\n${total} problem${total === 1 ? "" : "s"}`,
);
process.exit(total === 0 ? 0 : 1);
