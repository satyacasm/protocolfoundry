import Link from "next/link";
import { notFound } from "next/navigation";
import { promoteRelease, rollbackRelease } from "@/lib/actions";
import { store } from "@/lib/data";
import { generateSuiteFromManifest, runEval, uploadEvalSuite } from "@/lib/eval-actions";
import { isEvalRunning } from "@/lib/eval-jobs";
import { getEvalJob, getSuite } from "@/lib/workspace";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatWhen, Gauge, SectionHead, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { projectId } = await params;
  const { notice, error } = await searchParams;
  const releases = await store.list(projectId);
  if (releases.length === 0) notFound();

  const sorted = [...releases].sort((a, b) => b.version - a.version);
  const live = releases.find((r) => r.status === "live");
  const canRollback = Boolean(live) && releases.some((r) => r.status === "retired");
  const writesEnabled = Boolean(process.env.PF_DASHBOARD_PASSWORD);
  const evalRuns = new Map(
    await Promise.all(
      sorted.map(
        async (r) => [r.version, await store.getEvalRun(projectId, r.version)] as const,
      ),
    ),
  );
  const [suite, evalJob] = await Promise.all([
    getSuite(projectId).catch(() => undefined),
    getEvalJob(projectId),
  ]);
  const evalRunning = isEvalRunning(projectId) && evalJob?.status === "running";
  const canRunEval = writesEnabled && Boolean(suite) && !evalRunning;

  return (
    <main className="reveal">
      {evalRunning ? <AutoRefresh seconds={4} /> : null}
      <p className="crumbs">
        <Link href="/">overview</Link> / {projectId}
      </p>
      <p className="eyebrow">Project</p>
      <h1>{projectId}</h1>
      <p className="lede">
        {live
          ? `v${live.version} is live. Promote a staged release or roll back — the gateway applies it without a restart.`
          : "No live release. Promote a staged release to put this server on the floor."}
      </p>

      {notice ? <p className="flash ok-flash">{notice}</p> : null}
      {error ? <p className="flash bad-flash">{error}</p> : null}
      {!writesEnabled ? (
        <p className="flash dim-flash">
          Read-only: set PF_DASHBOARD_PASSWORD to enable promote / rollback from here.
        </p>
      ) : null}

      <section className="section">
        <SectionHead
          no="01"
          title="Release timeline"
          meta={`${releases.length} release(s)`}
        />
        <div className="timeline">
          {sorted.map((release) => {
            const evalRun = evalRuns.get(release.version);
            return (
              <div
                key={release.id}
                className={`release-row${release.status === "live" ? " live" : ""}`}
              >
                <div className="row-head">
                  <Link
                    href={`/projects/${projectId}/releases/${release.version}`}
                    className="ver ver-link"
                  >
                    v{release.version}
                  </Link>
                  <StatusBadge status={release.status} />
                  {evalRun ? (
                    <span className="chip">eval: {evalRun.agentModel}</span>
                  ) : (
                    <span className="chip warn">no eval</span>
                  )}
                  {release.approvedBy ? (
                    <span className="chip warn">forced · {release.approvedBy}</span>
                  ) : null}
                  {writesEnabled && release.status === "staged" ? (
                    <form action={promoteRelease.bind(null, projectId, release.version)}>
                      <button type="submit" className="action-button">
                        Promote
                      </button>
                    </form>
                  ) : null}
                  {writesEnabled && release.status === "live" && canRollback ? (
                    <form action={rollbackRelease.bind(null, projectId)}>
                      <button type="submit" className="action-button danger">
                        Roll back
                      </button>
                    </form>
                  ) : null}
                  {canRunEval && (release.status === "staged" || release.status === "live") ? (
                    <form action={runEval}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="version" value={release.version} />
                      <button type="submit" className="action-button">
                        {evalRun ? "Re-run eval" : "Run eval"}
                      </button>
                    </form>
                  ) : null}
                  <span className="when">{formatWhen(release.createdAt)}</span>
                </div>
                {evalRun ? (
                  <div className="gauges">
                    <Gauge label="completion" value={evalRun.taskCompletionRate} />
                    <Gauge label="tool select" value={evalRun.toolSelectionAccuracy} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <SectionHead
          no="02"
          title="Evals"
          meta={suite ? `suite: ${suite.name} · ${suite.tasks.length} task(s)` : "no suite yet"}
        />

        {evalJob ? (
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="row-head" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              {evalJob.status === "running" ? (
                <span className="badge live">
                  <span className="dot" />
                  running
                </span>
              ) : evalJob.status === "succeeded" ? (
                <span className="chip ok">succeeded</span>
              ) : (
                <span className="chip warn">failed</span>
              )}
              <span className="mono dim">
                v{evalJob.version} · {evalJob.suiteName} · {evalJob.agentModel}
              </span>
              <span className="when faint mono" style={{ marginLeft: "auto", fontSize: 11 }}>
                started {formatWhen(evalJob.startedAt)}
              </span>
            </div>
            <div style={{ marginTop: 12, maxWidth: 560 }}>
              <Gauge
                label={`tasks ${evalJob.completedTasks}/${evalJob.totalTasks}`}
                value={evalJob.totalTasks > 0 ? evalJob.completedTasks / evalJob.totalTasks : 0}
              />
            </div>
            {evalJob.status === "failed" && evalJob.error ? (
              <p className="bad mono" style={{ fontSize: 12, margin: "12px 0 0" }}>{evalJob.error}</p>
            ) : null}
            {evalJob.status === "succeeded" ? (
              <p className="dim" style={{ fontSize: 13, margin: "12px 0 0" }}>
                Scores attached to{" "}
                <Link className="ver-link mono" href={`/projects/${projectId}/releases/${evalJob.version}`}>
                  v{evalJob.version}
                </Link>{" "}
                — gauges above and the public report now reflect this run.
              </p>
            ) : null}
          </div>
        ) : null}

        <form action={generateSuiteFromManifest} className="panel forge-form" style={{ marginBottom: 18 }}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="version" value={sorted[0]!.version} />
          <label className="gate-label">
            Generate a coverage suite from v{sorted[0]!.version} — one eval task per exposed tool.
            Read tools are called live; approval-gated tools get a must-be-blocked probe.
          </label>
          <label className="gate-label" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="includeWrites" />
            include write tools (live calls with real side effects)
          </label>
          <button type="submit" className="gate-button" disabled={!writesEnabled}>
            Generate coverage suite
          </button>
        </form>

        <form action={uploadEvalSuite} className="panel forge-form">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="gate-label" htmlFor="suiteFile">
            Eval suite (JSON: {"{ name, tasks: [{ id, description, prompt, expectedTools, successPattern }] }"})
          </label>
          <input id="suiteFile" name="suiteFile" type="file" className="gate-input" accept=".json" />
          <label className="gate-label" htmlFor="suiteJson">
            …or paste suite JSON
          </label>
          <textarea
            id="suiteJson"
            name="suiteJson"
            className="gate-input"
            rows={4}
            placeholder='{"name": "core flows", "tasks": [...]}'
          />
          <button type="submit" className="gate-button" disabled={!writesEnabled}>
            {suite ? "Replace suite" : "Save suite"}
          </button>
          {!writesEnabled ? (
            <span className="faint" style={{ fontSize: 12 }}>
              Read-only: set PF_DASHBOARD_PASSWORD to manage suites and run evals.
            </span>
          ) : !process.env.ANTHROPIC_API_KEY ? (
            <span className="faint" style={{ fontSize: 12 }}>
              Note: ANTHROPIC_API_KEY is not set on the dashboard server — runs will be refused.
            </span>
          ) : null}
        </form>
      </section>
    </main>
  );
}
