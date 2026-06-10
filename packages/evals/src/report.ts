import type { EvalRun } from "@protocolfoundry/core";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Render an EvalRun as the customer-facing markdown report artifact. */
export function renderEvalReport(run: EvalRun, title?: string): string {
  const lines: string[] = [];
  lines.push(`# Agent-usability eval${title ? `: ${title}` : ""}`);
  lines.push("");
  lines.push(`- **Manifest:** ${run.manifestRef}`);
  lines.push(`- **Agent model:** ${run.agentModel}`);
  lines.push(`- **Ran at:** ${run.ranAt}`);
  lines.push("");
  lines.push(`## Scores`);
  lines.push("");
  lines.push(`| Metric | Score |`);
  lines.push(`|---|---|`);
  lines.push(`| Task completion | **${pct(run.taskCompletionRate)}** |`);
  lines.push(`| Tool-selection accuracy | **${pct(run.toolSelectionAccuracy)}** |`);
  lines.push("");
  lines.push(`## Tasks`);
  lines.push("");
  lines.push(`| Task | Completed | Right tools | Steps | Tokens (in/out) | Failure |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of run.results) {
    lines.push(
      `| ${r.description} | ${r.completed ? "✅" : "❌"} | ${r.toolSelectionCorrect ? "✅" : "❌"} | ${r.steps} | ${r.inputTokens}/${r.outputTokens} | ${r.failureReason ?? ""} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Compare two runs (e.g. naive vs curated manifest) side by side. */
export function renderComparisonReport(
  baseline: EvalRun,
  candidate: EvalRun,
  labels: { baseline: string; candidate: string },
): string {
  const delta = (a: number, b: number) => {
    const d = Math.round((b - a) * 100);
    return d === 0 ? "±0pp" : d > 0 ? `+${d}pp` : `${d}pp`;
  };
  const tokens = (run: EvalRun) =>
    run.results.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
  return [
    `# Eval comparison: ${labels.baseline} vs ${labels.candidate}`,
    "",
    `| Metric | ${labels.baseline} | ${labels.candidate} | Δ |`,
    `|---|---|---|---|`,
    `| Task completion | ${pct(baseline.taskCompletionRate)} | ${pct(candidate.taskCompletionRate)} | ${delta(baseline.taskCompletionRate, candidate.taskCompletionRate)} |`,
    `| Tool-selection accuracy | ${pct(baseline.toolSelectionAccuracy)} | ${pct(candidate.toolSelectionAccuracy)} | ${delta(baseline.toolSelectionAccuracy, candidate.toolSelectionAccuracy)} |`,
    `| Total tokens | ${tokens(baseline)} | ${tokens(candidate)} | ${tokens(candidate) - tokens(baseline)} |`,
    "",
  ].join("\n");
}
