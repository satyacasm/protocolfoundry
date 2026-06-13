import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import { join } from "node:path";
import type { AuditStore } from "@protocolfoundry/audit";
import type { ReleaseStore } from "@protocolfoundry/releases";
import { createCredentialResolver, createGatewayApp } from "@protocolfoundry/gateway";
import { createVaultFromEnv } from "@protocolfoundry/vault";
import {
  createAnthropicAgent,
  runEvalSuite,
  type AgentModel,
} from "@protocolfoundry/evals";
import { getEvalSuite, projectWorkspaceDir } from "./workspace";

/**
 * Dashboard eval runs (ADR-0008). An eval job hosts a STAGED release's
 * manifest on an ephemeral loopback gateway (one-time key, same credential
 * resolution and audit sink as the real gateway — tool calls hit the real
 * upstream and are audited), runs the project's eval suite with a real agent
 * loop, and attaches the resulting EvalRun to the release.
 *
 * Job records are files in the forge workspace —
 * workspace/<projectId>/jobs/eval-v<N>.json, one per release version,
 * replaced on re-run. Execution is in-process (the dashboard is a
 * single-operator, single-process Node server; a real queue arrives with
 * multi-tenancy).
 */

export interface EvalJob {
  id: string;
  projectId: string;
  version: number;
  suiteName: string;
  agentModel: string;
  status: "running" | "succeeded" | "failed";
  totalTasks: number;
  completedTasks: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  evalRunId?: string;
}

export interface EvalJobDeps {
  store: ReleaseStore;
  audit: AuditStore;
  projectId: string;
  version: number;
  /** Who triggered the run (audit attribution). */
  actorId: string;
  /** Injectable for tests; defaults to the real Anthropic agent loop. */
  agent?: AgentModel;
  /** Friendly model alias or full model ID; defaults to haiku. */
  model?: string;
}

function jobPath(projectId: string, version: number): string {
  return join(projectWorkspaceDir(projectId), "jobs", `eval-v${version}.json`);
}

async function writeJob(job: EvalJob): Promise<void> {
  const path = jobPath(job.projectId, job.version);
  await mkdir(join(projectWorkspaceDir(job.projectId), "jobs"), { recursive: true });
  await writeFile(path, JSON.stringify(job, null, 2), "utf8");
}

export async function readEvalJob(
  projectId: string,
  version: number,
): Promise<EvalJob | undefined> {
  try {
    return JSON.parse(await readFile(jobPath(projectId, version), "utf8")) as EvalJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** In-process double-launch guard (single dashboard process). */
const active = new Set<string>();

export function isEvalRunning(projectId: string, version: number): boolean {
  return active.has(`${projectId}:v${version}`);
}

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

/**
 * Validate everything that can fail fast, write the "running" job record,
 * and return — `run` is the long part, for the caller to schedule (the
 * server action runs it via next/server `after`, tests await it directly).
 */
export async function startEvalJob(
  deps: EvalJobDeps,
): Promise<{ job: EvalJob; run: () => Promise<void> }> {
  const { store, audit, projectId, version, actorId } = deps;
  const key = `${projectId}:v${version}`;
  if (active.has(key)) {
    throw new Error(`An eval for ${projectId} v${version} is already running`);
  }

  const suite = await getEvalSuite(projectId);
  if (!suite) {
    throw new Error("No eval suite for this project — upload one first");
  }
  const release = (await store.list(projectId)).find((r) => r.version === version);
  if (!release) throw new Error(`No release v${version} for project "${projectId}"`);
  if (release.status !== "staged" && release.status !== "live") {
    throw new Error(
      `Release v${version} is "${release.status}" — evals run on staged or live releases`,
    );
  }
  const manifest = await store.getManifest(projectId, version);
  const agent = deps.agent ?? createAnthropicAgent(deps.model);

  const job: EvalJob = {
    id: randomUUID(),
    projectId,
    version,
    suiteName: suite.name,
    agentModel: agent.model,
    status: "running",
    totalTasks: suite.tasks.length,
    completedTasks: 0,
    startedAt: new Date().toISOString(),
  };
  active.add(key);
  try {
    await writeJob(job);
  } catch (error) {
    active.delete(key);
    throw error;
  }

  const run = async (): Promise<void> => {
    // One-time inbound key: the loopback endpoint exists only for this run.
    const oneTimeKey = randomUUID();
    let gateway: HttpServer | undefined;
    try {
      const app = createGatewayApp([manifest], {
        audit,
        resolveCredential: createCredentialResolver(createVaultFromEnv()),
        apiKey: oneTimeKey,
      });
      gateway = app.listen(0, "127.0.0.1");
      const port = await listen(gateway);
      const endpoint = {
        url: `http://127.0.0.1:${port}/mcp/${manifest.serverName}`,
        apiKey: oneTimeKey,
      };

      const evalRun = await runEvalSuite(
        suite,
        endpoint,
        agent,
        release.manifestRef,
        projectId,
        {
          onResult: async (_result, completed) => {
            job.completedTasks = completed;
            await writeJob(job);
          },
        },
      );

      await store.attachEvalRun(projectId, version, evalRun);
      job.status = "succeeded";
      job.evalRunId = evalRun.id;
      job.completedTasks = job.totalTasks;
      job.finishedAt = new Date().toISOString();
      await writeJob(job);
      await audit.record({
        projectId,
        kind: "evalCompleted",
        actor: { type: "user", id: actorId },
        detail: {
          version,
          suite: suite.name,
          agentModel: agent.model,
          taskCompletionRate: evalRun.taskCompletionRate,
          toolSelectionAccuracy: evalRun.toolSelectionAccuracy,
          evalRunId: evalRun.id,
        },
      });
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.finishedAt = new Date().toISOString();
      await writeJob(job);
    } finally {
      active.delete(key);
      gateway?.close();
    }
  };

  return { job, run };
}
