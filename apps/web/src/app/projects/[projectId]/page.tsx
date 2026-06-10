import Link from "next/link";
import { notFound } from "next/navigation";
import { promoteRelease, rollbackRelease } from "@/lib/actions";
import { store } from "@/lib/data";
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

  return (
    <main className="reveal">
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
    </main>
  );
}
