import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  pgView,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative, so drizzle-kit can load this file without the @/ alias.
import { PARAMETER_TYPES } from "../parameters";

// Time-ordered UUIDs (v7). uuid_v7() is created in drizzle/0004_uuid_v7.sql; Postgres 18 adds a built-in uuidv7().
const uuidV7 = sql`uuid_v7()`;

export const ROLES = ["viewer", "editor", "owner"] as const;

// Email is the identity key, so a future Joget or company sign-in can map onto these rows.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(uuidV7),
    email: text("email").notNull().unique("users_email_key"),
    name: text("name").notNull(),
    // Null means the account cannot sign in with a password.
    passwordHash: text("password_hash"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    isOrgAdmin: boolean("is_org_admin").notNull().default(false),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "string" }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    check("users_email_lower", sql`${table.email} = lower(${table.email})`),
    check("users_status_check", sql`${table.status} in ('active', 'disabled')`),
  ],
);

// The cookie holds a random token; only its SHA-256 is stored, so a database leak cannot be replayed.
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().default(uuidV7),
  name: text("name").notNull().unique("workspaces_name_key"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "memberships_pkey", columns: [table.workspaceId, table.userId] }),
    index("memberships_user_id_idx").on(table.userId),
    check("memberships_role_check", sql`${table.role} in ('viewer', 'editor', 'owner')`),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(uuidV7),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    // Kept as text too, so entries still read correctly after a user is deleted.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userEmail: text("user_email"),
    action: text("action").notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
  },
  (table) => [index("audit_log_at_idx").on(table.at.desc())],
);

export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().default(uuidV7),
    slug: text("slug").notNull().unique("links_slug_key"),
    // "redirect" sends visitors to url; "page" serves html from this app.
    kind: text("kind", { enum: ["redirect", "page"] }).notNull().default("redirect"),
    url: text("url"),
    html: text("html"),
    title: text("title"),
    tags: text("tags").array().notNull().default(sql`'{}'`),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("links_workspace_id_idx").on(table.workspaceId),
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
    id: uuid("id").primaryKey().default(uuidV7),
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


// A workspace's own labels for placements, such as store_code or booth_id. Values are rows, never columns.
// Parameters are archived (is_active = false), not deleted, so old placements and scans keep their meaning.
export const trackingParameters = pgTable(
  "tracking_parameters",
  {
    id: uuid("id").primaryKey().default(uuidV7),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Fixed after creation; reports and imports refer to it.
    key: text("key").notNull(),
    description: text("description"),
    fieldType: text("field_type", { enum: PARAMETER_TYPES }).notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("tracking_parameters_workspace_key").on(table.workspaceId, table.key),
    check("tracking_parameters_key_format", sql`${table.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("tracking_parameters_field_type_check", sql`${table.fieldType} in ('text', 'dropdown')`),
  ],
);

// Predefined values of a dropdown parameter. value is the code people import and report on.
export const trackingParameterOptions = pgTable(
  "tracking_parameter_options",
  {
    id: uuid("id").primaryKey().default(uuidV7),
    parameterId: uuid("parameter_id").notNull(),
    value: text("value").notNull(),
    label: text("label"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    // Named explicitly: the generated name is over Postgres's 63-character limit.
    foreignKey({
      name: "tracking_parameter_options_parameter_id_fkey",
      columns: [table.parameterId],
      foreignColumns: [trackingParameters.id],
    }).onDelete("cascade"),
    // Codes are unique regardless of case, but keep the case they were entered in.
    uniqueIndex("tracking_parameter_options_value").on(table.parameterId, sql`lower(${table.value})`),
  ],
);

// Created by the SQL in drizzle/0001, 0003 (kind), and 0006 (workspace_id, created_by), along with link_detail().
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
  workspace_id: uuid("workspace_id").notNull(),
  created_by: uuid("created_by"),
}).existing();
