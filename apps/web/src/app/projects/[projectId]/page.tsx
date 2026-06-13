import Link from "next/link";
import { notFound } from "next/navigation";
import { promoteRelease, rollbackRelease } from "@/lib/actions";
import { connectCredential, disconnectCredential } from "@/lib/credential-actions";
import { getVault, listCredentialSlots } from "@/lib/credentials";
import { store } from "@/lib/data";
import { generateSuiteFromManifest, startEval, uploadEvalSuite } from "@/lib/eval-actions";
import { isEvalRunning, readEvalJob, type EvalJob } from "@/lib/eval-jobs";
import { getEvalSuite } from "@/lib/workspace";
import { AutoRefresh } from "@/components/auto-refresh";
import { Toast } from "@/components/toast";
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
  const newestManifest = await store.getManifest(projectId, sorted[0]!.version);
  const credentialSlots = await listCredentialSlots(newestManifest);
  const vaultReady = Boolean(getVault());

  return (
    <main className="reveal">
      {anyJobActive ? <AutoRefresh /> : null}
      {error ? (
        <Toast message={error} kind="error" />
      ) : notice ? (
        <Toast message={notice} kind="ok" />
      ) : null}
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
                  {writesEnabled && (release.status === "staged" || release.status === "live") ? (
                    <form action={startEval} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="version" value={release.version} />
                      <select name="model" className="model-select" defaultValue="haiku" aria-label="Eval model">
                        <option value="haiku">haiku</option>
                        <option value="sonnet">sonnet</option>
                        <option value="opus">opus</option>
                        <option value="fable">fable</option>
                      </select>
                      {/* Only disabled while a run is active — otherwise clicking
                          always gives feedback (a toast) instead of doing nothing. */}
                      <button
                        type="submit"
                        className="action-button"
                        disabled={jobActive}
                        title={
                          !suite
                            ? "Generate or upload an eval suite below first"
                            : !evalReady
                              ? "Set ANTHROPIC_API_KEY on the dashboard to run evals"
                              : undefined
                        }
                      >
                        {evalRun ? "Re-run eval" : "Run eval"}
                      </button>
                      {!suite ? (
                        <span className="eval-hint">needs a suite ↓</span>
                      ) : null}
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
                {jobActive && job ? (
                  <div
                    className="eval-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={job.totalTasks}
                    aria-valuenow={job.completedTasks}
                  >
                    <div className="eval-progress-track">
                      <div
                        className="eval-progress-fill"
                        style={{
                          width: `${
                            job.totalTasks
                              ? Math.round((job.completedTasks / job.totalTasks) * 100)
                              : 5
                          }%`,
                        }}
                      />
                    </div>
                    <span className="eval-progress-label">
                      running eval · {job.completedTasks}/{job.totalTasks} tasks
                    </span>
                  </div>
                ) : null}
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

      {credentialSlots.length > 0 ? (
        <section className="section">
          <SectionHead
            no="02"
            title="Credentials"
            meta={`${credentialSlots.filter((s) => s.inVault).length}/${credentialSlots.length} connected`}
          />
          <p className="lede" style={{ fontSize: 13 }}>
            Upstream credentials this server needs. Pasted values are sealed into the
            encrypted vault and picked up by the gateway immediately — no restart, no env
            vars. Secrets never appear in manifests, logs, or LLM prompts.
          </p>
          {credentialSlots.map((slot) => (
            <div key={slot.vaultCredentialId} className="panel" style={{ marginBottom: 14 }}>
              <div className="row-head" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong>{slot.guide.title}</strong>
                <span className="chip">{slot.kind}</span>
                <span className="chip mono">{slot.vaultCredentialId}</span>
                {slot.inVault ? (
                  <span className="chip" style={{ color: "var(--status-live)", borderColor: "rgba(29,125,79,0.35)" }}>
                    connected
                  </span>
                ) : (
                  <span className="chip warn">not connected</span>
                )}
              </div>
              <ol style={{ margin: "12px 0 4px", paddingLeft: 22, color: "var(--ink-2)", fontSize: 13.5, lineHeight: 1.6 }}>
                {slot.guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="faint" style={{ fontSize: 12.5, margin: "6px 0 12px" }}>
                Value format: <code>{slot.guide.valueFormat}</code>
                {slot.guide.rotation ? <> · {slot.guide.rotation}</> : null}
                {slot.guide.helpUrl ? (
                  <>
                    {" · "}
                    <a href={slot.guide.helpUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                      provider docs
                    </a>
                  </>
                ) : null}
              </p>
              {writesEnabled ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <form action={connectCredential} style={{ display: "flex", gap: 8, flex: "1 1 380px" }}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="vaultCredentialId" value={slot.vaultCredentialId} />
                    <input
                      type="password"
                      name="secret"
                      className="gate-input"
                      style={{ flex: 1 }}
                      placeholder={slot.guide.valueFormat}
                      autoComplete="off"
                      disabled={!vaultReady}
                    />
                    <button type="submit" className="action-button" disabled={!vaultReady}>
                      {slot.inVault ? "Replace" : "Connect"}
                    </button>
                  </form>
                  {slot.inVault ? (
                    <form action={disconnectCredential}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="vaultCredentialId" value={slot.vaultCredentialId} />
                      <button type="submit" className="action-button danger">
                        Remove
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
              {!vaultReady ? (
                <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
                  Vault unavailable — set PF_VAULT_KEY (and PF_DATABASE_URL) on this dashboard.
                </p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="section">
        <SectionHead
          no={credentialSlots.length > 0 ? "03" : "02"}
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
