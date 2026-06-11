"use server";

import { redirect } from "next/navigation";
import { applyCuration, createAnthropicCurator, proposeCuration } from "@protocolfoundry/curation";
import {
  createAnthropicDocsExtractor,
  ingestSource,
  ingestUrl,
} from "@protocolfoundry/discovery";
import { generateManifest, type GenerateOptions } from "@protocolfoundry/generator";
import { extractSpecCandidates, looksLikeZip } from "./bundle";
import { store } from "./data";
import { appendAudit, requireOperator } from "./operator";
import { getGraph, getProposal, saveGraph, saveProposal } from "./workspace";

/** Forge write paths: spec upload -> graph -> (curation) -> staged release. */

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message.slice(0, 300))}`);
}

function manifestOptions(formData: FormData, projectId: string): GenerateOptions {
  const serverName = String(formData.get("serverName") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();
  return {
    serverName: serverName || projectId,
    ...(baseUrl ? { baseUrls: { default: baseUrl } } : {}),
  };
}

export async function ingestSpec(formData: FormData): Promise<void> {
  try {
    await requireOperator();
  } catch (error) {
    fail("/forge", error instanceof Error ? error.message : String(error));
  }
  const projectId = String(formData.get("projectId") ?? "").trim();
  const specUrl = String(formData.get("specUrl") ?? "").trim();
  const file = formData.get("specFile");

  let projectIdSafe = "";
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
      throw new Error("Project id must be letters, digits, dashes, or underscores");
    }
    projectIdSafe = projectId;

    let graph;
    if (file instanceof File && file.size > 0) {
      const bytes = await file.arrayBuffer();
      if (looksLikeZip(file.name, new Uint8Array(bytes.slice(0, 4)))) {
        // zip upload: try each json/yaml entry until one ingests as a spec
        const candidates = await extractSpecCandidates(bytes);
        if (candidates.length === 0) {
          throw new Error("Zip contains no .json/.yaml/.yml spec files");
        }
        let winner: { name: string; text: string } | undefined;
        let lastError: unknown;
        for (const candidate of candidates) {
          try {
            const probe = ingestSource(candidate.text, projectId, `upload:${file.name}!${candidate.name}`);
            if (probe.operations.length === 0) throw new Error("Spec contains no operations");
            winner = candidate;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!winner) {
          throw new Error(
            `No entry in the zip ingested as OpenAPI or Postman (last error: ${
              lastError instanceof Error ? lastError.message : String(lastError)
            })`,
          );
        }
        graph = ingestSource(winner.text, projectId, `upload:${file.name}!${winner.name}`);
      } else {
        graph = ingestSource(new TextDecoder().decode(bytes), projectId, `upload:${file.name}`);
      }
    } else if (specUrl) {
      // Spec URL or a SaaS API-documentation page: ingestUrl auto-detects,
      // prefers a linked machine-readable spec, then falls back to LLM
      // extraction of the documented endpoints.
      graph = await ingestUrl(specUrl, projectId, {
        ...(process.env.ANTHROPIC_API_KEY ? { extractor: createAnthropicDocsExtractor() } : {}),
      });
    } else {
      throw new Error("Provide a spec file or a spec / API-docs URL");
    }
    if (graph.operations.length === 0) throw new Error("Spec contains no operations");
    await saveGraph(graph);
  } catch (error) {
    fail("/forge", error instanceof Error ? error.message : String(error));
  }
  redirect(`/projects/${projectIdSafe}/curate?notice=${encodeURIComponent("Spec ingested — review the operations below")}`);
}

export async function runCuration(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const back = `/projects/${projectId}/curate`;
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set on the dashboard server — curation needs it");
    }
    const graph = await getGraph(projectId);
    if (!graph) throw new Error("No ingested graph for this project");
    const curator = createAnthropicCurator();
    const proposal = await proposeCuration(
      graph,
      graph.operations.map((op) => op.id),
      curator,
    );
    await saveProposal(proposal);
    await appendAudit("manifestChange", projectId, { action: "curationProposed", model: curator.model }, actor);
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  redirect(`${back}?notice=${encodeURIComponent("Proposal ready — review and approve below")}`);
}

export async function applyApprovedCuration(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const back = `/projects/${projectId}/curate`;
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  let version = 0;
  try {
    const [graph, proposal] = await Promise.all([getGraph(projectId), getProposal(projectId)]);
    if (!graph || !proposal) throw new Error("Graph or proposal missing");

    const refinementOperationIds = proposal.refinements
      .map((r) => r.operationId)
      .filter((id) => formData.get(`ref:${id}`) === "on");
    const composedToolNames = proposal.composedTools
      .map((t) => t.name)
      .filter((name) => formData.get(`comp:${name}`) === "on");

    const manifest = applyCuration(
      graph,
      proposal,
      { refinementOperationIds, composedToolNames },
      manifestOptions(formData, projectId),
    );
    const release = await store.createRelease(manifest, { approvedBy: actor });
    version = release.version;
    await appendAudit(
      "manifestChange",
      projectId,
      { action: "curationApplied", version, tools: manifest.tools.length },
      actor,
    );
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  redirect(
    `/projects/${projectId}?notice=${encodeURIComponent(`v${version} staged (curated, no eval yet) — run pf eval before promoting`)}`,
  );
}

export async function stageNaiveRelease(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const back = `/projects/${projectId}/curate`;
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  let version = 0;
  try {
    const graph = await getGraph(projectId);
    if (!graph) throw new Error("No ingested graph for this project");
    const operationIds = graph.operations
      .map((op) => op.id)
      .filter((id) => formData.get(`op:${id}`) === "on");
    if (operationIds.length === 0) throw new Error("Select at least one operation");

    const manifest = generateManifest(
      graph,
      { operationIds, taskFlowIds: [] },
      manifestOptions(formData, projectId),
    );
    const release = await store.createRelease(manifest, { approvedBy: actor });
    version = release.version;
    await appendAudit(
      "manifestChange",
      projectId,
      { action: "naiveManifestStaged", version, tools: manifest.tools.length },
      actor,
    );
  } catch (error) {
    fail(back, error instanceof Error ? error.message : String(error));
  }
  redirect(
    `/projects/${projectId}?notice=${encodeURIComponent(`v${version} staged (naive, no eval yet) — run pf eval before promoting`)}`,
  );
}
