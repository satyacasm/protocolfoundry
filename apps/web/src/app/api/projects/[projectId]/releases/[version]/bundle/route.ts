import { NextRequest } from "next/server";
import { getReleaseDetail } from "@/lib/data";
import { buildConnectionBundle } from "@/lib/bundle";

// reads the live release store on every request — never statically optimized
export const dynamic = "force-dynamic";

/**
 * GET → .zip connection bundle for a release (manifest, client configs,
 * token instructions, eval report). Covered by the session middleware like
 * every other dashboard route; contains no credentials by construction.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; version: string }> },
): Promise<Response> {
  const { projectId, version } = await params;
  if (!/^[A-Za-z0-9_-]+$/.test(projectId) || !/^\d+$/.test(version)) {
    return new Response("Bad request", { status: 400 });
  }
  const detail = await getReleaseDetail(projectId, Number(version));
  if (!detail) return new Response("Not found", { status: 404 });

  const zip = await buildConnectionBundle(detail.release, detail.manifest, detail.evalRun);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${detail.manifest.serverName}-v${detail.release.version}-mcp-bundle.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
