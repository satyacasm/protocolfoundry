import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { redirectTo } from "@/lib/redirects";

export async function POST(): Promise<NextResponse> {
  const response = redirectTo("/login");
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
