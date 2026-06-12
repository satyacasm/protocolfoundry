"use client";

/**
 * FAQ accordion for the overview page. One item open at a time; rows expand
 * with a grid-template-rows transition (height: auto is not animatable).
 */

import { useState } from "react";

const FAQS: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "What is ProtocolFoundry?",
    a: (
      <>
        A foundry for agent tooling. Feed it an API you own — an OpenAPI spec, a
        Postman collection, or just the URL of your public API docs — and it comes
        out the other side as a hosted MCP server: curated tools, eval scores at the
        gate, releases you can promote and roll back, and a full audit trail of what
        agents do with it.
      </>
    ),
  },
  {
    q: "What is an MCP server, and why would I want one?",
    a: (
      <>
        MCP (Model Context Protocol) is the open standard agents like Claude and
        Gemini use to call tools. An MCP server is how your product shows up inside
        those agents. Without one, agents scrape and guess; with a good one, they
        complete real tasks against your API on the first try.
      </>
    ),
  },
  {
    q: "How does a docs URL turn into working tools?",
    a: (
      <>
        The ingestor first looks for a machine-readable spec linked from the page.
        If there isn&apos;t one, it crawls a bounded set of same-origin doc pages and
        uses an LLM extraction pass to recover the endpoints, auth scheme, and base
        URL into a workflow graph. A curation pass then proposes agent-friendly tool
        names, descriptions, and composed task-level tools — reviewed by a human
        before anything ships.
      </>
    ),
  },
  {
    q: "What does “eval-tested” actually mean?",
    a: (
      <>
        Before a release goes live, an agent-loop harness runs realistic tasks
        against the candidate server over MCP — the same way a real agent would.
        Each release records its task completion rate and tool-selection accuracy,
        and promotion can be gated on those scores. The numbers you see on every
        project card are those eval results, not vanity metrics.
      </>
    ),
  },
  {
    q: "Where do my API credentials live?",
    a: (
      <>
        You connect them explicitly, and they stay in a vault. Manifests, prompts,
        logs, and error messages only ever carry vault references — secrets never
        enter an LLM prompt or an audit line. Every tool invocation is recorded so
        you can see exactly what agents did, without exposing what they did it with.
      </>
    ),
  },
  {
    q: "Is code generated for every customer?",
    a: (
      <>
        No. Every server is a manifest interpreted by one shared, hardened gateway —
        there is no per-customer codebase to patch or drift. That is why promoting a
        release is instant, rollback is one click, and a security fix lands for
        every server at once.
      </>
    ),
  },
];

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="faq" role="list">
      {FAQS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q} className={`faq-item${isOpen ? " is-open" : ""}`} role="listitem">
            <button
              type="button"
              className="faq-q"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? -1 : i)}
            >
              <span className="faq-no">{String(i + 1).padStart(2, "0")}</span>
              <span className="faq-text">{item.q}</span>
              <span className="faq-cross" aria-hidden="true" />
            </button>
            <div className="faq-a">
              <div className="faq-a-inner">
                <p>{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
