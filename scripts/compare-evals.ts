/**
 * Render a naive-vs-curated comparison from two EvalRun JSON files.
 * Usage: npx tsx scripts/compare-evals.ts <baseline.json> <candidate.json> [out.md]
 */
import { readFile, writeFile } from "node:fs/promises";
import { EvalRun } from "@protocolfoundry/core";
import { renderComparisonReport } from "@protocolfoundry/evals";

const [baselinePath, candidatePath, outPath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  console.error("Usage: compare-evals.ts <baseline.json> <candidate.json> [out.md]");
  process.exit(1);
}

const baseline = EvalRun.parse(JSON.parse(await readFile(baselinePath, "utf8")));
const candidate = EvalRun.parse(JSON.parse(await readFile(candidatePath, "utf8")));
const report = renderComparisonReport(baseline, candidate, {
  baseline: baseline.manifestRef,
  candidate: candidate.manifestRef,
});
console.log(report);
if (outPath) await writeFile(outPath, report, "utf8");
