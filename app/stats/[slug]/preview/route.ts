import { type NextRequest, NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/auth";
import { findDestination } from "@/lib/data";
import { hostedPageResponse } from "@/lib/hosted-page";

// Lets a signed-in admin view a hosted page without logging a click.
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return new NextResponse("Sign in first.", { status: 401 });

  const { slug } = await context.params;
  const found = await findDestination(slug.toLowerCase());
  if (!found.ok) return new NextResponse(found.message, { status: 500 });
  if (!found.data || !can(user, found.data.workspaceId, "viewer") || found.data.kind !== "page" || found.data.html === null) {
    return new NextResponse("No hosted page for this link.", { status: 404 });
  }
  return hostedPageResponse(found.data.html);
}
