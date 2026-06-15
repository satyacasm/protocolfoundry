import Link from "next/link";
import { notFound } from "next/navigation";
import {
  activeModelLabel,
  applyApprovedCuration,
  runCuration,
  stageNaiveRelease,
} from "@/lib/forge-actions";
import { getGraph, getProposal } from "@/lib/workspace";
import { SectionHead } from "@/components/ui";

export const dynamic = "force-dynamic";

function ManifestFields({ projectId, defaultBaseUrl }: { projectId: string; defaultBaseUrl?: string }) {
  return (
    <div className="manifest-fields">
      <div>
        <label className="gate-label">Server name</label>
        <input name="serverName" className="gate-input" placeholder={projectId} />
      </div>
      <div>
        <label className="gate-label">Upstream base URL</label>
        <input
          name="baseUrl"
          className="gate-input"
          placeholder={defaultBaseUrl ?? "https://app.example.com (required — spec has none)"}
        />
      </div>
    </div>
  );
}

export default async function CuratePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { projectId } = await params;
  const { notice, error } = await searchParams;
  const graph = await getGraph(projectId).catch(() => undefined);
  if (!graph) notFound();
  const proposal = await getProposal(projectId).catch(() => undefined);
  const defaultBaseUrl = graph.baseUrls["default"];
  const curationReady = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <main className="reveal">
      <p className="crumbs">
        <Link href="/forge">forge</Link> / {projectId}
      </p>
      <p className="eyebrow">Curation</p>
      <h1>{projectId}</h1>
      <p className="lede">
        {graph.operations.length} operations discovered. Nothing ships without
        your approval: stage a naive release from hand-picked operations, or
        run the LLM curation pass and review its proposal.
      </p>
      <p className="faint">Active model: {activeModelLabel()} (set PF_ANTHROPIC_MODEL to change)</p>

      {notice ? <p className="flash ok-flash">{notice}</p> : null}
      {error ? <p className="flash bad-flash">{error}</p> : null}

      <section className="section" style={{ marginTop: 0 }}>
        <SectionHead
          no="01"
          title="Discovered operations"
          meta={`source: ${graph.operations[0]?.sourceId ?? "?"}`}
        />
        <form action={stageNaiveRelease}>
          <input type="hidden" name="projectId" value={projectId} />
          <table className="grid">
            <thead>
              <tr>
                <th></th>
                <th>Operation</th>
                <th>HTTP</th>
                <th>Effect</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {graph.operations.map((op) => (
                <tr key={op.id}>
                  <td>
                    <input type="checkbox" name={`op:${op.id}`} defaultChecked={op.effect !== "delete"} />
                  </td>
                  <td>{op.id}</td>
                  <td className="faint">
                    {op.http.method} {op.http.path}
                  </td>
                  <td>
                    {op.effect === "delete" ? (
                      <span className="chip warn">{op.effect}</span>
                    ) : (
                      <span className="chip">{op.effect}</span>
                    )}
                  </td>
                  <td className="desc">{op.description ?? op.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="forge-actions">
            <ManifestFields projectId={projectId} defaultBaseUrl={defaultBaseUrl} />
            <button type="submit" className="gate-button">
              Stage naive release from checked operations
            </button>
          </div>
        </form>
        <form action={runCuration} style={{ marginTop: 14 }}>
          <input type="hidden" name="projectId" value={projectId} />
          <button type="submit" className="action-button" disabled={!curationReady}>
            {proposal ? "Re-run LLM curation" : "Run LLM curation"}
          </button>
          {!curationReady ? (
            <span className="faint mono" style={{ marginLeft: 10, fontSize: 11 }}>
              requires ANTHROPIC_API_KEY on the dashboard server
            </span>
          ) : null}
        </form>
      </section>

      {proposal ? (
        <section className="section">
          <SectionHead
            no="02"
            title="Curation proposal"
            meta={`proposed by ${proposal.proposedBy}`}
          />
          {proposal.warnings.length > 0 ? (
            <div className="panel" style={{ marginBottom: 16 }}>
              {proposal.warnings.map((w) => (
                <p key={w.operationId} className="gate-error" style={{ margin: "4px 0" }}>
                  ⚠ {w.operationId}: {w.reason}
                </p>
              ))}
            </div>
          ) : null}
          <form action={applyApprovedCuration}>
            <input type="hidden" name="projectId" value={projectId} />
            <h3 className="mono" style={{ fontSize: 13 }}>
              Refined tools
            </h3>
            <table className="grid">
              <thead>
                <tr>
                  <th></th>
                  <th>Operation</th>
                  <th>Proposed tool</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {proposal.refinements.map((r) => (
                  <tr key={r.operationId}>
                    <td>
                      <input type="checkbox" name={`ref:${r.operationId}`} defaultChecked />
                    </td>
                    <td className="faint">{r.operationId}</td>
                    <td>{r.toolName}</td>
                    <td className="desc">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="mono" style={{ fontSize: 13, marginTop: 24 }}>
              Composed task-level tools
            </h3>
            {proposal.composedTools.length === 0 ? (
              <p className="faint mono" style={{ fontSize: 12 }}>
                None proposed.
              </p>
            ) : (
              <table className="grid">
                <thead>
                  <tr>
                    <th></th>
                    <th>Tool</th>
                    <th>Steps</th>
                    <th>Description</th>
                    <th>Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.composedTools.map((tool) => (
                    <tr key={tool.name}>
                      <td>
                        <input type="checkbox" name={`comp:${tool.name}`} defaultChecked />
                      </td>
                      <td>{tool.name}</td>
                      <td className="faint">{tool.steps.map((s) => s.operationId).join(" → ")}</td>
                      <td className="desc">{tool.description}</td>
                      <td className="desc faint">{tool.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="forge-actions">
              <ManifestFields projectId={projectId} defaultBaseUrl={defaultBaseUrl} />
              <button type="submit" className="gate-button">
                Apply approved &amp; stage curated release
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
