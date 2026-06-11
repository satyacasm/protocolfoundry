import { NextRequest, NextResponse } from "next/server";

/**
 * Redirect with a RELATIVE Location header. Behind a reverse proxy
 * (Render, etc.) the internal request URL is http://localhost:<port>, so
 * absolute redirects built from request.url send the browser to
 * localhost. A relative Location resolves against whatever origin the
 * browser is actually on.
 *
 * 303 (See Other) by default: correct for POST → GET handoffs like
 * login/logout form submissions.
 */
export function redirectTo(path: string, status: 302 | 303 | 307 = 303): NextResponse {
  const response = new NextResponse(null, { status });
  response.headers.set("Location", path);
  return response;
}

/**
 * The origin the BROWSER is on, not the proxy-internal one. Middleware
 * (unlike route handlers) rejects relative Location headers, so redirects
 * there need an absolute URL — built from x-forwarded-* when behind a
 * proxy, falling back to the request's own origin in local dev.
 */
export function externalUrl(request: NextRequest, path: string): URL {
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    request.nextUrl.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    request.nextUrl.host;
  return new URL(path, `${proto}://${host}`);
}
