import { ingestSpec } from "@/lib/forge-actions";
import { listForgeProjects } from "@/lib/workspace";
import Link from "next/link";
import { SectionHead } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ForgePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  const inProgress = await listForgeProjects();
  const writesEnabled = Boolean(process.env.PF_DASHBOARD_PASSWORD);

  return (
    <main className="reveal">
      <p className="eyebrow">Forge</p>
      <h1>New project</h1>
      <p className="lede">
        Feed the foundry an OpenAPI 3.x spec (JSON or YAML) for an application
        you own. You&apos;ll review every operation before anything is exposed
        to agents.
      </p>

      {notice ? <p className="flash ok-flash">{notice}</p> : null}
      {error ? <p className="flash bad-flash">{error}</p> : null}
      {!writesEnabled ? (
        <p className="flash dim-flash">
          Read-only: set PF_DASHBOARD_PASSWORD to enable the forge.
        </p>
      ) : null}

      <section className="section" style={{ marginTop: 0 }}>
        <SectionHead no="01" title="Ingest a spec" />
        <form action={ingestSpec} className="panel forge-form">
          <label className="gate-label" htmlFor="projectId">
            Project id
          </label>
          <input
            id="projectId"
            name="projectId"
            className="gate-input"
            placeholder="my-app"
            pattern="[A-Za-z0-9_-]+"
            required
          />
          <label className="gate-label" htmlFor="specUrl">
            Spec URL
          </label>
          <input
            id="specUrl"
            name="specUrl"
            className="gate-input"
            placeholder="https://app.example.com/openapi.json"
          />
          <label className="gate-label" htmlFor="specFile">
            …or upload a spec file
          </label>
          <input id="specFile" name="specFile" type="file" className="gate-input" accept=".json,.yaml,.yml" />
          <button type="submit" className="gate-button" disabled={!writesEnabled}>
            Ingest
          </button>
        </form>
      </section>

      <section className="section">
        <SectionHead no="02" title="In the forge" meta="ingested, not yet released" />
        {inProgress.length === 0 ? (
          <div className="empty">Nothing in progress.</div>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Project</th>
                <th>Operations</th>
                <th>Proposal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inProgress.map((p) => (
                <tr key={p.projectId}>
                  <td>{p.projectId}</td>
                  <td>{p.operationCount}</td>
                  <td>{p.hasProposal ? <span className="ok">ready for review</span> : <span className="faint">—</span>}</td>
                  <td>
                    <Link className="chip" href={`/projects/${p.projectId}/curate`}>
                      open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
