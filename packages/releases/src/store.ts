import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  EvalRun,
  McpServerManifest,
  Release,
} from "@protocolfoundry/core";

/**
 * File-based release store (ADR-0005). Layout, one directory per project:
 *
 *   <root>/<projectId>/index.json        — release records (statuses mutate)
 *   <root>/<projectId>/v<N>.manifest.json — immutable once written
 *   <root>/<projectId>/v<N>.evalrun.json  — the gating eval, if provided
 *
 * Manifest files are write-once; a release/promote/rollback only ever
 * rewrites index.json — that's what makes rollback instant and safe.
 * Single-writer assumption (CLI/control plane); Postgres replaces this in
 * the dashboard milestone.
 */

const IndexFile = z.object({
  projectId: z.string(),
  releases: z.array(Release),
});
type IndexFile = z.infer<typeof IndexFile>;

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
  /** Explicit human override of a failing/missing gate. Recorded implicitly via approvedBy. */
  force?: boolean;
}

export class ReleaseGateError extends Error {}

export class FileReleaseStore {
  constructor(private readonly rootDir: string) {}

  private projectDir(projectId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
      throw new Error(`Invalid projectId "${projectId}"`);
    }
    return join(this.rootDir, projectId);
  }

  private async readIndex(projectId: string): Promise<IndexFile> {
    const file = join(this.projectDir(projectId), "index.json");
    try {
      return IndexFile.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { projectId, releases: [] };
      }
      throw new Error(`Release index for "${projectId}" is corrupt: ${error}`);
    }
  }

  private async writeIndex(index: IndexFile): Promise<void> {
    const dir = this.projectDir(index.projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.json"), JSON.stringify(index, null, 2), "utf8");
  }

  /** When was the project's index last changed? Used for hot-reload caching. */
  async indexMtimeMs(projectId: string): Promise<number | undefined> {
    try {
      return (await stat(join(this.projectDir(projectId), "index.json"))).mtimeMs;
    } catch {
      return undefined;
    }
  }

  async listProjects(): Promise<string[]> {
    const { readdir } = await import("node:fs/promises");
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async list(projectId: string): Promise<Release[]> {
    return (await this.readIndex(projectId)).releases;
  }

  /**
   * Create a new immutable release in "staged" status. Enforces the eval
   * gate unless explicitly forced by a human.
   */
  async createRelease(
    manifest: McpServerManifest,
    options: CreateReleaseOptions = {},
  ): Promise<Release> {
    const { evalRun, gate, approvedBy, force } = options;

    if (gate && !force) {
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
    if (force && !approvedBy) {
      throw new ReleaseGateError("force requires approvedBy — gate overrides must be attributable");
    }

    const projectId = manifest.projectId;
    const index = await this.readIndex(projectId);
    const version = Math.max(0, ...index.releases.map((r) => r.version)) + 1;
    const dir = this.projectDir(projectId);
    await mkdir(dir, { recursive: true });

    const manifestFile = `v${version}.manifest.json`;
    // Immutability: refuse to overwrite an existing manifest file.
    try {
      await stat(join(dir, manifestFile));
      throw new Error(`Release file ${manifestFile} already exists — releases are immutable`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(join(dir, manifestFile), JSON.stringify(manifest, null, 2), "utf8");
    if (evalRun) {
      await writeFile(
        join(dir, `v${version}.evalrun.json`),
        JSON.stringify(evalRun, null, 2),
        "utf8",
      );
    }

    const release = Release.parse({
      id: randomUUID(),
      projectId,
      manifestRef: manifestFile,
      version,
      status: "staged",
      ...(evalRun ? { evalRunId: evalRun.id } : {}),
      ...(approvedBy ? { approvedBy } : {}),
      createdAt: new Date().toISOString(),
    });
    index.releases.push(release);
    await this.writeIndex(index);
    return release;
  }

  /** Promote a staged release to live; the previous live release is retired. */
  async promote(projectId: string, version: number): Promise<Release> {
    const index = await this.readIndex(projectId);
    const target = index.releases.find((r) => r.version === version);
    if (!target) throw new Error(`No release v${version} for project "${projectId}"`);
    if (target.status !== "staged") {
      throw new Error(`Release v${version} is "${target.status}" — only staged releases can be promoted`);
    }
    for (const release of index.releases) {
      if (release.status === "live") release.status = "retired";
    }
    target.status = "live";
    await this.writeIndex(index);
    return target;
  }

  /**
   * Instant rollback: current live -> rolledBack; the most recently retired
   * release (the previous live) -> live again.
   */
  async rollback(projectId: string): Promise<Release> {
    const index = await this.readIndex(projectId);
    const live = index.releases.find((r) => r.status === "live");
    if (!live) throw new Error(`Project "${projectId}" has no live release to roll back`);
    const previous = [...index.releases]
      .filter((r) => r.status === "retired")
      .sort((a, b) => b.version - a.version)[0];
    if (!previous) {
      throw new Error(`Project "${projectId}" has no previous release to roll back to`);
    }
    live.status = "rolledBack";
    previous.status = "live";
    await this.writeIndex(index);
    return previous;
  }

  async getLive(
    projectId: string,
  ): Promise<{ release: Release; manifest: McpServerManifest } | undefined> {
    const index = await this.readIndex(projectId);
    const live = index.releases.find((r) => r.status === "live");
    if (!live) return undefined;
    const manifest = await this.getManifest(projectId, live.version);
    return { release: live, manifest };
  }

  async getManifest(projectId: string, version: number): Promise<McpServerManifest> {
    const file = join(this.projectDir(projectId), `v${version}.manifest.json`);
    return McpServerManifest.parse(JSON.parse(await readFile(file, "utf8")));
  }

  /** The eval run stored with a release, if one backed it. */
  async getEvalRun(projectId: string, version: number): Promise<EvalRun | undefined> {
    const file = join(this.projectDir(projectId), `v${version}.evalrun.json`);
    try {
      return EvalRun.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}
