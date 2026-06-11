import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  passwordMatches,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionSecret,
} from "@/lib/session";
import { redirectTo } from "@/lib/redirects";

function isHttps(request: NextRequest): boolean {
  return (
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ||
    request.nextUrl.protocol === "https:"
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const password = process.env.PF_DASHBOARD_PASSWORD;
  const form = await request.formData();
  const submitted = String(form.get("password") ?? "");
  const from = String(form.get("from") ?? "/");
  // only allow internal redirect targets
  const target = from.startsWith("/") && !from.startsWith("//") ? from : "/";

  if (!password) {
    return redirectTo("/");
  }
  if (!submitted || !(await passwordMatches(submitted, password))) {
    const params = new URLSearchParams({ error: "1" });
    if (target !== "/") params.set("from", target);
    return redirectTo(`/login?${params}`);
  }

  const response = redirectTo(target);
  response.cookies.set(SESSION_COOKIE, await createSessionToken(sessionSecret()!), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(request),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}
