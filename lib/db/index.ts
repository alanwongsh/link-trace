import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

export type Db = PostgresJsDatabase<typeof schema>;

export type DbConfig =
  | { ok: true; db: Db }
  | { ok: false; message: string; missingConfig?: boolean };

// Reuse one client across hot reloads in dev and warm invocations on Vercel.
const globalForDb = globalThis as unknown as { linkTraceDb?: { url: string; db: Db } };

export function getDb(): DbConfig {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return {
      ok: false,
      missingConfig: true,
      message:
        "Add DATABASE_URL. On Supabase, copy the transaction pooler connection string from Connect → Connection string.",
    };
  }

  if (globalForDb.linkTraceDb?.url !== url) {
    // prepare: false keeps queries working behind transaction poolers (Supabase Supavisor, PgBouncer).
    const client = postgres(url, { prepare: false, max: 5 });
    globalForDb.linkTraceDb = { url, db: drizzle(client, { schema }) };
  }

  return { ok: true, db: globalForDb.linkTraceDb.db };
}
