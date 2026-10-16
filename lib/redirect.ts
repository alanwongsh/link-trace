import "server-only";

import { after, NextResponse, type NextRequest } from "next/server";
import { findDestination, insertClick } from "@/lib/data";
import { hostedPageResponse } from "@/lib/hosted-page";
import { VISITOR_COOKIE } from "@/lib/session";
import { normalizeTag } from "@/lib/slug";
import { describeClick, isPrefetch } from "@/lib/track";

const YEAR = 60 * 60 * 24 * 365;

export async function traceAndRedirect(
  request: NextRequest,
  slug: string,
  rawTag: string | null,
): Promise<NextResponse> {
  const tag = rawTag === null ? null : normalizeTag(rawTag);
  if (rawTag !== null && !tag) return notFoundResponse();

  const found = await findDestination(slug.toLowerCase());
  if (!found.ok) {
    return new NextResponse(found.message, {
      status: found.missingConfig || found.missingSchema ? 503 : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!found.data) return notFoundResponse();
  if (tag && !found.data.tags.includes(tag)) {
    return notFoundResponse("This platform tag is not on the link.");
  }

  const click = describeClick(request);
  // Next.js answers HEAD with the GET handler; scanners use HEAD to check links without opening them.
  // The click is saved after the response is sent, so a slow database never delays the visitor.
  if (request.method !== "HEAD" && !isPrefetch(request)) {
    const linkId = found.data.id;
    after(() => insertClick(linkId, click, tag));
  }

  const { kind, url, html } = found.data;
  let response: NextResponse;
  if (kind === "page" && html !== null) {
    response = hostedPageResponse(html);
  } else if (url) {
    response = NextResponse.redirect(url, 302);
    response.headers.set("Cache-Control", "no-store");
  } else {
    return notFoundResponse();
  }
  if (click.isNewVisitor) {
    response.cookies.set(VISITOR_COOKIE, click.visitorId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: YEAR,
    });
  }
  return response;
}

function notFoundResponse(message = "This link is not in the log."): NextResponse {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Link not found</title><body style="font-family:Georgia,serif;background:#f3efe6;color:#1c1916;display:grid;min-height:100vh;place-items:center"><p>${message}</p></body></html>`;
  return new NextResponse(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
