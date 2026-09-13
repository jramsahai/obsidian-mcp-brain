/**
 * Reproduce the measurement documented in `similar.ts`'s header: score every
 * pair of entries that already coexist in one `### YYYY-MM-DD` block, and
 * every pair of rows in one table, across the vault. `SIMILARITY_THRESHOLD`
 * was chosen from exactly that population, so re-running it after the vault
 * has grown is how the threshold gets checked rather than trusted forever.
 */
import { setConfig, type Config } from "./config.ts";
import { dateBlocks, detectTable, listSections, sectionShape, type Section } from "./sections.ts";
import { excerpt, similarity, SIMILARITY_THRESHOLD } from "./similar.ts";
import { getIndex, invalidateIndex, isTemplate, readNote } from "./vault.ts";

export interface CalibrationPair {
  file: string;
  group: string;
  a: string;
  b: string;
  score: number;
}

export interface CalibrationReport {
  vaultRoot: string;
  threshold: number;
  pairsScored: number;
  aboveThreshold: number;
  aboveThresholdPairs: CalibrationPair[];
  /** The single highest-scoring pair found, whether or not it clears the threshold. */
  topPair: CalibrationPair | null;
  /** The highest score among pairs that stay below the threshold — the genuine ceiling. */
  topGenuinePair: CalibrationPair | null;
  /** threshold - topGenuinePair.score. Positive is headroom; null when there is nothing to compare. */
  gapToThreshold: number | null;
}

interface EntryGroup {
  file: string;
  label: string;
  entries: string[];
}

/**
 * One group per `### YYYY-MM-DD` block and per table-shaped section — the two
 * populations `similar.ts` was calibrated against. `sectionShape` already
 * carries the "dated wins over table" precedence, so a table nested inside one
 * date block is scored once, as part of the block's lines, not twice.
 */
function collectGroups(): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const note of getIndex().notes) {
    if (isTemplate(note)) continue;
    let content: string;
    try {
      ({ content } = readNote(note));
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (const section of listSections(content)) {
      const shape = sectionShape(content, section);
      if (shape === "dated") {
        collectDatedGroups(content, section, lines, note.path, groups);
      } else if (shape === "table") {
        collectTableGroup(content, section, lines, note.path, groups);
      }
    }
  }
  return groups;
}

function collectDatedGroups(
  content: string,
  section: Section,
  lines: string[],
  file: string,
  groups: EntryGroup[],
): void {
  for (const block of dateBlocks(content, section)) {
    const entries = lines.slice(block.headingLine + 1, block.end).filter((l) => l.trim() !== "");
    if (entries.length > 1) groups.push({ file, label: `${section.name} :: ${block.date}`, entries });
  }
}

function collectTableGroup(
  content: string,
  section: Section,
  lines: string[],
  file: string,
  groups: EntryGroup[],
): void {
  const table = detectTable(content, section);
  if (!table) return;
  const rows: string[] = [];
  for (let i = table.headerLine + 2; i < section.end; i++) {
    const line = lines[i];
    if (!line?.trim().startsWith("|")) break;
    rows.push(line);
  }
  if (rows.length > 1) groups.push({ file, label: section.name, entries: rows });
}

export function computeCalibration(vaultRoot: string, options: { timezone?: string } = {}): CalibrationReport {
  const cfg: Config = {
    vaultRoot,
    timezone: options.timezone ?? "America/New_York",
    gitEnabled: false,
    gitBinary: "/usr/bin/git",
  };
  setConfig(cfg);
  invalidateIndex();

  const groups = collectGroups();
  let pairsScored = 0;
  let topPair: CalibrationPair | null = null;
  let topGenuinePair: CalibrationPair | null = null;
  const aboveThresholdPairs: CalibrationPair[] = [];

  for (const group of groups) {
    for (let i = 0; i < group.entries.length; i++) {
      for (let j = i + 1; j < group.entries.length; j++) {
        const score = similarity(group.entries[i], group.entries[j]);
        pairsScored++;
        const pair: CalibrationPair = { file: group.file, group: group.label, a: group.entries[i], b: group.entries[j], score };
        if (!topPair || score > topPair.score) topPair = pair;
        if (score >= SIMILARITY_THRESHOLD) {
          aboveThresholdPairs.push(pair);
        } else if (!topGenuinePair || score > topGenuinePair.score) {
          topGenuinePair = pair;
        }
      }
    }
  }

  aboveThresholdPairs.sort((a, b) => b.score - a.score);

  return {
    vaultRoot,
    threshold: SIMILARITY_THRESHOLD,
    pairsScored,
    aboveThreshold: aboveThresholdPairs.length,
    aboveThresholdPairs,
    topPair,
    topGenuinePair,
    gapToThreshold: topGenuinePair ? SIMILARITY_THRESHOLD - topGenuinePair.score : null,
  };
}

export function formatCalibrationMarkdown(report: CalibrationReport): string {
  const out: string[] = [];
  out.push("# Similarity calibration");
  out.push("");
  out.push(`Vault: \`${report.vaultRoot}\``);
  out.push(`Current threshold: ${report.threshold}`);
  out.push("");
  out.push("| Pairs scored | Above threshold | Top score | Gap to threshold |");
  out.push("|---|---|---|---|");
  const topScore = report.topPair ? report.topPair.score.toFixed(3) : "n/a";
  const gap = report.gapToThreshold !== null ? report.gapToThreshold.toFixed(3) : "n/a";
  out.push(`| ${report.pairsScored} | ${report.aboveThreshold} | ${topScore} | ${gap} |`);
  out.push("");
  out.push("## Highest-scoring pair");
  out.push("");
  if (!report.topPair) {
    out.push("No comparable pairs found.");
  } else {
    out.push(`File: \`${report.topPair.file}\`, section: ${report.topPair.group}, score ${report.topPair.score.toFixed(3)}`);
    out.push("");
    out.push(`- A: ${excerpt(report.topPair.a, 160)}`);
    out.push(`- B: ${excerpt(report.topPair.b, 160)}`);
  }
  if (report.aboveThreshold > 0) {
    out.push("");
    out.push(`## ${report.aboveThreshold} pair(s) at or above the threshold`);
    out.push("");
    out.push("| File | Section | Score |");
    out.push("|---|---|---|");
    for (const p of report.aboveThresholdPairs) out.push(`| ${p.file} | ${p.group} | ${p.score.toFixed(3)} |`);
  }
  return out.join("\n") + "\n";
}
