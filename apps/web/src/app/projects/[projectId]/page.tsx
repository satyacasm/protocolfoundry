import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/data";
import { formatWhen, Gauge, SectionHead, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const releases = await store.list(projectId);
  if (releases.length === 0) notFound();

  const sorted = [...releases].sort((a, b) => b.version - a.version);
  const live = releases.find((r) => r.status === "live");
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
              <Link
                key={release.id}
                href={`/projects/${projectId}/releases/${release.version}`}
                className={`release-row${release.status === "live" ? " live" : ""}`}
              >
                <div className="row-head">
                  <span className="ver">v{release.version}</span>
                  <StatusBadge status={release.status} />
                  {evalRun ? (
                    <span className="chip">eval: {evalRun.agentModel}</span>
                  ) : (
                    <span className="chip warn">no eval</span>
                  )}
                  {release.approvedBy ? (
                    <span className="chip warn">forced · {release.approvedBy}</span>
                  ) : null}
                  <span className="when">{formatWhen(release.createdAt)}</span>
                </div>
                {evalRun ? (
                  <div className="gauges">
                    <Gauge label="completion" value={evalRun.taskCompletionRate} />
                    <Gauge label="tool select" value={evalRun.toolSelectionAccuracy} />
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
