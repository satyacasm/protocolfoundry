import Link from "next/link";
import { dataSourceInfo, readAuditEvents } from "@/lib/data";
import { formatWhen, SectionHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const KINDS = [
  "toolInvocation",
  "approvalDenied",
  "releasePromoted",
  "releaseRolledBack",
  "credentialConnected",
] as const;

const PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; page?: string }>;
}) {
  const { kind, page: pageRaw } = await searchParams;
  const page = Math.max(1, Number(pageRaw) || 1);
  const events = await readAuditEvents({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    ...(kind ? { kind } : {}),
  });
  const { auditLogPath } = dataSourceInfo();
  const pageUrl = (p: number) =>
    `/audit?${kind ? `kind=${kind}&` : ""}page=${p}`;

  return (
    <main className="reveal">
      <p className="eyebrow">Trust layer</p>
      <h1>Audit log</h1>
      <p className="lede">
        Every tool invocation and control-plane mutation, append-only, with hashed
        arguments. What did agents do, and when?
      </p>

      <div className="filters">
        <Link href="/audit" className={!kind ? "active" : ""}>
          all
        </Link>
        {KINDS.map((k) => (
          <Link key={k} href={`/audit?kind=${k}`} className={kind === k ? "active" : ""}>
            {k}
          </Link>
        ))}
      </div>

      <SectionHead
        no="01"
        title="Events"
        meta={`${auditLogPath} · page ${page}`}
      />
      {events.length === 0 ? (
        <div className="empty">
          No events{kind ? ` of kind ${kind}` : ""}. Point PF_AUDIT_LOG at the gateway&apos;s
          audit file.
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Actor</th>
              <th>Server / tool</th>
              <th>Result</th>
              <th>Args sha256</th>
              <th>Upstream</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const detail = event.detail as Record<string, unknown>;
              const upstream = Array.isArray(detail["upstream"])
                ? (detail["upstream"] as Array<{ status?: number }>)
                : [];
              return (
                <tr key={event.id}>
                  <td className="faint">{formatWhen(event.occurredAt)}</td>
                  <td>{event.kind}</td>
                  <td className="faint">
                    {event.actor.type}:{event.actor.id}
                  </td>
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
                      <span className="bad">{String(detail["error"] ?? "error").slice(0, 60)}</span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td className="faint">{String(detail["argsSha256"] ?? "").slice(0, 12)}</td>
                  <td className="faint">
                    {upstream.length > 0 ? upstream.map((u) => u.status).join(", ") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="filters" style={{ marginTop: 20 }}>
        {page > 1 ? <Link href={pageUrl(page - 1)}>← newer</Link> : null}
        {events.length === PAGE_SIZE ? <Link href={pageUrl(page + 1)}>older →</Link> : null}
      </div>
    </main>
  );
}
