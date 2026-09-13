import { existsSync, writeFileSync } from "node:fs";
import { today } from "./config.ts";
import { detectTable, findSection, splitRow } from "./sections.ts";
import { absolutePath, getIndex, invalidateIndex, readNote, recordWrite } from "./vault.ts";

/**
 * The corrections log.
 *
 * When the user corrects the agent, the fix lands in the vault but the lesson
 * that produced it does not — nothing records that a skill was corrected, on
 * what, or why. This file is the mechanism half: a root-level table the model
 * appends one row to per correction, so patterns can be counted later without
 * re-reading every conversation.
 */
export const CORRECTIONS_FILE = "Corrections.md";
export const CORRECTIONS_SECTION = "Log";

export interface CorrectionRow {
  date: string;
  skill: string;
  did: string;
  wanted: string;
  rule: string;
}

/** The note as it is first written. Sections match what `correction_log` appends to. */
export function initialContent(date: string = today()): string {
  return [
    "---",
    "type: index",
    `created: ${date}`,
    "---",
    "",
    "# Corrections",
    "",
    "Corrections the user made to the agent's work, kept so patterns can be counted later.",
    "",
    `## ${CORRECTIONS_SECTION}`,
    "",
    "| Date | Skill | What happened | What was wanted | Rule |",
    "| --- | --- | --- | --- | --- |",
    "",
  ].join("\n");
}

/**
 * Create the log on first use. The server owns this file's shape the way it
 * owns Ignored Links.md's, so it is written rather than requested from the
 * model.
 */
export function ensureCorrectionsLog(): void {
  const full = absolutePath(CORRECTIONS_FILE);
  if (existsSync(full)) return;
  writeFileSync(full, initialContent(), "utf8");
  recordWrite(CORRECTIONS_FILE);
  invalidateIndex();
}

export function correctionRows(): CorrectionRow[] {
  // Looked up by exact path rather than by title, for the same reason as the
  // ignore list: this is a fixed file the server owns.
  const note = getIndex().byPath.get(CORRECTIONS_FILE.normalize("NFC").toLowerCase());
  if (!note) return [];
  const { content } = readNote(note);
  const section = findSection(content, CORRECTIONS_SECTION);
  if (!section) return [];
  const table = detectTable(content, section);
  if (!table) return [];
  const lines = content.split("\n");
  const rows: CorrectionRow[] = [];
  // headerLine + 1 is the `| --- |` divider; data starts after it.
  for (let i = table.headerLine + 2; i < section.end; i++) {
    const line = lines[i];
    if (!line?.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    const date = (cells[0] ?? "").trim();
    if (!date) continue;
    rows.push({
      date,
      skill: (cells[1] ?? "").trim(),
      did: (cells[2] ?? "").trim(),
      wanted: (cells[3] ?? "").trim(),
      rule: (cells[4] ?? "").trim(),
    });
  }
  return rows;
}
