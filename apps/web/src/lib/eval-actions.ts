"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { parseEvalSuite } from "@protocolfoundry/evals";
import { auditStore, store } from "./data";
import { startEvalJob } from "./eval-jobs";
import { appendAudit, requireOperator } from "./operator";
import { saveEvalSuite } from "./workspace";

/**
 * Eval write paths: suite upload + triggering eval jobs on staged releases.
 * The job itself runs after the response is sent (next/server `after`) —
 * the page polls the job record for progress.
 */

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message.slice(0, 300))}`);
}

export async function uploadEvalSuite(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const back = `/projects/${projectId}`;
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  let taskCount = 0;
  try {
    const file = formData.get("suiteFile");
    const pasted = String(formData.get("suiteJson") ?? "").trim();
    const raw =
      file instanceof File && file.size > 0 ? await file.text() : pasted;
    if (!raw) throw new Error("Provide a suite file or paste suite JSON");
    const suite = parseEvalSuite(raw);
    await saveEvalSuite(projectId, suite);
    taskCount = suite.tasks.length;
    await appendAudit(
      "manifestChange",
      projectId,
      { action: "evalSuiteSaved", suite: suite.name, tasks: taskCount },
      actor,
    );
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  redirect(`${back}?notice=${encodeURIComponent(`Eval suite saved (${taskCount} task(s))`)}`);
}

export async function startEval(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const version = Number(formData.get("version"));
  const back = `/projects/${projectId}`;
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set on the dashboard server — evals need it");
    }
    if (!Number.isInteger(version) || version < 1) throw new Error("Invalid release version");
    const { run } = await startEvalJob({
      store,
      audit: auditStore,
      projectId,
      version,
      actorId: actor,
    });
    after(run);
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  redirect(
    `${back}?notice=${encodeURIComponent(`Eval started for v${version} — progress updates below`)}`,
  );
}
