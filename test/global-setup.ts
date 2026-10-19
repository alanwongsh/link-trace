import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { testDatabaseUrl } from "./test-db";

// Rebuilds the test database from the migrations in ./drizzle, the same way production is set up.
export default async function setup() {
  const client = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await client.unsafe("drop schema if exists drizzle cascade; drop schema if exists pgboss cascade; drop schema public cascade; create schema public;");
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}
