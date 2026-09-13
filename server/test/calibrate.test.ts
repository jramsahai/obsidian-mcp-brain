import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { computeCalibration, formatCalibrationMarkdown } from "../src/calibrate.ts";
import { cleanupVault, useVault } from "./helpers.ts";

describe("computeCalibration", () => {
  test("runs on the fixture vault and reports zero pairs above threshold", () => {
    const root = useVault();
    const report = computeCalibration(root);
    try {
      assert.equal(report.aboveThreshold, 0);
      assert.deepEqual(report.aboveThresholdPairs, []);
      assert.equal(report.threshold, 0.65);
      assert.ok(report.pairsScored >= 0);
    } finally {
      cleanupVault();
    }
  });

  test("scores a dated-block pair and a table-row pair without flagging either", () => {
    const root = useVault();
    try {
      writeFileSync(
        join(root, "Test Calibration.md"),
        [
          "---",
          "type: doc",
          "created: 2026-08-05",
          "---",
          "",
          "# Test Calibration",
          "",
          "## Review Log",
          "",
          "### 2026-08-05",
          "",
          "- Routed 3 inbox items and reviewed pending tasks for the week",
          "- Routed 2 inbox items and checked overdue tasks for the sprint",
          "",
          "## Conversation Log",
          "",
          "| Date | Who | Summary |",
          "| --- | --- | --- |",
          "| 2026-07-15 | Jane Doe | Confirmed the vendor contract renewal date |",
          "| 2026-07-15 | Alex Rivera | Complained that the office coffee machine is broken |",
          "",
        ].join("\n"),
      );

      const report = computeCalibration(root);
      assert.equal(report.pairsScored, 2, "one dated-block pair and one table-row pair");
      assert.equal(report.aboveThreshold, 0);
      assert.ok(report.topPair, "expected a top pair");
      assert.ok(report.topPair!.score > 0 && report.topPair!.score < report.threshold);
      assert.ok(report.topGenuinePair, "expected a genuine top pair");
      assert.ok(report.gapToThreshold !== null && report.gapToThreshold > 0);

      const groups = new Set(report.aboveThresholdPairs.map((p) => p.group));
      assert.equal(groups.size, 0);

      const markdown = formatCalibrationMarkdown(report);
      assert.match(markdown, /Similarity calibration/);
      assert.match(markdown, /Pairs scored/);
    } finally {
      cleanupVault();
    }
  });
});
