import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests use their own local database, never DATABASE_URL from .env.local. Only
// .env.test.local is read, and a TEST_DATABASE_URL already in the shell wins.
if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // "server-only" throws outside the Next.js server bundle.
      "server-only": path.resolve(__dirname, "test/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    env: { TEST_DATABASE_URL, DATABASE_URL: TEST_DATABASE_URL },
    // All files share one database.
    fileParallelism: false,
  },
});
