import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

// A quick gate only: sends visitors without a session cookie to sign in. Pages, actions, and
// routes still check the session against the database (requireUser), since the cookie may be stale.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname === "/setup") return NextResponse.next();

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/setup", "/stats/:path*", "/admin/:path*", "/account/:path*", "/parameters", "/workspaces/:path*"],
};
