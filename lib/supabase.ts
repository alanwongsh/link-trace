import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseConfig =
  | { ok: true; client: SupabaseClient }
  | { ok: false; message: string; missingConfig?: boolean };

const WRONG_KEY =
  "SUPABASE_SERVICE_ROLE_KEY is the publishable key. In Supabase, open Project Settings → API Keys and copy the secret key. It starts with sb_secret_. Restart the dev server after you save .env.local.";

let cached: SupabaseClient | null = null;
let cachedKey = "";

export function getSupabase(): SupabaseConfig {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return {
      ok: false,
      missingConfig: true,
      message:
        "Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. On Vercel, connect the Supabase integration, then set those variables if they are not filled in.",
    };
  }

  if (key.startsWith("sb_publishable_") || key.startsWith("sb_anon_")) {
    return { ok: false, message: WRONG_KEY };
  }

  const role = jwtRole(key);
  if (role === "anon" || role === "authenticated") {
    return { ok: false, message: WRONG_KEY };
  }

  const cacheId = `${url}:${key.slice(-8)}`;
  if (!cached || cachedKey !== cacheId) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cachedKey = cacheId;
  }

  return { ok: true, client: cached };
}

function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
