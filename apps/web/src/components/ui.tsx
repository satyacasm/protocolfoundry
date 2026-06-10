import type { Release } from "@protocolfoundry/core";

export function StatusBadge({ status }: { status: Release["status"] }) {
  const label = status === "rolledBack" ? "rolled back" : status;
  return (
    <span className={`badge ${status}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function Gauge({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="gauge">
      <span className="glabel">{label}</span>
      <span className="track">
        <span className={`fill${value < 0.8 ? " low" : ""}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="gval">{pct}%</span>
    </div>
  );
}

export function SectionHead({
  no,
  title,
  meta,
}: {
  no: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="section-head">
      <span className="no">§{no}</span>
      <h2>{title}</h2>
      {meta ? <span className="meta">{meta}</span> : null}
    </div>
  );
}

export function formatWhen(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z");
}
