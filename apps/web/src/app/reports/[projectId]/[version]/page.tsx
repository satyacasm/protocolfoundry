import { notFound } from "next/navigation";
import { getReleaseDetail } from "@/lib/data";
import { verifyReportSignature } from "@/lib/report-sign";
import { formatWhen, Gauge } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Public agent-readiness report. Reached via a signed link from the release
 * page (middleware lets /reports/* through; the signature is the gate).
 * Read-only marketing surface: scores, tool-surface shape, governance facts.
 * Bad signature or missing release/eval -> indistinguishable 404.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; version: string }>;
  searchParams: Promise<{ sig?: string }>;
}) {
  const { projectId, version } = await params;
  const { sig } = await searchParams;
  if (!/^[A-Za-z0-9_-]+$/.test(projectId) || !/^\d+$/.test(version)) notFound();
  if (!verifyReportSignature(projectId, Number(version), sig)) notFound();

  const detail = await getReleaseDetail(projectId, Number(version));
  if (!detail || !detail.evalRun) notFound();
  const { release, manifest, evalRun } = detail;

  const composed = manifest.tools.filter((t) => t.plan.length > 1).length;
  const gated = manifest.tools.filter((t) => t.approval === "perCall").length;
  const passed = evalRun.results.filter((r) => r.completed).length;

  return (
    <main className="reveal">
      <p className="eyebrow">Agent-readiness report</p>
      <h1>{manifest.serverName}</h1>
      <p className="lede">
        Scored evaluation of the hosted MCP server <span className="mono">/mcp/{manifest.serverName}</span>,
        release v{release.version}. Tasks were executed by a real agent over the
        Model Context Protocol — these numbers are measured, not promised.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="value">
            <em>{Math.round(evalRun.taskCompletionRate * 100)}%</em>
          </div>
          <div className="label">Task completion</div>
        </div>
        <div className="stat">
          <div className="value">{Math.round(evalRun.toolSelectionAccuracy * 100)}%</div>
          <div className="label">Tool-selection accuracy</div>
        </div>
        <div className="stat">
          <div className="value">
            {passed}/{evalRun.results.length}
          </div>
          <div className="label">Tasks passed</div>
        </div>
        <div className="stat">
          <div className="value">{manifest.tools.length}</div>
          <div className="label">Tools exposed</div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <span className="no">§01</span>
          <h2>Scores</h2>
          <span className="meta">agent: {evalRun.agentModel}</span>
        </div>
        <div className="panel">
          <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
            <Gauge label="completion" value={evalRun.taskCompletionRate} />
            <Gauge label="tool select" value={evalRun.toolSelectionAccuracy} />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="no">§02</span>
          <h2>Evaluated tasks</h2>
          <span className="meta">ran {formatWhen(evalRun.ranAt)}</span>
        </div>
        <table className="grid">
          <thead>
            <tr>
              <th>Task</th>
              <th>Completed</th>
              <th>Right tools</th>
              <th>Steps</th>
            </tr>
          </thead>
          <tbody>
            {evalRun.results.map((result) => (
              <tr key={result.taskId}>
                <td className="desc">{result.description}</td>
                <td>{result.completed ? <span className="ok">✓</span> : <span className="bad">✗</span>}</td>
                <td>{result.toolSelectionCorrect ? <span className="ok">✓</span> : <span className="bad">✗</span>}</td>
                <td>{result.steps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="no">§03</span>
          <h2>Governance</h2>
        </div>
        <div className="panel">
          <dl className="kv">
            <dt>Release</dt>
            <dd>
              v{release.version} ({release.status}) — immutable, eval-gated, roll-backable
            </dd>
            <dt>Tool surface</dt>
            <dd>
              {manifest.tools.length} tools — {composed} task-level (composed), {gated} behind
              per-call human approval
            </dd>
            <dt>Scopes</dt>
            <dd>Per-tool read/write/destructive scopes, enforced by the gateway on every call</dd>
            <dt>Audit</dt>
            <dd>Every tool invocation is audit-logged with hashed arguments</dd>
            <dt>Released</dt>
            <dd>{formatWhen(release.createdAt)}</dd>
          </dl>
        </div>
        <p className="faint" style={{ marginTop: 18, fontSize: 13 }}>
          Generated by ProtocolFoundry — eval-tested, hosted MCP servers. Scores are
          reproduced on every release; this report always reflects release v
          {release.version} exactly as evaluated.
        </p>
      </section>
    </main>
  );
}
