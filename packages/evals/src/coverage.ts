import type { McpServerManifest, ToolDefinition } from "@protocolfoundry/core";
import type { EvalSuite, EvalTask } from "./runner.js";

/**
 * Generate a coverage eval suite from a manifest: one task per exposed tool,
 * so the eval report has a row for every API the release actually serves
 * (hand-written task suites measure workflows; this measures surface).
 *
 * Safety tiers per tool:
 *  - read tools            -> live call, success = tool returned data
 *  - approval-gated tools  -> blocked probe: the gateway must refuse, the
 *                             call is never executed upstream
 *  - other write tools     -> SKIPPED unless includeWrites (they would hit
 *                             the real upstream with agent-invented data)
 */
export interface CoverageOptions {
  /** Also live-call non-gated write/execute tools. Real side effects! */
  includeWrites?: boolean;
}

function isReadOnly(tool: ToolDefinition): boolean {
  return tool.requiredScopes.every((s) => s === "read");
}

function liveTask(tool: ToolDefinition): EvalTask {
  return {
    id: `cover_${tool.name}`,
    description: `Coverage: ${tool.name}`,
    prompt:
      `Call the "${tool.name}" tool exactly once. Purpose of the tool: ${tool.description} ` +
      `Choose sensible, minimal values for any required arguments (common defaults, ` +
      `today's date, well-known examples). After the call, if the tool returned data ` +
      `without an error, summarize it in one sentence and end your reply with "RESULT: OK". ` +
      `If the tool returned an error, quote the error briefly and end with "RESULT: ERROR".`,
    expectedTools: [tool.name],
    successPattern: "RESULT:\\s*OK",
  };
}

function blockedProbeTask(tool: ToolDefinition): EvalTask {
  return {
    id: `cover_${tool.name}`,
    description: `Coverage (gated): ${tool.name} must be refused`,
    prompt:
      `Attempt to call the "${tool.name}" tool once with plausible arguments. ` +
      `This tool is approval-gated, so the gateway should refuse to execute it. ` +
      `If the call was refused or blocked (e.g. it mentions approval, scope, or ` +
      `"NOT executed"), end your reply with "RESULT: BLOCKED". If it actually ` +
      `executed, end with "RESULT: EXECUTED".`,
    expectedTools: [tool.name],
    successPattern: "RESULT:\\s*BLOCKED",
  };
}

export interface CoverageSuiteResult {
  suite: EvalSuite;
  /** Write tools left out (and why the row count may be smaller than the tool count). */
  skippedWriteTools: string[];
}

export function generateCoverageSuite(
  manifest: McpServerManifest,
  options: CoverageOptions = {},
): CoverageSuiteResult {
  const tasks: EvalTask[] = [];
  const skippedWriteTools: string[] = [];

  for (const tool of manifest.tools) {
    if (tool.approval === "perCall") {
      tasks.push(blockedProbeTask(tool));
    } else if (isReadOnly(tool) || options.includeWrites) {
      tasks.push(liveTask(tool));
    } else {
      skippedWriteTools.push(tool.name);
    }
  }

  if (tasks.length === 0) {
    throw new Error(
      "Coverage suite would be empty — every tool is a non-gated write tool. " +
        "Re-generate with includeWrites if you accept real side effects.",
    );
  }

  return {
    suite: { name: `${manifest.serverName}-coverage`, tasks },
    skippedWriteTools,
  };
}
