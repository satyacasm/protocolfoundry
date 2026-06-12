import type { Metadata } from "next";
import Link from "next/link";
import { Instrument_Sans, Schibsted_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { ScrollProgress } from "@/components/scrollfx";
import { Glossary } from "@/components/glossary";
import "./globals.css";

const display = Schibsted_Grotesk({
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--next-font-display",
});
const mono = Spline_Sans_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--next-font-mono",
});
const sans = Instrument_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--next-font-sans",
});

export const metadata: Metadata = {
  title: "ProtocolFoundry — Control Plane",
  description: "Eval-tested, hosted MCP servers: releases, evals, audit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const authConfigured = Boolean(process.env.PF_DASHBOARD_PASSWORD);
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body>
        <header className="masthead">
          <Link href="/" className="wordmark">
            <span className="tick">⟨/⟩</span>
            Protocol<em>Foundry</em>
          </Link>
          <nav>
            <Link href="/">Overview</Link>
            <Link href="/forge">Forge</Link>
            <Link href="/audit">Audit log</Link>
            {authConfigured ? (
              <form method="post" action="/api/logout" style={{ display: "inline" }}>
                <button type="submit" className="logout-button">
                  Log out
                </button>
              </form>
            ) : null}
          </nav>
          <ScrollProgress />
        </header>
        <div className="shell">
          {!authConfigured ? (
            <p className="open-banner">
              Open mode — set PF_DASHBOARD_PASSWORD to require operator login.
            </p>
          ) : null}
          {children}
        </div>
        <footer className="colophon">
          <span>© 2026 ProtocolFoundry</span>
          <span className="mono">eval-gated MCP servers · one gateway</span>
        </footer>
        <Glossary />
      </body>
    </html>
  );
}
