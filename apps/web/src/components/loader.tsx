/**
 * Vector loading graphics for the porcelain design language.
 * <Loader/> — hexagonal "machined chip" spinner (brand mark) with an
 * indeterminate loading bar underneath. Pure SVG + CSS animation.
 */

export function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loader" role="status" aria-label={label}>
      <svg className="loader-mark" width="56" height="56" viewBox="0 0 64 64" fill="none">
        {/* static track */}
        <path
          d="M32 6 L54 19 L54 45 L32 58 L10 45 L10 19 Z"
          stroke="rgba(29,29,31,0.1)"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        {/* sweeping dash */}
        <path
          className="loader-sweep"
          d="M32 6 L54 19 L54 45 L32 58 L10 45 L10 19 Z"
          stroke="var(--accent)"
          strokeWidth="3.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength="100"
        />
        <text
          x="32"
          y="38"
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize="13"
          fill="var(--ink-2)"
        >
          ⟨/⟩
        </text>
      </svg>
      <div className="loader-bar" aria-hidden="true">
        <i />
      </div>
      <span className="loader-label">{label}…</span>
    </div>
  );
}
