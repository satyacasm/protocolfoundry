import Link from "next/link";
import { dataSourceInfo, getProjects, readAuditEvents } from "@/lib/data";
import { formatWhen, Gauge, SectionHead, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [projects, recentAudit] = await Promise.all([getProjects(), readAuditEvents(8)]);
  const allReleases = projects.flatMap((p) => p.releases);
  const liveCount = projects.filter((p) => p.live).length;
  const invocations = await readAuditEvents(500, "toolInvocation");
  const { releasesDir } = dataSourceInfo();

  return (
    <main className="reveal">
      <p className="eyebrow">Control plane</p>
      <h1>The Floor</h1>
      <p className="lede">
        Every MCP server in this foundry: what&apos;s live, what it scored, and what agents
        are doing with it.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="value">{projects.length}</div>
          <div className="label">Projects</div>
        </div>
        <div className="stat">
          <div className="value">
            <em>{liveCount}</em>
          </div>
          <div className="label">Live servers</div>
        </div>
        <div className="stat">
          <div className="value">{allReleases.length}</div>
          <div className="label">Releases cut</div>
        </div>
        <div className="stat">
          <div className="value">{invocations.length}</div>
          <div className="label">Tool calls audited</div>
        </div>
      </div>

      <section className="section">
        <SectionHead no="01" title="Projects" meta={releasesDir} />
        {projects.length === 0 ? (
          <div className="empty">
            No releases yet. Cut one with <code>pf release create &lt;manifest&gt; --eval &lt;run&gt;</code>{" "}
            then <code>pf release promote &lt;project&gt; &lt;version&gt;</code>.
          </div>
        ) : (
          <div className="projects">
            {projects.map((project) => (
              <Link
                key={project.projectId}
                href={`/projects/${project.projectId}`}
                className={`project-card${project.live ? " is-live" : ""}`}
              >
                <h3>{project.projectId}</h3>
                <div className="sub">
                  {project.serverName ? `/mcp/${project.serverName}` : "no live endpoint"}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {project.live ? (
                    <>
                      <StatusBadge status="live" />
                      <span className="chip">v{project.live.version}</span>
                    </>
                  ) : (
                    <span className="chip">no live release</span>
                  )}
                  {project.staged > 0 ? (
                    <span className="chip">{project.staged} staged</span>
                  ) : null}
                  <span className="chip">{project.releases.length} total</span>
                </div>
                {project.liveEval ? (
                  <div className="gauges">
                    <Gauge label="completion" value={project.liveEval.taskCompletionRate} />
                    <Gauge label="tool select" value={project.liveEval.toolSelectionAccuracy} />
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <SectionHead no="02" title="Recent activity" meta="audit log, newest first" />
        {recentAudit.length === 0 ? (
          <div className="empty">No audit events found.</div>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Server / tool</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {recentAudit.map((event) => {
                const detail = event.detail as Record<string, unknown>;
                return (
                  <tr key={event.id}>
                    <td className="faint">{formatWhen(event.occurredAt)}</td>
                    <td>{event.kind}</td>
                    <td>
                      {String(detail["serverName"] ?? "—")}
                      <span className="faint"> / </span>
                      {String(detail["tool"] ?? "—")}
                    </td>
                    <td>
                      {event.kind === "approvalDenied" ? (
                        <span className="chip warn">gated</span>
                      ) : detail["ok"] === true ? (
                        <span className="ok">ok</span>
                      ) : detail["ok"] === false ? (
                        <span className="bad">error</span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
