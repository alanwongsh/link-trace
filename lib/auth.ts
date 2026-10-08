import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  expectedSessionToken,
  safeEqual,
} from "@/lib/session";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function isAuthed(): Promise<boolean> {
  const expected = await expectedSessionToken();
  if (!expected) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  return safeEqual(token, expected);
}

export async function requireSession(): Promise<void> {
  if (!(await isAuthed())) redirect("/login");
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: THIRTY_DAYS,
  };
}

export async function readSessionToken(): Promise<string | null> {
  return expectedSessionToken();
}
