import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionSecret, verifySessionToken } from "@/lib/session";
import { externalUrl } from "@/lib/redirects";

// /reports/* is signature-gated by the page itself (shareable eval reports)
const PUBLIC_PATHS = [/^\/login$/, /^\/api\/login$/, /^\/reports\//];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const secret = sessionSecret();
  // No password configured -> open dev mode; the layout shows a loud banner.
  if (!secret) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => p.test(pathname))) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySessionToken(token, secret))) {
    return NextResponse.next();
  }

  // Middleware requires an absolute Location; build it on the browser-facing
  // origin (x-forwarded-*) — request.url here is the proxy-internal host.
  const params = new URLSearchParams();
  if (pathname !== "/" && !pathname.startsWith("/api/")) params.set("from", pathname);
  const query = params.toString();
  return NextResponse.redirect(externalUrl(request, `/login${query ? `?${query}` : ""}`), 302);
}

export const config = {
  // everything except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
