import { type NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { can, getCurrentUser } from "@/lib/auth";
import { findDestination } from "@/lib/data";
import { appOrigin } from "@/lib/origin";
import { normalizeTag } from "@/lib/slug";

// QR code for /r/slug, or /r/slug/tag with ?tag=. ?format=png|svg, ?download=1 to save as a file.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return new NextResponse("Sign in first.", { status: 401 });

  const slug = (await context.params).slug.toLowerCase();
  const params = request.nextUrl.searchParams;
  const rawTag = params.get("tag");
  const tag = rawTag ? normalizeTag(rawTag) : null;
  if (rawTag && !tag) return new NextResponse("Unknown tag.", { status: 404 });

  const found = await findDestination(slug);
  if (!found.ok) return new NextResponse(found.message, { status: 500 });
  if (!found.data || !can(user, found.data.workspaceId, "viewer")) {
    return new NextResponse("Link not found.", { status: 404 });
  }
  if (tag && !found.data.tags.includes(tag)) {
    return new NextResponse("This platform tag is not on the link.", { status: 404 });
  }

  const shortUrl = `${await appOrigin()}/r/${slug}${tag ? `/${tag}` : ""}`;
  const options = { errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } } as const;
  const name = `${slug}${tag ? `-${tag}` : ""}-qr`;
  const download = params.get("download") === "1";

  if (params.get("format") === "png") {
    const png = await QRCode.toBuffer(shortUrl, { ...options, type: "png", width: 1024 });
    return fileResponse(new Uint8Array(png), "image/png", download ? `${name}.png` : null);
  }
  const svg = await QRCode.toString(shortUrl, { ...options, type: "svg" });
  return fileResponse(svg, "image/svg+xml", download ? `${name}.svg` : null);
}

function fileResponse(body: BodyInit, type: string, filename: string | null): NextResponse {
  const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": "private, no-store" };
  if (filename) headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  return new NextResponse(body, { headers });
}
