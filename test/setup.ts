import { testDatabaseUrl } from "./test-db";

// The app reads DATABASE_URL; point it at the guarded test database before any test runs.
process.env.DATABASE_URL = testDatabaseUrl();
