import Link from "next/link";
import { notFound } from "next/navigation";
import { getReleaseDetail } from "@/lib/data";
import { formatWhen, Gauge, SectionHead, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReleasePage({
  params,
}: {
  params: Promise<{ projectId: string; version: string }>;
}) {
  const { projectId, version } = await params;
  const detail = await getReleaseDetail(projectId, Number(version));
  if (!detail) notFound();
  const { release, manifest, evalRun } = detail;

  return (
    <main className="reveal">
      <p className="crumbs">
        <Link href="/">overview</Link> /{" "}
        <Link href={`/projects/${projectId}`}>{projectId}</Link> / v{release.version}
      </p>
      <p className="eyebrow">Release</p>
      <h1>
        {projectId} · v{release.version}
      </h1>
      <p style={{ display: "flex", gap: 10, alignItems: "center", margin: "0 0 36px" }}>
        <StatusBadge status={release.status} />
        <span className="chip">created {formatWhen(release.createdAt)}</span>
        {release.approvedBy ? (
          <span className="chip warn">gate overridden by {release.approvedBy}</span>
        ) : null}
        <a
          className="action-button"
          href={`/api/projects/${projectId}/releases/${release.version}/bundle`}
          download
        >
          ↓ connection bundle (.zip)
        </a>
      </p>

      <section className="section" style={{ marginTop: 0 }}>
        <SectionHead no="01" title="Manifest" meta={release.manifestRef} />
        <div className="panel">
          <dl className="kv">
            <dt>Server name</dt>
            <dd>{manifest.serverName}</dd>
            <dt>Endpoint</dt>
            <dd>/mcp/{manifest.serverName}</dd>
            <dt>Upstream base URL</dt>
            <dd>{Object.values(manifest.baseUrls).join(", ")}</dd>
            <dt>Tools</dt>
            <dd>
              {manifest.tools.length} ({manifest.tools.filter((t) => t.plan.length > 1).length}{" "}
              composed)
            </dd>
            <dt>Auth schemes</dt>
            <dd>
              {Object.entries(manifest.authSchemes)
                .map(([id, scheme]) => `${id} (${scheme.kind})`)
                .join(", ") || "none"}
            </dd>
            <dt>Graph provenance</dt>
            <dd className="faint">{manifest.workflowGraphRef}</dd>
          </dl>
        </div>
      </section>

      <section className="section">
        <SectionHead no="02" title="Tool surface" meta="what agents see" />
        <table className="grid">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Kind</th>
              <th>Gate</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {manifest.tools.map((tool) => (
              <tr key={tool.name}>
                <td>{tool.name}</td>
                <td>
                  {tool.plan.length > 1 ? (
                    <span className="chip composed">composed · {tool.plan.length} steps</span>
                  ) : (
                    <span className="chip">1:1</span>
                  )}
                </td>
                <td>
                  {tool.approval === "perCall" ? (
                    <span className="chip warn">per-call approval</span>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </td>
                <td className="desc">{tool.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <SectionHead
          no="03"
          title="Eval report"
          meta={evalRun ? `agent: ${evalRun.agentModel}` : undefined}
        />
        {!evalRun ? (
          <div className="empty">
            This release shipped without an eval run
            {release.approvedBy ? ` (forced by ${release.approvedBy})` : ""}.
          </div>
        ) : (
          <>
            <div className="panel" style={{ marginBottom: 18 }}>
              <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
                <Gauge label="completion" value={evalRun.taskCompletionRate} />
                <Gauge label="tool select" value={evalRun.toolSelectionAccuracy} />
              </div>
            </div>
            {evalRun.results.length > 0 ? (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Done</th>
                    <th>Tools</th>
                    <th>Steps</th>
                    <th>Tokens in/out</th>
                    <th>Failure</th>
                  </tr>
                </thead>
                <tbody>
                  {evalRun.results.map((result) => (
                    <tr key={result.taskId}>
                      <td className="desc">{result.description}</td>
                      <td>{result.completed ? <span className="ok">✓</span> : <span className="bad">✗</span>}</td>
                      <td>{result.toolSelectionCorrect ? <span className="ok">✓</span> : <span className="bad">✗</span>}</td>
                      <td>{result.steps}</td>
                      <td className="faint">
                        {result.inputTokens}/{result.outputTokens}
                      </td>
                      <td className="desc faint">{result.failureReason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
