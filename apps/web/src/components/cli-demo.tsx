"use client";

/**
 * Looping terminal showcase for the overview page: shows the `pf` CLI turning a
 * sample app's API into a hosted MCP server, then registering it with Claude /
 * Gemini / Codex so any agent can use it. Pure presentation; loops forever.
 */

import { useEffect, useRef, useState } from "react";

type Line =
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string; tone?: "ok" | "dim" }
  | { kind: "comment"; text: string };

const SCRIPT: Line[] = [
  { kind: "comment", text: "# turn a sample app's API into a hosted MCP server" },
  { kind: "cmd", text: "pf ingest https://api.acme-shop.com/openapi.json --project acme" },
  { kind: "out", text: "✓ 18 operations → workflow graph", tone: "ok" },
  { kind: "cmd", text: "pf curate graph.json --model haiku && pf apply graph.json proposal.json" },
  { kind: "out", text: "✓ curated · 14 tools, 2 composed (search→details→reviews)", tone: "ok" },
  { kind: "cmd", text: "pf release create manifest.json --eval run.json && pf release promote acme 1" },
  { kind: "out", text: "✓ eval 96% · v1 LIVE at /mcp/acme", tone: "ok" },
  { kind: "comment", text: "# now point any agent at it — one command each" },
  { kind: "cmd", text: "claude mcp add --transport http acme https://app.protocolfoundry.com/mcp/acme" },
  { kind: "cmd", text: "gemini mcp add acme https://app.protocolfoundry.com/mcp/acme" },
  { kind: "cmd", text: "codex mcp add acme https://app.protocolfoundry.com/mcp/acme" },
  { kind: "out", text: "✓ acme is now available to Claude, Gemini & Codex", tone: "ok" },
];

const PROMPT = "›";

export function CliDemo() {
  const [rendered, setRendered] = useState<Line[]>([]);
  const [typing, setTyping] = useState("");
  const [cursor, setCursor] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setRendered(SCRIPT);
      return;
    }
    let cancelled = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    async function run() {
      while (!cancelled) {
        setRendered([]);
        setTyping("");
        for (const line of SCRIPT) {
          if (cancelled) return;
          if (line.kind === "cmd") {
            for (let i = 1; i <= line.text.length && !cancelled; i++) {
              setTyping(line.text.slice(0, i));
              await sleep(18);
            }
            await sleep(260);
            setRendered((r) => [...r, line]);
            setTyping("");
          } else {
            await sleep(line.kind === "comment" ? 220 : 420);
            setRendered((r) => [...r, line]);
          }
          await sleep(180);
        }
        await sleep(2600);
      }
    }
    void run();
    const blink = setInterval(() => setCursor((c) => !c), 500);
    return () => {
      cancelled = true;
      clearInterval(blink);
    };
  }, []);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [rendered, typing]);

  return (
    <div className="cli-demo">
      <div className="cli-bar">
        <span className="cli-dot" style={{ background: "#ff5f57" }} />
        <span className="cli-dot" style={{ background: "#febc2e" }} />
        <span className="cli-dot" style={{ background: "#28c840" }} />
        <span className="cli-title">pf — ProtocolFoundry CLI</span>
      </div>
      <div className="cli-body" ref={bodyRef}>
        {rendered.map((l, i) => (
          <div key={i} className={`cli-line cli-${l.kind}`}>
            {l.kind === "cmd" ? <span className="cli-prompt">{PROMPT}</span> : null}
            <span className={l.kind === "out" && l.tone === "ok" ? "cli-ok" : undefined}>
              {l.text}
            </span>
          </div>
        ))}
        {typing ? (
          <div className="cli-line cli-cmd">
            <span className="cli-prompt">{PROMPT}</span>
            <span>{typing}</span>
            <span className="cli-cursor" style={{ opacity: cursor ? 1 : 0 }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
