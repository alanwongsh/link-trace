import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { findDestination } from "@/lib/data";
import { linkReport, readReportQuery, reportParameters } from "@/lib/report-data";

// Rows the CSV can hold; far more than the page shows.
const CSV_ROW_LIMIT = 50_000;

// The link page's report as CSV: ?by=key1,key2&range=30d, the same as the Report tab.
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return new NextResponse("Sign in first.", { status: 401 });

  const slug = (await context.params).slug.toLowerCase();
  const found = await findDestination(slug);
  if (!found.ok) return new NextResponse(found.message, { status: 500 });
  // Other workspaces' links look the same as missing ones.
  if (!found.data || !can(user, found.data.workspaceId, "viewer")) return new NextResponse("Link not found.", { status: 404 });

  const parameters = await reportParameters(found.data.id);
  const search = request.nextUrl.searchParams;
  const { groupBy, range } = readReportQuery(
    { by: search.get("by") ?? undefined, range: search.get("range") ?? undefined },
    parameters,
    parameters.slice(0, 1),
  );
  const report = await linkReport(found.data.id, groupBy.map((p) => p.id), range, CSV_ROW_LIMIT);

  const header = [...groupBy.flatMap((p) => [p.key, `${p.key}_label`]), "came_through", "clicks", "visitors"];
  const rows = report.rows.map((row) => [
    ...row.cells.flatMap((cell) => [cell?.value ?? "", cell?.label ?? ""]),
    row.direct ? "main link" : "labelled link",
    String(row.clicks),
    String(row.visitors),
  ]);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv([header, ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-report-${range}-${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
