"use client";

/**
 * Floating help widget: a small popout that explains the platform's vocabulary
 * in plain language, so non-technical operators aren't lost on terms like
 * "manifest", "eval run", or "gate". Opens on click, closes on Esc / outside
 * click. Present on every page via the root layout.
 */

import { useEffect, useRef, useState } from "react";

const TERMS: Array<{ term: string; def: React.ReactNode }> = [
  {
    term: "MCP server",
    def: "How your app shows up inside AI agents (like Claude) so they can use it. The product we build for you.",
  },
  {
    term: "Tool",
    def: "One action an agent can take through your server — e.g. “search movies” or “create order”.",
  },
  {
    term: "Manifest",
    def: "The spec that defines your server's tools. The shared gateway reads it directly — no custom code per customer.",
  },
  {
    term: "Curation",
    def: "An AI pass that gives tools clear names and descriptions, and bundles multi-step actions, before anything ships.",
  },
  {
    term: "Composed tool",
    def: "One tool that chains several API calls into a single business action (e.g. find a movie → fetch its details → its cast).",
  },
  {
    term: "Eval run",
    def: "A test where an AI agent is given real tasks and scored on whether it completes them using your tools. Run it from a release with the model picker.",
  },
  {
    term: "Completion / Tool-selection",
    def: "The two eval scores: the % of tasks finished, and the % where the agent chose the right tools.",
  },
  {
    term: "Eval gate",
    def: "The minimum eval score a release must hit before it's allowed to go live (default 80% / 80%).",
  },
  {
    term: "Release",
    def: "A versioned snapshot of your server. Promote it to live, or roll back — without restarting anything.",
  },
  {
    term: "Promote / Roll back",
    def: "Make a version live, or instantly revert to the previous one. The gateway swaps over with no downtime.",
  },
  {
    term: "Credential / Vault",
    def: "Your upstream API key, sealed in encrypted storage. It's never written to logs, manifests, or AI prompts.",
  },
  {
    term: "Gateway",
    def: "The single shared server that hosts every manifest and forwards agent calls to your real API.",
  },
  {
    term: "Approval gate",
    def: "A safety hold: destructive actions (like deletes) wait for a human to approve before they run.",
  },
  {
    term: "Audit log",
    def: "A record of every action an agent took — arguments hashed, secrets redacted — so nothing is a black box.",
  },
];

export function Glossary() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // defer so the opening click doesn't immediately close it
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      clearTimeout(t);
    };
  }, [open]);

  return (
    <div className="glossary" ref={panelRef}>
      {open ? (
        <div className="glossary-panel" role="dialog" aria-label="Glossary of terms">
          <div className="glossary-head">
            <strong>What's what</strong>
            <span>Plain-language guide to the terms on this dashboard.</span>
          </div>
          <dl className="glossary-list">
            {TERMS.map((t) => (
              <div className="glossary-item" key={t.term}>
                <dt>{t.term}</dt>
                <dd>{t.def}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <button
        type="button"
        className="glossary-fab"
        aria-expanded={open}
        aria-label={open ? "Close glossary" : "Open glossary of terms"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "✕" : <><span className="q">?</span> Terms</>}
      </button>
    </div>
  );
}
