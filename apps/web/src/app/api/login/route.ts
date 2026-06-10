import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  passwordMatches,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionSecret,
} from "@/lib/session";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const password = process.env.PF_DASHBOARD_PASSWORD;
  const form = await request.formData();
  const submitted = String(form.get("password") ?? "");
  const from = String(form.get("from") ?? "/");
  // only allow internal redirect targets
  const target = from.startsWith("/") && !from.startsWith("//") ? from : "/";

  if (!password) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (!submitted || !(await passwordMatches(submitted, password))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "1");
    if (target !== "/") url.searchParams.set("from", target);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(new URL(target, request.url));
  response.cookies.set(SESSION_COOKIE, await createSessionToken(sessionSecret()!), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
