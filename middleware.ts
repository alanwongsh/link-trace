import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  expectedSessionToken,
  safeEqual,
} from "@/lib/session";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  const expected = await expectedSessionToken();
  const authed = Boolean(expected && token && safeEqual(token, expected));
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    if (authed) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  if (!authed) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/stats/:path*"],
};
