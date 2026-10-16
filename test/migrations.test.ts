import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./test-db";

// Data written before the newest migrations must come through them unchanged. Uses its own
// throwaway database so the shared test database is not disturbed.
const BEFORE = "0006_link_summaries_workspace";
const base = new URL(testDatabaseUrl());
const name = `${base.pathname.slice(1)}_migrations`;
const target = Object.assign(new URL(base), { pathname: `/${name}` }).toString();
const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
let folder: string;

function migrationsUpTo(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lt-migrations-"));
  cpSync("drizzle", dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const cut = journal.entries.findIndex((e: { tag: string }) => e.tag === tag);
  journal.entries = journal.entries.slice(0, cut + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

beforeAll(async () => {
  await admin.unsafe(`drop database if exists "${name}"`);
  await admin.unsafe(`create database "${name}"`);
  folder = migrationsUpTo(BEFORE);
});

afterAll(async () => {
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.end();
  rmSync(folder, { recursive: true, force: true });
});

describe("migrations", () => {
  it(`keep links, tags and clicks from ${BEFORE} unchanged`, async () => {
    const client = postgres(target, { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(client), { migrationsFolder: folder });
      // 0005 creates the Default workspace that existing links were moved into.
      const [{ id: workspaceId }] = await client`select id from workspaces where name = 'Default'`;
      const [{ id: linkId }] = await client`
        insert into links (slug, url, tags, workspace_id)
        values ('legacy', 'https://example.com', ${["email", "lark"]}, ${workspaceId}) returning id`;
      await client`
        insert into clicks (link_id, visitor_id, tag, is_bot)
        values (${linkId}, 'v1', 'email', false), (${linkId}, 'v2', null, false), (${linkId}, 'bot', null, true)`;
      const before = await snapshot(client);

      await migrate(drizzle(client), { migrationsFolder: "./drizzle" });

      expect(await snapshot(client)).toEqual(before);
      const [{ count }] = await client`select count(*)::int as count from tracking_parameters`;
      expect(count).toBe(0);
    } finally {
      await client.end();
    }
  });
});

async function snapshot(client: postgres.Sql) {
  const links = await client`select id, slug, url, tags, kind, workspace_id, created_at from links order by id`;
  const clicks = await client`select id, link_id, visitor_id, tag, is_bot, clicked_at from clicks order by id`;
  const [{ detail }] = await client`select link_detail('legacy') as detail`;
  const summary = await client`select slug, click_count, visitor_count, tags from link_summaries`;
  return { links, clicks, detail, summary };
}
