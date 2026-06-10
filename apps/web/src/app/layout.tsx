import type { Metadata } from "next";
import Link from "next/link";
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const display = Chakra_Petch({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--next-font-display",
});
const mono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--next-font-mono",
});
const sans = IBM_Plex_Sans({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--next-font-sans",
});

export const metadata: Metadata = {
  title: "ProtocolFoundry — Control Plane",
  description: "Eval-tested, hosted MCP servers: releases, evals, audit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body>
        <div className="shell">
          <header className="masthead">
            <Link href="/" className="wordmark">
              <span className="tick">⟨/⟩</span>
              Protocol<em>Foundry</em>
            </Link>
            <nav>
              <Link href="/">Overview</Link>
              <Link href="/audit">Audit log</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
