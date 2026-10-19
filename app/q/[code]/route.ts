import { type NextRequest } from "next/server";
import { traceAndRedirectPlacement } from "@/lib/redirect";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  return traceAndRedirectPlacement(request, code);
}
