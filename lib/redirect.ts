import "server-only";

import { after, NextResponse, type NextRequest } from "next/server";
import { findDestination, insertClick } from "@/lib/data";
import { hostedPageResponse } from "@/lib/hosted-page";
import { enqueue, jobsRunInline } from "@/lib/queue";
import { uuidv7 } from "@/lib/uuid7";
import { VISITOR_COOKIE } from "@/lib/session";
import { findPlacementDestination, type PlacementDestination } from "@/lib/placement-data";
import { normalizeTag } from "@/lib/slug";
import { describeClick, isPrefetch, type ClickDraft } from "@/lib/track";
import type { LinkKind } from "@/lib/types";

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

  const linkId = found.data.id;
  return respond(request, found.data, (click, at) => saveClick(linkId, click, tag, null, at));
}

// /q/<code>: a placement's QR code or printed address.
export async function traceAndRedirectPlacement(request: NextRequest, rawCode: string): Promise<NextResponse> {
  const code = rawCode.trim().toLowerCase();
  if (!/^[a-z0-9]{6,16}$/.test(code)) return notFoundResponse();

  let found: PlacementDestination | null;
  try {
    found = await findPlacementDestination(code);
  } catch (error) {
    console.error("Could not load the placement:", error instanceof Error ? error.message : error);
    return new NextResponse("This link could not be loaded. Try again shortly.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!found) return notFoundResponse();

  const { linkId, placementId, legacyTag } = found;
  // A placement made from a tag also counts under that tag, so platform stats stay complete.
  return respond(request, found, (click, at) => saveClick(linkId, click, legacyTag, placementId, at));
}

function respond(
  request: NextRequest,
  target: { kind: LinkKind; url: string | null; html: string | null },
  record: (click: ClickDraft, at: string) => Promise<void>,
): NextResponse {
  const click = describeClick(request);
  // Next.js answers HEAD with the GET handler; scanners use HEAD to check links without opening them.
  // The click is saved after the response is sent, so a slow database never delays the visitor.
  if (request.method !== "HEAD" && !isPrefetch(request)) {
    // The time is taken now, so a click saved later keeps the moment of the visit.
    const at = new Date().toISOString();
    after(() => record(click, at));
  }

  const { kind, url, html } = target;
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

// Every click is a record-click job. With the default inline queue it is saved right away (this
// already runs after the response); with a worker queue it is saved in batches by the worker. If a
// worker queue cannot take the click, it is saved directly so no visit is lost.
async function saveClick(
  linkId: string,
  click: ClickDraft,
  tag: string | null,
  placementId: string | null,
  at: string,
): Promise<void> {
  try {
    await enqueue("record-click", {
      id: uuidv7(Date.parse(at)),
      linkId,
      visitorId: click.visitorId,
      ip: click.ip,
      userAgent: click.userAgent,
      referrer: click.referrer,
      country: click.country,
      region: click.region,
      city: click.city,
      isBot: click.isBot,
      tag,
      placementId,
      clickedAt: at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : error;
    if (jobsRunInline()) {
      console.error("Failed to record click:", message);
      return;
    }
    console.error("Could not queue a click; saving it directly:", message);
    await insertClick(linkId, click, tag, placementId);
  }
}

function notFoundResponse(message = "This link is not in the log."): NextResponse {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Link not found</title><body style="font-family:Georgia,serif;background:#f3efe6;color:#1c1916;display:grid;min-height:100vh;place-items:center"><p>${message}</p></body></html>`;
  return new NextResponse(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
