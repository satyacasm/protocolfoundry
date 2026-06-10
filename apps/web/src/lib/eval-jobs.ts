import type { Server } from "node:http";
import type { AuditSink } from "@protocolfoundry/audit";
import {
  createAnthropicAgent,
  runEvalSuite,
  type AgentModel,
  type EvalSuite,
} from "@protocolfoundry/evals";
import { createCredentialResolver, createGatewayApp } from "@protocolfoundry/gateway";
import type { ReleaseStore } from "@protocolfoundry/releases";
import { createVaultFromEnv } from "@protocolfoundry/vault";
import { auditStore, store } from "./data";
import { getSuite, saveEvalJob, type EvalJobState } from "./workspace";

/**
 * Dashboard-triggered eval runs. The job serves the release's manifest on an
 * ephemeral loopback-only gateway (vault-aware credentials, same executor the
 * real gateway uses), runs the project's eval suite against it with the
 * Anthropic agent, and attaches the resulting EvalRun to the release.
 *
 * Runs in-process in the Next server (single-operator deployment): the server
 * action fires the job and returns; progress is persisted to the workspace
 * after every task so page refreshes show it. One job per project at a time.
 * A real queue replaces this at multi-tenant (the API surface won't change:
 * suite in workspace, EvalRun on the release).
 */

const runningJobs: Set<string> = ((globalThis as Record<string, unknown>)["__pfEvalJobs"] ??=
  new Set<string>()) as Set<string>;

export function isEvalRunning(projectId: string): boolean {
  return runningJobs.has(projectId);
}

export interface StartEvalOptions {
  model?: string;
  /** Test seams — default to the shared stores and the real Anthropic agent. */
  agent?: AgentModel;
  releaseStore?: ReleaseStore;
  audit?: AuditSink;
  suite?: EvalSuite;
}

export interface StartedEvalJob {
  state: EvalJobState;
  /** Resolves when the job finishes (the server action does not await it). */
  done: Promise<EvalJobState>;
}

export async function startEvalJob(
  projectId: string,
  version: number,
  actor: string,
  options: StartEvalOptions = {},
): Promise<StartedEvalJob> {
  const releases = options.releaseStore ?? store;
  const audit = options.audit ?? auditStore;

  if (runningJobs.has(projectId)) {
    throw new Error(`An eval is already running for "${projectId}"`);
  }
  if (!options.agent && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set on the dashboard server — evals need it");
  }

  const suite = options.suite ?? (await getSuite(projectId));
  if (!suite) {
    throw new Error("No eval suite uploaded for this project — add one in the Evals section");
  }
  const release = (await releases.list(projectId)).find((r) => r.version === version);
  if (!release) throw new Error(`No release v${version} for project "${projectId}"`);
  const manifest = await releases.getManifest(projectId, version);

  const agent = options.agent ?? createAnthropicAgent(options.model);
  const state: EvalJobState = {
    projectId,
    version,
    suiteName: suite.name,
    agentModel: agent.model,
    status: "running",
    completedTasks: 0,
    totalTasks: suite.tasks.length,
    startedAt: new Date().toISOString(),
  };
  runningJobs.add(projectId);
  await saveEvalJob(state);

  const done = (async (): Promise<EvalJobState> => {
    let server: Server | undefined;
    try {
      // Loopback-only, unauthenticated by design: the port is random, bound
      // to 127.0.0.1, and lives only for the duration of the run.
      const app = createGatewayApp([manifest], {
        audit,
        resolveCredential: createCredentialResolver(createVaultFromEnv()),
      });
      const port = await new Promise<number>((resolve, reject) => {
        server = app.listen(0, "127.0.0.1", () => {
          const address = server?.address();
          if (address && typeof address === "object") resolve(address.port);
          else reject(new Error("Ephemeral gateway failed to bind"));
        });
        server.on("error", reject);
      });

      const evalRun = await runEvalSuite(
        suite,
        { url: `http://127.0.0.1:${port}/mcp/${manifest.serverName}` },
        agent,
        release.manifestRef,
        projectId,
        {
          onTaskComplete: (completed) => {
            state.completedTasks = completed;
            void saveEvalJob(state);
          },
        },
      );

      await releases.attachEvalRun(projectId, version, evalRun);
      state.status = "succeeded";
      state.evalRunId = evalRun.id;
      state.finishedAt = new Date().toISOString();
      await saveEvalJob(state);
      await audit.record({
        projectId,
        kind: "evalCompleted",
        actor: { type: "user", id: actor },
        detail: {
          version,
          suite: suite.name,
          agentModel: agent.model,
          taskCompletionRate: evalRun.taskCompletionRate,
          toolSelectionAccuracy: evalRun.toolSelectionAccuracy,
          tasks: evalRun.results.length,
        },
      });
      return state;
    } catch (error) {
      state.status = "failed";
      state.error = error instanceof Error ? error.message : String(error);
      state.finishedAt = new Date().toISOString();
      await saveEvalJob(state);
      return state;
    } finally {
      runningJobs.delete(projectId);
      server?.close();
    }
  })();

  return { state, done };
}
