import Link from "next/link";
import { dataSourceInfo, getProjects, readAuditEvents } from "@/lib/data";
import { formatWhen, Gauge, SectionHead, StatusBadge } from "@/components/ui";
import { Parallax, Reveal } from "@/components/scrollfx";
import { Faq } from "@/components/faq";
import { FoundryPrism, Tilt } from "@/components/foundry3d";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [projects, recentAudit] = await Promise.all([getProjects(), readAuditEvents(8)]);
  const allReleases = projects.flatMap((p) => p.releases);
  const liveCount = projects.filter((p) => p.live).length;
  const invocations = await readAuditEvents(500, "toolInvocation");
  const { releasesDir } = dataSourceInfo();

  return (
    <main>
      <section className="hero">
        <Parallax speed={0.35} className="hero-backdrop">
          <span />
        </Parallax>
        <Parallax speed={0.18} className="hero-photo">
          <span />
        </Parallax>
        <Parallax speed={-0.1} className="hero-el el-ingot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/element-ingot.png" alt="" />
        </Parallax>
        <Parallax speed={-0.22} className="hero-el el-prism">
          <FoundryPrism />
        </Parallax>
        <Parallax speed={-0.16} className="hero-el el-hexnode">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/element-hexnode.png" alt="" />
        </Parallax>

        <div className="reveal">
          <p className="eyebrow">Control plane</p>
          <h1>
            APIs in. <span className="quiet">Eval‑tested</span> MCP servers out.
          </h1>
          <p className="lede">
            Every server in this foundry: what&apos;s live, what it scored at the gate, and
            what agents are doing with it — releases, evals, and a full audit trail.
          </p>
          <div className="hero-actions">
            <Link href="/forge" className="btn-primary">
              Forge a server
            </Link>
            <Link href="/audit" className="btn-ghost">
              Inspect the audit log
            </Link>
          </div>
        </div>
      </section>

      <Reveal>
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
      </Reveal>

      <section className="section faq-section">
        <span className="faq-bg" aria-hidden="true" />
        <Reveal>
          <SectionHead no="01" title="What is this place?" meta="six answers, no tour required" />
        </Reveal>
        <Reveal delay={80}>
          <Faq />
        </Reveal>
      </section>

      <section className="section">
        <Reveal>
          <SectionHead no="02" title="Projects" meta={releasesDir} />
        </Reveal>
        {projects.length === 0 ? (
          <Reveal>
            <div className="empty">
              No releases yet. Cut one with <code>pf release create &lt;manifest&gt; --eval &lt;run&gt;</code>{" "}
              then <code>pf release promote &lt;project&gt; &lt;version&gt;</code>.
            </div>
          </Reveal>
        ) : (
          <div className="projects">
            {projects.map((project, i) => (
              <Reveal key={project.projectId} delay={i * 70}>
                <Tilt>
                <Link
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
                </Tilt>
              </Reveal>
            ))}
          </div>
        )}
      </section>

      <section className="section activity-section">
        <span className="activity-bg" aria-hidden="true" />
        <Reveal>
          <SectionHead no="03" title="Recent activity" meta="audit log, newest first" />
        </Reveal>
        {recentAudit.length === 0 ? (
          <Reveal>
            <div className="empty">No audit events found.</div>
          </Reveal>
        ) : (
          <Reveal delay={80}>
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
          </Reveal>
        )}
      </section>
    </main>
  );
}
