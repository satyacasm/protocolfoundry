"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { isClaudeModelAlias, resolveClaudeModel } from "@protocolfoundry/core";
import { generateCoverageSuite, parseEvalSuite } from "@protocolfoundry/evals";
import { auditStore, store } from "./data";
import { startEvalJob } from "./eval-jobs";
import { appendAudit, requireOperator } from "./operator";
import { saveEvalSuite } from "./workspace";

/**
 * Eval write paths: suite upload + generating coverage suites + triggering
 * eval jobs on staged releases. Jobs run after the response is sent
 * (next/server `after`) — the page polls the job record for progress.
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

export async function generateSuiteFromManifest(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const version = Number(formData.get("version") ?? 0);
  const includeWrites = formData.get("includeWrites") === "on";
  const back = `/projects/${projectId}`;
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  let notice = "";
  try {
    const manifest = await store.getManifest(projectId, version);
    const { suite, skippedWriteTools } = generateCoverageSuite(manifest, { includeWrites });
    await saveEvalSuite(projectId, suite);
    await appendAudit(
      "manifestChange",
      projectId,
      { action: "coverageSuiteGenerated", version, tasks: suite.tasks.length, skippedWriteTools },
      actor,
    );
    notice =
      `Coverage suite generated from v${version}: ${suite.tasks.length} task(s), one per tool` +
      (skippedWriteTools.length > 0
        ? ` — ${skippedWriteTools.length} write tool(s) skipped (${skippedWriteTools.join(", ")}); tick "include write tools" to cover them`
        : "");
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  redirect(`${back}?notice=${encodeURIComponent(notice.slice(0, 400))}`);
}

export async function startEval(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const version = Number(formData.get("version"));
  const modelAlias = String(formData.get("model") ?? "haiku");
  const back = `/projects/${projectId}`;
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  if (!isClaudeModelAlias(modelAlias)) {
    fail(back, `Unknown model "${modelAlias}" — pick haiku, sonnet, opus, or fable`);
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
      model: resolveClaudeModel(modelAlias),
    });
    after(run);
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  redirect(
    `${back}?notice=${encodeURIComponent(`Eval started for v${version} — progress updates below`)}`,
  );
}
