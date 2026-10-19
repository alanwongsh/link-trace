import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/lib/auth";
import { NAME_COLUMN } from "@/lib/bulk-parse";
import { toCsv } from "@/lib/csv";
import { findDestination } from "@/lib/data";
import { placementFields } from "@/lib/parameter-data";

// A CSV to fill in: the name column and the workspace's active parameter keys, with one example row.
export async function GET(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return new NextResponse("Sign in first.", { status: 401 });
  const slug = (await context.params).slug.toLowerCase();
  const found = await findDestination(slug);
  if (!found.ok) return new NextResponse("Could not load the link.", { status: 500 });
  if (!found.data || !can(user, found.data.workspaceId, "viewer")) {
    return new NextResponse("Link not found.", { status: 404 });
  }

  const fields = await placementFields(found.data.workspaceId);
  const header = [NAME_COLUMN, ...fields.map((f) => f.key)];
  const example = ["Entrance poster", ...fields.map((f) => (f.fieldType === "dropdown" ? (f.options[0]?.value ?? "") : ""))];
  return new NextResponse(toCsv([header, example]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-placements-template.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
