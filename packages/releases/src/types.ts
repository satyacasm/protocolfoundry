import type { EvalRun, McpServerManifest, Release } from "@protocolfoundry/core";

/** Quality bar a release must meet when an eval gate is enforced. */
export interface ReleaseGate {
  minTaskCompletionRate: number;
  minToolSelectionAccuracy: number;
}

export interface CreateReleaseOptions {
  /** The eval run backing this release (stored alongside the manifest). */
  evalRun?: EvalRun;
  /** If set, the evalRun must exist and meet the bar — or force must be true. */
  gate?: ReleaseGate;
  /** Human who approved the release (audit trail). */
  approvedBy?: string;
  /** Explicit human override of a failing/missing gate. Requires approvedBy. */
  force?: boolean;
}

export class ReleaseGateError extends Error {}

/**
 * Control-plane release storage. Implemented by FileReleaseStore (zero-infra,
 * single operator) and PgReleaseStore (Postgres, multi-user) — ADR-0005/0006.
 */
export interface ReleaseStore {
  listProjects(): Promise<string[]>;
  list(projectId: string): Promise<Release[]>;
  createRelease(
    manifest: McpServerManifest,
    options?: CreateReleaseOptions,
  ): Promise<Release>;
  promote(projectId: string, version: number): Promise<Release>;
  rollback(projectId: string): Promise<Release>;
  getLive(
    projectId: string,
  ): Promise<{ release: Release; manifest: McpServerManifest } | undefined>;
  getManifest(projectId: string, version: number): Promise<McpServerManifest>;
  getEvalRun(projectId: string, version: number): Promise<EvalRun | undefined>;
  /**
   * Attach (or replace) the eval run for an existing release — the
   * dashboard's "run eval now" path. The manifest stays immutable; the eval
   * is evidence about it and re-runs may update it.
   */
  attachEvalRun(projectId: string, version: number, evalRun: EvalRun): Promise<Release>;
  /**
   * Optional cheap change indicator for a project (e.g. index file mtime).
   * Sources use it to skip reloads; absence means reload on cache expiry.
   */
  changeStamp?(projectId: string): Promise<string | number | undefined>;
}

/** Shared gate enforcement — identical semantics across store backends. */
export function assertReleaseGate(options: CreateReleaseOptions): void {
  const { evalRun, gate, approvedBy, force } = options;
  if (force && !approvedBy) {
    throw new ReleaseGateError("force requires approvedBy — gate overrides must be attributable");
  }
  if (!gate || force) return;
  if (!evalRun) {
    throw new ReleaseGateError(
      "Release gate is set but no eval run was provided — run pf eval first, or use force with explicit approval",
    );
  }
  const failures: string[] = [];
  if (evalRun.taskCompletionRate < gate.minTaskCompletionRate) {
    failures.push(
      `task completion ${Math.round(evalRun.taskCompletionRate * 100)}% < required ${Math.round(gate.minTaskCompletionRate * 100)}%`,
    );
  }
  if (evalRun.toolSelectionAccuracy < gate.minToolSelectionAccuracy) {
    failures.push(
      `tool-selection accuracy ${Math.round(evalRun.toolSelectionAccuracy * 100)}% < required ${Math.round(gate.minToolSelectionAccuracy * 100)}%`,
    );
  }
  if (failures.length > 0) {
    throw new ReleaseGateError(`Eval gate failed: ${failures.join("; ")}`);
  }
}
