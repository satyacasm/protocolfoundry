import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionSecret, verifySessionToken } from "@/lib/session";

const PUBLIC_PATHS = [/^\/login$/, /^\/api\/login$/];

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

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/") loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // everything except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
