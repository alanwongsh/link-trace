import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/lib/auth";
import { findBulkZip } from "@/lib/bulk-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Downloads a finished bulk upload's zip of QR codes and placements.csv.
export async function GET(_request: NextRequest, context: { params: Promise<{ slug: string; jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return new NextResponse("Sign in first.", { status: 401 });
  const { slug, jobId } = await context.params;
  if (!UUID.test(jobId)) return new NextResponse("Not found.", { status: 404 });

  const job = await findBulkZip(jobId, slug.toLowerCase());
  // Other workspaces' uploads look the same as missing ones.
  if (!job || !can(user, job.workspaceId, "viewer")) return new NextResponse("Not found.", { status: 404 });
  if (!job.zip) return new NextResponse("This file is not ready, or has expired.", { status: 410 });

  const day = job.createdAt.slice(0, 10);
  return new NextResponse(new Uint8Array(job.zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug.toLowerCase()}-qr-${day}-${jobId.slice(-6)}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
