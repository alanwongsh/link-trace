import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  pgView,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique("links_slug_key"),
    // "redirect" sends visitors to url; "page" serves html from this app.
    kind: text("kind", { enum: ["redirect", "page"] }).notNull().default("redirect"),
    url: text("url"),
    html: text("html"),
    title: text("title"),
    tags: text("tags").array().notNull().default(sql`'{}'`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("links_tags_len", sql`cardinality(${table.tags}) <= 12`),
    check(
      "links_kind_target",
      sql`(${table.kind} = 'redirect' and ${table.url} is not null) or (${table.kind} = 'page' and ${table.html} is not null)`,
    ),
  ],
);

export const clicks = pgTable(
  "clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id").notNull(),
    visitorId: text("visitor_id").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    referrer: text("referrer"),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    isBot: boolean("is_bot").notNull().default(false),
    tag: text("tag"),
    clickedAt: timestamp("clicked_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "clicks_link_id_fkey",
      columns: [table.linkId],
      foreignColumns: [links.id],
    }).onDelete("cascade"),
    index("clicks_link_id_clicked_at_idx").on(table.linkId, table.clickedAt.desc()),
  ],
);

// Created by the SQL in drizzle/0001 and 0003 (kind column), along with link_detail().
export const linkSummaries = pgView("link_summaries", {
  id: uuid("id").notNull(),
  slug: text("slug").notNull(),
  url: text("url"),
  title: text("title"),
  tags: text("tags").array().notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  click_count: integer("click_count").notNull(),
  visitor_count: integer("visitor_count").notNull(),
  ip_count: integer("ip_count").notNull(),
  kind: text("kind", { enum: ["redirect", "page"] }).notNull(),
}).existing();
