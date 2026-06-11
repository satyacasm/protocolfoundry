import Link from "next/link";
import { notFound } from "next/navigation";
import { promoteRelease, rollbackRelease } from "@/lib/actions";
import { store } from "@/lib/data";
import { generateSuiteFromManifest, startEval, uploadEvalSuite } from "@/lib/eval-actions";
import { isEvalRunning, readEvalJob, type EvalJob } from "@/lib/eval-jobs";
import { getEvalSuite } from "@/lib/workspace";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatWhen, Gauge, SectionHead, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

function EvalJobChip({ job, running }: { job: EvalJob; running: boolean }) {
  if (job.status === "running" && running) {
    return (
      <span className="chip">
        eval running · {job.completedTasks}/{job.totalTasks}
      </span>
    );
  }
  if (job.status === "running") {
    // Record says running but nothing is active — the server restarted mid-run.
    return <span className="chip warn">eval interrupted — re-run</span>;
  }
  if (job.status === "failed") {
    return <span className="chip warn">eval failed: {job.error?.slice(0, 80)}</span>;
  }
  return null;
}

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
  const evalReady = Boolean(process.env.ANTHROPIC_API_KEY);
  const suite = await getEvalSuite(projectId).catch(() => undefined);
  const evalRuns = new Map(
    await Promise.all(
      sorted.map(
        async (r) => [r.version, await store.getEvalRun(projectId, r.version)] as const,
      ),
    ),
  );
  const evalJobs = new Map(
    await Promise.all(
      sorted.map(
        async (r) => [r.version, await readEvalJob(projectId, r.version)] as const,
      ),
    ),
  );
  const anyJobActive = sorted.some(
    (r) => evalJobs.get(r.version)?.status === "running" && isEvalRunning(projectId, r.version),
  );

  return (
    <main className="reveal">
      {anyJobActive ? <AutoRefresh /> : null}
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
            const job = evalJobs.get(release.version);
            const jobActive =
              job?.status === "running" && isEvalRunning(projectId, release.version);
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
                  {job ? <EvalJobChip job={job} running={jobActive} /> : null}
                  {release.approvedBy ? (
                    <span className="chip warn">forced · {release.approvedBy}</span>
                  ) : null}
                  {writesEnabled && release.status === "staged" ? (
                    <form action={startEval} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="version" value={release.version} />
                      <select name="model" className="model-select" defaultValue="haiku" aria-label="Eval model">
                        <option value="haiku">haiku</option>
                        <option value="sonnet">sonnet</option>
                        <option value="opus">opus</option>
                        <option value="fable">fable</option>
                      </select>
                      <button
                        type="submit"
                        className="action-button"
                        disabled={!suite || !evalReady || jobActive}
                        title={
                          !suite
                            ? "Upload an eval suite below first"
                            : !evalReady
                              ? "Requires ANTHROPIC_API_KEY on the dashboard server"
                              : undefined
                        }
                      >
                        {evalRun ? "Re-run eval" : "Run eval"}
                      </button>
                    </form>
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
          title="Eval suite"
          meta={
            suite
              ? `${suite.name} · ${suite.tasks.length} task(s)`
              : "none yet"
          }
        />
        <p className="lede" style={{ fontSize: 13 }}>
          {suite
            ? "Run it against a staged release above — the eval attaches to the release and gates your promote decision."
            : "Upload a task suite to eval staged releases from here (JSON: { name, tasks: [{ id, description, prompt, expectedTools, successPattern }] })."}
        </p>
        {suite ? (
          <table className="grid">
            <thead>
              <tr>
                <th>Task</th>
                <th>Prompt</th>
                <th>Expected tools</th>
              </tr>
            </thead>
            <tbody>
              {suite.tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.id}</td>
                  <td className="desc">{task.prompt}</td>
                  <td className="faint">{task.expectedTools.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {writesEnabled ? (
          <form action={generateSuiteFromManifest} className="panel forge-form" style={{ marginTop: 14 }}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="version" value={sorted[0]!.version} />
            <label className="gate-label">
              Generate a coverage suite from v{sorted[0]!.version} — one eval task per exposed tool.
            </label>
            <label className="gate-label" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="includeWrites" />
              include write tools (live calls with real side effects)
            </label>
            <button type="submit" className="gate-button">
              Generate coverage suite
            </button>
          </form>
        ) : null}
        {writesEnabled ? (
          <form action={uploadEvalSuite} style={{ marginTop: 14 }}>
            <input type="hidden" name="projectId" value={projectId} />
            <div className="manifest-fields">
              <div>
                <label className="gate-label">Suite file (JSON)</label>
                <input type="file" name="suiteFile" className="gate-input" accept=".json,application/json" />
              </div>
              <div>
                <label className="gate-label">…or paste suite JSON</label>
                <textarea name="suiteJson" className="gate-input" rows={3} />
              </div>
            </div>
            <button type="submit" className="action-button" style={{ marginTop: 10 }}>
              {suite ? "Replace eval suite" : "Save eval suite"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
