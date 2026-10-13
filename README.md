# Link Trace

Short links with a visitor log. Create a link, share `/r/your-slug`, and see clicks, unique visitors, IP addresses, referrers, and places. Add platform tags and share `/r/your-slug/instagram` so each channel is counted on its own. The app is Next.js, hosted on Vercel, with links and clicks stored in Postgres (Supabase today) through [Drizzle ORM](https://orm.drizzle.team).

## Hosted pages

Instead of a destination URL, a link can serve a static HTML page (up to 512 KB) from `/r/your-slug`. Visits are tracked the same way, and platform tags work too. Paste the HTML or load an `.html` file when creating the link. Preview it from the dashboard at `/stats/your-slug/preview`, which does not count as a click.

Pages are served with a `Content-Security-Policy: sandbox` header, which gives them their own isolated origin. Scripts in the page run, but they cannot read the dashboard session or use cookies or local storage.

## What a visit stores

- IP address
- A first-party visitor cookie (`lt_vid`) so the same browser counts as one visitor
- Browser user agent
- Referrer
- Country, region, and city from Vercel’s `x-vercel-ip-*` headers (filled in after deploy, not on localhost)

Known bots are stored and tagged, and left out of the headline counts. The dashboard is locked with `ADMIN_PASSWORD`. The redirect itself is public.

## Database

The app talks to Postgres directly with `DATABASE_URL`. Nothing depends on Supabase-specific APIs, so moving to another Postgres (15 or later) means changing that URL and running the migrations.

- Schema: [`lib/db/schema.ts`](lib/db/schema.ts)
- Migrations: [`drizzle/`](drizzle). `0001` holds the `link_summaries` view and `link_detail()` function as SQL.
- Queries: [`lib/data.ts`](lib/data.ts)

### Supabase

1. Create a project.
2. Open **Connect → Connection string**. Copy the **Transaction pooler** string (port 6543) into `DATABASE_URL`.
3. Run `npm run db:migrate`. If the pooler gives trouble with migrations, set `DATABASE_MIGRATION_URL` to the session pooler (port 5432) or direct connection.

Migrations are safe on a database created with the old `supabase/schema.sql`: they skip anything that already exists.

Row level security is on with no policies, so Supabase’s public API (`anon`, `authenticated`) cannot read the tables. The app connects as the table owner, which RLS does not restrict.

### Changing the schema

1. Edit `lib/db/schema.ts`.
2. `npm run db:generate` writes a new migration to `drizzle/`. Review it.
3. `npm run db:migrate` applies it.

`npm run db:studio` opens a browser view of the data.

## Local

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Fill in `DATABASE_URL` and `ADMIN_PASSWORD`.

## Vercel

1. Import this repo.
2. Set `DATABASE_URL` (transaction pooler) and `ADMIN_PASSWORD`. Do not prefix them with `NEXT_PUBLIC_`.
3. Deploy. Optional: set `NEXT_PUBLIC_APP_URL` to the public origin used in copied links. If unset, the app uses the request host.
