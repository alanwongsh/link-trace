// Refuses anything but a local database whose name contains "test", so a test run can never
// wipe the Supabase database in .env.local.
export function testDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("Add TEST_DATABASE_URL for a local test database to .env.test.local.");
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (!local || !url.pathname.toLowerCase().includes("test")) {
    throw new Error(
      `TEST_DATABASE_URL must point to a local database with "test" in its name (got ${url.hostname}${url.pathname}).`,
    );
  }
  return raw;
}
