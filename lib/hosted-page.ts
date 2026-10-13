import "server-only";

import { NextResponse } from "next/server";

// Hosted pages share this app's origin, so they run in a CSP sandbox without allow-same-origin.
// The page gets an opaque origin: its scripts cannot read the dashboard session cookie or call
// the app as a signed-in admin, but forms, popups, and outbound links still work.
const SANDBOX =
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

export function hostedPageResponse(html: string): NextResponse {
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": SANDBOX,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-store",
    },
  });
}
