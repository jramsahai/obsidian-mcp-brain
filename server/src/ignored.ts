import { existsSync, writeFileSync } from "node:fs";
import { today } from "./config.ts";
import { detectTable, findSection, splitRow } from "./sections.ts";
import { absolutePath, getIndex, invalidateIndex, readNote, recordWrite } from "./vault.ts";

/**
 * The retired-candidate list.
 *
 * Some names in the vault are never going to be notes: an operating system the
 * user runs, the card names inside a Magic deck description. The nightly had no
 * way to record that, so it re-proposed the same twelve candidates every run and
 * its own reports were the evidence that kept them alive.
 *
 * Deciding a name is not worth a note is judgment and stays with the model and
 * the user. Remembering the decision is mechanism and lives here.
 */
export const IGNORED_FILE = "Ignored Links.md";
export const IGNORED_SECTION = "Ignored";

export interface IgnoredRow {
  target: string;
  reason: string;
  since: string;
}

/**
 * Targets are stored as plain text, never `[[wikilinks]]`, and so are reasons.
 * A bracketed name here would be a real unresolved link, which would make the
 * ignore list re-create the exact problem it exists to solve.
 */
export function plainText(value: string): string {
  return value
    .replace(/\[\[([^\][\n]+)\]\]/g, (_, inner: string) => inner.split("|").pop()!.trim())
    .replace(/\s+/g, " ")
    .replace(/\|/g, "/")
    .trim();
}

/** The note as it is first written. Sections match what `link_ignore` appends to. */
export function initialContent(date: string = today()): string {
  return [
    "---",
    "type: index",
    `created: ${date}`,
    "---",
    "",
    "# Ignored Links",
    "",
    "Names deliberately left uncreated — the nightly stops proposing them.",
    "Delete a row to reconsider one; nothing here is written back by the server.",
    "",
    `## ${IGNORED_SECTION}`,
    "",
    "| Target | Reason | Since |",
    "| --- | --- | --- |",
    "",
  ].join("\n");
}

/**
 * Create the list on first use. The server owns this file's shape the way it
 * owns Standup.md's, so it is written rather than requested from the model.
 */
export function ensureIgnoreList(): void {
  const full = absolutePath(IGNORED_FILE);
  if (existsSync(full)) return;
  writeFileSync(full, initialContent(), "utf8");
  recordWrite(IGNORED_FILE);
  invalidateIndex();
}

export function ignoredRows(): IgnoredRow[] {
  // Looked up by exact path rather than by title: the list is a fixed file the
  // server owns, and a title lookup could be answered by some other note.
  const note = getIndex().byPath.get(IGNORED_FILE.normalize("NFC").toLowerCase());
  if (!note) return [];
  const { content } = readNote(note);
  const section = findSection(content, IGNORED_SECTION);
  if (!section) return [];
  const table = detectTable(content, section);
  if (!table) return [];
  const lines = content.split("\n");
  const rows: IgnoredRow[] = [];
  // headerLine + 1 is the `| --- |` divider; data starts after it.
  for (let i = table.headerLine + 2; i < section.end; i++) {
    const line = lines[i];
    if (!line?.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    const target = (cells[0] ?? "").trim();
    if (!target) continue;
    rows.push({ target, reason: (cells[1] ?? "").trim(), since: (cells[2] ?? "").trim() });
  }
  return rows;
}

/** Lowercased targets, for case-insensitive comparison against link text. */
export function ignoredTargets(): Set<string> {
  return new Set(ignoredRows().map((r) => r.target.toLowerCase()));
}
