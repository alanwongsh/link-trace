import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { labelKey } from "@/lib/label-key";
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

describe("0012 label keys", () => {
  const keyName = `${name}_label_key`;
  const keyTarget = Object.assign(new URL(base), { pathname: `/${keyName}` }).toString();

  it("keys older placements as labelKey() does, and leaves the newer copy of a duplicate unkeyed", async () => {
    await admin.unsafe(`drop database if exists "${keyName}"`);
    await admin.unsafe(`create database "${keyName}"`);
    const upTo = migrationsUpTo("0011_timezones_daily_totals");
    const client = postgres(keyTarget, { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(client), { migrationsFolder: upTo });
      const [{ id: workspaceId }] = await client`select id from workspaces where name = 'Default'`;
      const [{ id: linkId }] = await client`
        insert into links (slug, url, workspace_id) values ('promo', 'https://example.com', ${workspaceId}) returning id`;
      const [store, channel] = await client<{ id: string }[]>`
        insert into tracking_parameters (workspace_id, key, name, field_type)
        values (${workspaceId}, 'store', 'Store', 'text'), (${workspaceId}, 'channel', 'Channel', 'text') returning id`;
      const make = async (code: string, name: string | null, values: [string, string][], isActive = true) => {
        const [{ id }] = await client`
          insert into placements (link_id, code, name, is_active) values (${linkId}, ${code}, ${name}, ${isActive}) returning id`;
        for (const [parameterId, value] of values) {
          await client`insert into placement_values (placement_id, parameter_id, value) values (${id}, ${parameterId}, ${value})`;
        }
      };
      // Values given out of parameter order, in mixed case, to match the app's sorting and lowering.
      await make("first111", " Door ", [[channel.id, "Email"], [store.id, "KL001"]]);
      await make("second22", "door", [[store.id, "kl001"], [channel.id, "email"]]);
      await make("third333", null, []);
      await make("fourth44", null, [], false);

      await migrate(drizzle(client), { migrationsFolder: "./drizzle" });

      const keys = Object.fromEntries(
        (await client<{ code: string; label_key: string | null }[]>`select code, label_key from placements`).map((r) => [r.code, r.label_key]),
      );
      const door = labelKey(
        [
          { parameterId: store.id, value: "KL001" },
          { parameterId: channel.id, value: "Email" },
        ],
        " Door ",
      );
      expect(keys).toEqual({ first111: door, second22: null, third333: labelKey([], null), fourth44: labelKey([], null) });
      // The index now refuses another active copy of the first.
      await expect(
        client`insert into placements (link_id, code, label_key) values (${linkId}, 'fifth555', ${door})`,
      ).rejects.toThrow(/placements_active_label_key/);
    } finally {
      await client.end();
      await admin.unsafe(`drop database if exists "${keyName}" with (force)`);
      rmSync(upTo, { recursive: true, force: true });
    }
    // Creates a database and runs every migration.
  }, 30_000);
});

async function snapshot(client: postgres.Sql) {
  const links = await client`select id, slug, url, tags, kind, workspace_id, created_at from links order by id`;
  const clicks = await client`select id, link_id, visitor_id, tag, is_bot, clicked_at from clicks order by id`;
  const [{ detail }] = await client`select link_detail('legacy') as detail`;
  const summary = await client`select slug, click_count, visitor_count, tags from link_summaries`;
  return { links, clicks, detail, summary };
}
