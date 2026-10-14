// Break-glass account recovery, for when no org admin can sign in.
//
//   npm run user:reset -- someone@mrdiy.com            reset password, unlock, enable
//   npm run user:reset -- someone@mrdiy.com --admin    also make them an org admin
//
// Prints a random temporary password; they must change it at next sign-in. Needs DATABASE_URL
// (or DATABASE_MIGRATION_URL) in .env.local or the environment.
import { randomBytes } from "node:crypto";
import nextEnv from "@next/env";
import postgres from "postgres";
import { hashPassword } from "../lib/password.ts";

nextEnv.loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();
const makeAdmin = args.includes("--admin");
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

if (!email || !url) {
  console.error("Usage: npm run user:reset -- <email> [--admin]   (needs DATABASE_URL)");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  const temporary = randomBytes(12).toString("base64url");
  const rows = await sql`
    update users set
      password_hash = ${await hashPassword(temporary)},
      must_change_password = true,
      status = 'active',
      failed_logins = 0,
      locked_until = null,
      is_org_admin = is_org_admin or ${makeAdmin}
    where email = ${email}
    returning id, is_org_admin`;
  if (rows.length === 0) {
    console.error(`No user with email ${email}.`);
    process.exitCode = 1;
  } else {
    await sql`delete from sessions where user_id = ${rows[0].id}`;
    await sql`
      insert into audit_log (action, target_type, target_id, details)
      values ('user.password_reset_cli', 'user', ${rows[0].id}, ${sql.json({ email, makeAdmin })})`;
    console.log(`Reset ${email}${rows[0].is_org_admin ? " (org admin)" : ""}.`);
    console.log(`Temporary password: ${temporary}`);
    console.log("They must change it when they sign in.");
  }
} finally {
  await sql.end();
}
