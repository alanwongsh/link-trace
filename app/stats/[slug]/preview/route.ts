import { type NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { findDestination } from "@/lib/data";
import { hostedPageResponse } from "@/lib/hosted-page";

// Lets a signed-in admin view a hosted page without logging a click.
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  if (!(await isAuthed())) return new NextResponse("Sign in first.", { status: 401 });

  const { slug } = await context.params;
  const found = await findDestination(slug.toLowerCase());
  if (!found.ok) return new NextResponse(found.message, { status: 500 });
  if (!found.data || found.data.kind !== "page" || found.data.html === null) {
    return new NextResponse("No hosted page for this link.", { status: 404 });
  }
  return hostedPageResponse(found.data.html);
}
