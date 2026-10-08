import { type NextRequest } from "next/server";
import { traceAndRedirect } from "@/lib/redirect";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string; tag: string }> },
) {
  const { slug, tag } = await context.params;
  return traceAndRedirect(request, slug, tag);
}
