import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CurationProposal, WorkflowGraph } from "@protocolfoundry/core";
import { parseEvalSuite, type EvalSuite } from "@protocolfoundry/evals";

/**
 * The "forge" workspace: in-progress artifacts (ingested graphs, curation
 * proposals) before anything becomes a release. File-based for now —
 * workspace/<projectId>/{graph,proposal}.json — moves to Postgres with
 * multi-tenant. Releases stay in the release store; this is pre-release only.
 */

const root = (): string => process.env.PF_WORKSPACE_DIR ?? "workspace";

export function projectWorkspaceDir(projectId: string): string {
  return projectDir(projectId);
}

function projectDir(projectId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw new Error("Project id must be letters, digits, dashes, or underscores");
  }
  return join(root(), projectId);
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveGraph(graph: WorkflowGraph): Promise<void> {
  const dir = projectDir(graph.projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "graph.json"), JSON.stringify(graph, null, 2), "utf8");
}

export async function getGraph(projectId: string): Promise<WorkflowGraph | undefined> {
  const raw = await readJson(join(projectDir(projectId), "graph.json"));
  return raw === undefined ? undefined : WorkflowGraph.parse(raw);
}

export async function saveProposal(proposal: CurationProposal): Promise<void> {
  const dir = projectDir(proposal.projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "proposal.json"), JSON.stringify(proposal, null, 2), "utf8");
}

export async function getProposal(projectId: string): Promise<CurationProposal | undefined> {
  const raw = await readJson(join(projectDir(projectId), "proposal.json"));
  return raw === undefined ? undefined : CurationProposal.parse(raw);
}

/** The project's agent-usability eval suite (validated, dashboard-managed). */
export async function saveEvalSuite(projectId: string, suite: EvalSuite): Promise<void> {
  const dir = projectDir(projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "eval-suite.json"), JSON.stringify(suite, null, 2), "utf8");
}

export async function getEvalSuite(projectId: string): Promise<EvalSuite | undefined> {
  const raw = await readJson(join(projectDir(projectId), "eval-suite.json"));
  return raw === undefined ? undefined : parseEvalSuite(raw);
}


export interface ForgeProject {
  projectId: string;
  operationCount: number;
  hasProposal: boolean;
}

export async function listForgeProjects(): Promise<ForgeProject[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(root(), { withFileTypes: true });
  } catch {
    return [];
  }
  const projects: ForgeProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const graph = await getGraph(entry.name).catch(() => undefined);
    if (!graph) continue;
    projects.push({
      projectId: entry.name,
      operationCount: graph.operations.length,
      hasProposal: (await getProposal(entry.name).catch(() => undefined)) !== undefined,
    });
  }
  return projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
}
