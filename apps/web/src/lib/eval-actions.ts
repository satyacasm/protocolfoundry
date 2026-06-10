"use server";

import { redirect } from "next/navigation";
import { parseEvalSuite } from "@protocolfoundry/evals";
import { startEvalJob } from "./eval-jobs";
import { appendAudit, requireOperator } from "./operator";
import { saveSuite } from "./workspace";

/** Eval write paths: suite upload + fire-and-forget eval job. */

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
    let raw: string;
    if (file instanceof File && file.size > 0) raw = await file.text();
    else if (pasted) raw = pasted;
    else throw new Error("Provide a suite file or paste suite JSON");

    const suite = parseEvalSuite(raw);
    await saveSuite(projectId, suite);
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
  redirect(`${back}?notice=${encodeURIComponent(`Eval suite saved (${taskCount} tasks)`)}`);
}

export async function runEval(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const version = Number(formData.get("version") ?? 0);
  const back = `/projects/${projectId}`;
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  try {
    const { done } = await startEvalJob(projectId, version, actor);
    // Fire and forget: the job persists its own progress/outcome; the page
    // polls the job file. Swallow here so an unhandled rejection can't crash
    // the server — failures land in the job state.
    void done.catch(() => {});
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  redirect(`${back}?notice=${encodeURIComponent(`Eval started for v${version} — progress updates below`)}`);
}
